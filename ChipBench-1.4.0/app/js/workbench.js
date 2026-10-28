/* ChipBench 1.1 · workbench.js
   · responsive layout (wide / mid / narrow — half-screen), side "peek" overlay, typewriter mode
   · right-hand "上下文" tab: PDF page ↔ notes / components; note → sources, pending items
   · PDF excerpt → note with page citation (SL.excerpt)
   · built-in AI tool calling (same capabilities as the MCP server) + AI activity log with undo
   · SVD import → register blocks
   · persistent search-index cache (instant search after restart; only changed files are re-read)
   Loaded after help.js; uses only public SL.* interfaces. */
(function (G) {
  'use strict';
  const SL = G.ChipBench; if (!SL || !SL.app) { console.warn('[wb] ChipBench not ready'); return; }
  const U = SL.U, X = SL.X, fs = SL.fs, $ = U.$, $$ = U.$$, esc = U.esc, h = U.h, A = SL.app;
  SL.ext = SL.s31 = SL.s31 || {};          // 1.1: public name for the extension namespace (SL.s31 kept as alias)
  const WB = SL.wb = {};
  const COMP = /^(clocktree|clock-tree|structure|ipblock|register|pinout|memmap|gcl|wavedrom)$/;

  /* =============== 1. responsive layout =============== */
  const body = document.body;
  WB.layout = () => {
    const w = innerWidth; const mode = w < 1000 ? 'narrow' : w < 1400 ? 'mid' : 'wide';
    if (body.dataset.w === mode) return; body.dataset.w = mode;
    ['narrow', 'mid', 'wide'].forEach(k => body.classList.toggle('w-' + k, k === mode));
    SL.emit('layout', mode);
  };
  addEventListener('resize', U.debounce(WB.layout, 60)); WB.layout();
  /* 1.2: the shell must never scroll. Even with overflow:hidden/clip some engines still move scrollTop when scrollIntoView() or
     focus() targets something inside; snap it back immediately so the rail / tabs / toolbar can never disappear. */
  const SHELL = ['app', 'main', 'side', 'right'].map(id => document.getElementById(id)).filter(Boolean).concat([document.documentElement, document.body]);
  const unscroll = el => { if (el.scrollTop || el.scrollLeft) { el.scrollTop = 0; el.scrollLeft = 0; } };
  SHELL.forEach(el => el.addEventListener('scroll', () => unscroll(el), { passive: true }));
  document.addEventListener('scroll', () => SHELL.forEach(unscroll), { capture: true, passive: true });
  WB.unscroll = () => SHELL.forEach(unscroll);
  // PDF: when the window changes size class, re-fit pages to the new width (only if the user has not zoomed manually)
  SL.on('layout', () => { const t = A.current(); if (!t || t.view !== 'pdf' || !t.el || t.zoomManual) return; const b = t.el.querySelector('[data-z="w"],[data-z="fit"]'); b && b.click(); });
  document.addEventListener('click', e => { const z = e.target.closest && e.target.closest('[data-z]'); if (z && e.isTrusted && (z.dataset.z === '+' || z.dataset.z === '-')) { const t = A.current(); if (t) t.zoomManual = true; } }, true);

  /* typewriter mode: keep the caret line vertically centred while typing */
  const tw = () => { if (!SL.prefs.typewriter || !A.ed || !A.ed.view) return; const v = A.ed.view, c = v.coordsAtPos(v.state.selection.main.head); if (!c) return; const r = v.scrollDOM.getBoundingClientRect(), d = c.top - (r.top + r.height / 2); if (Math.abs(d) > 24) v.scrollDOM.scrollTop += d; };
  SL.on('doc-change', () => requestAnimationFrame(tw));
  SL.cmd('view.typewriter', '打字机模式（光标行保持居中）', () => { SL.prefs.typewriter = !SL.prefs.typewriter; SL.savePrefs ? SL.savePrefs() : SL.store.set('prefs', SL.prefs); body.classList.toggle('typewriter', !!SL.prefs.typewriter); SL.toast('打字机模式：' + (SL.prefs.typewriter ? '开' : '关')); tw(); }, { group: '视图' });
  body.classList.toggle('typewriter', !!SL.prefs.typewriter);


  /* 1.2: table formulas (=B2*C2, =SUM(D2:D9)) show their computed value in live / read / split views; the formula stays in the
     source and in the cell tooltip. "计算表格公式" still writes the numbers into the text if you want them frozen. */
  WB.calcTables = root => { root.querySelectorAll('table').forEach(tb => { const rows = Array.from(tb.rows); if (!rows.some(r => Array.from(r.cells).some(c => /^\s*=/.test(c.dataset.f || c.textContent)))) return; const grid = rows.map(r => Array.from(r.cells).map(c => (c.dataset.f || c.textContent).replace(/\|/g, '/').trim())); const md = ['| ' + grid[0].join(' | ') + ' |', '|' + grid[0].map(() => ' --- ').join('|') + '|'].concat(grid.slice(1).map(r => '| ' + r.join(' | ') + ' |')).join('\n'); let r; try { r = X.evalTable(md); } catch (e) { return; } if (!r || !r.rows) return; rows.forEach((tr, ri) => Array.from(tr.cells).forEach((c, ci) => { const f = c.dataset.f || c.textContent.trim(); if (!/^=/.test(f)) return; c.dataset.f = f; const v = r.rows[ri] && r.rows[ri][ci]; c.textContent = v == null ? f : v; c.title = f; c.classList.add('tcalc'); })); }); };
  const enh0 = SL.enhance; SL.enhance = (root, ctx) => { const p = enh0(root, ctx); try { WB.calcTables(root); } catch (e) { } return p; };


  /* 1.2: never insert above / inside a document's front matter — move the caret below it first */
  WB.fmEnd = text => { const m = /^---[ \t]*\n[\s\S]*?\n(?:---|\.\.\.)[ \t]*(?:\n|$)/.exec(text); return m ? m[0].length : 0; };
  const ins0 = SL.insertIntoNote; SL.insertIntoNote = async text => { const A2 = SL.app; const t = A2.lastMd && A2.tabs.includes(A2.lastMd) ? A2.lastMd : A2.tabs.find(x => x.kind === 'md'); if (!t) return ins0(text); await A2.activate(A2.tabs.indexOf(t)); const e = A2.ed; if (!e) return ins0(text); const end = WB.fmEnd(e.value), pos = Math.max(e.head, end), body = (pos > 0 && e.slice(pos - 1, pos) !== '\n' ? '\n' : '') + '\n' + text + '\n'; e.replace(pos, pos, body); SL.toast('已插入到 ' + t.name); };

  /* 1.2.1: numeric viewer-table headers right-aligned over their numbers */
  WB.alignNumHeads = root => { root.querySelectorAll('table.tbl:not([data-al])').forEach(tb => { tb.dataset.al = 1; const rows = [...tb.rows]; if (rows.length < 2) return; [...rows[0].cells].forEach((th, i) => { if (th.tagName !== 'TH') return; const col = rows.slice(1).map(r => r.cells[i]).filter(Boolean); if (col.length && col.every(c => c.classList.contains('num'))) th.style.textAlign = 'right'; }); }); };
  new MutationObserver(U.debounce(() => WB.alignNumHeads(document.getElementById('main')), 120)).observe(document.getElementById('main'), { childList: true, subtree: true });

  /* =============== helpers =============== */
  const noteText = async path => { const t = A.tabs.find(x => x.path && U.pkey(x.path) === U.pkey(path) && x.kind === 'md'); if (t) return A.textOf(t); const rec = SL.index.search.docs.get(U.pkey(path)); if (rec && rec.text) return rec.text; return (await fs.read(path)).text; };
  const blocks = text => { const out = [], L = text.split('\n'); let i = 0, off = 0; const offs = []; for (const l of L) { offs.push(off); off += l.length + 1; } while (i < L.length) { const m = L[i].match(/^\s*(```+|~~~+)\s*([\w-]+)/); if (m) { const fence = m[1], lang = m[2].toLowerCase(); let j = i + 1; while (j < L.length && !L[j].trim().startsWith(fence)) j++; if (COMP.test(lang)) { const src = L.slice(i + 1, j).join('\n'); out.push({ index: out.length, lang, line: i, endLine: Math.min(j, L.length - 1), from: offs[i + 1] != null ? offs[i + 1] : off, to: offs[j] != null ? offs[j] - 1 : off, src }); } i = j + 1; continue; } i++; } return out; };
  WB.blocks = blocks;
  const roots = () => (SL.ws && SL.ws.cur ? SL.ws.cur.roots.map(r => r.path) : []);
  const inWs = p => { const k = U.pkey(p); return roots().some(r => k === U.pkey(r) || k.startsWith(U.pkey(r).replace(/[\\/]+$/, '') + '\\') || k.startsWith(U.pkey(r).replace(/[\\/]+$/, '') + '/')) || A.tabs.some(t => t.path && U.pkey(t.path) === k); };
  const resolvePath = p => { if (!p) return null; if (/^[a-z]:[\\/]|^[\\/]{2}|^\//i.test(p)) return p; const t = A.current(); if (t && t.path && U.base(t.path).toLowerCase() === p.toLowerCase()) return t.path; const f = SL.ws && SL.ws.allFiles ? SL.ws.allFiles().find(x => x.name.toLowerCase() === U.base(p).toLowerCase()) : null; if (f) return f.path; const r = roots()[0]; return r ? X.join(r, p) : p; };

  /* =============== 2. context tab =============== */
  const linkRe = (name, page) => new RegExp('\\[\\[' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\.pdf$/i, '(?:\\.pdf)?') + '#p=' + page + '(?!\\d)', 'i');
  WB.pdfContext = (name, page) => {
    const base = name.replace(/\.pdf$/i, ''), notes = [], comps = [];
    for (const [k, rec] of SL.index.search.docs) {
      if (rec.kind !== 'md' || !rec.text) continue; const t = rec.text;
      if (t.indexOf(base) < 0) continue;
      const L = t.split('\n'), re = linkRe(name, page); L.forEach((l, i) => { if (re.test(l)) notes.push({ path: rec.path, line: i, text: l.trim().slice(0, 140) }); });
      blocks(t).forEach(b => { let m = null; try { m = X.yaml(b.src); } catch (e) { } if (!m || !m.source || String(m.source).toLowerCase().replace(/\.pdf$/, '') !== base.toLowerCase()) return; const hit = (m.nodes || m.fields || m.blocks || []).filter(n => +n.page === page); if (hit.length) comps.push({ path: rec.path, line: b.line, lang: b.lang, title: m.title || m.name || b.lang, nodes: hit.map(n => n.label || n.name || n.id) }); });
    }
    return { notes, comps };
  };
  WB.noteContext = text => {
    const src = [], seen = new Set(); let m; const re = /\[\[([^\]|#]+\.pdf)#p=(\d+)/gi;
    while ((m = re.exec(text))) { const k = m[1] + '#' + m[2]; if (!seen.has(k)) { seen.add(k); src.push({ file: m[1], page: +m[2] }); } }
    const comps = blocks(text).map(b => { let y = null; try { y = X.yaml(b.src); } catch (e) { } const nodes = y && (y.nodes || y.fields || y.blocks) || []; return { line: b.line, lang: b.lang, title: (y && (y.title || y.name)) || b.lang, source: y && y.source, pending: nodes.filter(n => !n.status || n.status === 'unverified').length, doubt: nodes.filter(n => n.status === 'doubt').length, nopage: nodes.filter(n => n.page == null && (y && y.source)).length, total: nodes.length }; });
    return { src, comps };
  };
  SL.right.register('ctx', '上下文', root => {
    const tab = SL.right.tabs.ctx; let pending = 0;
    const draw = () => {
      const t = A.current(); if (!t) { root.innerHTML = '<div class="empty">打开 PDF 或笔记后，这里显示关联内容</div>'; return; }
      if (t.kind === 'view' && t.view === 'pdf') {
        const pg = (t.viewer && t.viewer.page) || 1, c = WB.pdfContext(t.name, pg);
        root.innerHTML = '<div class="ctx-h"><b>' + esc(t.name) + '</b><span class="chip">p.' + pg + '</span></div>' +
          '<div class="cap ctx-cap">引用本页的笔记 · ' + c.notes.length + '</div>' + (c.notes.map(n => '<div class="bl" data-p="' + esc(n.path) + '" data-l="' + n.line + '"><b>' + esc(U.base(n.path).replace(/\.\w+$/, '')) + '</b><div class="muted">' + esc(n.text) + '</div></div>').join('') || '<div class="empty sm">还没有笔记引用这一页<br>选中文字 → “摘录到笔记”</div>') +
          '<div class="cap ctx-cap">出自本页的组件节点 · ' + c.comps.length + '</div>' + (c.comps.map(n => '<div class="bl" data-p="' + esc(n.path) + '" data-l="' + n.line + '"><b>' + esc(n.title) + '</b> <span class="chip">' + esc(n.lang) + '</span><div class="muted">' + esc(n.nodes.join('、')) + '</div></div>').join('') || '<div class="empty sm">没有组件节点标注这一页</div>');
        return;
      }
      if (t.kind === 'md') {
        const c = WB.noteContext(A.textOf(t)), bl = t.path ? SL.index.backlinks(t.path) : [];
        root.innerHTML = '<div class="ctx-h"><b>' + esc(t.name) + '</b></div>' +
          '<div class="cap ctx-cap">引用的手册页 · ' + c.src.length + '</div>' + (c.src.map(s => '<div class="bl" data-pdf="' + esc(s.file) + '" data-pg="' + s.page + '"><b>' + esc(s.file) + '</b> <span class="chip">p.' + s.page + '</span></div>').join('') || '<div class="empty sm">没有 <code>[[手册.pdf#p=页码]]</code> 引用</div>') +
          '<div class="cap ctx-cap">工程组件 · ' + c.comps.length + '</div>' + (c.comps.map(s => '<div class="bl" data-l="' + s.line + '"><b>' + esc(s.title) + '</b> <span class="chip">' + esc(s.lang) + '</span>' + (s.total ? ' <span class="chip ' + (s.pending ? 'warn' : 'ok') + '">' + (s.total - s.pending - s.doubt) + '/' + s.total + ' 已确认</span>' : '') + (s.doubt ? ' <span class="chip bad">' + s.doubt + ' 有疑问</span>' : '') + (s.nopage ? ' <span class="chip warn">' + s.nopage + ' 无页码</span>' : '') + (s.source ? '<div class="muted">来源 ' + esc(s.source) + '</div>' : '') + '</div>').join('') || '<div class="empty sm">笔记里没有组件块</div>') +
          '<div class="cap ctx-cap">反向链接 · ' + bl.length + '</div>' + (bl.slice(0, 30).map(b => '<div class="bl" data-p="' + esc(b.from) + '" data-l="' + b.line + '"><b>' + esc(b.name.replace(/\.\w+$/, '')) + '</b><div class="muted">' + esc(b.text.trim().slice(0, 100)) + '</div></div>').join('') || '<div class="empty sm">没有</div>');
        return;
      }
      root.innerHTML = '<div class="empty">当前文件类型没有上下文信息</div>';
    };
    const soon = () => { clearTimeout(pending); pending = setTimeout(() => { if (!root.classList.contains('hide') && SL.right.el.classList.contains('open')) draw(); }, 150); };
    tab.refresh = draw; SL.on('tab', soon); SL.on('pdf-page', soon); SL.on('index', soon); SL.on('saved', soon); SL.on('doc-change', U.debounce(soon, 800));
    root.addEventListener('click', e => { const b = e.target.closest('.bl'); if (!b) return; if (b.dataset.pdf) return SL.gotoPage ? SL.gotoPage(b.dataset.pdf, +b.dataset.pg) : null; if (b.dataset.p) return SL.openPath(b.dataset.p, { line: +b.dataset.l }); if (b.dataset.l) A.goLine(+b.dataset.l); });
    draw();
  });
  SL.cmd('right.ctx', '上下文面板（PDF 页 ↔ 笔记 / 组件）', () => SL.right.open('ctx'), { key: 'Ctrl+Alt+R', group: '视图', icon: 'link' });

  /* =============== 3. PDF excerpt → note =============== */
  let lastNote = null; SL.on('tab', t => { if (t && t.kind === 'md') lastNote = t; });
  SL.excerpt = async ({ text, page, name, path, notesPath }) => {
    const quote = '> ' + text.replace(/\s+/g, ' ').trim() + '\n> —— [[' + name + '#p=' + page + ']]\n\n';
    let t = lastNote && A.tabs.includes(lastNote) ? lastNote : A.tabs.filter(x => x.kind === 'md').pop();
    if (t) { await A.activate(A.tabs.indexOf(t)); await new Promise(r => setTimeout(r, 30)); const e = A.ed; if (!e) return; const p = e.head, l = e.lineAt(p), pre = l.text.trim() ? '\n\n' : ''; e.replace(l.to, l.to, pre + quote); SL.toast('已摘录到 ' + t.name + '（p.' + page + '）'); return t; }
    if (!notesPath) return SL.toast('请先打开一篇笔记');
    let old = ''; try { old = (await fs.kind(notesPath)) === 'file' ? (await fs.read(notesPath)).text : '# ' + name + ' · 摘录\n\n'; } catch (e) { }
    await fs.write(notesPath, old.replace(/\s*$/, '\n\n') + quote); SL.index.refreshFile && SL.index.refreshFile(notesPath); SL.toast('没有打开的笔记，已摘录到 ' + U.base(notesPath));
  };

  /* =============== 4. AI activity log =============== */
  const LOG = WB.aiLog = { items: [] }; SL.store.get('ai.log', []).then(v => { LOG.items = v || []; });
  LOG.add = it => { it.t = Date.now(); it.id = U.uid(); LOG.items.unshift(it); LOG.items = LOG.items.slice(0, 300); let size = 0; LOG.items.forEach(x => { size += (x.before || '').length; if (size > 4e6) x.before = null; }); SL.store.set('ai.log', LOG.items); SL.emit('ai-log', it); return it; };
  SL.right.register('ailog', 'AI 记录', root => {
    const draw = () => { root.innerHTML = '<div class="row" style="padding:var(--sp-2) var(--sp-3)"><span class="cap">AI 读取与修改 · ' + LOG.items.length + '</span><span class="sp"></span><button class="btn sm ghost" data-clear>清空</button></div>' + (LOG.items.map(x => '<div class="ail ' + (x.write ? 'w' : 'r') + '"><div class="row"><b>' + esc(x.tool) + '</b><span class="sp"></span><span class="muted">' + new Date(x.t).toLocaleTimeString() + '</span></div>' + (x.path ? '<div class="mono muted ail-p" data-p="' + esc(x.path) + '">' + esc(U.base(x.path)) + '</div>' : '') + (x.summary ? '<div class="muted">' + esc(x.summary) + '</div>' : '') + (x.write && x.before != null && !x.undone ? '<button class="btn sm" data-undo="' + x.id + '">撤销此修改</button>' : x.undone ? '<span class="chip">已撤销</span>' : '') + '</div>').join('') || '<div class="empty">AI 还没有调用过工具</div>'); };
    SL.right.tabs.ailog.refresh = draw; SL.on('ai-log', () => { if (!root.classList.contains('hide')) draw(); });
    root.addEventListener('click', async e => { if (e.target.closest('[data-clear]')) { LOG.items = []; SL.store.set('ai.log', []); return draw(); } const p = e.target.closest('.ail-p'); if (p) return SL.openPath(p.dataset.p); const u = e.target.closest('[data-undo]'); if (!u) return; const it = LOG.items.find(x => x.id === u.dataset.undo); if (!it) return; if (!(await SL.confirm('把 ' + U.base(it.path) + ' 恢复到 AI 修改之前？'))) return; await writeNote(it.path, it.before); it.undone = true; SL.store.set('ai.log', LOG.items); draw(); SL.toast('已撤销'); });
    draw();
  });
  async function writeNote(path, text) {
    const t = A.tabs.find(x => x.path && U.pkey(x.path) === U.pkey(path) && x.kind === 'md');
    if (t && t === A.current() && A.ed) { A.ed.replace(0, A.ed.length, text); await A.save(t).catch(() => { }); return; }
    if (t) { t.text = text; t.dirty = false; }
    await fs.write(path, text); SL.index.refreshFile && SL.index.refreshFile(path);
  }
  WB.writeNote = writeNote;

  /* =============== 5. AI tools (function calling) =============== */
  const N = () => SL.net && SL.net.N;
  const confirmWrite = async (path, before, after, what) => {
    if (SL.ai.cfg.confirmWrites === false) return true;
    const ops = X.lineDiff(before, after).filter(o => o[0] !== ' ').slice(0, 120);
    const body = h('div', null, '<p>AI 要' + esc(what) + '：<b class="mono">' + esc(U.base(path)) + '</b></p><pre class="ai-diff">' + ops.map(o => '<span class="' + (o[0] === '-' ? 'd' : 'a') + '">' + esc(o[0] + ' ' + o[1]) + '</span>').join('\n') || '(没有差异)' + '</pre><div class="muted" style="font-size:var(--fs-sm)">修改前的内容会记录在“AI 记录”，可随时撤销。</div>');
    return (await SL.modal({ title: '确认 AI 修改', body, buttons: [{ t: '拒绝', v: null }, { t: '允许写入', primary: true, v: 'ok' }] })) === 'ok';
  };
  const T = WB.tools = [
    { name: 'get_active_document', description: '读取用户当前打开的文档（路径、名称、选中内容，可选全文）。', parameters: { type: 'object', properties: { include_content: { type: 'boolean' } } },
      run: async a => { const t = A.current(); if (!t) return { open: false }; const o = { path: t.path, name: t.name, kind: t.kind === 'md' ? 'note' : t.view }; if (t.kind === 'md' && A.ed) { o.selection = A.ed.from !== A.ed.to ? A.ed.slice(A.ed.from, Math.min(A.ed.to, A.ed.from + 20000)) : ''; if (a.include_content) o.content = A.textOf(t).slice(0, 60000); } if (t.view === 'pdf' && t.viewer) { o.page = t.viewer.page; o.pages = t.viewer.N; } return o; } },
    { name: 'search_workspace', description: '在当前工作区全文搜索（笔记、PDF、Office 文档）。返回文件与命中片段。', parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer' } }, required: ['query'] },
      run: async a => SL.index.runSearch(a.query, { limit: Math.min(a.limit || 20, 60) }).slice(0, a.limit || 20).map(r => ({ path: r.path, name: r.name, kind: r.kind, hits: (r.hits || []).slice(0, 3).map(x => typeof x === 'string' ? x : { line: x.line, page: x.page, text: String(x.text || x.snippet || '').slice(0, 200) }) })) },
    { name: 'read_file', description: '读取工作区内的文本文件（笔记、代码、.map、日志），可指定行范围（从 1 开始）。', parameters: { type: 'object', properties: { path: { type: 'string' }, start_line: { type: 'integer' }, end_line: { type: 'integer' } }, required: ['path'] },
      run: async a => { const p = resolvePath(a.path); if (!inWs(p)) throw new Error('路径不在当前工作区内'); const L = (await noteText(p)).split('\n'), s = Math.max(1, a.start_line || 1), e = Math.min(L.length, a.end_line || Math.min(L.length, s + 399)); LOG.add({ tool: 'read_file', path: p, summary: '第 ' + s + '–' + e + ' 行' }); return { path: p, total_lines: L.length, start_line: s, end_line: e, text: L.slice(s - 1, e).join('\n') }; } },
    { name: 'read_pdf_pages', description: '读取 PDF 指定页的文字（用于引用手册，回答时请注明页码）。一次最多 10 页。', parameters: { type: 'object', properties: { path: { type: 'string' }, from: { type: 'integer' }, to: { type: 'integer' } }, required: ['path', 'from'] },
      run: async a => { const p = resolvePath(a.path); if (!inWs(p)) throw new Error('路径不在当前工作区内'); const f = Math.max(1, a.from), t = Math.min(f + 9, a.to || f); let pages; const open = A.tabs.find(x => x.path && U.pkey(x.path) === U.pkey(p) && x.viewer && x.viewer.pages); pages = open ? await open.viewer.pages(f, t) : await SL.invoke('pdf_text', { path: p, from: f, to: t }); LOG.add({ tool: 'read_pdf_pages', path: p, summary: 'p.' + f + (t > f ? '–' + t : '') }); return { path: p, pages }; } },
    { name: 'list_components', description: '列出笔记里的工程组件块（clocktree / structure / register / pinout / memmap / gcl / wavedrom）。', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      run: async a => { const p = resolvePath(a.path); return blocks(await noteText(p)).map(b => { let y = {}; try { y = X.yaml(b.src) || {}; } catch (e) { } return { index: b.index, lang: b.lang, line: b.line + 1, title: y.title || y.name || '', source: y.source || '', nodes: (y.nodes || y.fields || []).length }; }); } },
    { name: 'get_component', description: '读取一个组件块的 YAML 源码。', parameters: { type: 'object', properties: { path: { type: 'string' }, index: { type: 'integer' } }, required: ['path', 'index'] },
      run: async a => { const p = resolvePath(a.path), b = blocks(await noteText(p))[a.index]; if (!b) throw new Error('没有第 ' + a.index + ' 个组件'); return { lang: b.lang, yaml: b.src }; } },
    { name: 'update_component', description: '用新的 YAML 替换组件块。AI 改动的节点会自动标记为“待核对”(status: unverified)。', write: true, parameters: { type: 'object', properties: { path: { type: 'string' }, index: { type: 'integer' }, yaml: { type: 'string' } }, required: ['path', 'index', 'yaml'] },
      run: async a => { const p = resolvePath(a.path); if (!inWs(p)) throw new Error('路径不在当前工作区内'); const text = await noteText(p), b = blocks(text)[a.index]; if (!b) throw new Error('没有第 ' + a.index + ' 个组件'); let m; try { m = X.yaml(a.yaml); } catch (e) { throw new Error('YAML 解析失败：' + e.message); } let old = {}; try { old = X.yaml(b.src) || {}; } catch (e) { } const key = m.nodes ? 'nodes' : m.fields ? 'fields' : null; if (key) { const strip = n => { const c = Object.assign({}, n); delete c.status; return JSON.stringify(c); }; const prevS = new Map((old[key] || []).map(n => [String(n.id || n.name), n])); m[key].forEach(n => { const k = String(n.id || n.name), was = prevS.get(k); if (was && strip(was) === strip(n)) { if (was.status) n.status = was.status; else delete n.status; } else n.status = 'unverified'; }); /* AI can never mark a node as confirmed: unchanged nodes keep the human's status, changed / new ones become unverified */ } const y = X.toYaml(m).replace(/\n$/, ''), next = text.slice(0, b.from) + y + text.slice(b.to); if (!(await confirmWrite(p, text, next, '修改组件 ' + b.lang + ' #' + a.index))) throw new Error('用户拒绝了这次修改'); await writeNote(p, next); LOG.add({ tool: 'update_component', path: p, write: true, before: text, summary: b.lang + ' #' + a.index }); return { ok: true, note: '改动节点已标记为待核对' }; } },
    { name: 'append_to_note', description: '在笔记末尾（或指定标题下）追加 Markdown 内容。', write: true, parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' }, heading: { type: 'string' } }, required: ['path', 'content'] },
      run: async a => { const p = resolvePath(a.path); if (!inWs(p)) throw new Error('路径不在当前工作区内'); let text = ''; try { text = await noteText(p); } catch (e) { } let next; if (a.heading) { const L = text.split('\n'), i = L.findIndex(l => /^#{1,6}\s/.test(l) && l.replace(/^#+\s*/, '').trim() === a.heading.trim()); if (i >= 0) { let j = i + 1; const lv = L[i].match(/^#+/)[0].length; while (j < L.length && !(new RegExp('^#{1,' + lv + '}\\s')).test(L[j])) j++; L.splice(j, 0, a.content.replace(/\s*$/, ''), ''); next = L.join('\n'); } } if (next == null) next = text.replace(/\s*$/, '') + (text ? '\n\n' : '') + a.content.replace(/\s*$/, '') + '\n'; if (!(await confirmWrite(p, text, next, '追加内容'))) throw new Error('用户拒绝了这次修改'); await writeNote(p, next); LOG.add({ tool: 'append_to_note', path: p, write: true, before: text, summary: a.content.length + ' 字' }); return { ok: true }; } },
    { name: 'list_tasks', description: '列出工作区待办（status: open / done / all）。', parameters: { type: 'object', properties: { status: { type: 'string' } } },
      run: async a => SL.index.tasks().filter(t => a.status === 'all' ? true : a.status === 'done' ? t.done : !t.done).slice(0, 200).map(t => ({ text: t.text, done: !!t.done, plan: t.plan, due: t.due, file: t.file || t.name, line: t.line })) },
    { name: 'analyze_capture', description: '分析 .pcap / .pcapng 抓包（gPTP、DoIP/UDS、SOME/IP-SD、VLAN、TCP 异常），返回 Markdown 报告。', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      run: async a => { const p = resolvePath(a.path); if (!inWs(p)) throw new Error('路径不在当前工作区内'); const n = N(); const r = n.analyze(n.readCapture(await fs.readBytes(p))); LOG.add({ tool: 'analyze_capture', path: p }); return n.reportMarkdown(r, U.base(p)).slice(0, 20000); } },
    { name: 'check_gcl', description: '检查 TAS 门控列表（gcl YAML）：周期、Express/Preemptable 映射、保护带。', parameters: { type: 'object', properties: { yaml: { type: 'string' } }, required: ['yaml'] },
      run: async a => { const m = N().gclModel(X.yaml(a.yaml)); return { cycle_ns: m.cycle, guard_ns: m.guardNs, issues: m.issues, queues: m.queues }; } },
    { name: 'calc_cbs', description: '计算 802.1Qav CBS 参数（idleSlope / sendSlope / hiCredit / loCredit）。', parameters: { type: 'object', properties: { link: { type: 'string', description: '链路速率，如 1Gbps' }, bandwidthPct: { type: 'number', description: '预留带宽百分比' }, idleSlope: { type: 'string', description: '或直接给 idleSlope，如 20Mbps' }, maxFrame: { type: 'integer' } }, required: ['link'] },
      run: async a => N().cbs(a) },
    { name: 'calc_can_timing', description: '计算 CAN / CAN FD 位时序（时钟、波特率、采样点）。', parameters: { type: 'object', properties: { clock: { type: 'string', description: '如 80MHz' }, bitrate: { type: 'string', description: '如 500k / 2M' }, samplePoint: { type: 'number', description: '采样点百分比，默认 80' } }, required: ['clock', 'bitrate'] },
      run: async a => N().canTiming(a) },
    { name: 'list_skills', description: '列出可用的 Agent Skills（内置与工作区）。', parameters: { type: 'object', properties: {} },
      run: async () => (await SL.skills.list()).map(s => ({ name: s.name, description: s.description, source: s.source })) },
    { name: 'read_skill', description: '读取某个技能的 SKILL.md 全文，按里面的步骤完成任务。', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      run: async a => { const s = (await SL.skills.list()).find(x => x.name === a.name || x.folder === a.name); if (!s) throw new Error('没有这个技能'); return (await fs.read(s.file)).text; } }
  ];
  const schema = () => T.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  WB.runTool = async (name, args) => { const t = T.find(x => x.name === name); if (!t) return { error: '未知工具 ' + name }; try { const r = await t.run(args || {}); if (!t.write && !['read_file', 'read_pdf_pages', 'analyze_capture'].includes(name)) LOG.add({ tool: name, summary: JSON.stringify(args || {}).slice(0, 120) }); return r; } catch (e) { return { error: String(e && e.message || e) }; } };

  const AI = SL.ai, plainChat = AI.chat;
  const SYS_TOOLS = '\n\n你可以调用工具读取用户工作区（文件、PDF 页、组件、抓包）并做工程计算。规则：引用手册时注明页码；没有原文支撑的结论标注“待确认”；修改文件只用 update_component / append_to_note，并说明改了什么。';
  const post = async (u, headers, body) => { const res = await SL.http.fetch(u, { method: 'POST', headers, body: JSON.stringify(body) }); if (!res.ok) { let t = ''; try { t = (await res.text()).slice(0, 300); } catch (e) { } throw new Error('AI 服务返回 ' + res.status + ' ' + t); } const tx = await res.text(); try { return JSON.parse(tx); } catch (e) { const er = new Error('NOTJSON'); er.notJson = true; throw er; } };
  AI.agent = async (messages, onDelta, onTool) => {
    const c = AI.cfg, base = c.url.replace(/\/+$/, ''), headers = { 'Content-Type': 'application/json' }; let u, ollama = c.provider === 'ollama';
    if (ollama) u = base.replace(/\/v1$/, '') + '/api/chat'; else if (c.provider === 'azure') { u = base + '/openai/deployments/' + encodeURIComponent(c.model) + '/chat/completions?api-version=' + encodeURIComponent(c.apiVersion); headers['api-key'] = c.key; } else { u = base + '/chat/completions'; headers.Authorization = 'Bearer ' + c.key; }
    const msgs = [{ role: 'system', content: c.system + SYS_TOOLS }].concat(messages);
    for (let step = 0; step < 8; step++) {
      const body = ollama ? { model: c.model, messages: msgs, tools: schema(), stream: false, options: { temperature: c.temperature } } : Object.assign({ messages: msgs, tools: schema(), temperature: c.temperature }, c.provider === 'azure' ? {} : { model: c.model });
      const j = await post(u, headers, body), m = ollama ? j.message : j.choices && j.choices[0] && j.choices[0].message; if (!m) { const er = new Error('AI 返回格式无法识别'); er.noMsg = step === 0; throw er; }
      const calls = m.tool_calls || [];
      if (!calls.length) { const out = m.content || ''; onDelta && onDelta(out); return out; }
      msgs.push(ollama ? { role: 'assistant', content: m.content || '', tool_calls: calls } : { role: 'assistant', content: m.content || null, tool_calls: calls });
      for (const call of calls) {
        const fn = call.function || {}, name = fn.name; let args = fn.arguments; if (typeof args === 'string') { try { args = JSON.parse(args || '{}'); } catch (e) { args = {}; } }
        onTool && onTool(name, args, 'run'); const r = await WB.runTool(name, args); onTool && onTool(name, args, r && r.error ? 'err' : 'ok', r);
        const content = typeof r === 'string' ? r : JSON.stringify(r); msgs.push(ollama ? { role: 'tool', content: content.slice(0, 30000) } : { role: 'tool', tool_call_id: call.id, content: content.slice(0, 30000) });
      }
    }
    const out = '（工具调用次数达到上限，已停止）'; onDelta && onDelta(out); return out;
  };
  const TOOLNAME = { get_active_document: '读取当前文档', search_workspace: '搜索工作区', read_file: '读取文件', read_pdf_pages: '读取 PDF', list_components: '列出组件', get_component: '读取组件', update_component: '修改组件', append_to_note: '写入笔记', list_tasks: '读取待办', analyze_capture: '分析抓包', check_gcl: '检查门控列表', calc_cbs: '计算 CBS', calc_can_timing: '计算 CAN 位时序', list_skills: '列出技能', read_skill: '读取技能' };
  AI.chat = async (messages, onDelta, opt) => {
    if (!AI.cfg.useTools || (opt && opt.plain)) return plainChat(messages, onDelta, opt);
    const log = $('#ai-log'), lastMsg = log && log.lastElementChild; let line = null;
    const onTool = (name, args, st) => { if (!log) return; if (st === 'run') { line = h('div', { class: 'ai-tool' }, '<i class="sp-dot"></i>' + esc(TOOLNAME[name] || name) + (args && (args.path || args.query) ? ' · <span class="mono">' + esc(U.base(String(args.path || args.query))) + '</span>' : '')); log.insertBefore(line, lastMsg || null); } else if (line) { line.classList.add(st); line.querySelector('i').className = st === 'ok' ? 'tki tki-done' : 'tki tki-x'; } };
    try { return await AI.agent(messages, onDelta, onTool); }
    catch (e) { if (e.notJson || e.noMsg || (/tools?|function/i.test(String(e.message)) && /400|404|422/.test(String(e.message)))) { if (line) line.remove(); SL.toast('该服务不支持工具调用，已改用普通对话'); return plainChat(messages, onDelta, opt); } throw e; }
  };

  /* =============== 6. SVD import → register blocks =============== */
  SL.cmd('reg.svd', '从 SVD 导入寄存器…', async () => {
    const ps = await SL.invoke('pick_files', { filters: [{ name: 'CMSIS-SVD', extensions: ['svd', 'xml'] }] }).catch(() => []); if (!ps || !ps[0]) return;
    let regs; try { regs = X.parseSVD((await fs.read(ps[0])).text); } catch (e) { return SL.toast('SVD 解析失败：' + e.message, 4000, 'bad'); } if (!regs.length) return SL.toast('SVD 里没有寄存器');
    const pers = Array.from(new Set(regs.map(r => r.name.split('.')[0])));
    const body = h('div', null, '<p class="muted">' + esc(U.base(ps[0])) + ' · ' + pers.length + ' 个外设 · ' + regs.length + ' 个寄存器</p><input class="input" id="svd-q" placeholder="筛选外设（如 CAN0）" style="width:100%;margin-bottom:var(--sp-2)"><div class="svd-list" style="max-height:320px;overflow:auto">' + pers.map(p => '<label class="row" style="gap:var(--sp-2);padding:2px 0"><input type="checkbox" value="' + esc(p) + '"><span class="mono">' + esc(p) + '</span><span class="muted">' + regs.filter(r => r.name.split('.')[0] === p).length + '</span></label>').join('') + '</div>');
    $('#svd-q', body).addEventListener('input', e => { const q = e.target.value.toLowerCase(); $$('.svd-list label', body).forEach(l => l.style.display = l.textContent.toLowerCase().includes(q) ? '' : 'none'); });
    if ((await SL.modal({ title: '从 SVD 导入寄存器', body, buttons: [{ t: '取消', v: null }, { t: '插入到笔记', primary: true, v: 'ok' }] })) !== 'ok') return;
    const sel = new Set($$('.svd-list input:checked', body).map(i => i.value)); if (!sel.size) return SL.toast('没有选择外设');
    const md = regs.filter(r => sel.has(r.name.split('.')[0])).map(r => '```register\n' + X.toYaml({ name: r.name, address: '0x' + (r.address >>> 0).toString(16).toUpperCase(), width: r.width || 32, reset: r.reset != null ? '0x' + (r.reset >>> 0).toString(16).toUpperCase() : undefined, source: U.base(ps[0]), fields: (r.fields || []).map(f => JSON.parse(JSON.stringify(f))) }).replace(/\n$/, '') + '\n```\n').join('\n');
    SL.insertIntoNote ? SL.insertIntoNote(md) : A.ed && A.ed.insert(md); SL.toast('已插入 ' + (md.split('```register').length - 1) + ' 个寄存器块');
  }, { group: '工程' });

  /* =============== 7. persistent search-index cache =============== */
  const I = SL.index, wsKey = () => SL.ws && SL.ws.cur ? 'idx.' + SL.ws.cur.id : null; let restoredFor = null;
  WB.saveIndex = U.debounce(() => U.idle(async () => {
    const k = wsKey(); if (!k || I.status && I.status.state === 'building') return; if (WB.idxSig === I.docs.size + ':' + A.ver) return; WB.idxSig = I.docs.size + ':' + A.ver; const docs = [], texts = []; let size = 0;
    for (const [key, d] of I.docs) { const r = I.search.docs.get(key); const tx = r && r.text || ''; size += tx.length; docs.push(d); texts.push(size < 8e6 ? tx : ''); }
    const pages = []; for (const [id, r] of I.search.docs) if (id.includes('#p=') && size < 8e6) { size += (r.text || '').length; pages.push([id, r.title, r.text, r.kind, r.path, r.page]); }
    await SL.store.set(k, { v: 1, t: Date.now(), docs, texts, pages });
  }), 6000);
  WB.restoreIndex = async () => {
    const k = wsKey(); if (!k || restoredFor === k) return 0; restoredFor = k; const c = await SL.store.get(k, null); if (!c || c.v !== 1 || I.docs.size) return 0; const t0 = performance.now();
    c.docs.forEach((d, i) => { const key = U.pkey(d.path); I.docs.set(key, d); I.search.set(key, { title: d.title + ' ' + d.name, text: c.texts[i] || '', kind: d.kind, path: d.path }); if (I.byBase && d.kind === 'md') { const b = U.base(d.path).replace(/\.\w+$/, '').toLowerCase(); if (!I.byBase.has(b)) I.byBase.set(b, d.path); } });
    (c.pages || []).forEach(p => I.search.set(p[0], { title: p[1], text: p[2], kind: p[3], path: p[4], page: p[5] }));
    WB.indexRestoreMs = Math.round(performance.now() - t0); SL.emit('index', I); return c.docs.length;
  };
  const build0 = I.build; I.build = async force => { if (!force) { try { await WB.restoreIndex(); } catch (e) { console.warn('[wb] index cache', e); } } const r = await build0(force); WB.saveIndex(); return r; };
  SL.on('index', () => WB.saveIndex());
  SL.on('workspace', () => { restoredFor = null; });
})(window);
