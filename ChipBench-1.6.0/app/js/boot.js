/* ChipBench · boot.js — start-up: preferences, rail, workspace, session restore, launch arguments, index, splash */
(function (G) {
  'use strict';
  const SL = G.ChipBench, U = SL.U, A = SL.app, $ = U.$, $$ = U.$$, fs = SL.fs;
  const t0 = performance.now();
  SL.applyPrefs();
  SL.registerPanel('outline', '大纲', 'outline', { key: 'Ctrl+Shift+U' });
  const ORDER = ['workspace', 'search', 'learn', 'tools', 'plan', 'outline']; /* 1.0: five primary entries; outline (Ctrl+Shift+U) and version history live behind the rail's secondary group */
  const rail = $('#rail'); ORDER.forEach(id => { const b = rail.querySelector('[data-p="' + id + '"]'); if (b) rail.insertBefore(b, rail.querySelector('.gap')); });
  ['outline'].forEach(id => { const b = rail.querySelector('[data-p="' + id + '"]'); if (b) b.classList.add('rb-sec'); });
  rail.insertAdjacentHTML('beforeend', '<button class="rb" data-x="prefs" title="偏好设置 (Ctrl+,)">' + SL.icon('gear') + '</button>');
  rail.addEventListener('click', e => { const b = e.target.closest('[data-x]'); if (!b) return; SL.run('prefs'); });
  async function start() {
    const stored = await SL.store.get('prefs', null); if (stored) { Object.assign(SL.prefs, stored); SL.applyPrefs(); }
    A.mode = SL.prefs.mode === 'split' || SL.prefs.mode === 'read' || SL.prefs.mode === 'source' ? SL.prefs.mode : 'live';
    SL.panel(SL.panels[SL.prefs.panel] ? SL.prefs.panel : 'workspace');
    SL.renderWelcome($('#welcome-pane'));
    // warm the editor kernel while the UI is already visible (P4)
    setTimeout(() => SL.E.load().catch(e => console.error('cm', e)), 30);
    try { await SL.ws.ensure(); } catch (e) { console.error('workspace', e); }
    // session
    const sess = await SL.store.get('session', null); let opened = 0;
    if (sess && sess.tabs) { for (const t of sess.tabs) { try { if (t.path) { if ((await fs.kind(t.path)) === 'file') { await SL.openPath(t.path, { background: true, mode: t.mode }); const tab = A.tabs[A.tabs.length - 1]; if (tab) tab.top = t.top || 0; opened++; } } else if (t.kind === 'md' && t.text) { const tab = { id: U.uid(), kind: 'md', path: null, name: t.name || '未命名.md', text: t.text, enc: 'UTF-8', dirty: true, mode: t.mode }; A.tabs.push(tab); opened++; } } catch (e) { } } if (opened) { const i = Math.min(Math.max(0, sess.cur), A.tabs.length - 1); await A.activate(i); } }
    if (SL.native) { try { const args = await SL.invoke('launch_args'); if (args.length) await A.openPaths(args); } catch (e) { } }
    if (!A.tabs.length) A.activate(-1);
    A.watchSync(); SL.index.build(); SL.panel(SL.prefs.panel && SL.panels[SL.prefs.panel] ? SL.prefs.panel : 'workspace');
    const sp = $('#splash'); sp.classList.add('out'); setTimeout(() => sp.remove(), 300); SL.bootMs = Math.round(performance.now() - t0); SL.emit('ready'); console.log('ChipBench ready in', SL.bootMs, 'ms');
  }
  start().catch(e => { console.error('boot', e); const sp = $('#splash'); if (sp) sp.remove(); SL.toast('启动出错：' + (e && e.message || e), 6000, 'bad'); });
})(window);
