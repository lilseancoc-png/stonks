// One chart kit for the whole site. Every new time-series chart (stock price,
// rates, event paths, equity curves, compare lines) goes through CHART_KIT so
// they share one look: a crosshair with a value readout, the last value on the
// right axis, range buttons in the same place, a source line in the corner, a
// skeleton while loading and colours read from the site's theme tokens.
//
// The drawing library is TradingView Lightweight Charts (Apache-2.0), vendored
// in js/vendor and loaded on first use, so pages without a chart never fetch
// it and no outside script host is involved. Its small TradingView logo stays
// on (the licence asks for a visible link to tradingview.com).
//
// The returned string is pasted inside the app.js IIFE (ES5, no imports).

export const CHART_LIB = 'js/vendor/lightweight-charts-4.2.3.js';

export function renderChartKitJs() {
  return `
  var CHART_KIT = (function(){
    var LIB = '${CHART_LIB}';
    var libLoad = null;
    var live = [];
    function ready(){
      if (window.LightweightCharts) return Promise.resolve(window.LightweightCharts);
      if (libLoad) return libLoad;
      libLoad = new Promise(function(resolve, reject){
        var s = document.createElement('script');
        s.src = LIB;
        s.async = true;
        s.onload = function(){ window.LightweightCharts ? resolve(window.LightweightCharts) : reject(new Error('Chart tool did not load')); };
        s.onerror = function(){ libLoad = null; reject(new Error('Chart tool did not load')); };
        document.head.appendChild(s);
      });
      return libLoad;
    }
    function cssVar(name, fallback){
      try {
        var v = getComputedStyle(document.documentElement).getPropertyValue(name);
        v = v && v.trim();
        return v || fallback;
      } catch (_) { return fallback; }
    }
    // Colours come from the theme tokens, so light and dark stay in step.
    function colors(){
      var dark = document.documentElement.getAttribute('data-theme') !== 'light';
      return {
        text: cssVar('--muted', dark ? '#a1a1aa' : '#52525b'),
        strong: cssVar('--text', dark ? '#f4f4f5' : '#18181b'),
        grid: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
        border: cssVar('--border', dark ? '#27272a' : '#e4e4e7'),
        up: cssVar('--pos', '#16a34a'),
        down: cssVar('--neg', '#dc2626'),
        accent: cssVar('--accent', '#d4a017'),
        surface: cssVar('--surface', dark ? '#111113' : '#ffffff'),
        series: [cssVar('--accent', '#d4a017'), '#3b82f6', '#a855f7', '#14b8a6', '#f97316', '#ec4899'],
        font: cssVar('--font-sans', 'system-ui, sans-serif')
      };
    }
    function withAlpha(color, a){
      var c = String(color || '').trim();
      var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
      if (m){
        var h = m[1].length === 3 ? m[1].replace(/(.)/g, '$1$1') : m[1];
        return 'rgba(' + parseInt(h.slice(0,2),16) + ',' + parseInt(h.slice(2,4),16) + ',' + parseInt(h.slice(4,6),16) + ',' + a + ')';
      }
      var r = /^rgba?\\(([^)]+)\\)$/i.exec(c);
      if (r){ var p = r[1].split(','); return 'rgba(' + p[0] + ',' + p[1] + ',' + p[2] + ',' + a + ')'; }
      return c;
    }
    function baseOptions(c, opts){
      return {
        autoSize: true,
        layout: { background: { type: 'solid', color: 'transparent' }, textColor: c.text, fontFamily: c.font, fontSize: 12, attributionLogo: true },
        grid: { vertLines: { visible: false }, horzLines: { color: c.grid } },
        rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: opts.volume ? 0.24 : 0.08 } },
        leftPriceScale: { visible: false },
        timeScale: { borderVisible: false, timeVisible: !!opts.intraday, secondsVisible: false, fixLeftEdge: true, fixRightEdge: true, lockVisibleTimeRangeOnResize: true },
        crosshair: { mode: 1, vertLine: { color: withAlpha(c.strong, 0.35), labelBackgroundColor: c.border }, horzLine: { color: withAlpha(c.strong, 0.35), labelBackgroundColor: c.border } },
        handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
        handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: { time: true, price: false } },
        localization: { priceFormatter: opts.format || function(v){ return fmtAxis(v, opts); } }
      };
    }
    function fmtAxis(v, opts){
      if (v == null || !isFinite(v)) return '';
      if (opts && opts.percent) return (v > 0 && opts.signed ? '+' : '') + v.toFixed(Math.abs(v) >= 100 ? 0 : (opts.decimals != null ? opts.decimals : 1)) + '%';
      var d = opts && opts.decimals != null ? opts.decimals : (Math.abs(v) >= 1000 ? 0 : 2);
      return (opts && opts.prefix || '') + Number(v).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }) + (opts && opts.suffix || '');
    }
    // "2026-05-12 09:30" (exchange clock) -> seconds, shown as written.
    function toTime(t){
      if (typeof t === 'number') return t > 1e12 ? Math.floor(t / 1000) : t;
      var s = String(t || '');
      if (/^\\d{4}-\\d{2}-\\d{2}$/.test(s)) return s;
      var m = /^(\\d{4})-(\\d{2})-(\\d{2})[ T](\\d{2}):(\\d{2})/.exec(s);
      if (m) return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 1000);
      var d = Date.parse(s);
      return isFinite(d) ? Math.floor(d / 1000) : null;
    }
    function timeKey(t){ return typeof t === 'string' ? Date.parse(t + 'T00:00:00Z') / 1000 : t; }
    function clean(points){
      var out = [], seen = {};
      for (var i = 0; i < (points || []).length; i++){
        var p = points[i];
        if (!p) continue;
        var t = toTime(p.time);
        if (t == null) continue;
        var k = String(t);
        var row = { time: t };
        if (p.open != null){
          if (![p.open, p.high, p.low, p.close].every(function(v){ return v != null && isFinite(v); })) continue;
          row.open = +p.open; row.high = +p.high; row.low = +p.low; row.close = +p.close;
        } else {
          if (p.value == null || !isFinite(p.value)) continue;
          row.value = +p.value;
          if (p.color) row.color = p.color;
        }
        if (seen[k] != null) out[seen[k]] = row; else { seen[k] = out.length; out.push(row); }
      }
      out.sort(function(a, b){ return timeKey(a.time) - timeKey(b.time); });
      return out;
    }
    function rangeStart(key, lastKey){
      var d = new Date(lastKey * 1000);
      var day = 86400;
      if (key === '1D') return lastKey - day;
      if (key === '5D') return lastKey - 7 * day;
      if (key === '1M') return lastKey - 31 * day;
      if (key === '3M') return lastKey - 92 * day;
      if (key === '6M') return lastKey - 183 * day;
      if (key === 'YTD') return Date.UTC(d.getUTCFullYear(), 0, 1) / 1000;
      if (key === '1Y') return lastKey - 366 * day;
      if (key === '2Y') return lastKey - 731 * day;
      if (key === '5Y') return lastKey - 1827 * day;
      return null;
    }
    function skeleton(el, height){
      el.classList.add('ck-host');
      el.innerHTML = '<div class="ck-skeleton" style="height:' + (height || 320) + 'px" aria-hidden="true"></div>';
    }
    function emptyState(el, text){
      el.classList.add('ck-host');
      el.innerHTML = '<p class="ck-empty">' + escapeHtml(text || 'No chart data yet.') + '</p>';
    }
    // mount(el, opts) draws a chart into el and returns a handle.
    //   opts.series: [{ name, type: 'area'|'line'|'candles'|'histogram', data: [{time, value} | {time, open, high, low, close}], color }]
    //   opts.volume: [{ time, value, up }]   optional volume bars under the price
    //   opts.ranges: ['1M','3M','6M','YTD','1Y'], opts.range: default range key
    //   opts.height, opts.intraday, opts.percent, opts.signed, opts.decimals, opts.prefix
    //   opts.source: text for the bottom-left corner
    //   opts.markers: [{ time, text, color, position }] on the first series
    //   opts.bands: [{ value, color, title }] horizontal price lines on the first series
    function mount(el, opts){
      if (!el) return null;
      opts = opts || {};
      var height = opts.height || 320;
      if (!el.firstChild || !el.querySelector('.ck-canvas')) skeleton(el, height);
      var handle = { el: el, chart: null, series: [], destroyed: false, setRange: function(){}, destroy: function(){ handle.destroyed = true; } };
      var allSeries = (opts.series || []).filter(function(s){ return s && s.data && s.data.length; });
      if (!allSeries.length){ emptyState(el, opts.empty); return handle; }
      ready().then(function(LC){
        if (handle.destroyed) return;
        var c = colors();
        var ranges = opts.ranges || [];
        var html = '';
        if (ranges.length > 1 || opts.legend !== false){
          html += '<div class="ck-top">';
          html += '<div class="ck-legend" aria-live="off"></div>';
          if (ranges.length > 1){
            html += '<div class="ck-ranges" role="group" aria-label="Chart range">' + ranges.map(function(r){
              return '<button type="button" class="ck-range" data-ck-range="' + r + '" aria-pressed="false">' + r + '</button>';
            }).join('') + '</div>';
          }
          html += '</div>';
        }
        html += '<div class="ck-canvas" style="height:' + height + 'px"></div>';
        if (opts.source) html += '<p class="ck-source">' + escapeHtml(opts.source) + '</p>';
        el.innerHTML = html;
        var canvas = el.querySelector('.ck-canvas');
        var chart = LC.createChart(canvas, baseOptions(c, opts));
        handle.chart = chart;
        var made = [];
        allSeries.forEach(function(s, i){
          var col = s.color || c.series[i % c.series.length];
          var common = { priceLineVisible: i === 0 && opts.priceLine !== false, lastValueVisible: s.lastValue !== false, title: allSeries.length > 1 ? (s.short || '') : '' };
          var series;
          if (s.type === 'candles'){
            series = chart.addCandlestickSeries(Object.assign(common, { upColor: c.up, downColor: c.down, borderVisible: false, wickUpColor: c.up, wickDownColor: c.down }));
          } else if (s.type === 'histogram'){
            series = chart.addHistogramSeries(Object.assign(common, { color: col, priceLineVisible: false }));
          } else if (s.type === 'line'){
            series = chart.addLineSeries(Object.assign(common, { color: col, lineWidth: s.width || 2, lineStyle: s.dashed ? 2 : 0, crosshairMarkerRadius: 3 }));
          } else {
            series = chart.addAreaSeries(Object.assign(common, { lineColor: col, topColor: withAlpha(col, 0.22), bottomColor: withAlpha(col, 0.0), lineWidth: 2, crosshairMarkerRadius: 3 }));
          }
          series.setData(clean(s.data));
          made.push({ def: s, api: series, color: col });
        });
        handle.series = made;
        if (opts.volume && opts.volume.length){
          var vol = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'ck-vol', priceLineVisible: false, lastValueVisible: false });
          chart.priceScale('ck-vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
          vol.setData(clean(opts.volume.map(function(v){ return { time: v.time, value: v.value, color: withAlpha(v.up === false ? c.down : c.up, 0.35) }; })));
          handle.volume = vol;
        }
        if (made[0] && opts.markers && opts.markers.length){
          var mk = opts.markers.map(function(m){ return { time: toTime(m.time), position: m.position || 'aboveBar', color: m.color || c.accent, shape: m.shape || 'circle', text: m.text || '' }; })
            .filter(function(m){ return m.time != null; })
            .sort(function(a, b){ return timeKey(a.time) - timeKey(b.time); });
          try { made[0].api.setMarkers(mk); } catch (_) {}
        }
        if (made[0] && opts.bands){
          opts.bands.forEach(function(b){
            if (b == null || b.value == null || !isFinite(b.value)) return;
            made[0].api.createPriceLine({ price: b.value, color: b.color || c.border, lineWidth: 1, lineStyle: 2, axisLabelVisible: b.axis !== false, title: b.title || '' });
          });
        }
        // Readout: the hovered point, or the latest one when the pointer leaves.
        var legend = el.querySelector('.ck-legend');
        function valueText(v, def){
          if (v == null) return '—';
          if (v.close != null) return fmtAxis(v.close, opts);
          return (def && def.format) ? def.format(v.value) : fmtAxis(v.value, opts);
        }
        function timeText(t){
          if (t == null) return '';
          if (typeof t === 'string') return new Date(t + 'T12:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
          if (typeof t === 'object' && t.year) return new Date(Date.UTC(t.year, t.month - 1, t.day, 12)).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
          return new Date(t * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: opts.intraday ? 'numeric' : undefined, minute: opts.intraday ? '2-digit' : undefined, timeZone: 'UTC' });
        }
        function paintLegend(param){
          if (!legend) return;
          var parts = [];
          var t = param && param.time != null ? param.time : null;
          made.forEach(function(m){
            var data = m.api.data();
            var v = t != null && param.seriesData ? param.seriesData.get(m.api) : data[data.length - 1];
            if (t == null && data.length) t = data[data.length - 1].time;
            parts.push('<span class="ck-leg-item"><i style="background:' + m.color + '"></i>' + (made.length > 1 || m.def.name ? '<span>' + escapeHtml(m.def.name || '') + '</span> ' : '') + '<b>' + escapeHtml(valueText(v, m.def)) + '</b></span>');
          });
          legend.innerHTML = '<span class="ck-leg-time">' + escapeHtml(timeText(t)) + '</span>' + parts.join('');
        }
        chart.subscribeCrosshairMove(function(param){ paintLegend(param && param.time != null ? param : null); });
        paintLegend(null);
        // Ranges
        var firstData = made[0].api.data();
        var lastKey = firstData.length ? timeKey(firstData[firstData.length - 1].time) : null;
        handle.setRange = function(key){
          var from = lastKey != null ? rangeStart(key, lastKey) : null;
          if (from == null || key === 'All'){ chart.timeScale().fitContent(); }
          else {
            var to = lastKey;
            var fromT = from, toT = to;
            if (typeof firstData[0].time === 'string'){
              fromT = new Date(from * 1000).toISOString().slice(0, 10);
              toT = new Date(to * 1000).toISOString().slice(0, 10);
            }
            try { chart.timeScale().setVisibleRange({ from: fromT, to: toT }); } catch (_) { chart.timeScale().fitContent(); }
          }
          el.querySelectorAll('.ck-range').forEach(function(b){ b.setAttribute('aria-pressed', b.getAttribute('data-ck-range') === key ? 'true' : 'false'); });
          if (typeof opts.onRange === 'function') opts.onRange(key);
        };
        el.querySelectorAll('.ck-range').forEach(function(b){
          b.addEventListener('click', function(){ handle.setRange(b.getAttribute('data-ck-range')); });
        });
        if (opts.range) handle.setRange(opts.range); else chart.timeScale().fitContent();
        handle.destroy = function(){
          handle.destroyed = true;
          try { chart.remove(); } catch (_) {}
          live = live.filter(function(h){ return h !== handle; });
        };
        handle.restyle = function(){
          var nc = colors();
          chart.applyOptions({
            layout: { textColor: nc.text, fontFamily: nc.font },
            grid: { horzLines: { color: nc.grid } },
            crosshair: { vertLine: { color: withAlpha(nc.strong, 0.35), labelBackgroundColor: nc.border }, horzLine: { color: withAlpha(nc.strong, 0.35), labelBackgroundColor: nc.border } }
          });
          made.forEach(function(m){
            if (m.def.type === 'candles') m.api.applyOptions({ upColor: nc.up, downColor: nc.down, wickUpColor: nc.up, wickDownColor: nc.down });
          });
        };
        live.push(handle);
        if (typeof opts.onReady === 'function') opts.onReady(handle);
      }).catch(function(){
        if (!handle.destroyed) emptyState(el, 'The chart could not load. Check your connection and refresh.');
      });
      return handle;
    }
    // Theme switches restyle every chart on the page.
    try {
      new MutationObserver(function(){
        live = live.filter(function(h){ return h.el && document.body.contains(h.el); });
        live.forEach(function(h){ try { h.restyle && h.restyle(); } catch (_) {} });
      }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    } catch (_) {}
    return { ready: ready, mount: mount, colors: colors, withAlpha: withAlpha, skeleton: skeleton, empty: emptyState, toTime: toTime };
  })();
`;
}
