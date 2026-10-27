/* ChipBench · integration.js — integration layer.
   · version + build info (shown in About and in the help hub)
   · routes .pptx / .html / .htm tabs to the 3.1 viewers (falls back to the 3.0 viewer if a 3.1 viewer throws)
   · Mermaid: theme + fonts derived from the live design tokens (flow-charts match the document, dark / graphite aware)
   Everything is defensive: if an anchor is missing the module logs a warning ("[s31] …") and ChipBench keeps the 3.0 behaviour. */
(function (G) {
  'use strict';
  const SL = G.ChipBench; if (!SL) { console.warn('[s31] ChipBench not found — 3.1 modules not loaded'); return; }
  const S = SL.s31 = SL.s31 || {};
  S.version = '1.1.0'; S.build = '2026-10-27'; S.codename = 'Die';
  S.warn = (...a) => console.warn('[s31]', ...a);

  const hookViewers = () => {
    const V = SL.viewers; if (!V || typeof V.open !== 'function') return false; if (V.open.__s31) return true;
    const orig = V.open, h = SL.U && SL.U.h ? SL.U.h : (tag, a) => Object.assign(document.createElement(tag), { className: (a && a.class) || '' });
    V.open = async function (t) {
      const k = t && t.view, mod = k === 'pptx' ? S.pptx : k === 'html' ? S.html : null;
      if (!mod || !t.el) return orig.apply(this, arguments);
      try { const el = t.el; el.innerHTML = ''; const root = h('div', { class: 'vw' }); el.appendChild(root); t.root = root; await mod.open(t, root); }
      catch (e) { S.warn(k + ' viewer failed, falling back to the 3.0 viewer:', e); if (SL.toast) SL.toast('预览出错，已切换到基础视图：' + String(e && e.message || e).slice(0, 80), 3500, 'warn'); return orig.apply(this, arguments); }
    };
    V.open.__s31 = true; return true;
  };

  const hex = v => { v = String(v || '').trim(); const m = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i); if (m) { const x = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1]; return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)]; } const r = v.match(/rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/i); return r ? [+r[1], +r[2], +r[3]] : null; };
  const toHex = rgb => '#' + rgb.map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, t) => { const A = hex(a), B = hex(b); return A && B ? toHex(A.map((x, i) => x * t + B[i] * (1 - t))) : a; };
  const themeVars = () => {
    const cs = getComputedStyle(document.documentElement), g = n => cs.getPropertyValue(n).trim(), dark = /^(dark|graphite)$/.test(document.documentElement.dataset.theme || '');
    const brand = g('--brand') || '#3b66f0', n0 = g('--n0') || (dark ? '#17191d' : '#ffffff'), n1 = g('--n1') || n0, n2 = g('--n2') || n1, n5 = g('--n5') || '#d9dde3', t1 = g('--t1') || (dark ? '#eceff4' : '#1a1d21'), t3 = g('--t3') || '#6a727e';
    const ok = g('--ok') || '#1f8a4c', warn = g('--warn') || '#b26b00', bad = g('--bad') || '#cc3030', font = (g('--doc') || 'Segoe UI, sans-serif').replace(/"/g, "'");
    return {
      darkMode: dark, background: n0, fontFamily: font, fontSize: '15px', primaryColor: mix(brand, n0, dark ? .22 : .10), primaryBorderColor: brand, primaryTextColor: t1, textColor: t1, nodeTextColor: t1, mainBkg: mix(brand, n0, dark ? .22 : .10), nodeBorder: brand,
      secondaryColor: mix(ok, n0, dark ? .22 : .10), secondaryBorderColor: ok, secondaryTextColor: t1, tertiaryColor: mix(warn, n0, dark ? .22 : .10), tertiaryBorderColor: warn, tertiaryTextColor: t1,
      lineColor: mix(t3, n0, .85), arrowheadColor: mix(t3, n0, .85), edgeLabelBackground: n0, clusterBkg: n1, clusterBorder: n5, titleColor: t1,
      noteBkgColor: mix(warn, n0, dark ? .25 : .12), noteTextColor: t1, noteBorderColor: warn, errorBkgColor: mix(bad, n0, .15), errorTextColor: bad,
      actorBkg: mix(brand, n0, dark ? .22 : .10), actorBorder: brand, actorTextColor: t1, signalColor: t1, signalTextColor: t1, labelBoxBkgColor: n2, labelBoxBorderColor: n5, loopTextColor: t1, activationBkgColor: n2, sequenceNumberColor: n0
    };
  };
  const MM_CSS = '.node rect,.node polygon,.node circle,.node ellipse,.node path{stroke-width:1.4px}.node rect{rx:9;ry:9}.cluster rect{rx:12;ry:12;stroke-dasharray:none}.edgePath .path,.flowchart-link{stroke-width:1.6px}.label,.nodeLabel,.edgeLabel{font-weight:500}.edgeLabel{border-radius:6px;padding:2px 6px}';
  const patchMermaid = M => {
    if (!M || M.__s31 || typeof M.initialize !== 'function') return M; M.__s31 = true; const init = M.initialize.bind(M);
    M.initialize = cfg => init(Object.assign({}, cfg || {}, { theme: 'base', themeVariables: themeVars(), themeCSS: MM_CSS, fontFamily: themeVars().fontFamily, flowchart: Object.assign({ htmlLabels: false, curve: 'basis', padding: 14, nodeSpacing: 46, rankSpacing: 56, useMaxWidth: true }, cfg && cfg.flowchart || {}), sequence: Object.assign({ useMaxWidth: true, actorMargin: 60, boxMargin: 8, messageMargin: 36, mirrorActors: false }, cfg && cfg.sequence || {}) }));
    return M;
  };
  S.mermaidTheme = themeVars; S.patchMermaid = patchMermaid;
  const hookLib = () => {
    if (typeof SL.lib !== 'function' || SL.lib.__s31) return;
    const orig = SL.lib, wrapped = function (key, loader) { if (key === 'mermaid' && typeof loader === 'function') return orig.call(SL, key, async () => patchMermaid(await loader())); return orig.apply(SL, arguments); };
    wrapped.__s31 = true; SL.lib = wrapped;
  };

  const install = () => { hookLib(); if (!hookViewers()) { S.warn('SL.viewers not ready yet — will retry on "ready"'); SL.on && SL.on('ready', hookViewers); } document.documentElement.dataset.s31 = S.version; };
  install(); console.log('ChipBench modules active', S.version);
})(window);
