/* ChipBench · atlas-model.js — the unified chip-engineering knowledge model behind an IP-atlas page (1.7).  Pure: no DOM, runs in Node.
   Until 1.6 the structure diagram (ipblock), registers, scenes, timing and code of a page were parsed by separate widgets, so they
   could contradict each other and no fact carried its source.  This module parses ONE page into ONE graph:

     ChipVariant ─ Block ─ Port/Signal(link) ─ Register ─ Field ─ Step(scene) ─ Timing ─ Code
                                  └──────────────  SourceEvidence  ──────────────┘

   Every block / register / field / scene step may carry evidence in the page YAML:
       page: 1203   (number, "12-14", or a list)     ev: 手册确认 | 实测 | 推导 | 示意 | 待核对 (default 待核对)
       sec: "24.4.2"  manual section                 cond: "GL_OPERATION"   applicability condition
   and the page front matter carries the manual identity:  source / docrev / chip.
   The model never invents hardware facts: impact() and validate() only cross-reference what the page itself says. */
(function (G) {
  'use strict';
  const X = (G.ChipBench && G.ChipBench.X) || G.ChipBenchX || (typeof require !== 'undefined' ? require('./logic.js') : {});
  const AM = {}; AM.SCHEMA = 1;
  AM.EV_LEVELS = ['手册确认', '实测', '推导', '示意', '待核对'];          // strongest → weakest
  const EV_ALIAS = { confirmed: '手册确认', manual: '手册确认', measured: '实测', derived: '推导', schematic: '示意', todo: '待核对', unverified: '待核对', '已确认': '手册确认', '已核对': '手册确认' };
  const arr = v => v == null ? [] : Array.isArray(v) ? v : [v];
  const fence = /```([\w-]+)[^\n]*\n([\s\S]*?)\n```/g;
  const num = v => { if (typeof v === 'number') return v; const s = String(v == null ? '' : v).trim(); if (/^0x[0-9a-f_]+$/i.test(s)) return parseInt(s.replace(/_/g, ''), 16); if (/^-?\d+$/.test(s)) return +s; return NaN; };
  AM.evLevel = v => { const s = String(v == null ? '' : v).trim(); return AM.EV_LEVELS.includes(s) ? s : (EV_ALIAS[s.toLowerCase()] || (s ? null : '待核对')); };
  /* page spec → sorted unique ints; "12-14" → [12,13,14]; invalid → null */
  AM.pages = v => { if (v == null || v === '') return []; const out = []; for (const part of arr(v).join(',').split(/[,;，、\s]+/).filter(Boolean)) { const m = part.match(/^(\d+)(?:-(\d+))?$/); if (!m) return null; const a = +m[1], b = m[2] ? +m[2] : a; if (b < a || b - a > 200) return null; for (let i = a; i <= b; i++) out.push(i); } return Array.from(new Set(out)).sort((a, b) => a - b); };
  AM.bits = b => { const s = String(b == null ? '' : b).trim(); let m = s.match(/^(\d+)\s*:\s*(\d+)$/); if (m) { const hi = +m[1], lo = +m[2]; return hi >= lo ? { hi, lo, w: hi - lo + 1 } : null; } m = s.match(/^(\d+)$/); return m ? { hi: +m[1], lo: +m[1], w: 1 } : null; };
  const evOf = (o, scope) => ({ page: o.page == null ? null : o.page, pages: AM.pages(o.page), level: AM.evLevel(o.ev), raw: o.ev == null ? '' : String(o.ev), sec: o.sec != null ? String(o.sec) : '', cond: o.cond != null ? String(o.cond) : '', scope });
  const base = (id, groupIds) => { const s = String(id); if (groupIds.has(s)) return { id: s }; const i = s.lastIndexOf('.'); return i > 0 && groupIds.has(s.slice(0, i)) ? { id: s.slice(0, i), port: s.slice(i + 1) } : { id: s }; };

  /* ================================================================ build */
  AM.build = text => {
    text = String(text || ''); const fm = X.frontMatter(text), P = fm.props || {};
    const M = { schema: AM.SCHEMA, meta: { ip: P.ip || '', chip: P.chip || '', family: P.family || '', source: P.source || '', docrev: P.docrev != null ? String(P.docrev) : '', chapter: P.chapter || '', status: P.status || '待核对', facts: P.facts && typeof P.facts === 'object' ? P.facts : {} },
      diagrams: [], blocks: new Map(), groups: new Map(), links: [], registers: new Map(), scenes: [], timings: [], code: [], errors: [] };
    let b; fence.lastIndex = 0; const raw = []; while ((b = fence.exec(text))) raw.push({ lang: b[1].toLowerCase(), src: b[2] });
    const yaml = (src, what) => { try { return X.yaml(src) || {}; } catch (e) { M.errors.push(what + ' 的 YAML 解析失败：' + (e.message || e)); return null; } };
    raw.filter(r => r.lang === 'ipblock').forEach((r, di) => {
      const y = yaml(r.src, '结构图 ' + (di + 1)); if (!y) return; const d = { index: di, title: String(y.title || '结构图 ' + (di + 1)), blocks: [], groups: [], links: [] }; M.diagrams.push(d);
      arr(y.groups).filter(g => g && g.id != null).forEach(g => { const o = { id: String(g.id), label: g.label || String(g.id), parent: g.parent != null ? String(g.parent) : null, diagram: d.title }; d.groups.push(o); M.groups.set(d.title + '::' + o.id, o); });
      arr(y.blocks || y.nodes).filter(x => x && x.id != null).forEach(x => { const o = { id: String(x.id), label: x.label || String(x.id), kind: String(x.kind || 'logic').toLowerCase(), group: x.group != null ? String(x.group) : null, regs: arr(x.regs).map(String), ports: arr(x.ports).filter(p => p && p.id != null).map(p => ({ id: String(p.id), dir: String(p.dir || 'inout'), label: p.label || String(p.id) })), status: x.status || '', diagram: d.title, ev: evOf(x, 'block') }; d.blocks.push(o); M.blocks.set(d.title + '::' + o.id, o); });
      const ids = new Set(d.blocks.map(x => x.id).concat(d.groups.map(g => g.id)));
      arr(y.links || y.edges).forEach((l, i) => { if (!l) return; const f = base(l.from, ids), t = base(l.to, ids); const o = { index: i, from: f.id, to: t.id, fromPort: f.port || null, toPort: t.port || null, kind: String(l.kind || 'data').toLowerCase(), label: l.label || '', both: !!l.both, diagram: d.title, raw: [String(l.from), String(l.to)] }; d.links.push(o); M.links.push(o); });
      d.links.forEach(l => { [[l.from, l.fromPort, 'out'], [l.to, l.toPort, 'in']].forEach(([id, port, dir]) => { const bl = d.blocks.find(x => x.id === id); if (bl && port && !bl.ports.some(p => p.id === port)) bl.ports.push({ id: port, dir, label: port, derived: true }); }); });
    });
    raw.filter(r => r.lang === 'register').forEach((r, ri) => {
      const y = yaml(r.src, '寄存器块 ' + (ri + 1)); if (!y || !y.name) return; const name = String(y.name).toUpperCase();
      const reg = { name, address: y.address != null ? num(y.address) : NaN, width: y.width != null ? +y.width : 32, reset: y.reset != null ? num(y.reset) : NaN, desc: y.desc || '', fields: [], ev: evOf(y, 'register') };
      arr(y.fields).filter(f => f && f.name != null).forEach(f => reg.fields.push({ name: String(f.name), bits: AM.bits(f.bits), bitsRaw: String(f.bits), desc: f.desc || '', ev: evOf(f, 'field'), reg: name }));
      if (!M.registers.has(name)) M.registers.set(name, reg); else M.errors.push('寄存器 ' + name + ' 定义了两次');
    });
    raw.filter(r => r.lang === 'c' || r.lang === 'cpp' || r.lang === 'asm').forEach((r, ci) => M.code.push({ index: ci, lang: r.lang, lines: r.src.split('\n') }));
    raw.filter(r => r.lang === 'wavedrom').forEach((r, ti) => { let y = null; try { y = JSON.parse(r.src); } catch (e) { y = yaml(r.src, '时序图 ' + (ti + 1)); } M.timings.push({ index: ti, signals: arr(y && y.signal).filter(s => s && s.name != null).map(s => String(s.name)), data: y }); });
    raw.filter(r => r.lang === 'scene').forEach((r, si) => {
      const y = yaml(r.src, '场景 ' + (si + 1)); if (!y) return; const sc = { index: si, title: String(y.title || '场景 ' + (si + 1)), diagram: y.diagram != null ? String(y.diagram) : '', code: y.code != null ? +y.code : 0, steps: [], stepsOk: y.steps == null || Array.isArray(y.steps) };
      (Array.isArray(y.steps) ? y.steps : []).forEach((s, i) => sc.steps.push(s && typeof s === 'object' ? { n: i + 1, t: s.t || '', hl: arr(s.hl).map(String), links: arr(s.links).map(String), regs: arr(s.regs).filter(Boolean).map(r => ({ r: String(r.r), v: r.v != null ? num(r.v) : NaN, vRaw: r.v, n: r.n || '' })), line: s.line != null ? +s.line : null, x: s.x || '', ev: evOf(s, 'step') } : { n: i + 1, bad: true }));
      M.scenes.push(sc);
    });
    return M;
  };
  const findReg = (M, name) => { const n = String(name || '').toUpperCase(); if (M.registers.has(n)) return M.registers.get(n); for (const [k, v] of M.registers) if (k.endsWith(n) || n.endsWith(k)) return v; return null; };
  AM.findReg = findReg;
  const diagramOf = (M, sc) => M.diagrams.find(d => !sc.diagram || d.title === sc.diagram) || null;

  /* ================================================================ evidence coverage */
  AM.evidence = M => {
    const items = [];
    M.blocks.forEach(x => items.push({ kind: 'block', id: x.id, label: x.label, scope: x.diagram, ev: x.ev }));
    M.registers.forEach(r => { items.push({ kind: 'register', id: r.name, label: r.name, ev: r.ev }); r.fields.forEach(f => items.push({ kind: 'field', id: r.name + '.' + f.name, label: f.name, ev: f.ev })); });
    M.scenes.forEach(sc => sc.steps.forEach(s => { if (!s.bad) items.push({ kind: 'step', id: sc.title + '#' + s.n, label: s.t, scope: sc.title, ev: s.ev }); }));
    const kinds = {}; ['block', 'register', 'field', 'step'].forEach(k => kinds[k] = { total: 0, withPage: 0, badPage: 0, byLevel: Object.fromEntries(AM.EV_LEVELS.map(l => [l, 0])) });
    items.forEach(it => { const K = kinds[it.kind]; K.total++; if (it.ev.pages && it.ev.pages.length) K.withPage++; else if (it.ev.pages === null) K.badPage++; const l = it.ev.level || '待核对'; K.byLevel[l] = (K.byLevel[l] || 0) + 1; });
    const total = items.length, withPage = items.filter(i => i.ev.pages && i.ev.pages.length).length, confirmed = items.filter(i => i.ev.level === '手册确认').length;
    return { items, kinds, total, withPage, confirmed, pageCoverage: total ? withPage / total : 1, confirmedCoverage: total ? confirmed / total : 1, docrev: M.meta.docrev, source: M.meta.source };
  };

  /* ================================================================ consistency */
  /* [level, message, ref] — level: err | warn | info | ok.  Superset of the 1.4–1.6 rules. */
  AM.validate = M => {
    const out = [], push = (l, m, ref) => out.push([l, m, ref || null]);
    M.errors.forEach(e => push('err', e));
    if (!M.meta.ip) push('err', 'front matter 缺少 ip'); if (!M.meta.chip) push('err', 'front matter 缺少 chip');
    if (!M.meta.source) push('warn', '没有 source（手册文件名），页码链接无法跳转'); else if (!M.meta.docrev) push('info', 'front matter 没有 docrev（手册版本）：事实无法对应到具体版本');
    if (!M.diagrams.length) push('warn', '没有 ```ipblock 结构图');
    M.diagrams.forEach(d => {
      const ids = new Set(d.blocks.map(x => x.id).concat(d.groups.map(g => g.id)));
      d.blocks.forEach(x => { if (x.group && !d.groups.some(g => g.id === x.group)) push('err', '模块 ' + x.id + ' 的 group “' + x.group + '” 不存在', { kind: 'block', id: x.id }); });
      d.links.forEach(l => {
        if (!ids.has(l.from) || !ids.has(l.to)) return push('err', '结构图 “' + d.title + '” 连线 ' + l.raw[0] + ' → ' + l.raw[1] + ' 引用了不存在的模块', { kind: 'link', id: l.raw.join('>') });
        [[l.from, l.fromPort], [l.to, l.toPort]].forEach(([id, port]) => { const bl = d.blocks.find(x => x.id === id); if (bl && port && bl.ports.some(p => !p.derived) && !bl.ports.some(p => p.id === port && !p.derived)) push('err', '连线端口 ' + id + '.' + port + ' 没有在模块的 ports 中声明', { kind: 'block', id }); });
      });
      const used = new Set(); d.links.forEach(l => { used.add(l.from); used.add(l.to); });
      const orphan = d.blocks.filter(x => !used.has(x.id) && !x.group); if (orphan.length && d.links.length) push('info', '结构图 “' + d.title + '” 中 ' + orphan.length + ' 个模块没有任何连线：' + orphan.map(x => x.id).slice(0, 6).join(', '));
      d.blocks.forEach(x => x.regs.forEach(r => { if (M.registers.size && !findReg(M, r)) push('warn', '模块 ' + x.id + ' 的寄存器 ' + r + ' 在“寄存器”中没有定义', { kind: 'block', id: x.id }); }));
    });
    const addr = new Map();
    M.registers.forEach(r => {
      if (![8, 16, 32, 64].includes(r.width)) push('warn', '寄存器 ' + r.name + ' 的位宽 ' + r.width + ' 不是 8/16/32/64', { kind: 'register', id: r.name });
      if (!Number.isNaN(r.address)) { const k = r.address; if (addr.has(k)) push('warn', '寄存器 ' + r.name + ' 与 ' + addr.get(k) + ' 地址相同（0x' + k.toString(16).toUpperCase() + '）', { kind: 'register', id: r.name }); else addr.set(k, r.name); }
      if (!Number.isNaN(r.reset) && r.width < 53 && r.reset >= Math.pow(2, r.width)) push('err', '寄存器 ' + r.name + ' 的复位值超出 ' + r.width + ' 位', { kind: 'register', id: r.name });
      const taken = [];
      r.fields.forEach(f => {
        if (!f.bits) return push('err', '寄存器 ' + r.name + ' 字段 ' + f.name + ' 的 bits “' + f.bitsRaw + '” 格式不对（应为 7 或 15:8）', { kind: 'field', id: r.name + '.' + f.name });
        if (f.bits.hi >= r.width) push('err', '寄存器 ' + r.name + ' 字段 ' + f.name + ' 的 bit ' + f.bits.hi + ' 超出位宽 ' + r.width, { kind: 'field', id: r.name + '.' + f.name });
        const hit = taken.find(t => !(f.bits.hi < t.bits.lo || f.bits.lo > t.bits.hi)); if (hit) push('warn', '寄存器 ' + r.name + ' 字段 ' + f.name + ' 与 ' + hit.name + ' 的位范围重叠', { kind: 'field', id: r.name + '.' + f.name }); taken.push(f);
      });
    });
    M.scenes.forEach(sc => {
      const tag = '场景 “' + sc.title + '”', dg = diagramOf(M, sc);
      if (!sc.stepsOk) return push('err', tag + ' 的 steps 必须是列表（- {t: …}）');
      if (!dg) return push('err', tag + ' 的 diagram “' + sc.diagram + '” 找不到对应的结构图');
      if (!sc.steps.length) push('warn', tag + ' 没有步骤');
      const ids = new Set(dg.blocks.map(x => x.id).concat(dg.groups.map(g => g.id))), lk = new Set(dg.links.map(l => l.from + '>' + l.to));
      const codes = M.code.filter(c => c.lang !== 'asm'), cb = codes[sc.code || 0];
      sc.steps.forEach(s => {
        const t = tag + ' 第 ' + s.n + ' 步', ref = { kind: 'step', id: sc.title + '#' + s.n };
        if (s.bad) return push('err', t + '不是 {…} 格式', ref);
        s.hl.forEach(id => { if (!ids.has(id)) push('err', t + '：高亮的模块 ' + id + ' 不存在', ref); });
        s.links.forEach(l => { const [a, c] = l.split('>'); if (!lk.has(a + '>' + c) && !lk.has(c + '>' + a)) push('warn', t + '：连线 ' + l + ' 在结构图中不存在', ref); });
        s.regs.forEach(r => {
          const R = findReg(M, r.r);
          if (!R) return push('warn', t + '：寄存器 ' + r.r + ' 在“寄存器”中没有定义（无法按位域解码）', ref);
          if (Number.isNaN(r.v)) { if (r.vRaw != null) push('err', t + '：寄存器 ' + r.r + ' 的值 “' + r.vRaw + '” 不是数字', ref); return; }
          if (R.width < 53 && (r.v < 0 || r.v >= Math.pow(2, R.width))) push('err', t + '：寄存器 ' + r.r + ' 的值 0x' + r.v.toString(16).toUpperCase() + ' 超出 ' + R.width + ' 位', ref);
        });
        if (s.line != null) { if (!cb) push('warn', t + '：引用了代码行，但没有对应的 ```c 代码块', ref); else if (s.line < 1 || s.line > cb.lines.length) push('warn', t + '：代码行 ' + s.line + ' 超出范围', ref); }
        if (!s.x) push('warn', t + '：缺少讲解文字 x', ref);
      });
    });
    const E = AM.evidence(M);
    ['block', 'register', 'step'].forEach(k => { const K = E.kinds[k]; if (K.badPage) push('warn', K.badPage + ' 个' + ({ block: '模块', register: '寄存器', step: '场景步骤' })[k] + '的 page 格式不对（应为 123 或 12-14）'); });
    if (M.meta.source) { const nb = E.kinds.block.total - E.kinds.block.withPage, nr = E.kinds.register.total - E.kinds.register.withPage; if (nb) push('warn', nb + ' 个模块没有手册页码'); if (nr) push('info', nr + ' 个寄存器没有手册页码'); }
    M.blocks.forEach(x => { if (x.ev.level === null) push('warn', '模块 ' + x.id + ' 的 ev “' + x.ev.raw + '” 不是有效的依据等级（' + AM.EV_LEVELS.join(' / ') + '）', { kind: 'block', id: x.id }); });
    if (!out.some(x => x[0] === 'err' || x[0] === 'warn')) out.unshift(['ok', '结构、场景、寄存器、代码引用一致', null]);
    return out;
  };

  /* ================================================================ impact: "what does this register touch?" */
  const decode = (R, v) => R.fields.filter(f => f.bits).map(f => { const val = Math.floor(v / Math.pow(2, f.bits.lo)) % Math.pow(2, f.bits.w); return { name: f.name, bits: f.bitsRaw, value: val, desc: f.desc }; });
  AM.decode = decode;
  AM.impact = (M, name) => {
    const R = findReg(M, name); if (!R) return null;
    const blocks = []; M.blocks.forEach(b => { if (b.regs.some(r => r.toUpperCase() === R.name || R.name.endsWith(r.toUpperCase()) || r.toUpperCase().endsWith(R.name))) blocks.push({ id: b.id, label: b.label, diagram: b.diagram, ev: b.ev }); });
    const steps = [];
    M.scenes.forEach(sc => { let prev = null; sc.steps.forEach(s => { if (s.bad) return; s.regs.forEach(r => { const RR = findReg(M, r.r); if (RR && RR.name === R.name) { const now = Number.isNaN(r.v) ? null : decode(R, r.v), changed = now && prev ? now.filter((f, i) => f.value !== prev[i].value).map(f => f.name) : (now ? now.filter(f => f.value).map(f => f.name) : []); steps.push({ scene: sc.title, n: s.n, title: s.t, value: r.v, note: r.n, fields: now, changed, hl: s.hl, line: s.line, ev: s.ev }); if (now) prev = now; } }); }); });
    const re = new RegExp('\\b' + R.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\w*', 'i'), code = [];
    M.code.forEach(c => c.lines.forEach((ln, i) => { if (re.test(ln)) code.push({ block: c.index, line: i + 1, text: ln.trim().slice(0, 160) }); }));
    return { register: R.name, address: R.address, width: R.width, reset: R.reset, desc: R.desc, ev: R.ev, fields: R.fields.map(f => ({ name: f.name, bits: f.bitsRaw, desc: f.desc, ev: f.ev })), blocks, steps, code };
  };
  AM.validateTuples = M => AM.validate(M).filter(x => x[0] !== 'info').map(x => [x[0], x[1]]);
  AM.summary = M => { const E = AM.evidence(M), V = AM.validate(M); return { ip: M.meta.ip, chip: M.meta.chip, status: M.meta.status, blocks: M.blocks.size, links: M.links.length, registers: M.registers.size, fields: E.kinds.field.total, scenes: M.scenes.length, steps: E.kinds.step.total, timings: M.timings.length, code: M.code.length, pageCoverage: +E.pageCoverage.toFixed(3), confirmedCoverage: +E.confirmedCoverage.toFixed(3), errors: V.filter(x => x[0] === 'err').length, warnings: V.filter(x => x[0] === 'warn').length }; };

  G.ChipBenchAM = AM; if (G.ChipBench) G.ChipBench.AM = AM;
  if (typeof module !== 'undefined' && module.exports) module.exports = AM;
})(typeof window !== 'undefined' ? window : globalThis);
