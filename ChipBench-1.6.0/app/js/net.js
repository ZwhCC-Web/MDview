/* ChipBench · net.js — in-vehicle Ethernet workbench (UI)
   · .pcap / .pcapng viewer: summary, issues, protocol mix, gPTP / DoIP / SOME/IP-SD, filterable packet list, Markdown report
   · code-block widgets: ```gcl (TAS gate control list timeline + checks) and ```wavedrom (signal timing, built-in subset renderer)
   · tools: CBS credit calculator, GCL / WaveDrom templates
   Pure logic lives in net-logic.js (unit-tested in Node). */
(function (G) {
  'use strict';
  const SL = G.ChipBench, N = G.ChipBenchNET; if (!SL || !N) { console.warn('[net] not loaded'); return; }
  const U = SL.U, $ = U.$, esc = U.esc, h = U.h, fs = SL.fs, X = SL.X;
  const NS = 'http://www.w3.org/2000/svg';
  const us = n => (n / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 }) + ' µs';
  const NET = SL.net = { N };

  /* ---------- PCAP viewer ---------- */
  NET.pcapView = async (t, root) => {
    root.innerHTML = '<div class="empty">正在解析抓包…</div>';
    let a; try { const bytes = await fs.readBytes(t.path); a = N.analyze(N.readCapture(bytes, { max: 200000 })); }
    catch (e) { root.innerHTML = '<div class="empty">无法解析：' + esc(e.message || e) + '</div>'; return; }
    t.netAnalysis = a;
    const chips = Object.entries(a.protos).sort((x, y) => y[1] - x[1]).map(([k, v]) => '<button class="chip" data-f="' + esc(k) + '">' + esc(k) + ' · ' + v + '</button>').join('');
    const kv = (rows) => '<table class="tbl"><tbody>' + rows.map(([k, v]) => '<tr><td>' + esc(k) + '</td><td class="mono">' + esc(v) + '</td></tr>').join('') + '</tbody></table>';
    const g = a.gptp ? '<div class="net-card"><h4>gPTP（802.1AS）</h4>' + kv([['Sync', a.gptp.sync], ['Follow_Up', a.gptp.followUp], ['Pdelay_Req / Resp', a.gptp.pdelayReq + ' / ' + a.gptp.pdelayResp], ['Announce', a.gptp.announce], ['Sync 平均间隔', a.gptp.syncIntervalMs + ' ms'], ['Sync 最大间隔', a.gptp.syncIntervalMaxMs + ' ms']]) + '</div>' : '';
    const d = a.doip ? '<div class="net-card"><h4>DoIP（ISO 13400）</h4>' + kv(Object.entries(a.doip)) + '</div>' : '';
    const s = a.someipServices.length ? '<div class="net-card"><h4>SOME/IP-SD 服务</h4><table class="tbl"><tr><th>服务/实例</th><th>Offer</th><th>Find</th><th>Sub</th><th>Ack</th><th>Stop</th></tr>' + a.someipServices.map(x => `<tr><td class="mono">${x.k}</td><td>${x.offer}</td><td>${x.find}</td><td>${x.sub}</td><td>${x.ack}</td><td>${x.stop}</td></tr>`).join('') + '</table></div>' : '';
    const vl = Object.keys(a.vlans).length ? '<div class="net-card"><h4>VLAN / 优先级</h4>' + kv(Object.entries(a.vlans).map(([k, v]) => ['VLAN ' + k, v])) + '</div>' : '';
    const iss = '<div class="net-card"><h4>发现的问题</h4>' + (a.issues.length ? a.issues.map(i => '<div class="net-iss" ' + (i.i ? 'data-go="' + i.i + '"' : '') + '><span class="chip bad">!</span> ' + (i.i ? '#' + i.i + ' ' : '') + esc(i.msg) + '</div>').join('') : '<span class="chip ok">未发现明显异常</span>') + '</div>';
    root.innerHTML = '<div class="view-tools"><b>' + esc(t.name) + '</b><span class="chip">' + esc(a.format) + '</span><span class="chip">' + a.count + ' 帧</span><span class="chip">' + a.duration.toFixed(3) + ' s</span>' + (a.truncated ? '<span class="chip warn">已截断</span>' : '') + '<span class="sp"></span><input class="input" id="net-q" placeholder="过滤：协议 / IP / 端口 / 文本，如 DoIP、13400、NRC" style="width:300px"><button class="btn sm" data-a="report">生成分析笔记</button></div>' +
      '<div class="net-wrap"><div class="net-cards">' + iss + g + d + s + vl + '</div><div class="net-chips">' + chips + '</div><div class="net-list"><table class="tbl net-tbl"><thead><tr><th>#</th><th>时间 (s)</th><th>源</th><th>目的</th><th>协议</th><th>长度</th><th>信息</th></tr></thead><tbody></tbody></table><div class="muted net-more"></div></div></div>';
    const tb = $('.net-tbl tbody', root), more = $('.net-more', root), LIMIT = 3000; let filt = '';
    const row = p => '<tr' + (p.warn ? ' class="net-warn"' : '') + ' data-i="' + p.i + '"><td>' + p.i + '</td><td class="mono">' + p.rt.toFixed(6) + '</td><td class="mono">' + esc(p.sip ? p.sip + (p.sp != null ? ':' + p.sp : '') : p.src || '') + '</td><td class="mono">' + esc(p.dip ? p.dip + (p.dp != null ? ':' + p.dp : '') : p.dst || '') + '</td><td>' + esc(p.proto) + (p.vlan.length ? ' <small class="muted">v' + p.vlan[0].id + '</small>' : '') + '</td><td>' + p.len + '</td><td>' + esc(p.info) + (p.warn ? ' <span class="chip bad">' + esc(p.warn) + '</span>' : '') + '</td></tr>';
    const draw = () => { const q = filt.toLowerCase(); const list = q ? a.packets.filter(p => (p.proto + ' ' + (p.sip || '') + ' ' + (p.dip || '') + ' ' + (p.sp || '') + ' ' + (p.dp || '') + ' ' + p.info + ' ' + (p.warn || '')).toLowerCase().includes(q)) : a.packets; tb.innerHTML = list.slice(0, LIMIT).map(row).join(''); more.textContent = list.length > LIMIT ? '仅显示前 ' + LIMIT + ' 条（共 ' + list.length + ' 条），请用过滤缩小范围' : list.length + ' 条'; };
    draw();
    $('#net-q', root).addEventListener('input', U.debounce(e => { filt = e.target.value.trim(); draw(); }, 150));
    root.addEventListener('click', e => {
      const c = e.target.closest('[data-f]'); if (c) { $('#net-q', root).value = filt = c.dataset.f; draw(); return; }
      const go = e.target.closest('[data-go]'); if (go) { $('#net-q', root).value = filt = ''; draw(); const r = tb.querySelector('tr[data-i="' + go.dataset.go + '"]'); if (r) { r.scrollIntoView({ block: 'center' }); r.classList.add('net-hl'); } return; }
      const b = e.target.closest('[data-a="report"]'); if (b) SL.newDoc(N.reportMarkdown(a, t.name) + '\n> 来源：' + t.path + '\n', U.base(t.path).replace(/\.\w+$/, '') + ' 抓包分析.md');
    });
  };

  /* ---------- widgets ---------- */
  const sv = (tag, at, txt) => { const e = document.createElementNS(NS, tag); for (const k in at || {}) e.setAttribute(k, at[k]); if (txt != null) e.textContent = txt; return e; };
  function gclWidget(m) {
    const g = N.gclModel(m), root = h('div', { class: 'gcl' }), W = 760, L = 56, rowH = 22, H = 8 * rowH + 34, sx = v => L + v / g.cycle * (W - L - 10);
    root.innerHTML = '<div class="row" style="padding:6px 0;gap:8px;flex-wrap:wrap"><b>' + esc(m.title || 'TAS 门控列表') + '</b><span class="chip">周期 ' + us(g.cycle) + '</span><span class="chip">链路 ' + (g.link / 1e6) + ' Mbps</span><span class="chip">最大帧 ' + g.maxFrame + ' B = ' + us(g.guardNs) + '</span>' + (m.source ? '<span class="chip">' + esc(m.source) + (m.page ? ' p.' + esc(m.page) : '') + '</span>' : '') + '</div>';
    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'gcl-svg', width: '100%' });
    let tt = 0; g.entries.forEach(e => { svg.appendChild(sv('line', { x1: sx(tt), x2: sx(tt), y1: 4, y2: 8 * rowH + 6, class: 'gcl-grid' })); if (e.dur / g.cycle >= 0.1) svg.appendChild(sv('text', { x: sx(tt) + 2, y: 8 * rowH + 20, class: 'gcl-tick' }, '#' + e.i + ' ' + us(e.dur))); else svg.appendChild(sv('text', { x: sx(tt + e.dur), y: 8 * rowH + 20, class: 'gcl-tick', 'text-anchor': 'end' }, '#' + e.i)); tt += e.dur; });
    g.queues.forEach((q, r) => { const y = 6 + r * rowH; svg.appendChild(sv('text', { x: 4, y: y + 15, class: 'gcl-lbl' }, 'Q' + q.q + (q.kind ? ' ' + q.kind : ''))); svg.appendChild(sv('rect', { x: L, y: y + 3, width: W - L - 10, height: rowH - 6, class: 'gcl-bg' })); q.segs.forEach(([a0, b0]) => { const r0 = sv('rect', { x: sx(a0), y: y + 3, width: Math.max(1, sx(b0) - sx(a0)), height: rowH - 6, class: 'gcl-on ' + (q.kind === 'E' ? 'e' : q.kind === 'P' ? 'p' : '') }); r0.appendChild(sv('title', {}, 'Q' + q.q + ' 开 ' + us(a0) + ' → ' + us(b0))); svg.appendChild(r0); }); });
    root.appendChild(svg);
    root.appendChild(h('table', { class: 'tbl gcl-tbl' }, '<tr><th>队列</th><th>类型</th><th>开门占比</th><th>每周期开门</th><th>最长等待</th><th>每周期最多整帧</th></tr>' + g.queues.map(q => '<tr><td>Q' + q.q + '</td><td>' + (q.kind === 'E' ? 'Express' : q.kind === 'P' ? 'Preemptable' : '—') + '</td><td>' + q.pct.toFixed(1) + '%</td><td>' + us(q.open) + '</td><td>' + us(q.worstGapNs) + '</td><td>' + q.maxFramesPerCycle + '</td></tr>').join('')));
    root.appendChild(h('div', { class: 'dg-issues' }, g.issues.length ? g.issues.map(i => '<span class="chip ' + (i.level === 'bad' ? 'bad' : 'warn') + '">' + esc(i.msg) + '</span>').join('') : '<span class="chip ok">检查通过：周期、队列映射、保护带</span>'));
    return root;
  }
  function waveWidget(m) {
    const w = N.wave(m), root = h('div', { class: 'wave' }), cw = 28 * w.hscale, L = 90, rh = 30, W = L + w.n * cw + 10, H = w.lanes.length * rh + 10, svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'wave-svg', width: Math.min(W, 900) });
    w.lanes.forEach((ln, r) => {
      const y0 = 5 + r * rh, hi = y0 + 4, lo = y0 + rh - 8, mid = (hi + lo) / 2; svg.appendChild(sv('text', { x: 4, y: mid + 4, class: 'wave-name' }, ln.name)); let prev = null, path = '';
      ln.cells.forEach((c, i) => {
        const x = L + i * cw, v = c.v, lvl = v === '1' || v === 'h' || v === 'H' ? hi : v === '0' || v === 'l' || v === 'L' ? lo : null;
        if (v === 'p' || v === 'P' || v === 'n' || v === 'N') { const up = v === 'p' || v === 'P'; path += `M${x},${up ? lo : hi}L${x},${up ? hi : lo}L${x + cw / 2},${up ? hi : lo}L${x + cw / 2},${up ? lo : hi}L${x + cw},${up ? lo : hi}`; }
        else if (lvl != null) { const pl = prev && prev.lvl != null ? prev.lvl : lvl; path += `M${x},${pl}L${x},${lvl}L${x + cw},${lvl}`; }
        else if (v === 'z') path += `M${x},${mid}L${x + cw},${mid}`;
        else { const cls = v === 'x' ? 'wave-x' : 'wave-d d' + (/[2-9]/.test(v) ? v : '2'); const box = sv('path', { d: `M${x + 3},${hi}L${x + cw},${hi}L${x + cw},${lo}L${x + 3},${lo}L${x},${mid}Z`, class: cls }); if (c.cont) box.setAttribute('d', `M${x},${hi}L${x + cw},${hi}L${x + cw},${lo}L${x},${lo}Z`); svg.appendChild(box); if (c.label) svg.appendChild(sv('text', { x: x + 6, y: mid + 4, class: 'wave-lbl' }, c.label)); }
        if (c.gap) svg.appendChild(sv('text', { x: x + cw / 2 - 3, y: mid + 4, class: 'wave-gap' }, '≈'));
        prev = { lvl };
      });
      if (path) svg.appendChild(sv('path', { d: path, class: 'wave-line' }));
    });
    root.appendChild(svg); return root;
  }
  const hook = () => { const P = SL.widgets && SL.widgets.PARSE; if (!P) return false; P.gcl = s => gclWidget(X.yaml(s)); P.wavedrom = s => { let m; try { m = JSON.parse(s); } catch (e) { m = X.yaml(s); } return waveWidget(m); }; return true; };
  if (!hook()) SL.on && SL.on('ready', hook);

  /* ---------- snippets & tools ---------- */
  const SNIP = {
    gcl: '```gcl\ntitle: TAS 门控列表（U2B ETN）\nsource: UM Section 28\nlink: 1Gbps\ncycle: 500us\nmaxFrame: 1522\nexpress: [7, 6]\npreemptable: [3, 2, 1, 0]\nentries:\n  - {dur: 100us, gates: "11000000", note: 控制流}\n  - {dur: 390us, gates: "00111111", note: 尽力而为}\n  - {dur: 10us, gates: "00000000", note: 保护带}\n```',
    wavedrom: '```wavedrom\n{"signal": [\n  {"name": "SCK",  "wave": "p.......", "hscale": 1},\n  {"name": "CS",   "wave": "10.....1"},\n  {"name": "MOSI", "wave": "x3.4.5.x", "data": "CMD ADDR DATA"}\n]}\n```'
  };
  const addSnips = () => { const S = SL.E && SL.E.tools && SL.E.tools.SNIP; if (S) Object.assign(S, SNIP); };
  addSnips(); SL.on && SL.on('ready', addSnips);
  NET.SNIP = SNIP;
  const cbsDlg = () => {
    const body = h('div', null, '<div class="row" style="flex-wrap:wrap;gap:12px"><label>链路速率 <input class="input mono" id="cb-l" value="100Mbps" style="width:110px"></label><label>预留带宽 % <input class="input mono" id="cb-b" value="75" style="width:70px"></label><label>本类最大帧 B <input class="input mono" id="cb-f" value="1522" style="width:80px"></label><label>干扰最大帧 B <input class="input mono" id="cb-i" value="1522" style="width:80px"></label></div><div id="cb-o" style="margin-top:12px"></div><p class="muted" style="margin-top:8px">公式：sendSlope = idleSlope − portRate；hiCredit = maxInterferenceSize × idleSlope / portRate；loCredit = maxFrameSize × sendSlope / portRate（IEEE 802.1Q，帧长按 bit 计）。</p>');
    const upd = () => { const r = N.cbs({ link: $('#cb-l', body).value, bandwidthPct: $('#cb-b', body).value, maxFrame: $('#cb-f', body).value, maxInterferenceFrame: $('#cb-i', body).value }); $('#cb-o', body).innerHTML = isNaN(r.idleSlopeBps) ? '<span class="chip bad">链路速率格式不对，例：100Mbps / 1Gbps</span>' : '<table class="tbl"><tr><td>idleSlope</td><td class="mono">' + r.idleSlopeKbps + ' kbit/s</td></tr><tr><td>sendSlope</td><td class="mono">' + r.sendSlopeKbps + ' kbit/s</td></tr><tr><td>hiCredit</td><td class="mono">' + r.hiCreditBits + ' bit</td></tr><tr><td>loCredit</td><td class="mono">' + r.loCreditBits + ' bit</td></tr></table>'; };
    body.addEventListener('input', upd); upd(); SL.modal({ title: 'CBS 信用整形参数（802.1Qav）', body });
  };
  SL.cmd('net.cbs', 'CBS 信用整形计算器', cbsDlg, { group: '以太网', icon: 'tool' });
  SL.cmd('net.gcl', '插入 TAS 门控列表', () => SL.insertIntoNote(SNIP.gcl), { group: '以太网', icon: 'clock' });
  SL.cmd('net.wave', '插入时序图（WaveDrom）', () => SL.insertIntoNote(SNIP.wavedrom), { group: '以太网', icon: 'clock' });
  SL.cmd('net.pcap', '打开抓包文件（.pcap / .pcapng）…', async () => { const ps = await SL.invoke('pick_any', {}).catch(() => []); if (ps && ps[0]) SL.openPath(ps[0]); }, { group: '以太网', icon: 'file' });
  document.addEventListener('click', e => { const b = e.target.closest('#pane-tools [data-k]'); if (!b) return; const k = b.dataset.k; if (k === 'cbs') cbsDlg(); else if (k === 'pcap') SL.run('net.pcap'); else if (k === 'skills') SL.run('skills.open'); });
})(window);
