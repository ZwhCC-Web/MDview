/* ChipBench · help.js — help hub: user manual, shortcuts, development notes, changelog, credits, About (version).
   The texts live in docs/*.md and are embedded into app/js/docs-data.js by tools/embed-docs.py (run by apply-3.1.py), so the manual works offline. */
(function (G) {
  'use strict';
  const SL = G.ChipBench; if (!SL || !SL.U) { console.warn('[s31] help: ChipBench not ready'); return; }
  const S = SL.s31 = SL.s31 || {}, U = SL.U, d = document, esc = U.esc || (s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));
  const DOCS = () => (S.docs || {});
  const PAGES = [
    { id: 'about', t: '关于 ChipBench', g: '产品' },
    { id: 'manual', t: '使用手册', g: '文档', doc: 'MANUAL' },
    { id: 'shortcuts', t: '快捷键速查', g: '文档', doc: 'SHORTCUTS' },
    { id: 'dev', t: '开发说明', g: '文档', doc: 'DEVELOPMENT' },
    { id: 'changelog', t: '版本记录', g: '文档', doc: 'CHANGELOG' },
    { id: 'credits', t: '制作说明与许可', g: '文档', doc: 'CREDITS' }
  ];
  const render = md => { try { const r = SL.md.render(md, { widgets: false }); return r.blocks.map(b => b.html).join('\n') + (r.footnotes || ''); } catch (e) { return '<pre>' + esc(md) + '</pre>'; } };
  const aboutHtml = () => {
    const v = S.version || '1.0.0';
    return '<div class="about"><div class="mark"><i></i></div><h2>ChipBench</h2><div class="ver">v' + esc(v) + (S.codename ? ' · ' + esc(S.codename) : '') + '</div>' +
      '<p style="color:var(--t3);margin:0 auto;max-width:430px">芯片 AE 的工作台：按芯片或项目建工作区，手册、代码、PPT、抓包与日志统一打开、查找、编辑，沉淀成带出处的工程知识；AI 通过 MCP 与技能接入。文件始终留在原处。前身：Silica。</p>' +
      '<dl><dt>版本</dt><dd class="mono">' + esc(v) + '（构建 ' + esc(S.build || '') + '）</dd><dt>制作</dt><dd>Wenhao Zhao</dd><dt>平台</dt><dd>Windows 10 / 11 · Tauri 2 + WebView2</dd><dt>数据位置</dt><dd class="mono">%USERPROFILE%\\.chipbench\\</dd><dt>字体</dt><dd>Source Sans · Noto Sans SC（SIL OFL 1.1，随程序附带）</dd></dl></div>';
  };
  function open(page) {
    const render1 = body => {
      const wrap = d.createElement('div'); wrap.className = 'hub';
      wrap.innerHTML = '<nav>' + (() => { let g = '', out = ''; for (const p of PAGES) { if (p.g !== g) { g = p.g; out += '<div class="grp">' + g + '</div>'; } out += '<a data-id="' + p.id + '">' + p.t + '</a>'; } return out; })() + '</nav><div class="doc md" id="hub-doc"></div>';
      body.appendChild(wrap); const doc = wrap.querySelector('#hub-doc');
      const go = id => { const p = PAGES.find(x => x.id === id) || PAGES[1]; wrap.querySelectorAll('nav a').forEach(a => a.classList.toggle('on', a.dataset.id === p.id)); doc.scrollTop = 0; doc.innerHTML = p.id === 'about' ? aboutHtml() : render(DOCS()[p.doc] || '（此文档尚未嵌入。运行 tools/embed-docs.py 后重新构建。）'); if (SL.enhance && p.id !== 'about') { try { SL.enhance(doc, { pv: true }); } catch (e) { } } };
      wrap.querySelector('nav').addEventListener('click', e => { const a = e.target.closest('a[data-id]'); if (a) go(a.dataset.id); });
      doc.addEventListener('click', e => { const a = e.target.closest('a[href]'); if (!a) return; const h = a.getAttribute('href') || ''; if (h.startsWith('#')) { e.preventDefault(); const t = doc.querySelector('[id="' + CSS.escape(decodeURIComponent(h.slice(1))) + '"]'); if (t) doc.scrollTop = t.offsetTop - 8; } else if (/^https?:/i.test(h)) { e.preventDefault(); (SL.openExternal || (u => SL.invoke('open_url', { url: u })))(h); } });
      go(page || 'manual');
    };
    if (SL.openFull) return SL.openFull('帮助与手册', render1);
    if (SL.modal) { const b = d.createElement('div'); render1(b); return SL.modal({ title: '帮助与手册', wide: true, body: b, buttons: [{ t: '关闭', v: null }] }); }
  }
  S.help = { open };
  const install = () => {
    if (SL.cmd) { SL.cmd('help.hub', '帮助与手册', () => open('manual'), { group: '应用', icon: 'book' }); SL.cmd('help.about', '关于 ChipBench（版本）', () => open('about'), { group: '应用' }); SL.cmd('help.manual', '使用手册', () => open('manual'), { group: '应用', icon: 'book' }); SL.cmd('help.dev', '开发说明', () => open('dev'), { group: '应用' }); SL.cmd('help.changelog', '版本记录', () => open('changelog'), { group: '应用' }); }
    const rail = d.getElementById('rail');
    if (rail && !rail.querySelector('[data-h31]')) { const b = d.createElement('button'); b.className = 'rb'; b.setAttribute('data-h31', ''); b.title = '帮助与手册'; b.setAttribute('aria-label', '帮助与手册'); b.innerHTML = SL.icon ? SL.icon('book') : '?'; b.addEventListener('click', () => open('manual')); rail.appendChild(b); }
    d.documentElement.dataset.chipbenchVersion = S.version || '1.0.0';
  };
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', () => setTimeout(install, 0)); else setTimeout(install, 0);
})(window);
