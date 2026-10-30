/* ChipBench · ip-model.js — the IP model (.cbip) behind IP Studio (1.8).  Pure: no DOM, runs in Node; mcp/ip_model.py is its mirror
   (mcp/test_ip18.py keeps the two in step).  The model file is the ONLY source of engineering truth; the canvas is one view of it:

     .cbip               model        nodes · ports · edges · parameters · registers · evidence      (this file's subject)
     .cbip.layout.json   layout/view  positions · collapsed · zoom · focus · mode                       (user-owned; AI edits never touch it)
     .cbip.proposal.json proposal     pending changes from an AI tool, waiting for the user's decision

   Everything that changes a model is an OP (plain JSON).  The UI editor, the MCP tools and the AI proposal flow all go through IPM.apply, so
   there is exactly one implementation of "what may change and what is valid".  apply() is atomic: any failing op → nothing changes.
   Templates describe STRUCTURE only (every item is evidence level 示意); a model never invents hardware facts. */
(function (G) {
  'use strict';
  const IPM = {}; IPM.SCHEMA = 'chipbench.ip/1';
  const ID_RE = /^[A-Za-z_][A-Za-z0-9_\-]*$/;
  IPM.KINDS = ['cpu', 'bus', 'mem', 'dma', 'periph', 'logic', 'io', 'clock', 'irq', 'ext', 'analog', 'group'];
  IPM.PORT_TYPES = ['clock', 'reset', 'irq', 'data', 'bus', 'ctrl', 'dma', 'io'];
  IPM.DIRS = ['in', 'out', 'inout'];
  IPM.EV_LEVELS = ['手册确认', '实测', '推导', '示意', '待核对'];
  IPM.MODEL_KINDS = ['instance', 'template', 'family'];
  const clone = o => JSON.parse(JSON.stringify(o));
  class IpErr extends Error { constructor(code, msg) { super(msg); this.code = code; } }
  const E = (c, m) => { throw new IpErr(c, m); };
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  /* the names of everything a JS object inherits: as an id or a parameter name they would be "found" in a plain-object map that never defined them (or, for __proto__, rewrite the map's prototype).
     Reserved in BOTH implementations (mcp/ip_model.py has the same list) so that they make the same decisions. */
  const RESERVED = new Set(['__proto__', 'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__']);
  const isId = s => typeof s === 'string' && ID_RE.test(s) && !RESERVED.has(s);
  const bare = o => Object.assign(Object.create(null), o);   /* a map without a prototype: nothing is inherited, "constructor" is just a key */

  /* ---------------------------------------------------------------- helpers */
  const parsePages = v => { if (v == null || v === '') return []; const out = []; for (const part of (Array.isArray(v) ? v : [v]).join(',').split(/[,;，、\s]+/).filter(Boolean)) { const m = part.match(/^(\d+)(?:-(\d+))?$/); if (!m) return null; const a = +m[1], b = m[2] ? +m[2] : a; if (b < a || b - a > 200) return null; for (let i = a; i <= b; i++) out.push(i); } return Array.from(new Set(out)).sort((a, b) => a - b); };
  IPM.pages = parsePages;
  const parseBits = b => { const s = String(b == null ? '' : b).trim(); let m = s.match(/^(\d+)\s*:\s*(\d+)$/); if (m) { const hi = +m[1], lo = +m[2]; return hi >= lo ? [hi, lo] : null; } m = s.match(/^(\d+)$/); return m ? [+m[1], +m[1]] : null; };
  const toInt = v => { if (v == null || v === '') return null; if (typeof v === 'number') return Number.isInteger(v) ? v : null; const s = String(v).trim(); if (/^0x[0-9a-f_]+$/i.test(s)) return parseInt(s.replace(/_/g, ''), 16); return /^-?\d+$/.test(s) ? +s : null; };
  const ev = (o, def) => {                                       // evidence object: only provided keys, level validated
    if (o == null) o = {}; if (!isObj(o)) E('bad-ev', '依据必须是对象');
    const r = {}; const lv = o.level != null ? o.level : (o.ev != null ? o.ev : def);
    if (lv != null && lv !== '') { if (!IPM.EV_LEVELS.includes(lv)) E('bad-ev', '依据等级 “' + lv + '” 无效（' + IPM.EV_LEVELS.join(' / ') + '）'); r.level = lv; }
    if (o.page != null && o.page !== '') { if (parsePages(o.page) === null) E('bad-ev', '页码 “' + o.page + '” 格式不对（应为 123 或 12-14）'); r.page = o.page; }
    if (o.sec != null && o.sec !== '') r.sec = String(o.sec); if (o.cond != null && o.cond !== '') r.cond = String(o.cond);
    return r;
  };
  const ep = s => { s = String(s == null ? '' : s); const i = s.indexOf('.'); return i < 0 ? { node: s, port: null } : { node: s.slice(0, i), port: s.slice(i + 1) }; };
  IPM.endpoint = ep;
  const nodeOf = (m, id) => m.nodes.find(n => n.id === id) || E('no-node', '节点不存在：' + id);
  const portOf = (n, pid) => (n.ports || []).find(p => p.id === pid);

  IPM.create = o => IPM.normalize(Object.assign({ schema: IPM.SCHEMA, id: 'model', name: '未命名 IP 模型', kind: 'instance', rev: 1 }, o || {}));

  /* ---------------------------------------------------------------- loading a file that may be damaged (2.4)
     A .cbip is edited by hand, merged badly, written by other tools.  normalize() now coerces the STRUCTURE (a list is a list of objects, an id is text, a width is a number …) so that nothing downstream can
     throw on a wrong type, and records every piece it had to drop or ignore in `m.__repairs` (not enumerable, so it never reaches the file).  It does NOT "fix" meaning: an out-of-range width,
     a dangling reference or an unknown evidence level are left as they are for validate() to report.  validate() reports every repair as an error (bad-structure), and apply() refuses to edit a
     damaged model — saving would silently throw the damaged parts away.  Mirrored in mcp/ip_model.py (same messages, same order). */
  const scalarStr = v => (typeof v === 'string' ? v : (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean' ? String(v) : undefined);
  const sanitize = (m, rep) => {
    const R = (w, why) => { if (rep.length < 100) rep.push(w + '：' + why); else if (rep.length === 100) rep.push('…还有更多问题没有列出'); };
    const list = (v, w) => { if (v == null) return []; if (!Array.isArray(v)) { R(w, '不是列表，已忽略'); return []; } return v; };
    const text = (o, k, w, dflt) => { if (o[k] == null) return dflt; const s = scalarStr(o[k]); if (s === undefined) { R(w + '.' + k, '不是文本，已忽略'); return dflt; } return s; };
    const sev = (o, w) => { if (o == null) return {}; if (!isObj(o)) { R(w + '.ev', '不是对象，已忽略'); return {}; } const r = {}; ['level', 'sec', 'cond'].forEach(k => { if (o[k] == null || o[k] === '') return; const s = scalarStr(o[k]); if (s === undefined) R(w + '.ev.' + k, '不是文本，已忽略'); else r[k] = s; });
      if (o.page != null && o.page !== '') { if (typeof o.page === 'string' || (typeof o.page === 'number' && Number.isFinite(o.page))) r.page = o.page; else R(w + '.ev.page', '不是页码，已忽略'); } return r; };
    const strs = (v, w) => list(v, w).map((x, i) => { if (typeof x !== 'string') { R(w + '[' + (i + 1) + ']', '不是文本，已丢弃'); return undefined; } return x; }).filter(x => x !== undefined);
    const num = (o, k, w) => { if (o[k] == null) return undefined; if (typeof o[k] === 'number' && Number.isFinite(o[k])) return o[k]; R(w + '.' + k, '不是数字，已忽略'); return undefined; };
    const out = {};
    out.nodes = []; list(m.nodes, 'nodes').forEach((n, i) => { const w = 'nodes[' + (i + 1) + ']'; if (!isObj(n)) { R(w, '不是对象，已丢弃'); return; } if (typeof n.id !== 'string' || !n.id) { R(w, '缺少文本 id，已丢弃'); return; }
      const o = Object.assign({}, n); o.id = n.id; o.type = text(n, 'type', w, 'logic'); o.kind = text(n, 'kind', w, 'logic'); o.name = text(n, 'name', w, n.id); if (n.note != null) { const s = text(n, 'note', w, undefined); if (s === undefined) delete o.note; else o.note = s; }
      if (n.parent != null && n.parent !== '') { const s = text(n, 'parent', w, undefined); if (s === undefined) delete o.parent; else o.parent = s; } else delete o.parent;
      o.params = bare(); if (n.params != null && !isObj(n.params)) R(w + '.params', '不是对象，已忽略'); else Object.keys(n.params || {}).forEach(k => { const v = n.params[k]; if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) o.params[k] = v; else R(w + '.params.' + k, '值不是文本 / 数字 / 布尔，已丢弃'); });
      o.ports = []; list(n.ports, w + '.ports').forEach((p, j) => { const pw = w + '.ports[' + (j + 1) + ']'; if (!isObj(p)) { R(pw, '不是对象，已丢弃'); return; } if (typeof p.id !== 'string' || !p.id) { R(pw, '缺少文本 id，已丢弃'); return; } const q = Object.assign({}, p); q.id = p.id; q.type = text(p, 'type', pw, 'data'); q.dir = text(p, 'dir', pw, 'inout'); o.ports.push(q); });
      o.registers = strs(n.registers, w + '.registers'); o.ev = sev(n.ev, w); out.nodes.push(o); });
    out.edges = []; list(m.edges, 'edges').forEach((e, i) => { const w = 'edges[' + (i + 1) + ']'; if (!isObj(e)) { R(w, '不是对象，已丢弃'); return; } if (typeof e.id !== 'string' || !e.id || typeof e.source !== 'string' || typeof e.target !== 'string') { R(w, '缺少文本 id / source / target，已丢弃'); return; }
      const o = Object.assign({}, e); o.type = text(e, 'type', w, 'data'); if (e.name != null) { const s = text(e, 'name', w, undefined); if (s === undefined) delete o.name; else o.name = s; } o.ev = sev(e.ev, w); out.edges.push(o); });
    out.registers = bare(); if (m.registers != null && !isObj(m.registers)) R('registers', '不是对象，已忽略'); else Object.keys(m.registers || {}).forEach(k => { const r = m.registers[k], w = 'registers.' + k; if (!isObj(r)) { R(w, '不是对象，已丢弃'); return; }
      const o = Object.assign({}, r); o.id = k; o.name = text(r, 'name', w, k); const wd = num(r, 'width', w); if (wd === undefined) { o.width = 32; if (r.width != null) { /* reported by num() */ } } else o.width = wd; ['address', 'reset'].forEach(f => { const v = num(r, f, w); if (v === undefined) delete o[f]; else o[f] = v; });
      if (r.desc != null) { const s = text(r, 'desc', w, undefined); if (s === undefined) delete o.desc; else o.desc = s; }
      o.fields = []; list(r.fields, w + '.fields').forEach((f, j) => { const fw = w + '.fields[' + (j + 1) + ']'; if (!isObj(f)) { R(fw, '不是对象，已丢弃'); return; } if (typeof f.name !== 'string' || !f.name) { R(fw, '缺少文本 name，已丢弃'); return; } const q = Object.assign({}, f); q.bits = text(f, 'bits', fw, ''); if (f.desc != null) { const s = text(f, 'desc', fw, undefined); if (s === undefined) delete q.desc; else q.desc = s; } q.ev = sev(f.ev, fw); o.fields.push(q); });
      o.ev = sev(r.ev, w); out.registers[k] = o; });
    out.scenes = []; list(m.scenes, 'scenes').forEach((sc, i) => { const w = 'scenes[' + (i + 1) + ']'; if (!isObj(sc)) { R(w, '不是对象，已丢弃'); return; } if (typeof sc.id !== 'string' || !sc.id) { R(w, '缺少文本 id，已丢弃'); return; }
      const o = Object.assign({}, sc); o.name = text(sc, 'name', w, sc.id); o.desc = text(sc, 'desc', w, ''); o.ev = sev(sc.ev, w); o.steps = [];
      list(sc.steps, w + '.steps').forEach((st, j) => { const sw = w + '.steps[' + (j + 1) + ']'; if (!isObj(st)) { R(sw, '不是对象，已丢弃'); return; } const q = Object.assign({}, st); q.title = text(st, 'title', sw, ''); q.note = text(st, 'note', sw, ''); q.nodes = strs(st.nodes, sw + '.nodes'); q.edges = strs(st.edges, sw + '.edges');
        q.writes = []; list(st.writes, sw + '.writes').forEach((x, k) => { const ww = sw + '.writes[' + (k + 1) + ']'; if (!isObj(x)) { R(ww, '不是对象，已丢弃'); return; } if (typeof x.reg !== 'string' || !x.reg) { R(ww, '缺少文本 reg，已丢弃'); return; } if (typeof x.value !== 'number' || !Number.isFinite(x.value)) { R(ww, 'value 不是数字，已丢弃'); return; } const y = Object.assign({}, x); if (x.note != null) { const s = text(x, 'note', ww, undefined); if (s === undefined) delete y.note; else y.note = s; } q.writes.push(y); });
        if (st.line != null) { if (Number.isInteger(st.line) && st.line >= 0) q.line = st.line; else { R(sw + '.line', '不是非负整数，已忽略'); delete q.line; } } q.ev = sev(st.ev, sw); o.steps.push(q); }); out.scenes.push(o); });
    out.rules = []; list(m.rules, 'rules').forEach((r, i) => { const w = 'rules[' + (i + 1) + ']'; if (!isObj(r)) { R(w, '不是对象，已丢弃'); return; } if (typeof r.id !== 'string' || !r.id) { R(w, '缺少文本 id，已丢弃'); return; }
      const o = Object.assign({}, r); o.name = text(r, 'name', w, r.id); o.trigger = text(r, 'trigger', w, 'level'); o.when = text(r, 'when', w, ''); o.then = strs(r.then, w + '.then'); o.else = strs(r.else, w + '.else'); o.note = text(r, 'note', w, ''); o.ev = sev(r.ev, w); out.rules.push(o); });
    out.timings = []; list(m.timings, 'timings').forEach((t, i) => { const w = 'timings[' + (i + 1) + ']'; if (!isObj(t)) { R(w, '不是对象，已丢弃'); return; } if (typeof t.id !== 'string' || !t.id) { R(w, '缺少文本 id，已丢弃'); return; }
      const o = Object.assign({}, t); o.name = text(t, 'name', w, t.id); const hs = num(t, 'hscale', w); o.hscale = hs === undefined ? 1 : hs; o.note = text(t, 'note', w, ''); o.ev = sev(t.ev, w); o.signals = [];
      list(t.signals, w + '.signals').forEach((sg, j) => { const sw = w + '.signals[' + (j + 1) + ']'; if (!isObj(sg)) { R(sw, '不是对象，已丢弃'); return; } const nm = scalarStr(sg.name); if (nm === undefined || !nm) { R(sw, '缺少文本 name，已丢弃'); return; } const q = Object.assign({}, sg); q.name = nm; q.wave = text(sg, 'wave', sw, '');
        if (sg.data == null) q.data = []; else if (Array.isArray(sg.data)) q.data = sg.data.map((x, k) => { const s = scalarStr(x); if (s === undefined) { R(sw + '.data[' + (k + 1) + ']', '不是文本，已丢弃'); return undefined; } return s; }).filter(x => x !== undefined); else if (typeof sg.data === 'string') q.data = sg.data.split(/[ \t\r\n]+/).filter(Boolean); else { R(sw + '.data', '不是列表，已忽略'); q.data = []; }
        o.signals.push(q); }); out.timings.push(o); });
    return out;
  };
  IPM.normalize = m => {
    m = m || {}; const rep = [], sn = sanitize(isObj(m) ? m : {}, rep); const r = { schema: m.schema || IPM.SCHEMA, id: String(m.id || 'model'), name: String(m.name || m.id || '未命名 IP 模型'), kind: IPM.MODEL_KINDS.includes(m.kind) ? m.kind : 'instance', rev: Number.isInteger(m.rev) ? m.rev : 1,
      chip: String(m.chip || ''), family: String(m.family || ''), extends: String(m.extends || ''), source: String(m.source || ''), docrev: m.docrev != null ? String(m.docrev) : '',
      description: String(m.description || ''), refs: Array.isArray(m.refs) ? m.refs.filter(isObj).map(x => Object.assign({}, x)) : [], nodes: sn.nodes, edges: sn.edges, registers: sn.registers, scenes: sn.scenes, rules: sn.rules, timings: sn.timings };
    Object.defineProperty(r, '__repairs', { value: rep, enumerable: false, writable: true });   /* what was dropped / ignored while loading (never written to the file) */
    return r;
  };
  const nodeShape = (n, defLevel) => {
    if (!isObj(n)) E('bad-node', '节点必须是对象'); if (!isId(n.id)) E('bad-id', '节点 id “' + n.id + '” 无效（字母 / 数字 / _ / -，字母或 _ 开头，不能含 .）');
    const kind = n.kind != null ? n.kind : (IPM.KINDS.includes(n.type) ? n.type : 'logic'); if (!IPM.KINDS.includes(kind)) E('bad-kind', '节点类型 “' + kind + '” 无效（' + IPM.KINDS.join(' / ') + '）');
    const o = { id: n.id, type: String(n.type || kind), kind, name: String(n.name || n.id) }; if (n.parent) o.parent = String(n.parent);
    if (n.params != null && !isObj(n.params)) E('bad-param', 'params 必须是对象'); o.params = {}; for (const k of Object.keys(n.params || {})) { checkParam(k, n.params[k]); o.params[k] = n.params[k]; }
    o.ports = []; const seen = new Set(); for (const p of (n.ports || [])) { const q = portShape(p); if (seen.has(q.id)) E('dup-port', '端口重复：' + n.id + '.' + q.id); seen.add(q.id); o.ports.push(q); }
    o.registers = Array.isArray(n.registers) ? n.registers.map(String) : []; o.ev = ev(n.ev, defLevel); if (n.note) o.note = String(n.note); return o;
  };
  const portShape = p => { if (!isObj(p) || !isId(p.id)) E('bad-id', '端口 id “' + (p && p.id) + '” 无效'); if (!IPM.PORT_TYPES.includes(p.type)) E('bad-port-type', '端口类型 “' + p.type + '” 无效（' + IPM.PORT_TYPES.join(' / ') + '）'); if (!IPM.DIRS.includes(p.dir)) E('bad-dir', '端口方向 “' + p.dir + '” 无效（in / out / inout）'); const q = { id: p.id, type: p.type, dir: p.dir }; if (p.name) q.name = String(p.name); return q; };
  const checkParam = (k, v) => { if (typeof k !== 'string' || !k) E('bad-param', '参数名不能为空'); if (RESERVED.has(k)) E('bad-param', '参数名 ' + k + ' 是保留名');  if (v !== null && !['string', 'number', 'boolean'].includes(typeof v)) E('bad-param', '参数 ' + k + ' 的值只能是字符串 / 数字 / 布尔'); };
  const descendants = (m, id, idx) => { const kids = idx || (() => { const k = new Map(); m.nodes.forEach(n => { if (n.parent) { const a = k.get(n.parent); if (a) a.push(n.id); else k.set(n.parent, [n.id]); } }); return k; })(), out = new Set(), q = [id]; while (q.length) { const c = q.pop(); (kids.get(c) || []).forEach(x => { if (!out.has(x)) { out.add(x); q.push(x); } }); } return out; };   /* 2.2: children index instead of a full scan per visited node */
  const edgeId = (m, s, t) => { const base = 'e_' + (s + '_' + t).replace(/\./g, '_'); let id = base, i = 2; while (m.edges.some(e => e.id === id)) id = base + '_' + i++; return id; };
  const regShape = r => {
    if (!isObj(r) || !isId(r.id)) E('bad-id', '寄存器 id “' + (r && r.id) + '” 无效'); const o = { id: r.id, name: String(r.name || r.id) };
    const w = r.width == null ? 32 : r.width; if (!Number.isInteger(w) || w < 1) E('bad-reg', '寄存器 ' + r.id + ' 位宽无效'); o.width = w;
    if (r.address != null && r.address !== '') { const a = toInt(r.address); if (a == null || a < 0) E('bad-reg', '寄存器 ' + r.id + ' 地址无效：' + r.address); o.address = a; }
    if (r.reset != null && r.reset !== '') { const a = toInt(r.reset); if (a == null || a < 0) E('bad-reg', '寄存器 ' + r.id + ' 复位值无效：' + r.reset); o.reset = a; }
    if (r.desc) o.desc = String(r.desc); o.fields = []; for (const f of (r.fields || [])) { if (!isObj(f) || !f.name) E('bad-reg', '寄存器 ' + r.id + ' 的位域缺少 name'); const x = { name: String(f.name), bits: String(f.bits == null ? '' : f.bits) }; if (f.desc) x.desc = String(f.desc); x.ev = ev(f.ev); o.fields.push(x); }
    o.ev = ev(r.ev); return o;
  };


  /* ---------------------------------------------------------------- scenes (2.0)
     A scene is an ordered walk-through on the model's diagram: each step highlights nodes / edges, writes register values (decoded with the model's
     register fields) and carries a short explanation.  Scenes are part of the model (one source of truth), so they follow renames / deletes automatically. */
  const sceneOf = (m, id) => m.scenes.find(x => x.id === id) || E('no-scene', '场景不存在：' + id);
  const uniq = a => Array.from(new Set(a));
  const stepShape = (m, s) => {
    if (!isObj(s)) E('bad-step', '步骤必须是对象'); const title = String(s.title == null ? '' : s.title).trim(); if (!title) E('bad-step', '步骤需要标题（title）');
    const nodes = uniq((s.nodes || []).map(String)); nodes.forEach(id => nodeOf(m, id));
    const edges = uniq((s.edges || []).map(String)); edges.forEach(id => { if (!m.edges.some(e => e.id === id)) E('no-edge', '连线不存在：' + id); });
    const writes = (s.writes || []).map(w => { if (!isObj(w) || w.reg == null) E('bad-write', '寄存器写入需要 reg'); const reg = String(w.reg); if (!m.registers[reg]) E('no-register', '寄存器不存在：' + reg); const v = toInt(w.value); if (v == null || v < 0) E('bad-write', '寄存器 ' + reg + ' 的值无效：' + w.value); const o = { reg, value: v }; if (w.note) o.note = String(w.note); return o; });
    const o = { title, note: s.note ? String(s.note) : '', nodes, edges, writes, ev: ev(s.ev) }; if (s.line != null && s.line !== '') { if (!Number.isInteger(s.line) || s.line < 0) E('bad-step', '代码行号必须是非负整数'); o.line = s.line; } return o;
  };
  const sceneShape = (m, sc) => {
    if (!isObj(sc) || !isId(sc.id)) E('bad-id', '场景 id “' + (sc && sc.id) + '” 无效'); const o = { id: sc.id, name: String(sc.name || sc.id), desc: sc.desc ? String(sc.desc) : '', ev: ev(sc.ev, '待核对'), steps: [] };
    (sc.steps || []).forEach(x => o.steps.push(stepShape(m, x))); return o;
  };
  const dropEdgeRefs = (m, gone) => { if (!gone.size) return; m.scenes.forEach(sc => sc.steps.forEach(st => { st.edges = st.edges.filter(x => !gone.has(x)); })); };
  const lenOf = v => { if (v == null || v === false || v === 0 || v === '') return 0; if (!Array.isArray(v)) throw new TypeError('not a list'); return v.length; };   /* length of an optional list for a description: anything that is not a list is malformed (mirror of _len in ip_model.py) */
  const disp = i => (Number.isInteger(i) ? i + 1 : String(i == null ? null : i));   /* 1-based number for display; anything else is shown as it was sent (never "x1") */
  const stepAt = (sc, i) => { if (!Number.isInteger(i) || i < 0 || i >= sc.steps.length) E('no-step', '场景 ' + sc.id + ' 没有第 ' + disp(i) + ' 步（共 ' + sc.steps.length + ' 步）'); return sc.steps[i]; };

  /* ---------------------------------------------------------------- behaviour rules (2.3)
     A rule says "when this holds, that follows".  It is DATA taken from a manual: the model never invents hardware behaviour.  Expressions live in ip-expr.js (no eval).
       level  — state that follows a condition (an interrupt line = status & enable).  `then` applies while `when` is true, `else` while it is false.  Idempotent: an action may not read its own target.
       edge   — something that happens once when `when` turns from false to true (a counter step, an event).  May read its own target; `emit` is only allowed here. */
  const IPE = G.ChipBenchIPE || (typeof require !== 'undefined' ? require('./ip-expr.js') : null);
  const RULE_MAX = 200, ACT_MAX = 16, trimA = x => String(x).replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');   /* ASCII-only trim: String.trim and Python strip disagree about Unicode whitespace (the BOM) */
  const ruleParse = (m, r) => {   /* → { errs: [{ code, msg }], reads: Set, writes: Set, acts } — pure; used by the ops AND by validate */
    const errs = [], reads = new Set(), writes = new Set(), acts = { then: [], else: [] }; const E1 = (code, msg) => errs.push({ code, msg });
    const refOk = (ref, where) => { const R = m.registers[ref.name]; if (ref.field != null) { if (!R) { E1('rule-ref', where + '：' + ref.name + '.' + ref.field + ' 不是寄存器位域（“' + ref.name + '”不是已定义的寄存器）'); return; } if (!(R.fields || []).some(f => f.name === ref.field)) { E1('rule-ref', where + '：寄存器 ' + ref.name + ' 没有位域 ' + ref.field); return; } } };
    const w = r.when == null ? '' : String(r.when), pw = IPE.parse(w);
    if (!pw.ok) E1('rule-expr', '条件：' + pw.msg + (pw.pos >= 0 ? '（第 ' + (pw.pos + 1) + ' 个字符）' : '')); else IPE.refs(pw.ast).forEach(x => { refOk(x, '条件'); reads.add(x.field != null ? x.name + '.' + x.field : x.name); });
    ['then', 'else'].forEach(side => { const list = Array.isArray(r[side]) ? r[side] : []; if (side === 'else' && list.length && r.trigger === 'edge') E1('rule-else-edge', '“边沿”规则没有“否则”分支（它只在条件由假变真的那一刻动作）'); if (list.length > ACT_MAX) E1('rule-too-many', (side === 'then' ? '满足时' : '否则') + '最多 ' + ACT_MAX + ' 条动作');
      list.forEach((txt, i) => { const where = (side === 'then' ? '满足时' : '否则') + '第 ' + (i + 1) + ' 条', a = IPE.parseAction(txt); if (!a.ok) { E1('rule-expr', where + '：' + a.msg + (a.pos > 0 ? '（第 ' + (a.pos + 1) + ' 个字符）' : '')); return; }
        if (a.kind === 'emit') { if (r.trigger !== 'edge') E1('rule-emit-level', where + '：emit 只能用在“边沿”规则里（事件是“发生了一次”，电平规则表示的是“状态”）'); if (a.node && !m.nodes.some(n => n.id === a.node)) E1('rule-ref', where + '：节点 ' + a.node + ' 不存在'); acts[side].push(a); return; }
        const tk = a.target.field != null ? a.target.name + '.' + a.target.field : a.target.name; refOk(a.target, where); writes.add(tk); IPE.refs(a.expr).forEach(x => { refOk(x, where); reads.add(x.field != null ? x.name + '.' + x.field : x.name); });
        if (r.trigger !== 'edge') { const self = IPE.refs(a.expr).some(x => (x.field != null ? x.name + '.' + x.field : x.name) === tk || (a.target.field != null && x.field == null && x.name === a.target.name) || (a.target.field == null && x.field != null && x.name === a.target.name)); if (self) E1('rule-selfref', where + '：电平规则里的动作不能读它自己要写的 ' + tk + '（那是“每次加 1”这种边沿行为，请把规则类型改为“边沿”）'); }
        acts[side].push(a); }); });
    return { errs, reads, writes, acts };
  };
  const ruleShape = (m, r) => {
    if (!isObj(r) || !isId(r.id)) E('bad-id', '规则 id “' + (isObj(r) ? r.id : r) + '” 无效'); const trig = r.trigger == null ? 'level' : r.trigger; if (trig !== 'level' && trig !== 'edge') E('bad-rule', '规则类型必须是 level（电平）或 edge（边沿）');
    const o = { id: r.id, name: String(r.name == null || r.name === '' ? r.id : r.name).slice(0, 80), trigger: trig, when: trimA(r.when == null ? '' : r.when), then: (Array.isArray(r.then) ? r.then : []).map(trimA).filter(Boolean), else: (Array.isArray(r.else) ? r.else : []).map(trimA).filter(Boolean), note: r.note ? String(r.note).slice(0, 300) : '', ev: ev(r.ev, '待核对') };
    const chk = ruleParse(m, o); if (chk.errs.length) E(chk.errs[0].code, '规则 ' + o.id + ' · ' + chk.errs[0].msg);   /* syntax / reference problems first: they are what the author is fixing; "needs an action" would mask them while typing */
    if (!o.then.length && !o.else.length) E('bad-rule', '规则 ' + o.id + ' 没有任何动作（满足时 / 否则 至少写一条）'); return o;
  };
  const rewriteEmit = (m, fn) => m.rules.forEach(r => ['then', 'else'].forEach(side => { r[side] = r[side].map(t => { const mm = /^(\s*emit\s+"[^"\\\n]{1,120}")(?:\s+@([A-Za-z_][A-Za-z0-9_\-]*))?\s*$/.exec(t); if (!mm || !mm[2]) return t; const nn = fn(mm[2]); return nn === mm[2] ? t : (nn ? mm[1] + ' @' + nn : mm[1]); }); }));
  const rulesUsing = (m, reg) => m.rules.filter(r => { const c = ruleParse(m, r); return Array.from(c.reads).concat(Array.from(c.writes)).some(k => k === reg || k.startsWith(reg + '.')); }).map(r => r.id);

  /* ---------------------------------------------------------------- timing diagrams (2.3)
     Signals with a WaveDrom-style wave string (the subset the built-in renderer draws): 0 1 x z p P n N l L h H = 2-9 . |   · a data label is consumed by every = / 2-9 cell.
     A timing is DATA: a figure from a manual (with its page), not something the model derives. */
  const WAVE_CH = '01xzpPnNlLhH=23456789.|', TIM_MAX_SIG = 32, TIM_MAX_WAVE = 256;
  const timingShape = (m, t) => {
    if (!isObj(t) || !isId(t.id)) E('bad-id', '时序图 id “' + (isObj(t) ? t.id : t) + '” 无效');
    const hs = t.hscale == null ? 1 : t.hscale; if (!Number.isInteger(hs) || hs < 1 || hs > 8) E('bad-timing', '时序图 ' + t.id + ' 的横向缩放（hscale）必须是 1–8 的整数');
    const sigs = Array.isArray(t.signals) ? t.signals : []; if (!sigs.length) E('bad-timing', '时序图 ' + t.id + ' 至少要有一个信号'); if (sigs.length > TIM_MAX_SIG) E('bad-timing', '时序图 ' + t.id + ' 最多 ' + TIM_MAX_SIG + ' 个信号');
    const signals = sigs.map((s, i) => { if (!isObj(s) || !String(s.name == null ? '' : s.name).trim()) E('bad-timing', '时序图 ' + t.id + ' 第 ' + (i + 1) + ' 个信号需要名字'); const name = String(s.name).trim().slice(0, 40), wave = String(s.wave == null ? '' : s.wave), cps = Array.from(wave);
      if (cps.length > TIM_MAX_WAVE) E('bad-wave', '信号 ' + name + ' 的波形太长（最多 ' + TIM_MAX_WAVE + ' 个字符）'); const bad = cps.find(c => !WAVE_CH.includes(c)); if (bad !== undefined) E('bad-wave', '信号 ' + name + ' 的波形里有不支持的字符 “' + bad + '”（可用：0 1 x z p P n N l L h H = 2–9 . |）');
      const raw = Array.isArray(s.data) ? s.data : String(s.data == null ? '' : s.data).split(/[ \t\r\n]+/).filter(Boolean); if (raw.length > 64) E('bad-wave', '信号 ' + name + ' 的数据标签最多 64 个');
      return { name, wave, data: raw.map(x => String(x).slice(0, 40)) }; });
    return { id: t.id, name: String(t.name == null || t.name === '' ? t.id : t.name).slice(0, 80), hscale: hs, signals, note: t.note ? String(t.note).slice(0, 300) : '', ev: ev(t.ev, '待核对') };
  };
  const waveLabels = w => Array.from(w).filter(c => '=23456789'.includes(c)).length;

  /* ---------------------------------------------------------------- ops */
  const OPS = {
    add_node(m, p) { const n = nodeShape(p.node, '待核对'); if (m.nodes.some(x => x.id === n.id)) E('dup-node', '节点 id 已存在：' + n.id); if (n.parent) { if (n.parent === n.id) E('bad-parent', '节点不能是自己的父节点'); nodeOf(m, n.parent); } m.nodes.push(n); },
    remove_node(m, p) { nodeOf(m, p.id); const gone = descendants(m, p.id); gone.add(p.id); m.nodes = m.nodes.filter(n => !gone.has(n.id)); const dead = new Set(m.edges.filter(e => gone.has(ep(e.source).node) || gone.has(ep(e.target).node)).map(e => e.id)); m.edges = m.edges.filter(e => !dead.has(e.id)); dropEdgeRefs(m, dead); m.scenes.forEach(sc => sc.steps.forEach(st => { st.nodes = st.nodes.filter(x => !gone.has(x)); })); rewriteEmit(m, id => (gone.has(id) ? '' : id)); },   /* an event that pointed at a removed node keeps its text, loses the highlight */
    update_node(m, p) {
      const n = nodeOf(m, p.id), s = p.set || {}; if (!isObj(s)) E('bad-op', 'set 必须是对象');
      for (const k of Object.keys(s)) { if (!['name', 'type', 'kind', 'note', 'ev', 'parent'].includes(k)) E('bad-op', '不能通过 update_node 修改 ' + k + '（参数用 set_param，端口用 add_port / remove_port，id 用 rename_node）'); }
      if ('kind' in s) { if (!IPM.KINDS.includes(s.kind)) E('bad-kind', '节点类型 “' + s.kind + '” 无效'); n.kind = s.kind; } if ('name' in s) n.name = String(s.name); if ('type' in s) n.type = String(s.type); if ('note' in s) { if (s.note) n.note = String(s.note); else delete n.note; }
      if ('ev' in s) n.ev = Object.assign({}, n.ev, ev(s.ev)); if ('parent' in s) { if (!s.parent) delete n.parent; else { nodeOf(m, s.parent); if (s.parent === n.id || descendants(m, n.id).has(s.parent)) E('bad-parent', '会形成循环的父子关系：' + n.id + ' → ' + s.parent); n.parent = String(s.parent); } }
    },
    rename_node(m, p) { const n = nodeOf(m, p.id); if (!isId(p.to)) E('bad-id', '新 id “' + p.to + '” 无效'); if (m.nodes.some(x => x.id === p.to)) E('dup-node', '节点 id 已存在：' + p.to); const old = n.id; n.id = p.to; rewriteEmit(m, id => (id === old ? p.to : id)); m.scenes.forEach(sc => sc.steps.forEach(st => { st.nodes = st.nodes.map(x => (x === old ? p.to : x)); })); m.nodes.forEach(x => { if (x.parent === old) x.parent = p.to; }); m.edges.forEach(e => { const s = ep(e.source), t = ep(e.target); if (s.node === old) e.source = p.to + (s.port ? '.' + s.port : ''); if (t.node === old) e.target = p.to + (t.port ? '.' + t.port : ''); }); },
    add_port(m, p) { const n = nodeOf(m, p.node), q = portShape(p.port); if (portOf(n, q.id)) E('dup-port', '端口重复：' + n.id + '.' + q.id); n.ports.push(q); },
    remove_port(m, p) { const n = nodeOf(m, p.node); if (!portOf(n, p.port)) E('no-port', '端口不存在：' + p.node + '.' + p.port); n.ports = n.ports.filter(x => x.id !== p.port); const key = p.node + '.' + p.port, dead = new Set(m.edges.filter(e => e.source === key || e.target === key).map(e => e.id)); m.edges = m.edges.filter(e => !dead.has(e.id)); dropEdgeRefs(m, dead); },
    add_edge(m, p) {
      const e = p.edge; if (!isObj(e)) E('bad-edge', '连线必须是对象'); const S = ep(e.source), T = ep(e.target), sn = nodeOf(m, S.node), tn = nodeOf(m, T.node);
      if (S.port != null && !portOf(sn, S.port)) E('no-port', '端口不存在：' + e.source); if (T.port != null && !portOf(tn, T.port)) E('no-port', '端口不存在：' + e.target);
      if (e.source === e.target) E('self-edge', '连线两端相同：' + e.source);
      let type = e.type; if (!type) type = (S.port && portOf(sn, S.port).type) || (T.port && portOf(tn, T.port).type) || 'data'; if (!IPM.PORT_TYPES.includes(type)) E('bad-edge', '连线类型 “' + type + '” 无效');
      if (m.edges.some(x => x.source === e.source && x.target === e.target && x.type === type)) E('dup-edge', '重复的连线：' + e.source + ' → ' + e.target + '（' + type + '）');
      const id = e.id ? String(e.id) : edgeId(m, e.source, e.target); if (!isId(id)) E('bad-id', '连线 id “' + id + '” 无效'); if (m.edges.some(x => x.id === id)) E('dup-edge-id', '连线 id 已存在：' + id);
      const o = { id, source: e.source, target: e.target, type }; if (e.name) o.name = String(e.name); o.ev = ev(e.ev); m.edges.push(o);
    },
    remove_edge(m, p) { if (!m.edges.some(e => e.id === p.id)) E('no-edge', '连线不存在：' + p.id); m.edges = m.edges.filter(e => e.id !== p.id); dropEdgeRefs(m, new Set([p.id])); },
    set_param(m, p) { const n = nodeOf(m, p.node); checkParam(p.key, p.value == null ? null : p.value); if (p.value == null) delete n.params[p.key]; else n.params[p.key] = p.value; },
    set_registers(m, p) { const n = nodeOf(m, p.node); if (!Array.isArray(p.registers)) E('bad-op', 'registers 必须是列表'); const ids = p.registers.map(String); n.registers = p.replace ? ids : n.registers.concat(ids.filter(x => !n.registers.includes(x))); },
    define_register(m, p) { const r = regShape(p.register); m.registers[r.id] = r;
      /* redefining must not bypass the protection remove_register has: a rule that reads a field this definition no longer has would be left dangling */
      const broken = m.rules.map(x => ({ id: x.id, errs: ruleParse(m, x).errs.filter(e => e.code === 'rule-ref' && (e.msg.includes('寄存器 ' + r.id + ' 没有位域') || e.msg.includes(r.id + '.'))) })).filter(x => x.errs.length); if (broken.length) E('in-use', '寄存器 ' + r.id + ' 的新定义去掉了规则 ' + broken.map(x => x.id).join('、') + ' 还在引用的位域（' + broken[0].errs[0].msg.replace(/^.*：/, '') + '）：先修改或删除这些规则'); },
    remove_register(m, p) { if (!m.registers[p.id]) E('no-register', '寄存器不存在：' + p.id); { const u = rulesUsing(m, p.id); if (u.length) E('in-use', '寄存器 ' + p.id + ' 被规则 ' + u.join('、') + ' 引用：先修改或删除这些规则（公式里的名字不会被自动改写）'); } delete m.registers[p.id]; m.nodes.forEach(n => { n.registers = n.registers.filter(x => x !== p.id); }); m.scenes.forEach(sc => sc.steps.forEach(st => { st.writes = st.writes.filter(w => w.reg !== p.id); })); },
    set_evidence(m, p) {
      const t = String(p.target || ''), i = t.indexOf(':'), kind = t.slice(0, i), id = t.slice(i + 1); let o;
      if (kind === 'node') o = nodeOf(m, id); else if (kind === 'edge') o = m.edges.find(e => e.id === id) || E('no-edge', '连线不存在：' + id);
      else if (kind === 'register') o = m.registers[id] || E('no-register', '寄存器不存在：' + id);
      else if (kind === 'field') { const [r, f] = id.split('.'); const R = m.registers[r] || E('no-register', '寄存器不存在：' + r); o = R.fields.find(x => x.name === f) || E('no-field', '位域不存在：' + id); } else E('bad-op', 'target 应为 node:ID / edge:ID / register:ID / field:REG.FIELD');
      o.ev = Object.assign({}, o.ev, ev(p.ev));
    },
    set_meta(m, p) { const s = p.set || {}; for (const k of Object.keys(s)) { if (!['name', 'chip', 'family', 'kind', 'extends', 'source', 'docrev', 'description', 'refs'].includes(k)) E('bad-op', '不能修改元数据 ' + k); if (k === 'kind' && !IPM.MODEL_KINDS.includes(s[k])) E('bad-kind', '模型类型无效：' + s[k]); if (k === 'refs') { if (!Array.isArray(s.refs) || !s.refs.every(isObj)) E('bad-op', 'refs 必须是对象列表'); m.refs = clone(s.refs); } else m[k] = String(s[k]); } },
    add_timing(m, p) { if (m.timings.length >= 100) E('too-many', '时序图最多 100 个'); const t = timingShape(m, p.timing); if (m.timings.some(x => x.id === t.id)) E('dup-timing', '时序图 id 已存在：' + t.id); m.timings.push(t); },
    remove_timing(m, p) { if (!m.timings.some(x => x.id === p.id)) E('no-timing', '时序图不存在：' + p.id); m.timings = m.timings.filter(x => x.id !== p.id); },
    update_timing(m, p) { const i = m.timings.findIndex(x => x.id === p.id); if (i < 0) E('no-timing', '时序图不存在：' + p.id); const s = p.set || {}; if (!isObj(s)) E('bad-op', 'set 必须是对象'); for (const k of Object.keys(s)) if (!['name', 'hscale', 'signals', 'note', 'ev'].includes(k)) E('bad-op', '不能修改时序图的 ' + k + '（id 不能改）'); const cur = m.timings[i], merged = Object.assign({}, cur, s); if ('ev' in s) merged.ev = Object.assign({}, cur.ev, ev(s.ev)); m.timings[i] = timingShape(m, merged); },
    add_rule(m, p) { if (m.rules.length >= RULE_MAX) E('too-many', '规则最多 ' + RULE_MAX + ' 条'); const r = ruleShape(m, p.rule); if (m.rules.some(x => x.id === r.id)) E('dup-rule', '规则 id 已存在：' + r.id); m.rules.push(r); },
    remove_rule(m, p) { if (!m.rules.some(x => x.id === p.id)) E('no-rule', '规则不存在：' + p.id); m.rules = m.rules.filter(x => x.id !== p.id); },
    update_rule(m, p) { const i = m.rules.findIndex(x => x.id === p.id); if (i < 0) E('no-rule', '规则不存在：' + p.id); const s = p.set || {}; if (!isObj(s)) E('bad-op', 'set 必须是对象'); for (const k of Object.keys(s)) if (!['name', 'trigger', 'when', 'then', 'else', 'note', 'ev'].includes(k)) E('bad-op', '不能修改规则的 ' + k + '（id 不能改；要换 id 请删除后重新添加）'); const cur = m.rules[i], merged = Object.assign({}, cur, s); if ('ev' in s) merged.ev = Object.assign({}, cur.ev, ev(s.ev)); m.rules[i] = ruleShape(m, merged); },
    add_scene(m, p) { const sc = sceneShape(m, p.scene); if (m.scenes.some(x => x.id === sc.id)) E('dup-scene', '场景 id 已存在：' + sc.id); m.scenes.push(sc); },
    remove_scene(m, p) { sceneOf(m, p.id); m.scenes = m.scenes.filter(x => x.id !== p.id); },
    update_scene(m, p) { const sc = sceneOf(m, p.id), s = p.set || {}; if (!isObj(s)) E('bad-op', 'set 必须是对象'); for (const k of Object.keys(s)) { if (!['name', 'desc', 'ev'].includes(k)) E('bad-op', '不能通过 update_scene 修改 ' + k + '（步骤用 add_step / update_step / remove_step / move_step）'); } if ('name' in s) sc.name = String(s.name || sc.id); if ('desc' in s) sc.desc = s.desc ? String(s.desc) : ''; if ('ev' in s) sc.ev = Object.assign({}, sc.ev, ev(s.ev)); },
    add_step(m, p) { const sc = sceneOf(m, p.scene), st = stepShape(m, p.step); let i = p.index == null ? sc.steps.length : p.index; if (!Number.isInteger(i) || i < 0 || i > sc.steps.length) E('no-step', '插入位置 ' + p.index + ' 无效（0–' + sc.steps.length + '）'); sc.steps.splice(i, 0, st); },
    update_step(m, p) { const sc = sceneOf(m, p.scene), cur = stepAt(sc, p.index), s = p.set || {}; if (!isObj(s)) E('bad-op', 'set 必须是对象'); for (const k of Object.keys(s)) { if (!['title', 'note', 'nodes', 'edges', 'writes', 'line', 'ev'].includes(k)) E('bad-op', '不能修改步骤的 ' + k); } const merged = Object.assign({}, cur, s); if ('ev' in s) merged.ev = Object.assign({}, cur.ev, ev(s.ev)); if ('line' in s && (s.line == null || s.line === '')) delete merged.line; sc.steps[p.index] = stepShape(m, merged); },
    remove_step(m, p) { const sc = sceneOf(m, p.scene); stepAt(sc, p.index); sc.steps.splice(p.index, 1); },
    move_step(m, p) { const sc = sceneOf(m, p.scene); stepAt(sc, p.from); if (!Number.isInteger(p.to) || p.to < 0 || p.to >= sc.steps.length) E('no-step', '目标位置 ' + p.to + ' 无效（0–' + (sc.steps.length - 1) + '）'); const [x] = sc.steps.splice(p.from, 1); sc.steps.splice(p.to, 0, x); },
  };
  IPM.OP_NAMES = Object.keys(OPS);
  /* apply(model, ops) → { ok, model, errors:[{index, op, code, msg}], applied }.  Atomic: on any error the input model is returned untouched. */
  IPM.apply = (model, ops) => {
    const m = IPM.normalize(clone(model)); const errors = [];
    if ((m.__repairs || []).length) return { ok: false, model: IPM.normalize(clone(model)), errors: [{ index: -1, op: null, code: 'damaged-model', msg: '这个模型文件有 ' + m.__repairs.length + ' 处结构损坏（' + m.__repairs.slice(0, 3).join('；') + (m.__repairs.length > 3 ? '…' : '') + '），为避免保存时悄悄丢掉这些内容，不能修改；请先在校验页签查看，手动修复文件。' }], applied: 0 };
    (Array.isArray(ops) ? ops : [ops]).forEach((op, i) => { try { if (!isObj(op) || typeof op.op !== 'string' || !Object.prototype.hasOwnProperty.call(OPS, op.op)) E('bad-op', '未知操作：' + String(isObj(op) ? op.op : null) + '（可用：' + IPM.OP_NAMES.join(' / ') + '）'); OPS[op.op](m, op); } catch (e) { if (e instanceof IpErr) errors.push({ index: i, op: isObj(op) ? op.op : null, code: e.code, msg: e.message });
    else errors.push({ index: i, op: isObj(op) ? op.op : null, code: 'bad-args', msg: '操作 ' + String(isObj(op) ? op.op : null) + ' 的参数格式不对（类型错误或缺少必要字段）' }); /* safety net: whatever is inside, a malformed operation is a refusal — never an exception.  Same code and text in mcp/ip_model.py */ } });
    if (errors.length) return { ok: false, model: IPM.normalize(clone(model)), errors, applied: 0 };
    m.rev = (Number.isInteger(m.rev) ? m.rev : 1) + 1; return { ok: true, model: m, errors: [], applied: (Array.isArray(ops) ? ops : [ops]).length };
  };

  /* ---------------------------------------------------------------- validate */
  /* → [{ level: err|warn|info, code, msg, ref:{kind,id} }] */
  IPM.validate = model => {
    const m = IPM.normalize(model), out = [], push = (level, code, msg, ref) => out.push({ level, code, msg, ref: ref || null });
    (m.__repairs || []).forEach(x => push('err', 'bad-structure', '文件结构损坏：' + x, null));   /* what loading had to drop or ignore is an ERROR, never a silently healthy file */
    if (m.schema !== IPM.SCHEMA) push('err', 'schema', 'schema 应为 ' + IPM.SCHEMA + '，当前是 “' + m.schema + '”');
    const ids = new Map(); m.nodes.forEach(n => {
      if (!isId(n.id)) push('err', 'bad-id', '节点 id “' + n.id + '” 无效', { kind: 'node', id: n.id }); if (ids.has(n.id)) push('err', 'dup-node', '节点 id 重复：' + n.id, { kind: 'node', id: n.id }); ids.set(n.id, n);
      if (!IPM.KINDS.includes(n.kind)) push('err', 'bad-kind', '节点 ' + n.id + ' 的类型 “' + n.kind + '” 无效', { kind: 'node', id: n.id });
      const seen = new Set(); (n.ports || []).forEach(p => { if (seen.has(p.id)) push('err', 'dup-port', '端口重复：' + n.id + '.' + p.id, { kind: 'node', id: n.id }); seen.add(p.id); if (!IPM.PORT_TYPES.includes(p.type)) push('err', 'bad-port-type', '端口 ' + n.id + '.' + p.id + ' 类型无效：' + p.type, { kind: 'node', id: n.id }); if (!IPM.DIRS.includes(p.dir)) push('err', 'bad-dir', '端口 ' + n.id + '.' + p.id + ' 方向无效：' + p.dir, { kind: 'node', id: n.id }); });
      if (n.ev && n.ev.level && !IPM.EV_LEVELS.includes(n.ev.level)) push('err', 'bad-ev', '节点 ' + n.id + ' 的依据等级无效：' + n.ev.level, { kind: 'node', id: n.id });
      if (n.ev && n.ev.page != null && parsePages(n.ev.page) === null) push('err', 'bad-ev', '节点 ' + n.id + ' 的页码格式不对：' + n.ev.page, { kind: 'node', id: n.id });
    });
    m.nodes.forEach(n => { if (n.parent) { if (!ids.has(n.parent)) push('err', 'parent-missing', '节点 ' + n.id + ' 的父节点不存在：' + n.parent, { kind: 'node', id: n.id }); else { let c = n.parent, k = 0; while (c && k++ < 1000) { if (c === n.id) { push('err', 'parent-cycle', '节点 ' + n.id + ' 的父子关系形成循环', { kind: 'node', id: n.id }); break; } c = (ids.get(c) || {}).parent; } } } });
    const eids = new Set(), used = new Set();
    m.edges.forEach(e => {
      if (eids.has(e.id)) push('err', 'dup-edge-id', '连线 id 重复：' + e.id, { kind: 'edge', id: e.id }); eids.add(e.id);
      const S = ep(e.source), T = ep(e.target), sn = ids.get(S.node), tn = ids.get(T.node); let ok = true;
      if (!sn) { push('err', 'no-endpoint', '连线 ' + e.id + ' 的起点节点不存在：' + S.node, { kind: 'edge', id: e.id }); ok = false; } if (!tn) { push('err', 'no-endpoint', '连线 ' + e.id + ' 的终点节点不存在：' + T.node, { kind: 'edge', id: e.id }); ok = false; }
      if (!ok) return; used.add(S.node); used.add(T.node); const sp = S.port != null ? portOf(sn, S.port) : null, tp = T.port != null ? portOf(tn, T.port) : null;
      if (S.port != null && !sp) { push('err', 'no-port', '连线 ' + e.id + ' 的起点端口不存在：' + e.source, { kind: 'edge', id: e.id }); return; } if (T.port != null && !tp) { push('err', 'no-port', '连线 ' + e.id + ' 的终点端口不存在：' + e.target, { kind: 'edge', id: e.id }); return; }
      if (!IPM.PORT_TYPES.includes(e.type)) push('err', 'bad-edge', '连线 ' + e.id + ' 的类型无效：' + e.type, { kind: 'edge', id: e.id });
      [sp, tp].forEach(p => { if (p && p.type !== e.type) push('warn', 'edge-type-mismatch', '连线 ' + e.id + '（' + e.type + '）连到了 ' + p.type + ' 端口 ' + (p === sp ? e.source : e.target), { kind: 'edge', id: e.id }); });
      if (sp && sp.dir === 'in') push('warn', 'edge-direction', '连线 ' + e.id + ' 的起点是输入端口 ' + e.source, { kind: 'edge', id: e.id }); if (tp && tp.dir === 'out') push('warn', 'edge-direction', '连线 ' + e.id + ' 的终点是输出端口 ' + e.target, { kind: 'edge', id: e.id });
    });
    const withKids = new Set(m.nodes.filter(n => n.parent).map(n => n.parent)); m.nodes.forEach(n => { if (!used.has(n.id) && !withKids.has(n.id) && !n.parent && m.edges.length) push('info', 'orphan-node', '节点 ' + n.id + ' 没有任何连线', { kind: 'node', id: n.id }); });
    const regIds = new Set(Object.keys(m.registers)); m.nodes.forEach(n => (n.registers || []).forEach(r => { if (!regIds.has(r)) push('warn', 'reg-missing', '节点 ' + n.id + ' 引用的寄存器 ' + r + ' 没有定义', { kind: 'node', id: n.id }); }));
    const addr = new Map(); Object.keys(m.registers).forEach(id => {
      const r = m.registers[id]; if (![8, 16, 32, 64].includes(r.width)) push('warn', 'reg-width', '寄存器 ' + id + ' 的位宽 ' + r.width + ' 不是 8/16/32/64', { kind: 'register', id });
      if (r.address != null) { if (addr.has(r.address)) push('warn', 'reg-address', '寄存器 ' + id + ' 与 ' + addr.get(r.address) + ' 地址相同', { kind: 'register', id }); else addr.set(r.address, id); }
      if (r.reset != null && r.width < 53 && r.reset >= Math.pow(2, r.width)) push('err', 'reg-reset', '寄存器 ' + id + ' 的复位值超出 ' + r.width + ' 位', { kind: 'register', id });
      const taken = []; (r.fields || []).forEach(f => { const b = parseBits(f.bits); if (!b) return push('err', 'reg-bits', '寄存器 ' + id + ' 位域 ' + f.name + ' 的 bits “' + f.bits + '” 格式不对', { kind: 'field', id: id + '.' + f.name }); if (b[0] >= r.width) push('err', 'reg-bits', '寄存器 ' + id + ' 位域 ' + f.name + ' 的 bit ' + b[0] + ' 超出位宽 ' + r.width, { kind: 'field', id: id + '.' + f.name }); const hit = taken.find(t => !(b[0] < t.b[1] || b[1] > t.b[0])); if (hit) push('warn', 'field-overlap', '寄存器 ' + id + ' 位域 ' + f.name + ' 与 ' + hit.f.name + ' 的位范围重叠', { kind: 'field', id: id + '.' + f.name }); taken.push({ f, b }); });
    });
    /* scenes */
    const sids = new Set(); m.scenes.forEach(sc => {
      const sref = { kind: 'scene', id: sc.id }; if (!isId(sc.id)) push('err', 'bad-id', '场景 id “' + sc.id + '” 无效', sref); if (sids.has(sc.id)) push('err', 'dup-scene', '场景 id 重复：' + sc.id, sref); sids.add(sc.id);
      if (sc.ev && sc.ev.level && !IPM.EV_LEVELS.includes(sc.ev.level)) push('err', 'bad-ev', '场景 ' + sc.id + ' 的依据等级无效：' + sc.ev.level, sref); if (!sc.steps.length) push('warn', 'scene-empty', '场景 ' + sc.id + ' 没有步骤', sref);
      sc.steps.forEach((st, i) => { const at = sc.id + ' 第 ' + (i + 1) + ' 步', r = { kind: 'scene', id: sc.id };
        if (!String(st.title || '').trim()) push('err', 'scene-step', '场景 ' + at + ' 没有标题', r);
        (st.nodes || []).forEach(x => { if (!ids.has(x)) push('err', 'scene-ref', '场景 ' + at + ' 高亮的节点 ' + x + ' 不存在', r); });
        (st.edges || []).forEach(x => { if (!eids.has(x)) push('err', 'scene-ref', '场景 ' + at + ' 高亮的连线 ' + x + ' 不存在', r); });
        (st.writes || []).forEach(w => { const R = m.registers[w.reg]; if (!R) return push('err', 'scene-ref', '场景 ' + at + ' 写入的寄存器 ' + w.reg + ' 没有定义', r); if (R.width < 53 && w.value >= Math.pow(2, R.width)) push('err', 'scene-write', '场景 ' + at + '：寄存器 ' + w.reg + ' 的值 0x' + w.value.toString(16).toUpperCase() + ' 超出 ' + R.width + ' 位', r); });
        if (!(st.nodes || []).length && !(st.edges || []).length) push('info', 'step-no-highlight', '场景 ' + at + ' 没有高亮任何节点或连线', r); });
    });
    /* rules */
    const rids = new Set(), assigned = new Set(), readBy = new Map(); m.rules.forEach(r => { const rref = { kind: 'rule', id: r.id }; if (!isId(r.id)) push('err', 'bad-id', '规则 id “' + r.id + '” 无效', rref); if (rids.has(r.id)) push('err', 'dup-rule', '规则 id 重复：' + r.id, rref); rids.add(r.id);
      if (r.ev && r.ev.level && !IPM.EV_LEVELS.includes(r.ev.level)) push('err', 'bad-ev', '规则 ' + r.id + ' 的依据等级无效：' + r.ev.level, rref); if (r.trigger !== 'level' && r.trigger !== 'edge') push('err', 'bad-rule', '规则 ' + r.id + ' 的类型无效：' + r.trigger, rref); if (!(r.then || []).length && !(r.else || []).length) push('err', 'bad-rule', '规则 ' + r.id + ' 没有任何动作', rref);
      const c = ruleParse(m, r); c.errs.forEach(e => push('err', e.code, '规则 ' + r.id + ' · ' + e.msg, rref)); c.writes.forEach(k => assigned.add(k)); c.reads.forEach(k => { if (!readBy.has(k)) readBy.set(k, r.id); }); });
    readBy.forEach((rid, k) => { if (!k.includes('.') && !m.registers[k] && !assigned.has(k)) push('warn', 'rule-var', '规则 ' + rid + ' 读取的 ' + k + ' 不是寄存器，也没有任何规则给它赋值（拼写错误？）', { kind: 'rule', id: rid }); });
    /* timings */
    const tids = new Set(); m.timings.forEach(tm => { const tref = { kind: 'timing', id: tm.id }; if (!isId(tm.id)) push('err', 'bad-id', '时序图 id “' + tm.id + '” 无效', tref); if (tids.has(tm.id)) push('err', 'dup-timing', '时序图 id 重复：' + tm.id, tref); tids.add(tm.id);
      if (tm.ev && tm.ev.level && !IPM.EV_LEVELS.includes(tm.ev.level)) push('err', 'bad-ev', '时序图 ' + tm.id + ' 的依据等级无效：' + tm.ev.level, tref); if (!Number.isInteger(tm.hscale) || tm.hscale < 1 || tm.hscale > 8) push('err', 'timing-hscale', '时序图 ' + tm.id + ' 的横向缩放必须是 1–8 的整数', tref); if (!(tm.signals || []).length) push('err', 'timing-empty', '时序图 ' + tm.id + ' 没有信号', tref);
      const seen = new Set(); (tm.signals || []).forEach(sg => { const w = String(sg.wave || ''), bad = Array.from(w).find(c => !WAVE_CH.includes(c)); if (bad !== undefined) push('err', 'timing-wave', '时序图 ' + tm.id + ' 信号 ' + sg.name + ' 的波形里有不支持的字符 “' + bad + '”', tref); const need = waveLabels(w), have = (sg.data || []).length; if (need !== have && (need || have)) push('warn', 'timing-data', '时序图 ' + tm.id + ' 信号 ' + sg.name + '：波形里有 ' + need + ' 个需要标签的段，数据标签有 ' + have + ' 个', tref); if (seen.has(sg.name)) push('warn', 'timing-dup-signal', '时序图 ' + tm.id + ' 里信号名重复：' + sg.name, tref); seen.add(sg.name); }); });
    if (m.kind === 'template') { const bad = m.nodes.filter(n => !n.ev || n.ev.level !== '示意').length + Object.values(m.registers).filter(r => r.address != null || r.reset != null).length + m.scenes.filter(sc => !sc.ev || sc.ev.level !== '示意' || sc.steps.some(st => st.writes.length)).length + m.rules.length + m.timings.length; if (bad) push('warn', 'template-fact', '模板只描述结构：' + bad + ' 项不是“示意”等级或带有地址 / 复位值', null); }
    else {
      const facts = m.nodes.filter(n => Object.keys(n.params || {}).length && !(n.ev && ['手册确认', '实测'].includes(n.ev.level))).length + Object.values(m.registers).filter(r => (r.address != null || r.reset != null) && !(r.ev && ['手册确认', '实测'].includes(r.ev.level))).length;
      const ut = m.timings.filter(x => !(x.ev && ['手册确认', '实测'].includes(x.ev.level))).length; if (ut) push('info', 'unverified-timings', ut + ' 个时序图还没有“手册确认”或“实测”依据', null);
      const ur = m.rules.filter(r => !(r.ev && ['手册确认', '实测'].includes(r.ev.level))).length; if (ur) push('info', 'unverified-rules', ur + ' 条规则还没有“手册确认”或“实测”依据：推演结果只和规则一样可靠', null);
      const us = m.scenes.filter(sc => !(sc.ev && ['手册确认', '实测'].includes(sc.ev.level))).length; if (us) push('info', 'unverified-scenes', us + ' 个场景还没有“手册确认”或“实测”依据', null);
      if (facts) push('info', 'unverified-facts', facts + ' 项带参数 / 地址 / 复位值的内容还没有“手册确认”或“实测”依据', null);
      if (m.source) { const np = m.nodes.filter(n => !(n.ev && n.ev.page != null && n.ev.page !== '')).length; if (np) push('warn', 'no-page', np + ' 个节点没有手册页码', null); } else if (m.nodes.length) push('info', 'no-source', '没有填写 source（手册文件名），页码无法跳转', null);
    }
    return out;
  };
  IPM.summary = (model, vv) => { const m = IPM.normalize(model), v = vv || IPM.validate(m);   /* 2.2: callers that already validated pass the findings (validate is the costly part) */ const lv = {}; IPM.EV_LEVELS.forEach(l => lv[l] = 0); m.nodes.forEach(n => { lv[(n.ev && n.ev.level) || '待核对']++; }); return { id: m.id, name: m.name, kind: m.kind, rev: m.rev, nodes: m.nodes.length, edges: m.edges.length, registers: Object.keys(m.registers).length, scenes: m.scenes.length, rules: m.rules.length, timings: m.timings.length, errors: v.filter(x => x.level === 'err').length, warnings: v.filter(x => x.level === 'warn').length, nodeEvidence: lv }; };

  /* ---------------------------------------------------------------- subgraph / diff / canonical */
  /* the node + all its descendants, expanded `depth` hops along edges (edges are followed in both directions) */
  IPM.subgraph = (model, o) => {
    const m = IPM.normalize(model); o = o || {}; if (!o.node) return clone(m); const root = nodeOf(m, o.node); const keep = descendants(m, root.id); keep.add(root.id);
    let front = new Set(keep); for (let d = 0; d < (o.depth == null ? 1 : o.depth); d++) { const next = new Set(); m.edges.forEach(e => { const s = ep(e.source).node, t = ep(e.target).node; if (front.has(s) && !keep.has(t)) next.add(t); if (front.has(t) && !keep.has(s)) next.add(s); }); next.forEach(x => { keep.add(x); descendants(m, x).forEach(y => keep.add(y)); }); front = next; if (!next.size) break; }
    const r = clone(m); r.nodes = r.nodes.filter(n => keep.has(n.id)).map(n => (n.parent && !keep.has(n.parent) ? Object.assign({}, n, { parent: undefined }) : n)).map(n => { if (n.parent === undefined) delete n.parent; return n; });
    r.edges = r.edges.filter(e => keep.has(ep(e.source).node) && keep.has(ep(e.target).node)); const need = new Set(); r.nodes.forEach(n => n.registers.forEach(x => need.add(x))); Object.keys(r.registers).forEach(k => { if (!need.has(k)) delete r.registers[k]; });
    r.scenes = []; r.rules = []; r.timings = []; r.fragment = { node: root.id, depth: o.depth == null ? 1 : o.depth, of: m.id }; return r;
  };
  const sortKeys = v => Array.isArray(v) ? v.map(sortKeys) : isObj(v) ? Object.keys(v).sort().reduce((a, k) => { if (v[k] !== undefined) a[k] = sortKeys(v[k]); return a; }, {}) : v;
  IPM.canonical = m => JSON.stringify(sortKeys(IPM.normalize(m)));
  IPM.diff = (a, b) => {
    a = IPM.normalize(a); b = IPM.normalize(b); const d = { nodes: { added: [], removed: [], modified: [] }, edges: { added: [], removed: [], modified: [] }, registers: { added: [], removed: [], modified: [] }, scenes: { added: [], removed: [], modified: [] }, rules: { added: [], removed: [], modified: [] }, timings: { added: [], removed: [], modified: [] }, meta: [] };
    const cmp = (xs, ys, key, bucket) => { const X = new Map(xs.map(x => [key(x), x])), Y = new Map(ys.map(x => [key(x), x])); Y.forEach((v, k) => { if (!X.has(k)) bucket.added.push(k); else if (JSON.stringify(sortKeys(X.get(k))) !== JSON.stringify(sortKeys(v))) bucket.modified.push(k); }); X.forEach((v, k) => { if (!Y.has(k)) bucket.removed.push(k); }); };
    cmp(a.nodes, b.nodes, n => n.id, d.nodes); cmp(a.edges, b.edges, e => e.id, d.edges); cmp(Object.values(a.registers), Object.values(b.registers), r => r.id, d.registers); cmp(a.scenes, b.scenes, x => x.id, d.scenes); cmp(a.rules, b.rules, x => x.id, d.rules); cmp(a.timings, b.timings, x => x.id, d.timings);
    ['name', 'chip', 'family', 'kind', 'extends', 'source', 'docrev', 'description'].forEach(k => { if (a[k] !== b[k]) d.meta.push(k); }); if (JSON.stringify(a.refs) !== JSON.stringify(b.refs)) d.meta.push('refs');
    d.empty = !(d.meta.length || ['nodes', 'edges', 'registers', 'scenes', 'rules', 'timings'].some(k => d[k].added.length || d[k].removed.length || d[k].modified.length)); return d;
  };
  /* ops → short human lines (proposal review) */
  IPM.describeOp = op => {
    if (!isObj(op)) return '无效操作（不是对象）';
    if (['node', 'port', 'register', 'edge', 'scene', 'step', 'rule', 'timing', 'set', 'ev'].some(k => op[k] != null && !isObj(op[k]))) return op.op + '（参数不完整）';   /* a description must never throw or print nonsense for a malformed op */
    const f = { add_node: o => '添加节点 ' + o.node.id + (o.node.name && o.node.name !== o.node.id ? '（' + o.node.name + '）' : ''), remove_node: o => '删除节点 ' + o.id + '（连带子节点和连线）', update_node: o => '修改节点 ' + o.id + '：' + Object.keys(o.set || {}).join('、'), rename_node: o => '重命名节点 ' + o.id + ' → ' + o.to,
      add_port: o => '添加端口 ' + o.node + '.' + o.port.id + '（' + o.port.type + ' / ' + o.port.dir + '）', remove_port: o => '删除端口 ' + o.node + '.' + o.port, add_edge: o => '连线 ' + o.edge.source + ' → ' + o.edge.target + (o.edge.type ? '（' + o.edge.type + '）' : ''), remove_edge: o => '删除连线 ' + o.id,
      set_param: o => (o.value == null ? '删除参数 ' : '设置参数 ') + o.node + '.' + o.key + (o.value == null ? '' : ' = ' + o.value), set_registers: o => (o.replace ? '设置' : '关联') + '寄存器 ' + o.node + ' ← ' + o.registers.join('、'), define_register: o => '定义寄存器 ' + o.register.id, remove_register: o => '删除寄存器 ' + o.id,
      set_evidence: o => '设置依据 ' + o.target + '：' + Object.entries(o.ev || {}).map(([k, v]) => k + '=' + v).join('，'), set_meta: o => '修改模型信息：' + Object.keys(o.set || {}).join('、'),
      add_timing: o => '添加时序图 ' + o.timing.id + (o.timing.name && o.timing.name !== o.timing.id ? '（' + o.timing.name + '）' : '') + '，' + lenOf(o.timing.signals) + ' 个信号', remove_timing: o => '删除时序图 ' + o.id, update_timing: o => '修改时序图 ' + o.id + '：' + Object.keys(o.set || {}).join('、'),
      add_rule: o => '添加规则 ' + o.rule.id + (o.rule.name && o.rule.name !== o.rule.id ? '（' + o.rule.name + '）' : '') + '：' + (o.rule.trigger === 'edge' ? '边沿' : '电平') + ' · 当 ' + o.rule.when, remove_rule: o => '删除规则 ' + o.id, update_rule: o => '修改规则 ' + o.id + '：' + Object.keys(o.set || {}).join('、'),
      add_scene: o => '添加场景 ' + o.scene.id + (o.scene.name && o.scene.name !== o.scene.id ? '（' + o.scene.name + '）' : '') + '，' + lenOf(o.scene.steps) + ' 步', remove_scene: o => '删除场景 ' + o.id, update_scene: o => '修改场景 ' + o.id + '：' + Object.keys(o.set || {}).join('、'),
      add_step: o => '场景 ' + o.scene + ' 添加步骤：' + (o.step && o.step.title), update_step: o => '场景 ' + o.scene + ' 修改第 ' + disp(o.index) + ' 步：' + Object.keys(o.set || {}).join('、'), remove_step: o => '场景 ' + o.scene + ' 删除第 ' + disp(o.index) + ' 步', move_step: o => '场景 ' + o.scene + ' 把第 ' + disp(o.from) + ' 步移到第 ' + disp(o.to) + ' 位' };
    try { return typeof op.op === 'string' && Object.prototype.hasOwnProperty.call(f, op.op) ? f[op.op](op) : '未知操作 ' + String(op.op === undefined ? null : op.op); } catch (e) { return op.op + '（参数不完整）'; }
  };

  /* ---------------------------------------------------------------- templates / instantiate */
  /* a template (kind: template) → ops that add a copy of it under `prefix` (ids become prefix + "_" + id; the template's top node becomes `prefix`) */
  /* 1.9: registers of one SVD peripheral (X.parseSVD output) → ops.  Vendor SVD is NOT the manual: everything arrives as 待核对 (sec "SVD"); enumerations go into the field description. */
  IPM.svdOps = (regs, o) => {
    o = o || {}; const per = o.peripheral, ops = [], ids = [], taken = new Set(o.taken || []);
    (regs || []).filter(r => !per || String(r.name).split('.')[0] === per).forEach(r => {
      const short = String(r.name).split('.').slice(1).join('_') || String(r.name); let id = String(per ? short : String(r.name).replace(/\./g, '_')).replace(/[^A-Za-z0-9_\-]/g, '_').replace(/^[^A-Za-z_]/, '_$&'), k = 2, b = id; while (taken.has(id)) id = b + '_' + (k++); taken.add(id);
      const width = Number.isInteger(r.width) && r.width > 0 ? r.width : 32; const reg = { id, name: short, width, desc: r.desc || '', fields: [], ev: { level: '待核对', sec: 'SVD' } };
      if (Number.isFinite(r.address) && r.address >= 0) reg.address = r.address; if (Number.isFinite(r.reset) && r.reset >= 0 && width < 53 && r.reset < Math.pow(2, width)) reg.reset = r.reset;
      (r.fields || []).forEach(f => { if (!f.name || !/^\d+(:\d+)?$/.test(String(f.bits))) return; const vals = f.values ? Object.keys(f.values).map(k2 => k2 + '=' + String(f.values[k2]).split(' — ')[0]).join(', ') : ''; reg.fields.push({ name: f.name, bits: String(f.bits), desc: [f.desc, f.access ? '[' + f.access + ']' : '', vals].filter(Boolean).join(' ').trim(), ev: { level: '待核对', sec: 'SVD' } }); });
      ops.push({ op: 'define_register', register: reg }); ids.push(id);
    });
    if (o.node && ids.length) ops.push({ op: 'set_registers', node: o.node, registers: ids });
    return ops;
  };
  IPM.instantiate = (tpl, o) => {
    tpl = IPM.normalize(tpl); o = o || {}; const prefix = o.prefix; if (!isId(prefix)) E('bad-id', '前缀 “' + prefix + '” 无效'); const roots = tpl.nodes.filter(n => !n.parent), top = roots.length === 1 ? roots[0].id : null;
    const mapId = id => (id === top ? prefix : prefix + '_' + id), ops = [];
    tpl.nodes.forEach(n => { const c = clone(n); c.id = mapId(n.id); if (n.id === top) { c.parent = o.parent || undefined; if (o.name) c.name = o.name; } else c.parent = n.parent ? mapId(n.parent) : (o.parent || undefined); if (c.parent === undefined) delete c.parent; ops.push({ op: 'add_node', node: c }); });
    tpl.edges.forEach(e => { const mp = s => { const x = ep(s); return mapId(x.node) + (x.port ? '.' + x.port : ''); }; const c = clone(e); c.id = prefix + '_' + e.id; c.source = mp(e.source); c.target = mp(e.target); ops.push({ op: 'add_edge', edge: c }); });
    Object.keys(tpl.registers).forEach(k => { const r = clone(tpl.registers[k]); r.id = prefix + '_' + k; ops.push({ op: 'define_register', register: r }); }); ops.forEach(op => { if (op.op === 'add_node') op.node.registers = (op.node.registers || []).map(r => prefix + '_' + r); });
    return ops;
  };

  /* ---------------------------------------------------------------- render adapter: model → the raw object ipblock.js renders */
  const LKIND = { clock: 'clock', reset: 'ctrl', irq: 'irq', data: 'data', bus: 'bus', ctrl: 'ctrl', dma: 'dma', io: 'data' };
  /* 2.2: index-based (was O(edges × blocks)); links whose end was lifted onto a collapsed group are MERGED per (from, to, kind): the overview of a big chip shows one
     link "×19" between two subsystems instead of nineteen parallel lines (a 300-block model collapsed to 17 blocks still carried 396 links before). */
  IPM.toIpblock = (model, o) => {
    const m = IPM.normalize(model); o = o || {}; const byId = new Map(m.nodes.map(n => [n.id, n])), kidsOf = new Map(), collapsed = new Set(o.collapsed || []);
    m.nodes.forEach(n => { if (n.parent) { const a = kidsOf.get(n.parent); if (a) a.push(n.id); else kidsOf.set(n.parent, [n.id]); } });
    const hidden = new Set(); collapsed.forEach(id => { const q = (kidsOf.get(id) || []).slice(); while (q.length) { const c = q.pop(); if (hidden.has(c)) continue; hidden.add(c); (kidsOf.get(c) || []).forEach(x => q.push(x)); } });
    const groups = [], blocks = [], shown = new Set();
    m.nodes.forEach(n => { if (hidden.has(n.id)) return; shown.add(n.id); const isGroup = kidsOf.has(n.id) && !collapsed.has(n.id);
      if (isGroup) groups.push({ id: n.id, label: n.name, parent: n.parent && !hidden.has(n.parent) ? n.parent : undefined });
      else { const b = { id: n.id, label: n.name, kind: n.kind === 'group' ? 'logic' : n.kind, group: n.parent || undefined, regs: n.registers.slice(), ports: n.ports.map(p => ({ id: p.id, dir: p.dir })) }; if (n.ev && n.ev.page != null) b.page = n.ev.page; if (n.ev && n.ev.level === '手册确认') b.status = 'verified'; else if (n.ev && n.ev.level === '待核对') b.status = 'todo'; if (n.note) b.note = n.note; if (b.group && hidden.has(b.group)) b.group = undefined; blocks.push(b); } });
    const lift = x => { let id = x.node; if (!hidden.has(id)) return { e: x, lifted: false }; while (id && hidden.has(id)) id = (byId.get(id) || {}).parent; return { e: { node: id, port: null }, lifted: true }; };
    const links = [], merged = new Map();
    m.edges.forEach(e => { const a = lift(ep(e.source)), b = lift(ep(e.target)), s = a.e, t = b.e; if (!s.node || !t.node || s.node === t.node || !shown.has(s.node) || !shown.has(t.node)) return;
      const from = s.node + (s.port ? '.' + s.port : ''), to = t.node + (t.port ? '.' + t.port : ''), kind = LKIND[e.type] || 'data';
      if (a.lifted || b.lifted) { const k = from + '\u0001' + to + '\u0001' + kind, hit = merged.get(k); if (hit) { hit.count++; hit.link.label = '×' + hit.count; hit.link.count = hit.count; return; } const link = { from, to, kind, label: e.name || '' }; merged.set(k, { link, count: 1 }); links.push(link); return; }
      links.push({ from, to, kind, label: e.name || '' }); });
    return { title: m.name, source: m.source, direction: o.direction || 'right', groups, blocks, links };
  };

  /* ---------------------------------------------------------------- migration: Markdown atlas page → model */
  IPM.fromAtlas = (text, AM, o) => {
    AM = AM || G.ChipBenchAM; o = o || {}; const M = AM.build(text), m = IPM.create({ id: o.id || ((M.meta.ip || 'ip') + '-' + (M.meta.chip || 'chip')).replace(/[^A-Za-z0-9_\-]/g, '_').replace(/^[^A-Za-z_]/, '_$&'), name: (M.meta.ip || 'IP') + ' · ' + (M.meta.chip || ''), chip: M.meta.chip, source: M.meta.source, docrev: M.meta.docrev, description: M.meta.chapter || '' });
    const warnings = [], taken = new Set(), idOf = (id, diagram) => id; const KMAP = { periph: 'periph', cpu: 'cpu', bus: 'bus', mem: 'mem', dma: 'dma', logic: 'logic', io: 'io', clock: 'clock', irq: 'irq', ext: 'ext', analog: 'analog' };
    const evOf = x => { const r = {}; if (x && x.ev) { if (x.ev.level) r.level = x.ev.level; if (x.ev.page != null) r.page = x.ev.page; if (x.ev.sec) r.sec = x.ev.sec; if (x.ev.cond) r.cond = x.ev.cond; } return r; };
    const rename = new Map(); M.diagrams.forEach(d => { d.groups.forEach(g => { let id = idOf(g.id); if (taken.has(id)) { warnings.push('重复的 id 已跳过：' + g.id); return; } taken.add(id); m.nodes.push({ id, type: 'group', kind: 'group', name: String(g.label), params: {}, ports: [], registers: [], ev: { level: '待核对' }, parent: g.parent || undefined }); });
      d.blocks.forEach(b => { const id = idOf(b.id); if (taken.has(id)) { warnings.push('重复的 id 已跳过：' + b.id); return; } taken.add(id); const n = { id, type: KMAP[b.kind] || 'logic', kind: KMAP[b.kind] || 'logic', name: String(b.label), params: {}, ports: b.ports.map(p => ({ id: p.id, type: 'data', dir: ['in', 'out', 'inout'].includes(p.dir) ? p.dir : 'inout' })), registers: b.regs.slice(), ev: evOf(b) }; if (b.group) n.parent = b.group; if (b.status === 'verified' && !n.ev.level) n.ev.level = '手册确认'; if (!n.ev.level) n.ev.level = '待核对'; m.nodes.push(n); }); });
    m.nodes.forEach(n => { if (n.parent === undefined) delete n.parent; });
    const LT = { bus: 'bus', data: 'data', clock: 'clock', irq: 'irq', dma: 'dma', ctrl: 'ctrl' }; M.links.forEach((l, i) => { const type = LT[l.kind] || 'data'; const need = (id, port, dir) => { const n = m.nodes.find(x => x.id === id); if (!n || !port) return; if (!n.ports.some(p => p.id === port)) n.ports.push({ id: port, type, dir }); }; need(l.from, l.fromPort, 'out'); need(l.to, l.toPort, 'in');
      if (!m.nodes.some(n => n.id === l.from) || !m.nodes.some(n => n.id === l.to)) { warnings.push('连线 ' + l.raw.join(' → ') + ' 引用了不存在的节点，已跳过'); return; } const e = { id: 'e' + (i + 1), source: l.from + (l.fromPort ? '.' + l.fromPort : ''), target: l.to + (l.toPort ? '.' + l.toPort : ''), type, ev: {} }; if (l.label) e.name = l.label; m.edges.push(e); });
    M.registers.forEach((r, k) => { const id = k.replace(/[^A-Za-z0-9_\-]/g, '_').replace(/^[^A-Za-z_]/, '_$&'); const o2 = { id, name: r.name, width: r.width, desc: r.desc || '', fields: r.fields.map(f => ({ name: f.name, bits: f.bitsRaw, desc: f.desc || '', ev: evOf(f) })), ev: evOf(r) }; if (!Number.isNaN(r.address)) o2.address = r.address; if (!Number.isNaN(r.reset)) o2.reset = r.reset; m.registers[id] = o2; });
    m.nodes.forEach(n => { n.registers = n.registers.map(r => (M.registers.has(String(r).toUpperCase()) ? String(r).toUpperCase() : r).replace(/[^A-Za-z0-9_\-]/g, '_').replace(/^[^A-Za-z_]/, '_$&')); });
    /* 2.0: scenes of the page → model scenes.  hl → nodes; "a>b" links → the model edges between a and b (either direction); regs → register writes */
    const sceneIds = new Set(); (M.scenes || []).forEach((sc, si) => {
      let sid = String(sc.title || '').replace(/[^A-Za-z0-9_\-]+/g, '_').replace(/^_+|_+$/g, ''); if (!sid || !/^[A-Za-z_]/.test(sid)) sid = 'scene' + (si + 1); const b0 = sid; let k = 2; while (sceneIds.has(sid)) sid = b0 + '_' + k++; sceneIds.add(sid);
      const steps = []; sc.steps.forEach((s, i) => { if (s.bad) { warnings.push('场景 ' + sc.title + ' 第 ' + (i + 1) + ' 步格式不对，已跳过'); return; }
        const nodes = (s.hl || []).filter(x => { const ok = m.nodes.some(n => n.id === x); if (!ok) warnings.push('场景 ' + sc.title + ' 第 ' + (i + 1) + ' 步高亮了不存在的模块 ' + x); return ok; });
        const edges = []; (s.links || []).forEach(l => { const [a, b] = String(l).split('>').map(x => x.trim()); const hit = m.edges.filter(e => (ep(e.source).node === a && ep(e.target).node === b) || (ep(e.source).node === b && ep(e.target).node === a)); if (!hit.length) warnings.push('场景 ' + sc.title + ' 第 ' + (i + 1) + ' 步的连线 ' + l + ' 在模型里没有对应的边'); hit.forEach(e => { if (!edges.includes(e.id)) edges.push(e.id); }); });
        const writes = []; (s.regs || []).forEach(r => { const rid = String(r.r).toUpperCase().replace(/[^A-Za-z0-9_\-]/g, '_').replace(/^[^A-Za-z_]/, '_$&'); if (!m.registers[rid]) { warnings.push('场景 ' + sc.title + ' 第 ' + (i + 1) + ' 步写入的寄存器 ' + r.r + ' 没有定义，已跳过'); return; } if (!Number.isInteger(r.v) || r.v < 0) { warnings.push('场景 ' + sc.title + ' 第 ' + (i + 1) + ' 步寄存器 ' + r.r + ' 的值不是数字，已跳过'); return; } const w = { reg: rid, value: r.v }; if (r.n) w.note = String(r.n); writes.push(w); });
        const st = { title: String(s.t || '步骤 ' + (i + 1)), note: s.x ? String(s.x) : '', nodes, edges, writes, ev: evOf(s) }; if (Number.isInteger(s.line) && s.line >= 0) st.line = s.line; steps.push(st); });
      m.scenes.push({ id: sid, name: String(sc.title || sid), desc: sc.diagram ? '图：' + sc.diagram : '', ev: { level: '待核对' }, steps }); });
    /* 2.3: ```wavedrom blocks → timings.  Only plain signals {name, wave, data?} are carried over (WaveDrom groups / nested arrays are reported, not guessed). */
    (M.timings || []).forEach((tm, ti) => { const y = tm.data, label = '时序图 ' + (ti + 1); if (!y || !Array.isArray(y.signal)) { warnings.push(label + ' 不是有效的 WaveDrom（没有 signal 列表），已跳过'); return; }
      const sig = [], skipped = []; y.signal.forEach((sg, k) => { if (sg && !Array.isArray(sg) && typeof sg === 'object' && sg.name != null && typeof sg.wave === 'string' && Array.from(sg.wave).every(c => WAVE_CH.includes(c))) sig.push({ name: String(sg.name), wave: sg.wave, data: Array.isArray(sg.data) ? sg.data.map(String) : String(sg.data == null ? '' : sg.data).split(/[ \t\r\n]+/).filter(Boolean) }); else skipped.push(k + 1); });
      if (skipped.length) warnings.push(label + ' 的第 ' + skipped.join('、') + ' 项（分组 / 不支持的波形字符）已跳过'); if (!sig.length) { warnings.push(label + ' 没有可迁移的信号，已跳过'); return; }
      const hs = Number(y.config && y.config.hscale || y.hscale || 1); m.timings.push({ id: 'timing' + (ti + 1), name: String(y.head && y.head.text || label), hscale: Number.isInteger(hs) && hs >= 1 && hs <= 8 ? hs : 1, signals: sig, note: '', ev: { level: '待核对' } }); });
    if (o.path) m.refs.push({ type: 'atlas-page', path: o.path }); return { model: IPM.normalize(m), warnings };
  };


  /* decode a register value into its fields: [{ name, bits:[hi,lo], value }] (fields whose bits are malformed are skipped) */
  IPM.decode = (reg, value) => { const v = BigInt.asUintN(64, BigInt(Math.trunc(value))); return (reg.fields || []).map(f => { const b = parseBits(f.bits); if (!b) return null; const w = b[0] - b[1] + 1; return { name: f.name, bits: b, value: Number((v >> BigInt(b[1])) & ((1n << BigInt(w)) - 1n)), desc: f.desc || '' }; }).filter(Boolean); };

  /* layout / view sidecar */
  IPM.LAYOUT_SCHEMA = 'chipbench.ip.layout/1';
  IPM.emptyLayout = () => ({ schema: IPM.LAYOUT_SCHEMA, positions: {}, collapsed: [], view: { mode: '结构', zoom: 1, direction: 'right' }, auto: true });
  IPM.normalizeLayout = l => { const b = IPM.emptyLayout(); if (!isObj(l)) return b; return { schema: IPM.LAYOUT_SCHEMA, positions: isObj(l.positions) ? l.positions : {}, collapsed: Array.isArray(l.collapsed) ? l.collapsed.map(String) : [], view: Object.assign(b.view, isObj(l.view) ? l.view : {}), auto: l.auto !== false && !Object.keys(isObj(l.positions) ? l.positions : {}).length || l.auto === true }; };
  IPM.PROPOSAL_SCHEMA = 'chipbench.ip.proposal/1';
  IPM.WAVE_CH = WAVE_CH; IPM.waveLabels = waveLabels;
  IPM.RESERVED = Array.from(RESERVED); IPM.ID_RE = ID_RE; IPM.isId = isId; IPM.clone = clone;

  G.ChipBenchIPM = IPM; if (G.ChipBench) G.ChipBench.IPM = IPM;
  if (typeof module !== 'undefined' && module.exports) module.exports = IPM;
})(typeof window !== 'undefined' ? window : globalThis);
