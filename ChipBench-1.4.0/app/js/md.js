/* ChipBench · md.js — Markdown → HTML (block cache, GFM, callouts, wiki links, widgets). DOM-free: runs in a Web Worker (P9). */
(function (G) {
  'use strict';
  const TKI = { '\uD83D\uDCC5': 'due', '⏳': 'plan', '✅': 'done', '⏰': 'time' }, TKT = { '\uD83D\uDCC5': '截止', '⏳': '计划', '✅': '完成', '⏰': '时间' };
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const WIDGETS = new Set(['mermaid', 'clocktree', 'clock-tree', 'structure', 'register', 'memmap', 'pinout', 'query', 'partdecode', 'board', 'chart', 'flow', 'hotspot', 'gcl', 'wavedrom', 'ipblock', 'scene']);
  const EMOJI = { smile: '😄', joy: '😂', heart: '❤️', '+1': '👍', star: '⭐', fire: '🔥', rocket: '🚀', warning: '⚠️', check: '✔️', white_check_mark: '✅', x: '❌', bulb: '💡', memo: '📝', book: '📖', tada: '🎉', zap: '⚡', bug: '🐛', wrench: '🔧', gear: '⚙️', eyes: '👀', sparkles: '✨', pushpin: '📌', link: '🔗', lock: '🔒', calendar: '📅', chart: '📈', car: '🚗', question: '❓', computer: '💻', email: '📧', battery: '🔋', mag: '🔍', package: '📦', truck: '🚚', hourglass: '⏳', arrow_right: '➡️', trophy: '🏆', target: '🎯', construction: '🚧', robot: '🤖', jp: '🇯🇵', cn: '🇨🇳', us: '🇺🇸' };
  const slugs = {}; const slug = t => { let s = t.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\w\u4e00-\u9fff\u3040-\u30ff\- ]+/g, '').trim().replace(/\s+/g, '-') || 'h'; if (slugs[s] !== undefined) { slugs[s]++; s += '-' + slugs[s]; } else slugs[s] = 0; return s; };
  const RE = { fence: /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)?.*$/, heading: /^ {0,3}(#{1,6})(?:\s+(.*?))?\s*#*\s*$/, hr: /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/, quote: /^ {0,3}>/, list: /^(\s*)([-*+]|\d{1,9}[.)])(\s+|$)/, sep: /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/, math: /^\s*\$\$/, html: /^ {0,3}<(\/?)(div|p|table|details|summary|section|center|pre|ul|ol|figure|blockquote|h[1-6]|hr|iframe|video|audio|img|style|!--|br|span|font|kbd|sup|sub|picture|svg)\b/i, fn: /^\[\^([^\]]+)\]:\s?(.*)$/, ref: /^ {0,3}\[([^\]^][^\]]*)\]:\s*<?(\S+?)>?(?:\s+["'(](.*)["')])?\s*$/, toc: /^\s*\[toc\]\s*$/i, setext: /^ {0,3}(=+|-+)\s*$/ };
  const blank = l => !l || /^\s*$/.test(l);
  function startsBlock(L, j) { const l = L[j], c = l.trimStart().charCodeAt(0); if (c === 96 || c === 126) return RE.fence.test(l); if (c === 35) return RE.heading.test(l); if (c === 62) return true; if (c === 36) return RE.math.test(l); if (c === 60) return RE.html.test(l); if (c === 91) return RE.fn.test(l); return RE.hr.test(l) || (RE.list.test(l) && l.match(RE.list)[1].length < 4) || (l.includes('|') && j + 1 < L.length && L[j + 1].includes('-') && RE.sep.test(L[j + 1])); }
  const sameList = (a, b) => { const x = a.match(RE.list), y = b.match(RE.list); return !!(x && y) && (/\d/.test(x[2]) === /\d/.test(y[2])); };
  function parseAt(L, i) {
    const n = L.length; while (i < n && blank(L[i])) i++; if (i >= n) return null; const l = L[i]; let m; const c0 = l.charCodeAt(l.search(/\S/));
    if ((c0 === 96 || c0 === 126) && (m = l.match(RE.fence))) { const close = new RegExp('^ {0,3}' + (m[1][0] === '`' ? '`' : '~') + '{' + m[1].length + ',}\\s*$'); let j = i + 1; while (j < n && !close.test(L[j])) j++; return { type: 'code', start: i, end: Math.min(j + 1, n) }; }
    if (c0 === 36 && RE.math.test(l)) { const rest = l.replace(/^\s*\$\$/, ''); if (/\$\$\s*$/.test(rest) && rest.trim().length > 2) return { type: 'math', start: i, end: i + 1 }; let j = i + 1; while (j < n && !/\$\$\s*$/.test(L[j])) j++; return { type: 'math', start: i, end: Math.min(j + 1, n) }; }
    if (RE.toc.test(l)) return { type: 'toc', start: i, end: i + 1 };
    if (c0 === 35 && RE.heading.test(l)) return { type: 'heading', start: i, end: i + 1 };
    if (RE.hr.test(l)) return { type: 'hr', start: i, end: i + 1 };
    if (l.includes('|') && i + 1 < n && L[i + 1].includes('-') && RE.sep.test(L[i + 1])) { let j = i + 2; while (j < n && !blank(L[j]) && L[j].includes('|')) j++; return { type: 'table', start: i, end: j }; }
    if (c0 === 62 && RE.quote.test(l)) { let j = i + 1; while (j < n && !blank(L[j]) && (RE.quote.test(L[j]) || !startsBlock(L, j))) j++; return { type: 'quote', start: i, end: j }; }
    if ((m = l.match(RE.list)) && m[1].length < 4) { let j = i + 1; while (j < n) { if (blank(L[j])) { let k = j; while (k < n && blank(L[k])) k++; if (k < n && (/^\s{2,}\S/.test(L[k]) || (RE.list.test(L[k]) && L[k].match(RE.list)[1].length < 4 && sameList(l, L[k])))) { j = k; continue; } break; } const lm = L[j].match(RE.list); if (lm) { if (lm[1].length <= m[1].length + 1 && !sameList(l, L[j])) break; j++; continue; } if (/^\s+\S/.test(L[j])) { j++; continue; } if (startsBlock(L, j)) break; j++; } return { type: 'list', start: i, end: j }; }
    if (c0 === 91 && RE.fn.test(l)) { let j = i + 1; while (j < n && /^\s{2,}\S/.test(L[j])) j++; return { type: 'fndef', start: i, end: j }; }
    if (c0 === 91 && RE.ref.test(l)) return { type: 'refdef', start: i, end: i + 1 };
    if (c0 === 60 && RE.html.test(l)) { let j = i + 1; if (/^\s*<!--/.test(l) && !/-->/.test(l)) { while (j < n && !/-->/.test(L[j - 1])) j++; } else while (j < n && !blank(L[j])) j++; return { type: 'html', start: i, end: j }; }
    let j = i + 1, st = false; while (j < n && !blank(L[j])) { if (RE.setext.test(L[j]) && !RE.list.test(L[j])) { st = true; j++; break; } if (startsBlock(L, j)) break; j++; } return { type: st ? 'setext' : 'para', start: i, end: j };
  }
  const fmEnd = L => { if (L[0] !== '---') return 0; for (let j = 1; j < L.length; j++) if (L[j] === '---' || L[j] === '...') return j + 1; return 0; };
  function split(src) { const L = String(src).replace(/\r\n?/g, '\n').split('\n'), out = []; let i = fmEnd(L); if (i) out.push({ type: 'frontmatter', start: 0, end: i, lines: L.slice(0, i) }); let b; while ((b = parseAt(L, i))) { b.lines = L.slice(b.start, b.end); out.push(b); i = b.end; } return { blocks: out, lines: L }; }
  const isRemote = s => /^(https?:|data:|blob:|\/\/)/i.test(s);
  const img = (src, alt, title) => { const r = isRemote(src); return '<img src="' + esc(r ? src : PIXEL) + '" alt="' + esc(alt || '') + '"' + (title ? ' title="' + esc(title) + '"' : '') + ' data-src="' + esc(src) + '"' + (r ? '' : ' class="img-pending"') + ' decoding="async" loading="lazy">'; };
  const unA = s => s[0] === '<' ? s.slice(1, -1) : s;
  const SAFE = /^<\/?(br|span|kbd|u|sub|sup|mark|font|img|a|b|i|em|strong|del|s|small|center|div|p|abbr|ins|code|details|summary|video|audio|source|figure|figcaption|table|tr|td|th|thead|tbody|hr)\b[^>]*>/i;
  const cleanTag = t => t.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '').replace(/javascript:/gi, '');
  function inline(text, ctx) {
    const st = []; const keep = h => '\u0000' + (st.push(h) - 1) + '\u0000'; let s = text;
    s = s.replace(/\\([\\`*_{}\[\]()#+\-.!|~$=^<>"])/g, (_, c) => keep(esc(c)));
    s = s.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, b, c) => keep('<code>' + esc(c.replace(/^ (.*) $/, '$1')) + '</code>'));
    if (s.includes('$')) s = s.replace(/(^|[^\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g, (_, p, m) => p + keep('<span class="math" data-tex="' + esc(m) + '">' + esc('$' + m + '$') + '</span>'));
    if (s.includes('<')) { s = s.replace(/<((?:https?|ftp|mailto|file):[^\s>]+)>/g, (_, u) => keep('<a href="' + esc(u) + '">' + esc(u) + '</a>')); s = s.replace(/<!--[\s\S]*?-->/g, () => keep('')); s = s.replace(/<\/?[a-zA-Z][^>]*>/g, m => SAFE.test(m) ? keep(cleanTag(m).replace(/^<img\b[^>]*>$/i, t => { const x = t.match(/\ssrc\s*=\s*("([^"]*)"|'([^']*)')/i); return x ? img(x[2] || x[3], (t.match(/\salt\s*=\s*"([^"]*)"/i) || [])[1]) : t; })) : m); }
    if (s.includes('[')) {
      s = s.replace(/\[\[([^\[\]\n|]+?)(?:\|([^\[\]\n]+))?\]\]/g, (_, t, a) => { ctx.wiki.push(t.trim()); return keep('<a class="wikilink" data-wiki="' + esc(t.trim()) + '" href="#">' + esc((a || t).trim()) + '</a>'); });
      s = s.replace(/!\[([^\]]*)\]\(\s*(<[^>\n]*>|[^\s)]+)(?:\s+["']([^"']*)["'])?\s*\)/g, (_, alt, src, t) => keep(img(unA(src), alt, t)));
      s = s.replace(/\[\^([^\]]+)\]/g, (_, id) => { if (!ctx.fnOrder.includes(id)) ctx.fnOrder.push(id); return keep('<sup class="fn-ref" id="fnref-' + esc(id) + '"><a href="#fn-' + esc(id) + '">[' + (ctx.fnOrder.indexOf(id) + 1) + ']</a></sup>'); });
      s = s.replace(/\[((?:[^\[\]]|\[[^\]]*\])*)\]\(\s*(<[^>\n]*>|[^\s)]*)(?:\s+["']([^"']*)["'])?\s*\)/g, (_, t, u, ti) => keep('<a href="' + esc(unA(u)) + '"' + (ti ? ' title="' + esc(ti) + '"' : '') + '>') + t + keep('</a>'));
      s = s.replace(/\[([^\]]+)\]\[([^\]]*)\]/g, (m, t, r) => { const d = ctx.refs[(r || t).toLowerCase()]; return d ? keep('<a href="' + esc(d.url) + '">') + t + keep('</a>') : m; });
    }
    if (s.includes('http') || s.includes('www.')) s = s.replace(/(^|[\s(（])((?:https?:\/\/|www\.)[^\s<>()（）\u0000]+[^\s<>()（）.,;:!?'"\u0000。，])/g, (_, p, u) => p + keep('<a href="' + esc(u.startsWith('www.') ? 'http://' + u : u) + '">' + esc(u) + '</a>'));
    s = s.replace(/(📅|⏳|✅)\s?(\d{4}-\d{2}-\d{2})/g, (_, i, d) => keep('<span class="due" data-due="' + d + '" data-k="' + i + '" title="' + (TKT[i] || '') + '"><i class="tki tki-' + (TKI[i] || 'due') + '"></i>' + d + '</span>')).replace(/(^|\s)~(\d+(?:\.\d+)?\s*(?:m|min|h|hr|d))\b/gi, (_, p, e) => p + keep('<span class="est">~' + esc(e) + '</span>')).replace(/⏰\s?(\d{1,2}:\d{2})/g, (_, t) => keep('<span class="due" data-k="⏰" title="时间"><i class="tki tki-time"></i>' + t + '</span>'));
    s = s.replace(/&(?!#?\w+;)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (s.includes('*') || s.includes('_')) { s = s.replace(/(\*\*\*|___)(?=\S)([\s\S]*?\S)\1/g, '<strong><em>$2</em></strong>').replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>').replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, '$1<strong>$2</strong>').replace(/\*(?=[^\s*])([\s\S]*?[^\s*])\*/g, '<em>$1</em>').replace(/(^|[^\w])_(?=[^\s_])([\s\S]*?[^\s_])_(?!\w)/g, '$1<em>$2</em>'); }
    if (s.includes('~')) s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>').replace(/(^|[^~])~(?=[^\s~])([^~\s]+)~(?!~)/g, '$1<sub>$2</sub>');
    if (s.includes('==')) s = s.replace(/==(?=\S)([\s\S]*?\S)==/g, '<mark>$1</mark>');
    if (s.includes('^')) s = s.replace(/\^(?=[^\s^])([^^\s]+)\^/g, '<sup>$1</sup>');
    if (s.includes(':')) s = s.replace(/:([a-z0-9_+\-]+):/g, (m, k) => EMOJI[k] || m);
    s = s.replace(/( {2,}|\\)\n/g, '<br>\n');
    if (st.length) for (let k = 0; k < 3; k++) s = s.replace(/\u0000(\d+)\u0000/g, (_, d) => st[+d]);
    return s;
  }
  const cache = new Map(); const stats = { hits: 0, misses: 0 };
  function renderBlock(b, ctx) {
    const L = b.lines; let m;
    switch (b.type) {
      case 'frontmatter': return '<div class="front-matter" data-fm="1">' + L.slice(1, -1).map(l => { const i = l.indexOf(':'); return i > 0 ? '<div class="fm-row"><span class="fm-k">' + esc(l.slice(0, i)) + '</span><span class="fm-v">' + esc(l.slice(i + 1).trim()) + '</span></div>' : ''; }).join('') + '</div>';
      case 'code': { m = L[0].match(RE.fence); const lang = (m[2] || '').trim(), lg = lang.toLowerCase(), closed = L.length > 1 && /^ {0,3}(`{3,}|~{3,})\s*$/.test(L[L.length - 1]), code = L.slice(1, closed ? -1 : undefined).join('\n'); if (WIDGETS.has(lg) && ctx.widgets) return '<div class="widget" data-w="' + esc(lg) + '" data-src="' + esc(code) + '" data-line="' + ctx.line + '"><pre class="widget-src">' + esc(code) + '</pre></div>'; if (/^(math|katex|latex|tex)$/.test(lg)) return '<div class="math-block" data-tex="' + esc(code) + '">' + esc('$$' + code + '$$') + '</div>'; return '<div class="code-wrap"><div class="code-head"><span class="code-lang">' + esc(lang || 'text') + '</span><button class="copy-btn" data-copy title="复制">复制</button></div><pre class="language-' + esc(lg || 'none') + '"><code data-lang="' + esc(lg) + '">' + esc(code) + '</code></pre></div>'; }
      case 'math': { const t = L.join('\n').replace(/^\s*\$\$/, '').replace(/\$\$\s*$/, ''); return '<div class="math-block" data-tex="' + esc(t.trim()) + '">' + esc('$$' + t + '$$') + '</div>'; }
      case 'toc': return '<div class="md-toc" data-toc="1"></div>';
      case 'heading': { m = L[0].match(RE.heading); const lv = m[1].length, tx = m[2] || '', id = slug(tx); ctx.heads.push({ level: lv, text: tx.replace(/[*_`~=]/g, ''), id, line: ctx.line }); return '<h' + lv + ' id="' + id + '">' + inline(tx, ctx) + '</h' + lv + '>'; }
      case 'setext': { const lv = /=/.test(L[L.length - 1]) ? 1 : 2, tx = L.slice(0, -1).join(' '), id = slug(tx); ctx.heads.push({ level: lv, text: tx, id, line: ctx.line }); return '<h' + lv + ' id="' + id + '">' + inline(tx, ctx) + '</h' + lv + '>'; }
      case 'hr': return '<hr>';
      case 'table': return table(L, ctx);
      case 'quote': return quote(L, ctx);
      case 'list': return list(L, ctx);
      case 'fndef': case 'refdef': return '';
      case 'html': return L.join('\n').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
      default: { const t = L.join('\n'); return '<p' + (/^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(t) ? ' class="img-only"' : '') + '>' + inline(t, ctx) + '</p>'; }
    }
  }
  function table(L, ctx) { const sp = r => { r = r.trim().replace(/^\|/, '').replace(/\|$/, ''); const c = []; let cur = '', code = false; for (let i = 0; i < r.length; i++) { const ch = r[i]; if (ch === '\\' && r[i + 1] === '|') { cur += '\\|'; i++; continue; } if (ch === '`') code = !code; if (ch === '|' && !code) { c.push(cur.trim()); cur = ''; continue; } cur += ch; } c.push(cur.trim()); return c; }; const head = sp(L[0]), al = sp(L[1]).map(c => /^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : /^:-+/.test(c) ? 'left' : ''), st = i => al[i] ? ' style="text-align:' + al[i] + '"' : '', cell = c => inline(c.replace(/\\\|/g, '|'), ctx); let h = '<div class="table-wrap"><table><thead><tr>' + head.map((c, i) => '<th' + st(i) + '>' + cell(c) + '</th>').join('') + '</tr></thead><tbody>'; for (const r of L.slice(2)) { const cs = sp(r); h += '<tr>' + head.map((_, i) => '<td' + st(i) + '>' + cell(cs[i] || '') + '</td>').join('') + '</tr>'; } return h + '</tbody></table></div>'; }
  const ICON = { note: 'ℹ️', tip: '💡', important: '❗', warning: '⚠️', caution: '🛑' };
  function quote(L, ctx) { const inner = L.map(l => l.replace(/^ {0,3}> ?/, '')).join('\n'), am = inner.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*([^\n]*)\n?/i); if (am) { const k = am[1].toLowerCase(), t = am[2].trim() || k[0].toUpperCase() + k.slice(1); return '<blockquote class="alert alert-' + k + '"><p class="alert-title"><span class="ai">' + ICON[k] + '</span>' + inline(t, ctx) + '</p>' + sub(inner.slice(am[0].length), ctx) + '</blockquote>'; } return '<blockquote>' + sub(inner, ctx) + '</blockquote>'; }
  const sub = (src, ctx) => split(src).blocks.map(b => renderBlock(b, ctx)).join('\n');
  function list(L, ctx) {
    const first = L[0].match(RE.list), bi = first[1].length, ord = /\d/.test(first[2]), items = []; let cur = null;
    for (const l of L) { const m = l.match(RE.list); if (m && m[1].length <= bi + 1 && m[1].length >= bi - 1) { const ci = m[1].length + m[2].length + Math.min(m[3].length || 1, 4); cur = { lines: [l.slice(Math.min(ci, l.length))], indent: ci }; items.push(cur); } else if (cur) { const ws = l.match(/^\s*/)[0].length; cur.lines.push(l.slice(Math.min(ws, cur.indent, l.length))); } }
    const loose = items.some(it => /\n\s*\n/.test(it.lines.join('\n').trim())); let task = false;
    const html = items.map(it => { let t = it.lines.join('\n').replace(/\s+$/, ''), pre = '', cls = ''; const tm = t.match(/^\[([ xX])\](?:\s+|$)/); if (tm) { task = true; cls = ' class="task-item' + (tm[1] !== ' ' ? ' done' : '') + '"'; pre = '<input type="checkbox" class="task-cb"' + (tm[1] !== ' ' ? ' checked' : '') + '> '; t = t.slice(tm[0].length); } const bl = split(t).blocks; let inn; if (!loose && bl.length && bl[0].type === 'para') inn = inline(bl[0].lines.join('\n'), ctx) + bl.slice(1).map(b => renderBlock(b, ctx)).join(''); else inn = bl.map(b => renderBlock(b, ctx)).join(''); if (pre && inn.startsWith('<p>')) inn = '<p>' + pre + inn.slice(3); else inn = pre + inn; return '<li' + cls + '>' + inn + '</li>'; }).join('\n');
    const tag = ord ? 'ol' : 'ul', start = ord ? parseInt(first[2], 10) : 1; return '<' + tag + (task ? ' class="task-list"' : '') + (ord && start !== 1 ? ' start="' + start + '"' : '') + '>' + html + '</' + tag + '>';
  }
  const NOCACHE = { heading: 1, setext: 1, toc: 1, fndef: 1, refdef: 1 }, HAS_H = /^\s*(?:>\s*)*#{1,6}\s/m;
  function render(src, opt) {
    opt = opt || {}; for (const k in slugs) delete slugs[k];
    const ctx = { refs: {}, fns: {}, fnOrder: [], heads: [], wiki: [], line: 0, widgets: opt.widgets !== false };
    const sp = split(src), blocks = sp.blocks;
    for (const b of blocks) { if (b.type === 'refdef') { const m = b.lines[0].match(RE.ref); ctx.refs[m[1].toLowerCase()] = { url: m[2], title: m[3] }; } if (b.type === 'fndef') { const m = b.lines[0].match(RE.fn); ctx.fns[m[1]] = [m[2]].concat(b.lines.slice(1).map(x => x.trim())).join('\n'); } }
    const refSig = Object.keys(ctx.refs).length ? JSON.stringify(ctx.refs) + '\u0001' : '', out = [];
    for (const b of blocks) {
      ctx.line = b.start; const s1 = b.lines.join('\n'); const cacheable = !NOCACHE[b.type] && s1.indexOf('[^') < 0 && !((b.type === 'quote' || b.type === 'list' || b.type === 'html') && HAS_H.test(s1)); let html;
      if (cacheable) { const key = b.type + '\u0002' + (ctx.widgets ? 'w' : 'n') + refSig + s1, h = cache.get(key); if (h) { stats.hits++; html = h.h; if (h.w) ctx.wiki.push(...h.w); } else { const w0 = ctx.wiki.length; html = renderBlock(b, ctx); cache.set(key, { h: html, w: ctx.wiki.length > w0 ? ctx.wiki.slice(w0) : null }); stats.misses++; } } else html = renderBlock(b, ctx);
      out.push({ type: b.type, start: b.start, end: b.end, html, src: b.type === 'code' || b.type === 'table' || b.type === 'frontmatter' ? s1 : undefined });
    }
    if (cache.size > 20000) cache.clear();
    const toc = ctx.heads.length ? (() => { const min = Math.min(...ctx.heads.map(h => h.level)); return '<div class="toc-title">目录</div>' + ctx.heads.map(h => '<a class="toc-l' + (h.level - min + 1) + '" href="#' + h.id + '">' + esc(h.text) + '</a>').join(''); })() : '';
    out.forEach(o => { if (o.type === 'toc') o.html = '<div class="md-toc">' + toc + '</div>'; });
    const fn = ctx.fnOrder.length ? '<section class="footnotes"><hr><ol>' + ctx.fnOrder.map(id => '<li id="fn-' + esc(id) + '">' + inline(ctx.fns[id] || '(未定义脚注)', ctx) + ' <a href="#fnref-' + esc(id) + '" class="fn-back">↩</a></li>').join('') + '</ol></section>' : '';
    const fmB = blocks.find(b => b.type === 'frontmatter');
    return { blocks: out, headings: ctx.heads, wiki: ctx.wiki, footnotes: fn, lines: sp.lines.length, hasFront: !!fmB };
  }
  const api = { render, split, inline: t => inline(t, { refs: {}, fns: {}, fnOrder: [], heads: [], wiki: [] }), esc, EMOJI, PIXEL, isRemote, stats, WIDGETS, clear: () => cache.clear() };
  G.ChipBenchMD = api; if (G.ChipBench) G.ChipBench.md = api; if (typeof module !== 'undefined') module.exports = api;
  /* worker glue: self.onmessage({id, src, widgets}) → postMessage({id, result}) */
  if (typeof WorkerGlobalScope !== 'undefined' && G instanceof WorkerGlobalScope) G.onmessage = e => { const d = e.data; try { G.postMessage({ id: d.id, result: render(d.src, { widgets: d.widgets }) }); } catch (err) { G.postMessage({ id: d.id, error: String(err) }); } };
})(typeof window !== 'undefined' ? window : globalThis);
