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

  async function writeNote(path, text) {
    const t = A.tabs.find(x => x.path && U.pkey(x.path) === U.pkey(path) && x.kind === 'md');
    if (t && t === A.current() && A.ed) { A.ed.replace(0, A.ed.length, text); await A.save(t).catch(() => { }); return; }
    if (t) { t.text = text; t.dirty = false; }
    await fs.write(path, text); SL.index.refreshFile && SL.index.refreshFile(path);
  }
  WB.writeNote = writeNote;

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
    for (const [key, d] of I.docs) { const r = I.search.docs.get(key); const tx = r && r.text || ''; size += tx.length; docs.push(d); texts.push(size < 3e6 ? tx : ''); }
    const pages = []; for (const [id, r] of I.search.docs) if (id.includes('#p=') && size < 3e6) { size += (r.text || '').length; pages.push([id, r.title, r.text, r.kind, r.path, r.page]); }
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
