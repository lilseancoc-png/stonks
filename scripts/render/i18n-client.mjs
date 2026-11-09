// Site languages: English plus Simplified Chinese, Traditional Chinese,
// Japanese and Korean. The picker sits in the header settings next to the
// light / dark switch. Translations are static dictionaries in i18n/*.json
// (made once by scripts/i18n-build.mjs, no AI calls when a page is viewed):
// the browser fetches the one file for the chosen language, then swaps the
// page's English text for the dictionary text as the app draws it, and keeps
// doing so for everything the app draws later (a MutationObserver).
//
// What is translated: the site's own words (navigation, headings, labels,
// buttons, table headers, notes and guides). What stays in English: data
// written by sources or by the build (news headlines, company names, AI
// summaries), tickers, numbers, code, form input, and anything marked
// translate="no" or data-i18n-skip. A sentence the dictionary does not know
// stays in English, so a missing entry never blanks or breaks a page.
//
// Keys are the English text with runs of white space collapsed. A paragraph
// that mixes text with simple inline tags (<b>, <em>, <a>, …) is looked up
// as one unit, with each tag written <0>…</0>, <1>…</1> in the key, so a
// translation can reorder words around the bold or the link. Numbers are
// looked up a second time as {0}, {1}, … so "12 trades" and "40 trades"
// share one entry ("{0} trades").

export const I18N_LANGS = [
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'zh-CN', label: '简体中文', short: '简' },
  { code: 'zh-TW', label: '繁體中文', short: '繁' },
  { code: 'ja', label: '日本語', short: '日' },
  { code: 'ko', label: '한국어', short: '한' },
];

export const I18N_STORAGE_KEY = 'stonks-lang';

// Header picker, styled like the time zone control beside it.
export function i18nPickerHtml() {
  const options = I18N_LANGS.map((l) => `<option value="${l.code}" lang="${l.code}">${l.label}</option>`).join('');
  return `<label class="lang-control" title="Language" translate="no" data-i18n-skip>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>
        <span class="sr-only">Language</span>
        <select id="lang-select" aria-label="Language / 语言 / 語言 / 言語 / 언어">${options}</select>
      </label>`;
}

// Runs in <head> before first paint: sets <html lang> and, for a saved
// non-English choice, hides the page until the dictionary is applied (at
// most 2.5 seconds; app.js removes the class).
export function i18nHeadScript() {
  const codes = JSON.stringify(I18N_LANGS.map((l) => l.code));
  return `<script>/* Language: apply the saved choice before first paint. */try{var L=localStorage.getItem('${I18N_STORAGE_KEY}');if(L&&L!=='en'&&${codes}.indexOf(L)>0){document.documentElement.lang=L;document.documentElement.classList.add('i18n-wait');setTimeout(function(){document.documentElement.classList.remove('i18n-wait')},2500)}}catch(e){}</script>`;
}

export function renderI18nCss() {
  return `
/* Language picker (i18n-client.mjs) */
.lang-control { position: relative; display: inline-flex; align-items: center; gap: 4px; height: 36px; padding: 0 8px; border: 1px solid var(--border); border-radius: 8px; color: var(--muted); background: transparent; cursor: pointer; }
.lang-control:hover, .lang-control:focus-within { color: var(--text); border-color: var(--accent-line, var(--accent)); }
.lang-control svg { flex: 0 0 auto; }
.lang-control select { appearance: none; -webkit-appearance: none; border: 0; background: transparent; color: inherit; font: inherit; font-size: var(--t-12, 12px); padding: 0 2px; cursor: pointer; max-width: 92px; }
.lang-control select:focus { outline: none; }
.lang-control option { color: var(--text); background: var(--surface); }
.workspace-settings .lang-control { height: 44px; }
html.i18n-wait body { visibility: hidden; }
/* CJK text: keep the Latin fonts for Latin letters and numbers, then fall
   back to the platform's own Chinese, Japanese or Korean font. */
html:lang(zh-CN) { --font-sans: "Hanken Grotesk", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", "Noto Sans CJK SC", system-ui, sans-serif; --font-serif: "Fraunces", "Songti SC", "Noto Serif SC", "PingFang SC", "Microsoft YaHei", serif; }
html:lang(zh-TW) { --font-sans: "Hanken Grotesk", "PingFang TC", "Microsoft JhengHei", "Noto Sans TC", "Noto Sans CJK TC", system-ui, sans-serif; --font-serif: "Fraunces", "Songti TC", "Noto Serif TC", "PingFang TC", "Microsoft JhengHei", serif; }
html:lang(ja) { --font-sans: "Hanken Grotesk", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Meiryo", "Noto Sans JP", "Noto Sans CJK JP", system-ui, sans-serif; --font-serif: "Fraunces", "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", "Hiragino Sans", serif; }
html:lang(ko) { --font-sans: "Hanken Grotesk", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", "Noto Sans CJK KR", system-ui, sans-serif; --font-serif: "Fraunces", "AppleMyungjo", "Noto Serif KR", "Apple SD Gothic Neo", "Malgun Gothic", serif; }
html:lang(zh-CN) body, html:lang(zh-TW) body, html:lang(ja) body { word-break: normal; line-break: strict; }
html:lang(ko) body { word-break: keep-all; }
`;
}

// The browser half. Kept as a plain function so scripts/i18n-collect.mjs can
// run the very same key rules in a page to list the strings to translate.
export function i18nRuntime(win, doc, opts) {
  var LANGS = opts.langs;
  var KEY = opts.storageKey;
  var INLINE = { B: 1, STRONG: 1, I: 1, EM: 1, SMALL: 1, SUP: 1, SUB: 1, BR: 1, ABBR: 1, MARK: 1, U: 1, S: 1, Q: 1, CITE: 1, DFN: 1, TIME: 1, A: 1, SPAN: 1, KBD: 1, CODE: 1, VAR: 1, SAMP: 1, DEL: 1, INS: 1, WBR: 1 };
  // Whole subtrees left alone: code, form input, charts and anything marked.
  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, TEXTAREA: 1, INPUT: 1, PRE: 1, CODE: 1, KBD: 1, SAMP: 1, svg: 1, SVG: 1, CANVAS: 1, IFRAME: 1, VIDEO: 1, AUDIO: 1, MATH: 1 };
  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'data-tip', 'aria-description'];
  // Inline-tag markers (<0>, </0>, <0/>) pass through; numbers become {n}.
  var TOKEN = /(<\/?\d+\/?>)|[-+\u2212]?[$\u20ac\u00a3]?\d+(?:[.,:]\d+)*/g;
  var LETTERS = /[A-Za-z]{2}/;

  function saved() {
    var l = 'en';
    try { l = win.localStorage.getItem(KEY) || 'en'; } catch (_) {}
    for (var i = 0; i < LANGS.length; i++) if (LANGS[i] === l) return l;
    return 'en';
  }
  function norm(s) { return String(s).replace(/[\s ]+/g, ' ').trim(); }
  function skipEl(el) {
    if (SKIP[el.tagName]) return true;
    if (el.isContentEditable) return true;
    var t = el.getAttribute && el.getAttribute('translate');
    if (t === 'no') return true;
    if (el.hasAttribute && el.hasAttribute('data-i18n-skip')) return true;
    if (el.classList && el.classList.contains('notranslate')) return true;
    return false;
  }
  // Numbers out, placeholders in: "Up 3 of 5 days" -> "Up {0} of {1} days".
  function template(s) {
    var nums = [];
    var t = s.replace(TOKEN, function (m, tag) {
      if (tag) return m;
      nums.push(m); return '{' + (nums.length - 1) + '}';
    });
    return nums.length ? { key: t, nums: nums } : null;
  }
  function fill(s, nums) {
    return s.replace(/\{(\d+)\}/g, function (m, i) { return nums[+i] != null ? nums[+i] : m; });
  }

  var dict = null;
  var misses = null, scanning = false;
  function miss(k) { if (misses && LETTERS.test(k)) misses.set(k, (misses.get(k) || 0) + 1); }
  function look(s) {
    if (!LETTERS.test(s)) return null;
    if (dict && Object.prototype.hasOwnProperty.call(dict, s)) return dict[s];
    var t = template(s);
    if (t && dict && Object.prototype.hasOwnProperty.call(dict, t.key)) return fill(dict[t.key], t.nums);
    miss(t ? t.key : s);
    return null;
  }

  // An element is read as one unit when it holds text directly and every
  // child element is an inline tag. A child with only text inside is part of
  // the sentence (<0>bold words</0>); a child holding more markup, or with an
  // id, stays as it is and moves as a whole (<0/>), and is read on its own.
  function kindOf(n) {
    if (n.tagName === 'BR' || n.tagName === 'WBR') return 'br';
    if (skipEl(n) || n.id) return 'keep';
    for (var c = n.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && c.tagName !== 'BR' && c.tagName !== 'WBR') return 'keep';
    return 'text';
  }
  function unitOf(el) {
    var hasText = false, hasEl = false;
    for (var n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) { if (/\S/.test(n.data)) hasText = true; }
      else if (n.nodeType === 1) { if (!INLINE[n.tagName]) return null; hasEl = true; }
      else if (n.nodeType !== 8) return null;
    }
    if (!hasText || !hasEl) return null;
    var kids = [], kinds = [], s = '';
    for (var m = el.firstChild; m; m = m.nextSibling) {
      if (m.nodeType === 3) s += m.data;
      else if (m.nodeType === 1) {
        var i = kids.length, k = kindOf(m); kids.push(m); kinds.push(k);
        s += k === 'text' ? '<' + i + '>' + m.textContent + '</' + i + '>' : '<' + i + '/>';
      }
    }
    return { key: norm(s), kids: kids, kinds: kinds };
  }

  var MARK = '__stonksI18n';
  // Rebuild a unit from its translation, reusing the original inline
  // elements (their classes, links and listeners stay).
  function applyUnit(el, u, tr) {
    var frag = doc.createDocumentFragment();
    var re = /<(\d+)\/>|<(\d+)>([\s\S]*?)<\/\2>/g, last = 0, m, used = {};
    while ((m = re.exec(tr))) {
      if (m.index > last) frag.appendChild(doc.createTextNode(tr.slice(last, m.index)));
      var idx = +(m[1] != null ? m[1] : m[2]);
      var kid = u.kids[idx];
      if (kid && !used[idx]) {
        used[idx] = 1;
        if (m[3] != null && u.kinds[idx] === 'text') kid.textContent = m[3];
        frag.appendChild(kid);
      }
      last = re.lastIndex;
    }
    if (last < tr.length) frag.appendChild(doc.createTextNode(tr.slice(last)));
    // A tag the translation left out keeps its place at the end.
    for (var j = 0; j < u.kids.length; j++) if (!used[j] && u.kinds[j] === 'keep') frag.appendChild(u.kids[j]);
    var lead = /^\s/.test(el.textContent) ? ' ' : '';
    el.textContent = '';
    if (lead) el.appendChild(doc.createTextNode(lead));
    el.appendChild(frag);
    for (var q = 0; q < u.kids.length; q++) {
      if (u.kinds[q] === 'keep') walk(u.kids[q]); else if (u.kinds[q] === 'text') doAttrs(u.kids[q]);
    }
    el[MARK] = el.innerHTML;
  }

  function doText(n) {
    var raw = n.data;
    if (n[MARK] === raw) return;
    var k = norm(raw);
    if (!k) return;
    var tr = look(k);
    if (tr == null) { n[MARK] = raw; return; }
    var lead = raw.match(/^\s*/)[0], tail = raw.match(/\s*$/)[0];
    var out = (lead ? ' ' : '') + tr + (tail && tail !== raw ? ' ' : '');
    n.data = out;
    n[MARK] = out;
  }
  function doAttrs(el) {
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      if (!el.hasAttribute(a)) continue;
      var v = el.getAttribute(a), store = MARK + a;
      if (el[store] === v) continue;
      var tr = look(norm(v));
      if (tr != null) { el.setAttribute(a, tr); el[store] = tr; } else el[store] = v;
    }
  }
  function walk(el) {
    if (el.nodeType === 3) { if (el.parentNode && !insideSkip(el.parentNode)) doText(el); return; }
    if (el.nodeType !== 1 || skipEl(el)) return;
    doAttrs(el);
    if (el[MARK] != null && el[MARK] === el.innerHTML) return;
    var u = unitOf(el);
    if (u) {
      var tr = look(u.key);
      if (tr != null) { applyUnit(el, u, tr); return; }
      // Listing keys: the pieces of an unknown sentence are not keys.
      if (scanning) { for (var j = 0; j < u.kids.length; j++) if (u.kinds[j] === 'keep') walk(u.kids[j]); else doAttrs(u.kids[j]); return; }
    }
    for (var n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) doText(n);
      else if (n.nodeType === 1) walk(n);
    }
  }
  function insideSkip(el) {
    for (var p = el; p && p.nodeType === 1; p = p.parentNode) if (skipEl(p)) return true;
    return false;
  }

  function clearMarks(el) {
    el[MARK] = undefined;
    for (var i = 0; i < ATTRS.length; i++) el[MARK + ATTRS[i]] = undefined;
    for (var n = el.firstChild; n; n = n.nextSibling) { if (n.nodeType === 1) clearMarks(n); else if (n.nodeType === 3) n[MARK] = undefined; }
  }

  var observer = null, queue = [], scheduled = false;
  function flush() {
    scheduled = false;
    var list = queue; queue = [];
    if (observer) observer.disconnect();
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      if (!t.isConnected) continue;
      if (t.nodeType === 1 && insideSkip(t)) continue;
      walk(t);
    }
    if (doc.title && !doc[MARK + 'title']) { var tt = look(norm(doc.title)); if (tt) doc.title = tt; doc[MARK + 'title'] = 1; }
    if (observer) observe();
  }
  function enqueue(n) {
    queue.push(n);
    if (!scheduled) { scheduled = true; (win.requestAnimationFrame || win.setTimeout)(flush); }
  }
  function observe() {
    observer.observe(doc.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  function start(d) {
    dict = d || {};
    observer = new win.MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var r = records[i];
        if (r.type === 'childList') {
          for (var j = 0; j < r.addedNodes.length; j++) enqueue(r.addedNodes[j]);
          if (r.target.nodeType === 1 && unitOf(r.target)) enqueue(r.target);
        } else if (r.type === 'characterData') {
          var p = r.target.parentNode;
          enqueue(p && p.nodeType === 1 && unitOf(p) ? p : r.target);
        } else enqueue(r.target);
      }
    });
    queue.push(doc.body);
    flush();
  }

  var lang = opts.lang || saved();
  var api = {
    lang: lang,
    misses: function () { return misses ? Array.from(misses.entries()) : []; },
    // Collector entry point: walk with an empty dictionary to list keys.
    scan: function (root) {
      var keep = dict; dict = {}; misses = misses || new Map();
      clearMarks(root || doc.body); scanning = true; walk(root || doc.body); scanning = false; dict = keep;
      return api.misses();
    },
    start: start,
  };
  win.__stonksI18n = api;

  function done() { doc.documentElement.classList.remove('i18n-wait'); }
  function bindPicker() {
    var sel = doc.getElementById('lang-select');
    if (!sel) return;
    sel.value = lang;
    sel.addEventListener('change', function () {
      try { win.localStorage.setItem(KEY, sel.value); } catch (_) {}
      win.location.reload();
    });
  }
  // A split-view pane follows a language switch in the main window.
  win.addEventListener('storage', function (ev) { if (ev.key === KEY && (ev.newValue || 'en') !== lang) win.location.reload(); });

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', bindPicker); else bindPicker();
  if (lang === 'en') { done(); return api; }
  doc.documentElement.lang = lang;
  win.fetch(opts.base + lang + '.json?v=' + encodeURIComponent(opts.version || ''), { cache: 'default' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (d) {
      var go = function () { start(d && d.strings ? d.strings : d); done(); };
      if (doc.body) go(); else doc.addEventListener('DOMContentLoaded', go);
    })
    .catch(function () { done(); });
  return api;
}

// Inlined into app.js. The version string changes when any dictionary
// changes, so the browser never keeps a stale copy.
export function renderI18nJs(version = '') {
  const langs = JSON.stringify(I18N_LANGS.map((l) => l.code));
  return `
  // --- Site language (scripts/render/i18n-client.mjs) ----------------------
  (${i18nRuntime.toString()})(window, document, { langs: ${langs}, storageKey: '${I18N_STORAGE_KEY}', base: 'i18n/', version: ${JSON.stringify(version)} });
`;
}
