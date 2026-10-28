/* ChipBench · format-toolbar.js — fixed format toolbar for Markdown notes.
   Restores the heading-row editing tools of the early releases (heading menu, B/I/S/highlight/code/link/image, lists, tasks,
   quote, code block, math, table picker, alerts, insert menu, undo/redo, find, outline, present, save).
   The live / source / split / read switch already lives in #crumbs (#mode-seg) and is deliberately not duplicated here.
   It only drives the existing editor facade (SL.app.ed) and E.tools; it never touches CodeMirror internals. */
(function (G) {
  'use strict';
  const SL = G.ChipBench; if (!SL || !SL.app) { console.warn('[s31] toolbar: ChipBench not ready'); return; }
  const A = SL.app, d = document;
  const T = () => (SL.E && SL.E.tools) || {};
  const ed = () => A.ed;
  const isMd = () => { const t = A.current && A.current(); return !!(t && t.kind === 'md'); };

  const P = {
    bold: '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>', italic: '<path d="M14 5h-4M14 19h-4M15 5l-4 14"/>',
    mark: '<path d="M9 11l-4 4v3h3l4-4M9 11l6-6 4 4-6 6zM4 21h16"/>', code: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 4 3.5 3-2.5 4 3.5"/>',
    ul: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
    ol: '<path d="M10 6h10M10 12h10M10 18h10M4 5l1.5-1v4M4 14.5c0-1 2.5-1 2.5.3 0 .8-2.5 2-2.5 3.2h2.7"/>',
    task: '<rect x="4" y="4.5" width="5" height="5" rx="1.2"/><path d="M5 7.2l1 1 2-2.2M12 7h8M12 17h8"/><rect x="4" y="14.5" width="5" height="5" rx="1.2"/>',
    quote: '<path d="M6 17c-1.5 0-2.5-1-2.5-2.7 0-2.6 1.8-5 4.5-6M15 17c-1.5 0-2.5-1-2.5-2.7 0-2.6 1.8-5 4.5-6"/>',
    codeblock: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 10l-2 2 2 2M14.5 10l2 2-2 2"/>', sigma: '<path d="M18 5H6l6 7-6 7h12"/>',
    table: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M3.5 15h17M9.5 4.5v15M15 4.5v15"/>', hr: '<path d="M4 12h16M7 7h2M15 7h2M7 17h2M15 17h2"/>',
    undo: '<path d="M9 7L4 12l5 5M4 12h10a6 6 0 0 1 0 12"/>', redo: '<path d="M15 7l5 5-5 5M20 12H10a6 6 0 0 0 0 12"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.2-4.2"/>', play: '<path d="M7 5l12 7-12 7z"/>', plus: '<path d="M12 5v14M5 12h14"/>',
    save: '<path d="M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6"/>', outline: '<path d="M5 6h14M8 11h11M11 16h8"/>'
  };
  const ic = n => '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (P[n] || '') + '</svg>';

  const lineRange = e => { const a = e.lineAt(e.from), b = e.lineAt(e.to === e.from ? e.from : Math.max(e.from, e.to - 1)); return { a, b, n0: a.n, n1: b.n }; };
  const mapLines = (e, fn) => {
    const { a, b, n0, n1 } = lineRange(e), out = []; for (let n = n0; n <= n1; n++) out.push(e.line(n).text);
    const res = fn(out); if (!res) return false; const text = res.join('\n'); e.replace(a.from, b.to, text, a.from, a.from + text.length); return true;
  };
  const toggleList = (e, kind) => mapLines(e, lines => {
    const re = { ul: /^(\s*)([-*+])\s+(?!\[[ xX]\])/, ol: /^(\s*)\d+[.)]\s+/, task: /^(\s*)[-*+]\s+\[[ xX]\]\s+/ }[kind];
    const all = lines.filter(l => l.trim()).every(l => re.test(l)); let k = 0;
    return lines.map(l => {
      if (!l.trim()) return l;
      const stripped = l.replace(/^(\s*)(?:[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/, '$1'); if (all) return stripped;
      const ind = (stripped.match(/^\s*/) || [''])[0], body = stripped.slice(ind.length); k++;
      return ind + (kind === 'ul' ? '- ' : kind === 'task' ? '- [ ] ' : k + '. ') + body;
    });
  });
  const toggleQuote = e => mapLines(e, lines => { const all = lines.filter(l => l.trim()).every(l => /^\s*>\s?/.test(l)); return lines.map(l => all ? l.replace(/^(\s*)>\s?/, '$1') : '> ' + l); });
  const setHeading = (e, lv) => { const t = T(); return t.linePrefix ? t.linePrefix(e, lv ? '#'.repeat(lv) + ' ' : '') : false; };
  const headingOf = e => { const m = e.lineAt(e.head).text.match(/^(#{1,6})\s/); return m ? m[1].length : 0; };
  const codeBlock = (e, lang) => {
    const s = e.from, z = e.to, sel = e.slice(s, z), pre = s > 0 && e.slice(s - 1, s) !== '\n' ? '\n' : '', L = (lang || '').length;
    if (sel) { const txt = pre + '```' + (lang || '') + '\n' + sel + '\n```\n', p = s + pre.length + 3 + L + 1; e.replace(s, z, txt, p, p + sel.length); }
    else { const txt = pre + '```' + (lang || '') + '\n\n```\n'; e.replace(s, z, txt, s + pre.length + 3 + L + 1); }
    return true;
  };
  const mathBlock = e => { const s = e.from, z = e.to, sel = e.slice(s, z), pre = s > 0 && e.slice(s - 1, s) !== '\n' ? '\n' : ''; const txt = pre + '$$\n' + sel + '\n$$\n'; e.replace(s, z, txt, s + pre.length + 3, s + pre.length + 3 + sel.length); return true; };
  const alertBlock = (e, kind) => { const s = e.from, z = e.to, sel = e.slice(s, z) || '', pre = s > 0 && e.slice(s - 1, s) !== '\n' ? '\n' : ''; const body = sel.split('\n').map(l => '> ' + l).join('\n'); const txt = pre + '> [!' + kind + ']\n' + body + '\n'; e.replace(s, z, txt, s + txt.length - 1); return true; };
  const tableMd = (cols, rows) => { const hd = '| ' + Array.from({ length: cols }, (_, i) => '列' + (i + 1)).join(' | ') + ' |', sp = '| ' + Array(cols).fill('---').join(' | ') + ' |', ln = '| ' + Array(cols).fill('  ').join(' | ') + ' |'; return [hd, sp].concat(Array(Math.max(1, rows)).fill(ln)).join('\n'); };
  const inlineWrap = (e, a, b) => { const t = T(); return t.wrap ? t.wrap(e, a, b || a) : false; };
  const ancestors = e => { const names = new Set(); try { for (let n = e.treeNodeAt(e.head); n; n = n.parent) names.add(n.name); } catch (er) { } return names; };

  let menuEl = null;
  const closeMenu = () => { if (menuEl) { menuEl.remove(); menuEl = null; d.removeEventListener('mousedown', outside, true); d.removeEventListener('keydown', menuKey, true); } };
  const outside = ev => { if (menuEl && !menuEl.contains(ev.target) && !ev.target.closest('#fmtrow')) closeMenu(); };
  const menuKey = ev => { if (ev.key === 'Escape') { ev.preventDefault(); closeMenu(); } };
  const showMenu = (anchor, html, onPick) => {
    closeMenu(); const m = d.createElement('div'); m.className = 'fmt-menu'; m.innerHTML = html; d.body.appendChild(m); menuEl = m;
    const r = anchor.getBoundingClientRect(); m.style.left = Math.max(8, Math.min(innerWidth - m.offsetWidth - 8, r.left)) + 'px'; m.style.top = Math.min(innerHeight - m.offsetHeight - 8, r.bottom + 4) + 'px';
    m.addEventListener('mousedown', ev => ev.preventDefault());
    m.addEventListener('click', ev => { const it = ev.target.closest('[data-v]'); if (!it) return; onPick(it.dataset.v, ev); });
    d.addEventListener('mousedown', outside, true); d.addEventListener('keydown', menuKey, true); return m;
  };
  const mi = (v, label, k, cls, g) => '<div class="mi ' + (cls || '') + '" data-v="' + v + '">' + (g != null ? '<span class="g">' + g + '</span>' : '') + '<span>' + label + '</span>' + (k ? '<span class="k">' + k + '</span>' : '') + '</div>';
  const HEADS = [['0', '正文', 'Ctrl+0', ''], ['1', '标题 1', 'Ctrl+1', 'h1'], ['2', '标题 2', 'Ctrl+2', 'h2'], ['3', '标题 3', 'Ctrl+3', 'h3'], ['4', '标题 4', 'Ctrl+4', ''], ['5', '标题 5', 'Ctrl+5', ''], ['6', '标题 6', 'Ctrl+6', '']];
  const LANGS = ['c', 'cpp', 'python', 'bash', 'powershell', 'json', 'yaml', 'ini', 'verilog', 'asm', 'diff', 'markdown'];
  const ALERTS = [['NOTE', '注意（Note）'], ['TIP', '提示（Tip）'], ['IMPORTANT', '重要（Important）'], ['WARNING', '警告（Warning）'], ['CAUTION', '危险（Caution）']];
  const INSERTS = [['mermaid', '流程图（Mermaid）', '◇'], ['clocktree', '时钟树', '⏱'], ['structure', '结构图 / 数据流', '▣'], ['ipblock', 'IP 结构图（自动布局）', '▦'], ['register', '寄存器位域', '▤'], ['pinout', '引脚图', '⌗'], ['memmap', '内存占用图', '▥'], ['chart', '曲线图', '∿'], ['-', '', ''], ['details', '折叠块', '▸'], ['fn', '脚注', '¹'], ['toc', '目录 [TOC]', '☰'], ['hr', '分隔线 / 幻灯片分页', '—'], ['card', '学习卡片（Q / A）', '🧠'], ['date', '当前日期时间', '🕒'], ['wiki', '双链 [[笔记]]', '⟦']];

  const withEd = fn => () => { const e = ed(); if (!e || !isMd()) return; fn(e); e.focus(); setTimeout(refresh, 0); };
  const ACT = {
    bold: withEd(e => inlineWrap(e, '**')), italic: withEd(e => inlineWrap(e, '*')), strike: withEd(e => inlineWrap(e, '~~')), mark: withEd(e => inlineWrap(e, '==')), code: withEd(e => inlineWrap(e, '`')),
    link: withEd(e => T().link && T().link(e)), image: withEd(e => T().insertAt && T().insertAt(e, '![]()', 1)),
    ul: withEd(e => toggleList(e, 'ul')), ol: withEd(e => toggleList(e, 'ol')), task: withEd(e => toggleList(e, 'task')), quote: withEd(e => toggleQuote(e)),
    math: withEd(e => mathBlock(e)), hr: withEd(e => e.insert('\n---\n')),
    undo: () => { const e = ed(); if (e && e.cm && e.cm.undo) { e.cm.undo(e.view); e.focus(); } }, redo: () => { const e = ed(); if (e && e.cm && e.cm.redo) { e.cm.redo(e.view); e.focus(); } },
    find: () => A.openFind && A.openFind(false), present: () => SL.run && SL.run('present'), save: () => SL.run && SL.run('save'), outline: () => SL.panel && SL.panel('outline')
  };

  let row = null;
  const btn = (act, title, inner, cls) => '<button type="button" data-a="' + act + '" title="' + title + '"' + (cls ? ' class="' + cls + '"' : '') + '>' + inner + '</button>';
  const build = () => {
    if (row) return row;
    row = d.createElement('div'); row.id = 'fmtrow'; row.className = 'hide'; row.setAttribute('role', 'toolbar'); row.setAttribute('aria-label', '格式工具栏');
    row.innerHTML =
      '<div class="fg">' + btn('heading', '段落 / 标题（Ctrl+0…6）', '<span class="hl">正文</span>', 'hsel') + '</div>' +
      '<div class="fg">' + btn('bold', '粗体 (Ctrl+B)', '<b>B</b>') + btn('italic', '斜体 (Ctrl+I)', '<i>I</i>') + btn('strike', '删除线 (Ctrl+Shift+5)', '<s>S</s>') + btn('mark', '高亮 (Ctrl+Shift+H)', ic('mark')) + btn('code', '行内代码 (Ctrl+E)', ic('code')) + btn('link', '链接 (Ctrl+K)', ic('link')) + btn('image', '图片 (Ctrl+Shift+I)', ic('image')) + '</div>' +
      '<div class="fg">' + btn('ul', '无序列表', ic('ul')) + btn('ol', '有序列表', ic('ol')) + btn('task', '待办列表', ic('task')) + btn('quote', '引用 (Ctrl+Shift+Q)', ic('quote')) + '</div>' +
      '<div class="fg">' + btn('codeblock', '代码块 (Ctrl+Shift+K) — 点击右侧选语言', ic('codeblock')) + btn('math', '公式块 (Ctrl+Shift+M)', ic('sigma')) + btn('table', '表格（选择行列）', ic('table')) + btn('hr', '分隔线', ic('hr')) + btn('alert', '提示框', '<span>ⓘ</span>') + btn('insert', '插入更多…（图表 / 寄存器 / 时钟树…）', ic('plus') + '<span>插入</span>') + '</div>' +
      '<div class="fg">' + btn('undo', '撤销 (Ctrl+Z)', ic('undo')) + btn('redo', '重做 (Ctrl+Y)', ic('redo')) + btn('find', '查找 (Ctrl+F)', ic('search')) + '</div>' +
      '<div class="sp"></div>' +
      '<div class="fg">' + btn('outline', '大纲 (Ctrl+Shift+U)', ic('outline')) + btn('present', '演示幻灯片 (F5)', ic('play')) + btn('save', '保存 (Ctrl+S)', ic('save')) + '</div>';
    row.addEventListener('mousedown', ev => { if (ev.target.closest('button')) ev.preventDefault(); });
    row.addEventListener('click', onClick);
    const crumbs = d.getElementById('crumbs'), tabs = d.getElementById('tabs'), main = d.getElementById('main');
    if (crumbs) crumbs.insertAdjacentElement('afterend', row); else if (tabs) tabs.insertAdjacentElement('afterend', row); else if (main) main.prepend(row); else d.body.prepend(row);
    return row;
  };

  const onClick = ev => {
    const b = ev.target.closest('button[data-a]'); if (!b) return; const a = b.dataset.a;
    if (a === 'heading') return showMenu(b, HEADS.map(h => mi(h[0], h[1], h[2], h[3])).join(''), v => { closeMenu(); const e = ed(); if (e) { setHeading(e, +v); e.focus(); setTimeout(refresh, 0); } });
    if (a === 'codeblock') {
      const rect = b.getBoundingClientRect(), right = ev.clientX > rect.left + rect.width * .66; if (!right) return withEd(e => codeBlock(e, ''))();
      return showMenu(b, '<div class="mi" data-v="">无语言</div><hr>' + LANGS.map(l => '<div class="mi" data-v="' + l + '"><span>' + l + '</span></div>').join(''), v => { closeMenu(); withEd(e => codeBlock(e, v))(); });
    }
    if (a === 'alert') return showMenu(b, ALERTS.map(x => mi(x[0], x[1])).join(''), v => { closeMenu(); withEd(e => alertBlock(e, v))(); });
    if (a === 'table') return openGrid(b);
    if (a === 'insert') return showMenu(b, INSERTS.map(x => x[0] === '-' ? '<hr>' : mi(x[0], x[1], '', '', x[2])).join(''), v => {
      closeMenu(); const e = ed(); if (!e || !isMd()) return; const S = T().SNIP || {};
      if (v === 'date') e.insert(new Date().toISOString().slice(0, 10) + ' ' + new Date().toTimeString().slice(0, 5)); else if (v === 'wiki') e.insert('[[');
      else if (S[v]) e.insert('\n' + S[v] + '\n'); e.focus();
    });
    if (ACT[a]) ACT[a]();
  };

  const openGrid = anchor => {
    const R = 6, C = 8, cells = Array.from({ length: R * C }, (_, i) => '<i data-r="' + (Math.floor(i / C) + 1) + '" data-c="' + (i % C + 1) + '"></i>').join('');
    const m = showMenu(anchor, '<div class="fmt-grid">' + cells + '</div><div class="fmt-gridcap">选择表格大小</div>', () => { });
    const cap = m.querySelector('.fmt-gridcap'); let cur = [0, 0];
    m.addEventListener('mouseover', ev => { const c = ev.target.closest('i[data-r]'); if (!c) return; cur = [+c.dataset.c, +c.dataset.r]; m.querySelectorAll('i').forEach(x => x.classList.toggle('on', +x.dataset.c <= cur[0] && +x.dataset.r <= cur[1])); cap.textContent = cur[0] + ' 列 × ' + cur[1] + ' 行'; });
    m.addEventListener('click', ev => { const c = ev.target.closest('i[data-r]'); if (!c) return; closeMenu(); withEd(e => { const t = tableMd(+c.dataset.c, +c.dataset.r), s = e.from, pre = s > 0 && e.slice(s - 1, s) !== '\n' ? '\n\n' : ''; e.replace(e.from, e.to, pre + t + '\n', e.from + pre.length + 2); })(); });
  };

  let rq = 0;
  function refresh() {
    cancelAnimationFrame(rq); rq = requestAnimationFrame(() => {
      if (!row) return; const md = isMd(), e = ed(), mode = A.mode; row.classList.toggle('hide', !md); if (!md || !e) return;
      const ro = mode === 'read';
      row.querySelectorAll('button[data-a]').forEach(b => { if (!['find', 'present', 'save', 'outline', 'undo', 'redo'].includes(b.dataset.a)) b.disabled = ro; });
      if (ro) return;
      const names = ancestors(e), lv = headingOf(e), on = (a, v) => { const b = row.querySelector('[data-a="' + a + '"]'); if (b) b.classList.toggle('on', !!v); };
      on('bold', names.has('StrongEmphasis')); on('italic', names.has('Emphasis')); on('strike', names.has('Strikethrough')); on('code', names.has('InlineCode'));
      on('link', names.has('Link')); on('quote', names.has('Blockquote')); on('codeblock', names.has('FencedCode') || names.has('CodeBlock'));
      const li = e.lineAt(e.head).text; on('ul', /^\s*[-*+]\s+(?!\[[ xX]\])/.test(li)); on('ol', /^\s*\d+[.)]\s/.test(li)); on('task', /^\s*[-*+]\s+\[[ xX]\]\s/.test(li));
      const hl = row.querySelector('.hl'); if (hl) hl.textContent = lv ? '标题 ' + lv : '正文';
    });
  }
  const install = () => {
    build();
    SL.on && SL.on('tab', refresh); SL.on && SL.on('mode', refresh); let dT = 0; SL.on && SL.on('doc-change', () => { clearTimeout(dT); dT = setTimeout(refresh, 90); }); SL.on && SL.on('ready', refresh);
    d.addEventListener('selectionchange', refresh); 
    refresh();
  };
  SL.s31 = SL.s31 || {}; SL.s31.toolbar = { ACT, refresh, closeMenu, helpers: { toggleList, toggleQuote, setHeading, headingOf, codeBlock, mathBlock, alertBlock, tableMd } };
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', install); else install();
})(window);
