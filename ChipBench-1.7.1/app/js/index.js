/* ChipBench · index.js — workspace-wide document index (P10): notes, PDF pages, Office files, mail → one incremental search index,
   plus links / backlinks, properties and tasks. Heavy file work is done by Rust (scan_dir, read_many, pdf_text). */
(function (G) {
  'use strict';
  const SL = G.ChipBench, U = SL.U, X = SL.X, W = SL.W, fs = SL.fs, $ = U.$, esc = U.esc;
  const NOTE = /^(md|markdown|mdown|mkd|txt)$/, OFFICE = /^(docx|xlsx|xlsm|pptx|eml)$/, CODE = /^(c|h|cc|cpp|cxx|hpp|hh|s|asm|inc|ld|lsf|py|rs|js|ts|json|yaml|yml|xml|arxml|ini|cfg|cmake|mk|bat|ps1|sh)$/;  /* 1.6.1: source / config files are searchable too */
  const I = SL.index = { docs: new Map(), search: new X.SearchIndex(), links: new Map(), status: { state: 'idle', done: 0, total: 0 }, byBase: new Map() };
  let building = null, bgQueue = [], bgRun = false;
  const setStatus = (s, extra) => { Object.assign(I.status, { state: s }, extra || {}); const el = $('#st-idx'); if (!el) return; el.textContent = s === 'building' ? '索引 ' + I.status.done + '/' + I.status.total : s === 'bg' ? '提取资料文本…' : I.docs.size ? '已索引 ' + I.docs.size : ''; };
  const kindOf = ext => NOTE.test(ext) ? 'md' : CODE.test(ext) ? 'code' : ext === 'pdf' ? 'pdf' : ext === 'docx' ? 'doc' : ext === 'pptx' ? 'ppt' : /^xls/.test(ext) ? 'xls' : ext === 'eml' ? 'mail' : 'file';
  I.kindOf = kindOf;
  function extractLinks(text) { const out = [], lines = text.split('\n'); let fence = false; for (let i = 0; i < lines.length; i++) { const l = lines[i]; if (/^\s*(```|~~~)/.test(l)) { fence = !fence; continue; } if (fence || (l.indexOf('[[') < 0 && l.indexOf('](') < 0)) continue; let m; const r1 = /\[\[([^\[\]\n|#]+)(?:#[^\[\]\n|]*)?(?:\|[^\[\]\n]*)?\]\]/g; while ((m = r1.exec(l))) out.push({ kind: 'w', raw: m[1].trim(), line: i, text: l }); const r2 = /\]\(\s*<?([^)>]+?\.(?:md|markdown|pdf|docx|xlsx|pptx))(?:#[^)\s]*)?>?(?:\s+["'][^"']*["'])?\s*\)/gi; while ((m = r2.exec(l))) if (!/^[a-z]+:/i.test(m[1])) { let raw = m[1]; try { raw = decodeURIComponent(raw); } catch (e) { } out.push({ kind: 'm', raw, line: i, text: l }); } } return out; }
  /* 1.6: large notes (≥ 80 KB) are analysed in a Web Worker so saving / indexing never blocks typing */
  let ixw = null, ixSeq = 0; const ixWait = new Map();
  const getIxWorker = async () => {
    if (ixw !== null) return ixw;
    try {
      const src = await (await fetch('js/logic.js')).text();
      const glue = '\n;(function(){var X=self.ChipBenchX;var EL=' + extractLinks.toString() + ';self.onmessage=function(e){var m=e.data;try{var t=m.text,fm=X.frontMatter(t),title=String(fm.props.title||((t.match(/^#\\s+(.+)$/m)||[])[1])||m.name.replace(/\\.\\w+$/,""));self.postMessage({id:m.id,props:fm.props,title:title,tasks:X.collectTasks(t,{name:m.name,path:m.path}),links:EL(t),tokens:Array.from(X._tok(title+" "+m.name+" "+t))});}catch(err){self.postMessage({id:m.id,error:String(err)});}};})();';
      ixw = new Worker(URL.createObjectURL(new Blob([src + glue], { type: 'text/javascript' })));
      ixw.onmessage = e => { const w = ixWait.get(e.data.id); if (w) { ixWait.delete(e.data.id); w(e.data); } };
      ixw.onerror = () => { for (const w of ixWait.values()) w({ error: 'worker' }); ixWait.clear(); ixw = false; };
    } catch (e) { ixw = false; }
    return ixw;
  };
  I.indexNoteAsync = async (path, text, mtime, size) => {
    if (text.length < 80000) return indexNote(path, text, mtime, size);
    const w = await getIxWorker(); if (!w) return indexNote(path, text, mtime, size);
    const id = ++ixSeq, r = await new Promise(res => { ixWait.set(id, res); w.postMessage({ id, text, path, name: U.base(path) }); });
    if (r.error) return indexNote(path, text, mtime, size);
    const name = U.base(path), d = { path, name, ext: U.ext(path), kind: 'md', mtime, size, props: r.props || {}, title: r.title, tasks: r.tasks, links: r.links };
    I.docs.set(U.pkey(path), d); I.search.setTokens(U.pkey(path), { title: d.title + ' ' + name, text, kind: 'md', path }, r.tokens);
    const bk = name.replace(/\.\w+$/, '').toLowerCase(); I.byBase.set(bk, I.byBase.get(bk) || path); return d;
  };
  function indexNote(path, text, mtime, size) {
    const fm = X.frontMatter(text), name = U.base(path), title = fm.props.title || (text.match(/^#\s+(.+)$/m) || [])[1] || name.replace(/\.\w+$/, '');
    const d = { path, name, ext: U.ext(path), kind: 'md', mtime, size, props: fm.props, title: String(title), tasks: X.collectTasks(text, { name, path }), links: extractLinks(text) };
    I.docs.set(U.pkey(path), d); I.search.set(U.pkey(path), { title: d.title + ' ' + name, text, kind: 'md', path }); I.byBase.set(U.base(path).replace(/\.\w+$/, '').toLowerCase(), I.byBase.get(U.base(path).replace(/\.\w+$/, '').toLowerCase()) || path); return d;
  }
  I.indexText = (path, text) => indexNote(path, text, Date.now(), text.length);
  I.remove = path => { const k = U.pkey(path); I.docs.delete(k); I.search.remove(k); for (const id of Array.from(I.search.docs.keys())) if (id.startsWith(k + '#p=')) I.search.remove(id); };
  const roots = () => (SL.ws && SL.ws.cur ? SL.ws.cur.roots.map(r => r.path) : []);
  const extra = () => (SL.ws && SL.ws.cur ? W.files(SL.ws.cur).map(f => f.path) : []);
  I.build = async (force) => {
    if (building) return building; if (!SL.native) return; const g = I.gen, stale = () => g !== I.gen; const run = (async () => {
      setStatus('building', { done: 0, total: 0 }); const old = new Map(Array.from(I.docs.entries()).map(([k, d]) => [k, d.mtime])); const seen = new Set();
      try {
        const rs = roots(), exts = ['md', 'markdown', 'mdown', 'mkd', 'txt', 'pdf', 'docx', 'xlsx', 'xlsm', 'pptx', 'eml'].concat(CODE.source.slice(2, -2).split('|')), files = [];
        for (const r of rs) { if (stale()) return; try { files.push(...await SL.invoke('scan_dir', { root: r, exts, exclude: (SL.ws.cur.settings && SL.ws.cur.settings.exclude) || [] })); } catch (e) { } }
        const fk = new Set(files.map(f => U.pkey(f.path))); for (const p of extra()) { if (fk.has(U.pkey(p))) continue; try { files.push({ path: p, size: await fs.size(p), mtime: await fs.mtime(p) }); } catch (e) { } }
        setStatus('building', { done: 0, total: files.length }); bgQueue = [];
        const todo = [], codeTodo = []; for (const f of files) { const k = U.pkey(f.path); seen.add(k); const ext = U.ext(f.path); if (!force && old.get(k) === f.mtime && I.docs.has(k)) continue; if (NOTE.test(ext)) todo.push(f); else if (CODE.test(ext)) { if (f.size < 1500000) codeTodo.push(f); } else if (ext === 'pdf' || OFFICE.test(ext)) { I.docs.set(k, { path: f.path, name: U.base(f.path), ext, kind: kindOf(ext), mtime: f.mtime, size: f.size, props: {}, title: U.base(f.path), tasks: [], links: [] }); I.search.set(k, { title: U.base(f.path), text: '', kind: kindOf(ext), path: f.path }); if ((ext === 'pdf' ? f.size < 80e6 : f.size < 25e6) && (force || old.get(k) !== f.mtime)) bgQueue.push(f); } }
        for (let i = 0; i < todo.length; i += 60) { if (stale()) return; const batch = todo.slice(i, i + 60), docs = await SL.invoke('read_many', { paths: batch.map(f => f.path), maxBytes: 3000000 }); const by = new Map(batch.map(f => [f.path, f])); if (stale()) return; let ts = performance.now(); for (const d of docs) { const f = by.get(d.path); if (d.text && d.text.length >= 80000) await I.indexNoteAsync(d.path, d.text, f.mtime, f.size); else indexNote(d.path, d.text, f.mtime, f.size); if (performance.now() - ts > 12) { await new Promise(r => setTimeout(r, 0)); if (stale()) return; ts = performance.now(); } } setStatus('building', { done: Math.min(todo.length, i + 60), total: todo.length }); await new Promise(r => setTimeout(r, 0)); }
        /* 1.6.1: source files — text only (no tasks / links / front matter), after the notes so notes are searchable first */
        for (let i = 0; i < codeTodo.length; i += 80) { if (stale()) return; const batch = codeTodo.slice(i, i + 80), docs = await SL.invoke('read_many', { paths: batch.map(f => f.path), maxBytes: 1500000 }); const by = new Map(batch.map(f => [f.path, f])); if (stale()) return; let ts = performance.now(); for (const d of docs) { const f = by.get(d.path) || {}, k = U.pkey(d.path), ext = U.ext(d.path); I.docs.set(k, { path: d.path, name: U.base(d.path), ext, kind: 'code', mtime: f.mtime, size: f.size, props: {}, title: U.base(d.path), tasks: [], links: [] }); I.search.set(k, { title: U.base(d.path), text: d.text || '', kind: 'code', path: d.path }); if (performance.now() - ts > 12) { await new Promise(r => setTimeout(r, 0)); if (stale()) return; ts = performance.now(); } } await new Promise(r => setTimeout(r, 0)); }
        if (stale()) return; for (const k of Array.from(I.docs.keys())) if (!seen.has(k) && !A_open(k)) I.remove(I.docs.get(k).path);
      } catch (e) { console.warn('index', e); }
      setStatus('idle'); SL.emit('index', I); bgExtract();
    })(); building = run; run.finally(() => { if (building === run) building = null; }); return run;
  };
  const A_open = k => SL.app.tabs.some(t => t.path && U.pkey(t.path) === k && t.kind === 'md' && !t.pristine && !t.path);
  /* low-priority text extraction for PDF / Office / mail (so they appear in unified search) */
  async function bgExtract() {
    if (bgRun) return; bgRun = true; let n = 0; const g = I.gen;
    while (bgQueue.length && g === I.gen) { const f = bgQueue.shift(), ext = U.ext(f.path), k = U.pkey(f.path); setStatus('bg'); try {
      if (ext === 'pdf') { const cnt = await SL.invoke('pdf_page_count', { path: f.path }); const step = 40; let all = ''; for (let a = 1; a <= Math.min(cnt, 2000); a += step) { const pages = await SL.invoke('pdf_text', { path: f.path, from: a, to: Math.min(cnt, a + step - 1) }); for (const [pg, tx] of Object.entries(pages)) { all += ' ' + tx; I.search.set(k + '#p=' + pg, { title: U.base(f.path) + ' · p.' + pg, text: tx, kind: 'pdf', path: f.path, page: +pg }); } await new Promise(r => setTimeout(r, 0)); } I.search.set(k, { title: U.base(f.path), text: '', kind: 'pdf', path: f.path }); }
      else { const text = await officeText(f.path, ext); I.search.set(k, { title: U.base(f.path), text, kind: kindOf(ext), path: f.path }); }
    } catch (e) { } n++; await new Promise(r => (G.requestIdleCallback ? requestIdleCallback(() => r(), { timeout: 120 }) : setTimeout(r, 16))); }
    bgRun = false; setStatus('idle'); SL.emit('index', I);
  }
  async function officeText(path, ext) { const bytes = await fs.readBytes(path); const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); if (ext === 'docx') { const r = await X.readDocx(buf); return r.markdown; } if (ext === 'pptx') return (await X.readPptx(buf)).map(s => s.title + ' ' + s.body.map(b => b.text).join(' ') + ' ' + s.notes).join('\n'); if (/^xls/.test(ext)) return (await X.readXlsx(buf)).map(s => s.name + ' ' + s.rows.slice(0, 2000).map(r => r.join(' ')).join('\n')).join('\n'); if (ext === 'eml') { const m = X.parseEml(new TextDecoder('latin1').decode(bytes)); return m.subject + ' ' + m.from + ' ' + (m.text || m.html.replace(/<[^>]+>/g, ' ')); } return ''; }
  I.officeText = officeText;
  I.refreshFile = async path => { if (!SL.native) return; const ext = U.ext(path), k = U.pkey(path); try { if ((await fs.kind(path)) !== 'file') return I.remove(path); const mt = await fs.mtime(path), sz = await fs.size(path); if (NOTE.test(ext)) { const r = await fs.read(path); indexNote(path, r.text, mt, sz); } else if (ext === 'pdf' || OFFICE.test(ext)) { I.docs.set(k, { path, name: U.base(path), ext, kind: kindOf(ext), mtime: mt, size: sz, props: {}, title: U.base(path), tasks: [], links: [] }); bgQueue.push({ path, size: sz, mtime: mt }); bgExtract(); } } catch (e) { } };
  SL.on('fs-changed', ps => { const set = new Set(ps.map(p => p)); set.forEach(p => { if (/\.(md|markdown|mdown|mkd|txt|pdf|docx|xlsx|xlsm|pptx|eml)$/i.test(p)) I.refreshFile(p); }); });
  const pendSave = new Map(); let pendT = 0;
  const flushSaved = async () => { pendT = 0; const items = [...pendSave.values()]; pendSave.clear(); for (const [p, tx] of items) await I.indexNoteAsync(p, tx, Date.now(), tx.length); if (items.length) SL.emit('index', I); };
  SL.on('saved', (t, text) => { if (!t.path || !SL.isMd(t.path)) return; pendSave.set(U.pkey(t.path), [t.path, text]); if (!pendT) pendT = (G.requestIdleCallback ? requestIdleCallback(flushSaved, { timeout: text.length > 200000 ? 4000 : 1200 }) : setTimeout(flushSaved, 600)); });
  /* ---------- queries ---------- */
  I.noteDocs = () => Array.from(I.docs.values()).filter(d => d.kind === 'md');
  I.tasks = () => { const out = []; I.noteDocs().forEach(d => out.push(...d.tasks)); return out; };
  I.resolve = (raw, kind, fromPath) => { if (kind === 'w') { const b = raw.split('/').pop().toLowerCase().replace(/\.\w+$/, ''); return I.byBase.get(b) || null; } const full = X.isAbs(raw) ? raw : X.resolveRel(U.dir(fromPath), raw); return full; };
  I.backlinks = path => { const k = U.pkey(path), out = []; I.docs.forEach(d => { if (U.pkey(d.path) === k) return; d.links.forEach(l => { const to = I.resolve(l.raw, l.kind, d.path); if (to && U.pkey(to) === k) out.push({ from: d.path, name: d.name, line: l.line, text: l.text }); }); }); return out; };
  I.outgoing = path => { const d = I.docs.get(U.pkey(path)); if (!d) return []; return d.links.map(l => ({ raw: l.raw, kind: l.kind, to: I.resolve(l.raw, l.kind, path), line: l.line })); };
  I.find = name => { const b = name.split('/').pop().toLowerCase().replace(/\.\w+$/, ''); return I.byBase.get(b) || null; };
  I.runSearch = (q, o) => { o = o || {}; const rs = I.search.search(q, o.limit || 80); const by = new Map(); rs.forEach(r => { const d = r.doc, k = U.pkey(d.path); if (!by.has(k)) by.set(k, { path: d.path, kind: d.kind, name: U.base(d.path), score: r.score, hits: [] }); const g = by.get(k); g.score = Math.max(g.score, r.score); g.hits.push({ page: d.page, snippet: r.snippet }); }); return Array.from(by.values()).sort((a, b) => b.score - a.score); };
  SL.wikiCandidates = () => { const out = [], seen = new Set(); I.docs.forEach(d => { if (d.kind !== 'md') return; const n = d.name.replace(/\.\w+$/, ''); if (seen.has(n)) return; seen.add(n); out.push({ name: n, sub: U.dir(d.path).split(/[\\/]/).slice(-2).join('\\') }); }); return out.slice(0, 2000); };
  SL.openWiki = async target => {
    const [name, hash] = target.split('#'); let p = I.find(name); const A = SL.app;
    if (!p) { const t = A.current(); const d = t && t.path ? U.dir(t.path) : (SL.ws && SL.ws.cur && SL.ws.cur.settings.inbox) || (SL.ws && SL.ws.cur && SL.ws.cur.roots[0] && SL.ws.cur.roots[0].path); if (!d) return SL.toast('找不到笔记“' + name + '”，且没有可创建的位置'); if (!(await SL.confirm('“' + name + '” 不存在，是否在 ' + d + ' 新建？', '新建'))) return; p = X.join(d, name.replace(/\.md$/i, '') + '.md'); try { await fs.write(p, '# ' + name + '\n\n'); I.indexText(p, '# ' + name + '\n\n'); } catch (e) { return SL.toast('创建失败：' + e, 3500, 'bad'); } }
    await SL.openPath(p); if (hash) setTimeout(() => { const h = (A.outline() || []).find(x => x.text.trim().toLowerCase() === hash.trim().toLowerCase()); if (h) A.goLine(h.line); }, 150);
  };
  /* ---------- search pane ---------- */
  SL.registerPanel('search', '搜索', 'search', { key: 'Ctrl+Shift+F', actions: '<button class="btn ghost icon sm" data-a="reindex" title="重建索引">' + SL.icon('refresh') + '</button>', show: () => setTimeout(() => $('#sq') && $('#sq').focus(), 30) });
  $('#pane-search').innerHTML = '<div style="padding:8px 10px 4px"><input class="input" id="sq" placeholder="搜索全部资料（笔记 · PDF · Word · Excel · PPT · 邮件）" style="width:100%"></div><div class="row" style="padding:0 10px 6px;gap:10px"><div class="seg" id="sq-scope"><button data-s="all" class="on">全部</button><button data-s="notes">仅笔记</button><button data-s="regex">正则</button></div></div><div class="side-b" id="sq-res"></div>';
  let scope = 'all', sqSeq = 0;
  const badge = k => '<span class="badge k-' + ({ md: 'md', pdf: 'pdf', doc: 'doc', ppt: 'ppt', xls: 'xls', mail: 'q' }[k] || 'md') + '">' + ({ md: 'MD', pdf: 'PDF', doc: 'DOC', ppt: 'PPT', xls: 'XLS', mail: 'EML' }[k] || 'FILE') + '</span>';
  async function doSearch() {
    const q = $('#sq').value.trim(), box = $('#sq-res'), my = ++sqSeq; if (!q) { box.innerHTML = '<div class="empty">输入关键词，在工作区的所有资料中搜索。<br>结果按文件分组，PDF 会精确到页码。</div>'; return; } const t0 = performance.now(); let html = '';
    if (scope === 'regex') { if (!SL.native) { box.innerHTML = '<div class="empty">正则搜索需要桌面版</div>'; return; } const rs = roots(); if (!rs.length) { box.innerHTML = '<div class="empty">请先在工作区中添加文件夹</div>'; return; } let re; try { new RegExp(q, 'i'); } catch (e) { box.innerHTML = '<div class="sr-sum">正则表达式有误</div>'; return; } const hits = await SL.invoke('search_dir', { roots: rs, pattern: q, isRegex: true, caseSensitive: false, max: 1500, exts: null }); if (my !== sqSeq) return; const g = new Map(); hits.forEach(h => { if (!g.has(h.path)) g.set(h.path, []); g.get(h.path).push(h); }); SL.searchHits = []; g.forEach((arr, p) => { html += '<div class="sr-f" data-p="' + esc(p) + '">' + badge('md') + esc(U.base(p)) + ' <small>' + esc(U.dir(p).split(/[\\/]/).slice(-2).join('\\')) + ' · ' + arr.length + '</small></div>' + arr.slice(0, 12).map(h => '<div class="sr-l" data-p="' + esc(p) + '" data-l="' + h.line + '"><i>' + (h.line + 1) + '</i>' + esc(h.text.trim().slice(0, 140)) + '</div>').join(''); }); box.innerHTML = '<div class="sr-sum">' + g.size + ' 个文件 · ' + hits.length + ' 处 · ' + Math.round(performance.now() - t0) + ' ms</div>' + html; return; }
    let res = I.runSearch(q, { limit: 120 }); if (scope === 'notes') res = res.filter(r => r.kind === 'md'); const open = SL.app.tabs.filter(t => t.kind === 'md' && t.path && t.dirty); if (my !== sqSeq) return;
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'); html = res.map(r => '<div class="sr-f" data-p="' + esc(r.path) + '">' + badge(r.kind) + esc(r.name) + ' <small>' + esc(U.dir(r.path).split(/[\\/]/).slice(-2).join('\\')) + ' · ' + r.hits.length + '</small></div>' + r.hits.slice(0, 5).map(h => '<div class="sr-l" data-p="' + esc(r.path) + '"' + (h.page ? ' data-pg="' + h.page + '"' : '') + '>' + (h.page ? '<i>p.' + h.page + '</i>' : '') + esc(h.snippet).replace(new RegExp(esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), m => '<b>' + m + '</b>') + '</div>').join('')).join('');
    box.innerHTML = '<div class="sr-sum">' + res.length + ' 个文件 · ' + Math.round(performance.now() - t0) + ' ms · 索引 ' + I.search.size + ' 项' + (I.status.state !== 'idle' ? '（仍在建立）' : '') + '</div>' + (html || '<div class="empty">没有结果</div>');
  }
  $('#sq').addEventListener('input', U.debounce(doSearch, 180)); $('#sq').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
  $('#sq-scope').addEventListener('click', e => { const b = e.target.closest('[data-s]'); if (!b) return; scope = b.dataset.s; U.$$('#sq-scope button').forEach(x => x.classList.toggle('on', x === b)); doSearch(); });
  $('#sq-res').addEventListener('click', e => { const it = e.target.closest('[data-p]'); if (!it) return; SL.openPath(it.dataset.p, { line: it.dataset.l != null ? +it.dataset.l : undefined, page: it.dataset.pg ? +it.dataset.pg : undefined }); });
  $('#side-actions').addEventListener('click', e => { const a = e.target.closest('[data-a="reindex"]'); if (a) { I.build(true); SL.toast('正在重建索引…'); } });
  SL.cmd('search.global', '在工作区中搜索', () => { SL.panel('search'); }, { key: 'Ctrl+Shift+F', group: '搜索', icon: 'search' });
  SL.paletteProviders.push({ prefix: '?', items: async q => { if (!q) return [{ title: '输入关键词搜索工作区内全部资料', group: '全文搜索' }]; return I.runSearch(q, { limit: 40 }).map(r => ({ title: r.name, sub: (r.hits[0].page ? 'p.' + r.hits[0].page + ' · ' : '') + r.hits[0].snippet.slice(0, 60), group: '全文搜索', icon: 'file', run: () => SL.openPath(r.path, { page: r.hits[0].page }) })); } });
  /* 1.6: each project's index stays in memory (last 4) — switching back is instant and the rebuild is incremental */
  const wsCache = new Map(); let curWs = null; I.gen = 0;
  SL.on('ws-changed', w => {
    const id = w && w.id; if (!id || id === curWs) return;
    if (curWs) { wsCache.delete(curWs); wsCache.set(curWs, { docs: I.docs, search: I.search, byBase: I.byBase }); }
    const c = wsCache.get(id); wsCache.delete(id);
    if (c) { I.docs = c.docs; I.search = c.search; I.byBase = c.byBase; } else { I.docs = new Map(); I.search = new X.SearchIndex(); I.byBase = new Map(); }
    while (wsCache.size > 3) wsCache.delete(wsCache.keys().next().value);
    curWs = id; I.gen++; building = null; bgQueue = []; SL.emit('index', I); I.build();
  });
  SL.on('ws-roots', () => I.build());
})(window);
