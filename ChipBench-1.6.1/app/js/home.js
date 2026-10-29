/* ChipBench 1.3 · home.js
   · document zoom: Ctrl + wheel / Ctrl+= / Ctrl+-, reset with Ctrl+Alt+0 (Ctrl+0 in viewers) or a click on the % in the status bar.
     Each file remembers its own zoom. WebView2 page-zoom is blocked so the UI itself never scales.
   · workspace home folder: 笔记 / 收件箱 / 日志 + the workspace's own data (.chipbench) + a portable .cbws
   · data directory (偏好设置 → 数据与存储): default / custom / portable
   Loaded after workbench.js; public SL.* interfaces only. */
(function (G) {
  'use strict';
  const SL = G.ChipBench; if (!SL || !SL.app) { console.warn('[home] ChipBench not ready'); return; }
  const U = SL.U, X = SL.X, fs = SL.fs, $ = U.$, esc = U.esc, h = U.h, A = SL.app;

  /* ======================= 1. document zoom ======================= */
  const LEVELS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
  const Z = SL.zoom = { map: {} }; Z.LEVELS = LEVELS; Z.isPdf = t => t && t.kind === 'view' && t.view === 'pdf';
  SL.store.get('zoom.map', {}).then(m => { Z.map = m || {}; Z.apply(A.current()); });
  const key = t => t ? (t.path ? U.pkey(t.path) : 'tab:' + t.id) : null;
  const saveMap = U.debounce(() => { const ks = Object.keys(Z.map); if (ks.length > 400) ks.slice(0, ks.length - 400).forEach(k => delete Z.map[k]); SL.store.set('zoom.map', Z.map); }, 600);
  const isPdf = t => t && t.kind === 'view' && t.view === 'pdf';
  Z.get = t => { if (!t) return 1; if (isPdf(t)) return t.zoom || 1; return Z.map[key(t)] || 1; };
  const pdfBtn = (t, z) => t && t.el && t.el.querySelector('[data-z="' + z + '"]');
  const contentOf = t => { if (!t || !t.el) return []; const root = t.root || t.el.querySelector('.vw') || t.el; return [...root.children].filter(c => !c.classList.contains('view-tools') && !c.classList.contains('hide')); };
  Z.apply = t => {
    const stage = $('#stage'); if (!t) return label();
    if (t.kind === 'md') {
      const z = Z.get(t);
      if (stage) { if (z === 1) stage.style.removeProperty('--fs'); else stage.style.setProperty('--fs', (SL.prefs.fontSize * z).toFixed(2) + 'px'); stage.style.setProperty('--zf', z); }
      if (A.ed && A.ed.view) A.ed.view.requestMeasure();
    } else {
      if (stage) { stage.style.removeProperty('--fs'); stage.style.setProperty('--zf', 1); }
      if (!isPdf(t)) { const z = Z.get(t); contentOf(t).forEach(c => { c.style.zoom = z === 1 ? '' : z; }); }
    }
    label();
  };
  Z.set = (t, z) => { t = t || A.current(); if (!t || isPdf(t)) return; z = Math.max(LEVELS[0], Math.min(LEVELS[LEVELS.length - 1], +z.toFixed(2))); if (z === 1) delete Z.map[key(t)]; else Z.map[key(t)] = z; saveMap(); Z.apply(t); label(true); };
  Z.step = (dir, t) => {
    t = t || A.current(); if (!t) return;
    if (isPdf(t)) { const b = pdfBtn(t, dir > 0 ? '+' : '-'); if (b) b.click(); t.zoomManual = true; setTimeout(() => label(true), 60); return; }
    const z = Z.get(t), n = dir > 0 ? (LEVELS.find(v => v > z + 1e-6) || LEVELS[LEVELS.length - 1]) : ([...LEVELS].reverse().find(v => v < z - 1e-6) || LEVELS[0]);
    Z.set(t, n);
  };
  Z.reset = t => { t = t || A.current(); if (!t) return; if (isPdf(t)) { const b = pdfBtn(t, 'w'); if (b) b.click(); t.zoomManual = false; setTimeout(() => label(true), 60); return; } Z.set(t, 1); };
  const st = $('#status'); let zl = null;
  if (st) { zl = h('span', { id: 'st-zoom', class: 'clk', title: '缩放（Ctrl + 滚轮 / Ctrl+= / Ctrl+-）· 点击恢复' }); st.insertBefore(zl, $('#st-enc') || null); zl.addEventListener('click', () => Z.reset()); }
  function label(user) { if (Z.onChange) try { Z.onChange(!!user); } catch (e) { } if (!zl) return; const t = A.current(); if (!t) { zl.style.display = 'none'; return; } const z = Z.get(t); zl.textContent = Math.round(z * 100) + '%'; zl.style.display = Math.abs(z - 1) < 0.005 ? 'none' : ''; }
  Z.label = label;
  let acc = 0, accT = 0;
  addEventListener('wheel', e => {
    if (!e.ctrlKey) return; e.preventDefault();   // never let WebView2 zoom the whole UI
    if (!e.target.closest || !e.target.closest('#stage, .view-host, #main') || e.target.closest('.modal, .fp, .menu-pop')) return;
    const now = performance.now(); if (now - accT > 300) acc = 0; accT = now;
    acc += e.deltaY; const th = Math.abs(e.deltaY) >= 50 ? 1 : 40;   // mouse notch vs. touch-pad
    if (Math.abs(acc) >= th) { Z.step(acc < 0 ? 1 : -1); acc = 0; }
  }, { passive: false, capture: true });
  document.addEventListener('keydown', e => { if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return; const t = A.current(); if (e.key === '0' && t && t.kind === 'view') { e.preventDefault(); Z.reset(t); } }, true);
  const atlasOpen = () => SL.atlas && SL.atlas.zoomStep && document.querySelector('.fp .at-view');
  SL.cmd('zoomIn', '放大当前文档', () => atlasOpen() ? SL.atlas.zoomStep(1) : Z.step(1), { key: 'Ctrl+=', group: '视图' });
  SL.cmd('zoomOut', '缩小当前文档', () => atlasOpen() ? SL.atlas.zoomStep(-1) : Z.step(-1), { key: 'Ctrl+-', group: '视图' });
  SL.cmd('zoomReset', '恢复 100% 缩放', () => atlasOpen() ? SL.atlas.zoomStep(0) : Z.reset(), { key: 'Ctrl+Alt+0', group: '视图' });
  SL.on('tab', t => { Z.apply(t); setTimeout(() => Z.apply(A.current()), 350); });
  SL.on('opened', () => setTimeout(() => Z.apply(A.current()), 400));
  SL.on('mode', () => Z.apply(A.current())); SL.on('prefs', () => Z.apply(A.current())); SL.on('closed', label);
  document.addEventListener('click', e => { if (e.target.closest && e.target.closest('[data-z]')) setTimeout(label, 80); }, true);

  /* ======================= 2. workspace home folder ======================= */
  const SUB = { notes: '笔记', inbox: '收件箱', journal: '日志' };
  const HOME = SL.wsHome = {};
  HOME.dirs = ws => { ws = ws || (SL.ws && SL.ws.cur); if (!ws || !ws.home) return null; const s = ws.settings || {}; return { home: ws.home, notes: s.notes || X.join(ws.home, SUB.notes), inbox: s.inbox || X.join(ws.home, SUB.inbox), journal: s.journal || X.join(ws.home, SUB.journal), data: X.join(ws.home, '.chipbench') }; };
  HOME.wsFileName = ws => (String(ws.name || '工作区').replace(/[\\/:*?"<>|]/g, '_').trim() || '工作区') + '.cbws';
  HOME.writeFile = async ws => { ws = ws || SL.ws.cur; if (!ws || !ws.home || !SL.native) return; try { const port = SL.W.toPortable(ws, ws.home); port.portable = true; await fs.write(X.join(ws.home, HOME.wsFileName(ws)), JSON.stringify(port, null, 1)); } catch (e) { console.warn('[home] workspace file', e); } };
  HOME.writeSoon = U.debounce(w => HOME.writeFile(w), 800);
  HOME.apply = async (ws, dir, opt) => {
    opt = opt || {}; ws = ws || SL.ws.cur; dir = String(dir).replace(/[\\/]+$/, '');
    if ((await fs.kind(dir)) !== 'dir') await fs.mkdir(dir);
    ws.home = dir; ws.settings = ws.settings || {};
    if (opt.subdirs !== false) for (const k of Object.keys(SUB)) { const p = X.join(dir, SUB[k]); if ((await fs.kind(p)) !== 'dir') await fs.mkdir(p); ws.settings[k] = p; }
    await fs.mkdir(X.join(dir, '.chipbench')).catch(() => { });
    if (!ws.roots.some(r => U.pkey(r.path) === U.pkey(dir))) { if (ws === SL.ws.cur && SL.ws.addRootPath) await SL.ws.addRootPath(dir); else ws.roots.unshift({ id: U.uid(), name: U.base(dir), path: dir }); }
    await SL.ws.persist(ws); await HOME.writeFile(ws);
    SL.emit('ws-home', ws); return ws;
  };
  const persist0 = SL.ws.persist; SL.ws.persist = async ws => { const r = await persist0(ws); const w = ws || SL.ws.cur; if (w && w.home) HOME.writeSoon(w); return r; };

  const newDlg = async () => {
    const body = h('div', { class: 'wsn' }, '<label class="pref"><span>项目名称<small>例如芯片型号或客户项目</small></span><input class="input" id="wsn-name" value="" placeholder="如 U2BX 评估" style="width:280px"></label>' +
      '<label class="pref"><span>主文件夹<small>建议选一个空文件夹。新建的笔记、随手记、日志，以及工作区自己的数据（索引、历史版本、MCP 备份）都放在这里</small></span><span class="row"><input class="input mono" id="wsn-dir" placeholder="可留空：只记录你挂进来的文件夹" style="width:280px"><button class="btn sm" data-pick>选择…</button></span></label>' +
      '<label class="pref"><span>集合<small>可选，用逗号分隔，例如 CAN IP, 时钟, 客户问题</small></span><input class="input" id="wsn-colls" placeholder="CAN IP, 时钟" style="width:280px"></label><label class="pref"><span>创建子文件夹<small>笔记 / 收件箱 / 日志</small></span><input type="checkbox" class="switch" id="wsn-sub" checked></label><div class="muted" id="wsn-hint" style="font-size:var(--fs-sm);min-height:1.6em"></div>');
    const hint = $('#wsn-hint', body);
    $('[data-pick]', body).addEventListener('click', async () => { const p = await SL.invoke('pick_folder', {}).catch(() => null); if (!p) return; $('#wsn-dir', body).value = p; if (!$('#wsn-name', body).value.trim()) $('#wsn-name', body).value = U.base(p); try { const vis = (await fs.list(p)).filter(x => !x.name.startsWith('.')); hint.textContent = vis.length ? '这个文件夹里已有 ' + vis.length + ' 项，会保留原有内容，只补建缺少的子文件夹。' : '空文件夹 ✓'; } catch (e) { hint.textContent = ''; } });
    const r = await SL.modal({ title: '新建项目', body, buttons: [{ t: '取消', v: null }, { t: '创建', primary: true, v: 'ok', fn: () => { if (!$('#wsn-name', body).value.trim()) { hint.textContent = '请填写项目名称'; return false; } } }] });
    if (r !== 'ok') return;
    const name = $('#wsn-name', body).value.trim(), dir = $('#wsn-dir', body).value.trim();
    await SL.ws.create(name);
    if (dir) { try { await HOME.apply(SL.ws.cur, dir, { subdirs: $('#wsn-sub', body).checked }); } catch (e) { SL.toast('主文件夹设置失败：' + (e.message || e), 4000, 'bad'); } }
    const colls = $('#wsn-colls', body).value.split(/[,，、;；]/).map(x => x.trim()).filter(Boolean); if (colls.length) { colls.forEach(c => SL.W.addGroup(SL.ws.cur, c)); await SL.ws.persist(); }
    SL.ws.view = 'collections'; SL.ws.draw && SL.ws.draw(); SL.panel('workspace'); SL.toast('项目「' + name + '」已创建' + (colls.length ? '，包含 ' + colls.length + ' 个集合' : ''));
  };
  SL.cmd('ws.new', '新建项目…', newDlg, { group: '工作区' });
  SL.cmd('ws.home', '设置项目主文件夹…', async () => { const p = await SL.invoke('pick_folder', {}).catch(() => null); if (!p) return; await HOME.apply(SL.ws.cur, p, { subdirs: true }); SL.toast('主文件夹：' + p); }, { group: '工作区' });

  if (SL.prefs.autoNoteDir === undefined) SL.prefs.autoNoteDir = true;
  const safeName = s => String(s || '').replace(/[\\/:*?"<>|#\[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  A.saveDir = t => { const d = HOME.dirs(); if (t && t.path) return U.dir(t.path); return d ? d.notes : null; };
  const save0 = A.save;
  A.save = async (t, silent) => {
    t = t || A.current(); const d = HOME.dirs();
    if (t && t.kind === 'md' && !t.path && d && SL.prefs.autoNoteDir !== false && SL.native) {
      const text = A.textOf(t), hd = (text.match(/^#\s+(.+)$/m) || [])[1], base = safeName(hd) || safeName(t.name.replace(/\.md$/i, '')) || '未命名';
      await fs.mkdir(d.notes).catch(() => { });
      let p = X.join(d.notes, base + '.md'), i = 2; while ((await fs.kind(p)) !== 'none') p = X.join(d.notes, base + ' (' + i++ + ').md');
      t.path = p; t.name = U.base(p); t.pristine = false; t.enc = 'UTF-8';
      const ok = await save0(t, true); if (ok) { SL.toast('已保存到 ' + U.base(d.home) + ' / ' + SUB.notes + ' / ' + t.name); SL.index && SL.index.refreshFile && SL.index.refreshFile(p); SL.emit('tab', t); } return ok;
    }
    return save0(t, silent);
  };

  /* per-workspace data (search index, version history, AI log) → <home>\.chipbench\kv */
  const WS_KEY = /^(idx\.|hist\.|ai\.log$)/;
  const st0 = { get: SL.store.get.bind(SL.store), set: SL.store.set.bind(SL.store) };
  const kvFile = k => { const d = HOME.dirs(); return d ? X.join(X.join(d.data, 'kv'), k.replace(/[\\/:*?"<>|]/g, '_') + '.json') : null; };
  SL.store.get = async (k, dflt) => { const f = SL.native && WS_KEY.test(k) && kvFile(k); if (f) { try { if ((await fs.kind(f)) === 'file') return JSON.parse((await fs.read(f)).text); } catch (e) { } } return st0.get(k, dflt); };
  SL.store.set = async (k, v) => { const f = SL.native && WS_KEY.test(k) && kvFile(k); if (f) { try { await fs.mkdir(U.dir(f)); await fs.write(f, JSON.stringify(v)); return; } catch (e) { console.warn('[home] workspace data → global store', e); } } return st0.set(k, v); };
  SL.on('ws-home', () => A.pushState && A.pushState());

  /* ======================= 3. data directory (preferences) ======================= */
  SL.dataPrefs = async body => {
    const sec = h('div', { class: 'pf-data' }); body.appendChild(sec);
    const draw = async () => {
      let info = { path: '（浏览器预览版）', mode: 'default' }; try { if (SL.native) info = await SL.invoke('data_dir_get', {}); } catch (e) { }
      const d = HOME.dirs(), modeT = { default: '默认位置', custom: '自定义位置', portable: '便携模式（程序旁的 data 文件夹）' }[info.mode] || info.mode;
      sec.innerHTML = '<div class="cap" style="margin:14px 0 4px">数据与存储</div>' +
        '<div class="pref"><span>数据目录<small>' + esc(modeT) + '。项目列表、偏好设置、PDF / Office 缓存都在这里；你的文档始终留在原处</small></span><span class="pf-dd"><code class="mono" title="' + esc(info.path) + '">' + esc(info.path) + '</code><span class="row"><button class="btn sm" data-dd="open">打开</button>' + (info.mode === 'portable' ? '' : '<button class="btn sm" data-dd="move">更改…</button>' + (info.mode === 'custom' ? '<button class="btn sm ghost" data-dd="reset">恢复默认</button>' : '')) + '</span></span></div>' +
        '<div class="pref"><span>当前项目主文件夹<small>' + (d ? '新笔记、收件箱、日志以及本项目的索引 / 历史版本都在这里' : '未设置：工作区数据放在数据目录里') + '</small></span><span class="pf-dd"><code class="mono">' + esc(d ? d.home : '—') + '</code><span class="row">' + (d ? '<button class="btn sm" data-dd="home-open">打开</button>' : '') + '<button class="btn sm" data-dd="home">' + (d ? '更改…' : '设置…') + '</button></span></span></div>' +
        '<label class="pref"><span>新笔记直接保存到“笔记”文件夹<small>按标题自动命名，不弹出保存对话框（需要工作区主文件夹）</small></span><input type="checkbox" class="switch" data-k="autoNoteDir"' + (SL.prefs.autoNoteDir !== false ? ' checked' : '') + '></label>';
      sec.dataset.path = info.path;
    };
    sec.addEventListener('click', async e => {
      const b = e.target.closest('[data-dd]'); if (!b) return; const a = b.dataset.dd, cur = sec.dataset.path;
      if (a === 'open') return SL.invoke('open_path', { path: cur }).catch(() => { });
      if (a === 'home-open') { const d = HOME.dirs(); return d && SL.invoke('open_path', { path: d.home }).catch(() => { }); }
      if (a === 'home') { await SL.run('ws.home'); return draw(); }
      if (a === 'reset') { if (!(await SL.confirm('恢复到默认数据目录？当前自定义目录里的数据会保留，不会删除。重启 ChipBench 后生效。'))) return; await SL.invoke('data_dir_set', { path: '', copy: false }); SL.toast('已恢复默认位置，请重启 ChipBench'); return draw(); }
      if (a === 'move') {
        const p = await SL.invoke('pick_folder', {}).catch(() => null); if (!p) return;
        if (!(await SL.confirm('把数据目录改到：\n' + p + '\n\n会先把现有数据复制过去（原目录保留，不删除）。重启 ChipBench 后生效。'))) return;
        try { const n = await SL.invoke('data_dir_set', { path: p, copy: true }); SL.toast('已复制 ' + n + ' 个文件。请重启 ChipBench 使新位置生效', 5000); } catch (er) { SL.toast('更改失败：' + (er.message || er), 5000, 'bad'); }
        return draw();
      }
    });
    sec.addEventListener('change', e => { if (e.target.dataset.k === 'autoNoteDir') { SL.prefs.autoNoteDir = e.target.checked; SL.savePrefs(); } e.stopPropagation(); });
    await draw();
  };
})(window);
