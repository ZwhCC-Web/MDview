/* ===== MDView Markdown parser (block-aware, incremental, cached, Typora/GFM-flavored) =====
   - parseAt(): parses one top-level block; splitBlocks() = full split; splitIncremental() re-splits
     only the changed line range of a previous result and re-uses all other blocks.
   - every block's HTML is memoised by type+source; context-dependent blocks are never cached. */
(function (global) {
  'use strict';

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const slugCount = {};
  const slugBase = new Map(), headCache = new Map();
  function slugRaw(t) {
    const s = t.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\w\u4e00-\u9fff\u3040-\u30ff\- ]+/g, '').trim().replace(/\s+/g, '-');
    return s || 'h';
  }
  function slugify(t) {
    let s = slugBase.get(t);
    if (s == null) { s = slugRaw(t); if (slugBase.size > 5000) slugBase.clear(); slugBase.set(t, s); }
    if (slugCount[s] !== undefined) { slugCount[s]++; s = s + '-' + slugCount[s]; } else slugCount[s] = 0;
    return s;
  }

  const EMOJI = { smile: '😄', grin: '😁', joy: '😂', laughing: '😆', blush: '😊', heart_eyes: '😍', sunglasses: '😎', heart: '❤️', broken_heart: '💔', '+1': '👍', thumbsup: '👍', '-1': '👎', thumbsdown: '👎', star: '⭐', fire: '🔥', rocket: '🚀', warning: '⚠️', check: '✔️', white_check_mark: '✅', heavy_check_mark: '✔️', x: '❌', no_entry: '⛔', bulb: '💡', memo: '📝', book: '📖', books: '📚', tada: '🎉', zap: '⚡', bug: '🐛', wrench: '🔧', hammer: '🔨', gear: '⚙️', eyes: '👀', ok_hand: '👌', clap: '👏', pray: '🙏', muscle: '💪', thinking: '🤔', sparkles: '✨', pushpin: '📌', paperclip: '📎', link: '🔗', lock: '🔒', key: '🔑', calendar: '📅', chart: '📈', chart_with_downwards_trend: '📉', bar_chart: '📊', car: '🚗', question: '❓', exclamation: '❗', point_right: '👉', point_left: '👈', smiley: '😃', wink: '😉', cry: '😢', sob: '😭', rage: '😡', coffee: '☕', computer: '💻', email: '📧', phone: '📱', battery: '🔋', electric_plug: '🔌', mag: '🔍', clipboard: '📋', file_folder: '📁', package: '📦', truck: '🚚', airplane: '✈️', hourglass: '⏳', alarm_clock: '⏰', red_circle: '🔴', green_circle: '🟢', yellow_circle: '🟡', arrow_right: '➡️', arrow_left: '⬅️', arrow_up: '⬆️', arrow_down: '⬇️', new: '🆕', 100: '💯', trophy: '🏆', target: '🎯', construction: '🚧', robot: '🤖', globe: '🌐', satellite: '🛰️', microscope: '🔬', test_tube: '🧪', brain: '🧠', jp: '🇯🇵', cn: '🇨🇳', us: '🇺🇸' };

  function newCtx() { return { refs: {}, footnotes: {}, fnOrder: [], headings: [], line: 0, wiki: [] }; }

  const RE = {
    fence: /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)?.*$/,
    heading: /^ {0,3}(#{1,6})(?:\s+(.*?))?\s*#*\s*$/,
    hr: /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/,
    quote: /^ {0,3}>/,
    list: /^(\s*)([-*+]|\d{1,9}[.)])(\s+|$)/,
    tableSep: /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/,
    mathOpen: /^\s*\$\$/,
    htmlBlock: /^ {0,3}<(\/?)(div|p|table|details|summary|section|center|pre|ul|ol|dl|figure|blockquote|h[1-6]|hr|iframe|video|audio|img|style|!--|br|span|font|a|kbd|sup|sub|picture|svg)\b/i,
    fnDef: /^\[\^([^\]]+)\]:\s?(.*)$/,
    refDef: /^ {0,3}\[([^\]^][^\]]*)\]:\s*<?(\S+?)>?(?:\s+["'(](.*)["')])?\s*$/,
    toc: /^\s*\[toc\]\s*$/i,
    setext: /^ {0,3}(=+|-+)\s*$/
  };
  const isBlank = l => !l || /^\s*$/.test(l);

  /* parse one block starting at line i (blank lines skipped). returns {type,start,end} or null at EOF */
  function parseAt(lines, i) {
    const n = lines.length;
    while (i < n && isBlank(lines[i])) i++;
    if (i >= n) return null;
    const l = lines[i];
    let m;
    const c0 = l.charCodeAt(l.search(/\S/));
    if ((c0 === 96 || c0 === 126) && (m = l.match(RE.fence))) {
      const fch = m[1][0], flen = m[1].length;
      const close = new RegExp('^ {0,3}' + (fch === '`' ? '`' : '~') + '{' + flen + ',}\\s*$');
      let j = i + 1;
      while (j < n && !close.test(lines[j])) j++;
      return { type: 'code', start: i, end: Math.min(j + 1, n) };
    }
    if (c0 === 36 && RE.mathOpen.test(l)) {
      const rest = l.replace(/^\s*\$\$/, '');
      if (/\$\$\s*$/.test(rest) && rest.trim().length > 2) return { type: 'math', start: i, end: i + 1 };
      let j = i + 1;
      while (j < n && !/\$\$\s*$/.test(lines[j])) j++;
      return { type: 'math', start: i, end: Math.min(j + 1, n) };
    }
    if (RE.toc.test(l)) return { type: 'toc', start: i, end: i + 1 };
    if (c0 === 35 && RE.heading.test(l)) return { type: 'heading', start: i, end: i + 1 };
    if (RE.hr.test(l)) return { type: 'hr', start: i, end: i + 1 };
    if (l.includes('|') && i + 1 < n && lines[i + 1].includes('-') && RE.tableSep.test(lines[i + 1])) {
      let j = i + 2;
      while (j < n && !isBlank(lines[j]) && lines[j].includes('|')) j++;
      return { type: 'table', start: i, end: j };
    }
    if (c0 === 62 && RE.quote.test(l)) {
      let j = i + 1;
      while (j < n && !isBlank(lines[j]) && (RE.quote.test(lines[j]) || !startsBlock(lines, j))) j++;
      return { type: 'quote', start: i, end: j };
    }
    if ((m = l.match(RE.list)) && m[1].length < 4) {
      let j = i + 1;
      while (j < n) {
        if (isBlank(lines[j])) {
          let k = j; while (k < n && isBlank(lines[k])) k++;
          if (k < n && (/^\s{2,}\S/.test(lines[k]) || RE.list.test(lines[k]) && lines[k].match(RE.list)[1].length < 4 && sameListType(l, lines[k]))) { j = k; continue; }
          break;
        }
        const lm = lines[j].match(RE.list);
        if (lm) { if (lm[1].length <= m[1].length + 1 && !sameListType(l, lines[j])) break; j++; continue; }
        if (/^\s+\S/.test(lines[j])) { j++; continue; }
        if (startsBlock(lines, j)) break;
        j++;
      }
      return { type: 'list', start: i, end: j };
    }
    if (c0 === 91 && RE.fnDef.test(l)) {
      let j = i + 1;
      while (j < n && /^\s{2,}\S/.test(lines[j])) j++;
      return { type: 'fndef', start: i, end: j };
    }
    if (c0 === 91 && RE.refDef.test(l)) return { type: 'refdef', start: i, end: i + 1 };
    if (c0 === 60 && RE.htmlBlock.test(l)) {
      let j = i + 1;
      if (/^\s*<!--/.test(l) && !/-->/.test(l)) { while (j < n && !/-->/.test(lines[j - 1])) j++; }
      else while (j < n && !isBlank(lines[j])) j++;
      return { type: 'html', start: i, end: j };
    }
    let j = i + 1, setext = false;
    while (j < n && !isBlank(lines[j])) {
      if (RE.setext.test(lines[j]) && !RE.list.test(lines[j])) { setext = true; j++; break; }
      if (startsBlock(lines, j)) break;
      j++;
    }
    return { type: setext ? 'setext' : 'para', start: i, end: j };
  }
  function sameListType(a, b) {
    const ma = a.match(RE.list), mb = b.match(RE.list);
    return !!(ma && mb) && (/\d/.test(ma[2]) === /\d/.test(mb[2]));
  }
  function startsBlock(lines, j) {
    const l = lines[j];
    const c = l.trimStart().charCodeAt(0);
    if (c === 96 || c === 126) return RE.fence.test(l);
    if (c === 35) return RE.heading.test(l);
    if (c === 62) return true;
    if (c === 36) return RE.mathOpen.test(l);
    if (c === 60) return RE.htmlBlock.test(l);
    if (c === 91) return RE.fnDef.test(l);
    return RE.hr.test(l) || (RE.list.test(l) && l.match(RE.list)[1].length < 4) ||
      (l.includes('|') && j + 1 < lines.length && lines[j + 1].includes('-') && RE.tableSep.test(lines[j + 1]));
  }
  function frontMatterEnd(lines) {
    if (lines[0] !== '---') return 0;
    for (let j = 1; j < lines.length; j++) if (lines[j] === '---' || lines[j] === '...') return j + 1;
    return 0;
  }
  function splitBlocks(src, linesIn) {
    const lines = linesIn || String(src).replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let i = frontMatterEnd(lines);
    if (i) blocks.push({ type: 'frontmatter', start: 0, end: i, lines: lines.slice(0, i) });
    let b;
    while ((b = parseAt(lines, i))) { b.lines = lines.slice(b.start, b.end); blocks.push(b); i = b.end; }
    return { blocks, lines };
  }
  /* re-split only the changed line range of a previous parse; returns null when a full split is needed */
  function splitIncremental(lines, prev) {
    const ol = prev.lines, ob = prev.raw;
    if (!ol || !ob || !ob.length) return null;
    let a = 0; const mn = Math.min(ol.length, lines.length);
    while (a < mn && ol[a] === lines[a]) a++;
    if (a === ol.length && a === lines.length) return { blocks: ob, lines };
    let bo = ol.length, bn = lines.length;
    while (bo > a && bn > a && ol[bo - 1] === lines[bn - 1]) { bo--; bn--; }
    const delta = bn - bo;
    let i0 = 0; while (i0 < ob.length && ob[i0].end <= a) i0++;
    i0 = Math.max(0, i0 - 1);
    if (i0 === 0 || ob[i0].type === 'frontmatter' || a < frontMatterEnd(ol) + 1) return null;
    const out = ob.slice(0, i0);
    const oldStart = new Map(); for (let k = i0; k < ob.length; k++) if (ob[k].start >= bo) oldStart.set(ob[k].start, k);
    let i = ob[i0].start, b;
    while ((b = parseAt(lines, i))) {
      if (b.start >= bn) {
        const k = oldStart.get(b.start - delta);
        if (k != null) {
          for (let q = k; q < ob.length; q++) { const o = ob[q]; out.push(delta ? { type: o.type, start: o.start + delta, end: o.end + delta, lines: o.lines, src: o.src, h: o.h, rs: o.rs, w: o.w } : o); }
          return { blocks: out, lines };
        }
      }
      b.lines = lines.slice(b.start, b.end); out.push(b); i = b.end;
    }
    return { blocks: out, lines };
  }

  const SAFE_TAGS = /^<\/?(br|span|kbd|u|sub|sup|mark|font|img|a|b|i|em|strong|del|s|small|big|center|div|p|abbr|ins|code|details|summary|video|audio|source|iframe|svg|path|figure|figcaption|table|tr|td|th|thead|tbody|ruby|rt|hr)\b[^>]*>/i;
  const isRemote = s => /^(https?:|data:|blob:|\/\/)/i.test(s);
  /* local images are emitted with a 1px placeholder; the app resolves data-src (relative, absolute, file://) */
  function imgTag(src, alt, title, extra) {
    const remote = isRemote(src);
    return '<img src="' + esc(remote ? src : PIXEL) + '" alt="' + esc(alt || '') + '"' + (title ? ' title="' + esc(title) + '"' : '') +
      ' data-src="' + esc(src) + '"' + (remote ? '' : ' class="img-pending"') + (extra || '') + ' loading="lazy">';
  }
  function imgDataSrc(t) {
    if (!/^<img\b/i.test(t) || /\sdata-src=/i.test(t)) return t;
    const m = t.match(/\ssrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i); if (!m) return t;
    const v = m[2] != null ? m[2] : m[3] != null ? m[3] : m[4];
    if (isRemote(v)) return t.replace(/\s*\/?>$/, ' data-src="' + esc(v) + '">');
    return t.replace(m[0], ' src="' + PIXEL + '"').replace(/\s*\/?>$/, ' data-src="' + esc(v) + '" class="img-pending">');
  }
  const IMG_RE = /!\[([^\]]*)\]\(\s*(<[^>\n]*>|[^\s)]+)(?:\s+["']([^"']*)["'])?\s*\)/g;
  const unAngle = s => s[0] === '<' ? s.slice(1, -1) : s;

  function inline(text, ctx) {
    const store = [];
    const keep = html => '\u0000' + (store.push(html) - 1) + '\u0000';
    let s = text;
    s = s.replace(/\\([\\`*_{}\[\]()#+\-.!|~$=^<>"])/g, (_, c) => keep(esc(c)));
    s = s.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, b, c) => keep('<code>' + esc(c.replace(/^ (.*) $/, '$1')) + '</code>'));
    if (s.includes('$')) s = s.replace(/(^|[^\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g, (_, p, m) => p + keep(renderMath(m, false)));
    if (s.includes('<')) {
      s = s.replace(/<((?:https?|ftp|mailto|file):[^\s>]+)>/g, (_, u) => keep('<a href="' + esc(u) + '">' + esc(u) + '</a>'));
      s = s.replace(/<!--[\s\S]*?-->/g, () => keep(''));
      s = s.replace(/<\/?[a-zA-Z][^>]*>/g, m => SAFE_TAGS.test(m) ? keep(sanitizeTag(m)) : m);
    }
    if (s.includes('[')) {
      s = s.replace(/\[\[([^\[\]\n|]+?)(?:\|([^\[\]\n]+))?\]\]/g, (_, t, a) => { ctx.wiki.push(t.trim()); return keep('<a class="wikilink" data-wiki="' + esc(t.trim()) + '" href="#">' + esc((a || t).trim()) + '</a>'); });
      s = s.replace(IMG_RE, (_, alt, src, t) => keep(imgTag(unAngle(src), alt, t)));
      s = s.replace(/!\[([^\]]*)\]\[([^\]]*)\]/g, (m, alt, r) => { const d = ctx.refs[(r || alt).toLowerCase()]; return d ? keep(imgTag(d.url, alt, d.title)) : m; });
      s = s.replace(/\[\^([^\]]+)\]/g, (_, id) => {
        if (!ctx.fnOrder.includes(id)) ctx.fnOrder.push(id);
        const k = ctx.fnOrder.indexOf(id) + 1;
        return keep('<sup class="fn-ref" id="fnref-' + esc(id) + '"><a href="#fn-' + esc(id) + '">[' + k + ']</a></sup>');
      });
      s = s.replace(/\[((?:[^\[\]]|\[[^\]]*\])*)\]\(\s*(<[^>\n]*>|[^\s)]*)(?:\s+["']([^"']*)["'])?\s*\)/g, (_, t, u, ti) =>
        keep('<a href="' + esc(unAngle(u)) + '"' + (ti ? ' title="' + esc(ti) + '"' : '') + '>') + t + keep('</a>'));
      s = s.replace(/\[([^\]]+)\]\[([^\]]*)\]/g, (m, t, r) => { const d = ctx.refs[(r || t).toLowerCase()]; return d ? keep('<a href="' + esc(d.url) + '">') + t + keep('</a>') : m; });
      s = s.replace(/\[([^\]\[]+)\](?![(\[:])/g, (m, t) => { const d = ctx.refs[t.toLowerCase()]; return d ? keep('<a href="' + esc(d.url) + '">') + t + keep('</a>') : m; });
    }
    if (s.includes('http') || s.includes('www.')) s = s.replace(/(^|[\s(（])((?:https?:\/\/|www\.)[^\s<>()（）\u0000]+[^\s<>()（）.,;:!?'"\u0000。，])/g, (_, p, u) => p + keep('<a href="' + esc(u.startsWith('www.') ? 'http://' + u : u) + '">' + esc(u) + '</a>'));
    if (s.includes('📅')) s = s.replace(/📅\s?(\d{4}-\d{2}-\d{2})/g, (_, d) => keep('<span class="due" data-due="' + d + '">📅 ' + d + '</span>'));
    s = s.replace(/&(?!#?\w+;)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (s.includes('*') || s.includes('_')) {
      s = s.replace(/(\*\*\*|___)(?=\S)([\s\S]*?\S)\1/g, '<strong><em>$2</em></strong>');
      s = s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>');
      s = s.replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>');
      s = s.replace(/\*(?=[^\s*])([\s\S]*?[^\s*])\*/g, '<em>$1</em>');
      s = s.replace(/(^|[^\w])_(?=[^\s_])([\s\S]*?[^\s_])_(?!\w)/g, '$1<em>$2</em>');
    }
    if (s.includes('~')) {
      s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
      s = s.replace(/(^|[^~])~(?=[^\s~])([^~\s]+)~(?!~)/g, '$1<sub>$2</sub>');
    }
    if (s.includes('==')) s = s.replace(/==(?=\S)([\s\S]*?\S)==/g, '<mark>$1</mark>');
    if (s.includes('^')) s = s.replace(/\^(?=[^\s^])([^^\s]+)\^/g, '<sup>$1</sup>');
    if (s.includes(':')) s = s.replace(/:([a-z0-9_+\-]+):/g, (m, k) => EMOJI[k] || m);
    s = s.replace(/( {2,}|\\)\n/g, '<br>\n');
    if (store.length) for (let k = 0; k < 3; k++) s = s.replace(/\u0000(\d+)\u0000/g, (_, d) => store[+d]);
    return s;
  }
  function sanitizeTag(t) { return imgDataSrc(t.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '').replace(/javascript:/gi, '')); }

  const mathCache = new Map();
  function renderMath(tex, display) {
    if (global.katex) {
      const key = (display ? 'D' : 'I') + tex;
      if (mathCache.has(key)) return mathCache.get(key);
      try {
        const h = global.katex.renderToString(tex, { displayMode: display, throwOnError: false, output: 'htmlAndMathml' });
        if (mathCache.size > 3000) mathCache.clear();
        mathCache.set(key, h); return h;
      } catch (e) { }
    }
    return display ? '<div class="math-fallback" data-tex="' + esc(tex) + '">$$' + esc(tex) + '$$</div>' : '<span class="math-fallback" data-tex="' + esc(tex) + '">$' + esc(tex) + '$</span>';
  }

  const LANG_ALIAS = { js: 'javascript', ts: 'typescript', py: 'python', sh: 'bash', shell: 'bash', zsh: 'bash', html: 'markup', xml: 'markup', svg: 'markup', 'c++': 'cpp', cs: 'csharp', 'c#': 'csharp', yml: 'yaml', md: 'markdown', ps: 'powershell', ps1: 'powershell', golang: 'go', rs: 'rust', m: 'matlab', h: 'c', hpp: 'cpp', cfg: 'ini', toml: 'toml', mk: 'makefile', asm: 'nasm', bat: 'batch', cmd: 'batch', v: 'verilog', sv: 'verilog', vhd: 'vhdl', tex: 'latex', dockerfile: 'docker', kt: 'kotlin', rb: 'ruby', proto: 'protobuf' };
  function highlight(code, lang) {
    lang = (lang || '').toLowerCase();
    const L = LANG_ALIAS[lang] || lang;
    if (global.Prism && L && global.Prism.languages[L]) {
      try { return global.Prism.highlight(code, global.Prism.languages[L], L); } catch (e) { }
    }
    return esc(code);
  }

  function renderBlock(b, ctx) {
    const L = b.lines;
    switch (b.type) {
      case 'frontmatter':
        return '<pre class="front-matter"><code>' + esc(L.slice(1, -1).join('\n')) + '</code></pre>';
      case 'code': {
        const m = L[0].match(RE.fence);
        const lang = (m[2] || '').trim();
        const closed = L.length > 1 && /^ {0,3}(`{3,}|~{3,})\s*$/.test(L[L.length - 1]);
        const code = L.slice(1, closed ? -1 : undefined).join('\n');
        if (/^mermaid$/i.test(lang)) return '<div class="mermaid-wrap"><div class="mermaid" data-code="' + esc(code) + '">' + esc(code) + '</div></div>';
        if (/^wavedrom$/i.test(lang)) return '<div class="wavedrom-wrap"><div class="wavedrom" data-code="' + esc(code) + '">' + esc(code) + '</div></div>';
        if (/^(math|katex|latex|tex)$/i.test(lang) && global.katex) return '<div class="math-block">' + renderMath(code, true) + '</div>';
        const n = code.split('\n').length;
        const gutter = '<span class="ln" aria-hidden="true">' + Array.from({ length: n }, (_, k) => k + 1).join('\n') + '</span>';
        return '<div class="code-wrap"><div class="code-head"><span class="code-lang">' + esc(lang || 'text') + '</span><button class="copy-btn" title="复制代码">复制</button></div><pre class="language-' + esc(LANG_ALIAS[lang.toLowerCase()] || lang || 'none') + '">' + gutter + '<code>' + highlight(code, lang) + '</code></pre></div>';
      }
      case 'math': {
        const t = L.join('\n').replace(/^\s*\$\$/, '').replace(/\$\$\s*$/, '');
        return '<div class="math-block">' + renderMath(t.trim(), true) + '</div>';
      }
      case 'toc': return '<div class="md-toc"></div>';
      case 'heading': {
        const m = L[0].match(RE.heading);
        const lv = m[1].length, txt = (m[2] || '');
        const id = slugify(txt);
        ctx.headings.push({ level: lv, text: txt.replace(/[*_`~=]/g, ''), id, line: ctx.line });
        const cacheable = txt.indexOf('[^') < 0 && !txt.includes('[[');
        let ih = cacheable ? headCache.get(txt) : null;
        if (ih == null) { ih = inline(txt, ctx); if (cacheable) { if (headCache.size > 5000) headCache.clear(); headCache.set(txt, ih); } }
        return '<h' + lv + ' id="' + id + '">' + ih + '</h' + lv + '>';
      }
      case 'setext': {
        const lv = /=/.test(L[L.length - 1]) ? 1 : 2;
        const txt = L.slice(0, -1).join(' ');
        const id = slugify(txt);
        ctx.headings.push({ level: lv, text: txt, id, line: ctx.line });
        return '<h' + lv + ' id="' + id + '">' + inline(txt, ctx) + '</h' + lv + '>';
      }
      case 'hr': return '<hr>';
      case 'table': return renderTable(L, ctx);
      case 'quote': return renderQuote(L, ctx);
      case 'list': return renderList(L, ctx);
      case 'fndef': return '';
      case 'refdef': return '';
      case 'html': return sanitizeHtml(L.join('\n'));
      default: {
        const t = L.join('\n');
        const only = /^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(t) || /^\s*<img\b[^>]*>\s*$/i.test(t);
        return '<p' + (only ? ' class="img-only"' : '') + '>' + inline(t, ctx) + '</p>';
      }
    }
  }
  function sanitizeHtml(h) { return h.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '').replace(/<img\b[^>]*>/gi, imgDataSrc); }
  function splitRow(r) {
    r = r.trim().replace(/^\|/, '').replace(/\|$/, '');
    const cells = []; let cur = '', inCode = false;
    for (let i = 0; i < r.length; i++) {
      const c = r[i];
      if (c === '\\' && r[i + 1] === '|') { cur += '\\|'; i++; continue; }
      if (c === '`') inCode = !inCode;
      if (c === '|' && !inCode) { cells.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    cells.push(cur.trim());
    return cells;
  }
  function renderTable(L, ctx) {
    const head = splitRow(L[0]);
    const aligns = splitRow(L[1]).map(c => /^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : /^:-+/.test(c) ? 'left' : '');
    const al = i => aligns[i] ? ' style="text-align:' + aligns[i] + '"' : '';
    const cell = c => inline(c.replace(/\\\|/g, '|'), ctx);
    let h = '<div class="table-wrap"><table><thead><tr>' + head.map((c, i) => '<th' + al(i) + '>' + cell(c) + '</th>').join('') + '</tr></thead><tbody>';
    for (const r of L.slice(2)) {
      const cells = splitRow(r);
      h += '<tr>' + head.map((_, i) => '<td' + al(i) + '>' + cell(cells[i] || '') + '</td>').join('') + '</tr>';
    }
    return h + '</tbody></table></div>';
  }
  const ALERT_ICON = { note: 'ℹ️', tip: '💡', important: '❗', warning: '⚠️', caution: '🛑' };
  function renderQuote(L, ctx) {
    const inner = L.map(l => l.replace(/^ {0,3}> ?/, '')).join('\n');
    const am = inner.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*([^\n]*)\n?/i);
    if (am) {
      const kind = am[1].toLowerCase();
      const title = am[2].trim() || kind[0].toUpperCase() + kind.slice(1);
      return '<blockquote class="alert alert-' + kind + '"><p class="alert-title"><span class="ai">' + ALERT_ICON[kind] + '</span>' + inline(title, ctx) + '</p>' + renderInner(inner.slice(am[0].length), ctx) + '</blockquote>';
    }
    return '<blockquote>' + renderInner(inner, ctx) + '</blockquote>';
  }
  function renderInner(src, ctx) { return splitBlocks(src).blocks.map(b => renderBlock(b, ctx)).join('\n'); }
  function renderList(L, ctx) {
    const first = L[0].match(RE.list);
    const baseIndent = first[1].length;
    const ordered = /\d/.test(first[2]);
    const items = [];
    let cur = null;
    for (const l of L) {
      const m = l.match(RE.list);
      if (m && m[1].length <= baseIndent + 1 && m[1].length >= baseIndent - 1) {
        const contentIndent = m[1].length + m[2].length + Math.min(m[3].length || 1, 4);
        cur = { lines: [l.slice(Math.min(contentIndent, l.length))], indent: contentIndent };
        items.push(cur);
      } else if (cur) {
        const ws = l.match(/^\s*/)[0].length;
        cur.lines.push(l.slice(Math.min(ws, cur.indent, l.length)));
      }
    }
    const loose = items.some(it => /\n\s*\n/.test(it.lines.join('\n').trim()));
    const start = ordered ? parseInt(first[2], 10) : 1;
    const tag = ordered ? 'ol' : 'ul';
    let isTask = false;
    const html = items.map(it => {
      let txt = it.lines.join('\n').replace(/\s+$/, '');
      let pre = '', cls = '';
      const tm = txt.match(/^\[([ xX])\](?:\s+|$)/);
      if (tm) {
        isTask = true; cls = ' class="task-item' + (tm[1] !== ' ' ? ' done' : '') + '"';
        pre = '<input type="checkbox" class="task-cb"' + (tm[1] !== ' ' ? ' checked' : '') + '> ';
        txt = txt.slice(tm[0].length);
      }
      const { blocks } = splitBlocks(txt);
      let inner;
      if (!loose && blocks.length && blocks[0].type === 'para') {
        inner = inline(blocks[0].lines.join('\n'), ctx) + blocks.slice(1).map(b => renderBlock(b, ctx)).join('');
      } else inner = blocks.map(b => renderBlock(b, ctx)).join('');
      if (pre && inner.startsWith('<p>')) inner = '<p>' + pre + inner.slice(3); else inner = pre + inner;
      return '<li' + cls + '>' + inner + '</li>';
    }).join('\n');
    return '<' + tag + (isTask ? ' class="task-list"' : '') + (ordered && start !== 1 ? ' start="' + start + '"' : '') + '>' + html + '</' + tag + '>';
  }
  function renderFootnotes(ctx) {
    if (!ctx.fnOrder.length) return '';
    return '<section class="footnotes"><hr><ol>' + ctx.fnOrder.map(id =>
      '<li id="fn-' + esc(id) + '">' + inline(ctx.footnotes[id] || '(未定义脚注)', ctx) + ' <a href="#fnref-' + esc(id) + '" class="fn-back">↩</a></li>').join('') + '</ol></section>';
  }
  function collectRefs(blocks, ctx) {
    for (const b of blocks) {
      if (b.type === 'refdef') { const m = b.lines[0].match(RE.refDef); ctx.refs[m[1].toLowerCase()] = { url: m[2], title: m[3] }; }
      if (b.type === 'fndef') { const m = b.lines[0].match(RE.fnDef); ctx.footnotes[m[1]] = [m[2]].concat(b.lines.slice(1).map(x => x.trim())).join('\n'); }
    }
  }
  function tocHtml(headings) {
    if (!headings.length) return '<div class="toc-empty">（无标题）</div>';
    const min = Math.min(...headings.map(h => h.level));
    return '<div class="toc-title">目录</div>' + headings.map(h => '<a class="toc-l' + (h.level - min + 1) + '" href="#' + h.id + '">' + esc(h.text) + '</a>').join('');
  }

  /* ---------- render with block cache ---------- */
  const cache = new Map();
  const stats = { hits: 0, misses: 0 };
  const NOCACHE_TYPES = { heading: 1, setext: 1, toc: 1, fndef: 1, refdef: 1 };
  const HAS_HEADING = /^\s*(?:>\s*)*#{1,6}\s/m;
  function render(src, opts) {
    for (const k in slugCount) delete slugCount[k];
    const ctx = newCtx();
    const lines = String(src).split('\n');
    const prev = opts && opts.prev;
    let sp = prev && !global.__MDV_NOCACHE ? splitIncremental(lines, prev) : null;
    if (!sp) sp = splitBlocks(src, lines);
    const blocks = sp.blocks;
    collectRefs(blocks, ctx);
    const useCache = !(opts && opts.noCache) && !global.__MDV_NOCACHE;
    const refSig = Object.keys(ctx.refs).length ? JSON.stringify(ctx.refs) + '\u0001' : '';
    const out = new Array(blocks.length);
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]; ctx.line = b.start;
      const src1 = b.src != null ? b.src : (b.src = b.lines.join('\n'));
      let html;
      const cacheable = useCache && !NOCACHE_TYPES[b.type] && src1.indexOf('[^') < 0 && !((b.type === 'quote' || b.type === 'list' || b.type === 'html') && HAS_HEADING.test(src1));
      if (cacheable) {
        if (b.h != null && b.rs === refSig) { html = b.h; if (b.w) ctx.wiki.push(...b.w); stats.hits++; }
        else {
          const key = b.type + '\u0002' + refSig + src1;
          let hit = cache.get(key);
          if (hit) { stats.hits++; if (hit.w) ctx.wiki.push(...hit.w); }
          else { const w0 = ctx.wiki.length; const h = renderBlock(b, ctx); hit = { h, w: ctx.wiki.length > w0 ? ctx.wiki.slice(w0) : null }; cache.set(key, hit); stats.misses++; }
          html = hit.h; b.h = html; b.rs = refSig; b.w = hit.w;
        }
      } else html = renderBlock(b, ctx);
      out[i] = { type: b.type, start: b.start, end: b.end, src: src1, html };
    }
    if (cache.size > 20000) cache.clear();
    let toc = null;
    for (const o of out) if (o.type === 'toc') o.html = '<div class="md-toc">' + (toc || (toc = tocHtml(ctx.headings))) + '</div>';
    const fn = renderFootnotes(ctx);
    return { blocks: out, raw: blocks, lines, headings: ctx.headings, wiki: ctx.wiki, footnotes: fn, get html() { return out.map(o => o.html).join('\n') + fn; } };
  }
  function clearCache() { cache.clear(); mathCache.clear(); headCache.clear(); }

  global.MD = { render, splitBlocks, splitRow, inline: t => inline(t, newCtx()), esc, EMOJI, clearCache, stats, PIXEL, isRemote };
})(typeof window !== 'undefined' ? window : globalThis);
