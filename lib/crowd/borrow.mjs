// O3 — Interactive Brokers stock-loan borrow fee and shares available.
//
// IBKR publishes its securities-lending list as a pipe-delimited file over
// anonymous FTP (ftp3.interactivebrokers.com, user `shortstock`, file
// usa.txt): #SYM|CUR|NAME|CON|ISIN|REBATERATE|FEERATE|AVAILABLE, refreshed
// every ~15 minutes during the day. FEERATE is the annualized borrow fee in
// percent; AVAILABLE is shares available to borrow (">10000000" means more
// than ten million). Free, no key, no login beyond the public user.
//
// Node's fetch has no FTP, so the read shells out to curl (present on the
// GitHub runner and most machines); CROWD_BORROW_URL overrides the location
// (an https mirror works too) and CROWD_BORROW=0 skips the read. Once per ET
// day; 90 days of [date, feePct, available] per tracked name.
//
// UNTESTED FROM THE BUILD SANDBOX (outbound FTP is blocked here): the first
// live build shows whether the file reads; a failure only carries forward.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { finite, round, carried, errorText, upsertDated, fetchedToday, normalizeSymbol, mean } from "./util.mjs";

const execFileP = promisify(execFile);
export const BORROW_DEFAULT_URL = "ftp://shortstock:@ftp3.interactivebrokers.com/usa.txt";
export const BORROW_HISTORY_DAYS = 90;

export function parseBorrowFile(text, symbols) {
  const want = symbols ? new Set(symbols.map(normalizeSymbol)) : null;
  const out = {};
  let rows = 0;
  let asOf = null;
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith("#BOF")) {
      // #BOF|2026.11.06|16:45:12 — the file's own stamp
      const m = line.match(/#BOF\|(\d{4})\.(\d{2})\.(\d{2})\|(\d{2}:\d{2})/);
      if (m) asOf = `${m[1]}-${m[2]}-${m[3]}T${m[4]}`;
      continue;
    }
    if (line.startsWith("#")) continue;
    const parts = line.split("|");
    if (parts.length < 8) continue;
    const sym = normalizeSymbol(parts[0]);
    if (!sym) continue;
    rows++;
    if (want && !want.has(sym)) continue;
    const availRaw = String(parts[7] || "").trim();
    const available = finite(availRaw.replace(/^>/, ""));
    out[sym] = {
      name: String(parts[2] || "").trim() || null,
      rebatePct: finite(parts[5]),
      feePct: finite(parts[6]),
      available,
      availableCapped: availRaw.startsWith(">"),
    };
  }
  return { rows, asOf, bySymbol: out };
}

async function readBorrowSource(url) {
  if (/^https?:/i.test(url)) {
    const res = await fetch(url, { signal: AbortSignal.timeout(60000), headers: { "user-agent": "stonks-app market-data pipeline" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }
  // One bounded attempt (the next bake is an hour away and the block carries
  // forward): 20 s to connect, 60 s in all. EPSV off and the PASV address
  // ignored, the usual fixes for FTP through a NAT such as the GitHub runner's.
  // curl's own message rides the error so a failed read says why.
  try {
    const { stdout } = await execFileP("curl", ["-sS", "--connect-timeout", "20", "--max-time", "60", "--disable-epsv", "--ftp-skip-pasv-ip", url], { maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    const detail = String(err?.stderr || "").trim().split("\n").filter(Boolean).pop() || "";
    throw new Error(`curl ${url.replace(/\/\/[^@/]*@/, "//")} failed${detail ? `: ${detail}` : err?.code != null ? ` (exit ${err.code})` : ""}`);
  }
}

export async function fetchBorrow({ prior, symbols, todayEt, nowIso = new Date().toISOString(), url = process.env.CROWD_BORROW_URL || BORROW_DEFAULT_URL, readImpl = readBorrowSource } = {}) {
  const base = prior && typeof prior === "object" ? prior : {};
  if (process.env.CROWD_BORROW === "0") return { ...carried(base, "disabled (CROWD_BORROW=0)", nowIso), disabled: true };
  if (fetchedToday(base, todayEt)) return { ...base, carriedForward: false };
  try {
    const text = await readImpl(url);
    const parsed = parseBorrowFile(text, symbols);
    if (parsed.rows < 100) throw new Error(`only ${parsed.rows} rows parsed`);
    const bySymbol = {};
    const fees = [];
    for (const sym of symbols) {
      const row = parsed.bySymbol[sym];
      const hist = Array.isArray(base.bySymbol?.[sym]?.history) ? base.bySymbol[sym].history : [];
      const history = row ? upsertDated(hist, [todayEt, row.feePct, row.available], BORROW_HISTORY_DAYS) : hist;
      const feeHist = history.map((r) => r[1]).filter((v) => Number.isFinite(v));
      if (row?.feePct != null) fees.push(row.feePct);
      bySymbol[sym] = {
        ...(row || { feePct: null, rebatePct: null, available: null, availableCapped: false, missing: true }),
        avgFee30: round(mean(feeHist.slice(-31, -1)), 2),
        history,
      };
    }
    return {
      ok: true, stale: false, carriedForward: false, error: null, untested: true,
      fetchedAt: nowIso, fetchedDate: todayEt, asOf: parsed.asOf || nowIso,
      rows: parsed.rows,
      bySymbol,
      universe: { medianFeePct: fees.length ? round(fees.sort((a, b) => a - b)[Math.floor(fees.length / 2)], 2) : null, hardToBorrow: fees.filter((f) => f >= 5).length },
      note: "Interactive Brokers' own securities-lending desk: annualized borrow fee and shares its clients can borrow. One broker's inventory, not the whole market; a fee over a few percent reads hard-to-borrow.",
    };
  } catch (err) {
    return { ...carried(base, errorText(err), nowIso), untested: true };
  }
}
