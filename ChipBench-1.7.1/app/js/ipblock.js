/* ChipBench 1.3 · ipblock.js — ```ipblock  MCU / IP structure diagrams with automatic layout (elkjs, Eclipse Layout Kernel).
   · YAML: groups (nested sub-systems), blocks (modules with kind / page / regs / status), links (bus / data / clock / irq / dma / ctrl)
   · layout: ELK "layered", orthogonal routing, hierarchical (edges may cross group borders); runs in a Web Worker, results cached
   · click a block: page link into the manual, registers, note, 已确认 / 有疑问 (written back to the YAML, like clocktree)
   · importer: CMSIS-SVD → peripheral overview grouped by <groupName>, interrupt links to the interrupt controller
   Library: lib/elk/elk-worker.js (elkjs 0.9.3, EPL-2.0). */
(function (G) {
  'use strict';
  const SL = G.ChipBench; if (!SL) return;
  const U = SL.U, X = SL.X, esc = U.esc, h = U.h, $ = U.$;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const sv = (tag, a, text) => { const e = document.createElementNS(SVGNS, tag); for (const k in a || {}) e.setAttribute(k, a[k]); if (text != null) e.textContent = text; return e; };

  /* ---------------- ELK in a Web Worker ---------------- */
  const ELK = SL.elk = { ready: null, seq: 0, wait: new Map(), cache: new Map() };
  ELK.worker = () => {
    if (ELK.ready) return ELK.ready;
    ELK.ready = (async () => {
      const src = await (await fetch('lib/elk/elk-worker.js')).text();
      const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      w.onmessage = e => { const d = e.data || {}, p = ELK.wait.get(d.id); if (!p) return; ELK.wait.delete(d.id); if (d.error) p.rej(new Error(String((d.error && (d.error.message || d.error.toString && d.error.toString())) || d.error).replace(/^.*Exception:\s*/, ''))); else p.res(d.data); };
      w.onerror = e => { for (const p of ELK.wait.values()) p.rej(new Error('ELK worker: ' + (e.message || 'failed'))); ELK.wait.clear(); };
      const call = (cmd, extra) => new Promise((res, rej) => { const id = ++ELK.seq; ELK.wait.set(id, { res, rej }); w.postMessage(Object.assign({ id, cmd }, extra)); });
      await call('register', { algorithms: ['layered', 'mrtree', 'rectpacking', 'stress', 'force'] });
      return call;
    })();
    ELK.ready.catch(() => { ELK.ready = null; });
    return ELK.ready;
  };
  ELK.layout = async graph => {
    const k = JSON.stringify(graph); if (ELK.cache.has(k)) return JSON.parse(ELK.cache.get(k));
    const call = await ELK.worker(); const t0 = performance.now();
    const r = await Promise.race([call('layout', { graph, layoutOptions: {}, options: {} }), new Promise((_, rej) => setTimeout(() => rej(new Error('ELK 布局超时')), 20000))]);
    ELK.lastMs = Math.round(performance.now() - t0);
    const s = JSON.stringify(r); if (ELK.cache.size > 60) ELK.cache.delete(ELK.cache.keys().next().value); ELK.cache.set(k, s); return JSON.parse(s);
  };

  /* ---------------- model ---------------- */
  const BKIND = { cpu: '处理器', bus: '总线 / 互连', mem: '存储', dma: 'DMA', periph: '外设', logic: '逻辑单元', io: 'I/O / 引脚', clock: '时钟 / 复位', irq: '中断', ext: '外部器件', analog: '模拟' };
  const LKIND = { bus: '总线', data: '数据', clock: '时钟', irq: '中断', dma: 'DMA', ctrl: '控制' };
  const arr = v => v == null ? [] : Array.isArray(v) ? v : [v];
  const normalize = m => {
    m = m || {}; const groups = arr(m.groups).filter(g => g && g.id != null).map(g => Object.assign({}, g, { id: String(g.id) }));
    const blocks = arr(m.blocks || m.nodes).filter(b => b && b.id != null).map(b => Object.assign({}, b, { id: String(b.id), group: b.group != null ? String(b.group) : undefined, kind: String(b.kind || 'logic').toLowerCase() }));
    const gids = new Set(groups.map(g => g.id)), bids = new Set(blocks.map(b => b.id)), issues = [];
    /* 1.7: a link end may name a port — "pins.tx" = block pins, port tx (ports are listed in the side panel and become the label when none is given) */
    const ep = x => { x = String(x); if (bids.has(x) || gids.has(x)) return { id: x }; const k = x.lastIndexOf('.'); if (k > 0) { const b0 = x.slice(0, k); if (bids.has(b0) || gids.has(b0)) return { id: b0, port: x.slice(k + 1) }; } return { id: x }; };
    const links = []; arr(m.links || m.edges).forEach((l, i) => { if (!l) return; const F = ep(l.from), T = ep(l.to), f = F.id, t = T.id; if (!(bids.has(f) || gids.has(f)) || !(bids.has(t) || gids.has(t))) { issues.push('连线 ' + String(l.from) + ' → ' + String(l.to) + ' 引用了不存在的模块'); return; } const o = Object.assign({}, l, { from: f, to: t, kind: String(l.kind || 'data').toLowerCase(), i }); if (F.port) o.fp = F.port; if (T.port) o.tp = T.port; if (!o.label && (F.port || T.port)) o.label = [F.port, T.port].filter(Boolean).join(' → '); links.push(o); });
    blocks.forEach(b => { if (b.group && !gids.has(b.group)) { issues.push('模块 ' + b.id + ' 的 group “' + b.group + '” 不存在'); b.group = undefined; } });
    groups.forEach(g => { if (g.parent != null && !gids.has(String(g.parent))) g.parent = undefined; else if (g.parent != null) g.parent = String(g.parent); });
    if (!blocks.length) issues.push('没有 blocks');
    const R = { title: m.title || 'IP 结构', source: m.source || '', direction: /down|vert|tb/i.test(String(m.direction || '')) ? 'DOWN' : 'RIGHT', groups, blocks, links, issues }; blocks.forEach(b => Object.defineProperty(b, '__M', { value: R, enumerable: false })); return R;
  };
  /* declared ports (b.ports: [{id, dir}]) plus ports named by links, with the number of links that use each */
  const portsOf = b => { const M0 = b.__M; const out = new Map(); arr(b.ports).filter(p => p && p.id != null).forEach(p => out.set(String(p.id), { id: String(p.id), dir: String(p.dir || 'inout'), n: 0 })); if (M0) M0.links.forEach(l => { [[l.from, l.fp, 'out'], [l.to, l.tp, 'in']].forEach(([id, port, dir]) => { if (id === b.id && port) { const o = out.get(port) || (out.set(port, { id: port, dir, n: 0 }), out.get(port)); o.n++; } }); }); return Array.from(out.values()); };
  let ctx2d = null; const tw = (t, font) => { ctx2d = ctx2d || document.createElement('canvas').getContext('2d'); ctx2d.font = font; return ctx2d.measureText(String(t)).width; };
  const FONT = '600 13px "ChipBench Sans","ChipBench Han","Segoe UI","Microsoft YaHei UI",sans-serif', FONT_S = '11px "Cascadia Mono",Consolas,"Microsoft YaHei UI",monospace';
  const subOf = b => b.addr != null ? String(b.addr) : b.sub || (b.regs ? arr(b.regs).length + ' 个寄存器' : '');
  const toElk = M => {
    const node = b => { const sub = subOf(b), w = Math.max(96, Math.ceil(Math.max(tw(b.label || b.id, FONT), sub ? tw(sub, FONT_S) : 0)) + 28); return { id: 'b:' + b.id, width: w, height: sub ? 50 : 36 }; };
    const gnode = g => ({ id: 'g:' + g.id, layoutOptions: { 'elk.padding': '[top=30,left=14,bottom=14,right=14]', 'elk.nodeLabels.placement': 'INSIDE V_TOP H_LEFT' }, children: [] });
    const all = new Map(); M.groups.forEach(g => all.set(g.id, gnode(g)));
    const root = { id: 'root', layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': M.direction, 'elk.edgeRouting': 'ORTHOGONAL', 'elk.hierarchyHandling': 'INCLUDE_CHILDREN', 'elk.spacing.nodeNode': '26', 'elk.layered.spacing.nodeNodeBetweenLayers': '46', 'elk.layered.spacing.edgeNodeBetweenLayers': '18', 'elk.spacing.edgeEdge': '10', 'elk.spacing.edgeLabel': '4', 'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF', 'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP', 'elk.padding': '[top=14,left=14,bottom=14,right=14]', 'elk.edgeLabels.inline': 'false' }, children: [], edges: [] };
    M.groups.forEach(g => { (g.parent && all.has(g.parent) ? all.get(g.parent).children : root.children).push(all.get(g.id)); });
    M.blocks.forEach(b => { (b.group && all.has(b.group) ? all.get(b.group).children : root.children).push(node(b)); });
    const ref = id => (M.blocks.some(b => b.id === id) ? 'b:' : 'g:') + id;
    M.links.forEach(l => { const e = { id: 'e' + l.i, sources: [ref(l.from)], targets: [ref(l.to)] }; if (l.label) e.labels = [{ text: String(l.label), width: Math.ceil(tw(l.label, FONT_S)) + 8, height: 16 }]; root.edges.push(e); });
    return root;
  };
  // fallback when the worker can't start: simple layered grid without routing
  const fallback = (M, g) => { let x = 14; const cols = new Map(); g.children.forEach(c => { c.x = x; c.y = 14; x += (c.width || 200) + 30; let y = 30; (c.children || []).forEach(k => { k.x = 14; k.y = y; y += k.height + 16; c.width = Math.max(c.width || 0, k.width + 28); }); if (c.children && c.children.length) c.height = y; }); g.width = x; g.height = Math.max(...g.children.map(c => (c.height || 40) + 28)); g.edges.forEach(e => { e.sections = []; }); return g; };

  /* ---------------- render ---------------- */
  const KCLR = { cpu: '#2563eb', bus: '#64748b', mem: '#0d9488', dma: '#9333ea', periph: '#0284c7', logic: '#475569', io: '#ca8a04', clock: '#ea580c', irq: '#dc2626', ext: '#78716c', analog: '#16a34a' };
  const LCLR = { bus: '#64748b', data: '#2563eb', clock: '#ea580c', irq: '#dc2626', dma: '#9333ea', ctrl: '#0d9488' };
  const LDASH = { clock: '6 3', irq: '2 3', ctrl: '5 3 1 3' };
  async function ipblock(src, ctx) {
    const raw = X.yaml(src), M = normalize(raw), root = h('div', { class: 'ipb' });
    const nV = M.blocks.filter(b => b.status === 'verified').length;
    root.innerHTML = '<div class="dg-bar"><span class="t">' + esc(M.title) + '</span>' + (M.source ? '<span class="chip">' + esc(M.source) + '</span>' : '') + '<span class="chip">' + M.blocks.length + ' 个模块</span><span class="sp"></span><span class="muted" style="font-size:var(--fs-xs)">已确认 ' + nV + ' / ' + M.blocks.length + '</span><button class="btn sm ghost" data-a="dir" title="切换方向">' + (M.direction === 'RIGHT' ? '横向' : '纵向') + '</button><button class="btn sm ghost" data-a="svg">SVG</button><button class="btn sm ghost" data-a="src">编辑源码</button></div><div class="ipb-body"><div class="ipb-canvas"><div class="empty">ELK 自动布局中…</div></div><div class="dg-side ipb-side"></div></div>' + (M.issues.length ? '<div class="dg-issues">' + M.issues.map(t => '<span class="chip warn">' + esc(t) + '</span>').join('') + '</div>' : '');
    const canvas = $('.ipb-canvas', root), side = $('.ipb-side', root);
    if (!M.blocks.length) { canvas.innerHTML = '<div class="empty">在 blocks 里添加模块，例如<br><code>- {id: can0, label: RS-CANFD0, kind: periph, page: 1200}</code></div>'; return root; }
    let g; const graph = toElk(M);
    try { if (SL.widgets && SL.widgets.whenVisible) await SL.widgets.whenVisible(root); g = await ELK.layout(graph); }
    catch (e) { console.warn('[ipblock] ELK', e); g = fallback(M, JSON.parse(JSON.stringify(graph))); root.appendChild(h('div', { class: 'dg-issues' }, '<span class="chip warn">自动布局不可用，已用简单排列：' + esc(e.message || e) + '</span>')); }
    // absolute positions
    const abs = new Map(); const walk = (n, ox, oy) => { const x = ox + (n.x || 0), y = oy + (n.y || 0); abs.set(n.id, { x, y, w: n.width, h: n.height, n }); (n.children || []).forEach(c => walk(c, x, y)); };
    walk(g, 0, 0); abs.set('root', { x: 0, y: 0, w: g.width, h: g.height });
    const W = Math.ceil(g.width) + 2, H = Math.ceil(g.height) + 2;
    const svg = sv('svg', { class: 'ipb-svg', viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, 'font-family': '"ChipBench Sans","ChipBench Han","Segoe UI","Microsoft YaHei UI",sans-serif' });
    const defs = sv('defs'); svg.appendChild(defs);
    Object.keys(LCLR).forEach(k => { const mk = sv('marker', { id: 'ipb-ar-' + k, viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' }); mk.appendChild(sv('path', { d: 'M0,1 L9,5 L0,9 z', fill: LCLR[k] })); defs.appendChild(mk); });
    const gG = sv('g', { class: 'ipb-groups' }), gE = sv('g', { class: 'ipb-edges' }), gN = sv('g', { class: 'ipb-nodes' }); svg.append(gG, gE, gN);
    const depth = id => { let d = 0, gr = M.groups.find(x => x.id === id); while (gr && gr.parent) { d++; gr = M.groups.find(x => x.id === gr.parent); } return d; };
    M.groups.slice().sort((a, b) => depth(a.id) - depth(b.id)).forEach(gr => { const p = abs.get('g:' + gr.id); if (!p) return; const el = sv('g', { class: 'ipb-group', 'data-id': gr.id }); el.append(sv('rect', { x: p.x + .5, y: p.y + .5, width: p.w, height: p.h, rx: 10 }), sv('text', { x: p.x + 12, y: p.y + 19, class: 'ipb-gl' }, gr.label || gr.id)); if (gr.page != null) el.appendChild(sv('text', { x: p.x + p.w - 10, y: p.y + 19, class: 'ipb-pg', 'text-anchor': 'end', 'data-page': gr.page }, 'p.' + gr.page)); gG.appendChild(el); });
    const usedK = new Set();
    (g.edges || []).forEach(e => {
      const l = M.links[+e.id.slice(1)] || M.links.find(x => 'e' + x.i === e.id); if (!l) return; const k = LCLR[l.kind] ? l.kind : 'data'; usedK.add(k);
      const c = abs.get(e.container || 'root') || { x: 0, y: 0 }; const pts = [];
      (e.sections || []).forEach(s => { pts.push(s.startPoint); (s.bendPoints || []).forEach(b => pts.push(b)); pts.push(s.endPoint); });
      let d; if (pts.length) d = 'M' + pts.map(p => (c.x + p.x).toFixed(1) + ',' + (c.y + p.y).toFixed(1)).join(' L');
      else { const a = abs.get(e.sources[0]), b = abs.get(e.targets[0]); if (!a || !b) return; d = 'M' + (a.x + a.w) + ',' + (a.y + a.h / 2) + ' L' + b.x + ',' + (b.y + b.h / 2); }
      const el = sv('g', { class: 'ipb-edge k-' + k, 'data-from': l.from, 'data-to': l.to });
      el.appendChild(sv('path', { d, fill: 'none', stroke: LCLR[k], 'stroke-width': k === 'bus' ? 2.4 : 1.6, 'stroke-dasharray': LDASH[k] || '', 'marker-end': 'url(#ipb-ar-' + k + ')', 'marker-start': l.both || l.bidir ? 'url(#ipb-ar-' + k + ')' : '' }));
      (e.labels || []).forEach(lb => { const x = c.x + (lb.x || 0), y = c.y + (lb.y || 0); el.append(sv('rect', { x: x - 1, y: y, width: lb.width, height: lb.height, rx: 3, class: 'ipb-elb' }), sv('text', { x: x + lb.width / 2 - 1, y: y + 12, 'text-anchor': 'middle', class: 'ipb-el' }, lb.text)); });
      if (!e.labels && l.label && pts.length > 1) { const m = pts[Math.floor(pts.length / 2)]; el.appendChild(sv('text', { x: c.x + m.x + 4, y: c.y + m.y - 4, class: 'ipb-el' }, l.label)); }
      gE.appendChild(el);
    });
    M.blocks.forEach(b => {
      const p = abs.get('b:' + b.id); if (!p) return; const clr = KCLR[b.kind] || KCLR.logic, sub = subOf(b);
      const el = sv('g', { class: 'ipb-node ' + (b.status || 'unverified') + ' k-' + b.kind, 'data-id': b.id, tabindex: '0' });
      el.append(sv('rect', { x: p.x + .5, y: p.y + .5, width: p.w - 1, height: p.h - 1, rx: 7, class: 'ipb-box' }), sv('rect', { x: p.x + .5, y: p.y + .5, width: 4, height: p.h - 1, rx: 2, fill: clr, class: 'ipb-kbar' }), sv('text', { x: p.x + 14, y: p.y + (sub ? 21 : 23), class: 'ipb-nl' }, b.label || b.id));
      if (sub) el.appendChild(sv('text', { x: p.x + 14, y: p.y + 38, class: 'ipb-ns' }, sub));
      if (b.page != null) el.appendChild(sv('text', { x: p.x + p.w - 8, y: p.y + 13, class: 'ipb-pg', 'text-anchor': 'end', 'data-page': b.page }, 'p.' + b.page));
      if (b.status === 'doubt') el.appendChild(sv('circle', { cx: p.x + p.w - 6, cy: p.y + p.h - 6, r: 3.5, fill: '#dc2626' }));
      el.appendChild(sv('title', null, (b.label || b.id) + (BKIND[b.kind] ? ' · ' + BKIND[b.kind] : '') + (b.page != null ? ' · p.' + b.page : '')));
      gN.appendChild(el);
    });
    canvas.innerHTML = ''; canvas.appendChild(svg);
    if (usedK.size) canvas.appendChild(h('div', { class: 'ipb-legend' }, [...usedK].map(k => '<span><svg width="26" height="8"><line x1="0" y1="4" x2="26" y2="4" stroke="' + LCLR[k] + '" stroke-width="' + (k === 'bus' ? 2.4 : 1.6) + '" stroke-dasharray="' + (LDASH[k] || '') + '"/></svg>' + LKIND[k] + '</span>').join('')));
    root.dataset.ms = ELK.lastMs || 0;
    // interaction
    const page = pg => (SL.gotoPage ? SL.gotoPage(M.source, +pg) : null);
    const scope = id => { const out = new Set([id]); const b = M.blocks.find(x => x.id === id); let gid = b && b.group; while (gid) { out.add(gid); const gr = M.groups.find(x => x.id === gid); gid = gr && gr.parent; } return out; };
    const hi = id => { const sc = id ? scope(id) : null; svg.querySelectorAll('.ipb-edge').forEach(e => e.classList.toggle('hi', !!sc && (sc.has(e.dataset.from) || sc.has(e.dataset.to)))); svg.classList.toggle('focus', !!id); };
    svg.addEventListener('mouseover', e => { const n = e.target.closest('.ipb-node'); hi(n ? n.dataset.id : side.dataset.node || null); });
    svg.addEventListener('mouseleave', () => hi(side.dataset.node || null));
    svg.addEventListener('click', e => {
      const pg = e.target.closest('[data-page]'); if (pg) { e.stopPropagation(); return page(pg.dataset.page); }
      const n = e.target.closest('.ipb-node'); svg.querySelectorAll('.ipb-node.sel').forEach(x => x.classList.remove('sel'));
      if (!n) { side.classList.remove('show'); side.dataset.node = ''; return hi(null); }
      n.classList.add('sel'); const b = M.blocks.find(x => x.id === n.dataset.id); side.dataset.node = b.id; hi(b.id);
      const ins = M.links.filter(l => l.to === b.id || l.to === b.group), outs = M.links.filter(l => l.from === b.id || l.from === b.group), gr = M.groups.find(x => x.id === b.group);
      side.innerHTML = '<h4>' + esc(b.label || b.id) + '</h4><dl><dt>ID</dt><dd class="mono">' + esc(b.id) + '</dd><dt>类型</dt><dd>' + esc(BKIND[b.kind] || b.kind) + '</dd>' + (gr ? '<dt>所属</dt><dd>' + esc(gr.label || gr.id) + '</dd>' : '') + (b.addr != null ? '<dt>地址</dt><dd class="mono">' + esc(b.addr) + '</dd>' : '') + '<dt>输入</dt><dd>' + (ins.map(l => esc(l.from) + ' <span class="muted">' + esc(LKIND[l.kind] || l.kind) + '</span>').join('<br>') || '—') + '</dd><dt>输出</dt><dd>' + (outs.map(l => esc(l.to) + ' <span class="muted">' + esc(LKIND[l.kind] || l.kind) + '</span>').join('<br>') || '—') + '</dd>' + (portsOf(b).length ? '<dt>端口</dt><dd>' + portsOf(b).map(p => '<span class="mono">' + esc(p.id) + '</span> <span class="muted">' + esc(p.dir) + (p.n ? ' · ' + p.n + ' 条连线' : '') + '</span>').join('<br>') + '</dd>' : '') + '<dt>来源</dt><dd>' + (b.page != null ? '<a href="#" data-page="' + esc(b.page) + '">p.' + esc(b.page) + '</a>' : '<span class="chip warn">无页码</span>') + '</dd><dt>状态</dt><dd>' + ({ verified: '<span class="chip ok">已确认</span>', doubt: '<span class="chip bad">有疑问</span>' }[b.status] || '<span class="chip">待核对</span>') + '</dd></dl>' + (b.note ? '<div class="muted" style="margin-bottom:var(--sp-2)">' + esc(b.note) + '</div>' : '') + (b.regs ? '<div class="cap" style="margin:var(--sp-1-5) 0 var(--sp-1)">寄存器</div>' + arr(b.regs).map(r => '<span class="chip mono" style="margin:0 4px 4px 0">' + esc(r) + '</span>').join('') : '') + '<div class="row" style="margin-top:var(--sp-2-5)"><button class="btn sm" data-st="verified">确认</button><button class="btn sm" data-st="doubt">有疑问</button><button class="btn sm ghost" data-st="unverified">重置</button></div>';
      side.classList.add('show');
    });
    side.addEventListener('click', e => { const a = e.target.closest('[data-page]'); if (a) { e.preventDefault(); return page(a.dataset.page); } const s = e.target.closest('[data-st]'); if (s && SL.widgets && SL.widgets.rewrite) SL.widgets.rewrite(ctx, root, m => { const bb = arr(m.blocks || m.nodes).find(x => String(x.id) === side.dataset.node); if (bb) bb.status = s.dataset.st; }); });
    root.querySelector('.dg-bar').addEventListener('click', async e => {
      const b = e.target.closest('[data-a]'); if (!b) return; const a = b.dataset.a;
      if (a === 'src' && SL.widgets && SL.widgets.editSource) return SL.widgets.editSource(root, ctx);
      if (a === 'dir' && SL.widgets && SL.widgets.rewrite) return SL.widgets.rewrite(ctx, root, m => { m.direction = M.direction === 'RIGHT' ? 'down' : 'right'; });
      if (a === 'svg') { const c = svg.cloneNode(true); c.setAttribute('xmlns', SVGNS); const st = document.createElementNS(SVGNS, 'style'); st.textContent = SVG_CSS; c.insertBefore(st, c.firstChild); const name = String(M.title).replace(/[\\/:*?"<>|]/g, '_') + '.svg'; if (SL.saveOut) return SL.saveOut(name, '<?xml version="1.0" encoding="UTF-8"?>\n' + c.outerHTML); }
    });
    return root;
  }
  const SVG_CSS = '.ipb-group rect{fill:#f8fafc;stroke:#94a3b8;stroke-dasharray:5 3}.ipb-gl{font:600 12px sans-serif;fill:#475569}.ipb-box{fill:#fff;stroke:#cbd5e1}.ipb-node.verified .ipb-box{stroke:#16a34a}.ipb-node.doubt .ipb-box{stroke:#dc2626}.ipb-nl{font:600 13px sans-serif;fill:#0f172a}.ipb-ns,.ipb-el{font:11px monospace;fill:#475569}.ipb-pg{font:10.5px monospace;fill:#2563eb}.ipb-elb{fill:#fff;opacity:.9}';
  SL.ipblock = { render: ipblock, normalize, toElk };

  /* ---------------- registration ---------------- */
  const SNIP = '```ipblock\ntitle: MCU 总体结构（示例，请按手册修改）\nsource: manual.pdf\ndirection: right\ngroups:\n  - {id: core, label: CPU 子系统}\n  - {id: periph, label: 外设}\nblocks:\n  - {id: cpu, label: CPU, kind: cpu, group: core, page: 1}\n  - {id: intc, label: 中断控制器, kind: irq, group: core}\n  - {id: xbar, label: 总线矩阵, kind: bus}\n  - {id: flash, label: Code Flash, kind: mem}\n  - {id: ram, label: RAM, kind: mem}\n  - {id: dma, label: DMA, kind: dma}\n  - {id: can, label: CAN-FD, kind: periph, group: periph, regs: [CFDGCFG, CFDC0NCFG]}\n  - {id: eth, label: Ethernet, kind: periph, group: periph}\n  - {id: cpg, label: 时钟发生器, kind: clock}\nlinks:\n  - {from: cpu, to: xbar, kind: bus, label: AXI}\n  - {from: dma, to: xbar, kind: bus}\n  - {from: xbar, to: flash, kind: bus}\n  - {from: xbar, to: ram, kind: bus}\n  - {from: xbar, to: periph, kind: bus, label: APB}\n  - {from: can, to: intc, kind: irq}\n  - {from: eth, to: dma, kind: dma}\n  - {from: cpg, to: core, kind: clock}\n  - {from: cpg, to: periph, kind: clock}\n```';
  const hook = () => {
    const P = SL.widgets && SL.widgets.PARSE; if (!P) return false; P.ipblock = (s, c) => ipblock(s, c);
    if (SL.md && SL.md.WIDGETS) SL.md.WIDGETS.add('ipblock');
    const S = SL.E && SL.E.tools && SL.E.tools.SNIP; if (S) S.ipblock = SNIP;
    return true;
  };
  if (!hook()) SL.on('ready', hook); SL.on('ready', hook);
  SL.ipblock.SNIP = SNIP;
  SL.cmd('insert.ipblock', '插入 IP 结构图（ELK 自动布局）', () => SL.insertIntoNote(SNIP), { group: '插入', icon: 'board' });

  /* ---------------- importer: CMSIS-SVD → peripheral overview ---------------- */
  SL.ipblock.fromSVD = (xml, opt) => {
    opt = opt || {}; const doc = new DOMParser().parseFromString(xml, 'application/xml'); if (doc.querySelector('parsererror')) throw new Error('不是有效的 XML');
    const tx = (el, t) => { const x = el && [...el.children].find(c => c.tagName === t); return x ? x.textContent.trim() : ''; };
    const dev = tx(doc.documentElement, 'name') || 'MCU', cpu = doc.querySelector('device > cpu'), cpuName = cpu ? tx(cpu, 'name') : '';
    const pers = [...doc.querySelectorAll('peripherals > peripheral')].map(p => ({ name: tx(p, 'name'), group: tx(p, 'groupName') || '其他', base: tx(p, 'baseAddress'), derived: p.getAttribute('derivedFrom'), irqs: [...p.querySelectorAll(':scope > interrupt')].map(i => tx(i, 'name')) }));
    // derivedFrom peripherals inherit the group of their parent
    pers.forEach(p => { if (p.derived && (!p.group || p.group === '其他')) { const q = pers.find(x => x.name === p.derived); if (q) p.group = q.group; } });
    const groups = opt.groups ? new Set(opt.groups) : null, sel = pers.filter(p => !groups || groups.has(p.group));
    const gid = s => 'g_' + String(s).replace(/[^\w]/g, '_'), bid = s => String(s).replace(/[^\w]/g, '_');
    const L = ['title: ' + dev + ' 外设总览（由 SVD 生成）', 'source: ' + (opt.file || 'device.svd'), 'direction: right', 'groups:'];
    [...new Set(sel.map(p => p.group))].sort().forEach(g => L.push('  - {id: ' + gid(g) + ', label: ' + g + '}'));
    L.push('blocks:', '  - {id: cpu, label: ' + (cpuName || 'CPU') + ', kind: cpu}', '  - {id: bus, label: 外设总线, kind: bus}');
    const anyIrq = sel.some(p => p.irqs.length); if (anyIrq) L.push('  - {id: intc, label: 中断控制器, kind: irq}');
    sel.forEach(p => L.push('  - {id: ' + bid(p.name) + ', label: ' + p.name + ', kind: periph, group: ' + gid(p.group) + (p.base ? ', addr: "' + p.base + '"' : '') + '}'));
    L.push('links:', '  - {from: cpu, to: bus, kind: bus}');
    [...new Set(sel.map(p => p.group))].sort().forEach(g => L.push('  - {from: bus, to: ' + gid(g) + ', kind: bus}'));
    if (anyIrq) { L.push('  - {from: intc, to: cpu, kind: irq}'); sel.filter(p => p.irqs.length).forEach(p => L.push('  - {from: ' + bid(p.name) + ', to: intc, kind: irq' + (p.irqs.length === 1 ? ', label: ' + p.irqs[0] : '') + '}')); }
    return { yaml: L.join('\n'), groups: [...new Set(pers.map(p => p.group))].sort(), count: sel.length };
  };
  SL.cmd('ipblock.svd', '从 SVD 生成外设结构图…', async () => {
    const ps = await SL.invoke('pick_files', { filters: [{ name: 'CMSIS-SVD', extensions: ['svd', 'xml'] }] }).catch(() => []); if (!ps || !ps[0]) return;
    let xml, all; try { xml = (await SL.fs.read(ps[0])).text; all = SL.ipblock.fromSVD(xml); } catch (e) { return SL.toast('SVD 解析失败：' + (e.message || e), 4000, 'bad'); }
    const body = h('div', null, '<p class="muted">' + esc(U.base(ps[0])) + ' · ' + all.groups.length + ' 个外设分组。外设很多时，只选关心的分组，图会更清楚。</p><div class="svdg" style="max-height:300px;overflow:auto;columns:2">' + all.groups.map(g => '<label class="row" style="gap:var(--sp-1-5);padding:2px 0"><input type="checkbox" value="' + esc(g) + '" checked><span>' + esc(g) + '</span></label>').join('') + '</div>');
    if ((await SL.modal({ title: '从 SVD 生成外设结构图', body, buttons: [{ t: '取消', v: null }, { t: '插入到笔记', primary: true, v: 'ok' }] })) !== 'ok') return;
    const gs = [...body.querySelectorAll('.svdg input:checked')].map(i => i.value); if (!gs.length) return SL.toast('没有选择分组');
    const r = SL.ipblock.fromSVD(xml, { groups: gs, file: U.base(ps[0]) });
    SL.insertIntoNote('```ipblock\n' + r.yaml + '\n```'); SL.toast('已生成 ' + r.count + ' 个外设');
  }, { group: '工程' });
})(window);
