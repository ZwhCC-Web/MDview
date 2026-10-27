/* ChipBench · core.js — namespace, icons, native bridge, storage, preferences, commands & keys, palette, menus, dialogs */
(function (G) {
  'use strict';
  const SL = G.ChipBench = G.ChipBench || {};
  SL.NAME = 'ChipBench'; SL.VERSION = '1.1.0'; SL.AUTHOR = 'Wenhao Zhao'; SL.TAGLINE = '芯片 AE 的工作台：资料、工程文件与 AI 在同一个工作区';
  const $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const h = (tag, attrs, html) => { const e = document.createElement(tag); if (attrs) for (const k in attrs) { if (k === 'class') e.className = attrs[k]; else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]); else if (attrs[k] != null) e.setAttribute(k, attrs[k]); } if (html != null) e.innerHTML = html; return e; };
  const debounce = (fn, ms) => { let t; const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; f.cancel = () => clearTimeout(t); f.flush = (...a) => { clearTimeout(t); fn(...a); }; return f; };
  const idle = window.requestIdleCallback ? f => requestIdleCallback(f, { timeout: 400 }) : f => setTimeout(f, 20);
  const raf = f => requestAnimationFrame(f);
  const U = SL.U = Object.assign({ $, $$, esc, h, debounce, idle, raf }, SL.X || {});
  /* ---------- icons ---------- */
  const IC = {
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>', file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>', search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
    outline: '<path d="M4 6h16M4 12h10M4 18h13"/>', plan: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4M8.5 15l2 2 4-4"/>', cards: '<rect x="3" y="7" width="14" height="12" rx="2"/><path d="M7 7V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-2"/>',
    tool: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>', git: '<circle cx="6" cy="6" r="2.2"/><circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="9" r="2.2"/><path d="M6 8.2v7.6M18 11.2c0 3-6 2-12 4.6"/>', gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    ai: '<path d="M12 3l1.8 4.6L18.5 9.5l-4.7 1.9L12 16l-1.8-4.6L5.5 9.5l4.7-1.9z"/><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>', plus: '<path d="M12 5v14M5 12h14"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>', chev: '<path d="M9 6l6 6-6 6"/>', cols: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>', eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', code: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>', edit: '<path d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4"/>', link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', book: '<path d="M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h10"/>', play: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M10 8l4 2.5-4 2.5zM8 21h8M12 17v4"/>', save: '<path d="M5 3h11l4 4v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 1-2z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>', refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>', trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/>', table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>', board: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 9h4M8 13h8M14 9h2"/>', graph: '<circle cx="6" cy="12" r="2.4"/><circle cx="18" cy="6" r="2.4"/><circle cx="18" cy="18" r="2.4"/><path d="M8.2 11l7.6-4M8.2 13l7.6 4"/>', download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>', pin: '<path d="M12 17v5M8 3h8l-1 7 3 3H6l3-3z"/>', home: '<path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>', chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>', sidebar: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9 4v16"/>', focus: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>', copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>', send: '<path d="M4 12l16-8-6 16-2.5-6.5z"/>', stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>', check: '<path d="M5 12l5 5L20 6"/>', dots: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>', mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>', sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>', moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>', arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>', pen: '<path d="M4 20l1-4L17 4l3 3L8 19z"/>', cursor: '<path d="M5 3l14 7-6 2-2 6z"/>', square: '<rect x="4" y="5" width="16" height="14" rx="2"/>', circle: '<circle cx="12" cy="12" r="8"/>', diamond: '<path d="M12 3l9 9-9 9-9-9z"/>', text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>', note: '<path d="M5 3h14v12l-6 6H5z"/><path d="M13 21v-6h6"/>'
  };
  SL.icon = (n, cls) => '<svg class="i' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24">' + (IC[n] || IC.file) + '</svg>';
  /* ---------- events ---------- */
  const ev = {}; SL.on = (n, f) => { (ev[n] = ev[n] || []).push(f); return () => { ev[n] = (ev[n] || []).filter(x => x !== f); }; }; SL.emit = (n, ...a) => (ev[n] || []).slice().forEach(f => { try { f(...a); } catch (e) { console.error(n, e); } });
  /* ---------- native bridge ---------- */
  const T = G.__TAURI__; SL.native = !!(T && T.core && T.core.invoke);
  SL.invoke = (c, a) => { if (!SL.native) return Promise.reject(new Error('桌面功能不可用：' + c)); return T.core.invoke(c, a || {}); };
  SL.listen = async (n, f) => { if (T && T.event) try { return await T.event.listen(n, e => f(e.payload)); } catch (e) { } };
  SL.http = { fetch: (u, o) => (T && T.http && T.http.fetch ? T.http.fetch(u, o) : fetch(u, o)) };
  const b64ToBytes = b => { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
  const bytesToB64 = u => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  U.b64ToBytes = b64ToBytes; U.bytesToB64 = bytesToB64;
  const fs = SL.fs = {
    read: p => SL.invoke('read_text', { path: p }), readBytes: async p => b64ToBytes(await SL.invoke('read_b64', { path: p })),
    write: (p, t, enc) => SL.invoke('write_text', { path: p, content: t, encoding: enc && enc !== 'UTF-8' ? enc : null }), writeBytes: (p, u) => SL.invoke('write_b64', { path: p, data: bytesToB64(u instanceof Uint8Array ? u : new Uint8Array(u)) }),
    kind: p => SL.invoke('path_kind', { path: p }).catch(() => 'none'), list: p => SL.invoke('list_dir', { path: p }), mtime: p => SL.invoke('file_mtime', { path: p }), size: p => SL.invoke('file_size', { path: p }),
    mkdir: p => SL.invoke('make_dir', { path: p }), rm: (p, rec) => SL.invoke('remove_path', { path: p, recursive: !!rec }), rename: (a, b) => SL.invoke('rename_path', { from: a, to: b }), reveal: p => SL.invoke('reveal', { path: p }),
    exists: async p => (await fs.kind(p)) !== 'none'
  };
  const lsKey = k => 'chipbench.' + k;
  /* 1.0: migrate browser-side keys from the pre-1.0 name (silica.*) once */
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('silica.') && localStorage.getItem('chipbench.' + k.slice(7)) == null) localStorage.setItem('chipbench.' + k.slice(7), localStorage.getItem(k)); } } catch (e) { }
  SL.store = { async get(k, d) { try { if (SL.native) { const r = await SL.invoke('kv_get', { key: k }); return r == null ? d : JSON.parse(r); } const v = localStorage.getItem(lsKey(k)); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, async set(k, v) { try { if (SL.native) await SL.invoke('kv_set', { key: k, value: JSON.stringify(v) }); else localStorage.setItem(lsKey(k), JSON.stringify(v)); } catch (e) { console.warn('store', e); } } };
  /* ---------- preferences ---------- */
  const PD = { theme: 'system', accent: 'blue', density: 'normal', fontSize: 16, width: 820, lineHeight: 1.75, mode: 'live', autosave: true, side: true, sideWidth: 284, spell: false, srcLines: false, autoNum: false, autoPair: true, tableFmt: true, richPaste: true, slash: true, goal: 0, imgMax: 1920, gitAuto: false, cjkSpace: false, docFont: 'ui' };
  SL.prefs = Object.assign({}, PD, JSON.parse(localStorage.getItem(lsKey('prefs')) || '{}'));
  SL.savePrefs = debounce(() => { localStorage.setItem(lsKey('prefs'), JSON.stringify(SL.prefs)); SL.store.set('prefs', SL.prefs); }, 300);
  SL.applyPrefs = () => {
    const p = SL.prefs, R = document.documentElement; const dark = p.theme === 'system' ? matchMedia('(prefers-color-scheme: dark)').matches : p.theme !== 'light';
    R.dataset.theme = p.theme === 'graphite' ? 'graphite' : dark ? 'dark' : 'light'; R.dataset.accent = p.accent; R.dataset.density = p.density;
    const st = R.style; st.setProperty('--fs', p.fontSize + 'px'); st.setProperty('--width', p.width + 'px'); st.setProperty('--lh', p.lineHeight); st.setProperty('--sidew', p.sideWidth + 'px');
    st.setProperty('--doc', p.docFont === 'serif' ? '"Source Han Serif SC","Noto Serif CJK SC","Songti SC","Georgia",serif' : 'var(--ui)');
    const a = $('#app'); if (a) a.classList.toggle('no-side', !p.side); SL.emit('prefs', p);
  };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => SL.prefs.theme === 'system' && SL.applyPrefs());
  /* ---------- commands & keys ---------- */
  const C = SL.commands = new Map();
  SL.cmd = (id, title, fn, o) => { C.set(id, Object.assign({ id, title, fn }, o || {})); };
  SL.run = (id, arg) => { const c = C.get(id); if (!c) return false; if (c.when && !c.when()) return false; try { const r = c.fn(arg); if (r && r.catch) r.catch(e => { console.error(id, e); SL.toast(String(e && e.message || e), 4000, 'bad'); }); } catch (e) { console.error(id, e); SL.toast(String(e && e.message || e), 4000, 'bad'); } return true; };
  const keyName = e => { const k = e.key; if (['Control', 'Shift', 'Alt', 'Meta'].includes(k)) return null; let n = e.code && /^(Key|Digit)/.test(e.code) ? e.code.replace(/^(Key|Digit)/, '') : e.code === 'Space' ? 'Space' : e.code === 'Slash' ? '/' : e.code === 'Comma' ? ',' : e.code === 'Equal' ? '=' : e.code === 'Minus' ? '-' : e.code === 'Backquote' ? '`' : k.length === 1 ? k.toUpperCase() : k; return (e.ctrlKey || e.metaKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey ? 'Shift+' : '') + n; };
  SL.keyName = keyName;
  document.addEventListener('keydown', e => {
    if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return; const n = keyName(e); if (!n) return;
    const typing = e.target && e.target.closest && e.target.closest('input,textarea,select');
    for (const c of C.values()) if (c.key && c.key === n && (!typing || c.global || /^Ctrl\+(Shift|Alt)\+/.test(c.key))) { if (c.when && !c.when()) continue; e.preventDefault(); e.stopPropagation(); SL.run(c.id); return; }
  }, true);
  /* ---------- toast ---------- */
  SL.toast = (m, ms, kind) => { let box = $('#toasts'); if (!box) { box = h('div', { id: 'toasts' }); document.body.appendChild(box); } const t = h('div', { class: 'toast' + (kind ? ' ' + kind : '') }, esc(m)); box.appendChild(t); setTimeout(() => t.remove(), ms || 2200); };
  /* ---------- menu ---------- */
  SL.menu = (anchor, items, cb, at) => {
    $$('.menu-pop').forEach(m => m.remove());
    const m = h('div', { class: 'menu-pop' }, items.map(it => !it || it.sep ? '<hr>' : it.head ? '<div class="mh">' + esc(it.head) + '</div>' : '<div class="mi' + (it.danger ? ' danger' : '') + (it.checked ? ' chk' : '') + '" data-k="' + esc(it.k) + '">' + (it.icon ? SL.icon(it.icon) : '') + '<span>' + esc(it.t) + '</span>' + (it.key ? '<span class="k">' + esc(it.key) + '</span>' : '') + '</div>').join(''));
    document.body.appendChild(m); const r = at || (anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: 20, top: 20, bottom: 20 });
    m.style.left = Math.max(6, Math.min(innerWidth - m.offsetWidth - 8, r.left)) + 'px'; m.style.top = Math.max(6, Math.min(innerHeight - m.offsetHeight - 8, (r.bottom != null ? r.bottom + 4 : r.top))) + 'px';
    const off = e => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('mousedown', off, true); } };
    m.addEventListener('click', e => { const it = e.target.closest('[data-k]'); if (it) { m.remove(); document.removeEventListener('mousedown', off, true); cb(it.dataset.k); } });
    setTimeout(() => document.addEventListener('mousedown', off, true), 0); return m;
  };
  /* ---------- modal / prompt / confirm ---------- */
  SL.modal = o => new Promise(res => {
    const bg = h('div', { class: 'modal-bg' }), m = h('div', { class: 'modal' + (o.wide ? ' wide' : '') + (o.small ? ' sm' : '') }); bg.appendChild(m);
    m.innerHTML = '<div class="modal-h"><span>' + esc(o.title || '') + '</span><span class="sp"></span><button class="btn ghost icon" data-x>' + SL.icon('x') + '</button></div><div class="modal-b"></div>' + (o.buttons ? '<div class="modal-f"></div>' : '');
    const body = $('.modal-b', m); if (typeof o.body === 'string') body.innerHTML = o.body; else if (o.body) body.appendChild(o.body);
    const close = v => { bg.remove(); document.removeEventListener('keydown', kd, true); res(v); if (o.onClose) o.onClose(v); };
    (o.buttons || []).forEach(b => { const e = h('button', { class: 'btn' + (b.primary ? ' primary' : '') }, esc(b.t)); e.onclick = async () => { if (b.fn) { const r = await b.fn(m); if (r === false) return; } close(b.v); }; $('.modal-f', m).appendChild(e); });
    $('[data-x]', m).onclick = () => close(null); bg.addEventListener('mousedown', e => { if (e.target === bg) close(null); });
    const kd = e => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } if (e.key === 'Enter' && o.enter && !e.target.closest('textarea')) { e.preventDefault(); const b = $('.modal-f .primary', m); if (b) b.click(); } }; document.addEventListener('keydown', kd, true);
    document.body.appendChild(bg); const f = $('input,textarea,select', body); if (f && o.focus !== false) setTimeout(() => { f.focus(); if (f.select) f.select(); }, 30); m.close = close; if (o.onOpen) o.onOpen(m);
  });
  SL.prompt = (msg, def, o) => { o = o || {}; let val = null; return SL.modal({ title: msg, small: true, enter: true, body: '<input class="input" style="width:100%" value="' + esc(def || '') + '"' + (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : '') + '>', buttons: [{ t: '取消', v: null }, { t: o.ok || '确定', primary: true, v: 'ok', fn: m => { val = $('input', m).value; } }] }).then(r => r === 'ok' ? val : null); };
  SL.confirm = (msg, ok, danger) => SL.modal({ title: '确认', small: true, enter: true, body: '<p style="margin:4px 0 0;line-height:1.7;white-space:pre-wrap">' + esc(msg) + '</p>', buttons: [{ t: '取消', v: false }, { t: ok || '确定', primary: true, v: true }] }).then(r => r === true);
  /* ---------- palette (providers supply items) ---------- */
  const fuzzy = (q, s) => { if (!q) return { score: 0, html: esc(s) }; q = q.toLowerCase(); let qi = 0, sc = 0, last = -2, html = ''; const ls = s.toLowerCase(); for (let i = 0; i < s.length; i++) { if (qi < q.length && ls[i] === q[qi]) { sc += (i === last + 1 ? 5 : 1) + (i === 0 ? 3 : 0); last = i; qi++; html += '<b>' + esc(s[i]) + '</b>'; } else html += esc(s[i]); } return qi === q.length ? { score: sc, html } : null; };
  U.fuzzy = fuzzy;
  const providers = SL.paletteProviders = [];
  SL.palette = async function (prefix, opt) {
    opt = opt || {}; $$('.palette').forEach(p => p.remove());
    const box = h('div', { class: 'palette' }, '<input class="pal-in" placeholder="搜索文件 · > 命令 · # 标题 · = 计算 · ? 全文搜索"><div class="pal-list"></div><div class="pal-foot"><span><kbd>↑↓</kbd> 选择</span><span><kbd>Enter</kbd> 执行</span><span><kbd>Esc</kbd> 关闭</span><span class="sp"></span><span>' + SL.NAME + '</span></div>'); document.body.appendChild(box);
    const inp = $('.pal-in', box), list = $('.pal-list', box); inp.value = prefix || ''; let items = [], sel = 0, seq = 0;
    const draw = () => { let last = ''; list.innerHTML = items.length ? items.map((x, i) => (x.group && x.group !== last ? (last = x.group, '<div class="pal-g">' + esc(x.group) + '</div>') : '') + '<div class="pal-it' + (i === sel ? ' sel' : '') + '" data-i="' + i + '">' + (x.icon ? SL.icon(x.icon) : '') + '<span>' + (x.html || esc(x.title)) + '</span>' + (x.sub ? '<small>' + esc(x.sub) + '</small>' : '') + '</div>').join('') : '<div class="empty">无匹配项</div>'; const s = $('.sel', list); if (s) s.scrollIntoView({ block: 'nearest' }); };
    const refresh = async () => { const v = inp.value, my = ++seq; const pv = providers.find(p => p.prefix && v.startsWith(p.prefix)) || providers.find(p => !p.prefix); if (!pv) return; const q = pv.prefix ? v.slice(pv.prefix.length) : v; const r = await pv.items(q.trim(), v); if (my !== seq) return; items = r || []; sel = 0; draw(); };
    const go = async i => { const x = items[i]; box.remove(); if (x && x.run) x.run(x, inp.value); };
    inp.addEventListener('input', refresh); inp.addEventListener('keydown', e => { if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); draw(); } else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); } else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); const x = items[sel]; if (x && x.alt && e.shiftKey) { box.remove(); x.alt(x); } else go(sel); } else if (e.key === 'Escape') { e.stopPropagation(); box.remove(); } });
    list.addEventListener('mousedown', e => { const it = e.target.closest('[data-i]'); if (it) { e.preventDefault(); go(+it.dataset.i); } }); inp.addEventListener('blur', () => setTimeout(() => box.remove(), 160)); inp.focus(); refresh();
  };
  /* ---------- misc ---------- */
  SL.loadScript = (u) => new Promise((res, rej) => { if (document.querySelector('script[src="' + u + '"]')) return res(); const s = document.createElement('script'); s.src = u; s.onload = res; s.onerror = () => rej(new Error('load ' + u)); document.head.appendChild(s); });
  const libs = {}; SL.lib = (name, loader) => libs[name] || (libs[name] = loader().catch(e => { delete libs[name]; throw e; }));
  SL.download = (name, data, type) => { const a = document.createElement('a'); a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
  /* save bytes/text through a native dialog (desktop) or a browser download (tests) */
  SL.saveOut = async (name, content, ext, label) => { if (SL.native) { const p = await SL.invoke('save_dialog', { name, filter: label || ext, ext }); if (!p) return null; if (typeof content === 'string') await fs.write(p, content); else await fs.writeBytes(p, content instanceof Uint8Array ? content : new Uint8Array(await content.arrayBuffer())); SL.toast('已导出 ' + U.base(p)); return p; } SL.download(name, content, 'application/octet-stream'); return name; };
  SL.openExternal = u => SL.native ? SL.invoke('open_url', { url: u }).catch(e => SL.toast('无法打开：' + e)) : window.open(u, '_blank');
  SL.today = () => U.ymd(new Date());
})(window);
