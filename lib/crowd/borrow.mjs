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
// (an https mirror works too). The read is OFF unless CROWD_BORROW=1 (see
// fetchBorrow below). Once per ET day; 90 days of [date, feePct, available]
// per tracked name.
//
// The FTP read timed out on every GitHub runner build from 2026-11-09 to
// 2026-11-12, which is why it is off by default.

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

// OFF BY DEFAULT since 2026-11-13 (owner decision): the FTP file never loaded
// from the GitHub runner (every build since 2026-11-09 timed out), the
// option-implied borrow rate (lib/market-structure.mjs, shadow key `ibr`)
// already stands in per name, and the 2026-11-13 history test found no
// per-name crowd input that predicts returns. CROWD_BORROW=1 (repo variable or
// Owner Settings) turns the read back on, e.g. with CROWD_BORROW_URL set to an
// HTTPS mirror. Off returns an empty block: nothing is carried, so the page and
// the source-health check never show a stale copy. A test that injects
// readImpl is treated as on.
export const BORROW_OFF_NOTE = "Off: Interactive Brokers' borrow file cannot be read from the build machines. The Market map's option-implied borrow rate covers each name instead.";
export async function fetchBorrow({ prior, symbols, todayEt, nowIso = new Date().toISOString(), url = process.env.CROWD_BORROW_URL || BORROW_DEFAULT_URL, readImpl = readBorrowSource, enabled = process.env.CROWD_BORROW === "1" || readImpl !== readBorrowSource } = {}) {
  const base = prior && typeof prior === "object" ? prior : {};
  if (!enabled || process.env.CROWD_BORROW === "0") return { ok: false, disabled: true, stale: false, carriedForward: false, error: null, fetchedAt: nowIso, bySymbol: {}, note: BORROW_OFF_NOTE };
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
