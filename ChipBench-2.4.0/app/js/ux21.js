/* ChipBench 2.1 · ux21.js — interaction polish: motion runtime, accessible tab lists, project-tree keyboard, shortcut sheet.
   Motion rules (see the 2.1 block at the end of chipbench.css):
     · only transform / opacity are animated (compositor-friendly); no width / height / top / left animation on large surfaces
     · three levels — full (springs, entrances), calm (opacity only), off — chosen by the preference "动画", or by the OS "reduce motion" (→ calm)
     · a frame-time governor steps full → calm by itself if animations make the UI drop below ~30 fps
     · re-rendered lists never replay entrances: only things that really are new animate */
(function (G) {
  'use strict';
  const SL = G.ChipBench; if (!SL || !SL.app) return;
  const U = SL.U, $ = U.$, $$ = U.$$, esc = U.esc, h = U.h, MO = G.ChipBenchMO, R = document.documentElement;
  const X = SL.ux = {};
  const M = SL.motion = { level: 'full', degraded: false, watching: false };

  /* ---------------------------------------------------------------- motion level */
  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  M.apply = () => { const pref = (SL.prefs && SL.prefs.motion) || 'auto'; let lv = MO.resolve(pref, mq.matches); if (M.degraded && lv === 'full') lv = 'calm'; M.level = lv; R.dataset.motion = lv; return lv; };
  mq.addEventListener('change', () => { M.apply(); });
  let lastLook = (SL.prefs && SL.prefs.theme) + '|' + (SL.prefs && SL.prefs.accent), fadeT = 0;
  SL.on('prefs', () => {
    M.apply(); const look = SL.prefs.theme + '|' + SL.prefs.accent;                                  // theme / accent switch: colours cross-fade (chrome only, 260 ms)
    if (look !== lastLook && M.level !== 'off') { lastLook = look; R.classList.add('look-fade'); clearTimeout(fadeT); fadeT = setTimeout(() => R.classList.remove('look-fade'), 300); } else lastLook = look;
  });
  M.apply();

  /* leave animation: add .leaving, remove when it ends (or after ms) — used by menus, modals, toasts */
  M.leave = (el, ms) => {
    if (!el || !el.isConnected) return; if (M.level === 'off') { el.remove(); return; }
    el.classList.add('leaving'); let done = false; const fin = () => { if (done) return; done = true; el.remove(); };
    el.addEventListener('animationend', e => { if (e.target === el) fin(); }); setTimeout(fin, ms || (M.level === 'calm' ? 140 : 220));
  };
  /* replay a one-shot animation class on an element that is re-used (not re-created) */
  M.replay = (el, cls) => { if (!el || M.level === 'off') return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };

  /* frame governor — samples rAF for a short window after a transition starts */
  const gov = new MO.Governor({ window: 20, slow: 34, strikes: 2 });
  M.watch = (ms) => {
    if (M.watching || M.level !== 'full' || navigator.webdriver) return; M.watching = true; const end = performance.now() + (ms || 700); let last = 0;
    const tick = t => { if (last) { if (gov.add(t - last)) { M.degraded = true; M.apply(); SL.toast('界面动画已自动调为“柔和”，以保持流畅（偏好设置 → 动画 可改回）', 4200); M.watching = false; return; } } last = t; if (t < end && M.level === 'full') requestAnimationFrame(tick); else { M.watching = false; gov.reset(); } };
    requestAnimationFrame(tick);
  };
  SL.on('tab', () => M.watch()); SL.on('panel', () => M.watch());

  /* ---------------------------------------------------------------- generic accessible tab list */
  /* box: the container; sel: tab selector.  Keeps role / aria-selected / roving tabindex in step with the `.on` class (also when the list is re-rendered),
     and adds ← → Home End.  Arrow keys activate the tab (click) and keep the focus on it, even if the list is rebuilt by the click. */
  X.tablist = (box, sel) => {
    if (!box || box.__tl) return; box.__tl = 1; box.setAttribute('role', 'tablist'); const tabs = () => Array.from(box.querySelectorAll(sel));
    const sync = () => { const L = tabs(); const on = L.find(t => t.classList.contains('on')) || L.find(t => t.getAttribute('aria-selected') === 'true') || L[0]; L.forEach(t => { t.setAttribute('role', 'tab'); const s = t === on; if (t.getAttribute('aria-selected') !== String(s)) t.setAttribute('aria-selected', String(s)); const ti = s ? 0 : -1; if (t.tabIndex !== ti) t.tabIndex = ti; }); };
    sync(); new MutationObserver(sync).observe(box, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    box.addEventListener('keydown', e => { const L = tabs(), i = L.indexOf(e.target.closest(sel)); if (i < 0) return; const j = MO.roving(L.length, i, e.key); if (j == null) return; e.preventDefault(); const key = L[j].dataset.t || L[j].dataset.tab || j; L[j].click(); requestAnimationFrame(() => { const N = tabs(); const n = N.find(x => (x.dataset.t || x.dataset.tab || '') === String(key)) || N[j]; if (n) n.focus({ preventScroll: true }); }); });
  };
  /* tab lists that exist when this module loads, and the ones created later by IP 图谱 / IP Studio */
  const adopt = n => { if (!n || n.nodeType !== 1) return; const lists = [['.at-tabs', 'button'], ['.ipm-tabs', '.ipm-tab']]; lists.forEach(([c, s]) => { if (n.matches && n.matches(c)) X.tablist(n, s); if (n.querySelectorAll) n.querySelectorAll(c).forEach(b => X.tablist(b, s)); }); };
  new MutationObserver(ms => { for (const m of ms) m.addedNodes.forEach(adopt); }).observe(document.body, { childList: true, subtree: true }); adopt(document.body);

  /* ---------------------------------------------------------------- project tree: keyboard (WAI-ARIA tree pattern) */
  const body = () => $('#ws-body'), rowsOf = () => $$('#ws-body .ws-row');
  const depthOf = r => { let d = 0, e = r.parentElement; while (e && e.id !== 'ws-body') { if (e.classList.contains('tb')) d++; e = e.parentElement; } return d; };
  const kidsOf = r => { const c = r.querySelector('.chev'); return !!(c && c.textContent.trim()); };
  const keyOf = r => r && (r.dataset.id || r.dataset.path || ''); let lastKey = '';
  const setFocusRow = r => { $$('#ws-body .row-i.focus').forEach(x => x.classList.remove('focus')); if (!r) return; r.classList.add('focus'); lastKey = keyOf(r); r.scrollIntoView({ block: 'nearest' }); const b = body(); if (b) b.setAttribute('aria-activedescendant', r.id || (r.id = 'wsr-' + Math.random().toString(36).slice(2, 8))); };
  function treeKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return; if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName || '')) return;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', ' '].includes(e.key)) return; const rows = rowsOf(); if (!rows.length) return;
    const cur = rows.findIndex(r => r.classList.contains('focus')); const model = rows.map(r => ({ lv: depthOf(r), open: !!r.querySelector('.chev.open'), kids: kidsOf(r) }));
    if (e.key === ' ') { if (cur >= 0) { e.preventDefault(); rows[cur].click(); } return; }
    const a = MO.treeNav(model, cur, e.key); if (!a) { e.preventDefault(); return; } e.preventDefault();
    if (a.act === 'focus') setFocusRow(rows[a.idx]); else { setFocusRow(rows[a.idx]); rows[a.idx].click(); }                  // open / close = the same toggle a click does
  }
  const setupTree = () => {
    const b = body(), pane = $('#pane-workspace'); if (!b || !pane || b.__tree) return; b.__tree = 1; b.tabIndex = 0; b.setAttribute('role', 'tree'); b.setAttribute('aria-label', '项目文件树');
    pane.addEventListener('keydown', e => { if (e.target === b || b.contains(e.target)) treeKey(e); });
    b.addEventListener('click', e => { const r = e.target.closest('.ws-row'); if (r) lastKey = keyOf(r); }, true);
    /* the tree is re-rendered on every change: keep the keyboard focus row, and let a just-toggled folder animate open */
    let toggled = null, toggledAt = 0; b.addEventListener('click', e => { const r = e.target.closest('.ws-row'); if (r && kidsOf(r)) { toggled = keyOf(r); toggledAt = performance.now(); } }, true);
    new MutationObserver(() => {
      if (lastKey && !b.querySelector('.row-i.focus')) { const r = rowsOf().find(x => keyOf(x) === lastKey); if (r) r.classList.add('focus'); }
      rowsOf().forEach(r => { r.setAttribute('role', 'treeitem'); r.setAttribute('aria-level', String(depthOf(r) + 1)); if (kidsOf(r)) r.setAttribute('aria-expanded', r.querySelector('.chev.open') ? 'true' : 'false'); });
      if (toggled && performance.now() - toggledAt < 1500) { const r = rowsOf().find(x => keyOf(x) === toggled); const tb = r && r.parentElement && r.parentElement.classList.contains('tp') ? r.parentElement.querySelector(':scope > .tb') : null; if (tb && r.querySelector('.chev.open')) { M.replay(tb, 'tb-enter'); toggled = null; } } else toggled = null;
    }).observe(b, { childList: true });
  };
  setupTree(); SL.on('ws-refs', setupTree); document.addEventListener('DOMContentLoaded', setupTree); setTimeout(setupTree, 500);

  /* ---------------------------------------------------------------- shortcut sheet (searchable) */
  const prettyKey = k => String(k).replace(/\bCtrl\b/g, 'Ctrl').replace(/\+/g, ' + ');
  X.shortcuts = () => {
    const list = Array.from(SL.commands.values()).filter(c => c.key);
    const groups = {}; list.forEach(c => { if (!c.key) return; (groups[c.group || '其他'] = groups[c.group || '其他'] || []).push(c); });
    const render = q => { const ql = q.trim().toLowerCase(); let n = 0; const html = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'zh-CN')).map(g => { const rows = groups[g].filter(c => !ql || (c.title + ' ' + c.key + ' ' + g).toLowerCase().includes(ql)).sort((a, b) => a.title.localeCompare(b.title, 'zh-CN')); n += rows.length; return rows.length ? '<div class="ks-g"><div class="ks-gh">' + esc(g) + '</div>' + rows.map(c => '<div class="ks-r"><span>' + esc(c.title) + '</span><kbd>' + esc(prettyKey(c.key)) + '</kbd></div>').join('') + '</div>' : ''; }).join(''); return html || '<div class="empty">没有匹配的快捷键</div>'; };
    const box = h('div', { class: 'ks' }, '<input class="input" type="search" placeholder="搜索命令或按键，例如 保存 / Ctrl+S" aria-label="搜索快捷键"><div class="ks-list" tabindex="0">' + render('') + '</div>');
    const inp = $('input', box), lst = $('.ks-list', box); inp.addEventListener('input', () => { lst.innerHTML = render(inp.value); });
    return SL.modal({ title: '键盘快捷键', wide: true, body: box, buttons: [{ t: '关闭', v: null }] });
  };
  { const c = SL.commands.get('help'); if (c) { c.fn = () => X.shortcuts(); c.title = '快捷键（可搜索）'; } }   /* F1 keeps its key; the static list becomes a searchable sheet */

  window.__ux21 = true;
})(window);
