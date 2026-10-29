/* ChipBench · v161.js — 1.6.1
   1. Floating zoom HUD for every open file (Markdown, PDF, Excel / CSV, Word, PPT, mail, HTML, logs, HEX / ELF, MAP, SVD, images)
      and for IP-atlas pages: shows the level as a bar + percentage, − / + buttons, a slider, and one-click "还原 100%".
      Appears on every zoom change, stays as a small pill while the file is not at 100 %, hides at 100 %.
   2. Idle pre-warm: while the user is idle after start-up, load the PDF engine and parse the IP-atlas page list,
      so the first PDF / first IP page opens without the cold-start cost (spends memory to save time). */
(function (G) {
  'use strict';
  const SL = G.ChipBench, U = SL.U, A = SL.app, Z = SL.zoom, $ = U.$, esc = U.esc;
  if (!Z) return;

  /* ---------------- context: what does the HUD control right now? ---------------- */
  const atlasOpen = () => !!(SL.atlas && SL.atlas.zoomStep && document.querySelector('.fp .at-view'));
  function ctx() {
    if (atlasOpen()) {
      const AT = SL.atlas, r = AT.zoomRange || [0.75, 1.6];
      return { kind: 'atlas', name: 'IP 图谱', z: AT.zoom || 1, min: r[0], max: r[1], step: d => AT.zoomStep(d), reset: () => AT.zoomStep(0), set: z => AT.zoomSet ? AT.zoomSet(z) : null, isDefault: Math.abs((AT.zoom || 1) - 1) < 0.005 };
    }
    const t = A.current(); if (!t) return null;
    if (Z.isPdf(t)) { const z = t.zoom || 1; return { kind: 'pdf', name: t.name, z, min: 0.4, max: 4, step: d => Z.step(d, t), reset: () => Z.reset(t), set: null, isDefault: !t.zoomManual, resetLabel: '适应宽度' }; }
    const L = Z.LEVELS, z = Z.get(t);
    return { kind: t.kind, name: t.name, z, min: L[0], max: L[L.length - 1], step: d => Z.step(d, t), reset: () => Z.reset(t), set: v => Z.set(t, v), isDefault: Math.abs(z - 1) < 0.005 };
  }

  /* ---------------- the HUD ---------------- */
  const hud = document.createElement('div'); hud.id = 'zoom-hud'; hud.setAttribute('role', 'toolbar'); hud.setAttribute('aria-label', '缩放');
  hud.innerHTML = '<button class="zh-b" data-z="-" title="缩小 (Ctrl+-)" aria-label="缩小"><svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg></button>' +
    '<div class="zh-mid"><div class="zh-top"><b class="zh-pct">100%</b><span class="zh-nm"></span></div><div class="zh-track"><i class="zh-fill"></i><i class="zh-one" title="100%"></i><input class="zh-rng" type="range" min="0" max="1000" step="1" aria-label="缩放比例"></div></div>' +
    '<button class="zh-b" data-z="+" title="放大 (Ctrl+=)" aria-label="放大"><svg viewBox="0 0 24 24"><path d="M6 12h12M12 6v12"/></svg></button>' +
    '<button class="zh-reset" data-z="0" title="还原 100%（Ctrl+0；Markdown 中为 Ctrl+Alt+0）"><svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v5h5"/></svg><span>还原</span></button>';
  document.body.appendChild(hud);
  const pct = hud.querySelector('.zh-pct'), nm = hud.querySelector('.zh-nm'), fill = hud.querySelector('.zh-fill'), one = hud.querySelector('.zh-one'), rng = hud.querySelector('.zh-rng'), rst = hud.querySelector('.zh-reset span');
  // logarithmic track so 50 %–100 % and 100 %–300 % both get usable room
  const pos = (z, c) => (Math.log(z) - Math.log(c.min)) / (Math.log(c.max) - Math.log(c.min));
  const fromPos = (p, c) => Math.exp(Math.log(c.min) + p * (Math.log(c.max) - Math.log(c.min)));
  let hideT = 0, hover = false, dragging = false;
  function paint(c) {
    if (!c) { hud.className = ''; return; }
    const p = Math.max(0, Math.min(1, pos(c.z, c)));
    pct.textContent = Math.round(c.z * 100) + '%'; nm.textContent = c.kind === 'pdf' && !c.isDefault ? 'PDF' : c.kind === 'pdf' ? 'PDF · 适应宽度' : c.kind === 'atlas' ? 'IP 图谱' : '';
    fill.style.width = (p * 100).toFixed(1) + '%'; one.style.left = (Math.max(0, Math.min(1, pos(1, c))) * 100).toFixed(1) + '%'; one.style.display = c.kind === 'pdf' ? 'none' : '';
    if (!dragging) rng.value = Math.round(p * 1000); rng.disabled = !c.set; rst.textContent = c.resetLabel || '还原';
    hud.classList.toggle('dflt', !!c.isDefault); hud.dataset.kind = c.kind;
  }
  function show(user) {
    const c = ctx(); paint(c);
    if (!c) { clearTimeout(hideT); hud.classList.remove('on', 'mini'); return; }
    if (user) { clearTimeout(hideT); hud.classList.add('on'); hud.classList.remove('mini'); hideT = setTimeout(settle, 2200); }
    else if (!hud.classList.contains('on')) hud.classList.toggle('mini', !c.isDefault);
  }
  function settle() {
    if (hover || dragging) { hideT = setTimeout(settle, 800); return; }
    const c = ctx(); paint(c); hud.classList.remove('on'); hud.classList.toggle('mini', !!(c && !c.isDefault));
  }
  Z.onChange = user => requestAnimationFrame(() => show(user));
  Z.hud = { show: () => show(true), el: hud };
  hud.addEventListener('mouseenter', () => { hover = true; if (hud.classList.contains('mini')) { hud.classList.add('on'); hud.classList.remove('mini'); } });
  hud.addEventListener('mouseleave', () => { hover = false; clearTimeout(hideT); hideT = setTimeout(settle, 900); });
  hud.addEventListener('click', e => { const b = e.target.closest('[data-z]'); if (!b) return; const c = ctx(); if (!c) return; const d = b.dataset.z; if (d === '0') c.reset(); else c.step(d === '+' ? 1 : -1); show(true); });
  rng.addEventListener('input', () => { const c = ctx(); if (!c || !c.set) return; dragging = true; let z = fromPos(rng.value / 1000, c); if (Math.abs(z - 1) < 0.04) z = 1; c.set(Math.round(z * 100) / 100); });
  rng.addEventListener('change', () => { dragging = false; show(true); });
  // keep the pill in sync when switching tabs / closing the IP page / opening a file
  ['tab', 'closed', 'opened', 'mode'].forEach(ev => SL.on(ev, () => setTimeout(() => show(false), 60)));
  new MutationObserver(() => show(false)).observe(document.body, { childList: true });   // .fp (full pages) open / close
  // Ctrl+0 resets viewers and IP pages; Markdown keeps Ctrl+0 = 正文, reset there with Ctrl+Alt+0 or the HUD
  document.addEventListener('keydown', e => { if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key !== '0') return; const c = ctx(); if (!c || c.kind === 'md') return; /* in Markdown Ctrl+0 = 正文 (paragraph); use Ctrl+Alt+0 or the HUD there */ e.preventDefault(); e.stopPropagation(); c.reset(); show(true); }, true);

  /* ---------------- idle pre-warm (memory for speed) ---------------- */
  const idle = (f, t) => (G.requestIdleCallback ? requestIdleCallback(f, { timeout: t || 6000 }) : setTimeout(f, 1500));
  SL.on('ready', () => setTimeout(() => {
    idle(() => { try { SL.atlas && SL.atlas.scan && SL.atlas.scan(); } catch (e) { } });
    idle(() => { try { SL.viewers && SL.viewers.pdfLib && SL.viewers.pdfLib().catch(() => { }); } catch (e) { } }, 10000);
  }, 2500));
})(window);

/* 3. very large Markdown tables (live widget + reading view): render the first 300 rows, fold the rest behind a button.
      A 60 × 3000 table used to create 180k cells and force layout of all of them on every measure → the window hung. */
(function (G) {
  'use strict';
  const SL = G.ChipBench; if (!SL || !SL.enhance) return;
  const KEEP = 300, MIN = 600, CHUNK = 400;
  function fold(root) {
    const tbs = root.querySelectorAll ? root.querySelectorAll('table') : [];
    for (const tb of tbs) {
      if (tb.dataset.fold || tb.closest('.sheet-scroll, .vw, .at-cmp')) continue;
      const body = tb.tBodies[0]; if (!body || body.rows.length < MIN) continue;
      tb.dataset.fold = 1; const total = body.rows.length, rest = document.createDocumentFragment();
      while (body.rows.length > KEEP) rest.prepend(body.rows[body.rows.length - 1]);
      const bar = document.createElement('div'); bar.className = 'tb-fold';
      bar.innerHTML = '<span>表格共 <b>' + total.toLocaleString() + '</b> 行 · 为保持流畅只显示前 ' + KEEP + ' 行</span><button class="btn sm" type="button">显示全部</button>';
      const host = tb.parentElement && tb.parentElement.classList.contains('tbl-wrap') ? tb.parentElement : tb; host.after(bar);
      bar.querySelector('button').addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation(); const b = e.currentTarget; b.disabled = true;
        const step = () => { let n = 0; while (rest.firstChild && n++ < CHUNK) body.appendChild(rest.firstChild); b.textContent = rest.firstChild ? '加载中… ' + body.rows.length.toLocaleString() + ' / ' + total.toLocaleString() : ''; if (rest.firstChild) requestAnimationFrame(step); else bar.remove(); };
        requestAnimationFrame(step);
      });
    }
  }
  const prev = SL.enhance; SL.enhance = (root, ctx) => { const p = prev(root, ctx); /* after table formulas are evaluated */ try { fold(root); } catch (e) { } return p; };
  SL.foldTables = fold;
})(window);
