/* ChipBench · viewer-pptx.js — fast, layout-faithful PowerPoint viewer (no Office needed).
   · own ZIP reader (central directory + DecompressionStream) — nothing is unpacked until a slide is needed
   · slides are rendered lazily (IntersectionObserver); thumbnails and main pages share one parsed model
   · theme colours / fonts, master + layout inheritance, placeholders, groups, pictures (crop), tables, connectors,
     custom geometry, bullets / numbering, auto-fit, backgrounds, simple charts, notes
   · SmartArt / OLE / EMF are drawn as labelled boxes; "高保真" converts through Office / LibreOffice (cached)
   Exposed: SL.s31.pptx = { open(t, root), parse(bytes), renderSlide(model, i), loadSlide } */
(function (G) {
  'use strict';
  const SL = G.ChipBench || (G.ChipBench = {}); SL.s31 = SL.s31 || {};
  const EMU = 9525;
  const NS = { a: 'http://schemas.openxmlformats.org/drawingml/2006/main', r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', p: 'http://schemas.openxmlformats.org/presentationml/2006/main' };
  const td = new TextDecoder('utf-8');

  /* ============================== ZIP ============================== */
  class Zip {
    constructor(buf) {
      this.u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf); this.dv = new DataView(this.u8.buffer, this.u8.byteOffset, this.u8.byteLength); this.ent = new Map(); this.cache = new Map();
      let e = this.u8.length - 22; const lim = Math.max(0, e - 65557); for (; e >= lim; e--) if (this.dv.getUint32(e, true) === 0x06054b50) break; if (e < lim) throw new Error('不是有效的 PPTX（找不到 ZIP 目录）');
      const n = this.dv.getUint16(e + 10, true); let p = this.dv.getUint32(e + 16, true);
      for (let i = 0; i < n; i++) {
        if (this.dv.getUint32(p, true) !== 0x02014b50) break;
        const method = this.dv.getUint16(p + 10, true), csize = this.dv.getUint32(p + 20, true), usize = this.dv.getUint32(p + 24, true), nl = this.dv.getUint16(p + 28, true), xl = this.dv.getUint16(p + 30, true), cl = this.dv.getUint16(p + 32, true), off = this.dv.getUint32(p + 42, true);
        this.ent.set(td.decode(this.u8.subarray(p + 46, p + 46 + nl)), { method, csize, usize, off }); p += 46 + nl + xl + cl;
      }
    }
    has(n) { return this.ent.has(n); }
    async bytes(n) {
      const e = this.ent.get(n); if (!e) return null; if (this.cache.has(n)) return this.cache.get(n);
      const o = e.off, nl = this.dv.getUint16(o + 26, true), xl = this.dv.getUint16(o + 28, true), s = o + 30 + nl + xl, raw = this.u8.subarray(s, s + e.csize); let out;
      if (e.method === 0) out = raw; else if (e.method === 8) { const ds = new DecompressionStream('deflate-raw'), w = ds.writable.getWriter(); w.write(raw); w.close(); out = new Uint8Array(await new Response(ds.readable).arrayBuffer()); } else throw new Error('不支持的压缩方式 ' + e.method);
      if (out.length < 4e6) this.cache.set(n, out); return out;
    }
    async text(n) { const b = await this.bytes(n); return b ? td.decode(b) : null; }
    async xml(n) { const t = await this.text(n); return t == null ? null : new DOMParser().parseFromString(t.replace(/^\uFEFF/, ''), 'application/xml').documentElement; }
  }

  /* ============================== XML helpers ============================== */
  const kids = (el, ln) => { const o = []; if (!el) return o; for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (!ln || c.localName === ln) o.push(c); return o; };
  const kid = (el, ln) => { if (!el) return null; for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (c.localName === ln) return c; return null; };
  const path = (el, ...names) => { let c = el; for (const n of names) { c = kid(c, n); if (!c) return null; } return c; };
  const attr = (el, n, d) => { if (!el) return d; const v = el.getAttribute(n); return v == null ? d : v; };
  const num = (el, n, d) => { const v = attr(el, n, null); return v == null || v === '' ? d : +v; };
  const norm = p => { const o = []; for (const s of p.split('/')) { if (s === '..') o.pop(); else if (s && s !== '.') o.push(s); } return o.join('/'); };
  const rel = async (zip, base) => {
    const dir = base.slice(0, base.lastIndexOf('/') + 1), x = await zip.xml(dir + '_rels/' + base.slice(dir.length) + '.rels'), m = {};
    if (x) kids(x, 'Relationship').forEach(r => { let t = r.getAttribute('Target'); if (r.getAttribute('TargetMode') !== 'External') t = norm(t.startsWith('/') ? t.slice(1) : dir + t); m[r.getAttribute('Id')] = { type: r.getAttribute('Type').split('/').pop(), target: t, ext: r.getAttribute('TargetMode') === 'External' }; });
    return m;
  };

  /* ============================== colours ============================== */
  const SYS = { windowText: '000000', window: 'FFFFFF' };
  const PRST = { black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', gray: '808080', grey: '808080', orange: 'FFA500', purple: '800080', lime: '00FF00', cyan: '00FFFF', magenta: 'FF00FF' };
  const toLin = c => { c /= 255; return c <= .04045 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); }, toSrgb = l => Math.round(255 * (l <= .0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - .055));
  const hex2rgb = h => { h = h.replace('#', ''); if (h.length === 3) h = h.replace(/./g, '$&$&'); return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0]; };
  const rgb2hsl = ([r, g, b]) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0; if (mx !== mn) { const dd = mx - mn; s = l > .5 ? dd / (2 - mx - mn) : dd / (mx + mn); h = mx === r ? (g - b) / dd + (g < b ? 6 : 0) : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4; h /= 6; } return [h, s, l]; };
  const hsl2rgb = ([h, s, l]) => { const f = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < .5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; }; if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; } const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; return [f(p, q, h + 1 / 3), f(p, q, h), f(p, q, h - 1 / 3)].map(v => Math.round(v * 255)); };
  function colorOf(el, ctx) {
    if (!el) return null; const c = kids(el).find(k => /^(srgbClr|schemeClr|sysClr|prstClr|scrgbClr|hslClr)$/.test(k.localName)); if (!c) return null;
    let hx = null; const ln = c.localName;
    if (ln === 'srgbClr') hx = c.getAttribute('val'); else if (ln === 'sysClr') hx = c.getAttribute('lastClr') || SYS[c.getAttribute('val')] || '000000';
    else if (ln === 'prstClr') hx = PRST[c.getAttribute('val')] || '000000';
    else if (ln === 'schemeClr') { let v = c.getAttribute('val'); if (v === 'phClr') return ctx && ctx.ph ? ctx.ph : null; const cm = ctx && ctx.clrMap || {}; v = cm[v] || v; hx = (ctx && ctx.theme && ctx.theme.colors[v]) || (v === 'tx1' ? '000000' : v === 'bg1' ? 'FFFFFF' : '808080'); }
    else if (ln === 'scrgbClr') hx = [c.getAttribute('r'), c.getAttribute('g'), c.getAttribute('b')].map(v => Math.round(+v / 100000 * 255).toString(16).padStart(2, '0')).join(''); else return null;
    let rgb = hex2rgb(hx || '000000'), alpha = 1;
    for (const m of kids(c)) {
      const v = num(m, 'val', 0) / 100000;
      if (m.localName === 'lumMod' || m.localName === 'lumOff') { const hsl = rgb2hsl(rgb); if (m.localName === 'lumMod') hsl[2] = Math.min(1, hsl[2] * v); else hsl[2] = Math.min(1, hsl[2] + v); rgb = hsl2rgb(hsl); }
      else if (m.localName === 'satMod') { const hsl = rgb2hsl(rgb); hsl[1] = Math.min(1, hsl[1] * v); rgb = hsl2rgb(hsl); }
      else if (m.localName === 'tint') rgb = rgb.map(x => toSrgb(toLin(x) * v + (1 - v))); else if (m.localName === 'shade') rgb = rgb.map(x => toSrgb(toLin(x) * v));   // PowerPoint applies tint / shade in linear RGB
      else if (m.localName === 'alpha') alpha = v; else if (m.localName === 'lum') { const hsl = rgb2hsl(rgb); hsl[2] = v; rgb = hsl2rgb(hsl); }
    }
    return alpha < 1 ? 'rgba(' + rgb.join(',') + ',' + alpha.toFixed(3) + ')' : '#' + rgb.map(x => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0')).join('');
  }
  const fillCss = (sp, ctx) => {
    if (!sp) return null;
    for (const k of kids(sp)) {
      if (k.localName === 'noFill') return { none: true };
      if (k.localName === 'solidFill') { const c = colorOf(k, ctx); if (c) return { css: c }; }
      if (k.localName === 'gradFill') {
        const stops = kids(path(k, 'gsLst'), 'gs').map(g => ({ pos: num(g, 'pos', 0) / 1000, c: colorOf(g, ctx) })).filter(g => g.c); if (!stops.length) continue; const lin = path(k, 'lin'), ang = lin ? num(lin, 'ang', 0) / 60000 : 90;
        return { css: stops.length === 1 ? stops[0].c : 'linear-gradient(' + ((ang + 90) % 360) + 'deg,' + stops.map(s => s.c + ' ' + s.pos + '%').join(',') + ')' };
      }
      if (k.localName === 'blipFill') { const b = path(k, 'blip'); if (b) return { blip: embedId(b) }; }
      if (k.localName === 'pattFill') { const c = colorOf(path(k, 'fgClr'), ctx); if (c) return { css: c }; }
    } return null;
  };
  const embedId = b => b && (b.getAttributeNS(NS.r, 'embed') || b.getAttribute('r:embed'));

  /* ============================== model ============================== */
  async function parse(buf) {
    const zip = new Zip(buf), pres = await zip.xml('ppt/presentation.xml'); if (!pres) throw new Error('缺少 ppt/presentation.xml');
    const sz = path(pres, 'sldSz'), W = num(sz, 'cx', 9144000), H = num(sz, 'cy', 5143500), prel = await rel(zip, 'ppt/presentation.xml');
    const ids = kids(path(pres, 'sldIdLst'), 'sldId').map(s => { const id = s.getAttributeNS(NS.r, 'id') || s.getAttribute('r:id'); return { ref: prel[id] }; }).filter(s => s.ref);
    const M = { zip, W, H, w: W / EMU, h: H / EMU, slides: ids.map((s, i) => ({ i, path: s.ref.target, loaded: null })), masters: new Map(), layouts: new Map(), themes: new Map(), media: new Map(), defaultText: path(pres, 'defaultTextStyle') };
    M.N = M.slides.length; return M;
  }
  async function themeOf(M, masterPath) {
    if (M.themes.has(masterPath)) return M.themes.get(masterPath); const mrel = await rel(M.zip, masterPath), tp = Object.values(mrel).find(r => r.type === 'theme'); const th = { colors: {}, major: { latin: 'Calibri', ea: '' }, minor: { latin: 'Calibri', ea: '' } };
    if (tp) {
      const x = await M.zip.xml(tp.target), cs = path(x, 'themeElements', 'clrScheme'); kids(cs).forEach(c => { const v = kids(c)[0]; th.colors[c.localName] = v ? (v.getAttribute('val') === 'windowText' ? '000000' : v.getAttribute('val') === 'window' ? 'FFFFFF' : (v.getAttribute('lastClr') || v.getAttribute('val'))) : '808080'; });
      const fs = path(x, 'themeElements', 'fontScheme'); for (const [k, n] of [['major', 'majorFont'], ['minor', 'minorFont']]) { const f = path(fs, n); th[k] = { latin: attr(path(f, 'latin'), 'typeface', 'Calibri'), ea: attr(path(f, 'ea'), 'typeface', '') }; }
    }
    M.themes.set(masterPath, th); return th;
  }
  async function masterOf(M, p) {
    if (M.masters.has(p)) return M.masters.get(p); const x = await M.zip.xml(p), r = await rel(M.zip, p); const o = { x, rels: r, path: p, theme: await themeOf(M, p), clrMap: {} };
    const cm = path(x, 'clrMap'); if (cm) for (const a of cm.attributes) o.clrMap[a.name] = a.value; o.tx = path(x, 'txStyles'); o.tree = path(x, 'cSld', 'spTree'); o.bg = path(x, 'cSld', 'bg'); M.masters.set(p, o); return o;
  }
  async function layoutOf(M, p) {
    if (M.layouts.has(p)) return M.layouts.get(p); const x = await M.zip.xml(p), r = await rel(M.zip, p); const mp = Object.values(r).find(q => q.type === 'slideMaster');
    const o = { x, rels: r, path: p, master: mp ? await masterOf(M, mp.target) : null, tree: path(x, 'cSld', 'spTree'), bg: path(x, 'cSld', 'bg'), showMasterSp: attr(x, 'showMasterSp', '1') !== '0' };
    const cm = path(x, 'clrMapOvr', 'overrideClrMapping'); o.clrMap = Object.assign({}, o.master ? o.master.clrMap : {}); if (cm) for (const a of cm.attributes) o.clrMap[a.name] = a.value; M.layouts.set(p, o); return o;
  }
  const paraTexts = tb => kids(tb, 'p').map(p => kids(p).filter(c => /^(r|fld)$/.test(c.localName)).map(c => (kid(c, 't') || {}).textContent || '').join(''));
  async function loadSlide(M, i) {
    const s = M.slides[i]; if (s.loaded) return s.loaded;
    return s.loaded = (async () => {
      const x = await M.zip.xml(s.path), r = await rel(M.zip, s.path), lp = Object.values(r).find(q => q.type === 'slideLayout'), layout = lp ? await layoutOf(M, lp.target) : null, np = Object.values(r).find(q => q.type === 'notesSlide');
      let notes = ''; if (np) { const nx = await M.zip.xml(np.target); if (nx) notes = kids(path(nx, 'cSld', 'spTree'), 'sp').filter(sp => { const ph = path(sp, 'nvSpPr', 'nvPr', 'ph'); return ph && attr(ph, 'type', '') === 'body'; }).map(sp => paraTexts(path(sp, 'txBody')).join('\n')).join('\n').trim(); }
      return { x, rels: r, path: s.path, layout, master: layout && layout.master, tree: path(x, 'cSld', 'spTree'), bg: path(x, 'cSld', 'bg'), hidden: attr(x, 'show', '1') === '0', notes, clrMap: layout ? layout.clrMap : {}, theme: layout && layout.master ? layout.master.theme : { colors: {}, major: {}, minor: {} } };
    })();
  }

  /* ============================== placeholders / text styles ============================== */
  const phKey = sp => { const ph = path(sp, 'nvSpPr', 'nvPr', 'ph') || path(sp, 'nvPicPr', 'nvPr', 'ph') || path(sp, 'nvGraphicFramePr', 'nvPr', 'ph'); return ph ? { type: attr(ph, 'type', 'body'), idx: attr(ph, 'idx', null), el: ph } : null; };
  const findPh = (tree, key) => {
    if (!tree || !key) return null; const all = kids(tree).filter(e => /^(sp|pic|graphicFrame)$/.test(e.localName));
    return all.find(e => { const k = phKey(e); return k && key.idx != null && k.idx === key.idx; }) || all.find(e => { const k = phKey(e); return k && k.type === key.type && (key.type !== 'body' || k.idx == null); }) || all.find(e => { const k = phKey(e); return k && (k.type === key.type || (key.type === 'ctrTitle' && k.type === 'title') || (key.type === 'subTitle' && k.type === 'body')); }) || null;
  };
  const xfrmOf = sp => {
    const x = path(sp, 'spPr', 'xfrm') || path(sp, 'xfrm') || path(sp, 'grpSpPr', 'xfrm'); if (!x) return null; const off = kid(x, 'off'), ext = kid(x, 'ext'); if (!off || !ext) return null;
    return { x: num(off, 'x', 0), y: num(off, 'y', 0), w: num(ext, 'cx', 0), h: num(ext, 'cy', 0), rot: num(x, 'rot', 0) / 60000, fh: attr(x, 'flipH', '0') === '1', fv: attr(x, 'flipV', '0') === '1', chOff: kid(x, 'chOff') ? { x: num(kid(x, 'chOff'), 'x', 0), y: num(kid(x, 'chOff'), 'y', 0) } : null, chExt: kid(x, 'chExt') ? { w: num(kid(x, 'chExt'), 'cx', 0), h: num(kid(x, 'chExt'), 'cy', 0) } : null };
  };
  const LVL = n => 'lvl' + (n + 1) + 'pPr';
  function styleChain(S, sp, key) {
    const chain = [], push = el => { if (el) chain.push(el); }, ty = key ? key.type : 'other';
    push(S.dt);                                                      // presentation default (lowest priority)
    const m = S.master && S.master.tx;
    if (m) { const sel = (ty === 'title' || ty === 'ctrTitle') ? 'titleStyle' : (key && !/^(dt|ftr|sldNum)$/.test(ty)) ? 'bodyStyle' : 'otherStyle'; push(path(m, sel)); }
    const mph = key && S.master ? findPh(S.master.tree, key) : null; if (mph) push(path(mph, 'txBody', 'lstStyle'));
    const lph = key && S.layout ? findPh(S.layout.tree, key) : null; if (lph) push(path(lph, 'txBody', 'lstStyle'));
    push(path(sp, 'txBody', 'lstStyle')); return chain;
  }
  function lvlProps(chain, lvl) { const o = {}; for (const h of chain) { const p = kid(h, LVL(lvl)); if (!p) continue; Object.assign(o, collectP(p)); const d = kid(p, 'defRPr'); if (d) o.r = Object.assign(o.r || {}, collectR(d)); } return o; }
  function collectP(p) {
    const o = {}; ['algn', 'marL', 'indent', 'lvl'].forEach(k => { const v = p.getAttribute(k); if (v != null) o[k] = v; });
    const ls = path(p, 'lnSpc'); if (ls) { const pct = path(ls, 'spcPct'), pts = path(ls, 'spcPts'); o.lnSpc = pct ? { pct: num(pct, 'val', 100000) / 100000 } : pts ? { pts: num(pts, 'val', 0) / 100 } : null; }
    for (const n of ['spcBef', 'spcAft']) { const e = path(p, n); if (e) { const pct = path(e, 'spcPct'), pts = path(e, 'spcPts'); o[n] = pct ? { pct: num(pct, 'val', 0) / 100000 } : pts ? { pts: num(pts, 'val', 0) / 100 } : null; } }
    if (kid(p, 'buNone')) o.bu = { none: true }; const bc = kid(p, 'buChar'), ba = kid(p, 'buAutoNum'); if (bc) o.bu = { ch: attr(bc, 'char', '•') }; if (ba) o.bu = { auto: attr(ba, 'type', 'arabicPeriod'), start: num(ba, 'startAt', 1) };
    const bf = path(p, 'buFont'); if (bf) o.buFont = attr(bf, 'typeface', ''); const bcl = kid(p, 'buClr'); if (bcl) o.buClr = bcl; return o;
  }
  function collectR(r) {
    const o = {}; ['sz', 'b', 'i', 'u', 'strike', 'baseline'].forEach(k => { const v = r.getAttribute(k); if (v != null) o[k] = v; });
    const f = kid(r, 'solidFill'); if (f) o.fillEl = f; const lat = kid(r, 'latin'), ea = kid(r, 'ea'); if (lat) o.latin = lat.getAttribute('typeface'); if (ea) o.ea = ea.getAttribute('typeface'); return o;
  }

  /* ============================== rendering ============================== */
  const px = emu => +(emu / EMU).toFixed(2);
  const ARROWS = { rightArrow: 'M0,30 L60,30 L60,0 L100,50 L60,100 L60,70 L0,70 Z', leftArrow: 'M100,30 L40,30 L40,0 L0,50 L40,100 L40,70 L100,70 Z', upArrow: 'M30,100 L30,40 L0,40 L50,0 L100,40 L70,40 L70,100 Z', downArrow: 'M30,0 L30,60 L0,60 L50,100 L100,60 L70,60 L70,0 Z' };
  const GEOM = {
    triangle: 'M50,0 L100,100 L0,100 Z', rtTriangle: 'M0,0 L100,100 L0,100 Z', diamond: 'M50,0 L100,50 L50,100 L0,50 Z', parallelogram: 'M25,0 L100,0 L75,100 L0,100 Z', trapezoid: 'M20,0 L80,0 L100,100 L0,100 Z',
    pentagon: 'M50,0 L100,38 L82,100 L18,100 L0,38 Z', hexagon: 'M25,0 L75,0 L100,50 L75,100 L25,100 L0,50 Z', octagon: 'M30,0 L70,0 L100,30 L100,70 L70,100 L30,100 L0,70 L0,30 Z', homePlate: 'M0,0 L75,0 L100,50 L75,100 L0,100 Z', chevron: 'M0,0 L70,0 L100,50 L70,100 L0,100 L30,50 Z',
    plus: 'M33,0 L67,0 L67,33 L100,33 L100,67 L67,67 L67,100 L33,100 L33,67 L0,67 L0,33 L33,33 Z', star5: 'M50,0 L61,35 L98,35 L68,57 L79,91 L50,70 L21,91 L32,57 L2,35 L39,35 Z', flowChartDecision: 'M50,0 L100,50 L50,100 L0,50 Z', flowChartProcess: 'M0,0 L100,0 L100,100 L0,100 Z',
    flowChartTerminator: 'M20,0 L80,0 Q100,0 100,50 Q100,100 80,100 L20,100 Q0,100 0,50 Q0,0 20,0 Z', cloud: 'M25,80 Q0,80 5,60 Q0,40 25,40 Q25,10 55,20 Q80,0 90,30 Q110,50 90,70 Q95,90 70,85 Q50,100 25,80 Z', can: 'M0,15 Q0,0 50,0 Q100,0 100,15 L100,85 Q100,100 50,100 Q0,100 0,85 Z', rect: 'M0,0 L100,0 L100,100 L0,100 Z'
  };
  const FONTFALL = ', "Segoe UI", "Microsoft YaHei UI", "Yu Gothic UI", "PingFang SC", "Noto Sans CJK SC", sans-serif';
  const fontFam = (r, S) => { const th = S.theme || {}; const rs = f => !f ? '' : f === '+mj-lt' ? (th.major || {}).latin : f === '+mn-lt' ? (th.minor || {}).latin : f === '+mj-ea' ? (th.major || {}).ea : f === '+mn-ea' ? (th.minor || {}).ea : f; const l = rs(r.latin) || (th.minor || {}).latin || 'Calibri', e = rs(r.ea) || (th.minor || {}).ea || ''; return [l, e].filter(x => x && !/^\+/.test(x)).map(x => '"' + x + '"').join(',') + FONTFALL; };

  function Renderer(M, S, opt) { this.M = M; this.S = S; this.opt = opt || {}; this.simplified = 0; }
  Renderer.prototype.ctx = function (extra) { return Object.assign({ clrMap: this.S.clrMap, theme: this.S.theme }, extra || {}); };
  Renderer.prototype.img = async function (rid, relMap) {
    const r = relMap && relMap[rid]; if (!r || r.ext) return null; const key = r.target; if (this.M.media.has(key)) return this.M.media.get(key);
    const p = (async () => { const b = await this.M.zip.bytes(r.target); if (!b) return null; const ext = r.target.split('.').pop().toLowerCase(); if (/^(emf|wmf|wdp|tif|tiff)$/.test(ext)) return { unsupported: ext }; const mt = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', bmp: 'image/bmp', webp: 'image/webp' }[ext] || 'image/png'; return { url: URL.createObjectURL(new Blob([b], { type: mt })) }; })();
    this.M.media.set(key, p); return p;
  };
  Renderer.prototype.bgOf = async function (host) {
    const S = this.S, chain = [[S.bg, S.rels], [S.layout && S.layout.bg, S.layout && S.layout.rels]]; if (S.master) chain.push([S.master.bg, S.master.rels]);
    for (const [bg, rels] of chain) {
      if (!bg) continue; const pr = path(bg, 'bgPr'), ref = path(bg, 'bgRef');
      if (pr) { const f = fillCss(pr, this.ctx()); if (f && f.blip) { const im = await this.img(f.blip, rels); if (im && im.url) { host.style.background = 'url(' + im.url + ') center/cover no-repeat'; return; } } else if (f && f.css) { host.style.background = f.css; return; } else if (f && f.none) continue; }
      if (ref) { const c = colorOf(ref, this.ctx()); if (c) { host.style.background = c; return; } }
    } host.style.background = '#fff';
  };
  Renderer.prototype.drawTree = async function (tree, rels, host, T, skipPh) { for (const el of kids(tree)) await this.drawEl(el, rels, host, T, skipPh); };
  const mapRect = (r, T) => ({ x: T.tx + (r.x - T.cx) * T.sx, y: T.ty + (r.y - T.cy) * T.sy, w: r.w * T.sx, h: r.h * T.sy });
  Renderer.prototype.drawEl = async function (el, rels, host, T, skipPh) {
    const ln = el.localName;
    if (ln === 'AlternateContent') { const use = kid(el, 'Fallback') || kid(el, 'Choice'); if (use) for (const c of kids(use)) await this.drawEl(c, rels, host, T, skipPh); return; }
    if (!/^(sp|pic|grpSp|graphicFrame|cxnSp)$/.test(ln)) return;
    const key = phKey(el); if (skipPh && key) return;
    if (ln === 'grpSp') return this.drawGroup(el, rels, host, T);
    let xf = xfrmOf(el); if (!xf && key) { const hit = (this.S.layout && findPh(this.S.layout.tree, key)) || (this.S.master && findPh(this.S.master.tree, key)); if (hit) xf = xfrmOf(hit); if (!xf && this.S.master) { const m2 = findPh(this.S.master.tree, key); if (m2) xf = xfrmOf(m2); } }
    if (!xf) return; const P = T ? mapRect(xf, T) : xf;
    const box = document.createElement('div'); box.className = 'pp-o'; Object.assign(box.style, { position: 'absolute', left: px(P.x) + 'px', top: px(P.y) + 'px', width: px(P.w) + 'px', height: px(P.h) + 'px' });
    const tr = []; if (xf.rot) tr.push('rotate(' + xf.rot + 'deg)'); if (xf.fh) tr.push('scaleX(-1)'); if (xf.fv) tr.push('scaleY(-1)'); if (tr.length) box.style.transform = tr.join(' ');
    if (ln === 'pic') await this.drawPic(el, rels, box, P); else if (ln === 'graphicFrame') await this.drawFrame(el, rels, box, P, key, xf); else if (ln === 'cxnSp') this.drawLine(el, box, P, xf); else await this.drawSp(el, rels, box, P, key, xf);
    host.appendChild(box);
  };
  Renderer.prototype.drawGroup = async function (el, rels, host, T) {
    const xf = xfrmOf(el); if (!xf) return; const P = T ? mapRect(xf, T) : xf, cw = xf.chExt && xf.chExt.w || xf.w, ch = xf.chExt && xf.chExt.h || xf.h, co = xf.chOff || { x: xf.x, y: xf.y };
    const T2 = { tx: P.x, ty: P.y, cx: co.x, cy: co.y, sx: cw ? P.w / cw : 1, sy: ch ? P.h / ch : 1 }; const g = document.createElement('div'); g.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0';
    if (xf.rot || xf.fh || xf.fv) { g.style.transformOrigin = px(P.x + P.w / 2) + 'px ' + px(P.y + P.h / 2) + 'px'; g.style.transform = [xf.rot ? 'rotate(' + xf.rot + 'deg)' : '', xf.fh ? 'scaleX(-1)' : '', xf.fv ? 'scaleY(-1)' : ''].join(' '); }
    for (const c of kids(el)) if (c.localName !== 'nvGrpSpPr' && c.localName !== 'grpSpPr') await this.drawEl(c, rels, g, T2, false); host.appendChild(g);
  };
  Renderer.prototype.styleFill = function (sp) { const st = kid(sp, 'style'); if (!st) return null; const fr = kid(st, 'fillRef'); if (!fr || num(fr, 'idx', 0) === 0) return { none: true }; const c = colorOf(fr, this.ctx()); return c ? { css: c } : null; };
  Renderer.prototype.styleLine = function (sp) { const st = kid(sp, 'style'); if (!st) return null; const lr = kid(st, 'lnRef'); if (!lr || num(lr, 'idx', 0) === 0) return null; const c = colorOf(lr, this.ctx()); return c ? { css: c, w: 1 } : null; };
  Renderer.prototype.lineOf = function (spPr, sp) {
    const ln = kid(spPr, 'ln'); let out = this.styleLine(sp); if (!ln) return out; if (kid(ln, 'noFill')) return null; const w = num(ln, 'w', 12700) / EMU, f = fillCss(ln, this.ctx()), dash = path(ln, 'prstDash');
    out = out || { css: '#888', w: 1 }; return { css: f && f.css ? f.css : out.css, w: w || out.w || 1, dash: dash ? dash.getAttribute('val') : null, head: path(ln, 'headEnd'), tail: path(ln, 'tailEnd') };
  };
  Renderer.prototype.drawSp = async function (el, rels, box, P, key, xf) {
    const spPr = kid(el, 'spPr'), geom = path(spPr, 'prstGeom'), cust = path(spPr, 'custGeom'), prst = geom ? geom.getAttribute('prst') : (cust ? 'cust' : 'rect');
    let fill = fillCss(spPr, this.ctx()) || (key ? { none: true } : this.styleFill(el)); const line = this.lineOf(spPr, el), w = P.w / EMU, h = P.h / EMU;
    const hasShape = (fill && !fill.none) || line; let imgBg = null; if (fill && fill.blip) { const im = await this.img(fill.blip, rels); if (im && im.url) imgBg = im.url; fill = null; }
    if (hasShape || imgBg) {
      if (/^(rect|roundRect|ellipse|flowChartAlternateProcess|round2SameRect|snip1Rect)$/.test(prst)) {
        const d = document.createElement('div'); d.style.cssText = 'position:absolute;inset:0;box-sizing:border-box'; if (fill && fill.css) d.style.background = fill.css; if (imgBg) d.style.background = 'url(' + imgBg + ') center/cover no-repeat';
        if (line) d.style.border = Math.max(.5, line.w) + 'px ' + (line.dash && /dash|sysDot|dot/.test(line.dash) ? (/dot|sysDot/.test(line.dash) ? 'dotted' : 'dashed') : 'solid') + ' ' + line.css;
        if (prst === 'ellipse') d.style.borderRadius = '50%'; else if (prst === 'roundRect' || prst === 'flowChartAlternateProcess') { let a = 16667; if (geom) { const g = kid(kid(geom, 'avLst'), 'gd'); if (g) { const m = (g.getAttribute('fmla') || '').match(/val\s+(-?\d+)/); if (m) a = +m[1]; } } d.style.borderRadius = (Math.min(w, h) * a / 100000) + 'px'; }
        box.appendChild(d);
      } else {
        const NSV = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NSV, 'svg'); svg.setAttribute('width', '100%'); svg.setAttribute('height', '100%'); svg.style.cssText = 'position:absolute;inset:0;overflow:visible'; let vb = '0 0 100 100', d = GEOM[prst] || ARROWS[prst] || null;
        if (prst === 'cust') { const pl = path(cust, 'pathLst', 'path'), pw = num(pl, 'w', 0) || 100, ph = num(pl, 'h', 0) || 100; vb = '0 0 ' + pw + ' ' + ph; d = ''; if (pl) for (const c of kids(pl)) { const pts = kids(c, 'pt').map(p => num(p, 'x', 0) + ',' + num(p, 'y', 0)); if (c.localName === 'moveTo') d += 'M' + pts[0]; else if (c.localName === 'lnTo') d += 'L' + pts[0]; else if (c.localName === 'cubicBezTo') d += 'C' + pts.join(' '); else if (c.localName === 'quadBezTo') d += 'Q' + pts.join(' '); else if (c.localName === 'close') d += 'Z'; } }
        if (!d) { d = GEOM.rect; this.simplified += 1; } svg.setAttribute('viewBox', vb); svg.setAttribute('preserveAspectRatio', 'none');
        const pth = document.createElementNS(NSV, 'path'); pth.setAttribute('d', d); pth.setAttribute('fill', fill && fill.css && !/gradient/.test(fill.css) ? fill.css : fill && /gradient/.test(fill.css || '') ? (/#[0-9a-f]{6}/i.exec(fill.css) || ['#ccc'])[0] : 'none');
        if (line) { pth.setAttribute('stroke', line.css); pth.setAttribute('stroke-width', Math.max(.5, line.w)); pth.setAttribute('vector-effect', 'non-scaling-stroke'); if (line.dash && /dash/.test(line.dash)) pth.setAttribute('stroke-dasharray', '6 4'); }
        svg.appendChild(pth); box.appendChild(svg);
      }
    }
    const tb = kid(el, 'txBody'); if (tb && kids(tb, 'p').some(p => kids(p).some(c => /^(r|fld|br)$/.test(c.localName)))) await this.drawText(tb, el, key, box, P);
  };
  Renderer.prototype.drawLine = function (el, box, P) {
    const spPr = kid(el, 'spPr'), line = this.lineOf(spPr, el) || { css: '#444', w: 1 }, NSV = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NSV, 'svg');
    const w = P.w / EMU, h = P.h / EMU, pad = Math.max(8, line.w * 2 + 6); svg.setAttribute('width', w + 2 * pad); svg.setAttribute('height', h + 2 * pad); svg.setAttribute('viewBox', (-pad) + ' ' + (-pad) + ' ' + (w + 2 * pad) + ' ' + (h + 2 * pad)); svg.style.cssText = 'position:absolute;left:' + (-pad) + 'px;top:' + (-pad) + 'px;overflow:visible';
    const l = document.createElementNS(NSV, 'line'); l.setAttribute('x1', 0); l.setAttribute('y1', 0); l.setAttribute('x2', w); l.setAttribute('y2', h); l.setAttribute('stroke', line.css); l.setAttribute('stroke-width', Math.max(.75, line.w)); if (line.dash && /dash/.test(line.dash)) l.setAttribute('stroke-dasharray', '6 4');
    const mid = 'ah' + Math.random().toString(36).slice(2, 7), defs = document.createElementNS(NSV, 'defs'); defs.innerHTML = '<marker id="' + mid + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="' + line.css + '"/></marker>'; svg.appendChild(defs);
    const has = e => e && e.getAttribute('type') && e.getAttribute('type') !== 'none'; if (has(line.tail)) l.setAttribute('marker-end', 'url(#' + mid + ')'); if (has(line.head)) l.setAttribute('marker-start', 'url(#' + mid + ')');
    svg.appendChild(l); box.appendChild(svg);
  };
  Renderer.prototype.drawPic = async function (el, rels, box, P) {
    const bf = kid(el, 'blipFill'), b = path(bf, 'blip'), rid = embedId(b), im = rid ? await this.img(rid, rels) : null;
    if (!im || im.unsupported || !im.url) { box.classList.add('pp-obj-x'); box.textContent = im && im.unsupported ? '矢量图 (' + im.unsupported.toUpperCase() + ')' : '图片'; this.simplified++; return; }
    const src = path(bf, 'srcRect'), l = num(src, 'l', 0) / 1e5, t = num(src, 't', 0) / 1e5, r = num(src, 'r', 0) / 1e5, bt = num(src, 'b', 0) / 1e5; box.style.overflow = 'hidden';
    const i = new Image(); i.decoding = 'async'; i.draggable = false; i.src = im.url; const sw = 1 - l - r, sh = 1 - t - bt;
    Object.assign(i.style, { position: 'absolute', left: (-l / sw * 100) + '%', top: (-t / sh * 100) + '%', width: (100 / sw) + '%', height: (100 / sh) + '%', maxWidth: 'none' }); box.appendChild(i);
    const ln = this.lineOf(kid(el, 'spPr'), null); if (ln) box.style.outline = Math.max(.5, ln.w) + 'px solid ' + ln.css; const g = path(kid(el, 'spPr'), 'prstGeom'); if (g && g.getAttribute('prst') === 'ellipse') box.style.borderRadius = '50%'; else if (g && g.getAttribute('prst') === 'roundRect') box.style.borderRadius = Math.min(P.w, P.h) / EMU * .1667 + 'px';
  };
  Renderer.prototype.drawFrame = async function (el, rels, box, P) {
    const gd = path(el, 'graphic', 'graphicData'), uri = gd ? gd.getAttribute('uri') || '' : '', tbl = gd && kid(gd, 'tbl');
    if (tbl) return this.drawTable(tbl, rels, box, P);
    if (/chart/.test(uri)) { const ch = gd && kid(gd, 'chart'), rid = ch && (ch.getAttributeNS(NS.r, 'id') || ch.getAttribute('r:id')), tgt = rid && rels[rid]; if (tgt && !tgt.ext) { try { const cx = await this.M.zip.xml(tgt.target); if (cx && this.drawChart(cx, box, P)) return; } catch (e) { console.warn('[pptx] chart', e); } } }
    box.classList.add('pp-obj-x'); this.simplified++; box.textContent = /chart/.test(uri) ? '图表（请用“高保真”查看）' : /diagram/.test(uri) ? 'SmartArt（请用“高保真”查看）' : /ole/i.test(uri) ? '嵌入对象' : '对象';
  };
  /* compact chart renderer: clustered / stacked column + bar, line, area, pie / doughnut (cached values only) */
  Renderer.prototype.drawChart = function (cx, box, P) {
    const NSV = 'http://www.w3.org/2000/svg', plot = path(cx, 'chart', 'plotArea'); if (!plot) return false;
    const kindEl = kids(plot).find(k => /^(barChart|bar3DChart|lineChart|line3DChart|pieChart|pie3DChart|doughnutChart|areaChart|scatterChart)$/.test(k.localName)); if (!kindEl) return false;
    const kind = kindEl.localName.replace('3D', ''), W = P.w / EMU, H = P.h / EMU, PALT = ['4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47', '264478', '9E480E'].map(c => '#' + c);
    const th = this.S.theme.colors, ac = i => th['accent' + ((i % 6) + 1)] ? '#' + th['accent' + ((i % 6) + 1)] : PALT[i % 8];
    const vals = e => kids(path(e, 'numRef', 'numCache') || path(e, 'numLit'), 'pt').map(p => parseFloat((kid(p, 'v') || {}).textContent)), strs = e => kids(path(e, 'strRef', 'strCache') || path(e, 'strLit') || path(e, 'numRef', 'numCache'), 'pt').map(p => (kid(p, 'v') || {}).textContent || '');
    const sers = kids(kindEl, 'ser').map((s, i) => { const f = fillCss(kid(s, 'spPr'), this.ctx()); return { name: ((path(s, 'tx', 'strRef', 'strCache', 'pt', 'v') || path(s, 'tx', 'v') || {}).textContent) || 'S' + (i + 1), cat: strs(kid(s, 'cat') || kid(s, 'xVal')), val: vals(kid(s, 'val') || kid(s, 'yVal')), color: f && f.css ? f.css : ac(i) }; }); if (!sers.length) return false;
    const svg = document.createElementNS(NSV, 'svg'); svg.setAttribute('width', W); svg.setAttribute('height', H); svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.style.cssText = 'position:absolute;left:0;top:0;overflow:hidden;font-family:' + fontFam({}, this.S);
    const add = (tag, a, txt) => { const e = document.createElementNS(NSV, tag); for (const k in a) e.setAttribute(k, a[k]); if (txt != null) e.textContent = txt; svg.appendChild(e); return e; };
    const title = Array.from((path(cx, 'chart', 'title') || { getElementsByTagNameNS() { return []; } }).getElementsByTagNameNS(NS.a, 't')).map(t => t.textContent).join(''); let top = 10; if (title) { add('text', { x: W / 2, y: 26, 'text-anchor': 'middle', 'font-size': 24, 'font-weight': 600, fill: '#333' }, title); top = 40; }
    const legend = kid(path(cx, 'chart'), 'legend') && (sers.length > 1 || /pie|doughnut/.test(kind)), lh = legend ? 26 : 0, bot = 34 + lh;
    if (/pie|doughnut/.test(kind)) {
      const v = sers[0].val.map(x => Math.max(0, x || 0)), tot = v.reduce((a, b) => a + b, 0) || 1, r = Math.min(W, H - top - lh) / 2 - 14, c = [W / 2, top + (H - top - lh) / 2]; let a0 = -Math.PI / 2;
      v.forEach((x, i) => { const a1 = a0 + x / tot * Math.PI * 2, lg = a1 - a0 > Math.PI ? 1 : 0, p = (a, rr) => (c[0] + rr * Math.cos(a)) + ',' + (c[1] + rr * Math.sin(a)); const d = kind === 'doughnut' ? 'M' + p(a0, r) + ' A' + r + ',' + r + ' 0 ' + lg + ' 1 ' + p(a1, r) + ' L' + p(a1, r * .55) + ' A' + r * .55 + ',' + r * .55 + ' 0 ' + lg + ' 0 ' + p(a0, r * .55) + ' Z' : 'M' + c + ' L' + p(a0, r) + ' A' + r + ',' + r + ' 0 ' + lg + ' 1 ' + p(a1, r) + ' Z'; add('path', { d, fill: ac(i), stroke: '#fff', 'stroke-width': 1.5 }); if (x / tot > .04) { const m = (a0 + a1) / 2; add('text', { x: c[0] + r * .72 * Math.cos(m), y: c[1] + r * .72 * Math.sin(m) + 4, 'text-anchor': 'middle', 'font-size': 16, fill: '#fff' }, Math.round(x / tot * 100) + '%'); } a0 = a1; });
      if (legend) sers[0].cat.forEach((n, i) => { const x = 14 + i * Math.min(160, (W - 28) / sers[0].cat.length); add('rect', { x, y: H - 20, width: 10, height: 10, fill: ac(i) }); add('text', { x: x + 14, y: H - 11, 'font-size': 16, fill: '#444' }, n); });
    } else {
      const cats = sers[0].cat.length ? sers[0].cat : sers[0].val.map((_, i) => String(i + 1)), n = cats.length, stacked = /stacked|percentStacked/.test(attr(path(kindEl, 'grouping'), 'val', 'clustered'));
      const all = sers.flatMap(s => s.val).filter(x => isFinite(x)); let mx = Math.max(...all, 0), mn = Math.min(...all, 0); if (stacked) mx = Math.max(...cats.map((_, i) => sers.reduce((a, s) => a + (s.val[i] || 0), 0)), 0);
      const step = (() => { const raw = (mx - mn) / 5 || 1, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; })(); mx = Math.ceil(mx / step) * step; mn = Math.floor(mn / step) * step;
      const L = 58, R = 14, T = top, Bm = H - bot, xs = i => L + (i + .5) / n * (W - L - R), ys = v => Bm - (v - mn) / (mx - mn || 1) * (Bm - T);
      for (let v = mn; v <= mx + 1e-9; v += step) { const y = ys(v); add('line', { x1: L, x2: W - R, y1: y, y2: y, stroke: '#e1e4ea', 'stroke-width': 1 }); add('text', { x: L - 6, y: y + 5, 'text-anchor': 'end', 'font-size': 16, fill: '#555' }, +v.toFixed(6)); }
      cats.forEach((cn, i) => add('text', { x: xs(i), y: Bm + 22, 'text-anchor': 'middle', 'font-size': 16, fill: '#555' }, String(cn).slice(0, 14))); add('line', { x1: L, x2: W - R, y1: ys(0), y2: ys(0), stroke: '#999' });
      if (/bar/.test(kind)) { const gw = (W - L - R) / n, bw = stacked ? gw * .6 : gw * .72 / sers.length; sers.forEach((s, si) => s.val.forEach((v, i) => { if (!isFinite(v)) return; const base = stacked ? sers.slice(0, si).reduce((a, q) => a + (q.val[i] || 0), 0) : 0, y0 = ys(base), y1 = ys(base + v), x = stacked ? xs(i) - bw / 2 : xs(i) - gw * .36 + si * bw; add('rect', { x, y: Math.min(y0, y1), width: bw * .94, height: Math.abs(y0 - y1), fill: s.color }); })); }
      else sers.forEach(s => { const pts = s.val.map((v, i) => [xs(i), ys(v)]).filter(p => isFinite(p[1])); if (!pts.length) return; if (kind === 'area') add('path', { d: 'M' + pts[0][0] + ',' + ys(0) + ' L' + pts.map(p => p.join(',')).join(' L') + ' L' + pts[pts.length - 1][0] + ',' + ys(0) + ' Z', fill: s.color, opacity: .55 }); add('polyline', { points: pts.map(p => p.join(',')).join(' '), fill: 'none', stroke: s.color, 'stroke-width': 2.4 }); pts.forEach(p => add('circle', { cx: p[0], cy: p[1], r: 3.2, fill: s.color })); });
      if (legend) sers.forEach((s, i) => { const x = L + i * Math.min(150, (W - L) / sers.length); add('rect', { x, y: H - 20, width: 10, height: 10, fill: s.color }); add('text', { x: x + 14, y: H - 11, 'font-size': 16, fill: '#444' }, s.name); });
    }
    box.appendChild(svg); return true;
  };
  Renderer.prototype.drawTable = async function (tbl, rels, box, P) {
    const cols = kids(path(tbl, 'tblGrid'), 'gridCol').map(c => num(c, 'w', 0)), rows = kids(tbl, 'tr'), pr = path(tbl, 'tblPr'), first = attr(pr, 'firstRow', '0') === '1', band = attr(pr, 'bandRow', '0') === '1';
    const t = document.createElement('table'); t.style.cssText = 'position:absolute;left:0;top:0;border-collapse:collapse;table-layout:fixed;width:' + px(P.w) + 'px'; const cg = document.createElement('colgroup'); cols.forEach(w => { const c = document.createElement('col'); c.style.width = px(w) + 'px'; cg.appendChild(c); }); t.appendChild(cg);
    const accent = (this.S.theme.colors.accent1 && '#' + this.S.theme.colors.accent1) || '#4472C4';
    for (let ri = 0; ri < rows.length; ri++) {
      const tr = document.createElement('tr'); tr.style.height = px(num(rows[ri], 'h', 0)) + 'px';
      for (const tc of kids(rows[ri], 'tc')) {
        if (attr(tc, 'hMerge', '0') === '1' || attr(tc, 'vMerge', '0') === '1') continue; const cell = document.createElement('td'), gs = num(tc, 'gridSpan', 1), rs = num(tc, 'rowSpan', 1); if (gs > 1) cell.colSpan = gs; if (rs > 1) cell.rowSpan = rs;
        const pr2 = kid(tc, 'tcPr'), f = fillCss(pr2, this.ctx()); let bg = f && f.css, ink = null; if (!bg && !(f && f.none)) { if (first && ri === 0) { bg = accent; ink = '#fff'; } else if (band) bg = ri % 2 ? 'rgba(68,114,196,.12)' : 'rgba(68,114,196,.04)'; }
        cell.style.cssText = 'box-sizing:border-box;vertical-align:' + ({ ctr: 'middle', b: 'bottom' }[attr(pr2, 'anchor', 't')] || 'top') + ';padding:' + px(num(pr2, 'marT', 45720)) + 'px ' + px(num(pr2, 'marR', 91440)) + 'px ' + px(num(pr2, 'marB', 45720)) + 'px ' + px(num(pr2, 'marL', 91440)) + 'px;overflow:hidden;' + (bg ? 'background:' + bg + ';' : '') + 'border:1px solid #d5d9e0';
        const tb = kid(tc, 'txBody'); if (tb) await this.drawText(tb, tc, null, cell, { w: P.w / (cols.length || 1) * gs, h: 0 }, { table: true, ink, bold: first && ri === 0 }); tr.appendChild(cell);
      } t.appendChild(tr);
    } box.appendChild(t);
  };
  Renderer.prototype.drawText = async function (tb, sp, key, box, P, o) {
    o = o || {}; const S = this.S, bp = kid(tb, 'bodyPr'), inh = key ? (S.layout && findPh(S.layout.tree, key)) || (S.master && findPh(S.master.tree, key)) : null, ibp = inh ? path(inh, 'txBody', 'bodyPr') : null, chain = styleChain(S, sp, key);
    const bpA = (n, d) => attr(bp, n, attr(ibp, n, d)), anchor = bpA('anchor', 't'), wrap = bpA('wrap', 'square'), vert = bpA('vert', 'horz');
    const lI = px(+bpA('lIns', 91440)), tI = px(+bpA('tIns', 45720)), rI = px(+bpA('rIns', 91440)), bI = px(+bpA('bIns', 45720));
    const na = bp && kid(bp, 'normAutofit') || (ibp && kid(ibp, 'normAutofit')); const fscale = na ? num(na, 'fontScale', 100000) / 100000 : 1, lred = na ? num(na, 'lnSpcReduction', 0) / 100000 : 0;
    const wrapEl = document.createElement('div'); wrapEl.className = 'pp-t'; const jc = { ctr: 'center', b: 'flex-end', t: 'flex-start' }[anchor] || 'flex-start';
    if (!o.table) wrapEl.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;justify-content:' + jc + ';padding:' + tI + 'px ' + rI + 'px ' + bI + 'px ' + lI + 'px;box-sizing:border-box;' + (wrap === 'none' ? 'white-space:nowrap;' : 'overflow-wrap:break-word;') + (vert !== 'horz' ? 'writing-mode:vertical-rl;' : '');
    const fr = kid(kid(sp, 'style'), 'fontRef'), fontRefInk = fr ? colorOf(fr, this.ctx()) : null, counters = {}; let lastLvl = -1;
    for (const p of kids(tb, 'p')) {
      const pPr = kid(p, 'pPr'), lvl = num(pPr, 'lvl', 0), base = lvlProps(chain, lvl), own = pPr ? collectP(pPr) : {}, pp = Object.assign({}, base, own), dr = Object.assign({}, base.r || {});
      const dEl = pPr && kid(pPr, 'defRPr'); if (dEl) Object.assign(dr, collectR(dEl));
      const para = document.createElement('div'); para.className = 'pp-p'; para.style.textAlign = ({ ctr: 'center', r: 'right', just: 'justify', l: 'left' })[pp.algn || 'l'] || 'left';
      const marL = px(+(pp.marL || 0)), ind = px(+(pp.indent || 0)); if (!o.table || marL) para.style.paddingLeft = marL + 'px'; if (ind) para.style.textIndent = ind + 'px';
      const sz0 = (dr.sz ? +dr.sz / 100 : 18) * fscale * (4 / 3), lnS = pp.lnSpc; para.style.lineHeight = lnS ? (lnS.pct ? (lnS.pct - lred).toFixed(3) : (lnS.pts * 4 / 3) + 'px') : (1.2 - lred).toFixed(3);
      const sb = pp.spcBef, sa = pp.spcAft; para.style.marginTop = (sb ? (sb.pct ? sb.pct * sz0 * 1.2 : sb.pts * 4 / 3) : 0) + 'px'; para.style.marginBottom = (sa ? (sa.pct ? sa.pct * sz0 * 1.2 : sa.pts * 4 / 3) : 0) + 'px';
      const runs = kids(p).filter(c => /^(r|br|fld)$/.test(c.localName)), empty = !runs.some(c => c.localName !== 'br' && ((kid(c, 't') || {}).textContent || '').length), bu = pp.bu;
      if (!o.table && bu && !bu.none && !empty) {
        let mark = ''; if (bu.ch) mark = bu.ch; else if (bu.auto) { counters[lvl] = (counters[lvl] || bu.start - 1) + 1; mark = counters[lvl] + (/ParenR/.test(bu.auto) ? ')' : '.'); Object.keys(counters).forEach(k => { if (+k > lvl) delete counters[k]; }); }
        if (/^[\uF0A7\uF0B7\uF076\uF0D8\uF0FC]/.test(mark) || (pp.buFont && /Wingdings/i.test(pp.buFont))) mark = ({ '\uF0A7': '▪', '\uF0B7': '•', '\uF076': '❖', '\uF0D8': '➢', '\uF0FC': '✓' })[mark] || '•';
        const b = document.createElement('span'); b.className = 'pp-bu'; b.textContent = mark; Object.assign(b.style, { display: 'inline-block', width: Math.max(Math.abs(ind), 14) + 'px', textIndent: '0', flex: 'none', fontFamily: 'Arial, "Segoe UI Symbol", sans-serif', color: pp.buClr ? colorOf(pp.buClr, this.ctx()) : '' }); if (ind >= 0) para.style.textIndent = '0'; para.appendChild(b);
      }
      lastLvl = lvl; if (!(bu && bu.auto)) Object.keys(counters).forEach(k => delete counters[k]);
      const ownLst = path(sp, 'txBody', 'lstStyle'), ownR = ownLst ? lvlProps([ownLst], lvl).r : null, ownFill = ownR ? ownR.fillEl : null, pDef = dEl ? collectR(dEl) : null; let firstCol = null, firstSz = null;
      for (const r of runs) {
        if (r.localName === 'br') { para.appendChild(document.createElement('br')); continue; }
        const rp = r.localName === 'fld' && !kid(r, 'rPr') ? {} : collectR(kid(r, 'rPr') || r), rr = Object.assign({}, dr, rp); let txt = (kid(r, 't') || {}).textContent || '';
        if (r.localName === 'fld') { const ty = attr(r, 'type', ''); if (/slidenum/i.test(ty)) txt = String((this.opt.index || 0) + 1); else if (/datetime/i.test(ty)) txt = txt || new Date().toLocaleDateString(); }
        const s = document.createElement('span'); s.textContent = txt; const sz = (rr.sz ? +rr.sz / 100 : 18) * fscale; s.style.fontSize = (sz * 4 / 3).toFixed(2) + 'px'; s.style.fontFamily = fontFam(rr, S);
        if (rr.b === '1') s.style.fontWeight = '700'; if (rr.i === '1') s.style.fontStyle = 'italic'; const deco = []; if (rr.u && rr.u !== 'none') deco.push('underline'); if (rr.strike && rr.strike !== 'noStrike') deco.push('line-through'); if (deco.length) s.style.textDecoration = deco.join(' ');
        if (rr.baseline && +rr.baseline) { s.style.verticalAlign = +rr.baseline > 0 ? 'super' : 'sub'; s.style.fontSize = (sz * 4 / 3 * .7).toFixed(2) + 'px'; }
        const cx = this.ctx(), col = (rp.fillEl ? colorOf(rp.fillEl, cx) : null) || (pDef && pDef.fillEl ? colorOf(pDef.fillEl, cx) : null) || o.ink || (ownFill ? colorOf(ownFill, cx) : null) || fontRefInk || (dr.fillEl ? colorOf(dr.fillEl, cx) : null);
        const ink = col || this.defaultInk(sp, key); s.style.color = ink; if (firstCol == null && txt) { firstCol = ink; firstSz = sz * 4 / 3; } if (o.bold) s.style.fontWeight = '700'; para.appendChild(s);
      }
      const bu0 = para.querySelector('.pp-bu'); if (bu0) { if (firstSz) bu0.style.fontSize = firstSz.toFixed(2) + 'px'; if (!bu0.style.color && firstCol) bu0.style.color = firstCol; }
      if (empty) { para.innerHTML = '&nbsp;'; para.style.fontSize = (((dr.sz ? +dr.sz / 100 : 18) * fscale) * 4 / 3) + 'px'; }
      wrapEl.appendChild(para);
    }
    if (o.table) { while (wrapEl.firstChild) box.appendChild(wrapEl.firstChild); } else box.appendChild(wrapEl);
  };
  Renderer.prototype.defaultInk = function (sp) { const c = this.S.theme.colors, cm = this.S.clrMap || {}; return '#' + (c[cm.tx1 || 'dk1'] || '000000'); };

  async function renderSlide(M, i) {
    const S = await loadSlide(M, i), R = new Renderer(M, S, { index: i }), root = document.createElement('div'); root.className = 'sc'; root.style.width = M.w + 'px'; root.style.height = M.h + 'px'; root.style.overflow = 'hidden'; root.style.fontFamily = fontFam({}, S); root.style.color = '#000';
    await R.bgOf(root); const master = S.master, layout = S.layout;
    if (master && (!layout || layout.showMasterSp)) await R.drawTree(master.tree, master.rels, root, null, true);
    if (layout) await R.drawTree(layout.tree, layout.rels, root, null, true);
    S.dt = M.defaultText; await R.drawTree(S.tree, S.rels, root, null, false);
    return { el: root, simplified: R.simplified, S };
  }
  const scaleTo = (sc, M, wpx) => { const k = wpx / M.w; sc.style.transform = 'scale(' + k + ')'; return k; };
  const collectText = tree => { let s = ''; const walk = e => { for (const c of kids(e)) { if (c.localName === 'sp' || c.localName === 'graphicFrame') s += ' ' + Array.from(c.getElementsByTagNameNS(NS.a, 't')).map(x => x.textContent).join(' '); else if (c.localName === 'grpSp' || c.localName === 'AlternateContent') walk(c); } }; walk(tree); return s; };

  /* ============================== viewer UI ============================== */
  async function open(t, root) {
    const h = SL.U && SL.U.h ? SL.U.h : (tag, a, html) => { const e = document.createElement(tag); for (const k in a || {}) e.setAttribute(k, a[k]); if (html != null) e.innerHTML = html; return e; };
    const fs = SL.fs, bytes = await fs.readBytes(t.path), t0 = performance.now(), M = await parse(bytes);
    const wrap = h('div', { class: 'hv-wrap' }); root.appendChild(wrap); root.style.display = 'flex'; root.style.flexDirection = 'column';
    const tools = h('div', { class: 'view-tools' }), mkBtn = (txt, fn, cls) => { const b = h('button', { class: 'btn sm' + (cls ? ' ' + cls : ''), type: 'button' }, txt); b.onclick = fn; tools.appendChild(b); return b; };
    const info = h('span', { class: 'muted', style: 'font-size:12px' });
    const hf = mkBtn('高保真（Office / LibreOffice）', async () => { hf.disabled = true; hf.textContent = '转换中…'; try { const out = await convertCached(t); t.el.innerHTML = ''; const r = h('div', { class: 'vw' }); t.el.appendChild(r); t.root = r; await SL.viewers.pdfFromBytes(Object.assign(t, { pdfPath: out }), r, await fs.readBytes(out)); } catch (e) { SL.toast && SL.toast(String(e), 4500, 'bad'); hf.disabled = false; hf.textContent = '高保真（Office / LibreOffice）'; } }, 'primary');
    mkBtn('转为 Markdown 幻灯片', async () => { try { const sl = await SL.X.readPptx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); const md = sl.map((s, i) => (i ? '## ' : '# ') + (s.title || '第 ' + (i + 1) + ' 页') + '\n\n' + s.body.map(p => '  '.repeat(p.lvl) + '- ' + p.text).join('\n') + (s.tables.length ? '\n\n' + s.tables.map(SL.X.tableToMd).join('\n\n') : '') + (s.notes ? '\n\n<!-- notes: ' + s.notes + ' -->' : '')).join('\n\n---\n\n'); SL.newDoc(md, t.name.replace(/\.pptx$/i, '.md')); } catch (e) { SL.toast && SL.toast('转换失败：' + e, 3500, 'bad'); } });
    const thB = mkBtn('缩略图', () => { pp.classList.toggle('nothumbs'); thB.classList.toggle('on', !pp.classList.contains('nothumbs')); layout(); }, 'on');
    const ntB = mkBtn('备注', () => { notes = !notes; ntB.classList.toggle('on', notes); mount(); }, '');
    tools.appendChild(h('span', { class: 'vsep' })); const zoom = h('select', { class: 'select', style: 'height:26px;width:94px' }, '<option value="fit">适应宽度</option><option value="0.75">75%</option><option value="1">100%</option><option value="1.25">125%</option><option value="1.5">150%</option>'); tools.appendChild(zoom);
    const q = h('input', { class: 'input', placeholder: '搜索幻灯片文字', style: 'width:180px;height:26px' }); tools.appendChild(q); tools.appendChild(h('span', { style: 'flex:1' })); tools.appendChild(info);
    const pp = h('div', { class: 'pp' }), rail = h('div', { class: 'pp-rail' }), main = h('div', { class: 'pp-main' }); pp.append(rail, main); wrap.append(tools, pp); pp.style.flex = '1';
    let notes = false, zoomV = 'fit', cur = 0, texts = null, filter = null; const slideBox = [], thumbBox = [];
    const W = () => Math.max(260, zoomV === 'fit' ? Math.min(1180, main.clientWidth - 56) : M.w * +zoomV);
    async function drawInto(b) { try { const r = await renderSlide(M, b._i); b.innerHTML = ''; b.appendChild(r.el); scaleTo(r.el, M, b._w()); if (r.simplified) info.textContent = '部分对象为简化显示 · 点击“高保真”'; } catch (e) { b.innerHTML = '<div class="ph">无法渲染此页：' + String(e.message || e).slice(0, 80) + '</div>'; console.warn('[pptx] slide', b._i + 1, e); } }
    const ioCb = es => { for (const e of es) if (e.isIntersecting) { const b = e.target; if (!b._done) { b._done = true; drawInto(b); } } };
    const io = new IntersectionObserver(ioCb, { root: main, rootMargin: '900px 0px' }), io2 = new IntersectionObserver(ioCb, { root: rail, rootMargin: '600px 0px' });
    function mount() {
      io.disconnect(); io2.disconnect(); main.innerHTML = ''; rail.innerHTML = ''; slideBox.length = 0; thumbBox.length = 0; const w = W(), hgt = w * M.H / M.W;
      for (let i = 0; i < M.N; i++) {
        if (filter && !filter.has(i)) continue; const s = h('div', { class: 'pp-slide', 'data-i': i }); s.style.width = w + 'px'; s.style.height = hgt + 'px'; s._i = i; s._w = () => parseFloat(s.style.width); s.innerHTML = '<div class="ph">第 ' + (i + 1) + ' 页</div>'; main.appendChild(s); slideBox[i] = s; io.observe(s);
        if (notes) { const nb = h('div', { class: 'pp-s-notes' }, '<b>备注</b><span>…</span>'); main.appendChild(nb); loadSlide(M, i).then(S => { nb.lastChild.textContent = S.notes || '（无）'; }); }
        const th = h('button', { class: 'pp-th' + (i === cur ? ' on' : ''), type: 'button', 'data-i': i }), bx = h('div', { class: 'box' }), tw = 164; bx.style.height = (tw * M.H / M.W) + 'px'; bx._i = i; bx._w = () => tw; th.appendChild(bx); th.appendChild(h('span', { class: 'no' }, String(i + 1))); rail.appendChild(th); thumbBox[i] = bx; io2.observe(bx);
      }
      info.textContent = (filter ? filter.size + ' / ' : '') + M.N + ' 页 · ' + Math.round(M.w) + '×' + Math.round(M.h);
    }
    function layout() { const w = W(); slideBox.forEach(s => { if (!s) return; s.style.width = w + 'px'; s.style.height = (w * M.H / M.W) + 'px'; const sc = s.querySelector('.sc'); if (sc) scaleTo(sc, M, w); }); }
    function go(i) { cur = Math.max(0, Math.min(M.N - 1, i)); const s = slideBox[cur]; if (s) s.scrollIntoView({ block: 'start', behavior: 'auto' }); rail.querySelectorAll('.pp-th').forEach(x => x.classList.toggle('on', +x.dataset.i === cur)); }
    rail.addEventListener('click', e => { const b = e.target.closest('.pp-th'); if (b) go(+b.dataset.i); });
    zoom.onchange = () => { zoomV = zoom.value; layout(); };
    let rt = 0; new ResizeObserver(() => { cancelAnimationFrame(rt); rt = requestAnimationFrame(() => { if (zoomV === 'fit') layout(); }); }).observe(main);
    main.addEventListener('scroll', () => { let best = cur, bd = 1e9; const top = main.scrollTop + 40; for (const s of slideBox) { if (!s) continue; const dd = Math.abs(s.offsetTop - top); if (dd < bd) { bd = dd; best = s._i; } } if (best !== cur) { cur = best; rail.querySelectorAll('.pp-th').forEach(x => x.classList.toggle('on', +x.dataset.i === cur)); const th = rail.querySelector('.pp-th.on'); if (th) th.scrollIntoView({ block: 'nearest' }); } }, { passive: true });
    q.addEventListener('input', async () => { const v = q.value.trim().toLowerCase(); if (!v) { filter = null; mount(); return; } if (!texts) { texts = []; for (let i = 0; i < M.N; i++) { const S = await loadSlide(M, i); texts[i] = (collectText(S.tree) + ' ' + S.notes).toLowerCase(); } } filter = new Set(texts.map((x, i) => x.includes(v) ? i : -1).filter(i => i >= 0)); mount(); });
    const keys = e => { if (!root.isConnected) return document.removeEventListener('keydown', keys); if (!t.el || t.el.classList.contains('hide')) return; if (e.target.closest('input,textarea,select')) return; if (e.key === 'PageDown' || e.key === 'ArrowRight') { go(cur + 1); e.preventDefault(); } else if (e.key === 'PageUp' || e.key === 'ArrowLeft') { go(cur - 1); e.preventDefault(); } else if (e.key === 'Home') go(0); else if (e.key === 'End') go(M.N - 1); };
    document.addEventListener('keydown', keys);
    mount(); t.viewer = { destroy() { io.disconnect(); io2.disconnect(); M.media.forEach(p => p.then(v => v && v.url && URL.revokeObjectURL(v.url))); document.removeEventListener('keydown', keys); }, goPage: n => go(n - 1), get page() { return cur + 1; }, N: M.N, model: M };
    t.parseMs = Math.round(performance.now() - t0);
  }
  async function convertCached(t) {
    const key = 'pptpdf.' + (SL.X && SL.X.hash ? SL.X.hash(SL.U.pkey(t.path)) : t.path); let mt = 0; try { mt = await SL.fs.mtime(t.path); } catch (e) { }
    const c = SL.store ? await SL.store.get(key, null) : null; if (c && c.mt === mt) { try { if ((await SL.fs.kind(c.out)) === 'file') return c.out; } catch (e) { } }
    const out = await SL.invoke('office_to_pdf', { path: t.path }); if (SL.store) await SL.store.set(key, { mt, out }); return out;
  }
  SL.s31.pptx = { open, parse, renderSlide, loadSlide, Zip, colorOf };
})(window);
