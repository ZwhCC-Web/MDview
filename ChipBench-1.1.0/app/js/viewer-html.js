/* ChipBench · viewer-html.js — local HTML / saved web pages that actually run.
   3.0 showed .html files in <iframe sandbox="" srcdoc>: every script was blocked and no relative CSS / JS / image / font could load,
   so pages degraded to bare text. 3.1:
     · relative stylesheets, scripts, images, fonts, <source>, <video poster> and CSS url(...) are inlined before display
     · the frame is sandboxed WITHOUT allow-same-origin (opaque origin: the page cannot reach ChipBench or the Tauri bridge) but with
       allow-scripts / forms / popups / modals / downloads, so interactive pages work
     · localStorage / sessionStorage are replaced by a persisted shim (opaque origins have none), saved per file
     · links open in the system browser; "独立窗口" opens a full WebView2 window (real file:// origin) for pages that need
       IndexedDB, service workers or local file access
   Exposed: SL.s31.html = { open(t, root), build(text, ctx), openWindow(t) } */
(function (G) {
  'use strict';
  const SL = G.ChipBench || (G.ChipBench = {}); SL.s31 = SL.s31 || {};
  const dec = new TextDecoder();
  const REMOTE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', ico: 'image/x-icon', bmp: 'image/bmp', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', json: 'application/json', css: 'text/css', js: 'text/javascript' };
  const b64 = u8 => { let s = ''; const CH = 0x8000; for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH)); return btoa(s); };
  const extOf = p => (p.split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
  const safeJs = s => s.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

  const shim = (init, id) => '(function(){try{' +
    'var INIT=' + JSON.stringify(init || {}).replace(/</g, '\\u003c') + ',ID=' + JSON.stringify(id) + ';' +
    'function mk(store,persist){var d=Object.assign({},store);var t=0;function flush(){if(!persist)return;clearTimeout(t);t=setTimeout(function(){try{parent.postMessage({s31:"ls",id:ID,data:d},"*")}catch(e){}},400)}' +
    'var o={getItem:function(k){return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},setItem:function(k,v){d[String(k)]=String(v);flush()},removeItem:function(k){delete d[k];flush()},clear:function(){d={};flush()},key:function(i){return Object.keys(d)[i]||null}};' +
    'Object.defineProperty(o,"length",{get:function(){return Object.keys(d).length}});return new Proxy(o,{get:function(t,k){return k in t?t[k]:(Object.prototype.hasOwnProperty.call(d,k)?d[k]:undefined)},set:function(t,k,v){t.setItem(k,v);return true},has:function(t,k){return k in t||k in d},deleteProperty:function(t,k){t.removeItem(k);return true},ownKeys:function(){return Object.keys(d)},getOwnPropertyDescriptor:function(t,k){return k in d?{value:d[k],enumerable:true,configurable:true}:undefined}})}' +
    'var ls=mk(INIT,true),ss=mk({},false);' +
    'try{Object.defineProperty(window,"localStorage",{get:function(){return ls},configurable:true});Object.defineProperty(window,"sessionStorage",{get:function(){return ss},configurable:true})}catch(e){}' +
    'document.addEventListener("click",function(e){var a=e.target&&e.target.closest&&e.target.closest("a[href]");if(!a)return;var h=a.getAttribute("href")||"";if(/^https?:/i.test(h)||/^mailto:/i.test(h)){e.preventDefault();parent.postMessage({s31:"open",url:a.href},"*")}},true);' +
    'window.addEventListener("error",function(e){try{parent.postMessage({s31:"err",msg:String(e.message||e)},"*")}catch(x){}});' +
    '}catch(e){}})();';

  async function build(text, ctx) {
    const doc = new DOMParser().parseFromString(text, 'text/html'), stats = { inlined: 0, missing: [], remote: 0, scripts: 0, modules: 0 }; let budget = 40 * 1024 * 1024;
    const local = h => { if (!h) return null; h = h.trim(); if (!h || REMOTE.test(h)) { if (/^https?:|^\/\//i.test(h)) stats.remote++; return null; } let p = h.split(/[?#]/)[0]; try { p = decodeURIComponent(p); } catch (e) { } return ctx.resolve(ctx.dir, p); };
    const read = async p => { try { const b = await ctx.readBytes(p); budget -= b.length; return budget < 0 ? null : b; } catch (e) { stats.missing.push(p); return null; } };
    const dataUri = async (rel, max) => { const p = local(rel); if (!p) return null; const b = await read(p); if (!b || (max && b.length > max)) return null; stats.inlined++; return 'data:' + (MIME[extOf(p)] || 'application/octet-stream') + ';base64,' + b64(b); };
    const cssInline = async (css, dir) => {
      const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g, jobs = []; css.replace(re, (m, q, u) => { jobs.push([m, u]); return m; });
      for (const [m, u] of jobs) { if (REMOTE.test(u.trim())) continue; let p; try { p = ctx.resolve(dir, decodeURIComponent(u.split(/[?#]/)[0])); } catch (e) { continue; } const b = await read(p); if (b && b.length < 2.5e6) { stats.inlined++; css = css.split(m).join('url("data:' + (MIME[extOf(p)] || 'application/octet-stream') + ';base64,' + b64(b) + '")'); } }
      return css;
    };
    doc.querySelectorAll('meta[http-equiv]').forEach(m => { if (/content-security-policy/i.test(m.getAttribute('http-equiv'))) m.remove(); });
    for (const l of Array.from(doc.querySelectorAll('link[rel~="stylesheet"][href]'))) { const p = local(l.getAttribute('href')); if (!p) continue; const b = await read(p); if (!b) continue; const st = doc.createElement('style'); st.textContent = await cssInline(dec.decode(b), ctx.resolve(p, '..')); if (l.media) st.media = l.media; l.replaceWith(st); stats.inlined++; }
    for (const l of Array.from(doc.querySelectorAll('link[rel~="icon"],link[rel~="manifest"],link[rel~="preload"],link[rel~="prefetch"]'))) l.remove();
    for (const s of Array.from(doc.querySelectorAll('script'))) {
      stats.scripts++; const src = s.getAttribute('src'); if (s.type === 'module') stats.modules++;
      if (src) { const p = local(src); if (!p) continue; const b = await read(p); if (!b) continue; s.removeAttribute('src'); s.removeAttribute('integrity'); s.removeAttribute('crossorigin'); s.textContent = safeJs(dec.decode(b)); stats.inlined++; }
    }
    for (const el of Array.from(doc.querySelectorAll('img[src],source[src],video[poster],audio[src],input[type=image][src]'))) {
      const a = el.hasAttribute('src') ? 'src' : 'poster', u = await dataUri(el.getAttribute(a), 12e6); if (u) el.setAttribute(a, u); if (el.hasAttribute('srcset')) el.removeAttribute('srcset');
    }
    for (const el of Array.from(doc.querySelectorAll('[style*="url("]'))) el.setAttribute('style', await cssInline(el.getAttribute('style'), ctx.dir));
    for (const st of Array.from(doc.querySelectorAll('style'))) if (/url\(/.test(st.textContent)) st.textContent = await cssInline(st.textContent, ctx.dir);
    const head = doc.head || doc.documentElement.insertBefore(doc.createElement('head'), doc.documentElement.firstChild);
    const sh = doc.createElement('script'); sh.textContent = shim(ctx.ls, ctx.id); head.insertBefore(sh, head.firstChild);
    if (!doc.querySelector('base')) { const bs = doc.createElement('base'); bs.target = '_blank'; head.insertBefore(bs, head.firstChild); }
    if (!doc.querySelector('meta[charset]')) { const m = doc.createElement('meta'); m.setAttribute('charset', 'utf-8'); head.insertBefore(m, head.firstChild); }
    const needsOrigin = /\b(indexedDB|serviceWorker|showOpenFilePicker|showSaveFilePicker|showDirectoryPicker|webkitRequestFileSystem|BroadcastChannel)\b/.test(text);
    return { html: '<!DOCTYPE html>\n' + doc.documentElement.outerHTML, stats, needsOrigin, title: (doc.title || '').trim() };
  }

  async function open(t, root) {
    const h = SL.U.h, fs = SL.fs, U = SL.U, X = SL.X, dirOf = p => U.dir(p);
    const wrap = h('div', { class: 'hv-wrap' }); root.appendChild(wrap); root.style.display = 'flex'; root.style.flexDirection = 'column';
    const tools = h('div', { class: 'view-tools' }), state = h('span', { class: 'hv-state' }); let frame = null, built = null, showSrc = false, srcText = '';
    const mk = (txt, fn, cls) => { const b = h('button', { class: 'btn sm' + (cls ? ' ' + cls : ''), type: 'button' }, txt); b.onclick = fn; tools.appendChild(b); return b; };
    mk('在独立窗口打开（完整功能）', () => openWindow(t), 'primary'); mk('刷新', () => load());
    mk('剪藏为 Markdown', () => SL.web && SL.web.clipHtml && SL.web.clipHtml(srcText, 'file:///' + t.path.replace(/\\/g, '/'), t.name));
    const srcB = mk('源码', () => { showSrc = !showSrc; srcB.classList.toggle('on', showSrc); paint(); });
    mk('系统浏览器', () => SL.invoke('open_path', { path: t.path }).catch(e => SL.toast && SL.toast(String(e), 3500, 'bad')));
    tools.appendChild(state); wrap.appendChild(tools); const note = h('div', { class: 'hv-note hide' }); wrap.appendChild(note); const body = h('div', { style: 'flex:1;min-height:0;display:flex;flex-direction:column' }); wrap.appendChild(body);
    const key = 'html.ls.' + (X.hash ? X.hash(U.pkey(t.path)) : t.path);
    const onMsg = ev => { if (!frame || ev.source !== frame.contentWindow || !ev.data || !ev.data.s31) return; const d = ev.data; if (d.s31 === 'open') { (SL.openExternal || (u => SL.invoke('open_url', { url: u })))(d.url); } else if (d.s31 === 'ls') { try { if (JSON.stringify(d.data || {}).length < 2e6) SL.store.set(key, d.data || {}); } catch (e) { } } else if (d.s31 === 'err') state.textContent = '页面脚本报错：' + String(d.msg).slice(0, 80); };
    window.addEventListener('message', onMsg);
    function paint() {
      body.innerHTML = ''; if (showSrc) { const pre = h('pre', { style: 'margin:0;padding:14px 18px;overflow:auto;flex:1;font:12.5px/1.6 var(--mono);white-space:pre-wrap' }); pre.textContent = srcText; body.appendChild(pre); return; }
      if (!built) return; frame = h('iframe', { class: 'hv-frame', sandbox: 'allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock', title: t.name }); frame.srcdoc = built.html; body.appendChild(frame);
    }
    async function load() {
      state.textContent = '加载中…'; const t0 = performance.now();
      try {
        srcText = (await fs.read(t.path)).text.replace(/^\uFEFF/, ''); const ls = await SL.store.get(key, {});
        built = await build(srcText, { dir: dirOf(t.path), readBytes: p => fs.readBytes(p), resolve: (d, r) => X.resolveRel(d, r), ls, id: t.path });
        const s = built.stats; state.textContent = s.scripts + ' 个脚本 · 内联 ' + s.inlined + ' 个本地资源' + (s.remote ? ' · ' + s.remote + ' 个在线资源' : '') + (s.missing.length ? ' · 缺失 ' + s.missing.length : '') + ' · ' + Math.round(performance.now() - t0) + ' ms';
        const why = []; if (built.needsOrigin) why.push('此页面使用 IndexedDB / Service Worker / 本地文件选择器'); if (s.modules) why.push('含 ES 模块脚本（相对路径 import 无法内联）');
        note.classList.toggle('hide', !why.length); note.innerHTML = why.length ? '<b>建议使用独立窗口</b><span>' + why.join('；') + '，嵌入预览中可能无法工作。</span>' : ''; paint();
      } catch (e) { body.innerHTML = '<div class="empty"><div class="big">无法打开网页</div>' + esc(e.message || e) + '</div>'; }
    }
    t.viewer = { destroy() { window.removeEventListener('message', onMsg); } }; await load();
  }
  async function openWindow(t) {
    const url = 'file:///' + t.path.replace(/\\/g, '/').replace(/^\/+/, '').split('/').map((s, i) => i === 0 && /^[a-z]:$/i.test(s) ? s : encodeURIComponent(s)).join('/');
    try { await SL.invoke('open_web', { url, title: t.name }); } catch (e) { try { await SL.invoke('open_path', { path: t.path }); SL.toast && SL.toast('已用系统浏览器打开（需要 3.1 版 Rust 外壳才能使用内置独立窗口）', 4200); } catch (e2) { SL.toast && SL.toast(String(e2), 4000, 'bad'); } }
  }
  SL.s31.html = { open, build, openWindow };
})(window);
