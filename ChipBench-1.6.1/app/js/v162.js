/* ChipBench · v162.js — 1.6.1 (build 2)
   1. Document width: "固定版心 / 铺满窗口" and table width "自适应 / 撑满版心 / 撑满窗口（用上两侧空白）" — CSS lives at the end of chipbench.css,
      this file measures the pane (--paneW), adds the status-bar switch and the command.
   2. The project tree follows the disk: folders / files created by other programs (MCP, build tools) appear without pressing refresh. */
(function (G) {
  'use strict';
  const SL = G.ChipBench; if (!SL || !SL.app) return;
  const U = SL.U, $ = U.$, h = U.h, A = SL.app, d = document;

  /* ---------------- 1. pane width for "撑满窗口" tables ---------------- */
  const panes = ['#ed-pane', '#pv-pane'].map(s => $(s)).filter(Boolean);
  const setW = el => { const w = el.clientWidth; if (w > 0 && el.__pw !== w) { el.__pw = w; el.style.setProperty('--paneW', w + 'px'); } };
  if (G.ResizeObserver) { const ro = new ResizeObserver(es => es.forEach(e => setW(e.target))); panes.forEach(p => { setW(p); ro.observe(p); }); }
  else { const f = () => panes.forEach(setW); G.addEventListener('resize', f); f(); }
  // panes are display:none while hidden → measure again when the mode / tab changes
  SL.on('tab', () => requestAnimationFrame(() => panes.forEach(setW)));

  /* ---------------- status-bar switch + command ---------------- */
  const FIT = { auto: '自适应内容', column: '撑满版心', window: '撑满窗口' };
  const st = h('span', { id: 'st-width', class: 'clk', title: '文档宽度与表格宽度' });
  const anchor = $('#st-mode'); if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(st, anchor.nextSibling);
  const paint = () => {
    const t = A.current && A.current(), on = !!(t && t.kind === 'md'), p = SL.prefs;
    st.classList.toggle('on', on); st.textContent = '版心 · ' + (p.docWidth === 'fill' ? '铺满' : '固定') + (p.tableFit === 'column' ? ' · 表格同版心' : p.tableFit === 'window' ? ' · 表格全宽' : '');
  };
  const setPref = (k, v) => { SL.prefs[k] = v; SL.savePrefs(); SL.applyPrefs(); paint(); requestAnimationFrame(() => { panes.forEach(setW); if (A.ed && A.ed.view) A.ed.view.requestMeasure(); }); };
  const menu = (anchorEl, at) => {
    const p = SL.prefs;
    SL.menu(anchorEl, [{ head: '文档宽度' }, { k: 'w:fixed', t: '固定版心（按“版心宽度”居中）', checked: p.docWidth !== 'fill' }, { k: 'w:fill', t: '铺满窗口（两侧不留空白）', checked: p.docWidth === 'fill' },
      { head: '表格宽度' }, { k: 't:auto', t: '自适应内容', checked: !FIT[p.tableFit] || p.tableFit === 'auto' }, { k: 't:column', t: '撑满版心（与正文等宽）', checked: p.tableFit === 'column' }, { k: 't:window', t: '撑满窗口（用上两侧空白）', checked: p.tableFit === 'window' }],
      k => { const [a, b] = k.split(':'); if (a === 'w') setPref('docWidth', b); else if (a === 't') setPref('tableFit', b); }, at);
  };
  st.addEventListener('click', () => { const r = st.getBoundingClientRect(); menu(null, { left: r.left, top: r.top - 230 }); });
  SL.cmd('view.docwidth', '文档宽度：固定版心 ⇄ 铺满窗口', () => setPref('docWidth', SL.prefs.docWidth === 'fill' ? 'fixed' : 'fill'), { group: '视图' });
  SL.cmd('view.docwidth.menu', '文档宽度与表格宽度…', () => { const r = st.getBoundingClientRect(); menu(null, r.width ? { left: r.left, top: r.top - 230 } : { left: 120, top: 120 }); }, { group: '视图' });
  SL.cmd('view.tablefit', '表格宽度：自适应 → 撑满版心 → 撑满窗口', () => { const o = ['auto', 'column', 'window'], i = Math.max(0, o.indexOf(SL.prefs.tableFit)); const n = o[(i + 1) % 3]; setPref('tableFit', n); SL.toast('表格宽度：' + FIT[n]); }, { group: '视图' });
  SL.on('tab', paint); SL.on('prefs', paint); paint();

  /* ---------------- 2. project tree follows the disk ---------------- */
  let T = 0;
  SL.on('fs-changed', ps => {
    const WS = SL.ws; if (!WS || !WS.cur || !ps || !ps.length) return;
    let hit = false;
    if (ps.length > 3000) { WS.dirCache.clear(); hit = true; }
    else for (const p of ps) { for (const k of [U.pkey(U.dir(p)), U.pkey(p)]) if (WS.dirCache.has(k)) { WS.dirCache.delete(k); hit = true; } }
    if (!hit) return;
    clearTimeout(T); T = setTimeout(() => { const pane = $('#pane-workspace'); if (pane && pane.classList.contains('on') && WS.draw) WS.draw(); }, 500);
  });
})(window);
