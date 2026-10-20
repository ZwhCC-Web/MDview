  /* ================= part 4: find, links & graph, history, slides, lint, themes, prefs, menus, init ================= */
  const F = { hits: [], cur: -1 };
  function openFind(replace) {
    $('#find').classList.add('show'); $('#find-rep-row').style.display = replace ? 'flex' : 'none';
    let sel = '';
    const ed = S.editing ? S.editing.ta : (S.mode !== 'live' ? srcEd : null);
    if (ed && ed.selectionEnd > ed.selectionStart) sel = edSlice(ed, ed.selectionStart, Math.min(ed.selectionEnd, ed.selectionStart + 200));
    else if (S.mode === 'live') sel = String(window.getSelection());
    if (sel && !sel.includes('\n')) $('#find-q').value = sel;
    $('#find-q').focus(); $('#find-q').select(); doFind();
  }
  function closeFind() { $('#find').classList.remove('show'); clearHits(); if (S.mode !== 'live' && srcEd) srcFocus(); }
  function buildRe() {
    const q = $('#find-q').value; if (!q) return null;
    try { return new RegExp($('#find-re').checked ? q : reEsc(q), 'g' + ($('#find-case').checked ? '' : 'i')); } catch (e) { return null; }
  }
  function clearHits() {
    [write, preview].forEach(root => root.querySelectorAll('mark.search-hit').forEach(m => { const p = m.parentNode; m.replaceWith(document.createTextNode(m.textContent)); p && p.normalize(); }));
    if (srcEd && srcEd.cm) srcEd.setHits([], -1);
  }
  function doFind() {
    clearHits(); F.hits = []; F.cur = -1;
    const re = buildRe(); if (!re) { $('#find-cnt').textContent = ''; return; }
    if (S.mode !== 'live' && srcEd) {
      const v = S.src; let m;
      while ((m = re.exec(v)) && F.hits.length < 20000) { if (!m[0].length) { re.lastIndex++; continue; } F.hits.push([m.index, m.index + m[0].length]); }
      if (srcEd.cm) {
        const p = srcEd.selectionStart; let k = F.hits.findIndex(h => h[0] >= p); if (k < 0) k = 0; F.cur = k - 1;
      }
    } else {
      if (S.editing) commit();
      const root = write;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentElement.closest('.katex,.mermaid,.wavedrom,svg,textarea,script,style,.ln,.cm-editor,.img-banner') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
      const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const n of nodes) {
        const t = n.nodeValue; re.lastIndex = 0; const ms = []; let m;
        while ((m = re.exec(t))) { if (!m[0].length) { re.lastIndex++; continue; } ms.push([m.index, m[0].length]); }
        let node = n, offset = 0;
        for (const [i, len] of ms) {
          if (F.hits.length > 5000) break;
          const r1 = node.splitText(i - offset); const r2 = r1.splitText(len);
          const mk = document.createElement('mark'); mk.className = 'search-hit'; mk.textContent = r1.nodeValue; r1.replaceWith(mk);
          F.hits.push(mk); node = r2; offset = i + len;
        }
      }
      root.querySelectorAll('.blk').forEach(el => { if (el.querySelector('mark.search-hit')) S.htmlOf.delete(el); });
    }
    $('#find-cnt').textContent = F.hits.length ? '0/' + F.hits.length : '无结果';
    if (F.hits.length) findStep(1);
  }
  function findStep(d) {
    if (!F.hits.length) return;
    F.cur = (F.cur + d + F.hits.length) % F.hits.length;
    $('#find-cnt').textContent = (F.cur + 1) + '/' + F.hits.length;
    const h = F.hits[F.cur];
    if (S.mode !== 'live' && srcEd) {
      if (srcEd.cm) { srcEd.setHits(F.hits, F.cur); srcEd.setSelectionRange(h[0], h[1], true); } else revealInSource(h[0], h[1]);
      $('#find-q').focus();
    } else { F.hits.forEach(x => x.classList.remove('cur')); h.classList.add('cur'); scrollElIntoView(h, writeScroll, 'center'); }
  }
  function replaceOne() {
    const re = buildRe(); if (!re) return; const rep = $('#find-r').value;
    const one = new RegExp(re.source, re.flags.replace('g', ''));
    if (S.mode !== 'live' && srcEd && F.hits[F.cur]) {
      const [a, b] = F.hits[F.cur]; const r = edSlice(srcEd, a, b).replace(one, rep);
      edReplace(srcEd, a, b, r, a + r.length); doFind(); $('#find-r').focus();
    } else { const n = Math.max(0, F.cur); let k = -1; setSrc(S.src.replace(re, m => (++k === n ? m.replace(one, rep) : m))); doFind(); }
  }
  function replaceAll() {
    const re = buildRe(); if (!re) return; const cnt = (S.src.match(re) || []).length;
    const out = S.src.replace(re, $('#find-r').value);
    if (S.mode !== 'live' && srcEd) edReplace(srcEd, 0, edLen(srcEd), out, 0); else setSrc(out);
    toast('已替换 ' + cnt + ' 处'); doFind();
  }
  $('#find-q').addEventListener('input', debounce(doFind, 200));
  ['find-case', 'find-re'].forEach(id => $('#' + id).addEventListener('change', doFind));
  $('#find-q').addEventListener('keydown', e => { if (e.key === 'Enter' && !composing(e)) { e.preventDefault(); findStep(e.shiftKey ? -1 : 1); } if (e.key === 'Escape') closeFind(); });
  $('#find-r').addEventListener('keydown', e => { if (e.key === 'Enter' && !composing(e)) { e.preventDefault(); replaceOne(); } if (e.key === 'Escape') closeFind(); });
  $('#find-next').onclick = () => findStep(1); $('#find-prev').onclick = () => findStep(-1);
  $('#find-close').onclick = closeFind; $('#find-rep').onclick = replaceOne; $('#find-repall').onclick = replaceAll;

  /* ================= links: [[wiki]], backlinks, graph, rename refactor ================= */
  const LX = { files: new Map(), built: false, building: false };
  const curKey = () => S.filePath ? S.filePath.join('/') : null;
  const baseKey = n => n.replace(MD_EXT, '').toLowerCase();
  function byBaseMap() { const m = new Map(); for (const f of S.treeFiles) { const b = baseKey(f.name); if (!m.has(b)) m.set(b, f.path.join('/')); } return m; }
  function wikiCandidates() { return S.treeFiles.map(f => ({ name: f.name.replace(MD_EXT, ''), sub: f.path.slice(0, -1).join('/') })); }
  function extractLinks(text) {
    const out = []; const lines = text.split('\n');
    let fence = false;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (/^\s*(```|~~~)/.test(l)) { fence = !fence; continue; }
      if (fence || (l.indexOf('[[') < 0 && l.indexOf('](') < 0)) continue;
      let m; const r1 = /\[\[([^\[\]\n|#]+)(?:#[^\[\]\n|]*)?(?:\|[^\[\]\n]*)?\]\]/g;
      while ((m = r1.exec(l))) out.push({ kind: 'w', raw: m[1].trim(), line: i, text: l });
      const r2 = /\]\(\s*<?([^)>]+?\.(?:md|markdown))(?:#[^)\s]*)?>?(?:\s+["'][^"']*["'])?\s*\)/gi;
      while ((m = r2.exec(l))) if (!/^[a-z]+:/i.test(m[1])) { let raw = m[1]; try { raw = decodeURIComponent(raw); } catch (e) { } out.push({ kind: 'm', raw, line: i, text: l }); }
    }
    return out;
  }
  function resolveLink(lk, fromKey, bb) {
    if (lk.kind === 'w') { const b = lk.raw.split('/').pop().toLowerCase().replace(MD_EXT, ''); return bb.get(b) || null; }
    const st = fromKey.split('/').slice(0, -1);
    for (const x of lk.raw.split(/[\\/]/)) { if (x === '..') st.pop(); else if (x && x !== '.') st.push(x); }
    return st.join('/');
  }
  function indexText(key, text, bb) { LX.files.set(key, { links: extractLinks(text).map(l => Object.assign(l, { to: resolveLink(l, key, bb) })) }); }
  async function linkIndexBuild() {
    if (!S.dirHandle || LX.building) return;
    LX.building = true; LX.files.clear();
    const bb = byBaseMap(); const t0 = performance.now();
    try {
      if (NATIVE) {
        const res = await inv('scan_links', { root: S.dirHandle.__path });
        for (const r of res) {
          const rel = relFromRoot(S.dirHandle.__path, r.path); if (!rel) continue; const key = rel.join('/');
          LX.files.set(key, { links: r.links.map(l => { const lk = { kind: l.kind, raw: l.target, line: l.line, text: l.text }; lk.to = resolveLink(lk, key, bb); return lk; }) });
        }
      } else {
        let n = 0;
        for (const f of S.treeFiles) {
          const key = f.path.join('/');
          try { const file = await f.handle.getFile(); if (file.size > 3e6) continue; indexText(key, (await readFileText(file)).text, bb); } catch (e) { }
          if (++n % 25 === 0) await new Promise(r => setTimeout(r, 0));
        }
      }
      S.tabs.forEach((t, i) => { const p = i === S.cur ? S.filePath : t.path; if (p) indexText(p.join('/'), i === S.cur ? S.src : t.src, bb); });
      LX.built = true; LX.ms = Math.round(performance.now() - t0);
    } catch (e) { console.warn('link index', e); }
    LX.building = false; updateBacklinks();
  }
  function linkIndexUpdateCurrent() { const k = curKey(); if (k && LX.built) { indexText(k, S.src, byBaseMap()); updateBacklinks(); } }
  const linkIndexTouch = debounce(linkIndexUpdateCurrent, 1500);
  function backlinksOf(key) {
    const out = [];
    for (const [k, v] of LX.files) { if (k === key) continue; for (const l of v.links) if (l.to === key) out.push({ from: k, line: l.line, text: l.text }); }
    return out;
  }
  function updateBacklinks() {
    const box = $('#pane-links'); if (!box || !box.classList.contains('active')) return;
    const k = curKey();
    if (!S.dirHandle) { box.innerHTML = '<div class="side-empty">打开文件夹后，这里显示当前文档的<b>反向链接</b>与<b>出链</b>。<br>用 <code>[[文档名]]</code> 创建双链（输入 <code>[[</code> 自动补全），<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> 查看关系图谱。</div>'; return; }
    if (!LX.built) { box.innerHTML = '<div class="side-empty">正在建立链接索引…</div>'; return; }
    if (!k) { box.innerHTML = '<div class="side-empty">当前文档不在已打开的文件夹中。</div>'; return; }
    const fileByKey = new Map(S.treeFiles.map(f => [f.path.join('/'), f]));
    const bl = backlinksOf(k);
    const own = (LX.files.get(k) || { links: [] }).links;
    let h = '<div class="bl-title"><span>反向链接 · ' + bl.length + '</span><button class="btn sm" data-act="graph">关系图谱</button></div>';
    if (!bl.length) h += '<div class="sr-sum">还没有其他文档链接到这里</div>';
    const groups = new Map(); bl.forEach(b => { if (!groups.has(b.from)) groups.set(b.from, []); groups.get(b.from).push(b); });
    S.bl = [];
    for (const [from, arr] of groups) {
      const f = fileByKey.get(from); if (!f) continue;
      h += '<div class="sr-file" data-b="' + (S.bl.push({ f, ln: 0 }) - 1) + '">' + IC('file') + esc(f.name) + ' <small>' + esc(f.path.slice(0, -1).join('/')) + '</small></div>';
      for (const b of arr.slice(0, 8)) h += '<div class="sr-line" data-b="' + (S.bl.push({ f, ln: b.line }) - 1) + '"><i>' + (b.line + 1) + '</i>' + esc(b.text.trim().slice(0, 140)) + '</div>';
    }
    h += '<div class="bl-title"><span>出链 · ' + own.length + '</span></div>';
    const seen = new Set();
    for (const l of own) {
      if (seen.has(l.raw)) continue; seen.add(l.raw);
      const f = l.to && fileByKey.get(l.to);
      h += '<div class="sr-line" ' + (f ? 'data-b="' + (S.bl.push({ f, ln: 0 }) - 1) + '"' : 'style="opacity:.6" title="目标不存在"') + '>' + (l.kind === 'w' ? '⟦ ' : '↗ ') + esc(l.raw) + (f ? '' : ' （不存在）') + '</div>';
    }
    box.innerHTML = h;
  }
  $('#pane-links').addEventListener('click', e => { const it = e.target.closest('[data-b]'); if (!it) return; const b = S.bl[+it.dataset.b]; openHandle(b.f.handle, b.f.path, b.ln || null); });
  async function openWiki(target) {
    const [name, hash] = target.split('#');
    const bb = byBaseMap(); const key = bb.get(baseKey(name.split('/').pop()));
    const afterOpen = () => { if (!hash) return; setTimeout(() => { const h = (S.result.headings || []).find(x => x.text.trim().toLowerCase() === hash.trim().toLowerCase()); if (h) { if (S.mode === 'live') scrollToId(h.id); else jumpToLine(h.line); } }, 120); };
    if (key) { const f = S.treeFiles.find(x => x.path.join('/') === key); await openHandle(f.handle, f.path); return afterOpen(); }
    if (NATIVE && S.fileHandle && S.fileHandle.__path && !S.dirHandle) {
      const p = pJoin(dirName(S.fileHandle.__path), name + '.md');
      if ((await inv('path_kind', { path: p })) === 'file') { await openHandle(new NFile(p), null); return afterOpen(); }
    }
    if (!confirm('“' + name + '” 不存在，是否在当前文档所在目录新建？')) return;
    try {
      let dir = null, rel = null;
      if (S.dirHandle && S.filePath) { dir = S.dirHandle; for (const p of S.filePath.slice(0, -1)) dir = await dir.getDirectoryHandle(p); rel = S.filePath.slice(0, -1).concat(name + '.md'); }
      else if (NATIVE && S.fileHandle && S.fileHandle.__path) dir = new NDir(dirName(S.fileHandle.__path));
      else if (S.dirHandle) { dir = S.dirHandle; rel = [name + '.md']; }
      if (!dir) return toast('请先保存当前文档或打开文件夹');
      const fh = await dir.getFileHandle(name + '.md', { create: true }); const w = await fh.createWritable(); await w.write('# ' + name + '\n\n'); await w.close();
      if (S.dirHandle) await refreshTree();
      await openHandle(fh, rel);
    } catch (e) { toast('创建失败: ' + (e.message || e)); }
  }
  async function updateLinksAfterRename(oldKey, newKey) {
    if (!LX.built) await linkIndexBuild();
    const refs = new Set(backlinksOf(oldKey).map(b => b.from)); refs.delete(oldKey);
    if (!refs.size) { linkIndexBuild(); return; }
    if (!confirm('有 ' + refs.size + ' 个文档链接到被重命名的文件，是否自动更新这些链接？')) { linkIndexBuild(); return; }
    const oldBase = oldKey.split('/').pop().replace(MD_EXT, ''), newBase = newKey.split('/').pop().replace(MD_EXT, '');
    const fileByKey = new Map(S.treeFiles.map(f => [f.path.join('/'), f]));
    const wikiRe = new RegExp('\\[\\[' + reEsc(oldBase) + '(?=(?:#[^\\]|]*)?(?:\\|[^\\]]*)?\\]\\])', 'gi');
    let n = 0;
    for (const key of refs) {
      const f = fileByKey.get(key); if (!f) continue;
      const ti = S.tabs.findIndex((t, i) => { const p = i === S.cur ? S.filePath : t.path; return p && p.join('/') === key; });
      const text = ti >= 0 ? (ti === S.cur ? S.src : S.tabs[ti].src) : (await readFileText(await f.handle.getFile())).text;
      const fromPath = key.split('/');
      const nt = text.replace(wikiRe, '[[' + newBase).replace(/\]\(\s*(<?)([^)>]+?\.(?:md|markdown))(#[^)\s]*)?(>?)/gi, (m, a, p, h, b) => {
        if (/^[a-z]+:/i.test(p)) return m;
        let raw = p; try { raw = decodeURIComponent(p); } catch (e) { }
        if (resolveLink({ kind: 'm', raw }, key, null) !== oldKey) return m;
        return '](' + a + encodeURI(relPath(newKey.split('/'), fromPath)) + (h || '') + b;
      });
      if (nt === text) continue; n++;
      if (ti === S.cur) setSrc(nt);
      else if (ti >= 0) { S.tabs[ti].src = nt; S.tabs[ti].dirty = true; renderTabs(); }
      else { const w = await f.handle.createWritable(); await w.write(nt); await w.close(); }
    }
    toast('已更新 ' + n + ' 个文档中的链接'); linkIndexBuild();
  }
  async function showGraph() {
    if (!S.dirHandle) return toast('请先打开文件夹');
    if (!LX.built) { toast('正在建立链接索引…'); await linkIndexBuild(); }
    modal('<h3 style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">关系图谱 <label style="font-size:12.5px;font-weight:400;color:var(--muted);display:flex;gap:4px;align-items:center"><input type="checkbox" id="g-local"> 只看当前文档的关联（2 层）</label><label style="font-size:12.5px;font-weight:400;color:var(--muted);display:flex;gap:4px;align-items:center"><input type="checkbox" id="g-orph" checked> 显示孤立文档</label><span id="g-info" style="font-size:12px;font-weight:400;color:var(--muted);margin-left:auto;margin-right:36px"></span></h3><canvas id="graph-canvas"></canvas><div class="hint" style="margin-top:6px">单击节点打开 · 拖动节点或画布 · 滚轮缩放</div>', true);
    const cv = $('#graph-canvas'), ctx2 = cv.getContext('2d');
    const css = getComputedStyle(document.documentElement);
    const col = { fg: css.getPropertyValue('--fg').trim(), mu: css.getPropertyValue('--muted').trim(), ac: css.getPropertyValue('--accent').trim(), bd: css.getPropertyValue('--border2').trim() };
    let nodes = [], edges = [], view = { x: 0, y: 0, k: 1 }, drag = null, hover = null, ticks = 0, raf = 0;
    const build = () => {
      const local = $('#g-local').checked, orph = $('#g-orph').checked, ck = curKey();
      const all = S.treeFiles.map(f => f.path.join('/')); const set = new Set(all);
      let E = []; for (const [k, v] of LX.files) for (const l of v.links) if (l.to && set.has(l.to) && l.to !== k) E.push([k, l.to]);
      const key = e => e[0] < e[1] ? e[0] + '\u0000' + e[1] : e[1] + '\u0000' + e[0]; const u = new Map(); E.forEach(e => u.set(key(e), e)); E = Array.from(u.values());
      let keep = new Set(all);
      if (local && ck) { keep = new Set([ck]); for (let d = 0; d < 2; d++) { const add = []; E.forEach(([a, b]) => { if (keep.has(a)) add.push(b); if (keep.has(b)) add.push(a); }); add.forEach(x => keep.add(x)); } }
      const deg = new Map(); E.forEach(([a, b]) => { deg.set(a, (deg.get(a) || 0) + 1); deg.set(b, (deg.get(b) || 0) + 1); });
      if (!orph) keep = new Set(Array.from(keep).filter(k => deg.get(k) || k === ck));
      const old = new Map(nodes.map(n => [n.id, n]));
      nodes = Array.from(keep).map((id, i) => old.get(id) || { id, x: Math.cos(i * 2.4) * (40 + i * 6), y: Math.sin(i * 2.4) * (40 + i * 6), vx: 0, vy: 0 });
      const idx = new Map(nodes.map((n, i) => [n.id, i]));
      nodes.forEach(n => { n.deg = deg.get(n.id) || 0; n.label = n.id.split('/').pop().replace(MD_EXT, ''); n.cur = n.id === ck; });
      edges = E.filter(([a, b]) => idx.has(a) && idx.has(b)).map(([a, b]) => [idx.get(a), idx.get(b)]);
      $('#g-info').textContent = nodes.length + ' 篇文档 · ' + edges.length + ' 条链接';
      ticks = 0; loop();
    };
    const resize = () => { const r = cv.getBoundingClientRect(); cv.width = Math.max(1, r.width * devicePixelRatio); cv.height = Math.max(1, r.height * devicePixelRatio); };
    const step = () => {
      const N = nodes.length, alpha = Math.max(0.02, 1 - ticks / 300);
      for (let i = 0; i < N; i++) { const a = nodes[i]; for (let j = i + 1; j < N; j++) { const b = nodes[j]; let dx = a.x - b.x, dy = a.y - b.y; const d2 = dx * dx + dy * dy + 0.01; if (d2 > 250000) continue; const f = 1800 / d2 * alpha; dx *= f; dy *= f; a.vx += dx; a.vy += dy; b.vx -= dx; b.vy -= dy; } }
      for (const [i, j] of edges) { const a = nodes[i], b = nodes[j]; const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1; const f = (d - 90) * 0.02 * alpha; a.vx += dx / d * f; a.vy += dy / d * f; b.vx -= dx / d * f; b.vy -= dy / d * f; }
      for (const n of nodes) { if (drag && n === drag.node) { n.vx = n.vy = 0; continue; } n.vx -= n.x * 0.004 * alpha; n.vy -= n.y * 0.004 * alpha; n.vx *= 0.82; n.vy *= 0.82; n.x += n.vx; n.y += n.vy; }
      ticks++;
    };
    const draw = () => {
      const W = cv.width, H = cv.height, dpr = devicePixelRatio;
      ctx2.setTransform(1, 0, 0, 1, 0, 0); ctx2.clearRect(0, 0, W, H);
      ctx2.setTransform(view.k * dpr, 0, 0, view.k * dpr, W / 2 + view.x * dpr, H / 2 + view.y * dpr);
      ctx2.strokeStyle = col.bd; ctx2.lineWidth = 1 / view.k; ctx2.beginPath();
      for (const [i, j] of edges) { ctx2.moveTo(nodes[i].x, nodes[i].y); ctx2.lineTo(nodes[j].x, nodes[j].y); } ctx2.stroke();
      const near = hover ? new Set(edges.filter(([i, j]) => nodes[i] === hover || nodes[j] === hover).flatMap(([i, j]) => [nodes[i], nodes[j]])) : null;
      for (const n of nodes) {
        const r = 4 + Math.min(10, Math.sqrt(n.deg) * 2.2);
        ctx2.fillStyle = n.cur || n === hover ? col.ac : (near && near.has(n) ? col.ac : n.deg ? col.fg : col.mu);
        ctx2.globalAlpha = near && !near.has(n) && n !== hover ? 0.3 : 1;
        ctx2.beginPath(); ctx2.arc(n.x, n.y, r, 0, 7); ctx2.fill();
        if (view.k > 0.6 || n.cur || n === hover) { ctx2.font = (12 / view.k) + 'px ' + getComputedStyle(document.body).fontFamily; ctx2.fillStyle = n.cur ? col.ac : col.mu; ctx2.fillText(n.label, n.x + r + 4, n.y + 4 / view.k); }
      }
      ctx2.globalAlpha = 1;
    };
    const loop = () => { cancelAnimationFrame(raf); const go = () => { if (!cv.isConnected) return; if (ticks < 400 || drag) step(); draw(); if (ticks < 400 || drag) raf = requestAnimationFrame(go); }; go(); };
    const toWorld = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left - r.width / 2 - view.x) / view.k, y: (e.clientY - r.top - r.height / 2 - view.y) / view.k }; };
    const pick = p => { let best = null, bd = 144 / view.k / view.k; for (const n of nodes) { const d = (n.x - p.x) ** 2 + (n.y - p.y) ** 2; if (d < bd) { bd = d; best = n; } } return best; };
    cv.addEventListener('mousedown', e => { const n = pick(toWorld(e)); drag = { node: n, sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false }; if (n) ticks = Math.min(ticks, 300); loop(); });
    window.addEventListener('mousemove', function mm(e) { if (!cv.isConnected) return window.removeEventListener('mousemove', mm); if (drag) { drag.moved = drag.moved || Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 3; if (drag.node) { const p = toWorld(e); drag.node.x = p.x; drag.node.y = p.y; } else { view.x = drag.vx + e.clientX - drag.sx; view.y = drag.vy + e.clientY - drag.sy; draw(); } } else if (e.target === cv) { const h = pick(toWorld(e)); if (h !== hover) { hover = h; cv.style.cursor = h ? 'pointer' : 'grab'; draw(); } } });
    window.addEventListener('mouseup', function mu() { if (!cv.isConnected) return window.removeEventListener('mouseup', mu); if (drag && drag.node && !drag.moved) { const f = S.treeFiles.find(x => x.path.join('/') === drag.node.id); $('#modal').classList.remove('show'); if (f) openHandle(f.handle, f.path); } drag = null; });
    cv.addEventListener('wheel', e => { e.preventDefault(); const f = e.deltaY < 0 ? 1.15 : 1 / 1.15; const r = cv.getBoundingClientRect(); const mx = e.clientX - r.left - r.width / 2, my = e.clientY - r.top - r.height / 2; view.x = mx - (mx - view.x) * f; view.y = my - (my - view.y) * f; view.k *= f; draw(); }, { passive: false });
    $('#g-local').onchange = build; $('#g-orph').onchange = build;
    resize(); build();
    new ResizeObserver(() => { if (cv.isConnected) { resize(); draw(); } }).observe(cv);
  }

  /* ================= local version history ================= */
  const histKey = () => S.fileHandle ? 'h:' + (S.fileHandle.__path ? pNorm(S.fileHandle.__path) : (S.dirHandle ? S.dirHandle.name + '/' : '') + (S.filePath ? S.filePath.join('/') : S.fileName)) : null;
  async function histSnapshot(src, label) {
    const k = histKey(); if (!k) return;
    const list = (await idb.get(k)) || [];
    if (list.length && list[list.length - 1].src === src) return;
    list.push({ t: Date.now(), src, label });
    let total = list.reduce((a, x) => a + x.src.length, 0);
    while (list.length > Math.max(2, prefs.histKeep) || (total > 8e6 && list.length > 2)) total -= list.shift().src.length;
    await idb.set(k, list);
  }
  function lineDiff(a, b) {
    const A = a.split('\n'), B = b.split('\n');
    let p = 0; while (p < A.length && p < B.length && A[p] === B[p]) p++;
    let ea = A.length, eb = B.length; while (ea > p && eb > p && A[ea - 1] === B[eb - 1]) { ea--; eb--; }
    const a1 = A.slice(p, ea), b1 = B.slice(p, eb), ops = [];
    for (let i = 0; i < p; i++) ops.push([' ', A[i]]);
    if (a1.length * b1.length > 4e6) { a1.forEach(x => ops.push(['-', x])); b1.forEach(x => ops.push(['+', x])); }
    else {
      const n = a1.length, m = b1.length, L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
      for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a1[i] === b1[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
      let i = 0, j = 0;
      while (i < n && j < m) { if (a1[i] === b1[j]) { ops.push([' ', a1[i]]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) ops.push(['-', a1[i++]]); else ops.push(['+', b1[j++]]); }
      while (i < n) ops.push(['-', a1[i++]]); while (j < m) ops.push(['+', b1[j++]]);
    }
    for (let i = ea; i < A.length; i++) ops.push([' ', A[i]]);
    return ops;
  }
  function diffHtml(ops) {
    const out = []; let i = 0; let adds = 0, dels = 0;
    while (i < ops.length) {
      if (ops[i][0] !== ' ') { out.push('<div class="' + (ops[i][0] === '+' ? 'a' : 'd') + '">' + ops[i][0] + ' ' + esc(ops[i][1]) + '</div>'); ops[i][0] === '+' ? adds++ : dels++; i++; continue; }
      let j = i; while (j < ops.length && ops[j][0] === ' ') j++;
      const run = j - i, head = i === 0 ? 0 : 3, tail = j === ops.length ? 0 : 3;
      if (run > head + tail + 2) { for (let k = i; k < i + head; k++) out.push('<div>  ' + esc(ops[k][1]) + '</div>'); out.push('<div class="s">⋯ ' + (run - head - tail) + ' 行未改变 ⋯</div>'); for (let k = j - tail; k < j; k++) out.push('<div>  ' + esc(ops[k][1]) + '</div>'); }
      else for (let k = i; k < j; k++) out.push('<div>  ' + esc(ops[k][1]) + '</div>');
      i = j;
    }
    return { html: out.join(''), adds, dels };
  }
  async function showHistory() {
    if (S.editing) commit();
    const k = histKey(); if (!k) return toast('当前文档尚未保存到文件，没有历史版本');
    const list = ((await idb.get(k)) || []).slice().reverse();
    if (!list.length) return toast('还没有历史版本（保存后自动记录）');
    modal('<h3>历史版本 · ' + esc(S.fileName) + '</h3><div class="hist"><div class="hist-list">' + list.map((h, i) => '<div class="hist-it" data-i="' + i + '">' + new Date(h.t).toLocaleString() + '<small>' + esc(h.label || '') + ' · ' + countWords(h.src).words + ' 字</small></div>').join('') + '</div><div class="hist-main"><div class="hist-bar"><span id="h-sum" style="color:var(--muted)"></span><span style="flex:1"></span><button class="btn" id="h-copy">复制该版本</button><button class="btn primary" id="h-restore">恢复此版本</button></div><div class="diff" id="h-diff"></div></div></div>', true);
    let sel = 0;
    const show = i => { sel = i; $$('.hist-it').forEach((x, j) => x.classList.toggle('sel', j === i)); const d = diffHtml(lineDiff(list[i].src, S.src)); $('#h-diff').innerHTML = d.html || '<div class="s">与当前内容相同</div>'; $('#h-sum').textContent = '该版本 → 当前：+' + d.adds + ' 行 / −' + d.dels + ' 行'; };
    $('.hist-list').onclick = e => { const it = e.target.closest('[data-i]'); if (it) show(+it.dataset.i); };
    $('#h-restore').onclick = () => { setSrc(list[sel].src); $('#modal').classList.remove('show'); toast('已恢复到 ' + new Date(list[sel].t).toLocaleString() + ' 的版本（可撤销）'); };
    $('#h-copy').onclick = () => navigator.clipboard.writeText(list[sel].src).then(() => toast('已复制'));
    show(0);
  }

  /* ================= slides (Marp style: a line "---" preceded by a blank line) ================= */
  function splitSlides(src) {
    const lines = src.split('\n'); let i = 0;
    if (lines[0] === '---') { for (let j = 1; j < lines.length; j++) if (lines[j] === '---' || lines[j] === '...') { i = j + 1; break; } }
    const out = []; let cur = [], fence = false;
    for (; i < lines.length; i++) {
      const l = lines[i];
      if (/^\s*(```|~~~)/.test(l)) fence = !fence;
      if (!fence && /^---\s*$/.test(l) && (cur.length === 0 || !cur[cur.length - 1].trim())) { out.push(cur.join('\n')); cur = []; continue; }
      cur.push(l);
    }
    out.push(cur.join('\n'));
    return out.filter(s => s.trim());
  }
  const SL = { i: 0, list: [] };
  function present() {
    if (S.editing) commit();
    SL.list = splitSlides(S.src); if (!SL.list.length) return toast('文档为空');
    const el = $('#slides'); el.classList.add('show');
    if (el.requestFullscreen) el.requestFullscreen().catch(() => { });
    showSlide(Math.min(SL.i, SL.list.length - 1)); fitSlides();
    if (SL.list.length === 1) toast('提示：用单独一行 --- （前面空一行）分隔幻灯片', 3500);
  }
  function showSlide(i) {
    SL.i = Math.max(0, Math.min(SL.list.length - 1, i));
    const s = $('#slides .slide'); s.className = 'slide md' + (prefs.autoNum ? ' autonum' : '');
    s.innerHTML = MD.render(SL.list[SL.i]).html; enhance(s);
    $('#slides .num').textContent = (SL.i + 1) + ' / ' + SL.list.length;
  }
  function fitSlides() { const k = Math.min(innerWidth / 1280, innerHeight / 720) * 0.96; $('#slides .stage').style.transform = 'scale(' + k + ')'; }
  function closeSlides() { $('#slides').classList.remove('show'); if (document.fullscreenElement) document.exitFullscreen().catch(() => { }); }
  window.addEventListener('resize', () => { if ($('#slides').classList.contains('show')) fitSlides(); });
  $('#slides').addEventListener('click', e => { if (e.target.closest('a')) return; showSlide(SL.i + (e.clientX < innerWidth / 3 ? -1 : 1)); });
  document.addEventListener('keydown', e => {
    if (!$('#slides').classList.contains('show')) return;
    const k = e.key;
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(k)) { e.preventDefault(); e.stopPropagation(); showSlide(SL.i + 1); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(k)) { e.preventDefault(); e.stopPropagation(); showSlide(SL.i - 1); }
    else if (k === 'Home') { e.preventDefault(); showSlide(0); } else if (k === 'End') { e.preventDefault(); showSlide(SL.list.length - 1); }
    else if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSlides(); }
  }, true);
  async function exportSlides() {
    const slides = splitSlides(S.src); if (!slides.length) return toast('文档为空');
    const body = '<div id="deck">' + slides.map((s, i) => '<section class="slide md' + (prefs.autoNum ? ' autonum' : '') + '"' + (i ? ' hidden' : '') + '>' + MD.render(s).html + '</section>').join('') + '</div><div id="pg"></div>';
    const div = document.createElement('div'); div.innerHTML = body;
    for (const img of div.querySelectorAll('img[data-src]')) { const b = await imageBytes(img.getAttribute('data-src')); img.src = b ? 'data:' + b.mime + ';base64,' + bytesToB64(b.bytes) : img.getAttribute('data-src'); img.classList.remove('img-pending'); }
    const css = 'html,body{height:100%;margin:0;background:#111;overflow:hidden}#deck{position:absolute;left:50%;top:50%;width:1280px;height:720px;margin:-360px 0 0 -640px;background:var(--bg);color:var(--fg)}.slide{position:absolute;inset:0;padding:64px 88px;font-size:27px;line-height:1.55;display:flex;flex-direction:column;justify-content:center;overflow:hidden;font-family:var(--font)}.slide[hidden]{display:none}.slide h1,.slide h2{border:none}.slide h2{color:var(--accent)}#pg{position:fixed;right:20px;bottom:12px;color:#888;font:14px sans-serif}@media print{html,body{background:#fff;overflow:visible}#deck{position:static;margin:0;width:auto;height:auto;transform:none!important}.slide{position:relative;height:720px;page-break-after:always}.slide[hidden]{display:flex!important}#pg{display:none}}';
    const js = 'var s=document.querySelectorAll(".slide"),i=0,d=document.getElementById("deck");function f(){var k=Math.min(innerWidth/1280,innerHeight/720)*.96;d.style.transform="scale("+k+")"}function g(n){s[i].hidden=true;i=Math.max(0,Math.min(s.length-1,n));s[i].hidden=false;document.getElementById("pg").textContent=(i+1)+" / "+s.length}addEventListener("resize",f);f();g(0);addEventListener("keydown",function(e){if(/Right|Down|PageDown| /.test(e.key))g(i+1);if(/Left|Up|PageUp/.test(e.key))g(i-1);if(e.key=="Home")g(0);if(e.key=="End")g(s.length-1)});addEventListener("click",function(e){g(i+(e.clientX<innerWidth/3?-1:1))});';
    await saveOut(baseOut() + '-slides.html', exportHtmlString(div.innerHTML, css, js), 'html', '幻灯片 HTML', 'text/html');
  }

  /* ================= document check ================= */
  function lintDoc() {
    if (S.editing) commit();
    const lines = srcLines(); const issues = []; let fence = false, prevH = 0, h1 = 0, blank = 0; const seenH = new Map();
    const fnRefs = new Set((S.src.match(/\[\^([^\]]+)\](?!:)/g) || []).map(x => x.slice(2, -1))), fnDefs = new Set((S.src.match(/^\[\^([^\]]+)\]:/gm) || []).map(x => x.slice(2, -2)));
    const td = today();
    lines.forEach((l, i) => {
      if (/^\s*(```|~~~)/.test(l)) { fence = !fence; blank = 0; return; }
      if (fence) return;
      if (!l.trim()) { if (++blank === 2) issues.push([i, '连续多个空行']); return; } blank = 0;
      const m = l.match(/^(#{1,6})\s+(.*)/);
      if (m) {
        const lv = m[1].length; if (lv === 1 && ++h1 === 2) issues.push([i, '文档中有多个一级标题']);
        if (prevH && lv > prevH + 1) issues.push([i, '标题跳级：H' + prevH + ' → H' + lv]); prevH = lv;
        const t = m[2].trim().toLowerCase(); if (seenH.has(t)) issues.push([i, '重复标题：' + m[2].trim()]); seenH.set(t, i);
        if (/[。.：:，,]$/.test(m[2].trim())) issues.push([i, '标题以标点结尾']);
      } else if (/^#{1,6}[^#\s]/.test(l)) issues.push([i, '“#” 后缺少空格，不会被识别为标题']);
      if (/[ \t]+$/.test(l) && !/\S {2}$/.test(l)) issues.push([i, '行尾有多余空白']);
      if (/!\[\]\(/.test(l)) issues.push([i, '图片缺少替代文字（alt）']);
      if (/\]\(\s*\)/.test(l)) issues.push([i, '链接地址为空']);
      const dm = l.match(/^\s*[-*+]\s+\[ \].*📅\s?(\d{4}-\d{2}-\d{2})/); if (dm && dm[1] < td) issues.push([i, '待办已逾期（' + dm[1] + '）']);
      if (/[\u4e00-\u9fff][A-Za-z0-9]|[A-Za-z0-9][\u4e00-\u9fff]/.test(l.replace(/`[^`]*`|\[[^\]]*\]\([^)]*\)|https?:\S+/g, '')) && prefs.cjkSpace) issues.push([i, '中英文之间缺少空格']);
    });
    fnRefs.forEach(r => { if (!fnDefs.has(r)) issues.push([lines.findIndex(l => l.includes('[^' + r + ']')), '脚注 [^' + r + '] 没有定义']); });
    fnDefs.forEach(r => { if (!fnRefs.has(r)) issues.push([lines.findIndex(l => l.startsWith('[^' + r + ']:')), '脚注 [^' + r + '] 定义了但未使用']); });
    issues.sort((a, b) => a[0] - b[0]);
    modal('<h3>文档检查 · ' + (issues.length ? issues.length + ' 个提示' : '没有发现问题 ✓') + '</h3>' + issues.map(([ln, msg]) => '<div class="lint-it" data-l="' + ln + '"><i>行 ' + (ln + 1) + '</i><b>⚠</b><span>' + esc(msg) + '</span></div>').join(''));
    $$('.lint-it').forEach(x => x.onclick = () => { $('#modal').classList.remove('show'); jumpToLine(+x.dataset.l); });
  }

  /* ================= unreferenced image cleanup ================= */
  async function cleanImages() {
    if (!S.dirHandle) return toast('请先打开文件夹');
    toast('正在扫描图片引用…', 4000);
    await refreshTree();
    const used = new Set();
    for (const f of S.treeFiles) {
      const key = f.path.join('/');
      const ti = S.tabs.findIndex((t, i) => { const p = i === S.cur ? S.filePath : t.path; return p && p.join('/') === key; });
      let text; try { text = ti >= 0 ? (ti === S.cur ? S.src : S.tabs[ti].src) : (await readFileText(await f.handle.getFile())).text; } catch (e) { continue; }
      const re = /!\[[^\]]*\]\(\s*(<[^>]+>|[^)\s]+)|<img\b[^>]*?\ssrc\s*=\s*["']?([^"'\s>]+)/gi; let m;
      while ((m = re.exec(text))) { let src = (m[1] || m[2]).replace(/^<|>$/g, ''); src = normImgSrc(src); if (MD.isRemote(src) || isAbs(src)) continue; const st = f.path.slice(0, -1); for (const x of src.split(/[\\/]/)) { if (x === '..') st.pop(); else if (x && x !== '.') st.push(x); } used.add(st.join('/').toLowerCase()); }
    }
    const unused = S.treeImages.filter(im => !used.has(im.path.join('/').toLowerCase()));
    if (!unused.length) return modal('<h3>清理未引用图片</h3><p>没有发现未被任何文档引用的图片 ✓（共 ' + S.treeImages.length + ' 张图片）</p>');
    modal('<h3>清理未引用图片 · ' + unused.length + ' 张</h3><p class="hint">以下图片没有被文件夹中任何 Markdown 文档引用。默认只勾选位于 assets 目录中的图片。</p>' +
      unused.map((im, i) => '<label class="pref" style="justify-content:flex-start"><input type="checkbox" data-i="' + i + '"' + (im.path.slice(0, -1).some(x => /^assets$/i.test(x)) ? ' checked' : '') + '> ' + esc(im.path.join('/')) + '</label>').join('') +
      '<p style="text-align:right;margin-bottom:0"><button class="btn primary" id="ci-del">删除选中的图片</button></p>');
    $('#ci-del').onclick = async () => {
      const sel = $$('#modal-body input[data-i]').filter(x => x.checked).map(x => unused[+x.dataset.i]);
      if (!sel.length || !confirm('确定删除 ' + sel.length + ' 张图片？此操作不可撤销。')) return;
      let n = 0; for (const im of sel) { try { await im.parent.removeEntry(im.name); n++; } catch (e) { } }
      $('#modal').classList.remove('show'); toast('已删除 ' + n + ' 张图片'); refreshTree();
    };
  }

  /* ================= themes ================= */
  const userThemes = () => { try { return JSON.parse(localStorage.getItem(LS + 'themes') || '{}'); } catch (e) { return {}; } };
  function applyUserTheme() {
    let st = $('#user-theme'); const css = prefs.userTheme ? userThemes()[prefs.userTheme] : '';
    if (!css) { if (st) st.remove(); return; }
    if (!st) { st = document.createElement('style'); st.id = 'user-theme'; document.head.appendChild(st); }
    st.textContent = css;
  }
  function renderThemeMenu() {
    const t = userThemes(); const box = $('#theme-user');
    box.innerHTML = Object.keys(t).length ? '<div class="sep"></div><div class="grp">自定义主题</div>' + Object.keys(t).map(n => '<div class="it" data-utheme="' + esc(n) + '">' + esc(n) + '</div>').join('') : '';
    $$('[data-utheme]').forEach(x => x.classList.toggle('checked', x.dataset.utheme === prefs.userTheme));
  }
  $('#theme-input').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return; const css = await f.text(); const name = f.name.replace(/\.css$/i, '');
    const t = userThemes(); t[name] = css; try { localStorage.setItem(LS + 'themes', JSON.stringify(t)); } catch (er) { return toast('主题文件过大，无法保存'); }
    prefs.userTheme = name; savePrefs(); applyUserTheme(); renderThemeMenu(); toast('已导入并启用主题 ' + name); e.target.value = '';
  });

  /* ================= view & prefs ================= */
  function applyPrefs() {
    document.documentElement.setAttribute('data-theme', prefs.theme);
    const r = document.documentElement.style;
    r.setProperty('--size', prefs.size + 'px'); r.setProperty('--width', prefs.width + 'px'); r.setProperty('--lh', prefs.lh);
    app.classList.toggle('no-side', !prefs.side);
    [write, preview].forEach(x => { x.classList.toggle('code-lines', prefs.codeLines); x.classList.toggle('autonum', prefs.autoNum); });
    $$('[data-theme-pick]').forEach(x => x.classList.toggle('checked', x.dataset.themePick === prefs.theme));
    $$('[data-pref]').forEach(x => x.classList.toggle('checked', !!prefs[x.dataset.pref]));
    if (srcEd && srcEd.cm) { srcEd.setLineNumbers(prefs.srcLines); srcEd.setSpell(prefs.spell); }
    applyUserTheme(); renderThemeMenu();
    initMermaid();
  }
  function setTheme(t) { prefs.theme = t; savePrefs(); applyPrefs(); S.mermaidCache.clear(); rerender(true); }
  const PREF_NAMES = { codeLines: '代码块行号', srcLines: '源码模式行号', autoPair: '括号自动补全', tableFmt: '表格自动对齐', richPaste: '富文本粘贴转 Markdown', autosave: '自动保存', autoNum: '标题自动编号', slash: '“/” 插入菜单与补全' };
  function togglePref(k) { prefs[k] = !prefs[k]; savePrefs(); applyPrefs(); toast(PREF_NAMES[k] + (prefs[k] ? '：开' : '：关')); }
  function toggleSide(force) { prefs.side = typeof force === 'boolean' ? force : !prefs.side; savePrefs(); applyPrefs(); }
  function setSideTab(t) {
    $$('#side-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === t)); $$('.side-pane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + t));
    if (t === 'search') setTimeout(() => $('#gs-q').focus(), 30);
    if (t === 'links') { if (S.dirHandle && !LX.built) linkIndexBuild(); updateBacklinks(); }
    if (t === 'tasks') refreshTasks();
  }
  $$('#side-tabs button').forEach(b => b.onclick = () => setSideTab(b.dataset.tab));
  function toggleFocus() { S.focus = !S.focus; app.classList.toggle('focus', S.focus); $('#btn-focus').classList.toggle('on', S.focus); toast(S.focus ? '专注模式：开' : '专注模式：关'); }
  function toggleTypewriter() { S.typewriter = !S.typewriter; $('#btn-tw').classList.toggle('on', S.typewriter); toast(S.typewriter ? '打字机模式：开' : '打字机模式：关'); }
  function zoom(d) { prefs.size = Math.min(28, Math.max(11, prefs.size + d)); savePrefs(); applyPrefs(); toast('字号 ' + prefs.size + 'px'); }
  function fullscreen() {
    if (NATIVE) { try { const w = T.window.getCurrentWindow(); w.isFullscreen().then(f => w.setFullscreen(!f)); } catch (e) { } return; }
    if (!document.fullscreenElement) document.documentElement.requestFullscreen(); else document.exitFullscreen();
  }
  (() => {
    const rz = $('#side-resizer'); let x0, w0;
    rz.addEventListener('mousedown', e => { x0 = e.clientX; w0 = $('#sidebar').offsetWidth; const mv = ev => { $('#sidebar').style.width = Math.min(520, Math.max(190, w0 + ev.clientX - x0)) + 'px'; }; const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); }; document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up); });
  })();

  function modal(html, wide) { const m = $('#modal-body'); m.className = 'modal' + (wide ? ' wide' : ''); m.innerHTML = '<button class="close" title="关闭 (Esc)" onclick="document.getElementById(\'modal\').classList.remove(\'show\')">×</button>' + html; $('#modal').classList.add('show'); }
  $('#modal').addEventListener('mousedown', e => { if (e.target.id === 'modal') e.currentTarget.classList.remove('show'); });
  function showHelp() {
    const rows = [
      ['Ctrl+Shift+P', '命令面板（所有功能都能搜到）；Ctrl+P 后输入 = 可做进制/位运算计算'], ['行首输入 /', '插入菜单：标题、表格、代码块、公式、流程图、时序图、寄存器图、待办、AI…（支持拼音首字母，如 /bg）'], ['输入 [[', '双链自动补全；单击双链跳转，不存在时可新建'], ['输入 :关键词', 'Emoji 自动补全'],
      ['Ctrl+J', 'AI 助手（选中文字后点浮动工具栏的 AI 按钮更快）'], ['Ctrl+Alt+N / Ctrl+Alt+D', '从模板新建 / 今日工作日志'],
      ['Ctrl+N / Ctrl+W', '新建 / 关闭标签'], ['Ctrl+O / Ctrl+Shift+O', '打开文件 / 打开文件夹'], ['Ctrl+Shift+F', '在文件夹中全局搜索'],
      ['Ctrl+S / Ctrl+Shift+S / Ctrl+Alt+S', '保存 / 另存为 / 全部保存'], ['Ctrl+Alt+H', '历史版本（对比差异 / 恢复）'], ['Ctrl+PgUp / PgDn，Alt+1~9', '切换标签'],
      ['Ctrl+/ · Ctrl+Alt+/', '实时预览 ⇄ 源代码 · 分屏'], ['F5', '演示幻灯片（--- 分页）'], ['Ctrl+Shift+G', '关系图谱'], ['Ctrl+Shift+L', '显示/隐藏侧边栏'], ['Ctrl+Shift+1~5', '侧栏：文件 / 大纲 / 链接 / 待办 / 搜索'],
      ['Ctrl+F / Ctrl+H', '查找 / 替换'], ['F8 / F9 / F11', '专注 / 打字机 / 全屏'], ['Ctrl+= / Ctrl+-', '放大 / 缩小字号'], ['Ctrl+Alt+P', '导出 PDF（打印）'],
      ['Ctrl+B / I / U / E', '粗体 / 斜体 / 下划线 / 行内代码'], ['Ctrl+Shift+5 / Ctrl+Shift+H', '删除线 / 高亮'], ['Ctrl+K / Ctrl+Shift+I', '链接 / 图片'],
      ['Ctrl+1~6 / Ctrl+0', '标题级别 / 段落'], ['Ctrl+Shift+Q / K / M', '引用 / 代码块 / 公式块'], ['Ctrl+Alt+T', '插入表格'],
      ['Enter / Shift+Enter', '新段落·列表续写·表格新行 / 段内换行'], ['Tab / Shift+Tab', '列表缩进；表格内跳格并自动对齐；源码模式选中多行时整体缩进'], ['Alt+拖动 / Ctrl+单击', '源码模式矩形选择 / 多光标'], ['↑ / ↓（块首/块尾）', '跳到上/下一个块'], ['Esc', '退出当前块编辑'],
      ['选中文字', '浮动格式工具栏（含 AI）'], ['粘贴 Word / 网页 / Excel', '自动转为 Markdown（Ctrl+Shift+V 纯文本）'], ['右键图片', '缩放 25%/50%/75%/原始大小'], ['文件树右键', '新建 / 从模板新建 / 重命名（自动更新链接）/ 删除 / 复制链接']];
    modal('<h3>快捷键与操作</h3><table>' + rows.map(r => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>').join('') + '</table>');
  }
  function showPrefs() {
    const themes = { github: 'GitHub（默认）', night: 'Night 夜间', newsprint: 'Newsprint 报纸', whitey: 'Whitey 极简', dracula: 'Dracula 暗紫' };
    const cb = (id, k, t) => '<label class="pref">' + t + '<input type="checkbox" id="' + id + '"' + (prefs[k] ? ' checked' : '') + '></label>';
    const num = (id, t, v, a) => '<label class="pref">' + t + '<input type="number" id="' + id + '" value="' + v + '" ' + a + '></label>';
    const ut = Object.keys(userThemes());
    modal('<h3>偏好设置</h3>' +
      '<label class="pref">主题<select id="p-theme">' + Object.entries(themes).map(([k, v]) => '<option value="' + k + '"' + (k === prefs.theme ? ' selected' : '') + '>' + v + '</option>').join('') + '</select></label>' +
      '<label class="pref">自定义主题（叠加在主题之上）<span><select id="p-ut"><option value="">（无）</option>' + ut.map(n => '<option' + (n === prefs.userTheme ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + '</select> <button class="btn sm" id="p-ut-del">删除</button></span></label>' +
      num('p-size', '正文字号 (px)', prefs.size, 'min="11" max="28"') + num('p-width', '内容宽度 (px)', prefs.width, 'min="500" max="2000" step="20"') + num('p-lh', '行高', prefs.lh, 'min="1.2" max="2.4" step="0.05"') +
      num('p-goal', '字数目标（0 = 不显示）', prefs.goal, 'min="0" step="100"') + num('p-img', '粘贴图片最大宽度 px（0 = 不缩放）', prefs.imgMax, 'min="0" step="100"') + num('p-hist', '每个文件保留历史版本数', prefs.histKeep, 'min="2" max="200"') +
      cb('p-auto', 'autosave', '自动保存（已关联文件时，停止输入 2 秒后保存）') + cb('p-num', 'autoNum', '标题自动编号（1. / 1.1 / 1.1.1）') + cb('p-slash', 'slash', '“/” 插入菜单、“[[” 双链与 “:” Emoji 补全') +
      cb('p-lines', 'codeLines', '代码块显示行号') + cb('p-srcln', 'srcLines', '源码模式显示行号') + cb('p-pair', 'autoPair', '括号自动补全') + cb('p-tfmt', 'tableFmt', '离开表格时自动对齐列宽') + cb('p-rich', 'richPaste', '粘贴富文本时转换为 Markdown') + cb('p-spell', 'spell', '拼写检查') + cb('p-cjk', 'cjkSpace', '文档检查：提示中英文之间缺少空格') +
      '<label class="pref">公式/图表库来源<select id="p-cdn">' + ['auto', 'jsdelivr', 'npmmirror', 'unpkg'].map(k => '<option' + (k === prefs.cdn ? ' selected' : '') + '>' + k + '</option>').join('') + '</select></label>' +
      '<p class="hint">编辑内核：' + (CMK.ok ? 'CodeMirror 6 ✓' : '基础编辑器') + ' · KaTeX ' + (window.katex ? '✓' : '未加载') + ' · Mermaid ' + (window.mermaid ? '✓' : '按需加载') + ' · WaveDrom ' + (window.WaveDrom ? '✓' : '按需加载') + '<br>渲染缓存命中 ' + MD.stats.hits + ' / 未命中 ' + MD.stats.misses + (LX.built ? ' · 链接索引 ' + LX.files.size + ' 篇 ' + (LX.ms || 0) + ' ms' : '') + '<br>' + (NATIVE ? '运行环境：MDView 桌面版 ' + VERSION : '离线使用公式/图表：把 katex / mermaid / wavedrom 放到 <code>lib/</code> 目录。') + '</p>');
    const bind = (id, fn) => $('#' + id).addEventListener('change', e => { fn(e.target); savePrefs(); applyPrefs(); rerender(true); updateStatus(); });
    bind('p-theme', t => prefs.theme = t.value); bind('p-ut', t => prefs.userTheme = t.value);
    bind('p-size', t => prefs.size = +t.value); bind('p-width', t => prefs.width = +t.value); bind('p-lh', t => prefs.lh = +t.value);
    bind('p-goal', t => prefs.goal = Math.max(0, +t.value || 0)); bind('p-img', t => prefs.imgMax = Math.max(0, +t.value || 0)); bind('p-hist', t => prefs.histKeep = Math.max(2, +t.value || 30));
    bind('p-auto', t => prefs.autosave = t.checked); bind('p-num', t => prefs.autoNum = t.checked); bind('p-slash', t => prefs.slash = t.checked);
    bind('p-lines', t => prefs.codeLines = t.checked); bind('p-srcln', t => prefs.srcLines = t.checked); bind('p-pair', t => prefs.autoPair = t.checked); bind('p-cjk', t => prefs.cjkSpace = t.checked);
    bind('p-tfmt', t => prefs.tableFmt = t.checked); bind('p-rich', t => prefs.richPaste = t.checked); bind('p-spell', t => prefs.spell = t.checked);
    bind('p-cdn', t => { prefs.cdn = t.value; toast('重启后生效'); });
    $('#p-ut-del').onclick = () => { const n = $('#p-ut').value; if (!n) return; const t = userThemes(); delete t[n]; localStorage.setItem(LS + 'themes', JSON.stringify(t)); if (prefs.userTheme === n) prefs.userTheme = ''; savePrefs(); applyPrefs(); showPrefs(); };
  }
  function showAbout() { modal('<h3>MDView ' + VERSION + (NATIVE ? ' · 桌面版' : ' · 网页版') + '</h3><p>仿 Typora 的高性能 Markdown 编辑器。编辑内核 CodeMirror 6；实时预览采用分块缓存与增量渲染。</p><p class="hint">主要能力：所见即所得块编辑 · 源码/分屏 · 双链与关系图谱 · 待办汇总 · 历史版本 · 幻灯片 · 原生导出 Word / PowerPoint / Outlook 邮件 · AI 助手（OpenAI 兼容 / Azure / Ollama）· MCP 服务（Copilot / Claude / Cursor 可读写你的笔记）· WaveDrom 时序图 · GBK/Shift-JIS 编码识别。</p><p class="hint">第三方组件：CodeMirror 6、Prism（内置）；KaTeX、Mermaid、WaveDrom（按需加载）。均为 MIT 许可。</p>'); }

  /* ================= menus & actions ================= */
  const ACTIONS = {
    new: () => newTab(), open: openFile, folder: () => hasFS ? openFolder() : toast('当前浏览器不支持打开文件夹，请使用 Edge/Chrome'), save: () => save(), saveas: saveAs, saveall: saveAll, close: () => closeTab(S.cur),
    quick: quickOpen, palette: commandPalette, gsearch: () => { toggleSide(true); setSideTab('search'); }, links: () => { toggleSide(true); setSideTab('links'); }, tasks: () => { toggleSide(true); setSideTab('tasks'); },
    html: () => exportHtml(false), htmlinline: () => exportHtml(true), pdf: exportPdf, slideshtml: exportSlides, docx: exportDocx, pptx: exportPptx, eml: exportEml, copymail: copyMail, reload: refreshTree,
    history: showHistory, graph: showGraph, present, lint: lintDoc, cleanimg: cleanImages, importtheme: () => $('#theme-input').click(),
    newtpl: () => showTemplates(), daily: dailyNote, ai: () => aiOpenPanel(), aiprefs: showAiPrefs, mcp: showMcp,
    toutf8: () => { if (S.enc === 'UTF-8') return toast('当前已是 UTF-8'); S.enc = 'UTF-8'; markDirty(true); updateStatus(); toast('保存时将使用 UTF-8 编码'); },
    reveal: () => { if (NATIVE && S.fileHandle && S.fileHandle.__path) inv('reveal', { path: S.fileHandle.__path }); else toast('当前文档尚未保存到磁盘'); },
    live: () => setMode('live'), source: () => setMode('source'), split: () => setMode('split'),
    side: () => toggleSide(), focus: toggleFocus, tw: toggleTypewriter, full: fullscreen, zin: () => zoom(1), zout: () => zoom(-1),
    find: () => openFind(false), replace: () => openFind(true), undo: () => { const ed = S.mode !== 'live' && srcEd && srcEd.cm ? srcEd : null; if (ed) { ed.focus(); CMK.api.cm.undo(ed.view) || undo(); } else undo(); }, redo: () => { const ed = S.mode !== 'live' && srcEd && srcEd.cm ? srcEd : null; if (ed) CMK.api.cm.redo(ed.view); else redo(); },
    help: showHelp, prefs: showPrefs, about: showAbout,
    sample: () => openDoc(window.__SAMPLE__, '示例文档.md'),
    toc: () => insertSnippet('[TOC]'), table: () => insertSnippet('| 列1 | 列2 | 列3 |\n| :-- | :-: | --: |\n| 内容 | 内容 | 内容 |'),
    code: () => insertSnippet('```c\n\n```'), math: () => insertSnippet('$$\n\n$$'), mermaid: () => insertSnippet(MERMAID_SNIP), wave: () => insertSnippet(WAVE_SNIP), reg: () => insertSnippet(REG_SNIP),
    hr: () => insertSnippet('---'), task: () => insertSnippet('- [ ] 待办事项 📅 ' + today()), alert: () => insertSnippet('> [!NOTE]\n> 提示内容'), fn: () => insertSnippet('正文[^1]\n\n[^1]: 脚注内容'),
    details: () => insertSnippet('<details>\n<summary>点击展开</summary>\n\n折叠的内容\n\n</details>'), date: () => insertAtCursor(today() + ' ' + new Date().toTimeString().slice(0, 5))
  };
  function insertSnippet(t) {
    if (S.mode !== 'live' && srcEd) { srcFocus(); insText(srcEd, '\n' + t + '\n'); return; }
    if (S.editing && !S.editing.ta.value.trim()) { replaceAllText(S.editing.ta, t); return; }
    let el = null, at;
    if (S.editing) { const rg = committedRange(commit()); at = rg.end; const bi = findLastIdx(S.result.blocks, b => b.end <= at); el = bi >= 0 ? blkEl(bi) : null; }
    else { const lines = srcLines(); at = lines.length; while (at > 0 && !lines[at - 1].trim()) at--; const blks = allBlks(); el = blks[blks.length - 1]; }
    startInsert(at, el, t);
  }
  document.addEventListener('click', e => {
    const mb = e.target.closest('.menu>button');
    $$('.menu').forEach(m => { if (!mb || m !== mb.parentElement) m.classList.remove('open'); });
    if (mb) { mb.parentElement.classList.toggle('open'); return; }
    const it = e.target.closest('[data-act]');
    if (it) { $$('.menu').forEach(m => m.classList.remove('open')); ACTIONS[it.dataset.act] && ACTIONS[it.dataset.act](); }
    const ai = e.target.closest('[data-ai]'); if (ai) { $$('.menu').forEach(m => m.classList.remove('open')); aiQuick(ai.dataset.ai); }
    const th = e.target.closest('[data-theme-pick]'); if (th) { $$('.menu').forEach(m => m.classList.remove('open')); setTheme(th.dataset.themePick); }
    const ut = e.target.closest('[data-utheme]'); if (ut) { $$('.menu').forEach(m => m.classList.remove('open')); prefs.userTheme = prefs.userTheme === ut.dataset.utheme ? '' : ut.dataset.utheme; savePrefs(); applyPrefs(); }
    const pf = e.target.closest('[data-pref]'); if (pf) { $$('.menu').forEach(m => m.classList.remove('open')); togglePref(pf.dataset.pref); rerender(true); }
  });
  $$('.menu>button').forEach(b => b.addEventListener('mouseenter', () => { if ($$('.menu.open').length && !b.parentElement.classList.contains('open')) { $$('.menu').forEach(m => m.classList.remove('open')); b.parentElement.classList.add('open'); } }));
  $$('#topbar [data-act], .dropdown').forEach(b => b.addEventListener('mousedown', e => e.preventDefault()));
  $('#st-mode').onclick = () => setMode(S.mode === 'live' ? 'source' : 'live');
  $('#st-enc').onclick = ACTIONS.toutf8;

  /* ================= global keys ================= */
  document.addEventListener('keydown', e => {
    if ($('#slides').classList.contains('show') || e.defaultPrevented) return;
    const mod = e.ctrlKey || e.metaKey; const k = e.key.toLowerCase();
    if (e.key === 'F1') { e.preventDefault(); showHelp(); return; }
    if (e.key === 'F5') { e.preventDefault(); present(); return; }
    if (e.key === 'F8') { e.preventDefault(); toggleFocus(); return; }
    if (e.key === 'F9') { e.preventDefault(); toggleTypewriter(); return; }
    if (e.key === 'F11') { e.preventDefault(); fullscreen(); return; }
    if (e.key === 'Escape') { $('#modal').classList.remove('show'); $('#lightbox').classList.remove('show'); $('#ctx').classList.remove('show'); $$('.menu').forEach(m => m.classList.remove('open')); if ($('#find').classList.contains('show') && !S.editing) closeFind(); }
    if (e.altKey && !mod && /^[1-9]$/.test(e.key)) { e.preventDefault(); switchTab(Math.min(S.tabs.length, +e.key) - 1); return; }
    if (!mod) return;
    if (k === 's') { e.preventDefault(); e.altKey ? saveAll() : e.shiftKey ? saveAs() : save(); return; }
    if (k === 'o') { e.preventDefault(); e.shiftKey ? ACTIONS.folder() : openFile(); return; }
    if (k === 'n' && e.altKey) { e.preventDefault(); showTemplates(); return; }
    if (k === 'd' && e.altKey) { e.preventDefault(); dailyNote(); return; }
    if (k === 'n' && !e.shiftKey) { e.preventDefault(); newTab(); return; }
    if (k === 'w' && !e.shiftKey) { e.preventDefault(); closeTab(S.cur); return; }
    if (k === 'j') { e.preventDefault(); aiOpenPanel(); return; }
    if (k === 'p' && e.altKey) { e.preventDefault(); exportPdf(); return; }
    if (k === 'p' && e.shiftKey) { e.preventDefault(); commandPalette(); return; }
    if (k === 'p') { e.preventDefault(); quickOpen(); return; }
    if (k === 'h' && e.altKey) { e.preventDefault(); showHistory(); return; }
    if (k === 'g' && e.shiftKey) { e.preventDefault(); showGraph(); return; }
    if (k === 'r') { e.preventDefault(); return; }
    if (k === 'f' && e.shiftKey) { e.preventDefault(); ACTIONS.gsearch(); return; }
    if (e.key === 'PageDown' || (e.key === 'Tab' && !e.shiftKey)) { e.preventDefault(); switchTab((S.cur + 1) % S.tabs.length); return; }
    if (e.key === 'PageUp' || (e.key === 'Tab' && e.shiftKey)) { e.preventDefault(); switchTab((S.cur - 1 + S.tabs.length) % S.tabs.length); return; }
    if ((k === '/' || e.code === 'Slash') && e.altKey) { e.preventDefault(); setMode(S.mode === 'split' ? 'live' : 'split'); return; }
    if (k === '/' || e.code === 'Slash') { e.preventDefault(); setMode(S.mode === 'live' ? 'source' : 'live'); return; }
    if (k === 'f' && !e.shiftKey) { e.preventDefault(); openFind(false); return; }
    if (k === 'h' && !e.shiftKey) { e.preventDefault(); openFind(true); return; }
    if (e.shiftKey && k === 'l') { e.preventDefault(); toggleSide(); return; }
    if (e.shiftKey && /^Digit[1-5]$/.test(e.code)) { e.preventDefault(); toggleSide(true); setSideTab(['files', 'outline', 'links', 'tasks', 'search'][+e.code.slice(5) - 1]); return; }
    if (k === '=' || k === '+') { e.preventDefault(); zoom(1); return; }
    if (k === '-' && !e.shiftKey) { e.preventDefault(); zoom(-1); return; }
    if (k === ',') { e.preventDefault(); showPrefs(); return; }
    const ae = document.activeElement;
    const inText = ae && (/^(TEXTAREA|INPUT|SELECT)$/.test(ae.tagName) || ae.isContentEditable);
    if (!inText && S.mode === 'live') {
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    }
  });
  const hasUnsavedFiles = () => S.tabs.some((t, i) => (i === S.cur ? S.dirty && S.fileHandle : t.dirty && t.handle));
  if (!NATIVE) window.addEventListener('beforeunload', e => { if (S.editing) commit({ silent: true }); persistNow(); if (hasUnsavedFiles()) { e.preventDefault(); e.returnValue = ''; } });
  if (NATIVE) document.addEventListener('contextmenu', e => { if (!e.target.closest('textarea,input,.cm-content')) e.preventDefault(); });

  /* ================= native integration ================= */
  async function initNative() {
    if (!NATIVE) return;
    try {
      const w = T.window.getCurrentWindow();
      await w.onCloseRequested(async ev => {
        if (S.editing) commit({ silent: true });
        snapshot();
        if (hasUnsavedFiles() && !confirm('有已打开的文件尚未保存，确定退出吗？\n（未保存内容会保留在下次启动的会话中）')) { ev.preventDefault(); return; }
        await persistNow();
      });
    } catch (e) { console.warn('close hook', e); }
    try { await T.event.listen('open-paths', ev => openPaths((ev.payload || []).slice(1).filter(a => !a.startsWith('-')))); } catch (e) { }
    try { await T.event.listen('tauri://drag-drop', ev => openPaths((ev.payload && ev.payload.paths) || [])); } catch (e) { }
    try { await T.event.listen('fs-changed', ev => { (ev.payload || []).forEach(p => fsPending.add(p)); onFsChanged(); }); } catch (e) { }
    try { const args = await inv('launch_args'); if (args && args.length) await openPaths(args); } catch (e) { }
    watchSync(); pushState();
  }

  /* ================= init ================= */
  async function init() {
    applyPrefs();
    setSideTab('outline');
    let sess = null;
    try { sess = await idb.get('session'); } catch (e) { }
    if (!sess) { try { sess = JSON.parse(localStorage.getItem(LS + 'session') || 'null'); } catch (e) { } }
    if (sess && sess.tabs && sess.tabs.length && sess.tabs.some(t => t.src && t.src.trim())) {
      S.tabs = sess.tabs.map(t => Object.assign(blankTab(), t, { handle: unpackH(t.handle) }));
      S.cur = Math.min(sess.cur || 0, S.tabs.length - 1);
      applyTab(S.tabs[S.cur]);
      for (const t of S.tabs) if (t.handle && t.handle.__path && !t.dirty) { fileMtime(t.handle).then(m => { S.mtime[hKey(t.handle)] = m; }).catch(() => { }); }
      const dir = unpackH(sess.dir);
      if (dir) {
        try {
          if ((await dir.queryPermission({ mode: 'readwrite' })) === 'granted' && (!NATIVE || (await inv('path_kind', { path: dir.__path })) === 'dir')) { S.dirHandle = dir; refreshTree().then(() => { linkIndexBuild(); tasksTouch(); }); }
          else {
            await renderFilesEmpty('<div class="side-empty"><button class="btn" id="reopen-dir">' + IC('refresh') + '重新打开 “' + esc(dir.name) + '”</button></div>');
            const b = $('#reopen-dir'); if (b) b.onclick = () => openFolder(dir);
          }
        } catch (e) { renderFilesEmpty(); }
      } else renderFilesEmpty();
    } else {
      S.tabs = [Object.assign(blankTab(), { src: window.__SAMPLE__, name: '欢迎使用 MDView.md', welcome: true })]; S.cur = 0;
      applyTab(S.tabs[0]); renderFilesEmpty();
    }
    await setMode('live'); renderTabs(); updateBacklinks(); aiInit();
    loadKatex();
    if (/```\s*mermaid/i.test(S.src)) loadMermaid();
    initNative();
    window.__MDV_READY = performance.now();
    idle(() => loadCM());
  }
