/* ChipBench 1.8 · ip-studio.js — IP Studio: the viewer for IP models (.cbip).
   The model file is the engineering truth; this tab is one view of it (see ip-model.js).
     · diagram   ELK auto-layout through the existing ipblock renderer, groups can be collapsed, a sub-graph can be focused
     · inspector 详情（依据可改） · 寄存器 · 校验 · 修改（AI 的建议，由你接受或拒绝） · 引用（哪些集合引用了它）
     · files     name.cbip (model) · name.cbip.layout.json (your view: collapsed / focus / direction) · name.cbip.proposal.json (AI proposal, written by the MCP tools)
   Every change — yours or an AI proposal — goes through IPM.apply: atomic, validated, one undo step. */
(function (G) {
  'use strict';
  const SL = G.ChipBench; if (!SL || !SL.app) return;
  const U = SL.U, X = SL.X, fs = SL.fs, h = U.h, esc = U.esc, $ = U.$, A = SL.app, IPM = G.ChipBenchIPM, W = SL.W || G.ChipBenchW;
  const S = SL.ipstudio = { open: null, templates: {} };
  const LP = p => p + '.layout.json', PP = p => p + '.proposal.json';
  const dump = m => JSON.stringify(m, null, 2) + '\n';
  const KIND = { cpu: '处理器', bus: '总线 / 互连', mem: '存储', dma: 'DMA', periph: '外设', logic: '逻辑单元', io: 'I/O / 引脚', clock: '时钟 / 复位', irq: '中断', ext: '外部器件', analog: '模拟', group: '分组' };
  const PT = { clock: '时钟', reset: '复位', irq: '中断', data: '数据', bus: '总线', ctrl: '控制', dma: 'DMA', io: 'I/O' };
  const EVC = { '手册确认': 'ok', '实测': 'ok', '推导': 'brand', '示意': '', '待核对': 'warn' };
  const hex = (v, w) => '0x' + Number(v).toString(16).toUpperCase().padStart(Math.max(2, Math.ceil((w || 32) / 4)), '0');
  const evChip = ev => { const l = (ev && ev.level) || '待核对'; return '<span class="chip ' + (EVC[l] || '') + '">' + esc(l) + '</span>' + (ev && ev.page != null && ev.page !== '' ? ' <a href="#" class="mono ipm-pg" data-page="' + esc(ev.page) + '">p.' + esc(ev.page) + '</a>' : ''); };
  const fmtTime = s => { try { return new Date(s).toLocaleString(); } catch (e) { return s || ''; } };

  /* ---------------------------------------------------------------- files */
  S.read = async path => {
    const r = await fs.read(path); let raw; try { raw = JSON.parse(r.text.replace(/^\uFEFF/, '')); } catch (e) { const er = new Error('不是有效的 JSON：' + (e.message || e)); er.code = 'PARSE'; throw er; }
    if (!raw || typeof raw !== 'object' || !String(raw.schema || '').startsWith('chipbench.ip/')) { const er = new Error('这不是 ChipBench IP 模型（schema 应为 ' + IPM.SCHEMA + '）'); er.code = 'SCHEMA'; throw er; }
    return { model: IPM.normalize(raw), text: r.text, mtime: SL.native ? await fs.mtime(path).catch(() => 0) : 0 };
  };
  const readJson = async p => { try { if ((await fs.kind(p)) !== 'file') return null; return JSON.parse((await fs.read(p)).text.replace(/^\uFEFF/, '')); } catch (e) { return null; } };
  S.readProposal = async path => { const d = await readJson(PP(path)); return d && Array.isArray(d.ops) ? d : null; };
  S.readLayout = async path => IPM.normalizeLayout(await readJson(LP(path)));
  S.create = async (path, model, layout) => { await fs.write(path, dump(model), 'UTF-8'); if (layout) await fs.write(LP(path), JSON.stringify(layout, null, 2) + '\n', 'UTF-8'); return path; };

  /* ---------------------------------------------------------------- the viewer */
  S.open = async (t, root) => {
    const path = t.path; let st;
    const load = async () => { const a = await S.read(path); st = Object.assign(st || {}, { model: a.model, text: a.text, mtime: a.mtime }); };
    st = { enter: true, path, sel: t.ipmSel || null, tab: t.ipmTab || 'detail', layout: await S.readLayout(path), prop: await S.readProposal(path), regFilter: true };
    try { await load(); } catch (e) { root.innerHTML = '<div class="state error"><div class="st-t">无法打开 IP 模型</div><div class="st-m">' + esc(e.message || e) + '</div><div class="st-a"><button class="btn" data-a="text">以文本方式查看</button></div></div>'; root.querySelector('[data-a=text]').onclick = () => SL.openPath(path, { view: 'log' }); return; }
    t.ipmUndo = t.ipmUndo || [];
    const R = h('div', { class: 'ipm' }); root.appendChild(R); S.cur = { t, st };
    R.innerHTML = '<div class="view-tools ipm-bar"></div><div class="ipm-main"><div class="ipm-canvas" tabindex="-1"></div><div class="ipm-side"><div class="ipm-tabs" role="tablist"></div><div class="ipm-pane"></div></div></div>';
    const bar = $('.ipm-bar', R), cv = $('.ipm-canvas', R), tabs = $('.ipm-tabs', R), pane = $('.ipm-pane', R);
    /* inspector (right panel): shown by default; in a narrow window it starts hidden so the diagram keeps a readable size, and comes back when you select something.
       The button in the toolbar is an explicit choice and is remembered in the layout sidecar. */
    const view0 = () => st.layout.view; st.hide = view0().inspector === false ? true : view0().inspector === true ? false : R.clientWidth < 880; st.hideAuto = view0().inspector == null;
    const applySide = () => { R.classList.toggle('no-side', !!st.hide); if (typeof placeMini === 'function') placeMini(); const b = bar.querySelector('[data-a=side]'); if (b) { b.setAttribute('aria-pressed', String(!st.hide)); b.classList.toggle('on', !st.hide); } };
    const showSide = () => { if (st.hide) { st.hide = false; applySide(); } };
    const M = () => st.model, L = () => st.layout, view = () => L().view;
    const saveLayout = U.debounce(() => { st.layout.auto = !Object.keys(st.layout.positions).length; fs.write(LP(path), JSON.stringify(st.layout, null, 2) + '\n', 'UTF-8').catch(() => { }); }, 300);
    const focusOf = () => view().focus && view().focus.node && M().nodes.some(n => n.id === view().focus.node) ? view().focus : null;
    const shown = () => { const f = focusOf(); return f ? IPM.subgraph(M(), { node: f.node, depth: f.depth == null ? 1 : f.depth }) : M(); };
    st.msel = st.msel || [];   /* multi-selection: ids (Shift / Ctrl + click, or drag a rectangle on empty canvas) */
    const fc = { m: null, v: null }; const find = () => { if (fc.m !== st.model) { fc.v = IPM.validate(st.model); fc.m = st.model; } return fc.v; };   /* 2.2: validate once per model version (it was run 4× per redraw) */
    const nm = { m: null, map: null }; const nodeById = id => { if (nm.m !== st.model) { nm.map = new Map(st.model.nodes.map(n => [n.id, n])); nm.m = st.model; } return nm.map.get(id) || null; };   /* 2.2: Map per model version (was a linear find per call) */

    /* ----- commit: every change is one atomic op batch + one undo step ----- */
    const commit = async (ops, label, o) => {
      o = o || {}; const res = IPM.apply(M(), ops);
      if (!res.ok) { SL.toast((label || '修改') + ' 被拒绝：' + res.errors.map(e => e.msg).join('；'), 5000, 'bad'); return res; }
      const prev = st.text; const text = dump(res.model);
      try { st.mtime = await SL.safe.write(path, text, 'UTF-8', { expect: st.mtime, baseText: st.text }); } catch (e) { if (e.code === 'CONFLICT') { SL.toast('文件在你打开之后被其他程序修改过，已重新载入，请再操作一次', 5000, 'bad'); await load(); draw(); return { ok: false, errors: [{ msg: 'conflict' }] }; } SL.fail('保存', e, { impact: '模型文件没有改动，这次修改也没有应用。' }); return { ok: false, errors: [{ msg: String(e) }] }; }
      t.ipmUndo.push({ text: prev, label: label || '修改' }); if (t.ipmUndo.length > 50) t.ipmUndo.shift();
      st.model = res.model; st.text = text; S.lastWrite = { path, t: Date.now() };
      if (o.after) await o.after(); draw(); return res;
    };
    const undo = async () => {
      const u = t.ipmUndo.pop(); if (!u) return SL.toast('没有可撤销的修改');
      try { await fs.write(path, u.text, 'UTF-8'); st.mtime = SL.native ? await fs.mtime(path).catch(() => 0) : 0; } catch (e) { return SL.fail('撤销', e, { impact: '模型文件仍是当前版本，没有被改动。' }); }
      st.text = u.text; st.model = IPM.normalize(JSON.parse(u.text)); S.lastWrite = { path, t: Date.now() }; SL.toast('已撤销：' + u.label); draw();
    };

    /* ----- big models: the overview (2.2) -----
       A model with many blocks starts as an OVERVIEW: every top-level group is one block and parallel links are merged (×N); double-click a group to open just that one.
       This is derived, not stored — until you collapse / expand something yourself, then your choice is saved in the layout sidecar (view.collapse = 'manual'). */
    const AUTO_OVERVIEW = 120;
    const kidsSet = m => new Set(m.nodes.filter(n => n.parent).map(n => n.parent));
    const groupIds = m => { const k = kidsSet(m); return m.nodes.filter(n => k.has(n.id)).map(n => n.id); };
    const topGroupIds = m => { const k = kidsSet(m); return m.nodes.filter(n => k.has(n.id) && !n.parent).map(n => n.id); };
    const countBlocks = m => { const k = kidsSet(m); return m.nodes.reduce((a, n) => a + (k.has(n.id) ? 0 : 1), 0); };
    const autoOv = () => !focusOf() && view().collapse !== 'manual' && countBlocks(M()) > AUTO_OVERVIEW && topGroupIds(M()).length >= 2;
    const collapsedIds = m => autoOv() ? topGroupIds(m) : (L().collapsed || []);
    const setCollapsed = ids => { L().collapsed = ids; view().collapse = 'manual'; st.enter = true; saveLayout(); };
    const redrawCollapsed = () => { drawBar(); return drawCanvas(); };
    /* ----- diagram ----- */
    let seq = 0, lastSig = '';   /* lastSig: what the diagram on screen was built from — an edit that does not change it (a parameter, an evidence level, a note) must not rebuild thousands of SVG elements */
    const drawCanvas = async (force) => {
      const my = ++seq, m = shown(), f = focusOf();
      if (!m.nodes.length) { cv.innerHTML = SL.emptyHtml({ icon: 'chip', title: '这个模型还是空的', msg: '让 AI 通过 MCP 的 <code>ip_edit</code> 提出结构（你在“修改”里确认），<br>或用命令“IP 模型：从模板添加…”。', primary: { t: '＋ 添加第一个节点', a: 'addnode' }, compact: false }); return; }
      const ids = new Set(m.nodes.map(n => n.id)), collapsed = collapsedIds(m).filter(id => ids.has(id)), pb = IPM.toIpblock(m, { collapsed, direction: view().direction === 'down' ? 'down' : 'right' });
      const offs = offsetsNow(), src = X.toYaml(pb), sig = src + '\u0001' + (f ? f.node + ':' + f.depth : '') + '\u0001' + (autoOv() ? 'ov' : '') + '\u0001' + JSON.stringify(offs);
      if (!force && sig === lastSig && cv.querySelector('svg.ipb-svg')) { mark(); applyScene(); applySearch(); return; }
      lastSig = '';
      if (pb.blocks.length > 60) { const old = cv.querySelector('.ipm-busy'); if (!old) cv.appendChild(h('div', { class: 'ipm-busy', role: 'status' }, '<div class="spin" aria-hidden="true"></div><div>正在计算布局（' + pb.blocks.length + ' 个模块，' + pb.links.length + ' 条连线）…</div>')); }
      let el; try { el = await SL.ipblock.render(src, { offsets: offs }); } catch (e) { if (my !== seq) return; cv.innerHTML = '<div class="state error"><div class="st-t">图形渲染失败</div><dl class="st-w"><dt>原因</dt><dd>' + esc(e.message || e) + '</dd><dt>影响</dt><dd>模型文件没有被改动，只是图没有画出来。</dd><dt>下一步</dt><dd>' + (autoOv() ? '' : '把分组折叠成概览（节点很多时布局很慢），或') + '聚焦到一个节点的子图。</dd></dl><div class="st-b">' + (autoOv() ? '' : '<button class="btn sm primary" data-a="collapse">折叠成概览</button>') + '<button class="btn sm" data-a="retry">重试</button></div></div>'; return; }
      if (my !== seq) return;
      lastSig = sig; cv.innerHTML = ''; if (!f && autoOv()) cv.appendChild(h('div', { class: 'ipm-focus ipm-big' }, '<span class="chip brand">大模型</span> 共 <b>' + countBlocks(m) + '</b> 个节点，已折叠成 <b>' + collapsed.length + '</b> 个分组的概览 · 双击分组展开 <button class="btn sm" data-a="expandall">展开全部…</button>')); if (f) cv.appendChild(h('div', { class: 'ipm-focus' }, '<span class="chip brand">子图</span> <b>' + esc(f.node) + '</b> · 深度 ' + (f.depth == null ? 1 : f.depth) + ' <button class="btn sm" data-a="depth-">−</button><button class="btn sm" data-a="depth+">+</button><button class="btn sm" data-a="unfocus">显示全部</button>'));
      cv.appendChild(el); fit(); mark(); applyScene(); applySearch(); setTimeout(paintMini, 0); if (st.enter) { st.enter = false; const svg = cv.querySelector('svg.ipb-svg'), MOt = SL.motion; if (svg && MOt && MOt.level === 'full' && !svg.classList.contains('ipb-big')) { svg.querySelectorAll('.ipb-group, .ipb-node').forEach((n, k) => n.style.setProperty('--i', Math.min(24, k))); svg.classList.add('ipb-enter'); setTimeout(() => svg.classList.remove('ipb-enter'), 1000); } }
    };
    /* fit the diagram to the window width (never enlarges; the zoom HUD still zooms on top) */
    const fit = () => { const svg = cv.querySelector('svg.ipb-svg'); if (!svg) return; if (!svg.dataset.w) { svg.dataset.w = svg.getAttribute('width'); svg.dataset.h = svg.getAttribute('height'); } const w0 = +svg.dataset.w, h0 = +svg.dataset.h; const k = view().fit === false ? 1 : Math.max(.4, Math.min(1, (cv.clientWidth - 48) / w0)); svg.setAttribute('width', Math.round(w0 * k)); svg.setAttribute('height', Math.round(h0 * k)); svg.dataset.k = k.toFixed(2); if (typeof miniSoon === 'function') miniSoon(); const b = bar.querySelector('[data-a=fit]'); if (b) b.textContent = view().fit === false ? '100%' : k < 1 ? '适应 ' + Math.round(k * 100) + '%' : '适应'; };
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(U.debounce(() => { fit(); paintMini(); }, 120)) : null; if (ro) ro.observe(cv);
    /* ----- minimap (2.2): the whole diagram on a small canvas + the part you are looking at; click or drag to move there.
       Only for diagrams that scroll AND have >= 25 blocks.  The drag listeners exist only while the mouse is down (no permanent document listeners). ----- */
    const mini = h('div', { class: 'ipm-mini', hidden: '' }, '<canvas width="176" height="116" role="img" aria-label="小地图：点击或拖动来移动视图"></canvas><div class="ipm-mv"></div>'); $('.ipm-main', R).appendChild(mini);
    const mcv = $('canvas', mini), mvw = $('.ipm-mv', mini); let mg = null, mraf = 0;
    const scroller = () => (cv.scrollWidth > cv.clientWidth + 6 || cv.scrollHeight > cv.clientHeight + 6 ? cv : null);   /* .ipm-canvas is the scroll container (overflow:auto); the inner .ipb-canvas just grows to the diagram's height */
    const placeMini = () => { const sd = R.querySelector('.ipm-side'); mini.style.right = ((R.classList.contains('no-side') || !sd ? 0 : sd.offsetWidth) + 12) + 'px'; };
    const paintMini = () => {
      const svg = cv.querySelector('svg.ipb-svg'), sc = scroller(); if (!svg || !sc || cv.querySelectorAll('.ipb-node').length < 25) { mini.hidden = true; mg = null; return; }
      const vb = svg.viewBox.baseVal, s = Math.min(mcv.width / vb.width, mcv.height / vb.height), ox = (mcv.width - vb.width * s) / 2, oy = (mcv.height - vb.height * s) / 2; mg = { s, ox, oy, vbw: vb.width, vbh: vb.height };
      const c = mcv.getContext('2d'); c.clearRect(0, 0, mcv.width, mcv.height);
      c.fillStyle = 'rgba(100,116,139,.16)'; c.strokeStyle = 'rgba(100,116,139,.5)'; c.lineWidth = 1; svg.querySelectorAll(':scope > .ipb-groups > .ipb-group > rect').forEach(r => { const x = +r.getAttribute('x') * s + ox, y = +r.getAttribute('y') * s + oy, w = +r.getAttribute('width') * s, h2 = +r.getAttribute('height') * s; c.fillRect(x, y, w, h2); c.strokeRect(x + .5, y + .5, Math.max(1, w - 1), Math.max(1, h2 - 1)); });
      c.fillStyle = 'rgba(71,85,105,.8)'; svg.querySelectorAll(':scope > .ipb-nodes > .ipb-node > .ipb-box').forEach(r => { c.fillRect(+r.getAttribute('x') * s + ox, +r.getAttribute('y') * s + oy, Math.max(1.5, +r.getAttribute('width') * s), Math.max(1.5, +r.getAttribute('height') * s)); });
      mini.hidden = false; placeMini(); viewMini();
    };
    const viewMini = () => { const svg = cv.querySelector('svg.ipb-svg'), sc = scroller(); if (!mg || !svg || !sc) { if (!sc) mini.hidden = true; return; } const a = svg.getBoundingClientRect(), b = sc.getBoundingClientRect(), k = a.width / mg.vbw || 1;
      const x0 = Math.max(0, (b.left - a.left) / k), x1 = Math.min(mg.vbw, (b.right - a.left) / k), y0 = Math.max(0, (b.top - a.top) / k), y1 = Math.min(mg.vbh, (b.bottom - a.top) / k);
      Object.assign(mvw.style, { left: (4 + mg.ox + x0 * mg.s) + 'px', top: (4 + mg.oy + y0 * mg.s) + 'px', width: Math.max(4, (x1 - x0) * mg.s) + 'px', height: Math.max(4, (y1 - y0) * mg.s) + 'px' }); };
    const miniSoon = () => { if (mraf) return; mraf = requestAnimationFrame(() => { mraf = 0; viewMini(); }); };
    const miniGo = e => { const svg = cv.querySelector('svg.ipb-svg'), sc = scroller(); if (!mg || !svg || !sc) return; const r = mcv.getBoundingClientRect(), ux = (e.clientX - r.left - mg.ox) / mg.s, uy = (e.clientY - r.top - mg.oy) / mg.s, a = svg.getBoundingClientRect(), b = sc.getBoundingClientRect(), k = a.width / mg.vbw || 1;
      sc.scrollLeft += (a.left + ux * k) - (b.left + sc.clientWidth / 2); sc.scrollTop += (a.top + uy * k) - (b.top + sc.clientHeight / 2); viewMini(); };
    const miniUp = () => { document.removeEventListener('mousemove', miniGo, true); document.removeEventListener('mouseup', miniUp, true); };
    mini.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); miniGo(e); document.addEventListener('mousemove', miniGo, true); document.addEventListener('mouseup', miniUp, true); });
    cv.addEventListener('scroll', miniSoon, true);

    const mark = () => {
      cv.querySelectorAll('.ipb-node.sel, .ipb-group.sel').forEach(x => x.classList.remove('sel'));
      cv.querySelectorAll('.msel').forEach(x => x.classList.remove('msel')); st.msel.forEach(id => { const e = cv.querySelector('.ipb-node[data-id="' + CSS.escape(id) + '"], .ipb-group[data-id="' + CSS.escape(id) + '"]'); if (e) e.classList.add('msel'); });
      const s = st.sel; if (!s || s.kind !== 'node') return;
      const e = cv.querySelector('.ipb-node[data-id="' + CSS.escape(s.id) + '"], .ipb-group[data-id="' + CSS.escape(s.id) + '"]'); if (e) e.classList.add('sel');
    };
    const setMsel = ids => { st.msel = ids.filter(id => nodeById(id)); if (st.msel.length > 1) { st.sel = null; t.ipmSel = null; showSide(); st.tab = 'detail'; t.ipmTab = 'detail'; } mark(); drawSide(); };
    const toggleMsel = id => { let cur = st.msel.slice(); if (!cur.length && st.sel && st.sel.kind === 'node' && st.sel.id !== id) cur = [st.sel.id]; const i = cur.indexOf(id); if (i >= 0) cur.splice(i, 1); else cur.push(id); if (cur.length <= 1) { st.msel = []; return cur.length ? select('node', cur[0], 'detail') : select(null); } setMsel(cur); };
    const select = (kind, id, tab) => { if (id) st.msel = []; st.sel = id ? { kind, id } : null; t.ipmSel = st.sel; if (id && st.hide && st.hideAuto) showSide(); let changed = false; if (tab) { if (st.tab === 'scenes' && tab !== 'scenes') stopPlay(); changed = st.tab !== tab; st.tab = tab; } t.ipmTab = st.tab; mark(); drawSide(); if (changed) swapPane(); applyScene(); };

    /* ----- toolbar ----- */
    const drawBar = () => {
      const m = M(), v = find(), e = v.filter(x => x.level === 'err').length, w = v.filter(x => x.level === 'warn').length, sm = IPM.summary(m, v);
      const nverified = sm.nodeEvidence['手册确认'] + sm.nodeEvidence['实测'], total = m.nodes.length;
      bar.innerHTML = '<span class="ipm-title" title="' + esc(m.id) + '">' + esc(m.name) + '</span><span class="chip ' + (m.kind === 'template' ? 'warn' : m.kind === 'family' ? 'brand' : '') + '">' + esc({ instance: '实例', template: '模板（只写结构）', family: '家族' }[m.kind]) + '</span>' + (m.chip ? '<span class="chip">' + esc(m.chip) + '</span>' : '') +
        '<span class="muted ipm-stat">' + m.nodes.length + ' 个节点 · ' + m.edges.length + ' 条连线 · ' + Object.keys(m.registers).length + ' 个寄存器' + (m.scenes.length ? ' · ' + m.scenes.length + ' 个场景' : '') + ' · rev ' + m.rev + ' · 依据已确认 ' + nverified + '/' + total + '</span><span class="sp"></span>' +
        '<button class="chip ' + (e ? 'bad' : 'ok') + ' ipm-chip" data-a="tab-find" title="校验">' + (e ? '✗ ' + e + ' 个错误' : '✓ 无错误') + (w ? ' · ' + w + ' 个提醒' : '') + '</button>' +
        (st.prop ? '<button class="chip brand ipm-chip ipm-prop" data-a="tab-changes" title="AI 提出的修改在等你确认">待确认的修改 · ' + st.prop.ops.length + '</button>' : '') +
        '<span class="vsep"></span><button class="btn sm" data-a="collapse" title="折叠 / 展开所有分组">折叠分组</button><button class="btn sm" data-a="addnode" title="添加节点（顶层）">＋ 节点</button><button class="btn sm" data-a="fit" title="适应窗口宽度 / 100%">适应</button>' + (hasPos() ? '<button class="btn sm" data-a="resetpos" title="清除所有手动摆放的位置，回到自动布局">重置位置</button>' : '') + '<button class="btn sm" data-a="side" aria-pressed="' + String(!st.hide) + '" title="显示 / 隐藏右侧面板">面板</button><button class="btn sm" data-a="dir" title="切换布局方向">' + (view().direction === 'down' ? '↓ 纵向' : '→ 横向') + '</button><button class="btn sm" data-a="svg" title="导出 SVG">SVG</button><button class="btn sm" data-a="undo" title="撤销上一次修改 (Ctrl+Z)"' + (t.ipmUndo.length ? '' : ' disabled') + '>撤销</button>';
    };

    /* ----- inspector ----- */
    const TABS = [['detail', '详情'], ['regs', '寄存器'], ['scenes', '场景'], ['rules', '规则'], ['find', '校验'], ['changes', '修改'], ['refs', '引用']];
    const drawTabs = () => { const nf = find().filter(x => x.level !== 'info').length; tabs.innerHTML = TABS.map(([k, n]) => '<button class="ipm-tab' + (st.tab === k ? ' on' : '') + '" role="tab" aria-selected="' + (st.tab === k) + '" data-tab="' + k + '">' + n + (k === 'find' && nf ? ' <i>' + nf + '</i>' : '') + (k === 'changes' && st.prop ? ' <i>' + st.prop.ops.length + '</i>' : '') + (k === 'scenes' && M().scenes.length ? ' <i>' + M().scenes.length + '</i>' : '') + (k === 'rules' && M().rules.length ? ' <i>' + M().rules.length + '</i>' : '') + '</button>').join(''); };
    const edgesOf = id => M().edges.filter(e => IPM.endpoint(e.source).node === id || IPM.endpoint(e.target).node === id);
    const paneMulti = () => {
      const ids = st.msel.filter(id => nodeById(id)), top = topOnly(ids), nm = id => (nodeById(id) || {}).name || id;
      return '<div class="ipm-h"><b>已选 ' + ids.length + ' 个</b> <span class="muted">Shift / Ctrl + 点击增减；Esc 取消</span></div><div class="ipm-ports">' + ids.map(id => '<a href="#" class="chip" data-sel="node:' + esc(id) + '" title="' + esc(id) + '">' + esc(nm(id)) + '</a>').join('') + '</div>' +
        '<div class="ipm-sec">对所选的操作</div><div class="ipm-acts"><button class="btn sm primary" data-a="ms-group">放进新分组…</button><button class="btn sm danger" data-a="ms-del">删除所选…</button><button class="btn sm" data-a="ms-copy">复制 id 列表</button>' + (ids.some(id => posOf(id)) ? '<button class="btn sm" data-a="ms-unpin">恢复自动位置</button>' : '') + '<button class="btn sm" data-a="ms-clear">取消选择</button></div>' +
        '<div class="ipm-note muted">拖动其中任一节点 = 一起移动。在场景里录制步骤时，框选会把选中的节点加入这一步。' + (top.length < ids.length ? '<br>其中 ' + (ids.length - top.length) + ' 个在所选分组里，会跟着分组走。' : '') + '</div>';
    };
    const paneDetail = () => {
      if (st.msel.length > 1) return paneMulti();
      const m = M(), s = st.sel;
      if (s && s.kind === 'node' && nodeById(s.id)) {
        const n = nodeById(s.id), kids = m.nodes.filter(x => x.parent === n.id), es = edgesOf(n.id), ev = n.ev || {}; const isColl = collapsedIds(M()).includes(n.id), isGroup = kids.length > 0;
        return '<div class="ipm-h"><b>' + esc(n.name) + '</b> <span class="muted mono">' + esc(n.id) + '</span></div><dl class="ipm-dl"><dt>类型</dt><dd>' + esc(KIND[n.kind] || n.kind) + (n.type && n.type !== n.kind ? ' <span class="muted">· ' + esc(n.type) + '</span>' : '') + '</dd>' + (n.parent ? '<dt>所属</dt><dd><a href="#" data-sel="node:' + esc(n.parent) + '">' + esc((nodeById(n.parent) || {}).name || n.parent) + '</a></dd>' : '') +
          '<dt>依据</dt><dd>' + evChip(ev) + (ev.sec ? ' <span class="muted">§' + esc(ev.sec) + '</span>' : '') + (ev.cond ? ' <span class="muted">条件 ' + esc(ev.cond) + '</span>' : '') + '</dd></dl>' +
          '<div class="ipm-sec">修改依据</div><form class="ipm-form" data-form="ev"><label>等级<select class="select" name="level">' + IPM.EV_LEVELS.map(l => '<option' + (l === (ev.level || '待核对') ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></label><label>页码<input class="input" name="page" value="' + esc(ev.page == null ? '' : ev.page) + '" placeholder="123 或 12-14"></label><label>章节<input class="input" name="sec" value="' + esc(ev.sec || '') + '" placeholder="24.4.2"></label><label class="w">备注<input class="input" name="note" value="' + esc(n.note || '') + '"></label><button class="btn sm primary" type="submit">应用</button></form>' +
          (Object.keys(n.params || {}).length ? '<div class="ipm-sec">参数</div><dl class="ipm-dl">' + Object.keys(n.params).map(k => '<dt>' + esc(k) + '</dt><dd class="mono">' + esc(n.params[k]) + '</dd>').join('') + '</dl>' : '') +
          (n.ports.length ? '<div class="ipm-sec">端口</div><div class="ipm-ports">' + n.ports.map(p => '<span class="chip pt-' + p.type + '" title="' + esc(PT[p.type] || p.type) + ' · ' + p.dir + '">' + esc(p.id) + ' <i>' + { in: '→', out: '←', inout: '↔' }[p.dir] + '</i></span>').join('') + '</div>' : '') +
          (n.registers.length ? '<div class="ipm-sec">寄存器</div><div class="ipm-ports">' + n.registers.map(r => '<a href="#" class="chip" data-sel="register:' + esc(r) + '">' + esc(r) + '</a>').join('') + '</div>' : '') +
          (es.length ? '<div class="ipm-sec">连线 · ' + es.length + '</div>' + es.map(e => { const out = IPM.endpoint(e.source).node === n.id; return '<div class="ipm-row"><span class="chip">' + esc(PT[e.type] || e.type) + '</span> <span class="mono">' + esc(out ? e.target : e.source) + '</span> <span class="muted">' + (out ? '输出到' : '来自') + '</span><button class="ipm-x" data-a="rmedge" data-id="' + esc(e.id) + '" title="删除这条连线" aria-label="删除连线">×</button></div>'; }).join('') : '') +
          (posOf(n.id) ? '<div class="ipm-row muted">已手动摆放（偏移 ' + posOf(n.id).dx + ', ' + posOf(n.id).dy + '） <button class="btn sm" data-a="unpin" data-id="' + esc(n.id) + '">恢复自动位置</button></div>' : '') + '<div class="ipm-sec">编辑结构</div><div class="ipm-acts"><button class="btn sm" data-a="addnode" data-id="' + esc(n.id) + '">添加子节点</button><button class="btn sm" data-a="addport" data-id="' + esc(n.id) + '">添加端口</button><button class="btn sm" data-a="connect" data-id="' + esc(n.id) + '">连线到…</button><button class="btn sm" data-a="rename" data-id="' + esc(n.id) + '">重命名</button><button class="btn sm danger" data-a="rmnode" data-id="' + esc(n.id) + '">删除</button></div><div class="ipm-acts">' + (isGroup || isColl ? '<button class="btn sm" data-a="toggle" data-id="' + esc(n.id) + '">' + (isColl ? '展开分组' : '折叠分组') + '</button>' : '') + '<button class="btn sm" data-a="focus" data-id="' + esc(n.id) + '">只看这个节点及邻居</button><button class="btn sm" data-a="addref" data-id="' + esc(n.id) + '">引用这个子图到集合…</button>' + (ev.page != null && m.source ? '<button class="btn sm" data-a="page" data-page="' + esc(ev.page) + '">打开手册页</button>' : '') + '</div>';
      }
      const lv = IPM.summary(m, find()).nodeEvidence;
      return '<div class="ipm-h"><b>' + esc(m.name) + '</b> <span class="muted mono">' + esc(m.id) + '</span></div><dl class="ipm-dl">' + (m.chip ? '<dt>芯片</dt><dd>' + esc(m.chip) + '</dd>' : '') + (m.family ? '<dt>家族</dt><dd>' + esc(m.family) + '</dd>' : '') + (m.extends ? '<dt>派生自</dt><dd class="mono">' + esc(m.extends) + '</dd>' : '') + '<dt>手册</dt><dd>' + (m.source ? esc(m.source) + (m.docrev ? ' <span class="muted">rev ' + esc(m.docrev) + '</span>' : '') : '<span class="muted">未填写（页码无法跳转）</span>') + '</dd>' + (m.description ? '<dt>说明</dt><dd>' + esc(m.description) + '</dd>' : '') + '</dl>' +
        '<div class="ipm-sec">节点依据分布</div><div class="ipm-evbar">' + IPM.EV_LEVELS.filter(l => lv[l]).map(l => '<span class="chip ' + (EVC[l] || '') + '">' + l + ' ' + lv[l] + '</span>').join('') + (m.nodes.length ? '' : '<span class="muted">没有节点</span>') + '</div>' +
        (m.kind === 'template' ? '<p class="muted ipm-note">模板只描述结构，所有条目为“示意”，不含寄存器值和时序数字；具体芯片的事实由你或 AI 对照手册补上并写明页码。</p>' : '') +
        '<p class="muted ipm-note">点击图中的节点查看详情并修改依据。<b>拖动</b>一个节点到另一个节点上：连线，或移入它里面；拖到空白处可把子节点移出分组。</p>';
    };
    const bitBar = r => { const W_ = r.width, cells = []; const fs_ = (r.fields || []).map(f => { const b = f.bits.match(/^(\d+)(?::(\d+))?$/); return b ? { f, hi: +b[1], lo: +(b[2] == null ? b[1] : b[2]) } : null; }).filter(Boolean).sort((a, b) => b.hi - a.hi); let pos = W_ - 1;
      fs_.forEach(x => { if (x.hi >= W_) return; if (x.hi < pos) cells.push({ w: pos - x.hi, n: '', gap: 1 }); cells.push({ w: x.hi - x.lo + 1, n: x.f.name }); pos = x.lo - 1; }); if (pos >= 0) cells.push({ w: pos + 1, n: '', gap: 1 });
      return '<div class="ipm-bits" aria-label="位域">' + cells.map(c => '<span class="' + (c.gap ? 'gap' : '') + '" style="flex:' + c.w + '" title="' + esc(c.n) + '">' + esc(c.n) + '</span>').join('') + '</div><div class="ipm-bitaxis mono"><span>' + (W_ - 1) + '</span><span>0</span></div>'; };
    const paneRegs = () => {
      const m = M(), s = st.sel, n = s && s.kind === 'node' ? nodeById(s.id) : null; let ids = Object.keys(m.registers); const filt = n && st.regFilter && n.registers.length ? n.registers : null; if (filt) ids = ids.filter(i => filt.includes(i));
      if (!ids.length) return Object.keys(m.registers).length ? SL.emptyHtml({ icon: 'file', title: '这个节点没有关联的寄存器', msg: '选别的节点，或点“显示全部”。', primary: { t: '显示全部寄存器', a: 'regall' } }) : SL.emptyHtml({ icon: 'file', title: '模型里还没有寄存器', msg: 'AI 可通过 <code>ip_edit</code> 的 <code>define_register</code> 添加；<br>从 IP 图谱页转换时寄存器会一并带过来。', primary: { t: '从 SVD 导入寄存器', a: 'svd' } });
      return (filt ? '<div class="ipm-note muted">只显示 ' + esc(n.name) + ' 的寄存器 · <a href="#" data-a="regall">显示全部</a></div>' : '') + ids.map(id => { const r = m.registers[id], open = s && s.kind === 'register' && s.id === id;
        return '<div class="ipm-reg' + (open ? ' open' : '') + '" data-reg="' + esc(id) + '"><div class="ipm-rh"><b class="mono">' + esc(id) + '</b> <span class="muted">' + esc(r.name !== id ? r.name : '') + '</span><span class="sp"></span>' + (r.address != null ? '<span class="mono">' + hex(r.address, 32) + '</span>' : '') + ' <span class="muted">' + r.width + ' 位</span></div>' +
          (open ? (r.reset != null ? '<div class="ipm-row muted">复位值 <span class="mono">' + hex(r.reset, r.width) + '</span> ' + evChip(r.ev) + '</div>' : '<div class="ipm-row">' + evChip(r.ev) + '</div>') + (r.desc ? '<div class="ipm-row muted">' + esc(r.desc) + '</div>' : '') + bitBar(r) + '<table class="ipm-ft"><tr><th>位域</th><th>位</th><th>说明</th><th>依据</th></tr>' + r.fields.map(f => '<tr><td class="mono">' + esc(f.name) + '</td><td class="mono">' + esc(f.bits) + '</td><td>' + esc(f.desc || '') + '</td><td>' + evChip(f.ev) + '</td></tr>').join('') + '</table>' : '') + '</div>'; }).join('');
    };
    const paneFind = () => { const v = find(); if (!v.length) return SL.emptyHtml({ icon: 'check', title: '没有发现问题', msg: '结构、连线、寄存器和场景都通过了校验。' }); const ord = { err: 0, warn: 1, info: 2 }, lab = { err: '错误', warn: '提醒', info: '提示' }; return ['err', 'warn', 'info'].map(k => { const xs = v.filter(x => x.level === k); return xs.length ? '<div class="ipm-sec">' + lab[k] + ' · ' + xs.length + '</div>' + xs.map((x, i) => '<div class="ipm-fd ' + k + '"' + (x.ref ? ' data-sel="' + x.ref.kind + ':' + esc(x.ref.id) + '" tabindex="0" role="button"' : '') + '><span class="chip ' + (k === 'err' ? 'bad' : k === 'warn' ? 'warn' : '') + '">' + esc(x.code) + '</span> ' + esc(x.msg) + '</div>').join('') : ''; }).join(''); };
    const paneChanges = () => {
      const p = st.prop; if (!p) return SL.emptyHtml({ icon: 'check', title: '没有待确认的修改', msg: 'AI 工具通过 MCP 的 <code>ip_edit</code> 提出修改后会出现在这里，<br>由你接受或拒绝；它们不会直接改动模型。' });
      const res = IPM.apply(M(), p.ops), stale = p.base_rev != null && p.base_rev !== M().rev; let tail = '';
      if (!res.ok) tail = '<div class="ipm-bad"><b>这些修改现在无法应用</b>（模型已变化）：<br>' + res.errors.slice(0, 8).map(e => '· 第 ' + (e.index + 1) + ' 项：' + esc(e.msg)).join('<br>') + '</div>';
      else { const d = IPM.diff(M(), res.model), key = v => v.level + v.code + v.msg, before = new Set(find().map(key)), fresh = IPM.validate(res.model).filter(v => !before.has(key(v)) && v.level !== 'info'); const cnt = (a, k) => a[k].length ? a[k].length : 0;
        tail = '<div class="ipm-sec">接受后的结果</div><div class="ipm-row">节点 +' + cnt(d.nodes, 'added') + ' −' + cnt(d.nodes, 'removed') + ' ~' + cnt(d.nodes, 'modified') + ' · 连线 +' + cnt(d.edges, 'added') + ' −' + cnt(d.edges, 'removed') + ' ~' + cnt(d.edges, 'modified') + ' · 寄存器 +' + cnt(d.registers, 'added') + ' −' + cnt(d.registers, 'removed') + ' ~' + cnt(d.registers, 'modified') + '</div>' + (fresh.length ? '<div class="ipm-sec">会带来的新问题</div>' + fresh.slice(0, 8).map(v => '<div class="ipm-fd ' + v.level + '"><span class="chip ' + (v.level === 'err' ? 'bad' : 'warn') + '">' + esc(v.code) + '</span> ' + esc(v.msg) + '</div>').join('') : '<div class="ipm-row muted">不会引入新的错误或提醒。</div>'); }
      return '<div class="ipm-h"><b>' + esc(p.title || 'AI 修改') + '</b></div><div class="ipm-row muted">' + esc(p.client || 'AI 工具') + ' · ' + esc(fmtTime(p.created)) + ' · ' + p.ops.length + ' 项操作</div>' + (p.note ? '<div class="ipm-note">' + esc(p.note) + '</div>' : '') + (stale ? '<div class="ipm-warn">模型在这份建议之后又改过（rev ' + p.base_rev + ' → ' + M().rev + '）；接受前请核对。</div>' : '') +
        '<div class="ipm-sec">将要做的修改</div><ol class="ipm-ops">' + (p.described || p.ops.map(IPM.describeOp)).map(x => '<li>' + esc(x) + '</li>').join('') + '</ol>' + tail + '<div class="ipm-acts"><button class="btn sm primary" data-a="accept"' + (res.ok ? '' : ' disabled') + '>接受并写入</button><button class="btn sm" data-a="reject">拒绝</button></div>';
    };
    const paneRefs = () => {
      const m = M(), ws = SL.ws && SL.ws.cur, refs = ws && W ? W.refsOf(ws, path) : [];
      return '<div class="ipm-sec">被哪些集合引用</div>' + (refs.length ? refs.map(r => '<div class="ipm-row"><span class="chip brand">' + esc(r.group) + '</span> ' + (r.sub ? '子图 <b class="mono">' + esc(r.sub.node) + '</b> · 深度 ' + (r.sub.depth == null ? 1 : r.sub.depth) : '整个模型') + '</div>').join('') : '<div class="ipm-row muted">当前项目的集合里还没有引用。</div>') +
        '<div class="ipm-acts"><button class="btn sm" data-a="addref">把整个模型加入集合…</button>' + (st.sel && st.sel.kind === 'node' ? '<button class="btn sm" data-a="addref" data-id="' + esc(st.sel.id) + '">把所选节点的子图加入集合…</button>' : '') + '</div>' +
        '<div class="ipm-sec">模型关系</div><dl class="ipm-dl"><dt>派生自</dt><dd class="mono">' + esc(m.extends || '—') + '</dd><dt>文件</dt><dd class="mono ipm-path">' + esc(path) + '</dd><dt>视图</dt><dd class="mono ipm-path">' + esc(U.base(LP(path))) + ' <span class="muted">（你的布局，AI 不会改它）</span></dd></dl>' + (m.refs.length ? '<div class="ipm-sec">外部引用</div>' + m.refs.map(r => '<div class="ipm-row mono">' + esc(r.type || '') + ' ' + esc(r.path || r.url || '') + '</div>').join('') : '');
    };
    let swapT = 0; const swapPane = () => { if (!SL.motion || SL.motion.level === 'off') return; pane.classList.add('swap'); clearTimeout(swapT); swapT = setTimeout(() => pane.classList.remove('swap'), 320); };
    const drawSide = () => { drawTabs(); pane.innerHTML = ({ detail: paneDetail, regs: paneRegs, scenes: paneScenes, rules: paneRules, find: paneFind, changes: paneChanges, refs: paneRefs }[st.tab] || paneDetail)(); if (st.tab === 'scenes') progTo(); };
    const draw = () => { drawBar(); applySide(); drawSide(); return drawCanvas(); };

    /* ----- actions ----- */
    const addRef = async nodeId => {
      const ws = SL.ws && SL.ws.cur; if (!ws) return SL.toast('先打开一个项目'); const gs = []; W.walk(ws.collections, n => { if (n.type === 'group') gs.push(n); });
      const add = async gid => { const spec = { kind: 'file', path }; if (nodeId) spec.sub = { node: nodeId, depth: 1 }; const r = W.addRef(ws, spec, { parentId: gid }); if (!r.existed && SL.native) { try { r.node.fp = { size: await fs.size(path), mtime: await fs.mtime(path) }; } catch (e) { } } SL.ws.save(); if (SL.ws.draw) SL.ws.draw(); SL.emit('ws-refs'); SL.toast(r.existed ? '已在该集合中' : '已加入集合' + (nodeId ? '（子图 ' + nodeId + '）' : '')); drawSide(); };
      const newG = async () => { const n = await SL.prompt('新集合名称', 'IP'); if (!n) return; const g = W.addGroup(ws, n); await add(g.id); };
      if (!gs.length) return newG(); SL.menu(pane.querySelector('[data-a=addref]') || bar, gs.map(g => ({ k: g.id, t: g.name })).concat([{ sep: 1 }, { k: '_new', t: '新建集合…' }]), x => x === '_new' ? newG() : add(x));
    };
    /* ----- structure editing by hand: the same atomic ops the AI uses, one undo step each ----- */
    const slug = (t, taken) => { let b = String(t || 'node').trim().replace(/[^A-Za-z0-9_\-]+/g, '_').replace(/^[^A-Za-z_]+/, '') || 'node', i = b, k = 2; while (taken.has(i)) i = b + '_' + (k++); return i; };
    const pickMenu = (anchor, items) => new Promise(res => SL.menu(anchor || bar, items, k => res(k)));
    const E = {
      addNode: (o) => { o = o || {}; const id = o.id || slug(o.name || o.kind || 'node', new Set(M().nodes.map(n => n.id))); const node = { id, kind: o.kind || 'logic', name: o.name || id }; if (o.parent) node.parent = o.parent; return commit([{ op: 'add_node', node }], '添加节点 ' + id).then(r => { if (r && r.ok) select('node', id, 'detail'); return r; }); },
      addPort: (nodeId, o) => commit([{ op: 'add_port', node: nodeId, port: { id: o.id, type: o.type || 'data', dir: o.dir || 'inout' } }], '添加端口 ' + nodeId + '.' + o.id),
      connect: (source, target, o) => commit([{ op: 'add_edge', edge: Object.assign({ source, target }, o || {}) }], '连线 ' + source + ' → ' + target),
      removeEdge: id => commit([{ op: 'remove_edge', id }], '删除连线 ' + id),
      rename: (id, to) => commit([{ op: 'rename_node', id, to }], '重命名 ' + id + ' → ' + to).then(r => { if (r && r.ok && st.sel && st.sel.id === id) select('node', to, st.tab); return r; }),
      removeNode: id => commit([{ op: 'remove_node', id }], '删除节点 ' + id).then(r => { if (r && r.ok) { select(null); if ((L().collapsed || []).includes(id)) { L().collapsed = L().collapsed.filter(x => x !== id); saveLayout(); }   /* (an auto-overview needs no cleanup: it is derived) */ } return r; }),
    };
    const ui = {
      svd: () => S.importSvd(),
      addnode: async (id, b) => { const name = await SL.prompt(id ? '子节点名称（在 ' + id + ' 里面）' : '节点名称', ''); if (!name) return; const kind = await pickMenu(b, Object.keys(KIND).filter(k => k !== 'group' || true).map(k => ({ k, t: KIND[k] }))); if (!kind) return; return E.addNode({ name, kind, parent: id || null }); },
      addport: async (id, b) => { const pid = await SL.prompt('端口名称（字母 / 数字 / _）', ''); if (!pid) return; const type = await pickMenu(b, Object.keys(PT).map(k => ({ k, t: PT[k] }))); if (!type) return; const dir = await pickMenu(b, [{ k: 'in', t: '输入' }, { k: 'out', t: '输出' }, { k: 'inout', t: '双向' }]); if (!dir) return; return E.addPort(id, { id: pid, type, dir }); },
      connect: async (id, b) => { const n = nodeById(id); const sp = await pickMenu(b, [{ k: '', t: '整个节点' }].concat(n.ports.map(p => ({ k: p.id, t: '端口 ' + p.id + '（' + (PT[p.type] || p.type) + '）' })))); if (sp == null) return; const others = M().nodes.filter(x => x.id !== id); if (!others.length) return SL.toast('没有其他节点可以连接'); const t = await pickMenu(b, others.map(x => ({ k: x.id, t: x.name + '  ·  ' + x.id }))); if (!t) return; const tn = nodeById(t); const tp = tn.ports.length ? await pickMenu(b, [{ k: '', t: '整个节点' }].concat(tn.ports.map(p => ({ k: p.id, t: '端口 ' + p.id + '（' + (PT[p.type] || p.type) + '）' })))) : ''; if (tp == null) return; return E.connect(id + (sp ? '.' + sp : ''), t + (tp ? '.' + tp : '')); },
      rename: async (id) => { const to = await SL.prompt('新的 id（连线和子节点会一起更新）', id); if (!to || to === id) return; return E.rename(id, to); },
      rmnode: async (id) => { const n = nodeById(id), kids = IPM.subgraph(M(), { node: id, depth: 0 }).nodes.length - 1, es = edgesOf(id).length; if (!(await SL.confirm('删除节点 “' + n.name + '”？' + (kids ? '\n连同它的 ' + kids + ' 个子节点' : '') + (es ? (kids ? '，' : '\n') + '以及相关连线 ' + es + ' 条' : '') + '。可以用“撤销”恢复。', '删除', true))) return; return E.removeNode(id); },
    };
    /* ----- scenes (2.0): play / record / edit ----- */
    const SC = st.sc = { id: (t.ipmScene && t.ipmScene.id) || null, step: (t.ipmScene && t.ipmScene.step) || 0, playing: false, timer: 0 };
    const sceneById = id => M().scenes.find(x => x.id === id) || null;
    const curScene = () => sceneById(SC.id);
    const stepIdx = sc => Math.max(0, Math.min(sc.steps.length - 1, SC.step));
    const curStep = () => { const sc = curScene(); return sc && sc.steps.length ? sc.steps[stepIdx(sc)] : null; };
    const remember = () => { t.ipmScene = { id: SC.id, step: SC.step }; };
    const stopPlay = () => { SC.playing = false; if (SC.timer) { clearInterval(SC.timer); SC.timer = 0; } };
    const mdInline = x => x ? (SL.md && SL.md.inline ? SL.md.inline(String(x)) : esc(x)) : '';
    const haveOf = svg => svg.__have || (svg.__have = new Set(Array.from(svg.querySelectorAll('[data-id]'), e => e.dataset.id)));   /* ids actually drawn (collapsed groups hide their members) */
    const visible = (svg, id) => { const have = haveOf(svg); let c = id, k = 0; while (c && k++ < 50) { if (have.has(c)) return c; const n = nodeById(c); c = n && n.parent; } return null; };
    /* ----- highlighting in BIG diagrams (2.2) -----
       Dimming the rest with per-element opacity makes the browser build an offscreen group for every one of the thousands of elements (4.8 s per scene step at 1000 nodes).
       Instead: ONE translucent veil over the diagram + clones of just the lit nodes / edges on top.  Cost follows the number of lit items, not the size of the diagram. */
    const VEIL_MAX = 400, NSV = 'http://www.w3.org/2000/svg';
    const clearVeil = svg => { const v = svg.querySelector(':scope > .ipb-veil'); if (v) v.remove(); };
    const putVeil = (svg, nodeIds, edgeEls, cls) => {
      clearVeil(svg); if (!nodeIds.length && !edgeEls.length) return true; if (nodeIds.length + edgeEls.length > VEIL_MAX) return false;
      const vb = svg.viewBox.baseVal, g = document.createElementNS(NSV, 'g'), r = document.createElementNS(NSV, 'rect'); g.setAttribute('class', 'ipb-veil sc-focus ' + cls); g.setAttribute('pointer-events', 'none');
      r.setAttribute('class', 'vl'); ['x', 'y', 'width', 'height'].forEach(k => r.setAttribute(k, vb[k])); g.appendChild(r);
      const clone = e => { const c = e.cloneNode(true); ['data-id', 'data-from', 'data-to', 'tabindex'].forEach(a => c.removeAttribute(a)); c.setAttribute('data-clone', '1'); c.classList.add('lit'); c.classList.remove('sel'); return c; };
      edgeEls.forEach(e => g.appendChild(clone(e))); nodeIds.forEach(id => { const e = svg.querySelector('[data-id="' + CSS.escape(id) + '"]'); if (e) g.appendChild(clone(e)); });
      svg.appendChild(g); return true;
    };
    const searching = () => !!(finp && finp.value.trim());
    /* ----- behaviour rules + derived changes (2.3) -----
       Rules are data from the manual.  The scene player shows what they derive per step — always labelled 推导, with the evidence of every rule used. */
    const IPS = G.ChipBenchIPS, simMemo = { m: null, sc: null, r: null };
    const simOf = sc => { if (!IPS || !sc || !M().rules.length) return null; if (simMemo.m !== st.model || simMemo.sc !== sc.id) { simMemo.m = st.model; simMemo.sc = sc.id; try { simMemo.r = IPS.plain(IPS.simulate(st.model, sc.id)); } catch (e) { simMemo.r = { ok: false, error: String(e && e.message || e) }; } } return simMemo.r; };
    const ruleById = id => M().rules.find(r => r.id === id) || null;
    const evShort = ev => { const l = (ev && ev.level) || '待核对'; return l + (ev && ev.page != null && ev.page !== '' ? ' p.' + ev.page : ''); };
    const derivedBlock = (sc, i) => {
      const r = simOf(sc); if (!r) return ''; if (!r.ok) return '<div class="ipm-sec">推演</div><div class="ipm-warn">推演失败：' + esc(r.error) + '</div>'; const s = r.steps[i]; if (!s) return '';
      const rules = s.fired.map(id => { const R_ = ruleById(id); return '<span class="chip ' + (EVC[(R_ && R_.ev && R_.ev.level) || '待核对'] || '') + '" title="' + esc(R_ ? R_.name : id) + ' · ' + esc(evShort(R_ && R_.ev)) + '">' + esc(id) + ' · ' + esc((R_ && R_.ev && R_.ev.level) || '待核对') + '</span>'; }).join(' ');
      const derived = s.changes.filter(c => c.by.some(x => x !== '写入')), unver = s.fired.filter(id => r.unverified.includes(id));
      return '<div class="ipm-sec">推演 · 推导<span class="muted ipm-sub">由 ' + r.rules.length + ' 条规则得出，不是手册原文</span></div>' +
        (unver.length ? '<div class="ipm-warn">用到了没有手册 / 实测依据的规则：' + unver.map(esc).join('、') + '。下面的变化当作假设。</div>' : '') +
        (derived.length ? derived.map(c => '<div class="ipm-dv"><span class="mono">' + esc(c.target) + '</span> <span class="mono">' + esc(c.from) + ' → <b>' + esc(c.to) + '</b></span> <span class="muted">← ' + c.by.map(x => x === '写入' ? '写入' : '<a href="#" data-a="rule-open" data-id="' + esc(x) + '">' + esc(x) + '</a>').join(' + ') + '</span></div>').join('') : '<div class="ipm-row muted">这一步规则没有推出额外的变化。</div>') +
        (rules ? '<div class="ipm-ports" style="margin-top:var(--sp-1-5)">' + rules + '</div>' : '') +
        s.events.map(ev => '<div class="ipm-row"><span class="chip brand">事件</span> ' + esc(ev.text) + (ev.node ? ' <a href="#" data-sel="node:' + esc(ev.node) + '">@' + esc((nodeById(ev.node) || {}).name || ev.node) + '</a>' : '') + ' <span class="muted">[' + esc(ev.rule) + ']</span></div>').join('') +
        s.errors.map(e => '<div class="ipm-warn">⚠ ' + esc(e) + '</div>').join('');
    };
    const paneRules = () => {
      const m = M(), d = st.rdraft;
      if (d) return ruleForm(d);
      let out = '<div class="ipm-acts" style="margin-top:0"><button class="btn sm primary" data-a="rule-new">＋ 添加规则</button></div>';
      if (!m.rules.length) return SL.emptyHtml({ icon: 'chip', title: '还没有规则', msg: '规则是<b>手册里写明的行为</b>，例如“状态 &amp; 使能 → 中断线”。<br>没有规则时，场景只重放写入的值，什么也不会推导。<br>不要凭印象写：没有手册依据就标“待核对”或不写。', primary: { t: '添加第一条规则', a: 'rule-new' } });
      return out + '<div class="ipm-note muted">推演结果只和规则一样可靠；每条规则带自己的依据。</div>' + m.rules.map(r => '<div class="ipm-rule" data-rule="' + esc(r.id) + '"><div class="ipm-rh"><b>' + esc(r.name) + '</b> <span class="muted mono">' + esc(r.id) + '</span><span class="sp"></span><span class="chip">' + (r.trigger === 'edge' ? '边沿' : '电平') + '</span><span class="chip ' + (EVC[(r.ev || {}).level || '待核对'] || '') + '">' + esc(evShort(r.ev)) + '</span></div>' +
        '<div class="ipm-rw"><span class="muted">当</span> <code>' + esc(r.when) + '</code></div>' + (r.then.length ? '<div class="ipm-rw"><span class="muted">' + (r.trigger === 'edge' ? '那一刻' : '满足时') + '</span> ' + r.then.map(x => '<code>' + esc(x) + '</code>').join(' ') + '</div>' : '') + (r.else.length ? '<div class="ipm-rw"><span class="muted">否则</span> ' + r.else.map(x => '<code>' + esc(x) + '</code>').join(' ') + '</div>' : '') + (r.note ? '<div class="ipm-rw muted">' + esc(r.note) + '</div>' : '') +
        '<div class="ipm-acts" style="margin-top:var(--sp-1-5)"><button class="btn sm" data-a="rule-edit" data-id="' + esc(r.id) + '">编辑</button><button class="btn sm danger" data-a="rule-del" data-id="' + esc(r.id) + '">删除</button></div></div>').join('');
    };
    const ruleOf = d => { const f = pane.querySelector('[data-form=rule]'), v = k => (f && f.elements[k] ? f.elements[k].value : (d[k] == null ? '' : d[k])), lines = k => String(v(k)).split('\n').map(x => x.trim()).filter(Boolean);
      const r = { id: d.id, name: v('name').trim() || d.id, trigger: v('trigger') || 'level', when: v('when').trim(), then: lines('then'), else: v('trigger') === 'edge' ? [] : lines('else'), note: v('note').trim(), ev: { level: v('level') || '待核对' } }; if (String(v('page')).trim()) r.ev.page = String(v('page')).trim(); return r; };
    const ruleCheck = d => { const r = ruleOf(d); if (!r.when) return { r, err: '条件不能为空' }; if (r.ev.level === '手册确认' && r.ev.page == null) return { r, err: '“手册确认”必须写页码：没有页码的只能是“推导”或“待核对”' };
      const res = d.mode === 'edit' ? IPM.apply(M(), [{ op: 'update_rule', id: d.id, set: { name: r.name, trigger: r.trigger, when: r.when, then: r.then, else: r.else, note: r.note, ev: r.ev } }]) : IPM.apply(M(), [{ op: 'add_rule', rule: r }]); return { r, err: res.ok ? '' : res.errors[0].msg.replace(/^规则 [^ ]+ · /, '') }; };
    const ruleForm = d => { const r = d.rule, chk = d.err == null ? ruleCheck(Object.assign({}, d, { rule: r })) : null;
      return '<div class="ipm-h"><b>' + (d.mode === 'edit' ? '编辑规则 ' + esc(d.id) : '添加规则') + '</b></div><div class="ipm-note muted">只写手册明确说明的行为，并写上页码。电平 = 状态跟着条件走；边沿 = 条件由假变真的那一刻动作一次。</div>' +
        '<form class="ipm-form" data-form="rule"><label class="w">名称<input class="input" name="name" value="' + esc(r.name === d.id ? '' : r.name) + '" placeholder="例如：中断线"></label>' +
        '<label>类型<select class="select" name="trigger"><option value="level"' + (r.trigger === 'level' ? ' selected' : '') + '>电平（状态跟着条件）</option><option value="edge"' + (r.trigger === 'edge' ? ' selected' : '') + '>边沿（发生一次）</option></select></label><span></span>' +
        '<label class="w">条件（当…）<input class="input mono" name="when" value="' + esc(r.when) + '" placeholder="STS.FULL &amp;&amp; EN.IE" spellcheck="false" autocomplete="off"></label>' +
        '<label class="w">' + (r.trigger === 'edge' ? '那一刻做什么（每行一条）' : '满足时（每行一条）') + '<textarea class="input mono" name="then" rows="3" placeholder="set STS.IRQ = 1' + (r.trigger === 'edge' ? '\nemit &quot;推入一次&quot; @fifo' : '') + '" spellcheck="false">' + esc(r.then.join('\n')) + '</textarea></label>' +
        (r.trigger === 'edge' ? '' : '<label class="w">否则（每行一条，可空）<textarea class="input mono" name="else" rows="2" placeholder="set STS.IRQ = 0" spellcheck="false">' + esc(r.else.join('\n')) + '</textarea></label>') +
        '<label>依据<select class="select" name="level">' + IPM.EV_LEVELS.map(l => '<option' + (l === ((r.ev || {}).level || '待核对') ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></label><label>手册页码<input class="input" name="page" value="' + esc((r.ev || {}).page == null ? '' : r.ev.page) + '" placeholder="123"></label>' +
        '<label class="w">备注<input class="input" name="note" value="' + esc(r.note || '') + '" placeholder="出处章节、前提条件"></label>' +
        '<div class="w ipm-rerr" role="alert" aria-live="polite">' + (chk && chk.err ? '⚠ ' + esc(chk.err) : '') + '</div><div class="w ipm-acts" style="margin-top:0"><button class="btn sm primary" type="submit"' + (chk && chk.err ? ' disabled' : '') + '>保存规则</button><button class="btn sm" type="button" data-a="rule-cancel">取消</button></div></form>' +
        '<details class="ipm-help"><summary>写法</summary><div class="ipm-note"><b>表达式</b>：整数（123、0x1F、0b101）、<code>名字</code>、<code>寄存器.位域</code>、括号，运算符 <code>! ~ - * / % + - &lt;&lt; &gt;&gt; &lt; &lt;= &gt; &gt;= == != &amp; ^ | &amp;&amp; ||</code>。没有函数、字符串。<br><b>动作</b>：<code>set 名字 = 表达式</code>、<code>set 寄存器.位域 = 表达式</code>、<code>emit "文字" @节点</code>（只能用在边沿规则）。<br>电平规则的动作不能读自己要写的目标（那是计数，请用边沿）。</div></details>'; };
    const openRuleForm = (mode, id) => { const cur = id ? ruleById(id) : null; stopPlay(); st.rdraft = { mode, id: cur ? cur.id : slug('rule', new Set(M().rules.map(x => x.id))), rule: cur ? JSON.parse(JSON.stringify(cur)) : { id: '', name: '', trigger: 'level', when: '', then: [], else: [], note: '', ev: { level: '待核对' } } }; showSide(); st.tab = 'rules'; t.ipmTab = 'rules'; drawSide(); const f = pane.querySelector('[name=name]'); if (f) f.focus(); };
    const liveRule = () => { const d = st.rdraft; if (!d) return; const f = pane.querySelector('[data-form=rule]'); if (!f) return; const chk = ruleCheck(d); d.rule = chk.r; const box = f.querySelector('.ipm-rerr'), btn = f.querySelector('button[type=submit]'); if (box) box.textContent = chk.err ? '⚠ ' + chk.err : ''; if (btn) btn.disabled = !!chk.err; };
    const saveRule = async () => { const d = st.rdraft; if (!d) return; const chk = ruleCheck(d); if (chk.err) return liveRule(); const r = chk.r; const ops = d.mode === 'edit' ? [{ op: 'update_rule', id: d.id, set: { name: r.name, trigger: r.trigger, when: r.when, then: r.then, else: r.else, note: r.note, ev: r.ev } }] : [{ op: 'add_rule', rule: r }];
      const res = await commit(ops, (d.mode === 'edit' ? '修改' : '添加') + '规则 ' + d.id); if (res && res.ok) { st.rdraft = null; drawSide(); applyScene(); } };
    const applyScene = () => {
      const svg = cv.querySelector('svg.ipb-svg'); if (!svg) return; if (svg.classList.contains('ipb-big')) clearVeil(svg); const d = st.draft, s = d ? d.step : (st.tab === 'scenes' ? curStep() : null), NS = 'http://www.w3.org/2000/svg';
      const hl = new Set(); (s ? s.nodes || [] : []).forEach(id => { const v = visible(svg, id); if (v) hl.add(v); });
      const keys = new Set(); (s ? s.edges || [] : []).forEach(id => { const e = M().edges.find(x => x.id === id); if (!e) return; const a = IPM.endpoint(e.source).node, b = IPM.endpoint(e.target).node, va = visible(svg, a), vb = visible(svg, b); keys.add(e.source + '>' + e.target); keys.add(a + '>' + b); if (va && vb) keys.add(va + '>' + vb); });
      if (svg.classList.contains('ipb-big')) { svg.classList.remove('sc-focus'); if (searching()) return; putVeil(svg, Array.from(hl), keys.size ? Array.from(svg.querySelectorAll('.ipb-edge')).filter(el => keys.has(el.dataset.from + '>' + el.dataset.to)) : [], 'sc'); return; }
      svg.classList.toggle('sc-focus', hl.size > 0 || keys.size > 0);
      svg.querySelectorAll('.ipb-node, .ipb-group').forEach(n => n.classList.toggle('lit', hl.has(n.dataset.id)));
      svg.querySelectorAll('.sc-pk').forEach(p => p.remove());
      svg.querySelectorAll('.ipb-edge').forEach(el => { const hit = keys.has(el.dataset.from + '>' + el.dataset.to); el.classList.toggle('lit', hit); if (hit && !d && !svg.classList.contains('ipb-big')) { const path = el.querySelector('path'), dd = path && path.getAttribute('d'); if (dd) { const c = document.createElementNS(NS, 'circle'); c.setAttribute('r', '5'); c.setAttribute('class', 'sc-pk'); const am = document.createElementNS(NS, 'animateMotion'); am.setAttribute('dur', '1.4s'); am.setAttribute('repeatCount', 'indefinite'); am.setAttribute('path', dd); c.appendChild(am); el.appendChild(c); } } });
    };
    const progTo = () => { const sc = curScene(), b = pane.querySelector('.ipm-prog > i'); if (!sc || !b || !sc.steps.length) return; const f = (stepIdx(sc) + 1) / sc.steps.length; requestAnimationFrame(() => requestAnimationFrame(() => { b.style.transform = 'scaleX(' + f + ')'; })); SC.lastFrac = f; };
    const goStep = i => { const sc = curScene(); if (!sc) return; const before = SC.step; SC.step = Math.max(0, Math.min(Math.max(0, sc.steps.length - 1), i)); remember(); drawSide(); if (SC.step !== before && SL.motion) SL.motion.replay(pane.querySelector('.ipm-step'), 'swap'); applyScene(); };
    const togglePlay = () => { const sc = curScene(); if (!sc || !sc.steps.length || st.draft) return; if (SC.playing) { stopPlay(); drawSide(); return; } if (stepIdx(sc) >= sc.steps.length - 1) SC.step = 0; SC.playing = true; remember(); SC.timer = setInterval(() => { const s2 = curScene(); if (!s2 || stepIdx(s2) >= s2.steps.length - 1) { stopPlay(); drawSide(); return; } goStep(stepIdx(s2) + 1); if (stepIdx(s2) >= s2.steps.length - 1) { stopPlay(); drawSide(); } }, 2400); drawSide(); applyScene(); };
    const prevValues = (sc, i) => { const v = {}; for (let j = 0; j < i; j++) sc.steps[j].writes.forEach(w => { v[w.reg] = w.value; }); return v; };
    const writeCard = (w, prev) => {
      const R_ = M().registers[w.reg], wd = R_ ? R_.width : 32, dec = R_ ? IPM.decode(R_, w.value) : [], pd = R_ && prev != null ? IPM.decode(R_, prev) : null;
      return '<div class="ipm-wr"><div class="ipm-wh"><a href="#" data-sel="register:' + esc(w.reg) + '"><b class="mono">' + esc(R_ ? R_.name : w.reg) + '</b></a><span class="sp"></span><span class="mono">= ' + hex(w.value, wd) + '</span></div>' + (w.note ? '<div class="muted">' + esc(w.note) + '</div>' : '') + (prev != null ? '<div class="muted mono">之前 ' + hex(prev, wd) + '</div>' : '') +
        (dec.length ? '<div class="ipm-fl">' + dec.map((f, k) => '<span class="chip' + (pd && pd[k] && pd[k].value !== f.value ? ' brand' : '') + '" title="' + esc(f.desc) + '">' + esc(f.name) + ' = ' + f.value + '</span>').join('') + '</div>' : '') + '</div>';
    };
    /* draft = the step being recorded / edited; while it is open, clicking nodes in the diagram toggles them in the step */
    const blankStep = () => ({ title: '', note: '', nodes: [], edges: [], writes: [], ev: { level: '待核对' } });
    const openDraft = (mode, index, base) => { showSide(); stopPlay(); st.draft = { mode, index, step: JSON.parse(JSON.stringify(base || blankStep())) }; st.tab = 'scenes'; t.ipmTab = 'scenes'; drawSide(); applyScene(); const ti = pane.querySelector('input[name=title]'); if (ti) ti.focus(); };
    const syncDraft = () => {
      const f = pane.querySelector('[data-form=draft]'); if (!f || !st.draft) return; const s = st.draft.step, fd = k => (f.elements[k] ? f.elements[k].value : '');
      s.title = fd('title'); s.note = fd('note'); s.line = fd('line').trim() === '' ? undefined : fd('line').trim(); s.ev = Object.assign({}, s.ev, { level: fd('level') || '待核对' }); if (fd('page').trim()) s.ev.page = fd('page').trim(); else delete s.ev.page;
      s.writes = Array.from(f.querySelectorAll('.ipm-wrow')).map(r => ({ reg: r.querySelector('[name=wreg]').value, value: r.querySelector('[name=wval]').value, note: r.querySelector('[name=wnote]').value }));
    };
    const toggleDraftNode = id => { syncDraft(); const n = st.draft.step.nodes, i = n.indexOf(id); if (i >= 0) n.splice(i, 1); else n.push(id); drawSide(); applyScene(); };
    const draftEdges = () => { const s = st.draft.step, set = new Set(s.nodes); return M().edges.filter(e => set.has(IPM.endpoint(e.source).node) || set.has(IPM.endpoint(e.target).node)); };
    const saveDraft = async () => {
      syncDraft(); const d = st.draft, s = d.step, sc = curScene(); if (!d || !sc) return; if (!String(s.title).trim()) return SL.toast('步骤需要标题', 3000, 'bad');
      const step = { title: s.title.trim(), note: s.note || '', nodes: s.nodes.slice(), edges: s.edges.slice(), writes: s.writes.filter(w => w.reg && String(w.value).trim() !== '').map(w => { const o = { reg: w.reg, value: String(w.value).trim() }; if (w.note && w.note.trim()) o.note = w.note.trim(); return o; }), ev: Object.assign({}, s.ev) };
      let ops; if (d.mode === 'edit') { const set = Object.assign({}, step); set.line = s.line === undefined ? null : (/^\d+$/.test(String(s.line)) ? +s.line : s.line); ops = [{ op: 'update_step', scene: sc.id, index: d.index, set }]; } else { if (s.line !== undefined) step.line = /^\d+$/.test(String(s.line)) ? +s.line : s.line; ops = [{ op: 'add_step', scene: sc.id, index: d.index, step }]; }
      const r = await commit(ops, (d.mode === 'edit' ? '修改' : '添加') + '步骤：' + step.title); if (r && r.ok) { SC.step = d.index; st.draft = null; remember(); drawSide(); applyScene(); }
    };
    const paneScenes = () => {
      const m = M(), list = m.scenes, sc = curScene(); let out = list.length ? '<div class="ipm-acts" style="margin-top:0"><button class="btn sm primary" data-a="sc-new">＋ 新建场景</button></div>' : '';
      if (!list.length) return SL.emptyHtml({ icon: 'play', title: '还没有场景', msg: '场景 = 在结构图上一步一步讲清楚“发生了什么”：<br>高亮哪些节点和连线、写了哪些寄存器、一句说明。<br>带 <code>```scene</code> 的 IP 图谱页转换成 .cbip 时，场景会一起带过来。', primary: { t: '新建场景', a: 'sc-new' } });
      out += '<div class="ipm-scs">' + list.map(x => '<button class="ipm-sc' + (sc && sc.id === x.id ? ' on' : '') + '" data-a="sc-pick" data-id="' + esc(x.id) + '"><b>' + esc(x.name) + '</b><span class="muted">' + x.steps.length + ' 步</span><span class="chip ' + (EVC[(x.ev || {}).level || '待核对'] || '') + '">' + esc((x.ev || {}).level || '待核对') + '</span></button>').join('') + '</div>';
      if (!sc) return out + '<div class="ipm-note muted">选一个场景来播放。</div>';
      const n = sc.steps.length, i = n ? stepIdx(sc) : 0, s = n ? sc.steps[i] : null, d = st.draft;
      out += '<div class="ipm-h" style="margin-top:var(--sp-3)"><b>' + esc(sc.name) + '</b> <span class="muted mono">' + esc(sc.id) + '</span></div>' + (sc.desc ? '<div class="muted">' + esc(sc.desc) + '</div>' : '');
      if (n && !d) out += '<div class="ipm-ctl"><button class="btn sm" data-a="sc-first" title="第一步" aria-label="第一步">«</button><button class="btn sm" data-a="sc-prev" title="上一步 (←)" aria-label="上一步">◀</button><button class="btn sm primary" data-a="sc-play" title="播放 / 暂停 (空格)" aria-label="播放">' + (SC.playing ? '‖ 暂停' : '▶ 播放') + '</button><button class="btn sm" data-a="sc-next" title="下一步 (→)" aria-label="下一步">▶</button><span class="muted ipm-pos">' + (i + 1) + ' / ' + n + '</span></div><div class="ipm-pills">' + sc.steps.map((x, k) => '<button class="ipm-pill' + (k === i ? ' on' : '') + (k < i ? ' done' : '') + '" data-a="sc-go" data-i="' + k + '" title="' + esc(x.title) + '">' + (k + 1) + '</button>').join('') + '</div><div class="ipm-prog" aria-hidden="true"><i style="transform:scaleX(' + (SC.lastFrac != null ? SC.lastFrac : (i + 1) / n) + ')"></i></div>';
      if (d) {
        const ds = d.step, es = draftEdges(), regs = Object.keys(m.registers), nl = ds.nodes.map(id => (nodeById(id) || {}).name || id);
        out += '<div class="ipm-sec">' + (d.mode === 'edit' ? '编辑第 ' + (d.index + 1) + ' 步' : '录制新步骤（第 ' + (d.index + 1) + ' 位）') + '</div><form class="ipm-form" data-form="draft"><label class="w">标题<input class="input" name="title" value="' + esc(ds.title) + '" placeholder="例如：CPU 写 ID"></label><label class="w">说明<textarea class="input" name="note" rows="3" placeholder="这一步发生了什么（支持 **粗体** 和 `代码`）">' + esc(ds.note) + '</textarea></label>' +
          '<label>依据<select class="select" name="level">' + IPM.EV_LEVELS.map(l => '<option' + (l === ((ds.ev || {}).level || '待核对') ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></label><label>页码<input class="input" name="page" value="' + esc((ds.ev || {}).page == null ? '' : ds.ev.page) + '" placeholder="123"></label><label>代码行<input class="input" name="line" value="' + esc(ds.line == null ? '' : ds.line) + '" placeholder="可选"></label><span></span>' +
          '<div class="w"><div class="ipm-sec" style="margin-top:0">高亮节点 · 在图上点击来加入 / 移除</div><div class="ipm-ports">' + (ds.nodes.length ? ds.nodes.map((id, k) => '<span class="chip brand">' + esc(nl[k]) + ' <button type="button" class="ipm-x" data-a="dr-rmnode" data-id="' + esc(id) + '" aria-label="移除">×</button></span>').join('') : '<span class="muted">还没有选节点</span>') + '</div></div>' +
          '<div class="w"><div class="ipm-sec" style="margin-top:0">高亮连线 <button type="button" class="linkbtn" data-a="dr-autoedges">选取节点之间的全部连线</button></div>' + (es.length ? es.map(e => '<label class="ipm-chk"><input type="checkbox" data-edge="' + esc(e.id) + '"' + (ds.edges.includes(e.id) ? ' checked' : '') + '> <span class="mono">' + esc(e.source) + ' → ' + esc(e.target) + '</span></label>').join('') : '<span class="muted">选了节点后，和它们相连的连线会列在这里</span>') + '</div>' +
          '<div class="w"><div class="ipm-sec" style="margin-top:0">寄存器写入 <button type="button" class="linkbtn" data-a="dr-addwrite"' + (regs.length ? '' : ' disabled') + '>＋ 添加</button></div>' + (regs.length ? '' : '<span class="muted">模型里还没有寄存器（可从 SVD 导入，或让 AI 定义）</span>') + ds.writes.map((w, k) => '<div class="ipm-wrow"><select class="select" name="wreg">' + regs.map(r => '<option' + (r === w.reg ? ' selected' : '') + ' value="' + esc(r) + '">' + esc(m.registers[r].name) + '</option>').join('') + '</select><input class="input" name="wval" value="' + esc(w.value) + '" placeholder="0x1"><input class="input" name="wnote" value="' + esc(w.note || '') + '" placeholder="说明（可选）"><button type="button" class="ipm-x" data-a="dr-rmwrite" data-k="' + k + '" aria-label="删除这条写入">×</button></div>').join('') + '</div>' +
          '<div class="w ipm-acts" style="margin-top:0"><button class="btn sm primary" type="submit">保存步骤</button><button class="btn sm" type="button" data-a="dr-cancel">取消</button></div></form>';
        return out;
      }
      if (!n) return out + SL.emptyHtml({ icon: 'play', title: '这个场景还没有步骤', msg: '一步 = 高亮几个节点 + 写了哪些寄存器 + 一句说明。', primary: { t: '录制第一步', a: 'sc-rec' } }) + sceneTail(sc);
      out += '<div class="ipm-step"><div class="sc-tag">STEP ' + (i + 1) + ' / ' + n + '</div><h4 class="ipm-st">' + esc(s.title) + '</h4>' + (s.note ? '<div class="sc-x">' + mdInline(s.note) + '</div>' : '') + '<div class="ipm-row">' + evChip(s.ev) + (s.line != null ? ' <span class="muted">代码第 ' + esc(s.line) + ' 行</span>' : '') + '</div>' +
        (s.nodes.length ? '<div class="ipm-ports">' + s.nodes.map(id => '<a href="#" class="chip" data-sel="node:' + esc(id) + '">' + esc((nodeById(id) || {}).name || id) + '</a>').join('') + '</div>' : '') +
        (s.writes.length ? '<div class="ipm-sec">寄存器变化</div>' + (() => { const pv = prevValues(sc, i); return s.writes.map(w => writeCard(w, pv[w.reg] == null ? null : pv[w.reg])).join(''); })() : '') + derivedBlock(sc, i) + '</div>' +
        '<div class="ipm-acts"><button class="btn sm" data-a="sc-edit">编辑此步</button><button class="btn sm" data-a="sc-rec" title="在当前步之后录制一个新步骤">录制下一步</button><button class="btn sm" data-a="sc-up"' + (i ? '' : ' disabled') + '>上移</button><button class="btn sm" data-a="sc-down"' + (i < n - 1 ? '' : ' disabled') + '>下移</button><button class="btn sm danger" data-a="sc-delstep">删除此步</button></div>';
      return out + sceneTail(sc);
    };
    const sceneTail = sc => { const e = sc.ev || {}; return '<div class="ipm-sec">场景信息</div><form class="ipm-form" data-form="sceneev"><label>依据<select class="select" name="level">' + IPM.EV_LEVELS.map(l => '<option' + (l === (e.level || '待核对') ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></label><label>页码<input class="input" name="page" value="' + esc(e.page == null ? '' : e.page) + '"></label><button class="btn sm" type="submit">应用</button></form><div class="ipm-acts"><button class="btn sm" data-a="sc-rename">重命名场景</button><button class="btn sm danger" data-a="sc-delscene">删除场景</button></div>'; };
    const slugId = (name, taken) => { let b = String(name || '').replace(/[^A-Za-z0-9_\-]+/g, '_').replace(/^_+|_+$/g, ''); if (!b || !/^[A-Za-z_]/.test(b)) b = 'scene'; let id = b, k = 2; while (taken.has(id)) id = b + '_' + k++; return id; };
    const SA = {
      'rule-new': () => openRuleForm('add'), 'rule-edit': b => openRuleForm('edit', b.dataset.id), 'rule-cancel': () => { st.rdraft = null; drawSide(); },
      'rule-open': b => { st.tab = 'rules'; t.ipmTab = 'rules'; showSide(); drawSide(); const el = pane.querySelector('[data-rule="' + CSS.escape(b.dataset.id) + '"]'); if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1200); } },
      'rule-del': async b => { const r = ruleById(b.dataset.id); if (!r) return; if (!(await SL.confirm('删除规则 “' + r.name + '”？\n用到它的推演结果会少掉这一条推导。可以用“撤销”恢复。', '删除', true))) return; await commit([{ op: 'remove_rule', id: r.id }], '删除规则 ' + r.id); },
      'sc-new': async () => { const name = await SL.prompt('场景名称（例如：接收一帧）', ''); if (!name) return; const id = slugId(name, new Set(M().scenes.map(x => x.id))); const r = await commit([{ op: 'add_scene', scene: { id, name, steps: [] } }], '添加场景 ' + name); if (r && r.ok) { stopPlay(); SC.id = id; SC.step = 0; remember(); st.tab = 'scenes'; t.ipmTab = 'scenes'; drawSide(); applyScene(); openDraft('add', 0); } },
      'sc-pick': b => { stopPlay(); st.draft = null; SC.id = b.dataset.id; SC.step = 0; remember(); drawSide(); applyScene(); },
      'sc-first': () => goStep(0), 'sc-prev': () => goStep((curScene() ? stepIdx(curScene()) : 0) - 1), 'sc-next': () => goStep((curScene() ? stepIdx(curScene()) : 0) + 1), 'sc-play': () => togglePlay(), 'sc-go': b => { stopPlay(); goStep(+b.dataset.i); },
      'sc-rec': () => { const sc = curScene(); if (sc) openDraft('add', sc.steps.length ? stepIdx(sc) + 1 : 0); },
      'sc-edit': () => { const sc = curScene(), s = curStep(); if (sc && s) openDraft('edit', stepIdx(sc), s); },
      'sc-up': () => { const sc = curScene(); if (sc) commit([{ op: 'move_step', scene: sc.id, from: stepIdx(sc), to: stepIdx(sc) - 1 }], '上移步骤').then(r => { if (r && r.ok) goStep(SC.step - 1); }); },
      'sc-down': () => { const sc = curScene(); if (sc) commit([{ op: 'move_step', scene: sc.id, from: stepIdx(sc), to: stepIdx(sc) + 1 }], '下移步骤').then(r => { if (r && r.ok) goStep(SC.step + 1); }); },
      'sc-delstep': async () => { const sc = curScene(), s = curStep(); if (!sc || !s) return; if (!(await SL.confirm('删除第 ' + (stepIdx(sc) + 1) + ' 步 “' + s.title + '”？可以用“撤销”恢复。', '删除', true))) return; const r = await commit([{ op: 'remove_step', scene: sc.id, index: stepIdx(sc) }], '删除步骤'); if (r && r.ok) goStep(SC.step); },
      'sc-rename': async () => { const sc = curScene(); if (!sc) return; const name = await SL.prompt('场景名称', sc.name); if (!name || name === sc.name) return; await commit([{ op: 'update_scene', id: sc.id, set: { name } }], '重命名场景'); },
      'sc-delscene': async () => { const sc = curScene(); if (!sc) return; if (!(await SL.confirm('删除场景 “' + sc.name + '”（' + sc.steps.length + ' 步）？可以用“撤销”恢复。', '删除', true))) return; stopPlay(); const r = await commit([{ op: 'remove_scene', id: sc.id }], '删除场景 ' + sc.name); if (r && r.ok) { SC.id = null; SC.step = 0; remember(); drawSide(); applyScene(); } },
      'dr-cancel': () => { st.draft = null; drawSide(); applyScene(); }, 'dr-rmnode': b => toggleDraftNode(b.dataset.id),
      'dr-autoedges': () => { syncDraft(); st.draft.step.edges = draftEdges().filter(e => st.draft.step.nodes.includes(IPM.endpoint(e.source).node) && st.draft.step.nodes.includes(IPM.endpoint(e.target).node)).map(e => e.id); drawSide(); applyScene(); },
      'dr-addwrite': () => { syncDraft(); const regs = Object.keys(M().registers); if (!regs.length) return; const used = new Set(st.draft.step.nodes.flatMap(id => (nodeById(id) || {}).registers || [])); const first = regs.find(r => used.has(r)) || regs[0]; st.draft.step.writes.push({ reg: first, value: '', note: '' }); drawSide(); const rows = pane.querySelectorAll('.ipm-wrow'); const last = rows[rows.length - 1]; if (last) last.querySelector('[name=wval]').focus(); },
      'dr-rmwrite': b => { syncDraft(); st.draft.step.writes.splice(+b.dataset.k, 1); drawSide(); },
    };
    /* ----- search (Ctrl+F): matches stay lit, the rest of the diagram dims; Enter / Shift+Enter walk through the matches ----- */
    const fbox = h('div', { class: 'ipm-find' }, '<input class="input" type="search" placeholder="搜索节点（Ctrl+F）" aria-label="搜索节点"><span class="muted ipm-fc" aria-live="polite"></span>'); $('.ipm-main', R).appendChild(fbox);
    const finp = $('input', fbox), fcnt = $('.ipm-fc', fbox); let fhits = [], fcur = -1;
    const applySearch = () => {
      const svg = cv.querySelector('svg.ipb-svg'), q = finp.value.trim().toLowerCase(); if (!svg) return; const big = svg.classList.contains('ipb-big'); svg.querySelectorAll('.fm').forEach(x => x.classList.remove('fm'));
      if (!q) { svg.classList.remove('fq'); fhits = []; fcur = -1; fcnt.textContent = ''; if (big) { clearVeil(svg); applyScene(); } return; }
      const ids = new Set(); shown().nodes.forEach(n => { if ((n.name + ' ' + n.id + ' ' + (n.type || '') + ' ' + (n.note || '')).toLowerCase().includes(q)) { const v = visible(svg, n.id); if (v) ids.add(v); } });
      fhits = Array.from(ids); if (big) { clearVeil(svg); svg.classList.remove('sc-focus'); if (!putVeil(svg, fhits, [], 'fm-layer')) fcnt.textContent = fhits.length + '（太多，不逐个高亮）'; if (fcur >= fhits.length) fcur = -1; if (fhits.length && fcnt.textContent.indexOf('太多') < 0) fcnt.textContent = (fcur >= 0 ? (fcur + 1) + ' / ' : '') + fhits.length; if (!fhits.length) fcnt.textContent = '无匹配'; return; } svg.classList.toggle('fq', true); fhits.forEach(id => { const el = svg.querySelector('[data-id="' + CSS.escape(id) + '"]'); if (el) el.classList.add('fm'); }); if (fcur >= fhits.length) fcur = -1;
      fcnt.textContent = fhits.length ? (fcur >= 0 ? (fcur + 1) + ' / ' : '') + fhits.length : '无匹配';
    };
    const stepFind = dir => { if (!fhits.length) return; fcur = (fcur + dir + fhits.length) % fhits.length; const id = fhits[fcur], el = cv.querySelector('svg.ipb-svg [data-id="' + CSS.escape(id) + '"]'); fcnt.textContent = (fcur + 1) + ' / ' + fhits.length; select('node', id, st.tab === 'scenes' ? undefined : 'detail'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', inline: 'center', behavior: SL.motion && SL.motion.level === 'off' ? 'auto' : 'smooth' }); };
    finp.addEventListener('input', () => { fcur = -1; applySearch(); }); finp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1); } else if (e.key === 'Escape') { e.stopPropagation(); finp.value = ''; applySearch(); cv.focus && cv.focus(); } });
    R.addEventListener('keydown', e => { if (e.key === 'Escape' && st.msel.length && !/INPUT|TEXTAREA|SELECT/.test((e.target.tagName || ''))) { st.msel = []; mark(); drawSide(); } if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') { e.preventDefault(); e.stopPropagation(); finp.focus(); finp.select(); } }, true);
    const setFocus = (node, depth) => { st.enter = true; view().focus = node ? { node, depth: depth == null ? 1 : depth } : null; saveLayout(); drawBar(); drawCanvas(); };
    const accept = async () => {
      const p = st.prop; if (!p) return; const res = IPM.apply(M(), p.ops); if (!res.ok) return SL.toast('这些修改现在无法应用', 4000, 'bad');
      const r = await commit(p.ops, 'AI 修改：' + (p.title || ''), { after: async () => { try { await fs.rm(PP(path)); } catch (e) { } st.prop = null; } });
      if (r && r.ok !== false) SL.toast('已接受 ' + p.ops.length + ' 项修改');
    };
    const reject = async () => { if (!st.prop) return; if (!(await SL.confirm('拒绝这 ' + st.prop.ops.length + ' 项修改？模型不会改变。', '拒绝', true))) return; try { await fs.rm(PP(path)); } catch (e) { } st.prop = null; drawBar(); drawSide(); SL.toast('已拒绝'); };
    const saveSvg = () => { const svg = cv.querySelector('svg.ipb-svg'); if (!svg) return SL.toast('没有可导出的图'); const c = svg.cloneNode(true); c.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); const stl = document.createElementNS('http://www.w3.org/2000/svg', 'style'); stl.textContent = (SL.ipblock.SVG_CSS || ''); c.insertBefore(stl, c.firstChild); if (SL.saveOut) SL.saveOut(M().id + '.svg', '<?xml version="1.0" encoding="UTF-8"?>\n' + c.outerHTML); };

    R.addEventListener('click', async e => {
      const tab = e.target.closest('[data-tab]'); if (tab) { if (st.tab === 'scenes' && tab.dataset.tab !== 'scenes') { stopPlay(); } const changed = st.tab !== tab.dataset.tab; st.tab = tab.dataset.tab; t.ipmTab = st.tab; drawSide(); if (changed) swapPane(); applyScene(); return; }
      const pg = e.target.closest('.ipm-pg, [data-a=page]'); if (pg) { e.preventDefault(); return SL.gotoPage && SL.gotoPage(M().source, +String(pg.dataset.page).split(/[-,]/)[0]); }
      const sel = e.target.closest('[data-sel]'); if (sel) { e.preventDefault(); const [k, ...r] = sel.dataset.sel.split(':'); const id = r.join(':'); if (k === 'edge') { return select('edge', id, 'detail'); } if (k === 'register') return select('register', id, 'regs'); if (k === 'field') return select('register', id.split('.')[0], 'regs'); return select('node', id, 'detail'); }
      const reg = e.target.closest('.ipm-rh'); if (reg) { const id = reg.parentNode.dataset.reg; return select('register', st.sel && st.sel.kind === 'register' && st.sel.id === id ? null : id, 'regs'); }
      const b = e.target.closest('[data-a]'); if (b) { e.preventDefault(); const a = b.dataset.a;
        if (a === 'tab-find' || a === 'tab-changes') { showSide(); st.tab = a === 'tab-find' ? 'find' : 'changes'; t.ipmTab = st.tab; return drawSide(); }
        if (a === 'side') { st.hide = !st.hide; st.hideAuto = false; view().inspector = !st.hide; saveLayout(); applySide(); return; }
        if (a === 'fit') { view().fit = view().fit === false; saveLayout(); return fit(); }
        if (a === 'dir') { st.enter = true; view().direction = view().direction === 'down' ? 'right' : 'down'; saveLayout(); drawBar(); return drawCanvas(); }
        if (a === 'collapse') { const groups = groupIds(M()), cur = new Set(collapsedIds(M())), all = groups.length && groups.every(id => cur.has(id)); setCollapsed(all ? [] : groups); return redrawCollapsed(); }
        if (a === 'toggle') { const id = b.dataset.id, c = collapsedIds(M()); setCollapsed(c.includes(id) ? c.filter(x => x !== id) : c.concat(id)); drawSide(); return redrawCollapsed(); }
        if (a === 'expandall') { const n = countBlocks(M()); if (!(await SL.confirm('展开全部 ' + n + ' 个节点？\n节点多时布局会慢（几秒到几十秒），图也会很大。更常用的做法是双击某个分组只展开它，或用“只看这个节点及邻居”。', '展开全部'))) return; setCollapsed([]); return redrawCollapsed(); }
        if (a === 'retry') return drawCanvas(true);
        if (a === 'focus') return setFocus(b.dataset.id, 1); if (a === 'unfocus') return setFocus(null); if (a === 'depth+' || a === 'depth-') { const f = focusOf(); if (f) setFocus(f.node, Math.max(0, Math.min(6, (f.depth == null ? 1 : f.depth) + (a === 'depth+' ? 1 : -1)))); return; }
        if (a === 'resetpos') return resetPositions(); if (a === 'unpin') return resetPositions([b.dataset.id]);
        if (a === 'ms-clear') { st.msel = []; mark(); return drawSide(); } if (a === 'ms-unpin') return resetPositions(st.msel.slice());
        if (a === 'ms-copy') { try { await navigator.clipboard.writeText(st.msel.join(', ')); SL.toast('已复制 ' + st.msel.length + ' 个 id'); } catch (er) { SL.toast('无法访问剪贴板', 3000, 'bad'); } return; }
        if (a === 'ms-group') { const ids = topOnly(st.msel.filter(id => nodeById(id))); if (ids.length < 2) return; const name = await SL.prompt('新分组名称（把所选 ' + ids.length + ' 项放进去）', ''); if (!name) return; const taken = new Set(M().nodes.map(n => n.id)), gid = slug(name, taken), par = new Set(ids.map(id => (nodeById(id) || {}).parent || '')), common = par.size === 1 ? Array.from(par)[0] : '';
          const gnode = { id: gid, kind: 'group', name }; if (common) gnode.parent = common; const r = await commit([{ op: 'add_node', node: gnode }].concat(ids.map(id => ({ op: 'update_node', id, set: { parent: gid } }))), '把 ' + ids.length + ' 项放进分组 ' + name); if (r && r.ok) { st.msel = []; select('node', gid, 'detail'); } return; }
        if (a === 'ms-del') { const ids = topOnly(st.msel.filter(id => nodeById(id))); if (!ids.length) return; const all = new Set(ids.flatMap(id => IPM.subgraph(M(), { node: id, depth: 0 }).nodes.map(q => q.id))), ne = M().edges.filter(e => all.has(IPM.endpoint(e.source).node) || all.has(IPM.endpoint(e.target).node)).length;
          if (!(await SL.confirm('删除所选 ' + ids.length + ' 项？\n连同其中的子节点共 ' + all.size + ' 个节点' + (ne ? '，以及相关连线 ' + ne + ' 条' : '') + '。可以用“撤销”恢复。', '删除', true))) return; const r = await commit(ids.map(id => ({ op: 'remove_node', id })), '删除 ' + ids.length + ' 项'); if (r && r.ok) { st.msel = []; select(null); } return; }
        if (SA[a]) return SA[a](b); if (ui[a]) return ui[a](b.dataset.id || null, b); if (a === 'rmedge') return E.removeEdge(b.dataset.id);
        if (a === 'undo') return undo(); if (a === 'svg') return saveSvg(); if (a === 'accept') return accept(); if (a === 'reject') return reject(); if (a === 'addref') return addRef(b.dataset.id || null); if (a === 'regall') { st.regFilter = false; return drawSide(); } }
    });
    R.addEventListener('submit', async e => {
      const fr_ = e.target.closest('[data-form=rule]'); if (fr_) { e.preventDefault(); return saveRule(); }
      const fd_ = e.target.closest('[data-form=draft]'); if (fd_) { e.preventDefault(); return saveDraft(); }
      const fs_ = e.target.closest('[data-form=sceneev]'); if (fs_) { e.preventDefault(); const sc = curScene(); if (!sc) return; const v = Object.fromEntries(new FormData(fs_).entries()), evv = { level: v.level }; if (String(v.page).trim()) evv.page = String(v.page).trim(); if (evv.level === '手册确认' && !(evv.page || (sc.ev && sc.ev.page))) return SL.toast('“手册确认”必须写页码', 4500, 'bad'); const r = await commit([{ op: 'update_scene', id: sc.id, set: { ev: evv } }], '修改场景依据'); if (r && r.ok) SL.toast('已保存'); return; }
      const f = e.target.closest('[data-form=ev]'); if (!f) return; e.preventDefault(); const n = nodeById(st.sel && st.sel.id); if (!n) return; const fd = Object.fromEntries(new FormData(f).entries()); const ev = { level: fd.level }; if (fd.page.trim()) ev.page = fd.page.trim(); if (fd.sec.trim()) ev.sec = fd.sec.trim();
      if (ev.level === '手册确认' && !(ev.page || (n.ev && n.ev.page))) return SL.toast('“手册确认”必须写页码：没有页码的内容只能是“待核对”或“示意”', 4500, 'bad');
      const ops = [{ op: 'set_evidence', target: 'node:' + n.id, ev }]; if ((n.note || '') !== fd.note.trim()) ops.push({ op: 'update_node', id: n.id, set: { note: fd.note.trim() } });
      const r = await commit(ops, '修改 ' + n.id + ' 的依据'); if (r && r.ok) SL.toast('已保存');
    });
    /* ----- pointer (2.2): drag a node / group = MOVE it; drop it ON another node = connect / move inside; drag on empty canvas = marquee ----- */
    let drag = null, band = null, swallow = false; const at = (x, y) => ({ getBoundingClientRect: () => ({ left: x, top: y, bottom: y }) });
    const posOf = id => (L().positions || {})[id] || null, hasPos = () => Object.keys(L().positions || {}).length > 0;
    const unitsPerPx = () => { const svg = cv.querySelector('svg.ipb-svg'); if (!svg) return 1; const r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal; return r.width ? vb.width / r.width : 1; };   /* diagram units per screen pixel (fit AND zoom) */
    const offsetsNow = () => { const o = {}, ids = new Set(st.model.nodes.map(n => n.id)), p = L().positions || {}; Object.keys(p).forEach(id => { if (ids.has(id) && p[id] && (+p[id].dx || +p[id].dy)) o[id] = { dx: +p[id].dx || 0, dy: +p[id].dy || 0 }; }); return o; };
    const ancestorsOf = id => { const out = []; let n = nodeById(id), k = 0; while (n && n.parent && k++ < 60) { out.push(n.parent); n = nodeById(n.parent); } return out; };
    const topOnly = ids => { const set = new Set(ids); return ids.filter(id => !ancestorsOf(id).some(a => set.has(a))); };   /* a selected group already carries its selected members */
    const moveBy = (ids, dx, dy) => { const p = L().positions = L().positions || {}; topOnly(ids).forEach(id => { const o = p[id] || { dx: 0, dy: 0 }, nx = Math.round(o.dx + dx), ny = Math.round(o.dy + dy); if (!nx && !ny) delete p[id]; else p[id] = { dx: nx, dy: ny }; }); saveLayout(); drawBar(); return drawCanvas(); };
    const resetPositions = ids => { const p = L().positions || {}; (ids || Object.keys(p)).forEach(id => { delete p[id]; }); saveLayout(); drawBar(); drawSide(); return drawCanvas(); };
    const choosePort = async (n, prefer, x, y) => { if (!n.ports.length) return ''; const use = n.ports.filter(p => prefer.includes(p.dir)); if (!use.length) return ''; if (use.length === 1) return use[0].id;   /* no port facing the right way → connect the node itself rather than a wrong-direction port */ return pickMenu(at(x, y), [{ k: '', t: '整个节点 ' + n.name }].concat(use.map(p => ({ k: p.id, t: n.name + '.' + p.id + '（' + (PT[p.type] || p.type) + '）' })))); };
    const connectNodes = async (a, b, x, y) => { const A = nodeById(a), B = nodeById(b); const pa = await choosePort(A, ['out', 'inout'], x, y); if (pa == null) return; const pb = await choosePort(B, ['in', 'inout'], x, y); if (pb == null) return; return E.connect(a + (pa ? '.' + pa : ''), b + (pb ? '.' + pb : '')); };
    const dropMenu = (a, b, x, y) => {
      const A = nodeById(a), B = b ? nodeById(b) : null; const items = [];
      if (B) { items.push({ k: 'ab', t: '连线：' + A.name + ' → ' + B.name }, { k: 'ba', t: '连线：' + B.name + ' → ' + A.name }); const inside = IPM.subgraph(M(), { node: a, depth: 0 }).nodes.some(n => n.id === b); if (!inside && A.parent !== b) items.push({ k: 'into', t: '移入 ' + B.name + '（成为它的子节点）' }); if (A.parent && A.parent !== b) items.push({ k: 'out', t: '移出 “' + ((nodeById(A.parent) || {}).name || A.parent) + '”（变成顶层节点）' }); }
      if (!items.length) return;
      SL.menu(at(x, y), items, k => { if (k === 'ab') connectNodes(a, b, x, y); else if (k === 'ba') connectNodes(b, a, x, y); else if (k === 'into') commit([{ op: 'update_node', id: a, set: { parent: b } }], '把 ' + a + ' 移入 ' + b); else if (k === 'out') commit([{ op: 'update_node', id: a, set: { parent: '' } }], '把 ' + a + ' 移出分组'); });
    };
    const insideEl = (el, x, y) => { if (!el) return false; const r = el.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };
    const dragMove = e => {
      if (!drag) return; if (!drag.on) { if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 7) return; drag.on = true; cv.classList.add('dragging'); const n = (st.msel.length > 1 && st.msel.includes(drag.id)) ? st.msel.length + ' 个节点' : ((nodeById(drag.id) || {}).name || drag.id); drag.ghost = h('div', { class: 'ipm-ghost' }, esc(n)); document.body.appendChild(drag.ghost); }
      drag.ghost.style.left = (e.clientX + 12) + 'px'; drag.ghost.style.top = (e.clientY + 8) + 'px';
      const el = document.elementFromPoint(e.clientX, e.clientY), tg = el && el.closest ? el.closest('.ipb-node, .ipb-group') : null, own = new Set([drag.id].concat(ancestorsOf(drag.id)));
      const over = tg && cv.contains(tg) && !own.has(tg.dataset.id) && !tg.hasAttribute('data-clone') ? tg : null;   /* the group the node already sits in is "empty space" for it: dropping there = moving */
      if (drag.over !== over) { if (drag.over) drag.over.classList.remove('drop'); if (over) over.classList.add('drop'); drag.over = over; }
    };
    const dragEnd = e => {
      document.removeEventListener('mousemove', dragMove, true); document.removeEventListener('mouseup', dragEnd, true); const d = drag; drag = null; if (!d || !d.on) return;
      cv.classList.remove('dragging'); if (d.ghost) d.ghost.remove(); if (d.over) d.over.classList.remove('drop'); swallow = true; setTimeout(() => { swallow = false; }, 0);
      if (d.over) return dropMenu(d.id, d.over.dataset.id, e.clientX, e.clientY);
      const k = unitsPerPx(), dx = (e.clientX - d.x) * k, dy = (e.clientY - d.y) * k, ids = (st.msel.length > 1 && st.msel.includes(d.id)) ? st.msel : [d.id], n = nodeById(d.id);
      const frame = n && n.parent ? cv.querySelector('.ipb-group[data-id="' + CSS.escape(n.parent) + '"] rect') : null;
      if (ids.length === 1 && n && n.parent && frame && !insideEl(frame, e.clientX, e.clientY)) { const pn = (nodeById(n.parent) || {}).name || n.parent; return SL.menu(at(e.clientX, e.clientY), [{ k: 'here', t: '留在 “' + pn + '” 里，位置放在这里（分组会跟着变大）' }, { k: 'out', t: '移出 “' + pn + '”（变成顶层节点），位置放在这里' }], async c => { if (c === 'here') moveBy(ids, dx, dy); else if (c === 'out') { const r = await commit([{ op: 'update_node', id: d.id, set: { parent: '' } }], '把 ' + d.id + ' 移出分组'); if (r && r.ok) moveBy(ids, dx, dy); } }); }
      moveBy(ids, dx, dy);
    };
    /* marquee */
    const bandEnd = e => {
      document.removeEventListener('mousemove', bandMove, true); document.removeEventListener('mouseup', bandEnd, true); const b = band; band = null; if (!b) return; if (b.el) b.el.remove(); if (!b.on) return;
      swallow = true; setTimeout(() => { swallow = false; }, 0); const x0 = Math.min(b.x, e.clientX), x1 = Math.max(b.x, e.clientX), y0 = Math.min(b.y, e.clientY), y1 = Math.max(b.y, e.clientY), hit = [];
      cv.querySelectorAll('.ipb-node:not([data-clone]), .ipb-group:not([data-clone])').forEach(el => { const r = el.getBoundingClientRect(), isG = el.classList.contains('ipb-group'); if (isG ? (r.left >= x0 && r.right <= x1 && r.top >= y0 && r.bottom <= y1) : !(r.right < x0 || r.left > x1 || r.bottom < y0 || r.top > y1)) hit.push(el.dataset.id); });
      if (st.draft) { syncDraft(); hit.filter(id => nodeById(id) && !st.model.nodes.some(n => n.parent === id)).forEach(id => { if (!st.draft.step.nodes.includes(id)) st.draft.step.nodes.push(id); }); drawSide(); applyScene(); return; }
      setMsel((e.shiftKey || e.ctrlKey || e.metaKey) ? Array.from(new Set(st.msel.concat(hit))) : hit);
    };
    const bandMove = e => { if (!band) return; if (!band.on) { if (Math.hypot(e.clientX - band.x, e.clientY - band.y) < 6) return; band.on = true; band.el = h('div', { class: 'ipm-band' }); document.body.appendChild(band.el); } const x0 = Math.min(band.x, e.clientX), y0 = Math.min(band.y, e.clientY); Object.assign(band.el.style, { left: x0 + 'px', top: y0 + 'px', width: Math.abs(e.clientX - band.x) + 'px', height: Math.abs(e.clientY - band.y) + 'px' }); };
    cv.addEventListener('mousedown', e => {
      if (e.button !== 0) return; if (e.target.closest('.ipm-focus, .ipm-mini, .ipm-busy, .ipb-legend, button, input')) return;
      const nd = e.target.closest('.ipb-node, .ipb-group');
      if (nd) { if (st.draft || e.shiftKey || e.ctrlKey || e.metaKey || !nodeById(nd.dataset.id)) return; drag = { id: nd.dataset.id, x: e.clientX, y: e.clientY, on: false, ghost: null, over: null }; document.addEventListener('mousemove', dragMove, true); document.addEventListener('mouseup', dragEnd, true); return; }
      if (e.target.closest('svg.ipb-svg, .ipb-canvas')) { band = { x: e.clientX, y: e.clientY, on: false, el: null }; document.addEventListener('mousemove', bandMove, true); document.addEventListener('mouseup', bandEnd, true); }
    });
    cv.addEventListener('click', e => { if (swallow) { e.stopPropagation(); e.preventDefault(); } }, true);
    cv.addEventListener('dblclick', e => { const nd = e.target.closest('.ipb-node'); if (!nd || st.draft) return; const id = nd.dataset.id, n = nodeById(id); if (!n) return; const has = st.model.nodes.some(x => x.parent === id); if (!has || !collapsedIds(M()).includes(id)) return; e.preventDefault(); setCollapsed(collapsedIds(M()).filter(x => x !== id)); drawSide(); redrawCollapsed(); });
    R.addEventListener('input', e => { if (e.target.closest('[data-form=rule]')) liveRule(); });
    R.addEventListener('change', e => { if (e.target.closest('[data-form=rule] [name=trigger]') && st.rdraft) { st.rdraft.rule = ruleOf(st.rdraft); drawSide(); return; } const c = e.target.closest('[data-edge]'); if (!c || !st.draft) return; const ed = st.draft.step.edges, id = c.dataset.edge, i = ed.indexOf(id); if (c.checked && i < 0) ed.push(id); if (!c.checked && i >= 0) ed.splice(i, 1); applyScene(); });
    cv.addEventListener('click', e => {
      const b = e.target.closest('[data-a]'); if (b && b.closest('.ipm-focus')) return;
      if (st.draft) { const el = e.target.closest('.ipb-node, .ipb-group'); if (el) toggleDraftNode(el.dataset.id); return; }
      const tabKeep = st.tab === 'scenes' ? undefined : 'detail';
      const nd = e.target.closest('.ipb-node') || e.target.closest('.ipb-group'); if (nd && nodeById(nd.dataset.id) && (e.shiftKey || e.ctrlKey || e.metaKey)) return toggleMsel(nd.dataset.id);
      if (st.msel.length && !(nd && st.msel.includes(nd.dataset.id) && st.msel.length > 1)) st.msel = [];
      if (nd) return select('node', nd.dataset.id, tabKeep);
      if (!e.target.closest('.ipb-legend')) select(null);
    });
    R.addEventListener('keydown', e => { if (st.tab === 'scenes' && !st.draft && !/INPUT|TEXTAREA|SELECT/.test((e.target.tagName || '')) && curScene()) { if (e.key === 'ArrowRight') { e.preventDefault(); stopPlay(); return goStep(stepIdx(curScene()) + 1); } if (e.key === 'ArrowLeft') { e.preventDefault(); stopPlay(); return goStep(stepIdx(curScene()) - 1); } if (e.key === ' ' && !e.target.closest('button')) { e.preventDefault(); return togglePlay(); } } if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !/INPUT|TEXTAREA|SELECT/.test((e.target.tagName || ''))) { e.preventDefault(); undo(); } if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.ipm-fd[data-sel]')) { e.preventDefault(); e.target.click(); } });
    const off = SL.on('fs-changed', async ps => { const k = U.pkey(PP(path)); if ((ps || []).some(p => U.pkey(p) === k)) { st.prop = await S.readProposal(path); drawBar(); drawSide(); } });

    t.viewer = { edit: E, scenes: { state: SC, go: goStep, play: togglePlay, stop: stopPlay, record: openDraft, pick: id => SA['sc-pick']({ dataset: { id } }) }, destroy: () => { miniUp(); stopPlay(); document.removeEventListener('mousemove', dragMove, true); document.removeEventListener('mouseup', dragEnd, true); off(); if (ro) ro.disconnect(); }, focus: setFocus, select, goPage: null, state: st, commit, accept, reject, undo, redraw: draw };
    S.open_ = t.viewer;
    await draw(); if (focusOf() === null && view().focus) view().focus = null;
    if (t.ipmFocus) { setFocus(t.ipmFocus.node, t.ipmFocus.depth); t.ipmFocus = null; }
    return R;
  };
  /* open a model focused on a sub-graph (workspace refs with { sub } come here) */
  S.openRef = async (path, sub) => { const tab = await SL.openPath(path); if (tab && tab.viewer && tab.viewer.focus) tab.viewer.focus(sub.node, sub.depth); else if (tab) tab.ipmFocus = sub; return tab; };

  /* templates live in ip-templates.js (pure, tested in Node): every item is 示意, structure only */
  const IPT = G.ChipBenchIPT; S.templates = IPT.templates; S.templateModel = IPT.model;

  /* The ELK worker is ~1.9 MB of compiled Java: starting it costs 1.5–2 s, which was most of the time to open even a SMALL .cbip.  Start it while idle after boot. */
  /* Starting the worker is only half of it (~0.35 s): the FIRST layout in a fresh worker costs ~0.9 s even for 17 blocks (the compiled code has not been optimised yet).
     So pre-warming also lays out a tiny graph shaped like the real ones (a group, a port-less link, an IRQ link) — the first real open is then ~1 s faster. */
  S.warm = async () => { try { if (!(SL.elk && SL.elk.worker && SL.ipblock)) return false; await SL.elk.worker(); const M = SL.ipblock.normalize({ title: 'warm', groups: [{ id: 'g' }], blocks: [{ id: 'a', label: 'A', group: 'g', kind: 'cpu' }, { id: 'b', label: 'B', group: 'g' }, { id: 'c', label: 'C', kind: 'mem' }, { id: 'd', label: 'D' }], links: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c', kind: 'data' }, { from: 'c', to: 'd' }, { from: 'a', to: 'd', kind: 'irq' }] }); await SL.elk.layout(SL.ipblock.toElk(M)); return true; } catch (e) { return false; } };
  setTimeout(() => { (G.requestIdleCallback || (f => setTimeout(f, 0)))(() => { S.warm(); }, { timeout: 6000 }); }, 3500);

  /* ---------------------------------------------------------------- commands */
  const targetDir = () => { const ws = SL.ws && SL.ws.cur; const root = ws && ws.roots && ws.roots[0]; return root ? root.path : null; };
  const pickPath = async (name) => { const dir = targetDir(); if (dir) return X.join(dir, 'IP模型', name.replace(/[\\/:*?"<>|]/g, '_') + '.cbip'); if (SL.saveOut) { const p = await SL.invoke('save_dialog', { name: name + '.cbip', filter: 'IP 模型', ext: 'cbip' }).catch(() => null); return p; } return null; };
  const mkdirp = async p => { const d = U.dir(p); try { await fs.mkdir(d); } catch (e) { } };
  S.newModel = async opt => {
    opt = opt || {}; const name = opt.name || await SL.prompt('IP 模型名称（例如 RH850/U2B · RS-CANFD）', ''); if (!name) return null;
    const kinds = [{ k: 'blank', t: '空白实例' }, { sep: 1 }, { head: '从模板开始（只写结构）' }].concat(Object.keys(S.templates).map(k => ({ k, t: S.templates[k].name })));
    const k = opt.template || await new Promise(res => SL.menu(document.querySelector('#tabs') || document.body, kinds, x => res(x || null)));
    if (!k) return null; const id = name.replace(/[^A-Za-z0-9_\-]/g, '_').replace(/^[^A-Za-z_]/, '_$&').replace(/_+/g, '_') || 'model';
    let model = k === 'blank' ? IPM.create({ id, name }) : IPT.instance(k, { id, name });
    const path = opt.path || await pickPath(name); if (!path) return null; if ((await fs.kind(path)) === 'file') { SL.toast('已存在：' + U.base(path), 3500, 'bad'); return null; }
    await mkdirp(path); await S.create(path, IPM.normalize(model)); if (A.externalChanged) A.externalChanged([path]); SL.toast('已创建 ' + U.base(path)); return SL.openPath(path);
  };
  S.importAtlas = async pagePath => {
    const AT = SL.atlas; if (!AT) return SL.toast('IP 图谱模块未加载'); if (!AT._scanned) { try { await AT.scan(); } catch (e) { } }
    const asPage = async p => { try { const r = await fs.read(p), fm = X.frontMatter(r.text).props || {}; if (String(fm.type || '') !== 'ip-atlas' && !/```ipblock/.test(r.text)) return null; return { path: p, ip: String(fm.ip || 'IP'), chip: String(fm.chip || ''), bundled: false }; } catch (e) { return null; } };
    let page = pagePath ? (AT.pages.find(p => U.pkey(p.path) === U.pkey(pagePath)) || await asPage(pagePath)) : null;
    if (!page && !pagePath) { const cur = A.current(); if (cur && cur.path && /\.md$/i.test(cur.path)) page = AT.pages.find(p => U.pkey(p.path) === U.pkey(cur.path)) || await asPage(cur.path); }
    if (!page && pagePath) return SL.toast('这不是 IP 图谱页面（需要 type: ip-atlas 或 ```ipblock 块）', 4000, 'bad');
    const r0 = await fs.read(page.path), r = IPM.fromAtlas(r0.text, SL.AM || G.ChipBenchAM, { path: U.base(page.path) });
    const dir = targetDir(); const base = (page.ip + '-' + page.chip).replace(/[\\/:*?"<>|\s]+/g, '_');
    const path = page.bundled ? (dir ? X.join(dir, 'IP模型', base + '.cbip') : await pickPath(base)) : page.path.replace(/\.md$/i, '.cbip'); if (!path) return null;
    if ((await fs.kind(path)) === 'file') { SL.toast('已存在 ' + U.base(path) + '，没有覆盖', 4000, 'bad'); return SL.openPath(path); }
    await mkdirp(path); await S.create(path, r.model); if (A.externalChanged) A.externalChanged([path]);
    SL.toast('已转换：' + r.model.nodes.length + ' 个节点、' + r.model.edges.length + ' 条连线、' + Object.keys(r.model.registers).length + ' 个寄存器' + (r.warnings.length ? '；跳过 ' + r.warnings.length + ' 项（' + r.warnings[0] + '）' : ''), 5000);
    return SL.openPath(path);
  };
  S.instantiateDialog = async () => {
    const cur = A.current(); const v = cur && cur.viewer; if (!cur || !v || !v.state) return SL.toast('先打开一个 IP 模型');
    const k = await new Promise(res => SL.menu(document.querySelector('#tabs') || document.body, Object.keys(S.templates).map(x => ({ k: x, t: S.templates[x].name })), x => res(x || null))); if (!k) return;
    const prefix = await SL.prompt('节点 id 前缀（例如 can1）', k + '1'); if (!prefix) return; const tm = S.templateModel(k); let ops; try { ops = IPM.instantiate(tm, { prefix, name: (await SL.prompt('显示名称', S.templates[k].name.replace(/^通用 /, '') + ' ' + prefix.replace(/^\D+/, ''))) || undefined }); } catch (e) { return SL.toast(e.message, 4000, 'bad'); }
    ops.forEach(o => { if (o.op === 'add_node') o.node.ev = { level: '待核对' }; if (o.op === 'add_edge') o.edge.ev = {}; }); const r = await v.commit(ops, '从模板添加 ' + prefix); if (r && r.ok) SL.toast('已添加 ' + prefix + '（结构为“待核对”，请对照手册补充依据）');
  };
  SL.cmd('ipm.new', '新建 IP 模型（.cbip）…', () => S.newModel(), { group: '工程' });
  SL.cmd('ipm.import', '把 IP 图谱页转换为 IP 模型…', () => S.importAtlas(), { group: '工程' });
  SL.cmd('ipm.instantiate', 'IP 模型：从模板添加…', () => S.instantiateDialog(), { group: '工程' });
  S.importSvd = async () => {
    const cur = A.current(), v = cur && cur.viewer; if (!cur || !v || !v.state) return SL.toast('先打开一个 IP 模型');
    const ps = await SL.invoke('pick_files', { filters: [{ name: 'CMSIS-SVD', extensions: ['svd', 'xml'] }] }).catch(() => []); if (!ps || !ps[0]) return;
    let regs; try { regs = X.parseSVD((await fs.read(ps[0])).text); } catch (e) { return SL.toast('SVD 解析失败：' + e.message, 4000, 'bad'); } if (!regs.length) return SL.toast('SVD 里没有寄存器');
    const pers = Array.from(new Set(regs.map(r => r.name.split('.')[0]))); const per = pers.length === 1 ? pers[0] : await new Promise(res => SL.menu(document.querySelector('#tabs') || document.body, pers.map(x => ({ k: x, t: x + '（' + regs.filter(r => r.name.split('.')[0] === x).length + ' 个寄存器）' })), k => res(k || null))); if (!per) return;
    const m = v.state.model, sel = v.state.sel && v.state.sel.kind === 'node' ? v.state.sel.id : null;
    const ops = IPM.svdOps(regs, { peripheral: per, node: sel, taken: Object.keys(m.registers) }); const n = ops.filter(o => o.op === 'define_register').length;
    const r = await v.commit(ops, '导入 SVD ' + per); if (r && r.ok) SL.toast('已导入 ' + n + ' 个寄存器（来自 ' + U.base(ps[0]) + '）' + (sel ? '，并关联到 ' + sel : '') + '。依据均为“待核对”：SVD 不是手册，请对照手册补页码', 6000); return r;
  };
  SL.cmd('ipm.svd', 'IP 模型：从 SVD 导入寄存器…', () => S.importSvd(), { group: '工程' });
  SL.cmd('ipm.accept', 'IP 模型：接受 AI 的修改', () => { const c = A.current(); c && c.viewer && c.viewer.accept && c.viewer.accept(); }, { group: '工程' });
})(window);
