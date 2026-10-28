/* ChipBench · edit-tools.js — editing commands for the CodeMirror editor: formatting, lists/tables, auto-pair,
   "/" "[[" ":" completion, floating format bar, rich paste (HTML → Markdown). */
(function (G) {
  'use strict';
  const SL = G.ChipBench, U = SL.U, X = SL.X, E = SL.E, T = E.tools = {};
  const esc = U.esc, h = U.h, today = () => U.ymd(new Date());
  const ed = () => SL.app && SL.app.ed;
  /* ---------- basic commands on an Ed ---------- */
  T.wrap = (e, a, b) => { const s = e.from, z = e.to, sel = e.slice(s, z); if (sel.startsWith(a) && sel.endsWith(b) && sel.length >= a.length + b.length) { const inner = sel.slice(a.length, sel.length - b.length); e.replace(s, z, inner, s, s + inner.length); } else if (e.slice(s - a.length, s) === a && e.slice(z, z + b.length) === b) e.replace(s - a.length, z + b.length, sel, s - a.length, z - a.length); else e.replace(s, z, a + sel + b, s + a.length, s + a.length + sel.length); return true; };
  T.linePrefix = (e, pre) => { const l = e.lineAt(e.head), line = l.text.replace(/^#{1,6}\s+/, '').replace(/^>\s?/, ''); e.replace(l.from, l.to, pre + line, l.from + pre.length + line.length); return true; };
  T.link = e => { const s = e.from, z = e.to, sel = e.slice(s, z), u = /^https?:/.test(sel) ? sel : ''; e.replace(s, z, '[' + (u ? '' : sel) + '](' + u + ')', u ? s + 1 : s + sel.length + 3); return true; };
  T.insertAt = (e, text, back) => { e.insert(text); if (back) { const p = e.head - back; e.select(p); } return true; };
  const SNIP = {
    mermaid: '```mermaid\ngraph LR\n  A[开始] --> B{判断}\n  B -->|是| C[执行]\n  B -->|否| D[结束]\n```',
    clocktree: '```clocktree\ntitle: 时钟树\nsource: manual.pdf\nnodes:\n  - {id: mosc, label: Main OSC, kind: source, freq: 20MHz, page: 1}\n  - {id: pll, label: PLL, kind: pll, in: mosc, mul: 24, div: 1, max: 480MHz, page: 1}\n  - {id: cpu, label: CPU 时钟, kind: div, in: pll, div: 2, max: 240MHz, page: 1}\n  - {id: per, label: 外设时钟, kind: div, in: pll, div: 6, page: 1}\nderive:\n  - {clock: per, baud: 115200}\n  - {clock: per, can: 500kHz}\n```',
    structure: '```structure\ntitle: CAN 控制器结构\nsource: manual.pdf\nnodes:\n  - {id: pe, label: 协议引擎, page: 1}\n  - {id: flt, label: 接收过滤器, in: pe, page: 1}\n  - {id: fifo, label: 接收 FIFO, in: flt, page: 1}\n  - {id: irq, label: 中断, in: fifo, page: 1}\nflow:\n  - {node: pe, text: 收到一帧报文}\n  - {node: flt, text: 按 ID 过滤}\n  - {node: fifo, text: 存入 FIFO}\n  - {node: irq, text: 触发中断}\n```',
    register: '```register\nname: CTRL\naddress: 0x40000000\nwidth: 32\nreset: 0x0\nfields:\n  - {name: EN, bits: 0, access: RW, desc: 模块使能}\n  - {name: MODE, bits: "3:1", values: {0: 正常, 1: 回环}}\n  - {name: DIV, bits: "15:8"}\n```',
    pinout: '```pinout\npackage: LQFP32\n---\npin,name,func1,func2\n1,P0_0,CAN0TX,TAUD0O0\n2,P0_1,CAN0RX,TAUD0O1\n3,VCC,,\n4,VSS,,\n```',
    memmap: '```memmap\nregions:\n  - {name: FLASH, origin: 0x0, length: 0x100000}\n  - {name: RAM, origin: 0xFE000000, length: 0x40000}\nsections:\n  - {name: .text, addr: 0x0, size: 0x52000}\n  - {name: .data, addr: 0xFE000000, size: 0x4000}\n```',
    query: '```query\nfrom: all\nwhere: status = 调查中\nsort: due\nview: table\ncolumns: [title, customer, status, due]\n```',
    partdecode: '```partdecode\n- name: 示例系列\n  prefix: R7F\n  segments:\n    - {len: 3, name: 系列, map: {"701": U2A, "702": U2B}}\n    - {len: 1, name: 封装, map: {A: LQFP, B: BGA}}\n```',
    chart: '```chart\ntype: line\ntitle: 示例曲线\nx: [1, 2, 3, 4]\nseries:\n  - {name: A, y: [1, 3, 2, 5]}\n  - {name: B, y: [2, 2, 4, 3]}\n```',
    board: '```board\nfile: 系统框图.cbboard\n```',
    table: '| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n|  |  |  |', code: '```\n\n```', math: '$$\n\n$$', alert: '> [!NOTE]\n> ', details: '<details>\n<summary>点击展开</summary>\n\n内容\n\n</details>', toc: '[TOC]', hr: '---', fn: '[^1]\n\n[^1]: ', card: 'Q: 问题 p.1\nA: 答案\n'
  };
  T.SNIP = SNIP;
  const SLASH = [['H1', '一级标题', 'h1 biaoti bt', '# '], ['H2', '二级标题', 'h2 biaoti bt', '## '], ['H3', '三级标题', 'h3 biaoti bt', '### '], ['•', '无序列表', 'ul list liebiao lb', '- '], ['1.', '有序列表', 'ol list liebiao lb', '1. '], ['☐', '待办（今天计划）', 'task todo renwu daiban rw db', () => '- [ ]  ⏳ ' + today() + ' ~30m', 6], ['❝', '引用', 'quote yinyong yy', '> '], ['▦', '表格', 'table biaoge bg', SNIP.table, 2], ['{}', '代码块', 'code daima dm', SNIP.code, 4], ['∑', '公式块', 'math latex gongshi gs', SNIP.math, 3], ['◇', '流程图 Mermaid', 'mermaid flow liuchengtu lct', SNIP.mermaid], ['⏱', '时钟树', 'clock tree shizhong sz', SNIP.clocktree], ['▣', '结构图 / 数据流', 'structure diagram jiegou jg', SNIP.structure], ['▤', '寄存器位域', 'register reg jicunqi jcq', SNIP.register], ['⌗', '引脚图', 'pin pinout yinjiao yj', SNIP.pinout], ['▥', '内存占用图', 'memory map neicun nc', SNIP.memmap], ['⌕', '属性查询（表格/看板）', 'query dataview chaxun cx', SNIP.query], ['⌬', '料号解码', 'part decode liaohao lh', SNIP.partdecode], ['∿', '曲线图', 'chart line quxian qx', SNIP.chart], ['✎', '白板', 'board whiteboard baiban bb', SNIP.board], ['ℹ', '提示框 Note', 'note alert tishi ts', SNIP.alert], ['▸', '折叠块', 'details zhedie zd', SNIP.details], ['🖼', '图片', 'image img tupian tp', '![]()', 4], ['🔗', '链接', 'link lianjie lj', '[]()', 1], ['⟦', '双链 [[笔记]]', 'wiki shuanglian sl', '[[', 2], ['¹', '脚注', 'footnote jiaozhu jz', SNIP.fn], ['—', '分隔线 / 幻灯片分页', 'hr fengexian fgx slide', '---'], ['☰', '目录 TOC', 'toc mulu ml', '[TOC]'], ['🧠', '学习卡片', 'card flash xuexi xx', SNIP.card], ['🕒', '当前日期时间', 'date time riqi rq', () => today() + ' ' + new Date().toTimeString().slice(0, 5)], ['✨', 'AI 写作…', 'ai xiezuo', 'AI']];
  /* ---------- popups: slash / wiki / emoji ---------- */
  const acEl = h('div', { class: 'pop-ac' }); document.addEventListener('DOMContentLoaded', () => document.body.appendChild(acEl)); if (document.body) document.body.appendChild(acEl);
  const AC = T.AC = { open: false, list: [], sel: 0, kind: '', from: 0, to: 0 };
  T.acClose = () => { if (AC.open) { AC.open = false; acEl.classList.remove('show'); } };
  const acDraw = () => { acEl.innerHTML = '<div class="ah">' + { slash: '插入 · ↑↓ 选择 · Enter 确认', emoji: 'Emoji', wiki: '链接到笔记' }[AC.kind] + '</div>' + AC.list.map((it, i) => '<div class="it' + (i === AC.sel ? ' sel' : '') + '" data-i="' + i + '"><span class="ic">' + esc(it.ic) + '</span><span>' + esc(it.label) + '</span>' + (it.hint ? '<small>' + esc(it.hint) + '</small>' : '') + '</div>').join(''); const s = acEl.querySelector('.sel'); if (s) s.scrollIntoView({ block: 'nearest' }); };
  const acOpen = (e, kind, from, to, list) => { if (!list.length) return T.acClose(); Object.assign(AC, { open: true, list, sel: 0, kind, from, to }); acDraw(); const c = e.view.coordsAtPos(from) || e.view.coordsAtPos(Math.max(0, from - 1)) || { left: 100, top: 100, bottom: 120 }; acEl.classList.add('show'); const hh = acEl.offsetHeight, w = acEl.offsetWidth; let y = c.bottom + 4; if (y + hh > innerHeight - 8) y = c.top - hh - 4; acEl.style.left = Math.max(8, Math.min(innerWidth - w - 8, c.left)) + 'px'; acEl.style.top = Math.max(8, y) + 'px'; };
  T.acCheck = e => {
    if (!SL.prefs.slash || !e || !e.hasFocus || e.from !== e.to) return T.acClose(); const l = e.lineAt(e.head), before = l.text.slice(0, e.head - l.from); if (before.length > 80 || !/[\/\[:]/.test(before)) return T.acClose();
    const node = e.treeNodeAt(e.head); for (let n = node; n; n = n.parent) if (n.name === 'FencedCode' || n.name === 'InlineCode') return T.acClose(); let m;
    if ((m = before.match(/^\/([^\s\/]{0,12})$/))) { const q = m[1].toLowerCase(); return acOpen(e, 'slash', l.from, e.head, SLASH.filter(s => !q || s[2].includes(q) || s[1].toLowerCase().includes(q) || s[0].toLowerCase().includes(q)).map(s => ({ ic: s[0], label: s[1], hint: s[2].split(' ')[0], v: s }))); }
    if ((m = before.match(/\[\[([^\[\]|\n]{0,40})$/))) { const q = m[1].toLowerCase(), cands = (SL.wikiCandidates ? SL.wikiCandidates() : []), list = cands.map(n => { const f = U.fuzzy(q, n.name); return f ? Object.assign({}, n, { score: f.score }) : null; }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 15).map(n => ({ ic: '⟦', label: n.name, hint: n.sub || '', v: n.name })); if (!list.length && q) list.push({ ic: '⟦', label: m[1], hint: '新建链接', v: m[1] }); return acOpen(e, 'wiki', e.head - m[1].length, e.head, list); }
    if ((m = before.match(/(?:^|[\s(（，。,：:])(:([a-z0-9_+\-]{1,20}))$/)) && !/`[^`]*$/.test(before)) { const q = m[2], keys = Object.keys(SL.md.EMOJI), list = keys.filter(k => k.startsWith(q)).concat(keys.filter(k => !k.startsWith(q) && k.includes(q))).slice(0, 12); return acOpen(e, 'emoji', e.head - m[1].length, e.head, list.map(k => ({ ic: SL.md.EMOJI[k], label: ':' + k + ':', v: SL.md.EMOJI[k] }))); }
    T.acClose();
  };
  const acApply = i => {
    const it = AC.list[i], e = ed(); if (!it || !e) return; const { from, to, kind } = AC; T.acClose(); e.focus();
    if (kind === 'emoji') e.replace(from, to, it.v, from + it.v.length);
    else if (kind === 'wiki') { const close = e.slice(to, to + 2) === ']]' ? '' : ']]'; e.replace(from, to, it.v + close, from + it.v.length + 2); }
    else { const s = it.v; if (s[3] === 'AI') { e.replace(from, to, '', from); SL.run('ai.open'); return; } const x = typeof s[3] === 'function' ? s[3]() : s[3], c = from + (s[4] != null ? s[4] : x.length); e.replace(from, to, x, c); }
  };
  acEl.addEventListener('mousedown', ev => { ev.preventDefault(); const it = ev.target.closest('[data-i]'); if (it) acApply(+it.dataset.i); });
  const acKey = (ev) => { if (!AC.open) return false; if (ev.key === 'ArrowDown') { AC.sel = (AC.sel + 1) % AC.list.length; acDraw(); return true; } if (ev.key === 'ArrowUp') { AC.sel = (AC.sel - 1 + AC.list.length) % AC.list.length; acDraw(); return true; } if (ev.key === 'Enter' || ev.key === 'Tab') { acApply(AC.sel); return true; } if (ev.key === 'Escape') { T.acClose(); return true; } return false; };
  /* ---------- format bar ---------- */
  const fb = h('div', { class: 'fmt-bar' }, '<button data-f="b" title="粗体"><b>B</b></button><button data-f="i" title="斜体"><i>I</i></button><button data-f="s" title="删除线"><s>S</s></button><button data-f="h" title="高亮"><span style="background:var(--mark);padding:0 3px;border-radius:2px">H</span></button><button data-f="c" title="行内代码" style="font-family:var(--mono);font-size:12px">&lt;/&gt;</button><button data-f="k" title="链接">' + SL.icon('link') + '</button><button data-f="h2" title="二级标题">H2</button><button data-f="q" title="引用">❝</button><span class="sepv"></span><button data-f="ai" title="AI 处理选中文字" style="color:var(--brand);font-weight:600">' + SL.icon('ai') + 'AI</button>');
  if (document.body) document.body.appendChild(fb); else document.addEventListener('DOMContentLoaded', () => document.body.appendChild(fb));
  T.fmtCheck = e => { if (!e || e.from === e.to || !e.hasFocus || SL.prefs.mode === 'read') { fb.classList.remove('show'); return; } const n = e.treeNodeAt(e.from); for (let x = n; x; x = x.parent) if (x.name === 'FencedCode') { fb.classList.remove('show'); return; } const c = e.view.coordsAtPos(e.from); if (!c) return; fb.classList.add('show'); const w = fb.offsetWidth; let y = c.top - 44; if (y < 48) y = c.bottom + 8; fb.style.left = Math.max(8, Math.min(innerWidth - w - 8, c.left - 12)) + 'px'; fb.style.top = y + 'px'; };
  T.fmtHide = () => fb.classList.remove('show');
  fb.addEventListener('mousedown', ev => ev.preventDefault());
  fb.addEventListener('click', ev => { const b = ev.target.closest('button'), e = ed(); if (!b || !e) return; const a = b.dataset.f, map = { b: ['**', '**'], i: ['*', '*'], s: ['~~', '~~'], c: ['`', '`'], h: ['==', '=='] }; if (a === 'ai') { fb.classList.remove('show'); SL.run('ai.open'); return; } if (map[a]) T.wrap(e, ...map[a]); else if (a === 'k') T.link(e); else if (a === 'h2') T.linePrefix(e, '## '); else if (a === 'q') T.linePrefix(e, '> '); setTimeout(() => T.fmtCheck(e), 0); });
  /* ---------- tables ---------- */
  T.tableAt = e => { let n = e.treeNodeAt(e.head); for (; n; n = n.parent) if (n.name === 'Table') return { from: n.from, to: n.to, text: e.slice(n.from, n.to) }; return null; };
  const tablePos = (text, p) => { const lines = text.slice(0, p).split('\n'), li = lines.length - 1, before = lines[li].replace(/\\\|/g, '__'), col = Math.max(0, (before.match(/\|/g) || []).length - (/^\s*\|/.test(before) ? 1 : 0)), ne = text.split('\n').slice(0, li).filter(l => l.trim()).length; return { row: ne === 0 ? 0 : ne === 1 ? -1 : ne - 1, col }; };
  const caretToCell = (text, row, col) => { const lines = text.split('\n'), li = Math.min(row === 0 ? 0 : row + 1, lines.length - 1); let off = 0; for (let k = 0; k < li; k++) off += lines[k].length + 1; const l = lines[li] || ''; let cnt = 0, k = 0; for (; k < l.length; k++) { if (l[k] === '|' && l[k - 1] !== '\\') { if (cnt === col) break; cnt++; } } return off + Math.min(l.length, k + 2); };
  T.tableOp = (e, op) => {
    const tb = T.tableAt(e); if (!tb) return SL.toast('光标不在表格中'); const t = X.parseMdTable(tb.text); let { row, col } = tablePos(tb.text, e.head - tb.from); if (row < 0) row = 0; col = Math.min(col, t.n - 1); const blank = () => Array(t.n).fill('');
    switch (op) {
      case 'row-above': row = Math.max(1, row); t.rows.splice(row, 0, blank()); break; case 'row-below': t.rows.splice(row + 1, 0, blank()); row++; break;
      case 'col-left': t.rows.forEach(r => r.splice(col, 0, '')); t.aligns.splice(col, 0, ''); t.n++; break; case 'col-right': t.rows.forEach(r => r.splice(col + 1, 0, '')); t.aligns.splice(col + 1, 0, ''); t.n++; col++; break;
      case 'del-row': if (row === 0) return SL.toast('表头行不能删除'); if (t.rows.length <= 2) return SL.toast('至少保留一行数据'); t.rows.splice(row, 1); row = Math.min(row, t.rows.length - 1); break;
      case 'del-col': if (t.n <= 1) return SL.toast('至少保留一列'); t.rows.forEach(r => r.splice(col, 1)); t.aligns.splice(col, 1); t.n--; col = Math.min(col, t.n - 1); break;
      case 'al-left': t.aligns[col] = 'l'; break; case 'al-center': t.aligns[col] = 'c'; break; case 'al-right': t.aligns[col] = 'r'; break;
      case 'sort': { const body = t.rows.slice(1), num = body.every(r => !r[col] || !isNaN(parseFloat(r[col].replace(/[, ]/g, '')))); body.sort((a, b) => num ? parseFloat(a[col].replace(/[, ]/g, '') || 0) - parseFloat(b[col].replace(/[, ]/g, '') || 0) : (a[col] || '').localeCompare(b[col] || '', 'zh-CN', { numeric: true })); t.rows = [t.rows[0]].concat(body); SL.toast('已按第 ' + (col + 1) + ' 列排序'); break; }
      case 'tsv': return navigator.clipboard.writeText(t.rows.map(r => r.map(c => c.replace(/\\\|/g, '|').replace(/\t/g, ' ')).join('\t')).join('\r\n')).then(() => SL.toast('已复制，可直接粘贴到 Excel'));
      case 'calc': { const r = X.evalTable(tb.text); if (!r.changed) return SL.toast('表格中没有以 = 开头的公式'); e.replace(tb.from, tb.to, X.buildMdTable({ rows: r.rows, aligns: r.aligns, n: t.n }), tb.from + caretToCell(X.buildMdTable({ rows: r.rows, aligns: r.aligns, n: t.n }), row, col)); return SL.toast('公式已计算（原公式在撤销历史中）'); }
      default: break;
    }
    const out = X.buildMdTable(t); e.replace(tb.from, tb.to, out, tb.from + caretToCell(out, row, col));
  };
  T.tableTab = (e, back) => { const tb = T.tableAt(e); if (!tb) return false; const t = X.parseMdTable(tb.text); let { row, col } = tablePos(tb.text, e.head - tb.from); if (row < 0) row = 0; col += back ? -1 : 1; if (col >= t.n) { col = 0; row++; } if (col < 0) { col = t.n - 1; row = Math.max(0, row - 1); } if (row >= t.rows.length) t.rows.push(Array(t.n).fill('')); const out = X.buildMdTable(t); e.replace(tb.from, tb.to, out, tb.from + caretToCell(out, row, col)); return true; };
  /* ---------- keymap ---------- */
  const inFence = (e, pos) => { for (let n = e.treeNodeAt(pos); n; n = n.parent) if (n.name === 'FencedCode' || n.name === 'CodeBlock') return true; return false; };
  T.keymap = () => {
    const E_ = () => ed(); const run = fn => v => { const e = E_(); return e ? fn(e) : false; };
    return [
      { key: 'Enter', run: run(e => { if (acKey({ key: 'Enter' })) return true; const l = e.lineAt(e.head), p = e.head; if (e.from !== e.to) return false;
        const fm = l.text.match(/^(\s*)(`{3,}|~{3,})([\w+#.-]*)\s*$/); if (fm && p === l.to && ((e.slice(0, l.from).match(/^\s*(```|~~~)/gm) || []).length % 2) === 0) { e.replace(p, p, '\n\n' + fm[1] + fm[2], p + 1); return true; }
        if (/^\s*\$\$\s*$/.test(l.text) && p === l.to && ((e.slice(0, l.from).match(/^\s*\$\$\s*$/gm) || []).length % 2) === 0) { e.replace(p, p, '\n\n$$', p + 1); return true; }
        const tb = T.tableAt(e); if (tb && /^\s*\|/.test(l.text)) { const cols = Math.max(1, X.splitRow(tb.text.split('\n')[0]).length); if (/^\|(\s*\|)+\s*$/.test(l.text.trim()) && l.to === tb.to) { e.replace(l.from - 1, l.to, '\n', l.from); return true; } e.replace(l.to, l.to, '\n|' + '  |'.repeat(cols), l.to + 3); return true; }
        return false; }) },
      { key: 'Tab', run: run(e => { if (acKey({ key: 'Tab' })) return true; if (T.tableTab(e, false)) return true; const l = e.lineAt(e.head); if (/^\s*([-*+]|\d+[.)])\s/.test(l.text) || e.from !== e.to) return E.cm.cm.indentMore(e.view); e.insert('    '); return true; }) },
      { key: 'Shift-Tab', run: run(e => { if (T.tableTab(e, true)) return true; return E.cm.cm.indentLess(e.view); }) },
      { key: 'ArrowDown', run: () => AC.open ? (acKey({ key: 'ArrowDown' }), true) : false }, { key: 'ArrowUp', run: () => AC.open ? (acKey({ key: 'ArrowUp' }), true) : false }, { key: 'Escape', run: () => { if (AC.open) { T.acClose(); return true; } return false; } },
      { key: 'Mod-b', run: run(e => T.wrap(e, '**', '**')), preventDefault: true }, { key: 'Mod-i', run: run(e => T.wrap(e, '*', '*')), preventDefault: true }, { key: 'Mod-u', run: run(e => T.wrap(e, '<u>', '</u>')), preventDefault: true }, { key: 'Mod-e', run: run(e => T.wrap(e, '`', '`')), preventDefault: true }, { key: 'Mod-k', run: run(e => T.link(e)), preventDefault: true },
      ...[0, 1, 2, 3, 4, 5, 6].map(k => ({ key: 'Mod-' + k, run: run(e => T.linePrefix(e, k ? '#'.repeat(k) + ' ' : '')), preventDefault: true })),
      { key: 'Mod-Shift-k', run: run(e => T.insertAt(e, '\n```\n\n```\n', 5)), preventDefault: true }, { key: 'Mod-Shift-m', run: run(e => T.insertAt(e, '\n$$\n\n$$\n', 4)), preventDefault: true }, { key: 'Mod-Shift-q', run: run(e => T.linePrefix(e, '> ')), preventDefault: true }, { key: 'Mod-Shift-5', run: run(e => T.wrap(e, '~~', '~~')), preventDefault: true }, { key: 'Mod-Shift-h', run: run(e => T.wrap(e, '==', '==')), preventDefault: true }, { key: 'Mod-Shift-i', run: run(e => T.insertAt(e, '![]()', 1)), preventDefault: true }, { key: 'Mod-Alt-t', run: run(e => { e.insert('\n' + SNIP.table + '\n'); return true; }), preventDefault: true }
    ];
  };
  /* ---------- auto pair ---------- */
  const PAIRS = { '(': ')', '[': ']', '{': '}', '（': '）', '【': '】', '《': '》', '「': '」', '“': '”' }, CLOSE = new Set(Object.values(PAIRS));
  T.extensions = () => [E.cm.EditorView.inputHandler.of((view, from, to, text) => {
    if (!SL.prefs.autoPair || text.length !== 1) return false; const e = ed(); if (!e || e.view !== view) return false; if (inFence(e, from)) return false; const doc = view.state.doc;
    if (PAIRS[text]) { const sel = doc.sliceString(from, to); view.dispatch({ changes: { from, to, insert: text + sel + PAIRS[text] }, selection: { anchor: from + 1, head: from + 1 + sel.length }, userEvent: 'input.type' }); return true; }
    if (CLOSE.has(text) && from === to && doc.sliceString(from, from + 1) === text) { view.dispatch({ selection: { anchor: from + 1 } }); return true; }
    return false;
  }), E.cm.EditorView.domEventHandlers({ keydown: (ev) => { if (AC.open && ['ArrowDown', 'ArrowUp'].includes(ev.key)) { acKey(ev); ev.preventDefault(); return true; } return false; } })];
  /* ---------- paste: HTML → Markdown (tables, lists, headings, links…) ---------- */
  T.html2md = html => {
    const doc = new DOMParser().parseFromString(html, 'text/html'); doc.querySelectorAll('style,script,meta,title,link,head,xml').forEach(n => n.remove()); doc.querySelectorAll('[style*="mso-list:Ignore"]').forEach(n => n.remove());
    const kids = (n, c) => { let s = ''; n.childNodes.forEach(ch => s += conv(ch, c)); return s; }, cellText = n => conv(n, { inTable: true }).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
    function conv(n, c) {
      c = c || {}; if (n.nodeType === 3) { const t = c.pre ? n.nodeValue : n.nodeValue.replace(/[\s\u00a0]+/g, ' '); return t.replace(/([*_`\\])/g, '\\$1'); } if (n.nodeType !== 1) return ''; const tag = n.tagName.toLowerCase(), st = (n.getAttribute('style') || '').toLowerCase(), wrapI = (m, x) => x.trim() ? x.match(/^\s*/)[0] + m + x.trim() + m + x.match(/\s*$/)[0] : x;
      switch (tag) {
        case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': return '\n\n' + '#'.repeat(+tag[1]) + ' ' + kids(n, c).replace(/\s+/g, ' ').trim() + '\n\n'; case 'br': return c.inTable ? ' ' : '  \n'; case 'hr': return '\n\n---\n\n';
        case 'strong': case 'b': return wrapI('**', kids(n, c)); case 'em': case 'i': return wrapI('*', kids(n, c)); case 'u': case 'ins': { const x = kids(n, c); return x.trim() ? '<u>' + x + '</u>' : x; } case 's': case 'del': case 'strike': return wrapI('~~', kids(n, c)); case 'mark': return wrapI('==', kids(n, c));
        case 'sub': return '<sub>' + kids(n, c) + '</sub>'; case 'sup': return '<sup>' + kids(n, c) + '</sup>'; case 'code': return c.pre ? n.textContent : '`' + n.textContent + '`';
        case 'pre': { const lang = ((n.querySelector('code') || n).className.match(/language-(\S+)/) || [])[1] || ''; return '\n\n```' + lang + '\n' + n.textContent.replace(/\n$/, '') + '\n```\n\n'; }
        case 'a': { const href = n.getAttribute('href') || '', t = kids(n, c).trim(); if (!href || /^javascript:/i.test(href) || href.startsWith('#')) return t; return t === href ? '<' + href + '>' : '[' + (t || href) + '](' + href + ')'; }
        case 'img': { const s = n.getAttribute('src') || ''; return !s || /^file:/i.test(s) ? '' : '![' + (n.getAttribute('alt') || '') + '](' + s + ')'; }
        case 'ul': case 'ol': { const d = c.depth || 0; let i = parseInt(n.getAttribute('start') || '1', 10); const items = Array.from(n.children).filter(x => x.tagName === 'LI').map(li => { const cb = li.querySelector(':scope > input[type=checkbox]'), body = kids(li, Object.assign({}, c, { depth: d + 1 })).replace(/^\s+|\s+$/g, '').replace(/\n{2,}/g, '\n'), mk = tag === 'ol' ? (i++) + '. ' : '- ', ls = body.split('\n'); return '  '.repeat(d) + mk + (cb ? (cb.checked ? '[x] ' : '[ ] ') : '') + ls[0].trim() + (ls.length > 1 ? '\n' + ls.slice(1).join('\n') : ''); }); return (d ? '\n' : '\n\n') + items.join('\n') + (d ? '\n' : '\n\n'); }
        case 'blockquote': return '\n\n' + kids(n, c).trim().split('\n').map(l => '> ' + l).join('\n') + '\n\n';
        case 'table': { const rows = Array.from(n.querySelectorAll('tr')).map(tr => Array.from(tr.children).filter(x => /^T[DH]$/.test(x.tagName)).map(cellText)); if (!rows.length) return ''; const w = Math.max(...rows.map(r => r.length)); rows.forEach(r => { while (r.length < w) r.push(''); }); return '\n\n' + X.formatMdTable(['| ' + rows[0].join(' | ') + ' |', '|' + ' --- |'.repeat(w)].concat(rows.slice(1).map(r => '| ' + r.join(' | ') + ' |')).join('\n')) + '\n\n'; }
        case 'p': case 'div': case 'section': case 'article': case 'header': case 'footer': case 'dd': case 'dt': case 'figure': case 'figcaption': if (c.inTable) return kids(n, c) + ' '; if (tag === 'p' && /MsoListParagraph/i.test(n.className || '')) return '\n- ' + kids(n, c).trim() + '\n'; return '\n\n' + kids(n, c) + '\n\n';
        case 'span': case 'font': { const x = kids(n, c); if (/font-weight\s*:\s*(bold|[6-9]00)/.test(st)) return wrapI('**', x); if (/font-style\s*:\s*italic/.test(st)) return wrapI('*', x); return x; } default: return kids(n, c);
      }
    }
    return conv(doc.body, {}).split('\n').map(l => / {2}$/.test(l) && l.trim() ? l.replace(/\s+$/, '  ') : l.replace(/\s+$/, '')).join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, '');
  };
  let plainPaste = false; document.addEventListener('keydown', e => { plainPaste = (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v'; }, true);
  T.onPaste = (ev, view) => {
    const cd = ev.clipboardData; if (!cd) return; const e = ed(); if (!e) return; const items = Array.from(cd.items || []), img = items.find(i => i.type && i.type.startsWith('image/')), html = cd.getData ? cd.getData('text/html') : '';
    if (img && !(html && /<table/i.test(html))) { ev.preventDefault(); SL.pasteImage && SL.pasteImage(img.getAsFile()); return; }
    if (!html || !SL.prefs.richPaste || plainPaste || inFence(e, e.head)) return; if (!/<(table|h[1-6]|ul|ol|li|strong|b|em|i|a\s|img|pre|blockquote|code|del|s|u)\b/i.test(html)) return;
    const md = T.html2md(html); if (!md) return; ev.preventDefault(); e.insert(md); SL.toast('已将富文本转换为 Markdown（Ctrl+Shift+V 粘贴纯文本）', 2200);
  };
  T.options = () => ({ keymap: T.keymap(), extensions: T.extensions(), onPaste: T.onPaste });
})(window);
