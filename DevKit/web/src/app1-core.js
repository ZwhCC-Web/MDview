/* ================= MDView 1.0 — part 1: core, native bridge, CodeMirror kernel, rendering ================= */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const VERSION = '1.0.0';
  const IC = n => '<svg class="i"><use href="#i-' + n + '"/></svg>';

  /* ================= Native bridge (Tauri desktop client) ================= */
  const T = window.__TAURI__;
  const NATIVE = !!(T && T.core && T.core.invoke);
  const inv = (c, a) => T.core.invoke(c, a || {});
  const baseName = p => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  const dirName = p => p.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]*$/, '');
  const pSep = p => (p.includes('\\') ? '\\' : '/');
  const pJoin = (d, n) => d.replace(/[\\/]+$/, '') + pSep(d) + n;
  const pNorm = p => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  const isAbs = p => /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\\\');
  function pResolve(base, rel) {
    if (isAbs(rel)) return rel;
    const sep = pSep(base); const parts = base.split(/[\\/]/);
    for (const x of rel.split(/[\\/]/)) { if (x === '..') parts.pop(); else if (x && x !== '.') parts.push(x); }
    return parts.join(sep);
  }
  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon' };
  function b64ToBytes(b) { const s = atob(b); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
  function bytesToB64(buf) { let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); return btoa(s); }
  class NFile {
    constructor(p) { this.kind = 'file'; this.__path = p; this.name = baseName(p); }
    async getFile() {
      const ext = (this.name.split('.').pop() || '').toLowerCase();
      if (MIME[ext]) return new File([b64ToBytes(await inv('read_b64', { path: this.__path }))], this.name, { type: MIME[ext] });
      const r = await inv('read_text', { path: this.__path });
      const f = new File([r.text], this.name, { type: 'text/plain' }); f.__text = r.text; f.__enc = r.encoding; return f;
    }
    async createWritable(opts) {
      const p = this.__path, parts = [], enc = opts && opts.encoding;
      return {
        write: async d => { parts.push(d); },
        close: async () => {
          if (parts.every(x => typeof x === 'string')) await inv('write_text', { path: p, content: parts.join(''), encoding: enc || null });
          else await inv('write_b64', { path: p, data: bytesToB64(new Uint8Array(await new Blob(parts).arrayBuffer())) });
        }
      };
    }
    async queryPermission() { return 'granted'; } async requestPermission() { return 'granted'; }
    async isSameEntry(o) { return !!(o && o.__path) && pNorm(o.__path) === pNorm(this.__path); }
    async move(n) { const np = pJoin(dirName(this.__path), n); await inv('rename_path', { from: this.__path, to: np }); this.__path = np; this.name = n; }
  }
  class NDir {
    constructor(p) { this.kind = 'directory'; this.__path = p; this.name = baseName(p) || p; }
    async *entries() { const list = await inv('list_dir', { path: this.__path }); for (const e of list) yield [e.name, e.is_dir ? new NDir(e.path) : new NFile(e.path)]; }
    async getDirectoryHandle(n, o) { const p = pJoin(this.__path, n); if (o && o.create) await inv('make_dir', { path: p }); else if ((await inv('path_kind', { path: p })) !== 'dir') throw new Error('找不到文件夹 ' + n); return new NDir(p); }
    async getFileHandle(n, o) { const p = pJoin(this.__path, n); if ((await inv('path_kind', { path: p })) !== 'file') { if (o && o.create) await inv('write_text', { path: p, content: '', encoding: null }); else throw new Error('找不到文件 ' + n); } return new NFile(p); }
    async removeEntry(n, o) { await inv('remove_path', { path: pJoin(this.__path, n), recursive: !!(o && o.recursive) }); }
    async resolve(h) { if (!h || !h.__path) return null; return relFromRoot(this.__path, h.__path); }
    async queryPermission() { return 'granted'; } async requestPermission() { return 'granted'; }
    async isSameEntry(o) { return !!(o && o.__path) && pNorm(o.__path) === pNorm(this.__path); }
    async move(n) { const np = pJoin(dirName(this.__path), n); await inv('rename_path', { from: this.__path, to: np }); this.__path = np; this.name = n; }
  }
  function relFromRoot(root, p) { const a = pNorm(root) + '\\', b = pNorm(p); if (!b.startsWith(a)) return null; return p.slice(root.replace(/[\\/]+$/, '').length + 1).split(/[\\/]/); }
  const abortErr = () => new DOMException('cancelled', 'AbortError');
  if (NATIVE) {
    document.body.classList.add('native');
    window.showOpenFilePicker = async o => { const ps = await inv('pick_files', { multiple: !!(o && o.multiple) }); if (!ps || !ps.length) throw abortErr(); return ps.map(p => new NFile(p)); };
    window.showDirectoryPicker = async () => { const p = await inv('pick_folder'); if (!p) throw abortErr(); return new NDir(p); };
    window.showSaveFilePicker = async o => { const p = await inv('save_dialog', { name: (o && o.suggestedName) || '未命名.md', filter: 'Markdown', ext: 'md' }); if (!p) throw abortErr(); return new NFile(p); };
  }
  const packH = h => (h && h.__path ? { __np: h.__path, kind: h.kind } : h || null);
  const unpackH = h => (h && h.__np ? (h.kind === 'directory' ? new NDir(h.__np) : new NFile(h.__np)) : h || null);

  const app = $('#app'), write = $('#write'), writeScroll = $('#write-scroll'), sourceWrap = $('#source-wrap'),
    preview = $('#preview'), previewScroll = $('#preview-scroll');
  const LS = 'mdview.';

  /* ================= State ================= */
  let _src = '', srcStale = false;
  const S = {
    fileHandle: null, fileName: '未命名.md', filePath: null, dirty: false, history: [], future: [], enc: 'UTF-8', ver: 0,
    tabs: [], cur: -1, tid: 0, dirHandle: null, treeFiles: [], treeNodes: [], treeImages: [],
    mode: 'live', editing: null, result: null, focus: false, typewriter: false,
    imgCache: new Map(), mermaidCache: new Map(), htmlOf: new WeakMap(), mtime: {}
  };
  // S.src is lazy while the CodeMirror source editor is active: reading it materialises the document once
  Object.defineProperty(S, 'src', {
    get() { if (srcStale && srcEd) { _src = srcEd.value; srcStale = false; } return _src; },
    set(v) { _src = v; srcStale = false; }
  });
  const prefs = Object.assign({ theme: 'github', userTheme: '', size: 16, width: 860, lh: 1.72, autosave: false, spell: false, side: true, cdn: 'auto', codeLines: false, srcLines: false, autoPair: true, tableFmt: true, richPaste: true, autoNum: false, slash: true, goal: 0, imgMax: 1920, histKeep: 30 }, JSON.parse(localStorage.getItem(LS + 'prefs') || '{}'));
  const savePrefs = () => localStorage.setItem(LS + 'prefs', JSON.stringify(prefs));
  const hasFS = 'showOpenFilePicker' in window;

  /* ================= Utils ================= */
  let toastT;
  function toast(msg, ms) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms || 2000); }
  const debounce = (fn, ms) => { let t; const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; f.cancel = () => clearTimeout(t); return f; };
  const idle = window.requestIdleCallback ? (f => requestIdleCallback(f, { timeout: 500 })) : (f => setTimeout(f, 30));
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pad2 = n => String(n).padStart(2, '0');
  const today = (d = new Date()) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  function download(name, content, type) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type })); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  /* save text or binary through native dialog (desktop) or browser download (web). returns the path / name */
  async function saveOut(name, content, ext, label, mime) {
    if (NATIVE) {
      const p = await inv('save_dialog', { name, filter: label, ext }); if (!p) return null;
      if (typeof content === 'string') await inv('write_text', { path: p, content, encoding: null });
      else await inv('write_b64', { path: p, data: bytesToB64(content instanceof Uint8Array ? content : new Uint8Array(await content.arrayBuffer())) });
      toast('已导出 ' + baseName(p)); return p;
    }
    download(name, content, mime || 'application/octet-stream'); toast('已导出 ' + name); return name;
  }
  /* single pass word / character count (CJK char = 1 word, latin runs = 1 word; fenced code is skipped for words) */
  function countWords(s) {
    let words = 0, chars = 0, inWord = false, fence = false, bol = true, lead = 0;
    for (let i = 0, n = s.length; i < n; i++) {
      const c = s.charCodeAt(i);
      if (c === 10) { bol = true; lead = 0; inWord = false; continue; }
      if (bol) { if (c === 32 && lead < 3) { lead++; continue; } bol = false; if ((c === 96 || c === 126) && s.charCodeAt(i + 1) === c && s.charCodeAt(i + 2) === c) { fence = !fence; } }
      if (c === 32 || c === 9 || c === 13 || c === 0x3000) { inWord = false; continue; }
      chars++;
      if (fence) continue;
      if ((c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3040 && c <= 0x30FF) || (c >= 0xAC00 && c <= 0xD7AF)) { words++; inWord = false; }
      else if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 0xC0 && c <= 0x24F) || ((c === 39 || c === 0x2019) && inWord)) { if (!inWord) { words++; inWord = true; } }
      else inWord = false;
    }
    return { words, chars };
  }
  const dispW = s => { let w = 0; for (const ch of s) w += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]|[\u{1f300}-\u{1faff}]/u.test(ch) ? 2 : 1; return w; };
  function openExternal(url) { if (NATIVE) inv('open_url', { url }).catch(e => toast('无法打开链接: ' + e)); else window.open(url, '_blank'); }
  function lineOfPos(v, p) { let n = 0, i = -1; while ((i = v.indexOf('\n', i + 1)) !== -1 && i < p) n++; return n; }

  function decodeBytes(buf) {
    const u = new Uint8Array(buf);
    if (u[0] === 0xEF && u[1] === 0xBB && u[2] === 0xBF) return { text: new TextDecoder('utf-8').decode(u.subarray(3)), encoding: 'UTF-8' };
    if (u[0] === 0xFF && u[1] === 0xFE) return { text: new TextDecoder('utf-16le').decode(u.subarray(2)), encoding: 'UTF-16LE' };
    if (u[0] === 0xFE && u[1] === 0xFF) return { text: new TextDecoder('utf-16be').decode(u.subarray(2)), encoding: 'UTF-16BE' };
    try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(u), encoding: 'UTF-8' }; } catch (e) { }
    const tryDec = enc => { try { return new TextDecoder(enc, { fatal: true }).decode(u); } catch (e) { return null; } };
    const sj = tryDec('shift_jis'), gb = tryDec('gb18030');
    const kana = t => (t.match(/[\u3040-\u30ff]/g) || []).length;
    if (sj && (!gb || kana(sj) > kana(gb) + 3)) return { text: sj, encoding: 'Shift_JIS' };
    if (gb) return { text: gb, encoding: 'GBK' };
    const b5 = tryDec('big5'); if (b5) return { text: b5, encoding: 'Big5' };
    return { text: new TextDecoder('utf-8').decode(u), encoding: 'UTF-8' };
  }
  async function readFileText(f) { if (f.__text != null) return { text: f.__text, encoding: f.__enc || 'UTF-8' }; return decodeBytes(await f.arrayBuffer()); }

  const idb = (() => {
    let dbp = null;
    const open = () => dbp || (dbp = new Promise((res, rej) => { const r = indexedDB.open('mdview', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
    const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction('kv', mode); const r = fn(t.objectStore('kv')); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); }); };
    return { get: k => tx('readonly', s => s.get(k)).catch(() => null), set: (k, v) => tx('readwrite', s => s.put(v, k)).catch(() => null), del: k => tx('readwrite', s => s.delete(k)).catch(() => null) };
  })();

  /* ================= Render libraries (KaTeX / Mermaid / WaveDrom) ================= */
  const CDNS = {
    local: { katexJs: 'lib/katex/katex.min.js', katexCss: 'lib/katex/katex.min.css', mermaid: 'lib/mermaid/mermaid.min.js', wdSkin: 'lib/wavedrom/default.js', wd: 'lib/wavedrom/wavedrom.min.js' },
    jsdelivr: { katexJs: 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js', katexCss: 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css', mermaid: 'https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js', wdSkin: 'https://cdn.jsdelivr.net/npm/wavedrom@3.5.0/skins/default.js', wd: 'https://cdn.jsdelivr.net/npm/wavedrom@3.5.0/wavedrom.min.js' },
    npmmirror: { katexJs: 'https://registry.npmmirror.com/katex/0.16.11/files/dist/katex.min.js', katexCss: 'https://registry.npmmirror.com/katex/0.16.11/files/dist/katex.min.css', mermaid: 'https://registry.npmmirror.com/mermaid/10.9.1/files/dist/mermaid.min.js', wdSkin: 'https://registry.npmmirror.com/wavedrom/3.5.0/files/skins/default.js', wd: 'https://registry.npmmirror.com/wavedrom/3.5.0/files/wavedrom.min.js' },
    unpkg: { katexJs: 'https://unpkg.com/katex@0.16.11/dist/katex.min.js', katexCss: 'https://unpkg.com/katex@0.16.11/dist/katex.min.css', mermaid: 'https://unpkg.com/mermaid@10.9.1/dist/mermaid.min.js', wdSkin: 'https://unpkg.com/wavedrom@3.5.0/skins/default.js', wd: 'https://unpkg.com/wavedrom@3.5.0/wavedrom.min.js' }
  };
  function loadScript(url, ms) {
    return new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = url; s.async = true;
      const t = setTimeout(() => { s.remove(); rej(new Error('timeout')); }, ms || 8000);
      s.onload = () => { clearTimeout(t); res(); }; s.onerror = () => { clearTimeout(t); s.remove(); rej(new Error('fail')); };
      document.head.appendChild(s);
    });
  }
  function loadCss(url) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = url; document.head.appendChild(l); }
  const libState = { katex: 'none', mermaid: 'none', wavedrom: 'none' };
  const cdnOrder = () => prefs.cdn === 'auto' ? ['local', 'jsdelivr', 'npmmirror', 'unpkg'] : ['local', prefs.cdn];
  async function loadKatex() {
    if (window.katex) return;
    for (const k of cdnOrder()) { try { await loadScript(CDNS[k].katexJs, k === 'local' ? 3000 : 6000); loadCss(CDNS[k].katexCss); libState.katex = k; break; } catch (e) { } }
    if (window.katex) { MD.clearCache(); S.result = null; rerender(true); }
    updateStatus();
  }
  async function loadMermaid() {
    if (window.mermaid || libState.mermaid === 'loading' || libState.mermaid === 'fail') return;
    libState.mermaid = 'loading';
    for (const k of cdnOrder()) { try { await loadScript(CDNS[k].mermaid, 10000); libState.mermaid = k; break; } catch (e) { } }
    if (window.mermaid) { initMermaid(); runDiagrams(S.mode === 'live' ? write : preview); } else libState.mermaid = 'fail';
    updateStatus();
  }
  async function loadWaveDrom() {
    if (window.WaveDrom || libState.wavedrom === 'loading' || libState.wavedrom === 'fail') return;
    libState.wavedrom = 'loading';
    for (const k of cdnOrder()) { try { await loadScript(CDNS[k].wdSkin, 6000); await loadScript(CDNS[k].wd, 8000); libState.wavedrom = k; break; } catch (e) { } }
    if (window.WaveDrom) runDiagrams(S.mode === 'live' ? write : preview); else libState.wavedrom = 'fail';
  }
  const isDark = () => ['night', 'dracula'].includes(prefs.theme);
  function initMermaid() { if (window.mermaid) try { window.mermaid.initialize({ startOnLoad: false, theme: isDark() ? 'dark' : 'default', securityLevel: 'loose', flowchart: { htmlLabels: false } }); } catch (e) { } }
  let wdSeq = 0;
  async function runDiagrams(root) {
    const nodes = Array.from(root.querySelectorAll('.mermaid:not([data-processed])'));
    if (nodes.length) {
      const theme = isDark() ? 'd' : 'l';
      const todo = [];
      for (const n of nodes) { const c = S.mermaidCache.get(theme + n.dataset.code); if (c) { n.innerHTML = c; n.setAttribute('data-processed', 'true'); } else todo.push(n); }
      if (todo.length) {
        if (!window.mermaid) loadMermaid();
        else { try { await window.mermaid.run({ nodes: todo, suppressErrors: true }); } catch (e) { } todo.forEach(n => { if (n.querySelector('svg')) S.mermaidCache.set(theme + n.dataset.code, n.innerHTML); }); }
      }
    }
    const wds = Array.from(root.querySelectorAll('.wavedrom:not([data-processed])'));
    if (wds.length) {
      if (!window.WaveDrom) { loadWaveDrom(); return; }
      for (const n of wds) {
        const k = 'w' + n.dataset.code; const c = S.mermaidCache.get(k);
        if (c) { n.innerHTML = c; n.setAttribute('data-processed', 'true'); continue; }
        try {
          const obj = Function('"use strict";return (' + n.dataset.code + ')')();
          const id = ++wdSeq; n.innerHTML = '<div id="WaveDrom_Display_' + id + '"></div>';
          window.WaveDrom.RenderWaveForm(id, obj, 'WaveDrom_Display_');
          n.setAttribute('data-processed', 'true'); S.mermaidCache.set(k, n.innerHTML);
        } catch (e) { n.title = 'WaveDrom 解析失败: ' + e.message; }
      }
    }
  }

  /* ================= CodeMirror 6 kernel ================= */
  /* The CodeMirror ES-module chunks are embedded as JSON; an import map routes "cm/…" to blob URLs. */
  const CMK = { ok: false, failed: false, api: null };
  let cmPromise = null;
  function loadCM() {
    if (cmPromise) return cmPromise;
    cmPromise = (async () => {
      if (window.__MDV_NOCM) throw new Error('disabled');
      const el = document.getElementById('cm-chunks'); if (!el || !window.__CM_META) throw new Error('no bundle');
      const chunks = JSON.parse(el.textContent); el.textContent = '';
      const im = { imports: {} };
      for (const k in chunks) im.imports['cm/' + k] = URL.createObjectURL(new Blob([chunks[k]], { type: 'text/javascript' }));
      const s = document.createElement('script'); s.type = 'importmap'; s.textContent = JSON.stringify(im); document.head.appendChild(s);
      const cm = await import('cm/index.js'); const core = await import('cm/' + __CM_META.core); const mdm = await import('cm/' + __CM_META.md);
      let tags = null; for (const k in core) { const v = core[k]; if (v && typeof v === 'object' && v.heading && v.strong && v.emphasis && v.monospace) { tags = v; break; } }
      if (!tags || !mdm.markdown || !mdm.markdownLanguage) throw new Error('bundle mismatch');
      CMK.api = buildCM(cm, tags, mdm); CMK.ok = true; updateStatus();
      return CMK.api;
    })().catch(e => { CMK.failed = true; console.warn('CodeMirror unavailable, using textarea fallback:', e); updateStatus(); return null; });
    return cmPromise;
  }
  function buildCM(cm, t, mdm) {
    const avail = new Set((__CM_META.langs || []).map(x => x.toLowerCase()));
    const ALIAS = { js: 'javascript', ts: 'typescript', py: 'python', sh: 'shell', bash: 'shell', h: 'c', hpp: 'c++', cpp: 'c++', cs: 'c#', yml: 'yaml', md: 'markdown', ps1: 'powershell', rs: 'rust', golang: 'go', v: 'verilog', sv: 'verilog', vhd: 'vhdl', m: 'octave', matlab: 'octave', tex: 'latex', kt: 'kotlin', rb: 'ruby', html: 'html', xml: 'xml' };
    const codeLanguages = info => {
      const n = (ALIAS[(info || '').toLowerCase()] || (info || '').toLowerCase());
      const d = cm.LanguageDescription.matchLanguageName(cm.languages, n, true);
      return d && avail.has(d.name.toLowerCase()) ? d : null;
    };
    const mdSupport = () => mdm.markdown({ base: mdm.markdownLanguage, codeLanguages, addKeymap: false });
    const hl = cm.HighlightStyle.define([
      { tag: t.heading, fontWeight: '700', color: 'var(--hl-head)' },
      { tag: t.emphasis, fontStyle: 'italic' }, { tag: t.strong, fontWeight: '700' },
      { tag: t.strikethrough, textDecoration: 'line-through' },
      { tag: t.link, color: 'var(--hl-link)' }, { tag: t.url, color: 'var(--hl-link)', textDecoration: 'underline' },
      { tag: t.monospace, color: 'var(--hl-code)' }, { tag: t.quote, color: 'var(--hl-quote)' },
      { tag: [t.processingInstruction, t.contentSeparator, t.labelName], color: 'var(--hl-mark)' },
      { tag: t.meta, color: 'var(--hl-mark)' },
      { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.modifier], color: 'var(--tk-kw)' },
      { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--tk-str)' },
      { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--tk-num)' },
      { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--tk-com)', fontStyle: 'italic' },
      { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--tk-fn)' },
      { tag: [t.typeName, t.className, t.namespace], color: 'var(--tk-type)' },
      { tag: [t.operator, t.punctuation, t.bracket], color: 'var(--tk-op)' },
      { tag: [t.tagName], color: 'var(--tk-tag)' }, { tag: [t.attributeName, t.propertyName], color: 'var(--tk-attr)' },
      { tag: t.invalid, color: 'var(--danger)' }
    ]);
    // extra inline syntax not covered by GFM: [[wiki]], ==mark==, $math$
    const deco = (re, cls) => {
      const md = new cm.MatchDecorator({ regexp: re, decoration: cm.Decoration.mark({ class: cls }) });
      return cm.ViewPlugin.fromClass(class { constructor(v) { this.decorations = md.createDeco(v); } update(u) { this.decorations = md.updateDeco(u, this.decorations); } }, { decorations: v => v.decorations });
    };
    const extras = [deco(/\[\[[^\[\]\n]+\]\]/g, 'cm-wiki'), deco(/==(?=\S)[^=\n]+?==/g, 'cm-mark'), deco(/(?<![\\$])\$(?!\s)[^$\n]+?\$/g, 'cm-math')];
    // search highlight (used by the app's find bar)
    const setHits = cm.StateEffect.define();
    const hitField = cm.StateField.define({
      create: () => cm.Decoration.none,
      update(v, tr) { v = v.map(tr.changes); for (const e of tr.effects) if (e.is(setHits)) v = e.value; return v; },
      provide: f => cm.EditorView.decorations.from(f)
    });
    function setSearchHits(view, ranges, cur) {
      const b = new cm.RangeSetBuilder();
      ranges.slice(0, 20000).forEach(([a, z], i) => { if (z > a) b.add(a, z, cm.Decoration.mark({ class: 'cm-searchhit' + (i === cur ? ' cur' : '') })); });
      view.dispatch({ effects: setHits.of(b.finish()) });
    }
    const theme = cm.EditorView.theme({ '&': { backgroundColor: 'transparent' }, '.cm-scroller': { overflowX: 'hidden' } });

    function create(o) {
      const lnComp = new cm.Compartment(), spellComp = new cm.Compartment();
      const ext = [
        mdSupport(), cm.syntaxHighlighting(hl), cm.syntaxHighlighting(cm.defaultHighlightStyle, { fallback: true }), extras, hitField, theme,
        cm.history(), cm.drawSelection(), cm.dropCursor(), cm.EditorState.allowMultipleSelections.of(true), cm.rectangularSelection(), cm.crosshairCursor(),
        cm.indentOnInput(), cm.bracketMatching(), cm.highlightSpecialChars(), cm.EditorView.lineWrapping, cm.indentUnit.of('    '),
        lnComp.of(o.lineNumbers ? [cm.lineNumbers(), cm.highlightActiveLineGutter()] : []),
        spellComp.of(cm.EditorView.contentAttributes.of({ spellcheck: o.spell ? 'true' : 'false', autocorrect: 'off', autocapitalize: 'off' })),
        cm.Prec.highest(cm.EditorView.domEventHandlers({
          keydown: (e, v) => { if (o.onKey) o.onKey(e); return e.defaultPrevented; },
          paste: (e, v) => { if (o.onPaste) o.onPaste(e); return e.defaultPrevented; },
          blur: () => { if (o.onBlur) o.onBlur(); return false; },
          focus: () => { if (o.onFocus) o.onFocus(); return false; },
          mouseup: () => { if (o.onMouseUp) setTimeout(o.onMouseUp, 0); return false; }
        })),
        cm.keymap.of([
          { key: 'Mod-z', run: v => cm.undo(v) || (o.onUndoEmpty ? (o.onUndoEmpty(), true) : false), preventDefault: true },
          { key: 'Mod-y', run: cm.redo, preventDefault: true }, { key: 'Mod-Shift-z', run: cm.redo, preventDefault: true },
          ...cm.defaultKeymap.filter(k => !['Mod-Enter', 'Mod-/', 'Mod-[', 'Mod-]', 'Mod-i', 'Alt-A', 'Shift-Alt-a'].includes(k.key))
        ]),
        cm.EditorView.updateListener.of(u => { if (u.docChanged && o.onChange) o.onChange(u); if (u.selectionSet && !u.docChanged && o.onSelect) o.onSelect(u); })
      ];
      if (o.kind === 'source') ext.push(cm.highlightActiveLine(), cm.EditorView.editorAttributes.of({ class: 'cm-src' }));
      const view = new cm.EditorView({ state: cm.EditorState.create({ doc: o.doc || '', extensions: ext }), parent: o.parent });
      const ed = new CMEd(view, cm);
      ed.setLineNumbers = on => { view.dispatch({ effects: lnComp.reconfigure(on ? [cm.lineNumbers(), cm.highlightActiveLineGutter()] : []) }); view.dom.classList.toggle('with-ln', !!on); };
      ed.setSpell = on => view.dispatch({ effects: spellComp.reconfigure(cm.EditorView.contentAttributes.of({ spellcheck: on ? 'true' : 'false' })) });
      ed.newState = doc => { view.setState(cm.EditorState.create({ doc, extensions: ext })); };
      ed.setHits = (r, c) => setSearchHits(view, r, c);
      if (o.lineNumbers) view.dom.classList.add('with-ln');
      return ed;
    }
    return { cm, create, syntaxTree: cm.syntaxTree };
  }
  /* textarea-like facade over a CodeMirror view, so that editing helpers work on both */
  class CMEd {
    constructor(view, cm) { this.view = view; this.cmm = cm; this.cm = true; }
    get value() { return this.view.state.doc.toString(); }
    set value(v) { const d = this.view.state.doc; this.view.dispatch({ changes: { from: 0, to: d.length, insert: v }, selection: { anchor: Math.min(v.length, this.view.state.selection.main.head) } }); }
    get length() { return this.view.state.doc.length; }
    get selectionStart() { return this.view.state.selection.main.from; }
    get selectionEnd() { return this.view.state.selection.main.to; }
    slice(a, b) { const L = this.length; return this.view.state.sliceDoc(Math.max(0, a), Math.min(L, b == null ? L : b)); }
    setSelectionRange(a, b, center) { const L = this.length; a = Math.max(0, Math.min(a, L)); b = Math.max(0, Math.min(b == null ? a : b, L)); this.view.dispatch({ selection: { anchor: a, head: b }, effects: this.cmm.EditorView.scrollIntoView(b, { y: center ? 'center' : 'nearest', yMargin: 40 }) }); }
    select() { this.view.dispatch({ selection: { anchor: 0, head: this.length } }); }
    insertText(t) { const v = this.view; v.dispatch(v.state.replaceSelection(t), { userEvent: 'input.type', scrollIntoView: true }); }
    replaceRange(a, b, t, selA, selB) { this.view.dispatch({ changes: { from: a, to: b, insert: t }, selection: selA != null ? { anchor: selA, head: selB == null ? selA : selB } : undefined, scrollIntoView: true, userEvent: 'input' }); }
    focus() { this.view.focus(); }
    hasFocus() { return this.view.hasFocus; }
    getBoundingClientRect() { return this.view.dom.getBoundingClientRect(); }
    dispatchEvent() { }
    lineAt(pos) { const l = this.view.state.doc.lineAt(pos); return { from: l.from, to: l.to, text: l.text, n: l.number - 1 }; }
    line(n) { const d = this.view.state.doc; const l = d.line(Math.max(1, Math.min(d.lines, n + 1))); return { from: l.from, to: l.to, text: l.text, n: l.number - 1 }; }
    get lines() { return this.view.state.doc.lines; }
    scrollToPos(pos, y) { this.view.dispatch({ effects: this.cmm.EditorView.scrollIntoView(pos, { y: y || 'center' }) }); }
    destroy() { this.view.destroy(); }
  }
  /* ---- editor-agnostic helpers (textarea or CMEd) ---- */
  const edFocused = ed => ed && (ed.cm ? ed.view.hasFocus : document.activeElement === ed);
  const edSlice = (ed, a, b) => ed.cm ? ed.slice(a, b) : ed.value.slice(Math.max(0, a), b);
  const edLen = ed => ed.cm ? ed.length : ed.value.length;
  function insText(ed, t) {
    if (ed.cm) return ed.insertText(t);
    if (!document.execCommand('insertText', false, t)) {
      const s = ed.selectionStart, e = ed.selectionEnd; ed.value = ed.value.slice(0, s) + t + ed.value.slice(e);
      ed.setSelectionRange(s + t.length, s + t.length); ed.dispatchEvent(new Event('input'));
    }
  }
  function edReplace(ed, a, b, t, selA, selB) {
    if (ed.cm) return ed.replaceRange(a, b, t, selA, selB);
    ed.setSelectionRange(a, b); insText(ed, t); if (selA != null) ed.setSelectionRange(selA, selB == null ? selA : selB);
  }
  function lineCtx(ed) {
    const p = ed.selectionStart;
    if (ed.cm) { const l = ed.lineAt(p); return { ls: l.from, le: l.to, line: l.text, before: l.text.slice(0, p - l.from), p, n: l.n }; }
    const v = ed.value; const ls = v.lastIndexOf('\n', p - 1) + 1; let le = v.indexOf('\n', p); if (le < 0) le = v.length;
    return { ls, le, line: v.slice(ls, le), before: v.slice(ls, p), p, n: lineOfPos(v, p) };
  }
  function edInFence(ed, pos) {
    if (ed.cm && CMK.api) {
      let n = CMK.api.syntaxTree(ed.view.state).resolveInner(pos, -1);
      for (; n; n = n.parent) if (n.name === 'FencedCode' || n.name === 'CodeBlock') return true;
      return false;
    }
    return ((edSlice(ed, 0, pos).match(/^\s*(```|~~~)/gm) || []).length % 2) === 1;
  }
  /* caret rectangle in viewport coordinates */
  function caretXY(ta, pos) {
    const m = document.createElement('div'); const cs = getComputedStyle(ta);
    ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'paddingLeft', 'paddingRight', 'paddingTop', 'borderLeftWidth', 'borderLeftStyle', 'letterSpacing', 'tabSize', 'boxSizing'].forEach(p => m.style[p] = cs[p]);
    Object.assign(m.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'pre-wrap', wordWrap: 'break-word', overflowWrap: 'break-word', width: ta.clientWidth + 'px', top: '0', left: '-9999px' });
    m.textContent = ta.value.slice(0, pos); const sp = document.createElement('span'); sp.textContent = '\u200b'; m.appendChild(sp);
    document.body.appendChild(m); const r = { x: sp.offsetLeft, y: sp.offsetTop, h: sp.offsetHeight }; m.remove(); return r;
  }
  function caretRect(ed, pos) {
    if (ed.cm) {
      const r = ed.view.coordsAtPos(pos) || ed.view.coordsAtPos(Math.max(0, pos - 1));
      if (r) return { left: r.left, top: r.top, bottom: r.bottom };
      const b = ed.view.contentDOM.getBoundingClientRect(); return { left: b.left, top: b.top, bottom: b.top + 20 };
    }
    const c = caretXY(ed, pos), r = ed.getBoundingClientRect();
    return { left: r.left + c.x, top: r.top + c.y - ed.scrollTop, bottom: r.top + c.y - ed.scrollTop + c.h };
  }

  /* ================= Rendering (live / preview) ================= */
  const fnHost = document.createElement('div'); fnHost.id = 'fn-host';
  const addZone = document.createElement('div'); addZone.className = 'add-zone'; addZone.title = '单击在末尾添加段落';
  let io = null;
  if ('IntersectionObserver' in window) io = new IntersectionObserver(ents => { for (const e of ents) if (e.isIntersecting) { io.unobserve(e.target); enhance(e.target); } }, { root: writeScroll, rootMargin: '800px 0px' });
  function enhance(root) { runDiagrams(root); resolveImages(root); markDue(root); }
  const needsEnhance = h => h.includes('class="mermaid"') || h.includes('class="wavedrom"') || h.includes('<img') || h.includes('class="due"');
  function markDue(root) {
    const td = today();
    root.querySelectorAll('.due[data-due]').forEach(el => { const d = el.dataset.due, done = el.closest('.task-item.done'); el.classList.toggle('over', !done && d < td); el.classList.toggle('today', !done && d === td); });
  }
  function blockHtml(b) { return b.html || '<div class="def-src" style="color:var(--muted);font-size:.85em;font-family:var(--mono);white-space:pre-wrap">' + esc(b.src) + '</div>'; }
  function makeBlk(h) { const el = document.createElement('div'); el.className = 'blk'; el.innerHTML = h; S.htmlOf.set(el, h); return el; }
  /* Live view DOM: blocks are grouped into .grp containers (≈GROUP blocks each). content-visibility is applied
     per group, so the browser tracks ~n/40 boxes instead of n when skipping off-screen content. */
  const GROUP = 40;
  const allBlks = () => Array.from(write.querySelectorAll(':scope > .grp > .blk'));
  function newGroup(before) { const g = document.createElement('div'); g.className = 'grp'; write.insertBefore(g, before || fnHost); return g; }
  function renderLive() {
    const r = S.result = MD.render(S.src, { prev: S.result });
    if (!fnHost.isConnected || !addZone.isConnected) write.replaceChildren(fnHost, addZone);
    const hint = write.querySelector('.empty-hint');
    if (!S.src.trim()) {
      for (const el of Array.from(write.children)) if (el !== fnHost && el !== addZone) el.remove();
      const h = document.createElement('div'); h.className = 'empty-hint';
      h.innerHTML = '<div class="big">开始写作</div>单击此处输入 · 行首输入 <kbd>/</kbd> 插入任意元素<br><kbd>Ctrl</kbd>+<kbd>O</kbd> 打开文件 · <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd> 打开文件夹 · <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>N</kbd> 从模板新建<br><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> 命令面板 · <kbd>Ctrl</kbd>+<kbd>J</kbd> AI 助手 · <kbd>F1</kbd> 快捷键';
      write.insertBefore(h, fnHost); fnHost.innerHTML = ''; updateOutline(); updateImgBanner(); return;
    }
    if (hint) hint.remove();
    // stray editing holders / loose blocks (e.g. an inserted paragraph) are folded back into the flow
    for (const el of Array.from(write.children)) if (el.classList.contains('blk')) { const g = el.previousElementSibling && el.previousElementSibling.classList.contains('grp') ? el.previousElementSibling : newGroup(el); g.appendChild(el); }
    const old = allBlks();
    const hs = r.blocks.map(blockHtml);
    const fresh = [];
    let p = 0; while (p < old.length && p < hs.length && S.htmlOf.get(old[p]) === hs[p]) p++;
    let so = old.length, sn = hs.length;
    while (so > p && sn > p && S.htmlOf.get(old[so - 1]) === hs[sn - 1]) { so--; sn--; }
    const pool = new Map();
    for (let k = p; k < so; k++) { const h = S.htmlOf.get(old[k]); if (h == null) continue; if (!pool.has(h)) pool.set(h, []); pool.get(h).push(old[k]); }
    const mid = [];
    for (let k = p; k < sn; k++) { let el = pool.get(hs[k]) && pool.get(hs[k]).shift(); if (!el) { el = makeBlk(hs[k]); fresh.push(el); } mid.push(el); }
    const keep = new Set(mid);
    const anchor = so < old.length ? old[so] : null;
    const prevEl = p > 0 ? old[p - 1] : null;
    for (let k = p; k < so; k++) if (!keep.has(old[k])) old[k].remove();
    if (mid.length) {
      if (anchor) { const par = anchor.parentNode; for (const el of mid) par.insertBefore(el, anchor); }
      else if (prevEl && prevEl.isConnected) { let g = prevEl.parentNode; for (const el of mid) { if (g.childElementCount >= GROUP) g = newGroup(g.nextSibling && g.nextSibling !== fnHost ? g.nextSibling : fnHost); g.appendChild(el); } }
      else { let g = write.querySelector(':scope > .grp') || newGroup(); for (const el of mid) { if (g.childElementCount >= GROUP) g = newGroup(g.nextElementSibling && g.nextElementSibling.classList.contains('grp') ? g.nextElementSibling : fnHost); g.appendChild(el); } }
    }
    // rebalance: drop empty groups, split oversized ones
    for (const g of Array.from(write.querySelectorAll(':scope > .grp'))) {
      if (!g.childElementCount) { g.remove(); continue; }
      while (g.childElementCount > GROUP * 2) { const ng = document.createElement('div'); ng.className = 'grp'; g.after(ng); const kids = Array.from(g.children).slice(GROUP); ng.append(...kids); }
    }
    const all = old.slice(0, p).concat(mid, old.slice(so));
    for (let i = p; i < all.length; i++) { const el = all[i]; const si = String(i); if (el.dataset.i !== si) el.dataset.i = si; if (i < sn) { el.dataset.t = r.blocks[i].type; el.classList.remove('editing'); } }
    if (fnHost.innerHTML !== r.footnotes) fnHost.innerHTML = r.footnotes;
    for (const el of fresh) { const h = S.htmlOf.get(el); if (!needsEnhance(h)) continue; if (io) io.observe(el); else enhance(el); }
    updateOutline(); updateImgBanner();
  }
  function renderPreview() {
    const r = S.result = MD.render(S.src, { prev: S.result });
    preview.innerHTML = r.blocks.map(b => '<div class="pb" data-s="' + b.start + '">' + (b.html || '') + '</div>').join('') + r.footnotes;
    enhance(preview);
    updateOutline();
  }
  function rerender(force) {
    if (force) for (const el of write.querySelectorAll('.blk')) S.htmlOf.delete(el);
    if (S.mode === 'live') { if (!S.editing) renderLive(); }
    else if (S.mode === 'split') renderPreview();
    else { S.result = MD.render(S.src, { prev: S.result }); updateOutline(); }
  }

  /* ================= Images ================= */
  /* data-src may be: relative path (a/b.png, ./a b.png, ..\x.png), absolute Windows/Unix path, file:/// URI */
  function normImgSrc(src) {
    let s = src.trim();
    try { s = decodeURIComponent(s); } catch (e) { }
    s = s.split(/[?#]/)[0];
    if (/^file:\/\//i.test(s)) { s = s.replace(/^file:\/\/\/?/i, ''); if (/^[a-zA-Z]:/.test(s)) s = s.replace(/\//g, '\\'); else s = '/' + s; }
    return s;
  }
  const canResolveRel = () => (S.dirHandle && S.filePath) || (NATIVE && S.fileHandle && S.fileHandle.__path);
  async function relFileHandle(rel) {
    const p = normImgSrc(rel);
    if (NATIVE && (isAbs(p) || (S.fileHandle && S.fileHandle.__path && !(S.dirHandle && S.filePath)))) {
      const full = isAbs(p) ? p : pResolve(dirName(S.fileHandle.__path), p);
      if ((await inv('path_kind', { path: full })) !== 'file') throw new Error('not found');
      return new NFile(full);
    }
    if (isAbs(p)) throw new Error('absolute');
    if (S.dirHandle && S.filePath) return resolvePath(S.filePath.slice(0, -1).concat(p.split(/[\\/]/)));
    throw new Error('no base');
  }
  async function resolvePath(parts) {
    const st = []; for (const p of parts) { if (p === '..') st.pop(); else if (p && p !== '.') st.push(p); }
    let h = S.dirHandle; for (let k = 0; k < st.length - 1; k++) h = await h.getDirectoryHandle(st[k]);
    const fh = await h.getFileHandle(st[st.length - 1]); fh._path = st; return fh;
  }
  const imgBase = () => S.fileHandle && S.fileHandle.__path ? dirName(S.fileHandle.__path) : (S.filePath ? S.filePath.slice(0, -1).join('/') : '');
  function imgFail(img, msg) {
    img.classList.remove('img-pending'); img.style.display = 'none';
    let n = img.nextElementSibling;
    if (!n || !n.classList.contains('img-err')) { n = document.createElement('span'); n.className = 'img-err'; img.after(n); }
    n.textContent = '⚠ ' + msg;
  }
  function imgOk(img, url) {
    img.src = url; img.classList.remove('img-pending'); img.style.display = '';
    const n = img.nextElementSibling; if (n && n.classList.contains('img-err')) n.remove();
  }
  let pendingLocalImgs = 0;
  async function resolveImages(root) {
    for (const img of root.querySelectorAll('img[data-src]')) {
      const src = img.getAttribute('data-src');
      if (!src || MD.isRemote(src)) { if (src && !img.dataset.h) { img.dataset.h = 1; img.addEventListener('error', () => imgFail(img, '图片加载失败：' + src), { once: true }); } continue; }
      const p = normImgSrc(src);
      if (!NATIVE && isAbs(p)) { imgFail(img, '浏览器无法读取绝对路径图片：' + src + '（请改为相对路径，或使用桌面版）'); continue; }
      if (!canResolveRel()) { pendingLocalImgs++; imgFail(img, '本地图片未显示：' + src); continue; }
      const key = imgBase() + '|' + p;
      if (S.imgCache.has(key)) { imgOk(img, S.imgCache.get(key)); continue; }
      try {
        const fh = await relFileHandle(src);
        const url = URL.createObjectURL(await fh.getFile()); S.imgCache.set(key, url); imgOk(img, url);
      } catch (e) { imgFail(img, '找不到图片：' + src); }
    }
  }
  function updateImgBanner() {
    const old = write.querySelector('.img-banner');
    const need = !NATIVE && hasFS && S.fileHandle && !canResolveRel() && /!\[[^\]]*\]\((?!https?:|data:)|<img\s[^>]*src=["']?(?!https?:|data:)/i.test(S.src);
    if (!need) { if (old) old.remove(); return; }
    if (old) return;
    const b = document.createElement('div'); b.className = 'img-banner';
    b.innerHTML = IC('folder') + '<span>本文档引用了本地图片。浏览器需要获得所在文件夹的访问权限才能显示。</span><span class="sp"></span><button class="btn primary sm">授权文件夹</button>';
    b.querySelector('button').onclick = () => authorizeDocFolder();
    write.insertBefore(b, write.firstChild);
  }
  async function authorizeDocFolder() {
    try {
      const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
      const path = dir.resolve ? await dir.resolve(S.fileHandle) : null;
      if (!path) return toast('所选文件夹不包含当前文档，请选择文档所在（或其上级）文件夹', 4000);
      await openFolder(dir); S.filePath = path; const t = S.tabs[S.cur]; if (t) t.path = path;
      S.imgCache.clear(); rerender(true); toast('已授权，图片已加载');
    } catch (e) { if (e.name !== 'AbortError') toast('授权失败：' + e.message); }
  }
  async function imageBytes(src) {
    if (/^data:/i.test(src)) { const m = src.match(/^data:([^;,]+)?(;base64)?,(.*)$/s); if (!m) return null; const mime = m[1] || 'image/png'; return { mime, bytes: m[2] ? b64ToBytes(m[3]) : new TextEncoder().encode(decodeURIComponent(m[3])) }; }
    if (/^(https?:)?\/\//i.test(src)) { try { const f = (NATIVE && T.http && T.http.fetch) || fetch; const r = await f(src); if (!r.ok) return null; const b = new Uint8Array(await r.arrayBuffer()); return { mime: r.headers.get('content-type') || 'image/png', bytes: b }; } catch (e) { return null; } }
    try { const fh = await relFileHandle(src); const f = await fh.getFile(); const ext = (f.name.split('.').pop() || '').toLowerCase(); return { mime: f.type || MIME[ext] || 'image/png', bytes: new Uint8Array(await f.arrayBuffer()) }; } catch (e) { return null; }
  }

  /* ================= Source / undo history ================= */
  const HIST_MAX_CHARS = 30e6;
  function pushHist(v) {
    S.history.push(v); S.histChars = (S.histChars || 0) + v.length;
    while (S.history.length > 200 || (S.histChars > HIST_MAX_CHARS && S.history.length > 3)) S.histChars -= S.history.shift().length;
  }
  function setSrc(v, opts) {
    opts = opts || {};
    if (v === S.src) return;
    if (!opts.noHistory) { pushHist(S.src); S.future = []; }
    S.src = v; S.ver++;
    markDirty(true);
    if (S.mode !== 'live') srcEditorSet(v);
    if (!opts.noRender) rerender();
    updateStatus(); persistSession(); linkIndexTouch(); tasksTouch();
  }
  function undo() { if (!S.history.length) return toast('没有可撤销的操作'); S.future.push(S.src); const v = S.history.pop(); S.histChars -= v.length; setSrc(v, { noHistory: true }); }
  function redo() { if (!S.future.length) return; pushHist(S.src); setSrc(S.future.pop(), { noHistory: true }); }
  function markDirty(d) {
    const changed = S.dirty !== d;
    S.dirty = d;
    const t = S.tabs[S.cur]; if (t) { t.dirty = d; t.name = S.fileName; }
    const sub = S.fileHandle && S.fileHandle.__path ? dirName(S.fileHandle.__path) : (S.filePath && S.filePath.length > 1 ? S.filePath.slice(0, -1).join('/') : '');
    const title = '<b>' + esc(S.fileName) + '</b>' + (sub ? ' <span style="opacity:.75">— ' + esc(sub) + '</span>' : '');
    if ($('#title').innerHTML !== title) $('#title').innerHTML = title;
    const dt = (d ? '● ' : '') + S.fileName + ' - MDView';
    if (document.title !== dt) { document.title = dt; if (NATIVE) { try { T.window.getCurrentWindow().setTitle(dt); } catch (e) { } } }
    if (changed || !d) renderTabs();
    if (d && prefs.autosave && S.fileHandle) autoSave();
  }
  const autoSave = debounce(() => { if (S.dirty && S.fileHandle) save(true); }, 2000);

  /* ================= Tabs & session ================= */
  const curScrollEl = () => S.mode === 'live' ? writeScroll : (S.mode === 'split' ? previewScroll : (srcEd && srcEd.cm ? srcEd.view.scrollDOM : (srcEd || writeScroll)));
  function snapshot() {
    const t = S.tabs[S.cur]; if (!t) return;
    if (S.editing) commit({ silent: true });
    Object.assign(t, { src: S.src, handle: S.fileHandle, name: S.fileName, path: S.filePath, dirty: S.dirty, history: S.history, histChars: S.histChars, future: S.future, scroll: curScrollEl().scrollTop, enc: S.enc });
  }
  function applyTab(t) {
    S.src = t.src; S.ver++; S.fileHandle = t.handle || null; S.fileName = t.name; S.filePath = t.path || null; S.dirty = !!t.dirty; S.enc = t.enc || 'UTF-8';
    S.history = t.history || []; S.histChars = t.histChars || 0; S.future = t.future || [];
    S.editing = null; acClose(); S.result = null;
    for (const el of Array.from(write.children)) if (el !== fnHost && el !== addZone) el.remove();
    if (S.mode !== 'live') srcEditorSet(S.src, true);
    rerender(); markDirty(S.dirty); renderTabs(); updateStatus();
    $$('#tree .tree-item').forEach(x => x.classList.toggle('active', !!S.filePath && x.dataset.path === S.filePath.join('/')));
    requestAnimationFrame(() => { curScrollEl().scrollTop = t.scroll || 0; });
    if (/```\s*mermaid/i.test(S.src)) loadMermaid();
    if (/```\s*wavedrom/i.test(S.src)) loadWaveDrom();
    if (t.stale) { t.stale = false; setTimeout(checkExternalChange, 50); }
    updateBacklinks(); pushState();
  }
  function switchTab(i) {
    if (i === S.cur || !S.tabs[i]) return;
    snapshot(); S.cur = i; applyTab(S.tabs[i]); persistSession(); watchSync();
  }
  function closeTab(i, force) {
    if (i === S.cur) snapshot();
    const t = S.tabs[i]; if (!t) return;
    if (t.dirty && !force && !confirm('“' + t.name + '” 有未保存的修改，确定关闭吗？')) return;
    S.tabs.splice(i, 1);
    if (!S.tabs.length) { S.tabs.push(blankTab()); S.cur = 0; applyTab(S.tabs[0]); }
    else if (i === S.cur) { S.cur = Math.min(i, S.tabs.length - 1); applyTab(S.tabs[S.cur]); }
    else if (i < S.cur) S.cur--;
    renderTabs(); persistSession(); watchSync();
  }
  const blankTab = () => ({ id: ++S.tid, src: '', name: '未命名.md', handle: null, path: null, dirty: false, history: [], future: [], scroll: 0, enc: 'UTF-8' });
  function newTab(text, name) {
    snapshot(); const t = blankTab(); if (text) { t.src = text; t.dirty = true; } if (name) t.name = name;
    S.tabs.push(t); S.cur = S.tabs.length - 1; applyTab(S.tabs[S.cur]); persistSession();
    if (!text) setTimeout(() => { if (S.mode === 'live') startInsert(0, null); else srcFocus(); }, 30);
  }
  function renderTabs() {
    const h = S.tabs.map((t, i) => '<div class="tab' + (i === S.cur ? ' active' : '') + (t.dirty ? ' dirty' : '') + '" data-i="' + i + '" title="' + esc(t.handle && t.handle.__path ? t.handle.__path : t.path ? t.path.join('/') : t.name) + '"><span class="nm">' + esc(t.name) + '</span><span class="x" title="关闭"></span></div>').join('') + '<button id="tab-new" title="新建标签 (Ctrl+N)">' + IC('plus') + '</button>';
    if ($('#tabbar').innerHTML !== h) $('#tabbar').innerHTML = h;
  }
  $('#tabbar').addEventListener('mousedown', e => { if (e.button === 1) { const t = e.target.closest('.tab'); if (t) { e.preventDefault(); closeTab(+t.dataset.i); } } });
  $('#tabbar').addEventListener('click', e => {
    if (e.target.closest('#tab-new')) return newTab();
    const t = e.target.closest('.tab'); if (!t) return;
    if (e.target.classList.contains('x')) closeTab(+t.dataset.i); else switchTab(+t.dataset.i);
  });
  async function findTab(handle, path) {
    for (let i = 0; i < S.tabs.length; i++) {
      const t = i === S.cur ? { handle: S.fileHandle, path: S.filePath } : S.tabs[i];
      if (path && t.path && t.path.join('/') === path.join('/')) return i;
      if (handle && t.handle && t.handle.isSameEntry) { try { if (await t.handle.isSameEntry(handle)) return i; } catch (e) { } }
    }
    return -1;
  }
  async function openDoc(text, name, handle, path, line, enc) {
    const ex = (handle || path) ? await findTab(handle, path) : -1;
    if (ex >= 0) { switchTab(ex); if (line != null) setTimeout(() => jumpToLine(line), 60); return; }
    const t0 = S.tabs[S.cur];
    const pristine = t0 && !S.dirty && (!S.src.trim() || t0.welcome);
    if (!pristine) { snapshot(); S.tabs.push(blankTab()); S.cur = S.tabs.length - 1; }
    const t = S.tabs[S.cur]; t.welcome = false;
    Object.assign(t, { src: text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'), name: name || '未命名.md', handle: handle || null, path: path || null, dirty: false, history: [], histChars: 0, future: [], scroll: 0, enc: enc || 'UTF-8' });
    applyTab(t); persistSession(); watchSync();
    if (handle) { pushRecent({ kind: 'file', name, handle, path }); histSnapshot(t.src, '打开时'); }
    if (enc && enc !== 'UTF-8') toast('已按 ' + enc + ' 编码打开');
    if (line != null) setTimeout(() => jumpToLine(line), 60);
  }
  async function persistNow() {
    const t = S.tabs[S.cur]; if (t) Object.assign(t, { src: S.src, handle: S.fileHandle, name: S.fileName, path: S.filePath, dirty: S.dirty, enc: S.enc });
    const tabs = S.tabs.map(x => ({ src: x.src, name: x.name, handle: packH(x.handle), path: x.path || null, dirty: !!x.dirty, welcome: !!x.welcome, enc: x.enc || 'UTF-8' }));
    const total = tabs.reduce((a, x) => a + x.src.length, 0);
    try { if (total < 1.5e6) localStorage.setItem(LS + 'session', JSON.stringify({ tabs: tabs.map(x => Object.assign({}, x, { handle: x.handle && x.handle.__np ? x.handle : null })), cur: S.cur })); else localStorage.removeItem(LS + 'session'); } catch (e) { }
    try { await idb.set('session', { tabs, cur: S.cur, dir: packH(S.dirHandle) }); } catch (e) { }
  }
  const persistSession = debounce(persistNow, 1200);
  /* desktop: publish the active document for the MCP server (get_active_document) */
  const pushState = debounce(() => {
    if (!NATIVE) return;
    let sel = '';
    try { const ed = S.editing ? S.editing.ta : (S.mode !== 'live' ? srcEd : null); if (ed && edFocused(ed) && ed.selectionEnd > ed.selectionStart) sel = edSlice(ed, ed.selectionStart, Math.min(ed.selectionEnd, ed.selectionStart + 20000)); } catch (e) { }
    const st = { app: 'MDView', version: VERSION, time: new Date().toISOString(), file: S.fileHandle && S.fileHandle.__path || null, name: S.fileName, folder: S.dirHandle && S.dirHandle.__path || null, dirty: S.dirty, selection: sel, open_tabs: S.tabs.map((t, i) => (i === S.cur ? S.fileHandle : t.handle)).filter(h => h && h.__path).map(h => h.__path) };
    inv('set_state', { json: JSON.stringify(st, null, 1) }).catch(() => { });
  }, 800);
