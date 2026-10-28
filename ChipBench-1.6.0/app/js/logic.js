/* ChipBench · logic.js — pure data logic (no DOM except DOMParser in readers). Unit-tested in Node: tests/logic.test.js */
(function (G) {
  'use strict';
  const X = {};
  /* ---------- util ---------- */
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return ymd(d); };
  const monday = s => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return ymd(d); };
  const isoWeek = s => { const d = new Date(s + 'T00:00:00'); const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const n = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - n); const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil(((t - y) / 864e5 + 1) / 7); };
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const base = p => String(p).replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  const dir = p => String(p).replace(/[\\/]+$/, '').replace(/[\\/][^\\/]*$/, '');
  const ext = p => (base(p).match(/\.([^.]+)$/) || ['', ''])[1].toLowerCase();
  const pkey = p => String(p || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  const sep = p => (String(p).includes('\\') ? '\\' : '/');
  const join = (d, n) => String(d).replace(/[\\/]+$/, '') + sep(d) + n;
  const isAbs = p => /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\\\');
  const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
  Object.assign(X, { pad, ymd, addDays, monday, isoWeek, esc, uid, base, dir, ext, pkey, join, isAbs, hash });
  const relTo = (from, to) => { const a = String(from).replace(/[\\/]+$/, '').split(/[\\/]/), b = String(to).split(/[\\/]/); let i = 0; while (i < a.length && i < b.length - 1 && a[i].toLowerCase() === b[i].toLowerCase()) i++; return '../'.repeat(a.length - i) + b.slice(i).join('/'); };
  const resolveRel = (baseDir, rel) => { if (isAbs(rel)) return rel; const s = sep(baseDir), parts = String(baseDir).split(/[\\/]/); for (const x of rel.split(/[\\/]/)) { if (x === '..') parts.pop(); else if (x && x !== '.') parts.push(x); } return parts.join(s); };
  X.relTo = relTo; X.resolveRel = resolveRel;
  const under = (root, p) => { const a = pkey(root) + '\\', b = pkey(p); return b.startsWith(a) ? String(p).slice(String(root).replace(/[\\/]+$/, '').length + 1).replace(/\\/g, '/') : null; };
  X.under = under;

  /* ---------- YAML subset ---------- */
  function scalar(s) {
    s = s.trim();
    if (s === '' || s === '~' || s === 'null') return null;
    if (/^(true|yes)$/i.test(s)) return true; if (/^(false|no)$/i.test(s)) return false;
    if (/^["'].*["']$/.test(s)) return s.slice(1, -1);
    if (/^-?0x[0-9a-f_]+$/i.test(s)) return parseInt(s.replace(/_/g, ''), 16);
    if (/^-?\d+(\.\d+)?(e-?\d+)?$/i.test(s)) return Number(s);
    if (s[0] === '[' || s[0] === '{') return inl(s);
    return s;
  }
  function splitTop(s) { const o = []; let d = 0, q = null, c = ''; for (const ch of s) { if (q) { c += ch; if (ch === q) q = null; continue; } if (ch === '"' || ch === "'") { q = ch; c += ch; continue; } if ('[{'.includes(ch)) d++; if (']}'.includes(ch)) d--; if (ch === ',' && !d) { o.push(c); c = ''; continue; } c += ch; } if (c.trim()) o.push(c); return o; }
  function inl(s) { s = s.trim(); if (s[0] === '[') return splitTop(s.slice(1, -1)).map(scalar); const o = {}; for (const kv of splitTop(s.slice(1, -1))) { const i = kv.indexOf(':'); if (i < 0) continue; o[kv.slice(0, i).trim().replace(/^["']|["']$/g, '')] = scalar(kv.slice(i + 1)); } return o; }
  function yaml(text) {
    const L = text.replace(/\t/g, '  ').split('\n').map(l => l.replace(/\s+#(?![^"']*["']).*$/, '').replace(/^\s*#.*$/, '')).filter(l => l.trim() && l.trim() !== '---');
    let i = 0; const ind = l => l.match(/^ */)[0].length;
    function block(lv) {
      if (i >= L.length) return null;
      if (/^\s*-(\s|$)/.test(L[i])) {
        const a = [];
        while (i < L.length && ind(L[i]) === lv && /^\s*-(\s|$)/.test(L[i])) {
          const rest = L[i].trim().slice(1).trim();
          if (!rest) { i++; a.push(i < L.length && ind(L[i]) > lv ? block(ind(L[i])) : null); continue; }
          const m = rest.match(/^([^:\[{"']+?):(\s+(.*)|$)/);
          if (m && !/^https?$/.test(m[1])) { L[i] = ' '.repeat(lv + 2) + rest; a.push(block(lv + 2)); } else { a.push(scalar(rest)); i++; }
        }
        return a;
      }
      const o = {};
      while (i < L.length && ind(L[i]) === lv) {
        const m = L[i].trim().match(/^([^:]+?):(?:\s+(.*))?$/); if (!m) { i++; continue; }
        const k = m[1].trim().replace(/^["']|["']$/g, ''), v = m[2]; i++;
        if (v != null && v.trim() !== '' && !/^[|>]$/.test(v.trim())) o[k] = scalar(v);
        else if (v && /^[|>]$/.test(v.trim())) { const b = []; while (i < L.length && ind(L[i]) > lv) b.push(L[i++].trim()); o[k] = b.join(v.trim() === '|' ? '\n' : ' '); }
        else if (i < L.length && ind(L[i]) > lv) o[k] = block(ind(L[i]));
        else if (i < L.length && ind(L[i]) === lv && /^\s*-\s/.test(L[i])) o[k] = block(lv);
        else o[k] = null;
      }
      return o;
    }
    return L.length ? block(ind(L[0])) : {};
  }
  function toYaml(v, p) {
    p = p || ''; const sc = x => x == null ? '~' : typeof x === 'string' ? (/[:#\[\]{},]|^\s|\s$|^$/.test(x) ? JSON.stringify(x) : x) : Array.isArray(x) ? '[' + x.map(sc).join(', ') + ']' : typeof x === 'object' ? '{' + Object.entries(x).map(([k, y]) => k + ': ' + sc(y)).join(', ') + '}' : String(x);
    if (Array.isArray(v)) return v.map(x => p + '- ' + sc(x)).join('\n');
    return Object.entries(v).map(([k, x]) => (x && typeof x === 'object') ? p + k + ':\n' + toYaml(x, p + '  ') : p + k + ': ' + sc(x)).join('\n');
  }
  Object.assign(X, { yaml, toYaml });
  /* front matter */
  X.frontMatter = text => { const m = text.match(/^---\n([\s\S]*?)\n(?:---|\.\.\.)[ \t]*(?:\n|$)/); if (!m) return { props: {}, body: text, end: 0 }; let props = {}; try { props = yaml(m[1]) || {}; } catch (e) { } return { props, body: text.slice(m[0].length), end: m[0].length, raw: m[1] }; };
  X.setFrontProp = (text, key, val) => {
    const fm = X.frontMatter(text);
    if (!fm.end) return '---\n' + key + ': ' + (val == null ? '' : val) + '\n---\n\n' + text;
    const lines = fm.raw.split('\n'); const re = new RegExp('^' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':'); const ix = lines.findIndex(l => re.test(l));
    const line = key + ': ' + (val == null ? '' : /[:#\[\]{},]/.test(String(val)) ? JSON.stringify(val) : val);
    if (ix >= 0) { if (val == null) lines.splice(ix, 1); else lines[ix] = line; } else if (val != null) lines.push(line);
    return '---\n' + lines.join('\n') + '\n---\n' + text.slice(fm.end);
  };

  /* ---------- units / clock tree ---------- */
  const UN = { '': 1, k: 1e3, K: 1e3, m: 1e-3, M: 1e6, G: 1e9, u: 1e-6, 'µ': 1e-6, n: 1e-9 };
  const parseFreq = v => { if (typeof v === 'number') return v; if (v == null) return NaN; const m = String(v).trim().match(/^(-?[\d.]+)\s*([kKMGmuµn]?)(hz|Hz|HZ)?$/); return m ? parseFloat(m[1]) * UN[m[2]] : NaN; };
  const fmtFreq = f => { if (!isFinite(f)) return '—'; const a = Math.abs(f), r = x => +x.toPrecision(6); return a >= 1e9 ? r(f / 1e9) + ' GHz' : a >= 1e6 ? r(f / 1e6) + ' MHz' : a >= 1e3 ? r(f / 1e3) + ' kHz' : r(f) + ' Hz'; };
  function clockCompute(model) {
    const nodes = (model.nodes || []).map(n => Object.assign({}, n)); const by = new Map(nodes.map(n => [n.id, n])); const issues = [];
    const ins = n => n.in == null ? [] : Array.isArray(n.in) ? n.in : [n.in];
    function f(id, st) {
      const n = by.get(id); if (!n) return NaN; if (n._f !== undefined) return n._f;
      if (st.has(id)) { issues.push({ id, msg: '时钟环路', kind: 'loop' }); return NaN; } st.add(id);
      const I = ins(n), kind = (n.kind || (I.length ? 'div' : 'source')).toLowerCase(); let v;
      if (kind === 'source') v = parseFreq(n.freq);
      else if (kind === 'mux') { const s = n.sel == null ? 0 : (typeof n.sel === 'number' ? n.sel : I.indexOf(n.sel)); v = f(I[s] != null ? I[s] : I[0], st); }
      else if (kind === 'gate') v = n.enable === false ? 0 : f(I[0], st);
      else v = f(I[0], st) * (n.mul || 1) / (n.div || 1) / (n.prediv || 1);
      n._f = v; st.delete(id);
      const mx = parseFreq(n.max), mn = parseFreq(n.min);
      if (isFinite(mx) && v > mx * (1 + 1e-9)) issues.push({ id, msg: n.label || n.id, kind: 'over', limit: mx, value: v });
      if (isFinite(mn) && v < mn * (1 - 1e-9) && v > 0) issues.push({ id, msg: n.label || n.id, kind: 'under', limit: mn, value: v });
      I.forEach(x => { if (!by.has(x)) issues.push({ id, msg: '未定义的输入 ' + x, kind: 'ref' }); });
      return v;
    }
    nodes.forEach(n => f(n.id, new Set()));
    const edges = []; nodes.forEach(n => ins(n).forEach((x, k) => { if (by.has(x)) edges.push({ from: x, to: n.id, active: (n.kind || '').toLowerCase() !== 'mux' || k === (typeof n.sel === 'number' ? n.sel : Math.max(0, ins(n).indexOf(n.sel))) }); }));
    nodes.forEach(n => { n.freq_out = n._f; delete n._f; });
    return { nodes, edges, issues };
  }
  X.parseFreq = parseFreq; X.fmtFreq = fmtFreq; X.clockCompute = clockCompute;
  X.compareClock = (a, b) => { const A = clockCompute(a).nodes, B = clockCompute(b).nodes; const m = new Map(B.map(n => [n.id, n])); const rows = A.map(n => { const o = m.get(n.id); return { id: n.id, label: n.label || n.id, a: n.freq_out, b: o ? o.freq_out : NaN, diff: !o || Math.abs((o.freq_out || 0) - (n.freq_out || 0)) > 1e-6 }; }); B.forEach(n => { if (!A.find(x => x.id === n.id)) rows.push({ id: n.id, label: n.label || n.id, a: NaN, b: n.freq_out, diff: true }); }); return rows; };
  X.baudError = (clk, baud, os) => { os = os || 16; const div = Math.max(1, Math.round(clk / (os * baud))); const actual = clk / (os * div); return { div, actual, errorPct: (actual - baud) / baud * 100 }; };
  X.canBitTiming = (clk, rate, o) => { o = o || {}; const tg = o.sample || 0.8, out = []; for (let p = 1; p <= (o.maxPresc || 64); p++) { const tq = clk / p / rate, n = Math.round(tq); if (n < (o.minTq || 8) || n > (o.maxTq || 25) || Math.abs(tq - n) > 1e-6) continue; const t2 = Math.max(1, Math.round(n * (1 - tg))), t1 = n - 1 - t2; out.push({ presc: p, tq: n, tseg1: t1, tseg2: t2, sjw: Math.min(t2, o.sjw || t2), sample: (1 + t1) / n }); } return out.sort((a, b) => Math.abs(a.sample - tg) - Math.abs(b.sample - tg) || b.tq - a.tq); };

  /* ---------- structure diagrams ---------- */
  X.structNormalize = model => {
    const nodes = (model.nodes || []).filter(n => n && n.id != null).map(n => Object.assign({ status: 'unverified' }, n, { id: String(n.id) })); const ids = new Set(nodes.map(n => n.id)); const edges = [];
    (model.edges || []).forEach(e => { if (e && ids.has(String(e.from)) && ids.has(String(e.to))) edges.push(Object.assign({}, e, { from: String(e.from), to: String(e.to) })); });
    nodes.forEach(n => { (n.in == null ? [] : [].concat(n.in)).forEach(x => { x = String(x); if (ids.has(x) && !edges.some(e => e.from === x && e.to === n.id)) edges.push({ from: x, to: n.id }); }); });
    nodes.forEach(n => { if (n.page == null && n.status === 'verified') n.status = 'unverified'; });
    const st = { verified: 0, unverified: 0, doubt: 0 }; nodes.forEach(n => st[n.status in st ? n.status : 'unverified']++);
    return { nodes, edges, stats: st };
  };
  X.layout = (nodes, edges, o) => {
    o = Object.assign({ w: 168, h: 52, gx: 64, gy: 22, dir: 'LR' }, o || {});
    const id2 = new Map(nodes.map((n, i) => [n.id, i])), pr = nodes.map(() => []); edges.forEach(e => { const a = id2.get(e.from), b = id2.get(e.to); if (a != null && b != null && a !== b) pr[b].push(a); });
    const rank = new Array(nodes.length).fill(-1), vis = new Set(); const rk = i => { if (rank[i] >= 0) return rank[i]; if (vis.has(i)) return 0; vis.add(i); let r = 0; for (const p of pr[i]) r = Math.max(r, rk(p) + 1); vis.delete(i); return rank[i] = r; }; nodes.forEach((_, i) => rk(i));
    const layers = []; nodes.forEach((n, i) => (layers[rank[i]] = layers[rank[i]] || []).push(i)); const order = new Array(nodes.length); layers.forEach(L => L.forEach((i, k) => order[i] = k));
    for (let it = 0; it < 4; it++) for (let r = 1; r < layers.length; r++) { const L = layers[r]; if (!L) continue; L.sort((a, b) => { const bc = i => pr[i].length ? pr[i].reduce((s, p) => s + order[p], 0) / pr[i].length : order[i]; return bc(a) - bc(b); }); L.forEach((i, k) => order[i] = k); }
    const maxN = Math.max(1, ...layers.map(L => L ? L.length : 0)), pos = {};
    layers.forEach((L, r) => (L || []).forEach((i, k) => { const off = (maxN - L.length) / 2, a = r * (o.w + o.gx), b = (k + off) * (o.h + o.gy); pos[nodes[i].id] = o.dir === 'TB' ? { x: b, y: a, w: o.w, h: o.h } : { x: a, y: b, w: o.w, h: o.h }; }));
    return { pos, width: Math.max(o.dir === 'TB' ? maxN * (o.w + o.gy) : layers.length * (o.w + o.gx) - o.gx, o.w), height: Math.max(o.dir === 'TB' ? layers.length * (o.h + o.gx) - o.gx : maxN * (o.h + o.gy) - o.gy, o.h), layers: layers.length };
  };
  X.verifyAgainstText = (model, pages) => (model.nodes || []).map(n => {
    const txt = pages && n.page != null ? pages[n.page] : null; if (txt == null) return { id: n.id, ok: false, reason: '无页码或该页无文字' };
    const vals = [n.freq, n.max, n.label, n.note].filter(v => v != null).join(' ').match(/\d+(\.\d+)?\s*[kMG]?Hz|\b\d{2,}\b/g) || []; const nm = s => s.replace(/\s+/g, '').toLowerCase();
    const miss = vals.filter(v => !nm(txt).includes(nm(v))); return { id: n.id, ok: !miss.length, missing: miss };
  });
  /* learning-center models */
  X.regTree = (model, regs) => (model.nodes || []).map(n => { const pats = [].concat(n.regs || []).map(String); const hit = regs.filter(r => pats.some(p => r.name.toLowerCase().startsWith(p.toLowerCase().replace(/\*$/, '')))); return { id: n.id, label: n.label || n.id, regs: hit }; }).filter(x => x.regs.length);
  X.flowSteps = model => { const ids = new Set((model.nodes || []).map(n => String(n.id))); return (model.flow || []).map((s, i) => ({ i, node: String(s.node), text: s.text || '', page: s.page, ok: ids.has(String(s.node)) })); };
  X.crossChip = (A, B) => { const key = n => (n.label || n.id).toLowerCase().replace(/\s+/g, ''); const ma = new Map((A.nodes || []).map(n => [key(n), n])), mb = new Map((B.nodes || []).map(n => [key(n), n])); const out = []; ma.forEach((n, k) => { const o = mb.get(k); if (!o) out.push({ kind: 'removed', label: n.label || n.id, a: n }); else { const ch = ['kind', 'freq', 'mul', 'div', 'max', 'note'].filter(f => String(n[f] == null ? '' : n[f]) !== String(o[f] == null ? '' : o[f])); if (ch.length) out.push({ kind: 'changed', label: n.label || n.id, fields: ch, a: n, b: o }); } }); mb.forEach((n, k) => { if (!ma.has(k)) out.push({ kind: 'added', label: n.label || n.id, b: n }); }); return out; };
  X.initSeq = model => { const rank = { source: 0, pll: 1, mux: 2, div: 3, gate: 4 }; const c = clockCompute(model); const N = c.nodes.map((n, i) => Object.assign({}, n, { _i: i })); const order = (function () { const pr = new Map(N.map(n => [n.id, [].concat(n.in || [])])); const seen = new Set(), out = []; const v = id => { if (seen.has(id)) return; seen.add(id); (pr.get(id) || []).forEach(v); const n = N.find(x => x.id === id); if (n) out.push(n); }; N.slice().sort((a, b) => (rank[a.kind] ?? 5) - (rank[b.kind] ?? 5) || a._i - b._i).forEach(n => v(n.id)); return out; })(); const verb = { source: '启动并等待稳定', pll: '配置并锁定 PLL', mux: '选择时钟源', div: '设置分频', gate: '使能时钟门控' }; return order.map((n, i) => ({ step: i + 1, id: n.id, text: (verb[n.kind] || '使能 / 配置') + '：' + (n.label || n.id) + (isFinite(n.freq_out) && n.freq_out ? '（' + fmtFreq(n.freq_out) + '）' : ''), page: n.page })); };

  /* ---------- registers ---------- */
  const parseBits = b => { if (typeof b === 'number') return [b, b]; const m = String(b).match(/^\s*(\d+)\s*(?:[:\-]\s*(\d+))?\s*$/); if (!m) return null; const a = +m[1], c = m[2] != null ? +m[2] : a; return [Math.max(a, c), Math.min(a, c)]; };
  X.regNormalize = def => { const width = def.width || def.size || 32; const issues = []; const fields = (def.fields || []).map(f => { if (!f || typeof f !== 'object') return null; const hl = f.bits != null ? parseBits(f.bits) : f.offset != null ? [f.offset + (f.width || 1) - 1, f.offset] : null; if (!hl || !isFinite(hl[0]) || !isFinite(hl[1]) || hl[1] < 0) { issues.push((f.name || '?') + ' 的位定义 “' + (f.bits != null ? f.bits : '') + '” 无效'); return null; } return Object.assign({}, f, { hi: hl[0], lo: hl[1], w: hl[0] - hl[1] + 1 }); }).filter(Boolean).sort((a, b) => b.hi - a.hi); const used = new Array(width).fill(null); fields.forEach(f => { if (f.hi >= width) issues.push(f.name + ' 超出寄存器宽度'); for (let b = f.lo; b <= Math.min(f.hi, width - 1); b++) { if (used[b]) issues.push('位 ' + b + ' 被 ' + used[b] + ' 与 ' + f.name + ' 重复定义'); used[b] = f.name; } }); return { name: def.name || 'REG', address: def.address, width, reset: def.reset != null ? Number(def.reset) : 0, desc: def.desc, fields, issues }; };
  const big = v => BigInt.asUintN(64, BigInt(typeof v === 'string' ? (v.trim() || '0') : Math.trunc(v)));
  X.regDecode = (reg, value) => { const v = big(value); return reg.fields.map(f => { const x = Number((v >> BigInt(f.lo)) & ((1n << BigInt(f.w)) - 1n)); const vals = f.values || f.enum; return { name: f.name, hi: f.hi, lo: f.lo, w: f.w, value: x, meaning: vals ? (vals[x] != null ? vals[x] : vals[String(x)] != null ? vals[String(x)] : '') : '', access: f.access || '', desc: f.desc || '' }; }); };
  X.regEncode = (reg, values, baseV) => { let v = big(baseV == null ? reg.reset : baseV); reg.fields.forEach(f => { if (values[f.name] == null) return; const m = (1n << BigInt(f.w)) - 1n; v = (v & ~(m << BigInt(f.lo))) | ((big(values[f.name]) & m) << BigInt(f.lo)); }); return Number(BigInt.asUintN(reg.width, v)); };
  X.parseSVD = xml => { const doc = new DOMParser().parseFromString(xml, 'application/xml'); const tx = (el, t) => { const x = el && Array.from(el.children).find(c => c.tagName === t); return x ? x.textContent.trim() : null; }; const out = []; doc.querySelectorAll('peripheral').forEach(p => { const pn = tx(p, 'name'), bs = parseInt(tx(p, 'baseAddress') || '0'); p.querySelectorAll('registers > register').forEach(r => { const fields = Array.from(r.querySelectorAll('fields > field')).map(f => { const lo = tx(f, 'bitOffset'), w = tx(f, 'bitWidth'), rg = tx(f, 'bitRange'), lsb = tx(f, 'lsb'), msb = tx(f, 'msb'); let bits; if (rg) { const m = rg.match(/\[(\d+):(\d+)\]/); bits = m[1] + ':' + m[2]; } else if (lsb != null) bits = msb + ':' + lsb; else bits = (+lo + +(w || 1) - 1) + ':' + lo; const values = {}; f.querySelectorAll('enumeratedValue').forEach(ev => { const val = tx(ev, 'value'); if (val != null) values[Number(val) || 0] = tx(ev, 'name') + (tx(ev, 'description') ? ' — ' + tx(ev, 'description') : ''); }); return { name: tx(f, 'name'), bits, access: tx(f, 'access') || '', desc: tx(f, 'description') || '', values: Object.keys(values).length ? values : undefined }; }); out.push({ name: pn + '.' + tx(r, 'name'), address: bs + parseInt(tx(r, 'addressOffset') || '0'), width: parseInt(tx(r, 'size') || '32'), reset: parseInt(tx(r, 'resetValue') || '0'), desc: tx(r, 'description') || '', fields }); }); }); return out; };
  X.parseCHeaderRegs = src => { const pos = {}, msk = {}; src.replace(/#define\s+(\w+)_([A-Za-z0-9]+)_Pos\s+\(?\s*(\d+)U?\s*\)?/g, (_, r, f, p) => { (pos[r] = pos[r] || {})[f] = +p; }); src.replace(/#define\s+(\w+)_([A-Za-z0-9]+)_Msk\s+\(?\s*0x([0-9a-fA-F]+)U?L?\s*(<<)?/g, (_, r, f, h, sh) => { (msk[r] = msk[r] || {})[f] = { v: parseInt(h, 16), shifted: !!sh }; }); return Object.keys(pos).map(r => ({ name: r, width: 32, fields: Object.entries(pos[r]).map(([f, p]) => { const m = msk[r] && msk[r][f]; let w = 1; if (m) { const v = m.shifted ? m.v : Math.floor(m.v / 2 ** p); w = Math.max(1, v.toString(2).length); } return { name: f, bits: (p + w - 1) + ':' + p }; }) })); };
  X.inspectNumber = tok => { const t = String(tok).trim().replace(/_/g, ''); let v; if (/^0x[0-9a-f]+$/i.test(t) || /^0b[01]+$/i.test(t) || /^-?\d+$/.test(t)) v = BigInt(t); else if (/^[0-9a-f]+h$/i.test(t)) v = BigInt('0x' + t.slice(0, -1)); else return null; const neg = v < 0n, a = neg ? -v : v; const bits = []; for (let i = 0; i < 64 && (a >> BigInt(i)) > 0n; i++) if ((a >> BigInt(i)) & 1n) bits.push(i); const bin = a.toString(2), hx = a.toString(16).toUpperCase(); return { dec: v.toString(), hex: (neg ? '-' : '') + '0x' + hx, bin: (neg ? '-' : '') + '0b' + bin.replace(/\B(?=(\d{4})+(?!\d))/g, '_'), bitLen: bin.length, setBits: bits, kib: a >= 1024n ? (Number(a) / 1024).toFixed(Number(a) % 1024 ? 2 : 0) + ' KiB' : '' }; };
  X.calc = expr => { let e = expr.replace(/\s+/g, '').replace(/×/g, '*').replace(/÷/g, '/'); if (!e || !/^[0-9a-fA-FxXbBoO+\-*/%()<>&|^~.kKmM]+$/.test(e)) return null; e = e.replace(/(\d+(?:\.\d+)?)([kKmM])\b/g, (_, n, u) => '(' + n + '*' + ({ k: 1024, m: 1048576 })[u.toLowerCase()] + ')'); try { if (!/[./]/.test(e)) { const be = e.replace(/0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|\d+/g, m => 'BigInt("' + m + '")'); const v = Function('"use strict";return (' + be + ')')(); if (typeof v !== 'bigint') return null; const neg = v < 0n, a = neg ? -v : v; return { dec: v.toString(), hex: (neg ? '-' : '') + '0x' + a.toString(16).toUpperCase(), bin: (neg ? '-' : '') + '0b' + a.toString(2) }; } const v = Function('"use strict";return (' + e + ')')(); return typeof v === 'number' && isFinite(v) ? { dec: String(+v.toPrecision(12)), hex: '', bin: '' } : null; } catch (er) { return null; } };

  /* ---------- GNU ld map ---------- */
  X.parseMap = text => {
    const lines = text.replace(/\r/g, '').split('\n'), regions = [], sections = [], inputs = [], symbols = [];
    let i = lines.findIndex(l => /^Memory Configuration/.test(l));
    if (i >= 0) for (i += 1; i < lines.length; i++) { const l = lines[i]; if (/^Linker script and memory map/.test(l)) break; const m = l.match(/^(\S+)\s+0x([0-9a-f]+)\s+0x([0-9a-f]+)(?:\s+(\S+))?/i); if (m && m[1] !== '*default*' && m[1] !== 'Name') regions.push({ name: m[1], origin: parseInt(m[2], 16), length: parseInt(m[3], 16), attr: m[4] || '' }); }
    let cur = null, pO = null, pI = null; const st = lines.findIndex(l => /^Linker script and memory map/.test(l));
    for (let k = Math.max(0, st); k < lines.length; k++) {
      const l = lines[k]; let m;
      if (pO != null) { m = l.match(/^\s+0x([0-9a-f]+)\s+0x([0-9a-f]+)/i); if (m) { cur = { name: pO, addr: parseInt(m[1], 16), size: parseInt(m[2], 16) }; sections.push(cur); } pO = null; continue; }
      if (pI != null) { m = l.match(/^\s+0x([0-9a-f]+)\s+0x([0-9a-f]+)\s+(.+)$/i); if (m && cur) inputs.push({ section: cur.name, name: pI, addr: parseInt(m[1], 16), size: parseInt(m[2], 16), obj: m[3].trim() }); pI = null; continue; }
      if ((m = l.match(/^(\.[\w.$-]+)\s*$/))) { pO = m[1]; continue; }
      if ((m = l.match(/^(\.[\w.$-]+)\s+0x([0-9a-f]+)\s+0x([0-9a-f]+)/i))) { cur = { name: m[1], addr: parseInt(m[2], 16), size: parseInt(m[3], 16) }; sections.push(cur); continue; }
      if ((m = l.match(/^ (\.[\w.$-]+|COMMON)\s*$/))) { pI = m[1]; continue; }
      if ((m = l.match(/^ (\.[\w.$-]+|COMMON)\s+0x([0-9a-f]+)\s+0x([0-9a-f]+)\s+(.+)$/i))) { if (cur) inputs.push({ section: cur.name, name: m[1], addr: parseInt(m[2], 16), size: parseInt(m[3], 16), obj: m[4].trim() }); continue; }
      if ((m = l.match(/^\s{16,}0x([0-9a-f]+)\s+([A-Za-z_][\w$.]*)\s*$/i))) { symbols.push({ addr: parseInt(m[1], 16), name: m[2], section: cur ? cur.name : '' }); }
    }
    const regionOf = a => regions.find(r => a >= r.origin && a < r.origin + r.length), out = sections.filter(s => s.size > 0);
    out.forEach(s => { const r = regionOf(s.addr); s.region = r ? r.name : ''; });
    regions.forEach(r => { r.used = out.filter(s => s.region === r.name).reduce((a, s) => a + s.size, 0); r.pct = r.length ? r.used / r.length * 100 : 0; });
    const issues = [], sorted = out.slice().sort((a, b) => a.addr - b.addr);
    for (let k = 1; k < sorted.length; k++) { const p = sorted[k - 1], c = sorted[k]; if (c.addr < p.addr + p.size && p.region === c.region) issues.push({ kind: 'overlap', msg: p.name + ' 与 ' + c.name + ' 地址重叠' }); }
    out.forEach(s => { const r = regions.find(x => x.name === s.region); if (r && s.addr + s.size > r.origin + r.length) issues.push({ kind: 'overflow', msg: s.name + ' 超出 ' + r.name }); });
    regions.forEach(r => { if (r.used > r.length) issues.push({ kind: 'overflow', msg: r.name + ' 使用量超过容量' }); });
    const objTotals = {}; inputs.forEach(x => { const o = x.obj.replace(/^.*[\\/]/, ''); objTotals[o] = (objTotals[o] || 0) + x.size; });
    symbols.sort((a, b) => a.addr - b.addr);
    for (let k = 0; k < symbols.length; k++) { const nx = symbols[k + 1], sec = out.find(s => symbols[k].addr >= s.addr && symbols[k].addr < s.addr + s.size); symbols[k].size = nx && sec && nx.addr < sec.addr + sec.size ? nx.addr - symbols[k].addr : sec ? sec.addr + sec.size - symbols[k].addr : 0; }
    return { regions, sections: out, inputs, symbols, objTotals, issues };
  };
  X.lookupAddr = (map, addr) => { const sec = map.sections.find(s => addr >= s.addr && addr < s.addr + s.size); let sym = null; for (const s of map.symbols) { if (s.addr <= addr) sym = s; else break; } const inp = map.inputs.find(x => addr >= x.addr && addr < x.addr + x.size), reg = map.regions.find(r => addr >= r.origin && addr < r.origin + r.length); return { region: reg && reg.name, section: sec && sec.name, symbol: sym && sec && sym.addr >= sec.addr ? sym.name + (addr > sym.addr ? '+0x' + (addr - sym.addr).toString(16) : '') : null, object: inp && inp.obj }; };
  X.diffMaps = (a, b) => { const rows = [], names = new Set(a.sections.map(s => s.name).concat(b.sections.map(s => s.name))); names.forEach(n => { const x = a.sections.find(s => s.name === n), y = b.sections.find(s => s.name === n), d = (y ? y.size : 0) - (x ? x.size : 0); if (d) rows.push({ kind: 'section', name: n, before: x ? x.size : 0, after: y ? y.size : 0, delta: d }); }); new Set(Object.keys(a.objTotals).concat(Object.keys(b.objTotals))).forEach(n => { const d = (b.objTotals[n] || 0) - (a.objTotals[n] || 0); if (d) rows.push({ kind: 'object', name: n, before: a.objTotals[n] || 0, after: b.objTotals[n] || 0, delta: d }); }); return rows.sort((p, q) => Math.abs(q.delta) - Math.abs(p.delta)); };
  /* interrupt vector table (bytes at addr, 32-bit LE words) and stack usage (.su files: "file:line:col:func<TAB>bytes<TAB>static|dynamic") */
  X.vectorTable = (img, base, count, symbols) => { const seg = img.segments.find(s => base >= s.addr && base < s.addr + s.data.length); if (!seg) return []; const dv = new DataView(seg.data.buffer, seg.data.byteOffset, seg.data.byteLength); const out = []; for (let i = 0; i < count; i++) { const o = base - seg.addr + i * 4; if (o + 4 > seg.data.length) break; const v = dv.getUint32(o, true), a = v & ~1; const s = (symbols || []).filter(x => x.value === a || x.addr === a)[0]; out.push({ index: i, addr: base + i * 4, value: v, name: s ? s.name : '' }); } return out; };
  X.parseStackUsage = text => text.split(/\r?\n/).map(l => { const m = l.match(/^(.*?):(\d+):\d+:(.+?)\t(\d+)\t(\w+)/); return m ? { file: m[1].replace(/^.*[\\/]/, ''), line: +m[2], func: m[3], bytes: +m[4], kind: m[5] } : null; }).filter(Boolean).sort((a, b) => b.bytes - a.bytes);

  /* ---------- HEX / SREC / ELF ---------- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32All = segs => { let c = 0xFFFFFFFF; segs.forEach(s => { for (const x of s.data) c = CRC[(c ^ x) & 255] ^ (c >>> 8); }); return (c ^ 0xFFFFFFFF) >>> 0; };
  const merge = (chunks, errors, start, format) => { chunks.sort((a, b) => a.addr - b.addr); const segs = []; chunks.forEach(c => { const s = segs[segs.length - 1]; if (s && c.addr === s.addr + s.bytes.length) s.bytes.push(...c.data); else segs.push({ addr: c.addr, bytes: c.data.slice() }); }); const out = segs.map(s => ({ addr: s.addr, data: new Uint8Array(s.bytes) })); return { format, segments: out, total: out.reduce((a, s) => a + s.data.length, 0), start, errors, crc32: crc32All(out) }; };
  X.parseIHex = text => { let bs = 0, start = null; const ch = [], er = []; text.split(/\r?\n/).forEach((l, n) => { l = l.trim(); if (!l) return; if (l[0] !== ':') { er.push({ line: n + 1, msg: '缺少 :' }); return; } const b = l.slice(1).match(/../g).map(h => parseInt(h, 16)), len = b[0], addr = (b[1] << 8) | b[2], t = b[3]; if (b.length !== len + 5) { er.push({ line: n + 1, msg: '长度不符' }); return; } if (b.reduce((a, x) => a + x, 0) & 0xFF) er.push({ line: n + 1, msg: '校验和错误' }); const d = b.slice(4, 4 + len); if (t === 0) ch.push({ addr: bs + addr, data: d }); else if (t === 2) bs = ((d[0] << 8) | d[1]) << 4; else if (t === 4) bs = (((d[0] << 8) | d[1]) << 16) >>> 0; else if (t === 5 || t === 3) start = d.reduce((a, x) => a * 256 + x, 0) >>> 0; }); return merge(ch, er, start, 'Intel HEX'); };
  X.parseSRec = text => { const ch = [], er = []; let start = null, header = ''; text.split(/\r?\n/).forEach((l, n) => { l = l.trim(); if (!l) return; if (l[0] !== 'S') { er.push({ line: n + 1, msg: '缺少 S' }); return; } const t = +l[1], b = l.slice(2).match(/../g).map(h => parseInt(h, 16)); if (b.length !== b[0] + 1) { er.push({ line: n + 1, msg: '长度不符' }); return; } if (((b.slice(0, -1).reduce((a, x) => a + x, 0) & 0xFF) ^ 0xFF) !== b[b.length - 1]) er.push({ line: n + 1, msg: '校验和错误' }); const al = { 0: 2, 1: 2, 2: 3, 3: 4, 5: 2, 7: 4, 8: 3, 9: 2 }[t] || 2, addr = b.slice(1, 1 + al).reduce((a, x) => a * 256 + x, 0) >>> 0, d = b.slice(1 + al, -1); if (t === 0) header = String.fromCharCode(...d.filter(c => c >= 32 && c < 127)); else if (t >= 1 && t <= 3) ch.push({ addr, data: d }); else if (t >= 7) start = addr; }); const r = merge(ch, er, start, 'S-record'); r.header = header; return r; };
  X.parseELF = buf => {
    const u = new Uint8Array(buf); if (u[0] !== 0x7F || u[1] !== 0x45 || u[2] !== 0x4C || u[3] !== 0x46) return null; const dv = new DataView(u.buffer, u.byteOffset, u.byteLength), is64 = u[4] === 2, le = u[5] === 1;
    const U16 = o => dv.getUint16(o, le), U32 = o => dv.getUint32(o, le), UA = o => is64 ? Number(dv.getBigUint64(o, le)) : U32(o);
    const entry = UA(24), shoff = is64 ? UA(40) : U32(32), shes = U16(is64 ? 58 : 46), shn = U16(is64 ? 60 : 48), shs = U16(is64 ? 62 : 50), phoff = is64 ? UA(32) : U32(28), phes = U16(is64 ? 54 : 42), phn = U16(is64 ? 56 : 44);
    const sh = []; for (let k = 0; k < shn; k++) { const o = shoff + k * shes; sh.push({ nameOff: U32(o), type: U32(o + 4), addr: UA(is64 ? o + 16 : o + 12), off: UA(is64 ? o + 24 : o + 16), size: UA(is64 ? o + 32 : o + 20), link: U32(is64 ? o + 40 : o + 24), entsize: UA(is64 ? o + 56 : o + 36) }); }
    const str = (t, off) => { let s = ''; for (let p = t.off + off; p < u.length && u[p]; p++) s += String.fromCharCode(u[p]); return s; }; if (sh[shs]) sh.forEach(s => s.name = str(sh[shs], s.nameOff));
    const segments = []; for (let k = 0; k < phn; k++) { const o = phoff + k * phes, t = U32(o); const [off, pa, fs] = is64 ? [UA(o + 8), UA(o + 24), UA(o + 32)] : [U32(o + 4), U32(o + 12), U32(o + 16)]; if (t === 1 && fs > 0) segments.push({ addr: pa, data: u.slice(off, off + fs) }); }
    const st = sh.find(s => s.type === 2) || sh.find(s => s.type === 11), syms = []; if (st && sh[st.link]) { const es = st.entsize || (is64 ? 24 : 16); for (let o = st.off; o + es <= st.off + st.size; o += es) { const name = str(sh[st.link], U32(o)), value = is64 ? UA(o + 8) : U32(o + 4), size = is64 ? UA(o + 16) : U32(o + 8), info = u[is64 ? o + 4 : o + 12]; if (name && (info & 0xF) <= 2) syms.push({ name, value, size, type: ['NOTYPE', 'OBJECT', 'FUNC'][info & 0xF] }); } }
    const total = segments.reduce((a, s) => a + s.data.length, 0); return { format: 'ELF ' + (is64 ? 64 : 32) + '-bit ' + (le ? 'LE' : 'BE'), segments, total, start: entry, errors: [], crc32: crc32All(segments), sections: sh.filter(s => s.name && s.type !== 0), symbols: syms.sort((a, b) => b.size - a.size) };
  };
  X.diffImages = (a, b) => { const mp = i => { const m = new Map(); i.segments.forEach(s => s.data.forEach((x, k) => m.set(s.addr + k, x))); return m; }, A = mp(a), B = mp(b), r = []; let c = null; for (const ad of Array.from(new Set([...A.keys(), ...B.keys()])).sort((x, y) => x - y)) if (A.get(ad) !== B.get(ad)) { if (c && ad === c.end) c.end++; else { c = { start: ad, end: ad + 1 }; r.push(c); } } return r; };
  X.crc32All = crc32All;

  /* ---------- CSV / tables / formulas ---------- */
  X.parseCSV = (text, delim) => { text = text.replace(/^\uFEFF/, ''); if (!delim) { const f = text.split('\n', 1)[0]; delim = [',', '\t', ';'].sort((a, b) => f.split(b).length - f.split(a).length)[0]; } const rows = []; let row = [], f = '', q = false; for (let i = 0; i < text.length; i++) { const c = text[i]; if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; } if (c === '"') q = true; else if (c === delim) { row.push(f); f = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; } else f += c; } if (f !== '' || row.length) { row.push(f); rows.push(row); } return rows; };
  X.tableToMd = rows => { if (!rows.length) return ''; const w = Math.max(...rows.map(r => r.length)), c = v => String(v == null ? '' : v).replace(/\|/g, '\\|').replace(/\n/g, ' '), r2 = rows.map(r => Array.from({ length: w }, (_, i) => c(r[i]))); return ['| ' + r2[0].join(' | ') + ' |', '|' + ' --- |'.repeat(w)].concat(r2.slice(1).map(r => '| ' + r.join(' | ') + ' |')).join('\n'); };
  X.splitRow = r => { r = r.trim().replace(/^\|/, '').replace(/\|$/, ''); const c = []; let cur = '', code = false; for (let i = 0; i < r.length; i++) { const ch = r[i]; if (ch === '\\' && r[i + 1] === '|') { cur += '\\|'; i++; continue; } if (ch === '`') code = !code; if (ch === '|' && !code) { c.push(cur.trim()); cur = ''; continue; } cur += ch; } c.push(cur.trim()); return c; };
  const dispW = s => { let w = 0; for (const ch of s) w += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(ch) ? 2 : 1; return w; };
  X.dispW = dispW;
  X.parseMdTable = text => { const rows = text.split('\n').filter(l => l.trim()).map(X.splitRow); const al = (rows[1] || []).map(c => /^:-+:$/.test(c) ? 'c' : /-+:$/.test(c) ? 'r' : /^:-+/.test(c) ? 'l' : ''); const body = [rows[0]].concat(rows.slice(2)), n = Math.max(...body.map(r => r.length), al.length, 1); body.forEach(r => { while (r.length < n) r.push(''); }); while (al.length < n) al.push(''); return { rows: body, aligns: al, n }; };
  X.buildMdTable = t => { const w = Array.from({ length: t.n }, (_, i) => Math.max(3, ...t.rows.map(r => dispW(r[i] || '')))); const pd = (s, i) => { const d = w[i] - dispW(s), a = t.aligns[i]; return a === 'r' ? ' '.repeat(d) + s : a === 'c' ? ' '.repeat(d >> 1) + s + ' '.repeat(d - (d >> 1)) : s + ' '.repeat(d); }; const line = r => '| ' + r.map((c, i) => pd(c, i)).join(' | ') + ' |'; const sp = '| ' + w.map((x, i) => { const a = t.aligns[i]; return a === 'c' ? ':' + '-'.repeat(x - 2) + ':' : a === 'r' ? '-'.repeat(x - 1) + ':' : a === 'l' ? ':' + '-'.repeat(x - 1) : '-'.repeat(x); }).join(' | ') + ' |'; return [line(t.rows[0]), sp].concat(t.rows.slice(1).map(line)).join('\n'); };
  X.formatMdTable = text => { try { return X.buildMdTable(X.parseMdTable(text)); } catch (e) { return text; } };
  /* formulas: cells "=SUM(B2:B4)*2"; refs A1; ranges; + - * / ^ ( ); k/M suffix */
  X.evalTable = text => {
    const t = X.parseMdTable(text), g = t.rows, memo = new Map(); const colN = s => s.split('').reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1;
    const num = s => { s = String(s == null ? '' : s).trim().replace(/,/g, ''); const m = s.match(/^(-?[\d.]+)\s*([kKM]?)(?:%)?$/); if (!m) return NaN; return parseFloat(m[1]) * ({ '': 1, k: 1e3, K: 1e3, M: 1e6 })[m[2]] * (/%$/.test(s) ? 0.01 : 1); };
    const cell = (c, r, st) => { const key = c + ',' + r; if (memo.has(key)) return memo.get(key); const raw = (g[r] && g[r][c]) || ''; if (!/^=/.test(raw.trim())) return num(raw); if (st.has(key)) return NaN; st.add(key); const v = evalExpr(raw.trim().slice(1), st); st.delete(key); memo.set(key, v); return v; };
    function evalExpr(src, st) {
      const tk = src.match(/[A-Za-z]+\d+:[A-Za-z]+\d+|[A-Za-z]+\d+|[A-Za-z_]+(?=\()|\d+(?:\.\d+)?[kKM]?|[-+*/^(),]/g) || []; let p = 0;
      const range = s => { const [a, b] = s.split(':'), m1 = a.match(/([A-Za-z]+)(\d+)/), m2 = b.match(/([A-Za-z]+)(\d+)/); const out = []; for (let r = +m1[2]; r <= +m2[2]; r++) for (let c = colN(m1[1].toUpperCase()); c <= colN(m2[1].toUpperCase()); c++) { const v = cell(c, r - 1, st); if (!isNaN(v)) out.push(v); } return out; };
      const fn = (n, a) => { const f = a.flat(); switch (n.toUpperCase()) { case 'SUM': return f.reduce((x, y) => x + y, 0); case 'AVG': case 'AVERAGE': return f.length ? f.reduce((x, y) => x + y, 0) / f.length : NaN; case 'MIN': return Math.min(...f); case 'MAX': return Math.max(...f); case 'COUNT': return f.length; case 'ROUND': return +(+f[0]).toFixed(f[1] || 0); case 'ABS': return Math.abs(f[0]); default: return NaN; } };
      function expr() { let v = term(); while (tk[p] === '+' || tk[p] === '-') { const o = tk[p++], r = term(); v = o === '+' ? v + r : v - r; } return v; }
      function term() { let v = pow(); while (tk[p] === '*' || tk[p] === '/') { const o = tk[p++], r = pow(); v = o === '*' ? v * r : v / r; } return v; }
      function pow() { let v = un(); if (tk[p] === '^') { p++; v = Math.pow(v, pow()); } return v; }
      function un() { if (tk[p] === '-') { p++; return -un(); } if (tk[p] === '+') { p++; return un(); } return atom(); }
      function atom() { const t = tk[p++]; if (t == null) return NaN; if (t === '(') { const v = expr(); p++; return v; } if (/^[A-Za-z_]+$/.test(t) && tk[p] === '(') { p++; const a = []; while (tk[p] !== ')' && p < tk.length) { if (tk[p] === ',') { p++; continue; } if (/:/.test(tk[p])) a.push(range(tk[p++])); else a.push(expr()); } p++; return fn(t, a); } if (/^[A-Za-z]+\d+$/.test(t)) { const m = t.match(/([A-Za-z]+)(\d+)/); return cell(colN(m[1].toUpperCase()), +m[2] - 1, st); } return num(t); }
      return expr();
    }
    const out = g.map(r => r.slice()); let changed = false; g.forEach((r, ri) => r.forEach((c, ci) => { if (/^=/.test(c.trim())) { const v = cell(ci, ri, new Set()); out[ri][ci] = isNaN(v) ? '#ERR' : String(+v.toPrecision(12)); changed = true; } }));
    return { rows: out, changed, aligns: t.aligns };
  };

  /* ---------- ZIP / Office readers (browser) ---------- */
  const inflateRaw = async u8 => new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  const unzip = async buf => { const u = new Uint8Array(buf), dv = new DataView(u.buffer, u.byteOffset, u.byteLength); let e = u.length - 22; while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--; if (e < 0) throw new Error('不是有效的 ZIP / Office 文件'); const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const files = {}, dec = new TextDecoder(); for (let k = 0; k < n; k++) { const method = dv.getUint16(p + 10, true), cs = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true), name = dec.decode(u.subarray(p + 46, p + 46 + nl)), ds = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true), raw = u.subarray(ds, ds + cs); files[name] = { method, raw, async bytes() { return this.method === 0 ? this.raw : inflateRaw(this.raw); }, async text() { return dec.decode(await this.bytes()); } }; p += 46 + nl + xl + cl; } return files; };
  const xd = s => new DOMParser().parseFromString(s, 'application/xml'), bt = (el, t) => Array.from(el.getElementsByTagNameNS('*', t));
  const colIdx = c => c.replace(/\d+/g, '').split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  X.unzip = unzip;
  X.readXlsx = async buf => { const z = await unzip(buf), ss = z['xl/sharedStrings.xml'] ? bt(xd(await z['xl/sharedStrings.xml'].text()), 'si').map(si => bt(si, 't').map(t => t.textContent).join('')) : [], wb = xd(await z['xl/workbook.xml'].text()), rels = {}; if (z['xl/_rels/workbook.xml.rels']) bt(xd(await z['xl/_rels/workbook.xml.rels'].text()), 'Relationship').forEach(r => rels[r.getAttribute('Id')] = r.getAttribute('Target')); const sheets = []; for (const s of bt(wb, 'sheet')) { const rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'); let t = (rels[rid] || '').replace(/^\//, ''); const path = t.startsWith('xl/') ? t : 'xl/' + t; if (!z[path]) continue; const d = xd(await z[path].text()), rows = []; bt(d, 'row').forEach(r => { const ri = (+r.getAttribute('r') || rows.length + 1) - 1, row = rows[ri] = rows[ri] || []; bt(r, 'c').forEach((c, ci) => { const ref = c.getAttribute('r'), ix = ref ? colIdx(ref) : ci, tt = c.getAttribute('t'), vE = bt(c, 'v')[0]; let v = vE ? vE.textContent : ''; if (tt === 's') v = ss[+v] || ''; else if (tt === 'inlineStr') v = bt(c, 't').map(x => x.textContent).join(''); else if (tt === 'b') v = v === '1' ? 'TRUE' : 'FALSE'; else if (v !== '' && !isNaN(v)) v = +(+v).toPrecision(15); row[ix] = v; }); }); const w = Math.max(0, ...rows.map(r => r ? r.length : 0)); sheets.push({ name: s.getAttribute('name'), rows: Array.from({ length: rows.length }, (_, i) => Array.from({ length: w }, (_, j) => (rows[i] && rows[i][j] != null) ? rows[i][j] : '')) }); } return sheets; };
  X.readDocx = async buf => {
    const z = await unzip(buf), d = xd(await z['word/document.xml'].text()), rels = {}; if (z['word/_rels/document.xml.rels']) bt(xd(await z['word/_rels/document.xml.rels'].text()), 'Relationship').forEach(r => rels[r.getAttribute('Id')] = r.getAttribute('Target'));
    const media = {}, R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    async function run(r) { let s = ''; for (const ch of r.children) { const n = ch.localName; if (n === 't') s += esc(ch.textContent); else if (n === 'tab') s += '\t'; else if (n === 'br') s += '<br>'; else if (n === 'drawing') { const bl = bt(ch, 'blip')[0], id = bl && (bl.getAttribute('r:embed') || bl.getAttributeNS(R, 'embed')), tg = id && rels[id], p = tg && ('word/' + tg.replace(/^\.\.\//, '').replace(/^\//, '')); if (p && z[p]) { if (!media[p]) { const e = p.split('.').pop().toLowerCase(); media[p] = URL.createObjectURL(new Blob([await z[p].bytes()], { type: 'image/' + (e === 'jpg' ? 'jpeg' : e) })); } s += '<img src="' + media[p] + '">'; } } } const pr = bt(r, 'rPr')[0]; if (pr && s) { if (bt(pr, 'b').length) s = '<strong>' + s + '</strong>'; if (bt(pr, 'i').length) s = '<em>' + s + '</em>'; if (bt(pr, 'u').length) s = '<u>' + s + '</u>'; if (bt(pr, 'strike').length) s = '<del>' + s + '</del>'; } return s; }
    async function para(p) { let s = ''; for (const ch of p.children) { if (ch.localName === 'r') s += await run(ch); else if (ch.localName === 'hyperlink') { let t = ''; for (const r of bt(ch, 'r')) t += await run(r); const id = ch.getAttribute('r:id'); s += id && rels[id] ? '<a href="' + esc(rels[id]) + '">' + t + '</a>' : t; } } return s; }
    let html = '', list = null; const md = [];
    for (const el of d.getElementsByTagNameNS('*', 'body')[0].children) {
      if (el.localName === 'p') {
        const st = (bt(el, 'pStyle')[0] || { getAttribute: () => '' }).getAttribute('w:val') || '', inner = await para(el), h = st.match(/^(?:Heading|heading|标题)\s*(\d)$/);
        if (bt(el, 'numPr').length || /List|列表/i.test(st)) { const ord = /Number|编号/i.test(st); if (!list) { html += ord ? '<ol>' : '<ul>'; list = ord ? 'ol' : 'ul'; md.push(''); } html += '<li>' + inner + '</li>'; md[md.length - 1] += (md[md.length - 1] ? '\n' : '') + (ord ? '1. ' : '- ') + inner.replace(/<strong>(.*?)<\/strong>/g, '**$1**').replace(/<[^>]+>/g, ''); continue; }
        if (list) { html += '</' + list + '>'; list = null; }
        if (h || st === 'Title') { const lv = h ? +h[1] : 1; html += '<h' + lv + '>' + inner + '</h' + lv + '>'; md.push('#'.repeat(lv) + ' ' + inner.replace(/<[^>]+>/g, '')); } else { html += '<p>' + (inner || '&nbsp;') + '</p>'; md.push(inner.replace(/<br>/g, '  \n').replace(/<strong>(.*?)<\/strong>/g, '**$1**').replace(/<em>(.*?)<\/em>/g, '*$1*').replace(/<[^>]+>/g, '')); }
      } else if (el.localName === 'tbl') {
        if (list) { html += '</' + list + '>'; list = null; } const rows = []; for (const tr of bt(el, 'tr')) { const cells = []; for (const tc of bt(tr, 'tc')) { let t = ''; for (const p of bt(tc, 'p')) t += (t ? '<br>' : '') + await para(p); cells.push(t); } rows.push(cells); }
        html += '<div class="table-wrap"><table>' + rows.map((r, i) => '<tr>' + r.map(c => i ? '<td>' + c + '</td>' : '<th>' + c + '</th>').join('') + '</tr>').join('') + '</table></div>'; if (rows.length) md.push(X.tableToMd(rows.map(r => r.map(c => c.replace(/<br>/g, ' ').replace(/<[^>]+>/g, '')))));
      }
    }
    if (list) html += '</' + list + '>'; return { html, markdown: md.join('\n\n').replace(/\n{3,}/g, '\n\n') };
  };
  X.readPptx = async buf => { const z = await unzip(buf), pres = xd(await z['ppt/presentation.xml'].text()), rels = {}; bt(xd(await z['ppt/_rels/presentation.xml.rels'].text()), 'Relationship').forEach(r => rels[r.getAttribute('Id')] = r.getAttribute('Target')); const slides = []; for (const s of bt(pres, 'sldId')) { const id = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'), path = 'ppt/' + (rels[id] || '').replace(/^\//, '').replace(/^ppt\//, ''); if (!z[path]) continue; const d = xd(await z[path].text()); let title = ''; const body = []; bt(d, 'sp').forEach(sp => { const ph = bt(sp, 'ph')[0], isT = ph && /title|ctrTitle/i.test(ph.getAttribute('type') || ''), ps = bt(sp, 'p').map(p => ({ text: bt(p, 't').map(t => t.textContent).join(''), lvl: +((bt(p, 'pPr')[0] || { getAttribute: () => 0 }).getAttribute('lvl') || 0) })).filter(p => p.text.trim()); if (isT && !title) title = ps.map(p => p.text).join(' '); else body.push(...ps); }); const tables = bt(d, 'tbl').map(t => bt(t, 'tr').map(tr => bt(tr, 'tc').map(tc => bt(tc, 't').map(x => x.textContent).join('')))); const nr = path.replace('slides/', 'slides/_rels/') + '.rels'; let notes = ''; if (z[nr]) { const r = bt(xd(await z[nr].text()), 'Relationship').find(r => /notesSlide/.test(r.getAttribute('Type'))); if (r) { const np = 'ppt/' + r.getAttribute('Target').replace(/^\.\.\//, ''); if (z[np]) notes = bt(xd(await z[np].text()), 'sp').filter(sp => { const ph = bt(sp, 'ph')[0]; return ph && ph.getAttribute('type') === 'body'; }).map(sp => bt(sp, 't').map(t => t.textContent).join('')).join('\n'); } } slides.push({ title, body, tables, notes }); } return slides; };
  X.parseEml = text => {
    const [head, ...rest] = text.replace(/\r\n/g, '\n').split('\n\n'), body = rest.join('\n\n'), hdr = {}; head.replace(/\n[ \t]+/g, ' ').split('\n').forEach(l => { const i = l.indexOf(':'); if (i > 0) hdr[l.slice(0, i).toLowerCase()] = l.slice(i + 1).trim(); });
    const dec = s => s.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (_, cs, en, t) => { try { const b = en.toUpperCase() === 'B' ? Uint8Array.from(atob(t), c => c.charCodeAt(0)) : Uint8Array.from(t.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))), c => c.charCodeAt(0)); return new TextDecoder(cs).decode(b); } catch (e) { return t; } });
    function part(h, b) { const ct = h['content-type'] || 'text/plain', bm = ct.match(/boundary="?([^";]+)"?/i); if (/multipart/i.test(ct) && bm) return b.split('--' + bm[1]).slice(1).filter(x => !x.startsWith('--')).map(x => { const [hh, ...bb] = x.replace(/^\n/, '').split('\n\n'), H = {}; hh.replace(/\n[ \t]+/g, ' ').split('\n').forEach(l => { const i = l.indexOf(':'); if (i > 0) H[l.slice(0, i).toLowerCase()] = l.slice(i + 1).trim(); }); return part(H, bb.join('\n\n')); }).flat(); const te = (h['content-transfer-encoding'] || '').toLowerCase(), cs = (ct.match(/charset="?([^";]+)/i) || [])[1] || 'utf-8'; let bytes; if (te === 'base64') bytes = Uint8Array.from(atob(b.replace(/\s+/g, '')), c => c.charCodeAt(0)); else if (te === 'quoted-printable') bytes = Uint8Array.from(b.replace(/=\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, x) => String.fromCharCode(parseInt(x, 16))), c => c.charCodeAt(0)); else bytes = Uint8Array.from(b, c => c.charCodeAt(0) & 255); const nm = ((h['content-disposition'] || '') + ';' + ct).match(/(?:file)?name="?([^";]+)"?/i); return [{ type: ct.split(';')[0].trim().toLowerCase(), name: nm ? dec(nm[1]) : '', text: /^text\//i.test(ct) ? (() => { try { return new TextDecoder(cs).decode(bytes); } catch (e) { return new TextDecoder().decode(bytes); } })() : null, size: bytes.length, bytes }]; }
    const parts = part(hdr, body); return { subject: dec(hdr.subject || ''), from: dec(hdr.from || ''), to: dec(hdr.to || ''), cc: dec(hdr.cc || ''), date: hdr.date || '', html: (parts.find(p => p.type === 'text/html') || {}).text || '', text: (parts.find(p => p.type === 'text/plain') || {}).text || '', attachments: parts.filter(p => p.name && p.type !== 'text/html' && p.type !== 'text/plain') };
  };
  /* Outlook .msg (OLE compound file): subject / sender / body / attachment names */
  X.parseMsg = buf => {
    const u = new Uint8Array(buf), dv = new DataView(u.buffer, u.byteOffset, u.byteLength); if (dv.getUint32(0, true) !== 0xE011CFD0) throw new Error('不是 .msg 文件'); const ss = 1 << dv.getUint16(30, true), ms = 1 << dv.getUint16(32, true), nF = dv.getUint32(44, true), dirStart = dv.getUint32(48, true), cutoff = dv.getUint32(56, true), mfStart = dv.getUint32(60, true), nM = dv.getUint32(64, true), dif0 = dv.getUint32(68, true);
    const off = s => (s + 1) * ss; const fat = []; const difat = []; for (let i = 0; i < 109; i++) { const v = dv.getUint32(76 + i * 4, true); if (v < 0xFFFFFFFA) difat.push(v); } let dn = dif0, guard = 0; while (dn < 0xFFFFFFFA && guard++ < 1000) { for (let i = 0; i < ss / 4 - 1; i++) { const v = dv.getUint32(off(dn) + i * 4, true); if (v < 0xFFFFFFFA) difat.push(v); } dn = dv.getUint32(off(dn) + ss - 4, true); }
    difat.forEach(s => { for (let i = 0; i < ss / 4; i++) fat.push(dv.getUint32(off(s) + i * 4, true)); });
    const chain = (s, f) => { const o = []; let g = 0; while (s < 0xFFFFFFFA && g++ < 1e6) { o.push(s); s = f[s]; } return o; };
    const readChain = (s, f, size, offF, sz) => { const out = new Uint8Array(size); let p = 0; for (const c of chain(s, f)) { const n = Math.min(sz, size - p); if (n <= 0) break; out.set(u.subarray(offF(c), offF(c) + n), p); p += n; } return out; };
    const dirData = readChain(dirStart, fat, chain(dirStart, fat).length * ss, off, ss), ddv = new DataView(dirData.buffer);
    const ents = []; for (let i = 0; i < dirData.length / 128; i++) { const nl = ddv.getUint16(i * 128 + 64, true); let name = ''; for (let k = 0; k < Math.max(0, nl / 2 - 1); k++) name += String.fromCharCode(ddv.getUint16(i * 128 + k * 2, true)); ents.push({ name, type: dirData[i * 128 + 66], start: ddv.getUint32(i * 128 + 116, true), size: ddv.getUint32(i * 128 + 120, true) }); }
    const root = ents[0]; const miniFat = []; chain(mfStart, fat).forEach(s => { for (let i = 0; i < ss / 4; i++) miniFat.push(dv.getUint32(off(s) + i * 4, true)); });
    const miniStream = root ? readChain(root.start, fat, root.size, off, ss) : new Uint8Array(0);
    const getStream = e => e.size < cutoff ? readChain(e.start, miniFat, e.size, c => c * ms, ms) .subarray(0, e.size) : readChain(e.start, fat, e.size, off, ss);
    const fixMini = e => { if (e.size >= cutoff) return getStream(e); const out = new Uint8Array(e.size); let p = 0; for (const c of chain(e.start, miniFat)) { const n = Math.min(ms, e.size - p); if (n <= 0) break; out.set(miniStream.subarray(c * ms, c * ms + n), p); p += n; } return out; };
    const prop = id => { const e8 = ents.find(e => e.name.toUpperCase() === '__SUBSTG1.0_' + id + '001F'), e1 = ents.find(e => e.name.toUpperCase() === '__SUBSTG1.0_' + id + '001E'); if (e8) return new TextDecoder('utf-16le').decode(fixMini(e8)); if (e1) return new TextDecoder().decode(fixMini(e1)); return ''; };
    const atts = ents.filter(e => /^__ATTACH_VERSION1\.0_/i.test(e.name)).length;
    return { subject: prop('0037'), from: prop('0C1A') || prop('0042'), to: prop('0E04'), cc: prop('0E03'), date: '', text: prop('1000'), html: '', attachments: Array.from({ length: atts }, (_, i) => ({ name: '附件 ' + (i + 1), size: 0 })) };
  };

  /* ---------- tasks / planner / time ---------- */
  const TASK = /^(\s*)(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s+(.*)$/;
  const estimate = t => { const m = t.match(/(?:^|\s)~(\d+(?:\.\d+)?)\s*(m|min|h|hr|d)\b/i); if (!m) return 0; const v = +m[1], u = m[2].toLowerCase(); return Math.round(u[0] === 'h' ? v * 60 : u === 'd' ? v * 480 : v); };
  X.parseTaskLine = line => { const m = line.match(TASK); if (!m) return null; const t = m[3], g = re => (t.match(re) || [])[1] || ''; return { done: m[2] !== ' ', plan: g(/⏳\s?(\d{4}-\d{2}-\d{2})/), due: g(/(?:📅\s?|due:)(\d{4}-\d{2}-\d{2})/), time: g(/⏰\s?(\d{1,2}:\d{2})/), doneOn: g(/✅\s?(\d{4}-\d{2}-\d{2})/), est: estimate(t), pri: /(🔺|⏫|!!)/.test(t), who: g(/@([^\s@📅⏳⏰✅~]+)/), text: t.replace(/(?:⏳|📅|✅)\s?\d{4}-\d{2}-\d{2}|due:\d{4}-\d{2}-\d{2}|⏰\s?\d{1,2}:\d{2}|(?:^|\s)~\d+(?:\.\d+)?\s*(?:m|min|h|hr|d)\b|🔺|⏫|!!/gi, ' ').replace(/\s{2,}/g, ' ').trim() }; };
  X.collectTasks = (text, file) => { const out = []; let fence = false; text.split('\n').forEach((l, i) => { if (/^\s*(```|~~~)/.test(l)) { fence = !fence; return; } if (fence) return; const t = X.parseTaskLine(l); if (t) out.push(Object.assign(t, { file, line: i, raw: l, key: hash((file && file.path || '') + '|' + t.text) })); }); return out; };
  const FLD = { plan: ['⏳', /\s*⏳\s?\d{4}-\d{2}-\d{2}/], time: ['⏰', /\s*⏰\s?\d{1,2}:\d{2}/], doneOn: ['✅', /\s*✅\s?\d{4}-\d{2}-\d{2}/], due: ['📅', /\s*📅\s?\d{4}-\d{2}-\d{2}/] };
  X.setTaskField = (line, key, v) => { const [s, re] = FLD[key]; let l = line.replace(re, ''); if (v) l = l.replace(/\s+$/, '') + ' ' + s + ' ' + v; return l; };
  X.setTaskDone = (line, done, date) => X.setTaskField(line.replace(/\[([ xX])\]/, done ? '[x]' : '[ ]'), 'doneOn', done ? date : '');
  X.planBuckets = (tasks, today) => { const open = tasks.filter(t => !t.done), sched = open.filter(t => t.plan === today), pool = open.filter(t => t.plan !== today && (!t.plan || t.plan < today || (t.due && t.due <= today))); const minutes = sched.reduce((a, t) => a + (t.est || 30), 0); return { pool: pool.sort((a, b) => (b.pri - a.pri) || ((a.due || '9').localeCompare(b.due || '9'))), timeline: sched.filter(t => t.time).sort((a, b) => a.time.localeCompare(b.time)), unslotted: sched.filter(t => !t.time), doneToday: tasks.filter(t => t.done && t.doneOn === today), minutes, overload: minutes > 480, rollover: open.filter(t => t.plan && t.plan < today) }; };
  X.weekBuckets = (tasks, any) => { const s = monday(any); return Array.from({ length: 7 }, (_, k) => addDays(s, k)).map(d => { const items = tasks.filter(t => t.plan === d || (!t.plan && t.due === d && !t.done)); return { date: d, items, minutes: items.filter(t => !t.done).reduce((a, t) => a + (t.est || 30), 0), due: tasks.filter(t => t.due === d && !t.done).length }; }); };
  X.dayReview = (tasks, today) => { const b = X.planBuckets(tasks, today), f = t => '- ' + (t.done ? '[x] ' : '[ ] ') + t.text + (t.file && t.file.name ? ' （' + t.file.name.replace(/\.md$/i, '') + '）' : ''); return '## 今日回顾（' + today + '）\n\n### 已完成 · ' + b.doneToday.length + '\n\n' + (b.doneToday.map(f).join('\n') || '- （无）') + '\n\n### 未完成 · ' + (b.timeline.length + b.unslotted.length) + '\n\n' + (b.timeline.concat(b.unslotted).map(f).join('\n') || '- （无）') + '\n'; };
  X.weekReport = (tasks, any, sessions) => { const s = monday(any), e = addDays(s, 6), done = tasks.filter(t => t.done && t.doneOn >= s && t.doneOn <= e), gr = {}; done.forEach(t => { const k = (t.file && t.file.name || '其他').replace(/\.md$/i, ''); (gr[k] = gr[k] || []).push(t); }); const next = tasks.filter(t => !t.done && ((t.plan && t.plan > e && t.plan <= addDays(e, 7)) || (t.due && t.due > e && t.due <= addDays(e, 7)))), open = tasks.filter(t => !t.done && ((t.plan && t.plan <= e) || (t.due && t.due <= e))), mins = done.reduce((a, t) => a + (t.est || 0), 0); const act = sessions ? X.timeReport(sessions, tasks, s, e) : null; return '# ' + s.slice(0, 4) + ' 第 ' + isoWeek(s) + ' 周 周报（' + s + ' ~ ' + e + '）\n\n## 本周完成（' + done.length + ' 项' + (mins ? '，预计约 ' + (mins / 60).toFixed(1) + ' 小时' : '') + (act && act.totalMin ? '，实际计时 ' + (act.totalMin / 60).toFixed(1) + ' 小时' : '') + '）\n\n' + (Object.entries(gr).map(([k, a]) => '**' + k + '**\n\n' + a.map(t => '- ' + t.text).join('\n')).join('\n\n') || '- （无）') + '\n\n## 进行中 / 未完成\n\n' + (open.map(t => '- ' + t.text + (t.due ? '（截止 ' + t.due + '）' : '')).join('\n') || '- （无）') + '\n\n## 下周计划\n\n' + (next.map(t => '- [ ] ' + t.text + (t.due ? ' 📅 ' + t.due : '')).join('\n') || '- [ ] ') + '\n\n## 风险与需要的支持\n\n- \n'; };
  X.timeReport = (sessions, tasks, from, to) => { const byKey = new Map(tasks.map(t => [t.key, t])), proj = {}, day = {}; let total = 0; const rows = {}; sessions.filter(s => s.end && s.date >= from && s.date <= to).forEach(s => { const m = Math.round((s.end - s.start) / 60000); total += m; const t = byKey.get(s.key), p = s.project || (t && t.file && t.file.name || '其他').replace(/\.md$/i, ''); proj[p] = (proj[p] || 0) + m; day[s.date] = (day[s.date] || 0) + m; const r = rows[s.key] = rows[s.key] || { key: s.key, text: s.text || (t && t.text) || '', est: t ? t.est : 0, act: 0, project: p }; r.act += m; }); return { totalMin: total, byProject: proj, byDay: day, tasks: Object.values(rows).sort((a, b) => b.act - a.act) }; };

  /* ---------- spaced repetition / cards / glossary / pins ---------- */
  X.sm2 = (card, grade, today) => { const c = Object.assign({ ef: 2.5, interval: 0, reps: 0 }, card); if (grade < 3) { c.reps = 0; c.interval = 1; } else { c.reps += 1; c.interval = c.reps === 1 ? 1 : c.reps === 2 ? 6 : Math.round(c.interval * c.ef); } c.ef = Math.max(1.3, c.ef + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02))); c.due = addDays(today, c.interval); return c; };
  X.parseCards = text => { const out = [], re = /^(?:Q|问)[:：]\s*(.+)\n(?:A|答)[:：]\s*([\s\S]*?)(?=\n(?:Q|问)[:：]|\n#{1,6}\s|\n*$)/gm; let m; while ((m = re.exec(text))) { const a = m[2].trim(), st = a.match(/<!--\s*sr:\s*(\{.*?\})\s*-->/), pg = (m[1] + ' ' + a).match(/p\.?\s?(\d+)/i); out.push({ q: m[1].trim(), a: a.replace(/<!--[\s\S]*?-->/g, '').trim(), state: st ? JSON.parse(st[1]) : null, page: pg ? +pg[1] : null, index: m.index }); } return out; };
  X.extractGlossary = text => { const out = {}; text.split('\n').forEach(l => { const m = l.match(/^\s*\|?\s*([A-Z][A-Z0-9/\-]{1,11})\s*(?:\||[:：\t]|\s{2,})\s*([^|]{3,}?)\s*\|?\s*$/); if (m && !/^\s*\|?\s*-+/.test(l)) out[m[1]] = m[2].trim(); }); return out; };
  X.parsePins = rows => { const head = rows[0].map(h => String(h).toLowerCase()), ix = k => head.findIndex(h => k.some(x => h.includes(x))), ip = ix(['pin', '引脚', 'ball', 'no']), inm = ix(['name', '名称', 'port']), rest = head.map((_, i) => i).filter(i => i !== ip && i !== inm); return rows.slice(1).filter(r => r[ip] !== '' && r[ip] != null).map(r => ({ pin: String(r[ip]).trim(), name: String(r[inm >= 0 ? inm : ip]).trim(), funcs: rest.map(i => String(r[i] || '').trim()).filter(Boolean) })); };
  X.decodePart = (rules, text) => { const r = [].concat(rules || []).find(x => text.toUpperCase().startsWith(String(x.prefix || '').toUpperCase())); if (!r) return null; let p = String(r.prefix || '').length; const out = []; for (const s of r.segments || []) { const v = text.slice(p, p + (s.len || 1)); p += s.len || 1; if (!v) break; out.push({ name: s.name, value: v, meaning: (s.map && (s.map[v] || s.map[v.toUpperCase()])) || '（规则中未定义）' }); } return { rule: r.name, parts: out, rest: text.slice(p) }; };

  /* ---------- property queries (Dataview-lite) ---------- */
  X.parseWhere = s => (s || '').split(/\s+(?:OR|或)\s+/i).map(g => g.split(/\s+(?:AND|且)\s+/i).map(c => { const m = c.trim().match(/^([\w\u4e00-\u9fff.-]+)\s*(>=|<=|!=|=|~|>|<)\s*(.*)$/); return m ? { k: m[1], op: m[2], v: m[3].replace(/^["']|["']$/g, '') } : null; }).filter(Boolean));
  X.matchWhere = (props, groups) => !groups.length || groups.some(g => g.every(c => { const raw = props[c.k], v = raw == null ? '' : Array.isArray(raw) ? raw.join(',') : String(raw); switch (c.op) { case '=': return v.toLowerCase() === c.v.toLowerCase() || (Array.isArray(raw) && raw.map(String).some(x => x.toLowerCase() === c.v.toLowerCase())); case '!=': return v.toLowerCase() !== c.v.toLowerCase(); case '~': return v.toLowerCase().includes(c.v.toLowerCase()); case '>': return v > c.v; case '<': return v < c.v; case '>=': return v >= c.v; case '<=': return v <= c.v; } return false; }));
  X.runQuery = (docs, q) => { const g = X.parseWhere(q.where); let rows = docs.filter(d => X.matchWhere(d.props, g)).map(d => Object.assign({ _doc: d }, d.props, { title: d.props.title || d.title || d.name.replace(/\.md$/i, '') })); const s = q.sort; if (s) { const desc = /^-/.test(s), k = s.replace(/^-/, ''); rows.sort((a, b) => String(a[k] == null ? '' : a[k]).localeCompare(String(b[k] == null ? '' : b[k]), 'zh-CN', { numeric: true }) * (desc ? -1 : 1)); } return rows.slice(0, q.limit || 500); };

  /* ---------- diff ---------- */
  X.lineDiff = (a, b) => { const A = a.split('\n'), B = b.split('\n'); let p = 0; while (p < A.length && p < B.length && A[p] === B[p]) p++; let ea = A.length, eb = B.length; while (ea > p && eb > p && A[ea - 1] === B[eb - 1]) { ea--; eb--; } const a1 = A.slice(p, ea), b1 = B.slice(p, eb), ops = []; for (let i = 0; i < p; i++) ops.push([' ', A[i]]); if (a1.length * b1.length > 4e6) { a1.forEach(x => ops.push(['-', x])); b1.forEach(x => ops.push(['+', x])); } else { const n = a1.length, m = b1.length, L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1)); for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a1[i] === b1[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]); let i = 0, j = 0; while (i < n && j < m) { if (a1[i] === b1[j]) { ops.push([' ', a1[i]]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) ops.push(['-', a1[i++]]); else ops.push(['+', b1[j++]]); } while (i < n) ops.push(['-', a1[i++]]); while (j < m) ops.push(['+', b1[j++]]); } for (let i = ea; i < A.length; i++) ops.push([' ', A[i]]); return ops; };
  X.wordDiff = (a, b) => { const tk = s => s.match(/[\u4e00-\u9fff]|[A-Za-z0-9_]+|\s+|[^\sA-Za-z0-9_\u4e00-\u9fff]/g) || [], A = tk(a), B = tk(b), n = A.length, m = B.length; if (n * m > 4e6) return [['-', a], ['+', b]]; const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1)); for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]); const out = []; let i = 0, j = 0; const push = (t, s) => { const l = out[out.length - 1]; if (l && l[0] === t) l[1] += s; else out.push([t, s]); }; while (i < n && j < m) { if (A[i] === B[j]) { push(' ', A[i]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) push('-', A[i++]); else push('+', B[j++]); } while (i < n) push('-', A[i++]); while (j < m) push('+', B[j++]); return out; };
  /* paragraph-level compare of two long texts (manual / errata versions) */
  X.paraDiff = (a, b) => { const pa = a.split(/\n{2,}/).map(s => s.trim()).filter(Boolean), pb = b.split(/\n{2,}/).map(s => s.trim()).filter(Boolean); const ops = X.lineDiff(pa.join('\n'), pb.join('\n')); const out = []; let k = 0; while (k < ops.length) { const [t, s] = ops[k]; if (t === '-' && ops[k + 1] && ops[k + 1][0] === '+') { out.push({ kind: 'changed', a: s, b: ops[k + 1][1], words: X.wordDiff(s, ops[k + 1][1]) }); k += 2; } else { out.push({ kind: t === '+' ? 'added' : t === '-' ? 'removed' : 'same', a: s, b: s }); k++; } } return out; };

  /* ---------- search index ---------- */
  const tok = s => { const t = new Set(); String(s).toLowerCase().replace(/[a-z0-9_]{2,}/g, w => { t.add(w); return ' '; }).replace(/[\u3040-\u30ff\u4e00-\u9fff]+/g, run => { for (let i = 0; i < run.length - 1; i++) t.add(run.slice(i, i + 2)); if (run.length === 1) t.add(run); return ' '; }); return t; };
  class SearchIndex {
    constructor() { this.docs = new Map(); this.inv = new Map(); }
    set(id, d) { this.remove(id); d.tokens = tok(d.title + ' ' + d.text); this.docs.set(id, d); d.tokens.forEach(t => { let s = this.inv.get(t); if (!s) this.inv.set(t, s = new Set()); s.add(id); }); }
    setTokens(id, d, tokens) { this.remove(id); d.tokens = new Set(tokens); this.docs.set(id, d); d.tokens.forEach(t => { let s = this.inv.get(t); if (!s) this.inv.set(t, s = new Set()); s.add(id); }); }
    remove(id) { const d = this.docs.get(id); if (!d) return; d.tokens.forEach(t => { const s = this.inv.get(t); if (s) { s.delete(id); if (!s.size) this.inv.delete(t); } }); this.docs.delete(id); }
    search(q, limit) { const qt = Array.from(tok(q)); if (!qt.length) return []; let ids = null; for (const t of qt) { const s = this.inv.get(t) || new Set(); ids = ids ? new Set([...ids].filter(x => s.has(x))) : new Set(s); if (!ids.size) return []; } const ql = q.toLowerCase().trim(); const res = []; ids.forEach(id => { const d = this.docs.get(id), tx = d.text.toLowerCase(); const ix = tx.indexOf(ql); let sc = 1 + (d.title.toLowerCase().includes(ql) ? 10 : 0) + (ix >= 0 ? 3 : 0) + (d.kind === 'md' ? 1 : 0); const pos = ix >= 0 ? ix : Math.max(0, tx.indexOf(qt[0])); const sn = d.text.slice(Math.max(0, pos - 40), pos + 120).replace(/\s+/g, ' '); res.push({ id, doc: d, score: sc, snippet: sn }); }); return res.sort((a, b) => b.score - a.score).slice(0, limit || 50); }
    get size() { return this.docs.size; }
  }
  X.SearchIndex = SearchIndex; X._tok = tok;

  /* ---------- whiteboard ---------- */
  X.board = {
    create: () => ({ format: 'chipbench-board', version: 1, shapes: [], view: { x: 0, y: 0, k: 1 } }),
    add: (b, s) => { s.id = s.id || uid(); b.shapes.push(s); return s; },
    bounds: s => s.type === 'line' || s.type === 'arrow' ? { x: Math.min(s.x, s.x2), y: Math.min(s.y, s.y2), w: Math.abs(s.x2 - s.x), h: Math.abs(s.y2 - s.y) } : s.type === 'pen' ? (() => { const xs = s.pts.map(p => p[0]), ys = s.pts.map(p => p[1]); return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; })() : { x: s.x, y: s.y, w: s.w || 0, h: s.h || 0 },
    hit: (b, x, y) => { for (let i = b.shapes.length - 1; i >= 0; i--) { const s = b.shapes[i], r = X.board.bounds(s), pad = 6; if (x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad) return s; } return null; },
    move: (s, dx, dy) => { if (s.pts) s.pts = s.pts.map(p => [p[0] + dx, p[1] + dy]); else { s.x += dx; s.y += dy; if (s.x2 != null) { s.x2 += dx; s.y2 += dy; } } },
    remove: (b, id) => { b.shapes = b.shapes.filter(s => s.id !== id); },
    toFront: (b, id) => { const i = b.shapes.findIndex(s => s.id === id); if (i >= 0) b.shapes.push(b.shapes.splice(i, 1)[0]); },
    toSvg: (b, w, h) => { const sh = b.shapes; let bb = { x: 0, y: 0, w: w || 800, h: h || 600 }; if (!w && sh.length) { const rs = sh.map(X.board.bounds), x0 = Math.min(...rs.map(r => r.x)) - 20, y0 = Math.min(...rs.map(r => r.y)) - 20, x1 = Math.max(...rs.map(r => r.x + r.w)) + 20, y1 = Math.max(...rs.map(r => r.y + r.h)) + 20; bb = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; } const c = s => s.color || '#3a63e0', fill = s => s.fill || 'none'; const body = sh.map(s => { const sw = s.sw || 2; if (s.type === 'rect') return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${s.r == null ? 8 : s.r}" fill="${fill(s)}" stroke="${c(s)}" stroke-width="${sw}"/>` + X.board.label(s); if (s.type === 'ellipse') return `<ellipse cx="${s.x + s.w / 2}" cy="${s.y + s.h / 2}" rx="${s.w / 2}" ry="${s.h / 2}" fill="${fill(s)}" stroke="${c(s)}" stroke-width="${sw}"/>` + X.board.label(s); if (s.type === 'diamond') return `<polygon points="${s.x + s.w / 2},${s.y} ${s.x + s.w},${s.y + s.h / 2} ${s.x + s.w / 2},${s.y + s.h} ${s.x},${s.y + s.h / 2}" fill="${fill(s)}" stroke="${c(s)}" stroke-width="${sw}"/>` + X.board.label(s); if (s.type === 'sticky') return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="4" fill="${s.fill || '#fff3b0'}" stroke="#e0c96b"/>` + X.board.label(s); if (s.type === 'text') return `<text x="${s.x}" y="${s.y + 16}" font-size="${s.size || 16}" fill="${s.color || '#1b1f24'}">${esc(s.text || '')}</text>`; if (s.type === 'line' || s.type === 'arrow') { const a = Math.atan2(s.y2 - s.y, s.x2 - s.x), L = 10 + sw * 2, hd = s.type === 'arrow' ? `<polygon points="${s.x2},${s.y2} ${s.x2 - L * Math.cos(a - .42)},${s.y2 - L * Math.sin(a - .42)} ${s.x2 - L * Math.cos(a + .42)},${s.y2 - L * Math.sin(a + .42)}" fill="${c(s)}"/>` : ''; return `<line x1="${s.x}" y1="${s.y}" x2="${s.x2}" y2="${s.y2}" stroke="${c(s)}" stroke-width="${sw}" stroke-linecap="round"/>` + hd; } if (s.type === 'pen') return `<polyline fill="none" stroke="${c(s)}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" points="${s.pts.map(p => p.join(',')).join(' ')}"/>`; return ''; }).join(''); return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bb.x} ${bb.y} ${bb.w} ${bb.h}" width="${bb.w}" height="${bb.h}" font-family="Segoe UI, Microsoft YaHei UI, sans-serif">${body}</svg>`; },
    inner: b => X.board.toSvg(b).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, ''),
    label: s => s.text ? `<text x="${s.x + s.w / 2}" y="${s.y + s.h / 2 + 5}" text-anchor="middle" font-size="${s.size || 14}" fill="#1b1f24">${esc(s.text)}</text>` : ''
  };

  /* ---------- git porcelain parsing ---------- */
  X.parseGitStatus = out => out.split('\n').filter(Boolean).map(l => ({ code: l.slice(0, 2), path: l.slice(3).replace(/^"|"$/g, ''), state: /^\?\?/.test(l) ? 'untracked' : /D/.test(l.slice(0, 2)) ? 'deleted' : /A/.test(l.slice(0, 2)) ? 'added' : 'modified' }));
  X.parseGitLog = out => out.split('\n').filter(Boolean).map(l => { const [rev, date, ...m] = l.split('\x1f'); return { rev, date, msg: m.join(' ') }; });

  if (G.ChipBench) G.ChipBench.X = X; else G.ChipBenchX = X;
  if (typeof module !== 'undefined') module.exports = X;
})(typeof window !== 'undefined' ? window : globalThis);
