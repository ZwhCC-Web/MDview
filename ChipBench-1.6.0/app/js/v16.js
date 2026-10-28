/* ChipBench 1.6 · v16.js — immersive fullscreen (F11), soft / flat interface, reliable file opening */
(function (G) {
  'use strict';
  const SL = G.ChipBench; if (!SL || !SL.app) return;
  const U = SL.U, $ = U.$, h = U.h, A = SL.app, d = document, body = d.body;
  const applyFx = () => { d.documentElement.dataset.fx = SL.prefs.fx === 'flat' ? 'flat' : 'soft'; };
  applyFx(); SL.on('prefs', applyFx);
  const dp0 = SL.dataPrefs;
  SL.dataPrefs = async bodyEl => {
    const sec = h('div', null, '<div class="cap" style="margin:14px 0 4px">界面效果</div><label class="pref"><span>风格<small>柔和：半透明侧栏、浮起的文档区、磨砂对话框；简洁：纯色平面（老显卡或远程桌面更流畅）</small></span><select class="select" data-fx><option value="soft">柔和</option><option value="flat">简洁</option></select></label>');
    const s = sec.querySelector('[data-fx]'); s.value = SL.prefs.fx === 'flat' ? 'flat' : 'soft';
    s.addEventListener('change', e => { e.stopPropagation(); SL.prefs.fx = s.value; SL.savePrefs(); applyFx(); });
    bodyEl.appendChild(sec); return dp0 ? dp0(bodyEl) : undefined;
  };
  const edge = h('div', { class: 'imm-edge' }); body.appendChild(edge);
  const win = () => G.__TAURI__ && G.__TAURI__.window && G.__TAURI__.window.getCurrentWindow && G.__TAURI__.window.getCurrentWindow();
  let hideT = 0;
  const showBars = () => { clearTimeout(hideT); body.classList.add('bars'); };
  const hideBarsSoon = () => { clearTimeout(hideT); hideT = setTimeout(() => body.classList.remove('bars'), 450); };
  edge.addEventListener('mouseenter', showBars);
  let mmq = 0; d.addEventListener('mousemove', e => { if (!body.classList.contains('bars') || mmq) return; mmq = requestAnimationFrame(() => { mmq = 0; const last = ['fmtrow', 'crumbs', 'tabs'].map(id => $('#' + id)).find(el => el && el.offsetHeight && getComputedStyle(el).display !== 'none'); const bottom = last ? last.getBoundingClientRect().bottom : 90; if (e.clientY > bottom + 24) hideBarsSoon(); else clearTimeout(hideT); }); }, { passive: true });
  ['tabs', 'crumbs', 'fmtrow'].forEach(id => { const el = $('#' + id); if (el) el.addEventListener('mouseenter', showBars); });
  const IM = SL.immersive = {
    on: () => body.classList.contains('immersive'),
    set: async on => {
      body.classList.toggle('immersive', !!on); body.classList.remove('bars');
      try { const w = win(); if (w) await w.setFullscreen(!!on); else if (on && d.documentElement.requestFullscreen && !d.fullscreenElement) await d.documentElement.requestFullscreen().catch(() => { }); else if (!on && d.fullscreenElement) await d.exitFullscreen().catch(() => { }); } catch (e) { }
      if (on) { const tip = h('div', { class: 'imm-tip' }, '全屏阅读 · 鼠标移到顶部显示工具栏 · Esc 退出'); body.appendChild(tip); setTimeout(() => tip.remove(), 2800); }
      if (A.ed && A.ed.view) A.ed.view.requestMeasure();
    },
    toggle: () => IM.set(!IM.on())
  };
  SL.cmd('fullscreen', '全屏（隐藏侧栏与工具栏）', () => IM.toggle(), { key: 'F11', group: '视图' });
  d.addEventListener('keydown', e => { if (e.key === 'Escape' && IM.on() && !d.querySelector('.modal-bg, .menu-pop, .fp, .ac')) { e.preventDefault(); IM.set(false); } }, true);
  d.addEventListener('fullscreenchange', () => { if (!d.fullscreenElement && IM.on() && !win()) body.classList.remove('immersive', 'bars'); });
  const open0 = SL.openPath;
  SL.openPath = async (path, opt) => { if (!path) return null; try { return await open0(path, opt); } catch (e) { console.error('[open]', path, e); SL.toast('打不开 ' + U.base(path) + '：' + String((e && e.message) || e).slice(0, 120), 4500, 'bad'); return null; } };
  const wsPane = $('#pane-workspace');
  if (wsPane) wsPane.addEventListener('click', async e => {
    const r = e.target.closest('.ws-row[data-t="file"]'); if (!r || !SL.ws || SL.ws.view !== 'recent' || !SL.native) return;
    const p = r.dataset.path; if ((await SL.fs.kind(p)) !== 'none') return;
    if (await SL.confirm('“' + U.base(p) + '” 已被移动或删除。从“最近”列表中移除？', '移除')) { const w = SL.ws.cur; if (w && Array.isArray(w.recent)) { w.recent = w.recent.filter(x => U.pkey(x.path || x) !== U.pkey(p)); await SL.ws.persist(); SL.ws.draw(); } }
  }, true);
})(window);
