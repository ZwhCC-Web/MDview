  /* ================= part 3: source mode (CodeMirror 6), modes, outline, status, files, search, export ================= */
  let srcEd = null, srcMuted = false, srcBase = { ver: -1, tab: -1 }, srcEnterSnap = null, lastSrcInput = 0, syncLock = false;
  function edLineAt(ed, pos) {
    if (ed.cm) return ed.lineAt(pos);
    const v = ed.value; const from = v.lastIndexOf('\n', pos - 1) + 1; let to = v.indexOf('\n', pos); if (to < 0) to = v.length;
    return { from, to, text: v.slice(from, to), n: lineOfPos(v, pos) };
  }
  function edLineN(ed, n) {
    if (ed.cm) return ed.line(n);
    const ls = ed.value.split('\n'); n = Math.max(0, Math.min(ls.length - 1, n)); let from = 0; for (let k = 0; k < n; k++) from += ls[k].length + 1;
    return { from, to: from + ls[n].length, text: ls[n], n };
  }
  const edLineCount = ed => ed.cm ? ed.lines : ed.value.split('\n').length;
  function srcCreate() {
    if (srcEd) return srcEd;
    if (CMK.ok) {
      srcEd = CMK.api.create({
        kind: 'source', parent: sourceWrap, doc: S.src, spell: prefs.spell, lineNumbers: prefs.srcLines,
        onChange: srcChanged, onSelect: () => later(srcSel), onKey: e => srcKeys(e, srcEd), onPaste: e => onPaste(e, srcEd),
        onMouseUp: () => { fmtBarCheck(srcEd); srcSel(); acClose(); },
        onBlur: () => setTimeout(() => { if (!edFocused(srcEd)) { if (fmtTarget === srcEd) hideFmtBar(); if (AC.ta === srcEd) acClose(); } }, 120),
        onUndoEmpty: () => { if (S.history.length) undo(); }
      });
      srcEd.view.scrollDOM.addEventListener('scroll', onSrcScroll, { passive: true });
    } else {
      const ta = document.createElement('textarea'); ta.id = 'source-fallback'; ta.spellcheck = prefs.spell; ta.placeholder = '在此输入 Markdown…';
      sourceWrap.appendChild(ta); srcEd = ta; ta.value = S.src;
      ta.addEventListener('input', srcChanged);
      ta.addEventListener('keydown', e => srcKeys(e, ta));
      ta.addEventListener('paste', e => onPaste(e, ta));
      ta.addEventListener('scroll', onSrcScroll, { passive: true });
      ['keyup', 'click'].forEach(ev => ta.addEventListener(ev, () => { srcSel(); fmtBarCheck(ta); }));
      ta.addEventListener('blur', () => setTimeout(() => { if (!edFocused(ta)) { hideFmtBar(); acClose(); } }, 120));
    }
    return srcEd;
  }
  function srcEditorSet(v, fresh) {
    if (!srcEd) return;
    srcMuted = true;
    try {
      if (srcEd.cm) { if (fresh || srcBase.tab !== S.cur) { srcEd.newState(v); srcEd.setLineNumbers(prefs.srcLines); } else if (srcEd.value !== v) srcEd.value = v; }
      else if (srcEd.value !== v) srcEd.value = v;
    } finally { srcMuted = false; }
    srcStale = false; srcBase = { ver: S.ver, tab: S.cur };
  }
  function srcFocus() { if (srcEd) srcEd.focus({ preventScroll: true }); }
  const onSourceChange = debounce(() => {
    if (S.mode === 'live') return;
    if (S.mode === 'split') renderPreview(); else { S.result = MD.render(S.src, { prev: S.result }); updateOutline(); }
    persistSession(); linkIndexTouch(); tasksTouch(); updateStatus(); pushState();
  }, 300);
  function srcChanged() {
    if (srcMuted) return;
    lastSrcInput = Date.now();
    srcStale = true; S.ver++; srcBase.ver = S.ver; srcBase.tab = S.cur;
    if (!S.dirty) markDirty(true); else if (prefs.autosave) autoSave();
    onSourceChange(); updateCursorStatus();
    if (S.typewriter) later(typewriterSource);
    later(() => acCheck(srcEd));
  }
  function srcSel() { updateCursorStatus(); highlightOutlineBySource(); pushState(); }
  /* keys in source mode: list/quote continuation, table Tab, auto pair (CodeMirror handles the rest) */
  function srcKeys(e, ed) {
    if (acKey(e)) return;
    if (editorShortcuts(e, ed)) return;
    if (composing(e)) return;
    const k = e.key;
    if (k !== 'Tab' && k !== 'Enter' && !PAIRS[k] && !CLOSERS.has(k) && k !== 'Backspace') return;
    const p = ed.selectionStart;
    const inFence = edInFence(ed, p);
    if (!inFence && autoPair(e, ed)) return;
    if (k === 'Tab' && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      if (!inFence && srcTableTab(ed, e.shiftKey)) return;
      if (ed.selectionEnd > ed.selectionStart && ed.cm) { // indent / outdent selected lines
        const a = ed.lineAt(ed.selectionStart).n, b = ed.lineAt(ed.selectionEnd).n;
        const from = ed.line(a).from, to = ed.line(b).to;
        const txt = edSlice(ed, from, to).split('\n').map(l => e.shiftKey ? l.replace(/^( {1,4}|\t)/, '') : '    ' + l).join('\n');
        edReplace(ed, from, to, txt, from, from + txt.length); return;
      }
      indentKey(ed, e.shiftKey); return;
    }
    if (k === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      const c = lineCtx(ed);
      if (inFence) { if (!ed.cm) { const im = c.before.match(/^\s+/); if (im) { e.preventDefault(); insText(ed, '\n' + im[0]); } } return; }
      const lm = c.before.match(/^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?(.*)$/);
      if (lm) {
        e.preventDefault();
        if (!lm[5].trim() && c.p === c.le) { edReplace(ed, c.ls, c.p, '', c.ls); return; }
        let mk = lm[2]; if (/\d/.test(mk)) mk = (parseInt(mk, 10) + 1) + mk.slice(-1);
        insText(ed, '\n' + lm[1] + mk + lm[3] + (lm[4] ? '[ ] ' : '')); return;
      }
      const qm = c.before.match(/^(\s*>+\s?)(.*)$/);
      if (qm) { e.preventDefault(); if (!qm[2].trim()) { edReplace(ed, c.ls, c.p, '', c.ls); return; } insText(ed, '\n' + qm[1]); return; }
      if (!ed.cm) { const im = c.before.match(/^\s+/); if (im) { e.preventDefault(); insText(ed, '\n' + im[0]); } }
    }
  }
  function srcTableTab(ed, back) {
    const L = edLineAt(ed, ed.selectionStart);
    if (!/^\s*\|/.test(L.text)) return false;
    const cnt = edLineCount(ed);
    let a = L.n, b = L.n;
    while (a > 0 && /^\s*\|/.test(edLineN(ed, a - 1).text)) a--;
    while (b < cnt - 1 && /^\s*\|/.test(edLineN(ed, b + 1).text)) b++;
    if (b - a < 1) return false;
    const from = edLineN(ed, a).from, to = edLineN(ed, b).to; const tbl = edSlice(ed, from, to);
    if (!/^\s*\|?\s*:?-/.test(tbl.split('\n')[1] || '')) return false;
    const t = parseTable(tbl); let { row, col } = tablePos(tbl, ed.selectionStart - from); if (row < 0) row = 0;
    col += back ? -1 : 1; if (col >= t.n) { col = 0; row++; } if (col < 0) { col = t.n - 1; row = Math.max(0, row - 1); }
    if (row >= t.rows.length) t.rows.push(Array(t.n).fill(''));
    const out = buildTable(t);
    edReplace(ed, from, to, out, from + caretToCell(out, row, col));
    return true;
  }
  function typewriterSource() { if (srcEd && srcEd.cm) srcEd.scrollToPos(srcEd.selectionStart, 'center'); }
  function revealInSource(pos, end) { if (!srcEd) return; srcEd.focus(); srcEd.setSelectionRange(pos, end == null ? pos : end, true); if (!srcEd.cm) srcEd.scrollTop = caretXY(srcEd, pos).y - srcEd.clientHeight / 3; }
  /* --- line-accurate scroll position across modes (live / source / preview) --- */
  function topLine() {
    if (S.mode === 'live') {
      const top = writeScroll.getBoundingClientRect().top + 8, list = allBlks();
      let lo = 0, hi = list.length - 1, f = list.length ? 0 : -1;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (list[m].getBoundingClientRect().bottom > top) { f = m; hi = m - 1; } else lo = m + 1; }
      const b = f >= 0 && S.result && S.result.blocks[+list[f].dataset.i]; return b ? b.start : 0;
    }
    if (srcEd && srcEd.cm) { const v = srcEd.view; const blk = v.lineBlockAtHeight(v.scrollDOM.scrollTop - v.documentPadding.top + 4); return v.state.doc.lineAt(blk.from).number - 1; }
    if (srcEd) return Math.round(srcEd.scrollTop / srcEd.scrollHeight * (srcEd.value.split('\n').length));
    return 0;
  }
  function scrollSrcToLine(line) {
    if (!srcEd) return;
    if (srcEd.cm) { const v = srcEd.view; const l = v.state.doc.line(Math.max(1, Math.min(v.state.doc.lines, line + 1))); v.requestMeasure({ read: () => v.lineBlockAt(l.from).top, write: top => { v.scrollDOM.scrollTop = top + v.documentPadding.top - 4; } }); }
    else srcEd.scrollTop = line / Math.max(1, srcEd.value.split('\n').length) * srcEd.scrollHeight;
  }
  function scrollLiveToLine(line) {
    if (!S.result) return;
    const i = Math.max(0, findLastIdx(S.result.blocks, b => b.start <= line));
    const el = blkEl(i); if (el) scrollElIntoView(el, writeScroll, 'top');
  }
  function scrollPreviewToLine(line) {
    let best = null; for (const el of preview.children) { if (!el.dataset || el.dataset.s == null) continue; if (+el.dataset.s <= line) best = el; else break; }
    if (best) previewScroll.scrollTop = best.offsetTop - 12;
  }
  function onSrcScroll() {
    reposPopups();
    if (S.mode !== 'split' || syncLock) return;
    syncLock = true; scrollPreviewToLine(topLine()); setTimeout(() => syncLock = false, 60);
  }
  previewScroll.addEventListener('scroll', () => {
    updateOutlineCurrent();
    if (S.mode !== 'split' || syncLock) return;
    let line = 0; const top = previewScroll.scrollTop + 4;
    for (const el of preview.children) { if (el.dataset && el.dataset.s != null) { if (el.offsetTop + el.offsetHeight > top) { line = +el.dataset.s; break; } } }
    syncLock = true; scrollSrcToLine(line); setTimeout(() => syncLock = false, 60);
  });
  previewScroll.addEventListener('click', e => {
    const a = e.target.closest('a');
    if (a) { e.preventDefault(); if (a.classList.contains('wikilink')) return openWiki(a.dataset.wiki); const h = a.getAttribute('href') || ''; if (h.startsWith('#')) scrollToId(decodeURIComponent(h.slice(1))); else openLink(h); return; }
    if (e.target.classList.contains('copy-btn')) { navigator.clipboard.writeText(e.target.closest('.code-wrap').querySelector('code').innerText).then(() => toast('已复制代码')); return; }
    const pb = e.target.closest('.pb'); if (pb && srcEd && !window.getSelection().toString()) { const L = edLineN(srcEd, +pb.dataset.s); srcEd.focus(); srcEd.setSelectionRange(L.from, L.from, true); }
  });
  function jumpToLine(line) {
    if (S.mode === 'live') {
      if (S.editing) commit();
      const i = S.result.blocks.findIndex(b => line >= b.start && line < b.end);
      const el = blkEl(i < 0 ? 0 : i);
      if (el) { scrollElIntoView(el, writeScroll, 'center'); el.animate([{ background: 'rgba(255,213,79,.55)' }, { background: 'transparent' }], { duration: 1400 }); }
    } else if (srcEd) { const L = edLineN(srcEd, line); revealInSource(L.from, L.to); }
  }
  function scrollElIntoView(el, cont, where) {
    let n = 0;
    const step = () => {
      const r = el.getBoundingClientRect(), cr = cont.getBoundingClientRect();
      const target = where === 'center' ? cr.top + cr.height / 2 - Math.min(r.height, cr.height) / 2 : cr.top + 16;
      const d = r.top - target;
      if (Math.abs(d) > 2) cont.scrollTop += d;
      if (++n < 4 && Math.abs(d) > 2) requestAnimationFrame(step);
    };
    step();
  }

  /* ================= modes ================= */
  async function setMode(m) {
    if (S.editing) commit();
    const from = S.mode, line = topLine();
    if (m !== 'live' && !CMK.ok && !CMK.failed) { toast('正在加载 CodeMirror 编辑内核…', 1200); await loadCM(); }
    if (from !== 'live' && m === 'live') { const cur = S.src; if (srcEnterSnap != null && cur !== srcEnterSnap) { pushHist(srcEnterSnap); S.future = []; } srcEnterSnap = null; }
    S.mode = m;
    app.classList.remove('mode-live', 'mode-source', 'mode-split'); app.classList.add('mode-' + m);
    if (m === 'live') { renderLive(); requestAnimationFrame(() => scrollLiveToLine(line)); }
    else {
      srcCreate();
      if (srcBase.ver !== S.ver || srcBase.tab !== S.cur) srcEditorSet(S.src, true);
      if (from === 'live') srcEnterSnap = S.src;
      if (m === 'split') renderPreview(); else { S.result = MD.render(S.src, { prev: S.result }); updateOutline(); }
      requestAnimationFrame(() => { scrollSrcToLine(line); if (m === 'split') scrollPreviewToLine(line); srcFocus(); });
    }
    $$('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
    updateStatus();
  }

  /* ================= outline ================= */
  let olSig = '';
  function updateOutline() {
    const hs = (S.result && S.result.headings) || [];
    const box = $('#pane-outline');
    const sig = hs.map(h => h.level + h.id + '@' + h.line).join('|');
    if (sig === olSig && box.children.length) return; olSig = sig;
    olCur = null; headCache = null;
    if (!hs.length) { box.innerHTML = '<div class="side-empty">文档中还没有标题。<br>使用 <b>#</b> 至 <b>######</b> 创建标题，或按 <kbd>Ctrl</kbd>+<kbd>1</kbd>~<kbd>6</kbd>。</div>'; return; }
    const min = Math.min(...hs.map(h => h.level));
    box.innerHTML = hs.map(h => '<a class="ol-item ol-' + (h.level - min + 1) + '" data-id="' + esc(h.id) + '" data-line="' + h.line + '" style="padding-left:' + (14 + (h.level - min) * 14) + 'px">' + esc(h.text) + '</a>').join('');
    updateOutlineCurrent();
  }
  $('#pane-outline').addEventListener('click', e => {
    const a = e.target.closest('.ol-item'); if (!a) return;
    if (S.mode === 'live') scrollToId(a.dataset.id); else { jumpToLine(+a.dataset.line); if (S.mode === 'split') scrollPreviewToLine(+a.dataset.line); }
  });
  function scrollToId(id) {
    const root = S.mode === 'live' ? write : preview;
    const el = root.querySelector('[id="' + CSS.escape(id) + '"]');
    if (el) scrollElIntoView(el, S.mode === 'live' ? writeScroll : previewScroll, 'top');
  }
  /* current heading in the outline: binary search over cached heading elements (O(log n) per scroll) */
  let headCache = null, olCur = null;
  function headingEls(root) {
    if (!headCache || headCache.root !== root || headCache.ver !== olSig || (headCache.list[0] && !headCache.list[0].isConnected))
      headCache = { root, ver: olSig, list: Array.from(root.querySelectorAll('h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]')) };
    return headCache.list;
  }
  const updateOutlineCurrent = debounce(() => {
    if (S.mode === 'source') return;
    const box = $('#pane-outline'); if (!box.firstElementChild || !box.firstElementChild.classList.contains('ol-item')) return;
    const cont = S.mode === 'live' ? writeScroll : previewScroll; const root = S.mode === 'live' ? write : preview;
    const list = headingEls(root); if (!list.length) return;
    const top = cont.getBoundingClientRect().top + 80;
    let lo = 0, hi = list.length - 1, found = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (list[mid].getBoundingClientRect().top <= top) { found = mid; lo = mid + 1; } else hi = mid - 1; }
    const item = found >= 0 ? box.querySelector('.ol-item[data-id="' + CSS.escape(list[found].id) + '"]') : null;
    if (item !== olCur) { if (olCur) olCur.classList.remove('current'); if (item) item.classList.add('current'); olCur = item; }
  }, 100);
  function highlightOutlineBySource() {
    if (S.mode !== 'source' || !srcEd) return;
    const line = lineCtx(srcEd).n;
    const items = $$('.ol-item'); let cur = null;
    for (const it of items) if (+it.dataset.line <= line) cur = it;
    items.forEach(i => i.classList.toggle('current', i === cur));
  }
  writeScroll.addEventListener('scroll', updateOutlineCurrent);

  /* ================= status bar (heavy counters on idle) ================= */
  let statT = 0, lastCount = 0;
  function updateStatus() {
    $('#st-mode').textContent = { live: '实时预览', source: '源代码', split: '分屏' }[S.mode];
    $('#st-enc').textContent = S.enc || 'UTF-8';
    const eng = $('#st-engine'); eng.textContent = CMK.ok ? 'CodeMirror 6' : CMK.failed ? '基础编辑器' : '内核加载中…'; eng.classList.toggle('cm', CMK.ok);
    const libs = []; if (window.katex) libs.push('KaTeX'); if (window.mermaid) libs.push('Mermaid'); if (window.WaveDrom) libs.push('WaveDrom');
    $('#st-libs').textContent = libs.length ? libs.join(' · ') : '公式/图表：离线';
    $('#st-libs').title = '公式与图表渲染库：优先 lib/ 目录，其次联网 CDN';
    updateCursorStatus();
    clearTimeout(statT);
    const big = _src.length > 400000, wait = big ? Math.max(300, 2500 - (Date.now() - lastCount)) : 300;
    statT = setTimeout(() => idle(() => {
      lastCount = Date.now();
      const src = S.src, c = countWords(src);
      $('#st-words').textContent = c.words.toLocaleString() + ' 字';
      $('#st-chars').textContent = c.chars.toLocaleString() + ' 字符';
      $('#st-lines').textContent = (lineOfPos(src, src.length) + 1).toLocaleString() + ' 行';
      $('#st-read').textContent = '约 ' + Math.max(1, Math.round(c.words / 400)) + ' 分钟';
      const g = $('#st-goal');
      if (prefs.goal > 0) { const pc = Math.min(100, Math.round(c.words / prefs.goal * 100)); g.style.display = ''; g.innerHTML = '目标 ' + c.words + '/' + prefs.goal + '<span class="bar"><i style="width:' + pc + '%"></i></span>'; }
      else g.style.display = 'none';
    }), wait);
  }
  const selInfo = ed => { const n = ed.selectionEnd - ed.selectionStart; return n ? ' · 已选 ' + countWords(edSlice(ed, ed.selectionStart, Math.min(ed.selectionEnd, ed.selectionStart + 200000))).words + ' 字' : ''; };
  function updateCursorStatus() {
    if (S.mode === 'live' || !srcEd) { if (!S.editing) $('#st-pos').textContent = ''; return; }
    const c = lineCtx(srcEd);
    $('#st-pos').textContent = '行 ' + (c.n + 1) + '，列 ' + (c.p - c.ls + 1) + selInfo(srcEd);
  }
  function liveStatus() {
    const E = S.editing; if (!E || !E.ta) return;
    const c = lineCtx(E.ta);
    $('#st-pos').textContent = '行 ' + (E.start + c.n + 1) + '，列 ' + (c.p - c.ls + 1) + selInfo(E.ta);
  }

  /* ================= files ================= */
  const MD_EXT = /\.(md|markdown|mdown|mkd|txt)$/i;
  const IMG_EXT = /\.(png|jpe?g|gif|svg|webp|bmp)$/i;
  async function openFile() {
    if (hasFS) {
      try {
        const hs = await window.showOpenFilePicker({ multiple: true, types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown', '.mdown', '.txt'] } }] });
        for (const h of hs) {
          let p = null; if (S.dirHandle && S.dirHandle.resolve) { try { p = await S.dirHandle.resolve(h); } catch (e) { } }
          await openHandle(h, p);
        }
      } catch (e) { if (e.name !== 'AbortError') toast('打开失败: ' + e.message); }
    } else $('#file-input').click();
  }
  $('#file-input').addEventListener('change', async e => { for (const f of e.target.files) { const r = decodeBytes(await f.arrayBuffer()); await openDoc(r.text, f.name, null, null, null, r.encoding); } e.target.value = ''; });
  async function ensurePerm(h, mode) {
    if (!h.queryPermission) return true;
    if ((await h.queryPermission({ mode })) === 'granted') return true;
    return (await h.requestPermission({ mode })) === 'granted';
  }
  const hKey = h => h ? (h.__path ? pNorm(h.__path) : h.name) : '';
  async function fileMtime(h) { if (h.__path) return inv('file_mtime', { path: h.__path }); return (await h.getFile()).lastModified; }
  async function openHandle(fh, path, line) {
    try {
      if (!(await ensurePerm(fh, 'read'))) return toast('没有读取权限');
      const f = await fh.getFile(); const r = await readFileText(f);
      await openDoc(r.text, f.name, fh, path, line, r.encoding);
      try { S.mtime[hKey(fh)] = fh.__path ? await fileMtime(fh) : f.lastModified; } catch (e) { }
    } catch (e) { toast('无法打开: ' + (e.message || e)); }
  }
  async function save(silent) {
    if (S.editing) commit();
    if (!S.fileHandle) return saveAs();
    try {
      if (!(await ensurePerm(S.fileHandle, 'readwrite'))) throw new Error('没有写入权限');
      let enc = S.enc || 'UTF-8';
      if (!NATIVE && enc !== 'UTF-8') { enc = 'UTF-8'; S.enc = 'UTF-8'; toast('浏览器只能以 UTF-8 保存，已自动转换编码', 3000); }
      const src = S.src;
      const w = await S.fileHandle.createWritable(NATIVE ? { encoding: enc === 'UTF-8' ? null : enc } : undefined); await w.write(src); await w.close();
      try { S.mtime[hKey(S.fileHandle)] = await fileMtime(S.fileHandle); } catch (e) { }
      markDirty(false); persistSession(); histSnapshot(src, '保存'); linkIndexUpdateCurrent(); tasksTouch(); pushState();
      if (!silent) toast('已保存 ' + S.fileName + (enc !== 'UTF-8' ? '（' + enc + '）' : ''));
      updateStatus();
    } catch (e) { toast('保存失败: ' + (e.message || e), 4000); }
  }
  async function saveAs() {
    if (S.editing) commit();
    if (window.showSaveFilePicker) {
      try {
        const h = await window.showSaveFilePicker({ suggestedName: S.fileName, types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }] });
        S.fileHandle = h; S.fileName = h.name;
        if (S.dirHandle && S.dirHandle.resolve) { try { S.filePath = await S.dirHandle.resolve(h); } catch (e) { } }
        await save(); pushRecent({ kind: 'file', name: h.name, handle: h, path: S.filePath }); if (S.dirHandle) refreshTree();
        S.imgCache.clear(); rerender(true); watchSync();
      } catch (e) { if (e.name !== 'AbortError') toast('保存失败: ' + (e.message || e)); }
    } else { download(S.fileName, S.src, 'text/markdown'); markDirty(false); }
  }
  async function saveAll() {
    snapshot(); const cur = S.cur; let n = 0;
    for (let i = 0; i < S.tabs.length; i++) if (S.tabs[i].dirty && S.tabs[i].handle) { if (i !== S.cur) { S.cur = i; applyTab(S.tabs[i]); } await save(true); snapshot(); n++; }
    if (S.cur !== cur) { S.cur = cur; applyTab(S.tabs[cur]); }
    toast(n ? '已保存 ' + n + ' 个文件' : '没有需要保存的已关联文件');
  }
  /* external modification: native = file-system watcher events; web = check on window focus */
  let checkingExt = false;
  async function checkExternalChange() {
    const h = S.fileHandle; if (!h || checkingExt) return;
    const k = hKey(h), old = S.mtime[k]; if (!old) return;
    checkingExt = true;
    try {
      const m = await fileMtime(h);
      if (m > old + 1) {
        S.mtime[k] = m;
        if (S.dirty && !confirm('“' + S.fileName + '” 已被其他程序修改。\n是否重新加载？（当前未保存的修改将丢失）')) return;
        const f = await h.getFile(); const r = await readFileText(f); const t = r.text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
        if (t === S.src) return;
        dropEditing();
        const line = topLine();
        pushHist(S.src); S.src = t; S.ver++; S.enc = r.encoding; markDirty(false);
        if (S.mode !== 'live') srcEditorSet(t);
        rerender(); updateStatus(); toast('已载入外部修改：' + S.fileName);
        requestAnimationFrame(() => S.mode === 'live' ? scrollLiveToLine(line) : null);
      }
    } catch (e) { } finally { checkingExt = false; }
  }
  window.addEventListener('focus', () => { if (!NATIVE) setTimeout(checkExternalChange, 150); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !NATIVE) setTimeout(checkExternalChange, 150); });
  const watchSync = debounce(() => {
    if (!NATIVE) return;
    const files = new Set();
    S.tabs.forEach((t, i) => { const h = i === S.cur ? S.fileHandle : t.handle; if (h && h.__path) files.add(h.__path); });
    inv('watch_set', { files: Array.from(files), dirs: S.dirHandle ? [S.dirHandle.__path] : [] }).catch(() => { });
  }, 300);
  const fsPending = new Set();
  const onFsChanged = debounce(() => {
    const ps = Array.from(fsPending); fsPending.clear();
    let treeDirty = false, imgs = false;
    for (const p of ps) {
      const k = pNorm(p);
      if (IMG_EXT.test(p)) { imgs = true; for (const [key, url] of S.imgCache) if (pNorm(key.split('|')[0] + '\\' + key.split('|')[1]).endsWith(k.split('\\').pop())) { URL.revokeObjectURL(url); S.imgCache.delete(key); } }
      if (S.fileHandle && hKey(S.fileHandle) === k) checkExternalChange();
      else S.tabs.forEach((t, i) => { if (i !== S.cur && t.handle && hKey(t.handle) === k) t.stale = true; });
      if (S.dirHandle && k.startsWith(pNorm(S.dirHandle.__path) + '\\') && (MD_EXT.test(p) || IMG_EXT.test(p) || !/\.\w+$/.test(p))) treeDirty = true;
    }
    if (imgs) rerender(true);
    if (treeDirty) { refreshTree(); linkIndexBuild(); tasksTouch(); }
  }, 350);

  async function openFolder(handle) {
    try {
      const h = handle || await window.showDirectoryPicker({ mode: 'readwrite' });
      if (!(await ensurePerm(h, 'readwrite'))) return toast('没有文件夹访问权限');
      S.dirHandle = h; S.imgCache.clear();
      await refreshTree(); setSideTab('files'); if (!prefs.side) toggleSide(true);
      pushRecent({ kind: 'dir', name: h.name, handle: h }); persistSession();
      for (const t of S.tabs) if (t.handle && !t.path && h.resolve) { try { t.path = await h.resolve(t.handle); } catch (e) { } }
      if (S.fileHandle && !S.filePath && h.resolve) { try { S.filePath = await h.resolve(S.fileHandle); if (S.filePath) { markDirty(S.dirty); rerender(true); } } catch (e) { } }
      watchSync(); linkIndexBuild(); tasksTouch(); pushState();
      toast('已打开文件夹 ' + h.name);
    } catch (e) { if (e.name !== 'AbortError') toast('打开文件夹失败: ' + (e.message || e)); }
  }
  async function scanDir(h, path, depth) {
    const dirs = [], files = [], imgs = [];
    if (depth > 8) return { dirs, files, imgs };
    for await (const [name, ch] of h.entries()) {
      if (name.startsWith('.') || name === 'node_modules' || name === '__pycache__' || name === 'target') continue;
      if (ch.kind === 'directory') { const sub = await scanDir(ch, path.concat(name), depth + 1); dirs.push({ name, handle: ch, parent: h, path: path.concat(name), ...sub }); }
      else if (MD_EXT.test(name)) files.push({ name, handle: ch, parent: h, path: path.concat(name) });
      else if (IMG_EXT.test(name)) imgs.push({ name, handle: ch, parent: h, path: path.concat(name) });
    }
    const cmp = (a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true });
    dirs.sort(cmp); files.sort(cmp); return { dirs, files, imgs };
  }
  const openDirs = new Set();
  async function refreshTree() {
    if (!S.dirHandle) return renderFilesEmpty();
    const pane = $('#tree');
    if (!pane.querySelector('.tree-item')) pane.innerHTML = '<div class="side-empty">正在扫描…</div>';
    const t = await scanDir(S.dirHandle, [], 0);
    S.treeFiles = []; S.treeNodes = []; S.treeImages = [];
    const build = node => {
      let h = '';
      S.treeImages.push(...node.imgs);
      for (const d of node.dirs) {
        const k = S.treeNodes.push(d) - 1; const key = d.path.join('/');
        h += '<div class="tree-dir' + (openDirs.has(key) ? ' open' : '') + '" data-key="' + esc(key) + '"><div class="tree-item" data-n="' + k + '" title="' + esc(key) + '"><span class="chev">' + IC('chev') + '</span>' + IC('folder') + '<span class="nm">' + esc(d.name) + '</span></div><div class="tree-children">' + build(d) + '</div></div>';
      }
      for (const f of node.files) { S.treeFiles.push(f); const k = S.treeNodes.push(f) - 1; h += '<div class="tree-item tree-file" data-n="' + k + '" data-path="' + esc(f.path.join('/')) + '" title="' + esc(f.path.join('/')) + '"><span class="chev"></span>' + IC('file') + '<span class="nm">' + esc(f.name.replace(/\.md$/i, '')) + '</span></div>'; }
      return h;
    };
    const body = build(t);
    S.treeNodes.push({ root: true, handle: S.dirHandle, path: [], name: S.dirHandle.name });
    pane.innerHTML = '<div class="tree-item tree-root" data-n="' + (S.treeNodes.length - 1) + '">' + IC('folder') + '<span class="nm">' + esc(S.dirHandle.name) + '</span><span style="color:var(--muted);font-weight:400;margin-left:auto;font-size:11.5px">' + S.treeFiles.length + ' 篇</span></div>' + body;
    if (S.filePath) $$('#tree .tree-item').forEach(x => x.classList.toggle('active', x.dataset.path === S.filePath.join('/')));
    $('#side-filter').dispatchEvent(new Event('input'));
  }
  $('#tree').addEventListener('click', e => {
    const rc = e.target.closest('.recent-item');
    if (rc) { const x = ($('#tree')._recent || [])[+rc.dataset.r]; if (x && x.handle) { x.kind === 'dir' ? openFolder(x.handle) : openHandle(x.handle, null); } return; }
    const it = e.target.closest('.tree-item'); if (!it) return;
    const n = S.treeNodes[+it.dataset.n]; if (!n) return;
    if (it.classList.contains('tree-file')) openHandle(n.handle, n.path);
    else if (it.parentElement.classList.contains('tree-dir')) { const d = it.parentElement; d.classList.toggle('open'); d.classList.contains('open') ? openDirs.add(d.dataset.key) : openDirs.delete(d.dataset.key); }
  });
  $('#tree').addEventListener('contextmenu', e => {
    const it = e.target.closest('.tree-item'); if (!it) return; e.preventDefault();
    const n = S.treeNodes[+it.dataset.n]; if (!n) return;
    const isFile = it.classList.contains('tree-file');
    const nat = NATIVE ? [['-'], ['reveal', '在资源管理器中显示']] : [];
    const items = isFile ? [['open', '打开'], ['-'], ['rename', '重命名…（自动更新链接）'], ['dup', '创建副本'], ['delete', '删除'], ['-'], ['copypath', '复制相对路径'], ['copylink', '复制为 Markdown 链接'], ['copywiki', '复制为 [[双链]]']].concat(nat)
      : [['newfile', '新建 Markdown 文件…'], ['newtpl', '从模板新建…'], ['newdir', '新建文件夹…'], ['-'], ['refresh', '刷新']].concat(n.root ? [] : [['-'], ['rename', '重命名…'], ['delete', '删除文件夹']]).concat(nat);
    showCtx(e.clientX, e.clientY, items, act => treeAction(act, n, isFile));
  });
  function showCtx(x, y, items, cb) {
    const m = $('#ctx'); m.innerHTML = items.map(([k, t]) => k === '-' ? '<hr>' : '<div data-k="' + k + '">' + t + '</div>').join('');
    m.classList.add('show'); m.style.left = Math.min(x, innerWidth - m.offsetWidth - 6) + 'px'; m.style.top = Math.min(y, innerHeight - m.offsetHeight - 6) + 'px';
    m.onclick = e => { const d = e.target.closest('[data-k]'); if (d) { m.classList.remove('show'); cb(d.dataset.k); } };
  }
  document.addEventListener('mousedown', e => { if (!e.target.closest('#ctx')) $('#ctx').classList.remove('show'); });
  async function createFileIn(dirH, dirPath, name, content) {
    if (!MD_EXT.test(name)) name += '.md';
    try { await dirH.getFileHandle(name); if (!confirm('“' + name + '” 已存在，是否打开它？')) return; const fh0 = await dirH.getFileHandle(name); await refreshTree(); return openHandle(fh0, dirPath.concat(name)); } catch (e) { }
    const fh = await dirH.getFileHandle(name, { create: true }); const w = await fh.createWritable(); await w.write(content); await w.close();
    if (dirPath.length) openDirs.add(dirPath.join('/'));
    await refreshTree(); return openHandle(fh, dirPath.concat(name));
  }
  async function treeAction(act, n, isFile) {
    try {
      if (act === 'open') return openHandle(n.handle, n.path);
      if (act === 'refresh') return refreshTree();
      if (act === 'reveal') return inv('reveal', { path: n.handle.__path });
      if (act === 'copypath') { await navigator.clipboard.writeText(n.path.join('/')); return toast('已复制路径'); }
      if (act === 'copylink') { const rel = relPath(n.path); await navigator.clipboard.writeText('[' + n.name.replace(MD_EXT, '') + '](' + encodeURI(rel) + ')'); return toast('已复制链接 ' + rel); }
      if (act === 'copywiki') { await navigator.clipboard.writeText('[[' + n.name.replace(MD_EXT, '') + ']]'); return toast('已复制双链'); }
      if (act === 'newtpl') return showTemplates({ dir: n.handle, path: n.path });
      if (act === 'newfile' || act === 'newdir') {
        const name = prompt(act === 'newfile' ? '新文件名：' : '新文件夹名：', act === 'newfile' ? '新建文档.md' : '新建文件夹'); if (!name) return;
        if (act === 'newdir') { await n.handle.getDirectoryHandle(name, { create: true }); if (n.path.length) openDirs.add(n.path.join('/')); return refreshTree(); }
        return createFileIn(n.handle, n.path, name, '# ' + name.replace(MD_EXT, '') + '\n\n');
      }
      if (act === 'dup') {
        const base = n.name.replace(MD_EXT, ''), ext = (n.name.match(MD_EXT) || ['.md'])[0];
        const src = await readFileText(await n.handle.getFile());
        const fh = await n.parent.getFileHandle(base + ' 副本' + ext, { create: true }); const w = await fh.createWritable(); await w.write(src.text); await w.close();
        return refreshTree();
      }
      if (act === 'rename') {
        const nn = prompt('重命名为：', n.name); if (!nn || nn === n.name) return;
        let newHandle = n.handle;
        if (n.handle.move) await n.handle.move(nn);
        else if (isFile) { const src = await readFileText(await n.handle.getFile()); newHandle = await n.parent.getFileHandle(nn, { create: true }); const w = await newHandle.createWritable(); await w.write(src.text); await w.close(); await n.parent.removeEntry(n.name); }
        else return toast('当前浏览器不支持重命名文件夹');
        const oldKey = n.path.join('/'), newPath = n.path.slice(0, -1).concat(nn);
        S.tabs.forEach((t, i) => { const p = i === S.cur ? S.filePath : t.path; if (p && p.join('/') === oldKey) { t.path = newPath; t.name = nn; t.handle = newHandle; if (i === S.cur) { S.filePath = newPath; S.fileName = nn; S.fileHandle = newHandle; markDirty(S.dirty); } } });
        toast('已重命名'); await refreshTree();
        if (isFile && MD_EXT.test(nn)) await updateLinksAfterRename(oldKey, newPath.join('/'));
        watchSync(); return;
      }
      if (act === 'delete') {
        if (!confirm('确定删除 “' + n.name + '” 吗？此操作不可撤销。')) return;
        await n.parent.removeEntry(n.name, { recursive: !isFile });
        const key = n.path.join('/');
        for (let i = S.tabs.length - 1; i >= 0; i--) { const p = i === S.cur ? S.filePath : S.tabs[i].path; if (p && (p.join('/') === key || p.join('/').startsWith(key + '/'))) closeTab(i, true); }
        toast('已删除'); return refreshTree();
      }
    } catch (e) { toast('操作失败: ' + (e.message || e), 3500); }
  }
  function relPath(target, fromPath) {
    const from = (fromPath || S.filePath || []).slice(0, -1); let i = 0;
    while (i < from.length && i < target.length - 1 && from[i] === target[i]) i++;
    return '../'.repeat(from.length - i) + target.slice(i).join('/');
  }
  $('#side-filter').addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    $$('#tree .tree-file').forEach(x => x.style.display = !q || x.dataset.path.toLowerCase().includes(q) ? '' : 'none');
    if (q) $$('#tree .tree-dir').forEach(d => d.classList.add('open'));
  });

  async function getRecent() { return ((await idb.get('recent')) || []).map(x => Object.assign({}, x, { handle: unpackH(x.handle) })); }
  async function pushRecent(item) {
    const r = await getRecent();
    const key = x => x.kind + ':' + (x.handle && x.handle.__path ? pNorm(x.handle.__path) : x.path ? x.path.join('/') : x.name);
    const out = [Object.assign({ t: Date.now() }, item)];
    for (const x of r) {
      if (out.length >= 15) break;
      let same = key(x) === key(item);
      if (!same && x.handle && item.handle && x.kind === item.kind && !NATIVE) { try { same = await x.handle.isSameEntry(item.handle); } catch (e) { } }
      if (!same) out.push(x);
    }
    await idb.set('recent', out.map(x => Object.assign({}, x, { handle: packH(x.handle) })));
    if (!S.dirHandle) renderFilesEmpty();
  }
  async function renderFilesEmpty(extra) {
    if (S.dirHandle) return;
    const r = await getRecent();
    const pane = $('#tree');
    let h = extra || '';
    h += '<div class="side-empty">尚未打开文件夹。<br>打开文件夹后可使用文件树、双链与关系图谱、待办汇总、全局搜索，粘贴的图片会自动保存到 <code>assets/</code>。<br><button class="btn" data-act="folder">' + IC('folder') + '打开文件夹</button></div>';
    if (r.length) h += '<div class="recent-title">最近使用</div>' + r.map((x, i) => '<div class="recent-item" data-r="' + i + '" title="' + esc(x.handle && x.handle.__path ? x.handle.__path : x.name) + '">' + IC(x.kind === 'dir' ? 'folder' : 'file') + '<span class="nm">' + esc(x.name) + '</span>' + (x.handle && x.handle.__path ? '<small>' + esc(dirName(x.handle.__path)) + '</small>' : x.path && x.path.length > 1 ? '<small>' + esc(x.path.slice(0, -1).join('/')) + '</small>' : '') + '</div>').join('');
    pane.innerHTML = h; pane._recent = r;
  }

  /* ---- quick open (Ctrl+P) · command palette (>) · calculator (=) ---- */
  const QO = { list: [], all: [], sel: 0, mode: 'file' };
  function fuzzy(q, s) {
    if (!q) return { score: 0, html: esc(s) };
    let qi = 0, score = 0, last = -2, html = ''; const ls = s.toLowerCase();
    for (let i = 0; i < s.length; i++) { if (qi < q.length && ls[i] === q[qi]) { score += (i === last + 1 ? 5 : 1) + (i === 0 ? 3 : 0); last = i; qi++; html += '<b>' + esc(s[i]) + '</b>'; } else html += esc(s[i]); }
    return qi === q.length ? { score, html } : null;
  }
  async function quickOpen() {
    QO.all = []; QO.mode = 'file';
    showQO('输入文件名快速打开 · 输入 > 执行命令 · 输入 = 计算（支持 0x/0b、位运算）');
    const recent = await getRecent();
    const seen = new Set();
    for (const f of S.treeFiles) { seen.add(f.path.join('/')); QO.all.push({ name: f.name, sub: f.path.slice(0, -1).join('/'), handle: f.handle, path: f.path }); }
    for (const x of recent) { if (x.kind !== 'file') continue; const k = x.path ? x.path.join('/') : (x.handle && x.handle.__path) || x.name; if (seen.has(k)) continue; seen.add(k); QO.all.push({ name: x.name, sub: x.handle && x.handle.__path ? dirName(x.handle.__path) : '最近', handle: x.handle, path: x.path }); }
    S.tabs.forEach((t, i) => { if (!t.handle && !t.path) QO.all.push({ name: i === S.cur ? S.fileName : t.name, sub: '标签页', tab: i }); });
    if (QO.mode === 'file') qoFilter();
  }
  function commandPalette() {
    QO.mode = 'cmd';
    QO.all = $$('.dropdown .it').filter(it => !it.classList.contains('native-only') || NATIVE).map(it => {
      let grp = it.closest('.menu').querySelector(':scope>button').textContent;
      for (let p = it.previousElementSibling; p; p = p.previousElementSibling) { if (p.classList.contains('grp')) { grp += ' · ' + p.textContent; break; } if (p.classList.contains('sep')) break; }
      const kbd = it.querySelector('kbd'); const label = it.childNodes[0].textContent.trim();
      return { name: label, sub: grp, kbd: kbd ? kbd.textContent : '', el: it };
    });
    showQO('输入命令…（例如：导出、主题、图谱、历史、AI）');
  }
  function showQO(ph, keep) { $('#qo').classList.add('show'); const inp = $('#qo input'); inp.placeholder = ph; if (!keep) inp.value = ''; inp.focus(); qoFilter(); }
  function calc(expr) {
    let e = expr.replace(/\s+/g, '').replace(/×/g, '*').replace(/÷/g, '/');
    if (!e || !/^[0-9a-fA-FxXbBoO+\-*/%()<>&|^~.kKmM]+$/.test(e)) return null;
    e = e.replace(/(\d+(?:\.\d+)?)([kKmM])\b/g, (_, n, u) => '(' + n + '*' + ({ k: 1024, m: 1048576 })[u.toLowerCase()] + ')');
    const intOnly = !/[./]/.test(e) && !/\*\*/.test(e);
    try {
      if (intOnly) {
        const be = e.replace(/0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|\d+/g, m => 'BigInt("' + m + '")');
        const v = Function('"use strict";return (' + be + ')')();
        if (typeof v !== 'bigint') return null;
        const neg = v < 0n, a = neg ? -v : v;
        const tc = neg ? (v & 0xFFFFFFFFn).toString(16).toUpperCase() : null;
        return { dec: v.toString(), hex: (neg ? '-' : '') + '0x' + a.toString(16).toUpperCase(), bin: (neg ? '-' : '') + '0b' + a.toString(2).replace(/\B(?=(\d{4})+(?!\d))/g, '_'), extra: tc ? '32 位补码 0x' + tc.padStart(8, '0') : (a < 2n ** 32n ? 'bit 数 ' + a.toString(2).length : '') };
      }
      const v = Function('"use strict";return (' + e.replace(/0[bB]([01]+)/g, (_, b) => parseInt(b, 2)) + ')')();
      if (typeof v !== 'number' || !isFinite(v)) return null;
      return { dec: String(+v.toPrecision(12)), hex: Number.isInteger(v) ? '0x' + Math.abs(v).toString(16).toUpperCase() : '', bin: '', extra: '' };
    } catch (err) { return null; }
  }
  function qoFilter() {
    let q = $('#qo input').value.trim();
    if (q.startsWith('=')) {
      const r = calc(q.slice(1)); QO.mode = 'calc'; QO.calc = r;
      $('#qo-list').innerHTML = '<div class="qo-calc">' + (r ? '<b>' + esc(r.dec) + '</b>' + (r.hex ? '　' + esc(r.hex) : '') + (r.bin ? '<br>' + esc(r.bin) : '') + (r.extra ? '<br>' + esc(r.extra) : '') + '<br><span style="color:var(--muted);font-family:var(--ui-font);font-size:12px">Enter 插入十进制结果 · Shift+Enter 插入十六进制 · 支持 + - * / % ** &lt;&lt; &gt;&gt; &amp; | ^ ~ 与 k/M 后缀</span>' : '<span style="color:var(--muted)">输入表达式，例如 =0x3F &lt;&lt; 4 | 0b1010</span>') + '</div>';
      return;
    }
    if (QO.mode === 'calc') QO.mode = 'file';
    q = q.toLowerCase();
    if (QO.mode === 'file' && q.startsWith('>')) { commandPalette(); $('#qo input').value = q.slice(1); q = q.slice(1).trim(); }
    if (QO.mode === 'cmd') q = q.replace(/^>/, '');
    QO.list = QO.all.map(x => { const f = fuzzy(q, x.name) || (QO.mode === 'cmd' ? (fuzzy(q, x.sub + ' ' + x.name) && { score: -1, html: esc(x.name) }) : null); return f ? Object.assign({}, x, f) : null; }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 80);
    QO.sel = 0; qoDraw();
  }
  function qoDraw() {
    $('#qo-list').innerHTML = QO.list.length ? QO.list.map((x, i) => '<div class="qo-it' + (i === QO.sel ? ' sel' : '') + '" data-i="' + i + '">' + (QO.mode === 'cmd' ? '' : IC('file')) + '<span>' + x.html + '</span>' + (QO.mode === 'cmd' ? '<small>' + esc(x.sub) + (x.kbd ? ' · ' + esc(x.kbd) : '') + '</small>' : '<small>' + esc(x.sub || '') + '</small>') + '</div>').join('')
      : '<div class="qo-it"><small style="margin:0">' + (QO.mode === 'cmd' ? '没有匹配的命令' : S.dirHandle ? '没有匹配的文件' : '提示：先打开文件夹，即可在此快速搜索全部文档') + '</small></div>';
    const s = $('#qo-list .sel'); if (s) s.scrollIntoView({ block: 'nearest' });
  }
  function qoPick(i, shift) {
    if (QO.mode === 'calc') { const r = QO.calc; $('#qo').classList.remove('show'); if (!r) return; const v = shift && r.hex ? r.hex : r.dec; insertAtCursor(v); return; }
    const x = QO.list[i]; $('#qo').classList.remove('show'); if (!x) return;
    if (QO.mode === 'cmd') { x.el.click(); return; }
    if (x.tab != null) switchTab(x.tab); else openHandle(x.handle, x.path);
  }
  $('#qo input').addEventListener('input', qoFilter);
  $('#qo input').addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); QO.sel = Math.min(QO.list.length - 1, QO.sel + 1); qoDraw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); QO.sel = Math.max(0, QO.sel - 1); qoDraw(); }
    else if (e.key === 'Enter' && !composing(e)) { e.preventDefault(); qoPick(QO.sel, e.shiftKey); }
    else if (e.key === 'Escape') $('#qo').classList.remove('show');
  });
  $('#qo-list').addEventListener('mousedown', e => { const it = e.target.closest('[data-i]'); if (it) { e.preventDefault(); qoPick(+it.dataset.i); } });
  $('#qo input').addEventListener('blur', () => setTimeout(() => $('#qo').classList.remove('show'), 150));
  /* insert text at the current caret (block editor, source editor, or append as a new paragraph) */
  function insertAtCursor(text) {
    const ed = S.editing ? S.editing.ta : (S.mode !== 'live' ? srcEd : null);
    if (ed) { ed.focus(); insText(ed, text); return; }
    insertSnippet(text);
  }

  /* ---- global search (desktop: Rust walker) ---- */
  let gsSeq = 0;
  async function globalSearch() {
    const q = $('#gs-q').value; const box = $('#gs-res'); const seq = ++gsSeq;
    if (!q) { box.innerHTML = ''; return; }
    if (!S.dirHandle) { box.innerHTML = '<div class="side-empty">请先打开文件夹。</div>'; return; }
    const isRe = $('#gs-re').checked;
    let re; try { re = new RegExp(isRe ? q : reEsc(q), 'gi'); } catch (e) { box.innerHTML = '<div class="sr-sum">正则表达式有误</div>'; return; }
    box.innerHTML = '<div class="sr-sum">搜索中…</div>';
    const t0 = performance.now();
    const groups = new Map();
    const fileByKey = new Map(S.treeFiles.map(f => [f.path.join('/'), f]));
    const openText = key => { const ti = S.tabs.findIndex((t, i) => { const p = i === S.cur ? S.filePath : t.path; return p && p.join('/') === key; }); return ti < 0 ? null : (ti === S.cur ? S.src : S.tabs[ti].src); };
    function scanText(key, f, text) {
      re.lastIndex = 0; if (!re.test(text)) return;
      const lines = text.split('\n'); const hits = [];
      for (let ln = 0; ln < lines.length && hits.length < 30; ln++) { re.lastIndex = 0; if (re.test(lines[ln])) hits.push({ ln, text: lines[ln] }); }
      if (hits.length) groups.set(key, { f, hits });
    }
    if (NATIVE) {
      try {
        const hits = await inv('search_dir', { root: S.dirHandle.__path, pattern: q, isRegex: isRe, caseSensitive: false, max: 3000 });
        if (seq !== gsSeq) return;
        for (const h of hits) { const rel = relFromRoot(S.dirHandle.__path, h.path); if (!rel) continue; const key = rel.join('/'); const f = fileByKey.get(key) || { name: baseName(h.path), handle: new NFile(h.path), path: rel }; if (!groups.has(key)) groups.set(key, { f, hits: [] }); groups.get(key).hits.push({ ln: h.line, text: h.text }); }
        for (const [key] of fileByKey) { const t = openText(key); if (t == null) continue; groups.delete(key); scanText(key, fileByKey.get(key), t); }
      } catch (e) { box.innerHTML = '<div class="sr-sum">搜索失败：' + esc(String(e)) + '</div>'; return; }
    } else {
      for (const f of S.treeFiles) {
        if (seq !== gsSeq) return;
        const key = f.path.join('/'); let text = openText(key);
        if (text == null) { try { text = (await readFileText(await f.handle.getFile())).text; } catch (e) { continue; } }
        scanText(key, f, text);
      }
    }
    if (seq !== gsSeq) return;
    let html = '', nh = 0; S.gs = [];
    for (const [, g] of groups) {
      const k = S.gs.push({ f: g.f, ln: 0 }) - 1;
      html += '<div class="sr-file" data-g="' + k + '">' + IC('file') + esc(g.f.name) + ' <small>' + esc(g.f.path.slice(0, -1).join('/')) + ' · ' + g.hits.length + '</small></div>';
      for (const h of g.hits.slice(0, 30)) {
        nh++; const s = h.text.length > 160 ? h.text.slice(0, 160) : h.text; const kk = S.gs.push({ f: g.f, ln: h.ln }) - 1;
        re.lastIndex = 0; let out = '', last = 0, m; while ((m = re.exec(s))) { if (!m[0].length) { re.lastIndex++; continue; } out += esc(s.slice(last, m.index)) + '<b>' + esc(m[0]) + '</b>'; last = re.lastIndex; }
        html += '<div class="sr-line" data-g="' + kk + '"><i>' + (h.ln + 1) + '</i>' + out + esc(s.slice(last)) + '</div>';
      }
    }
    box.innerHTML = '<div class="sr-sum">' + groups.size + ' 个文件 · ' + nh + ' 处匹配 · ' + Math.round(performance.now() - t0) + ' ms</div>' + html;
  }
  $('#gs-q').addEventListener('keydown', e => { if (e.key === 'Enter') globalSearch(); });
  $('#gs-q').addEventListener('input', debounce(globalSearch, 350));
  $('#gs-re').addEventListener('change', globalSearch);
  $('#gs-res').addEventListener('click', e => { const it = e.target.closest('[data-g]'); if (!it) return; const g = S.gs[+it.dataset.g]; openHandle(g.f.handle, g.f.path, g.ln); });

  /* ---- drag & drop (web) ---- */
  let dragN = 0;
  window.addEventListener('dragenter', e => { e.preventDefault(); dragN++; $('#drop-mask').classList.add('show'); });
  window.addEventListener('dragleave', () => { if (--dragN <= 0) { dragN = 0; $('#drop-mask').classList.remove('show'); } });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', async e => {
    e.preventDefault(); dragN = 0; $('#drop-mask').classList.remove('show');
    const items = Array.from(e.dataTransfer.items || []);
    if (items.length && items[0].getAsFileSystemHandle) {
      const hs = await Promise.all(items.map(i => i.getAsFileSystemHandle()));
      for (const h of hs) {
        if (!h) continue;
        if (h.kind === 'directory') { await openFolder(h); continue; }
        const f = await h.getFile();
        if (/^image\//.test(f.type)) { insertDroppedImage(f); continue; }
        let p = null; if (S.dirHandle && S.dirHandle.resolve) { try { p = await S.dirHandle.resolve(h); } catch (er) { } }
        await openHandle(h, p);
      }
      return;
    }
    for (const f of e.dataTransfer.files) { if (/^image\//.test(f.type)) insertDroppedImage(f); else { const r = decodeBytes(await f.arrayBuffer()); await openDoc(r.text, f.name, null, null, null, r.encoding); } }
  });
  function insertDroppedImage(f) {
    const ed = S.editing ? S.editing.ta : (S.mode !== 'live' ? srcEd : null);
    if (!ed) { toast('请先单击段落进入编辑，再拖入图片'); return; }
    onPaste({ preventDefault() { }, clipboardData: { items: [{ type: f.type, getAsFile: () => f }], getData: () => '' } }, ed);
  }
  async function openPaths(paths) {
    for (const p of paths || []) {
      let k; try { k = await inv('path_kind', { path: p }); } catch (e) { continue; }
      if (k === 'dir') { await openFolder(new NDir(p)); continue; }
      if (k !== 'file') continue;
      if (IMG_EXT.test(p)) { insertDroppedImage(await new NFile(p).getFile()); continue; }
      if (!MD_EXT.test(p) && !confirm('“' + baseName(p) + '” 不是 Markdown 文件，仍以文本方式打开吗？')) continue;
      const fh = new NFile(p); let rel = null;
      if (S.dirHandle && S.dirHandle.resolve) { try { rel = await S.dirHandle.resolve(fh); } catch (e) { } }
      await openHandle(fh, rel);
    }
  }

  /* ================= export: HTML / PDF ================= */
  const baseOut = () => S.fileName.replace(/\.\w+$/, '');
  /* rendered document as a detached DOM (diagrams from cache, images restored to their real sources) */
  async function renderedDom(opts) {
    opts = opts || {};
    const div = document.createElement('div'); div.innerHTML = MD.render(S.src).html;
    const theme = isDark() ? 'd' : 'l';
    div.querySelectorAll('.mermaid').forEach(m => { const c = S.mermaidCache.get(theme + m.dataset.code) || S.mermaidCache.get('l' + m.dataset.code); if (c) m.innerHTML = c; });
    div.querySelectorAll('.wavedrom').forEach(m => { const c = S.mermaidCache.get('w' + m.dataset.code); if (c) m.innerHTML = c; });
    div.querySelectorAll('.copy-btn,.ln').forEach(b => b.remove());
    for (const img of div.querySelectorAll('img[data-src]')) {
      const src = img.getAttribute('data-src'); img.classList.remove('img-pending'); img.removeAttribute('loading');
      if (opts.inline) { const b = await imageBytes(src); if (b) img.src = 'data:' + b.mime + ';base64,' + bytesToB64(b.bytes); else img.src = src; }
      else img.src = src;
      if (opts.keepData !== true) img.removeAttribute('data-src');
      if (!img.getAttribute('class')) img.removeAttribute('class');
    }
    return div;
  }
  function exportHtmlString(bodyHtml, extraCss, extraJs) {
    const css = document.getElementById('mdv-style').textContent + (document.getElementById('user-theme') ? document.getElementById('user-theme').textContent : '');
    const katexCss = Array.from(document.querySelectorAll('link[href*="katex"]')).map(l => '<link rel="stylesheet" href="' + l.href + '">').join('');
    return '<!DOCTYPE html>\n<html lang="zh-CN" data-theme="' + prefs.theme + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="generator" content="MDView ' + VERSION + '"><title>' + esc(baseOut()) + '</title>' + katexCss +
      '<style>' + css + '\nhtml,body{overflow:auto;height:auto}.copy-btn{display:none}' + (extraCss || '') + '</style></head><body>' + bodyHtml + (extraJs ? '<script>' + extraJs + '<\/script>' : '') + '</body></html>';
  }
  const articleWrap = inner => '<article class="md' + (prefs.codeLines ? ' code-lines' : '') + (prefs.autoNum ? ' autonum' : '') + '" id="write" style="max-width:var(--width);margin:0 auto;padding:48px 32px;font-size:var(--size);line-height:var(--lh);font-family:var(--font)">' + inner + '</article>';
  async function exportHtml(inline) {
    if (S.editing) commit();
    const div = await renderedDom({ inline });
    await saveOut(baseOut() + '.html', exportHtmlString(articleWrap(div.innerHTML)), 'html', 'HTML', 'text/html');
  }
  function exportPdf() {
    if (S.editing) commit();
    const prev = S.mode; const go = () => { window.print(); if (prev !== 'live') setMode(prev); };
    if (prev !== 'live') setMode('live').then(() => setTimeout(go, 400)); else setTimeout(go, 100);
  }
