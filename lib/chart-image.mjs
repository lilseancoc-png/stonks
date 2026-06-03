// Dependency-free daily price-chart renderer → PNG Buffer.
//
// Why this exists: the AI chart-pattern detector (scripts/build.mjs
// generateChartPattern) used to hand Gemini a *text table* of daily bars and
// ask it to infer chart geometry (head-and-shoulders, etc.) from a column of
// numbers — a visual task done blind. This renders the same bars to an actual
// chart image so the (multimodal) model can SEE the shape. Pure JS + Node zlib
// so it adds no dependency to the build/CI (the repo has no bundler and keeps
// deps minimal — see CLAUDE.md).
//
// The output is intentionally plain: a close-price line with a high/low wick
// band, 50- and 200-day SMA overlays, a current-spot marker, and a volume
// strip beneath. No rasterized text — the model is given exact levels/dates in
// the accompanying text prompt, so the image only needs to convey shape.

import zlib from "node:zlib";

// ---- CRC32 (for PNG chunk checksums) ----------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---- minimal PNG encoder (truecolor+alpha, filter 0 per scanline) -----------
function encodePng(width, height, rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, "ascii");
    const body = Buffer.concat([typeBuf, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([len, body, crc]);
  };
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: truecolor + alpha
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  // Prepend a 0x00 (None) filter byte to each scanline.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy
      ? rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
      : Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- tiny raster canvas -----------------------------------------------------
function makeCanvas(width, height, bg = [255, 255, 255, 255]) {
  const buf = Buffer.alloc(width * height * 4);
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = bg[0]; buf[i + 1] = bg[1]; buf[i + 2] = bg[2]; buf[i + 3] = bg[3];
  }
  const px = (x, y, col) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const o = (y * width + x) * 4;
    buf[o] = col[0]; buf[o + 1] = col[1]; buf[o + 2] = col[2]; buf[o + 3] = col[3] == null ? 255 : col[3];
  };
  // line width via perpendicular thickness
  const line = (x0, y0, x1, y1, col, w = 1) => {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    const half = (w - 1) / 2;
    const steep = dy > dx;
    for (;;) {
      for (let k = -half; k <= half; k++) {
        if (steep) px(x0 + k, y0, col); else px(x0, y0 + k, col);
      }
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
  };
  const vline = (x, y0, y1, col) => { if (y0 > y1) [y0, y1] = [y1, y0]; for (let y = y0; y <= y1; y++) px(x, y, col); };
  const fillRect = (x0, y0, x1, y1, col) => {
    for (let y = Math.round(y0); y <= Math.round(y1); y++) for (let x = Math.round(x0); x <= Math.round(x1); x++) px(x, y, col);
  };
  return { buf, width, height, px, line, vline, fillRect };
}

function smaSeries(closes, period) {
  const out = new Array(closes.length).fill(null);
  let sum = 0, count = 0;
  const q = [];
  for (let i = 0; i < closes.length; i++) {
    const c = closes[i];
    if (c == null || !Number.isFinite(c)) { out[i] = null; continue; }
    q.push(c); sum += c; count++;
    if (q.length > period) { sum -= q.shift(); count--; }
    out[i] = q.length >= period ? sum / period : null;
  }
  return out;
}

// bars: oldest-first array of {c,h,l,v}. Returns a PNG Buffer, or null if the
// series is too short to draw.
export function renderPriceChartPng(bars, opts = {}) {
  if (!Array.isArray(bars) || bars.length < 2) return null;
  const width = opts.width || 960;
  const height = opts.height || 600;
  const padL = 8, padR = 8, padT = 10;
  const volH = 90;            // bottom volume strip
  const gap = 12;
  const priceTop = padT;
  const priceBot = height - volH - gap;
  const volTop = height - volH;
  const volBot = height - 8;
  const plotL = padL, plotR = width - padR;
  const plotW = plotR - plotL;

  const cv = makeCanvas(width, height);
  const COL = {
    grid: [230, 233, 237, 255],
    wick: [200, 208, 220, 255],
    close: [17, 20, 24, 255],
    sma50: [47, 109, 246, 255],
    sma200: [245, 166, 35, 255],
    spot: [208, 2, 27, 255],
    vol: [186, 196, 208, 255],
  };

  const closes = bars.map((b) => (b && Number.isFinite(b.c) ? b.c : null));
  const highs = bars.map((b) => (b && Number.isFinite(b.h) ? b.h : b && Number.isFinite(b.c) ? b.c : null));
  const lows = bars.map((b) => (b && Number.isFinite(b.l) ? b.l : b && Number.isFinite(b.c) ? b.c : null));
  const vols = bars.map((b) => (b && Number.isFinite(b.v) ? b.v : 0));

  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < bars.length; i++) {
    if (lows[i] != null && lows[i] < lo) lo = lows[i];
    if (highs[i] != null && highs[i] > hi) hi = highs[i];
  }
  if (opts.spot != null && Number.isFinite(opts.spot)) { lo = Math.min(lo, opts.spot); hi = Math.max(hi, opts.spot); }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return null;
  const padV = (hi - lo) * 0.04;
  lo -= padV; hi += padV;

  const n = bars.length;
  const xAt = (i) => plotL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yAt = (v) => priceBot - ((v - lo) / (hi - lo)) * (priceBot - priceTop);

  // horizontal gridlines
  for (let g = 0; g <= 4; g++) {
    const y = priceTop + (g / 4) * (priceBot - priceTop);
    cv.line(plotL, y, plotR, y, COL.grid, 1);
  }

  // high/low wicks (light range band per bar)
  for (let i = 0; i < n; i++) {
    if (highs[i] == null || lows[i] == null) continue;
    cv.vline(Math.round(xAt(i)), yAt(highs[i]), yAt(lows[i]), COL.wick);
  }

  // SMA overlays
  const drawSeries = (series, col, w) => {
    let prev = null;
    for (let i = 0; i < n; i++) {
      if (series[i] == null) { prev = null; continue; }
      if (prev != null) cv.line(xAt(i - 1), yAt(prev), xAt(i), yAt(series[i]), col, w);
      prev = series[i];
    }
  };
  // SMA overlays — first period in blue, second in orange. Caller sizes these
  // to the window (e.g. [20,50] for a zoomed ~75-session detector image, the
  // default [50,200] for a longer view).
  const smaPeriods = Array.isArray(opts.smaPeriods) && opts.smaPeriods.length ? opts.smaPeriods : [50, 200];
  const smaCols = [COL.sma50, COL.sma200];
  smaPeriods.slice(0, 2).forEach((p, i) => drawSeries(smaSeries(closes, p), smaCols[i] || COL.sma200, 2));

  // close-price line (on top, thick)
  drawSeries(closes, COL.close, 3);

  // current spot marker
  if (opts.spot != null && Number.isFinite(opts.spot)) {
    const ys = yAt(opts.spot);
    for (let x = plotL; x <= plotR; x += 8) cv.line(x, ys, Math.min(x + 4, plotR), ys, COL.spot, 1);
  }

  // volume strip
  let vMax = 0;
  for (const v of vols) if (v > vMax) vMax = v;
  if (vMax > 0) {
    const bw = Math.max(1, Math.floor(plotW / n) - 1);
    for (let i = 0; i < n; i++) {
      const h = (vols[i] / vMax) * (volBot - volTop);
      const x = Math.round(xAt(i));
      cv.fillRect(x - Math.floor(bw / 2), volBot - h, x + Math.ceil(bw / 2), volBot, COL.vol);
    }
  }

  return encodePng(width, height, cv.buf);
}

export default renderPriceChartPng;
