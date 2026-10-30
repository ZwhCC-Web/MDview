/* ChipBench 2.3 · ip-sim.js — behaviour engine: replays a scene against the model's rules.  PURE (no DOM), Node-testable; mcp/ip_sim.py is its mirror.
   What it is NOT: it knows nothing about any chip.  It executes only the rules written into the model (from a manual, with a page), over the register values a scene writes.
   Every result is "推导" (derived) and names the rules that produced it with their own evidence level — it is exactly as true as the rules.
   Semantics (also in docs/IP-STUDIO.md):
     · state = register values (start at `reset`, or 0) + variables (start at 0).  A scene step first applies its writes, then the rules settle.
     · settle = repeat passes over the rules in model order until a pass changes nothing (at most 32 passes → otherwise "did not settle", reported, not hidden)
     · level rule: while `when` is true run `then`, while false run `else` (idempotent: an action may not read its own target — enforced when the rule is added)
     · edge rule : when `when` turns false → true run `then` once (counters, events).  Power-on: a condition already true at the start counts as "already active", it does not fire.
     · limits: values <= 1024 bits, registers 1..1024 bits wide, rules <= 200 — beyond that the step reports an error instead of running away */
(function (G) {
  'use strict';
  const IPE = G.ChipBenchIPE || (typeof require !== 'undefined' ? require('./ip-expr.js') : null), IPM = G.ChipBenchIPM || (typeof require !== 'undefined' ? require('./ip-model.js') : null);
  const MAX_PASSES = 32, MAX_BITS = 1024, LIMIT = 1n << BigInt(MAX_BITS), STRONG = ['手册确认', '实测'];
  const N0 = () => Object.create(null);   /* maps without a prototype: a rule variable called "toString" is just a variable */
  const parseBits = b => { const s = String(b == null ? '' : b).trim(); let m = /^(\d+)\s*:\s*(\d+)$/.exec(s); if (m) { const hi = +m[1], lo = +m[2]; return hi >= lo ? [hi, lo] : null; } m = /^(\d+)$/.exec(s); return m ? [+m[1], +m[1]] : null; };
  const toNum = v => (v <= 9007199254740991n && v >= -9007199254740991n ? Number(v) : v.toString());
  function simulate(model, sceneId, opts) {
    opts = opts || {}; const m = IPM.normalize(model), sc = m.scenes.find(x => x.id === sceneId);
    if (!sc) return { ok: false, error: '场景不存在：' + sceneId };
    const regs = N0(), vars = N0(), active = N0(), widths = N0(), fields = N0(), errs = [];   /* maps without a prototype: a rule variable called "toString" is just a variable */
    for (const [id, R] of Object.entries(m.registers)) { if (!Number.isInteger(R.width) || R.width < 1 || R.width > MAX_BITS) { errs.push('寄存器 ' + id + ' 的位宽 ' + R.width + ' 不在 1–' + MAX_BITS + ' 之间，不做推演'); continue; } widths[id] = R.width; regs[id] = (R.reset != null ? BigInt(R.reset) : 0n) & ((1n << BigInt(R.width)) - 1n);
      fields[id] = N0(); (R.fields || []).forEach(f => { const b = parseBits(f.bits); if (b && b[0] < R.width) fields[id][f.name] = { lo: BigInt(b[1]), mask: (1n << BigInt(b[0] - b[1] + 1)) - 1n }; }); }
    const rules = m.rules.slice(0, 200), compiled = rules.map(r => { const w = IPE.parse(r.when), th = r.then.map(IPE.parseAction), el = r.else.map(IPE.parseAction); return { r, w, th, el, ok: w.ok && th.every(a => a.ok) && el.every(a => a.ok) }; });
    compiled.forEach(c => { if (!c.ok) errs.push('规则 ' + c.r.id + ' 无法解析，已跳过（先运行校验）'); });
    const getv = (name, field) => { if (field != null) { const f = fields[name] && fields[name][field]; if (!f) throw new IPE.ExprError('没有位域 ' + name + '.' + field); return (regs[name] >> f.lo) & f.mask; } if (name in widths) return regs[name]; return vars[name] || 0n; };
    let cause = [], log = [];   /* log: { target, kind:'reg'|'field'|'var', reg, before, after, by } for the CURRENT step, in order */
    const setTarget = (t, val, by) => {
      if (val >= LIMIT || val <= -LIMIT) throw new IPE.ExprError('数值超过 ' + MAX_BITS + ' 位，已停止（规则里有失控的增长？）');
      if (t.field != null) { const f = fields[t.name] && fields[t.name][t.field]; if (!f) throw new IPE.ExprError('没有位域 ' + t.name + '.' + t.field); const old = regs[t.name], nv = (old & ~(f.mask << f.lo)) | ((val & f.mask) << f.lo); if (nv !== old) { regs[t.name] = nv; log.push({ reg: t.name, bits: old ^ nv, by }); } return nv !== old; }
      if (t.name in widths) { const nv = val & ((1n << BigInt(widths[t.name])) - 1n); if (nv !== regs[t.name]) { log.push({ reg: t.name, bits: regs[t.name] ^ nv, by }); regs[t.name] = nv; return true; } return false; }
      const old = vars[t.name] || 0n; if (old !== val) { vars[t.name] = val; log.push({ v: t.name, by }); return true; } return false;
    };
    const runActions = (acts, by, events, rule) => { let changed = false; for (const a of acts) { if (a.kind === 'emit') { events.push({ text: a.text, node: a.node, rule: by }); continue; } if (setTarget(a.target, IPE.evaluate(a.expr, getv), by)) changed = true; } return changed; };
    const settle = (events, firedSet, stepErrs, initial) => {
      let passes = 0, changed = true; const errSeen = new Set();
      while (changed && passes < MAX_PASSES) {
        changed = false; passes++;
        for (const c of compiled) { if (!c.ok) continue; const r = c.r; let cond; try { cond = IPE.evaluate(c.w.ast, getv) !== 0n; } catch (e) { if (!errSeen.has(r.id)) { errSeen.add(r.id); stepErrs.push('规则 ' + r.id + ' 的条件：' + e.message); } cond = false; }
          try {
            if (r.trigger === 'level') { if (runActions(cond ? c.th : c.el, r.id, events)) { changed = true; firedSet.add(r.id); } }
            else { const was = !!active[r.id]; active[r.id] = cond; if (cond && !was) { firedSet.add(r.id); if (runActions(c.th, r.id, events)) changed = true; } }
          } catch (e) { if (!errSeen.has(r.id + '#a')) { errSeen.add(r.id + '#a'); stepErrs.push('规则 ' + r.id + ' 的动作：' + e.message); } return { passes, settled: false, aborted: true }; }
        }
      }
      return { passes, settled: !changed, aborted: false };
    };
    const snap = () => { const o = { regs: N0(), vars: N0() };   /* snapshots too: reading a variable that did not exist yet must give undefined, not an inherited function */ Object.keys(regs).forEach(k => { o.regs[k] = regs[k]; }); Object.keys(vars).forEach(k => { o.vars[k] = vars[k]; }); return o; };
    const diff = (a, b, by) => {   /* net changes between two snapshots, per field where the register has fields */
      const out = []; const causeOf = (reg, mask, v) => { const c = []; by.forEach(x => { const hit = v != null ? x.v === v : (x.reg === reg && (x.bits & mask) !== 0n); if (hit && !c.includes(x.by)) c.push(x.by); }); return c; };   /* a cause is credited with a field only if ITS change flipped bits of that field */
      for (const id of Object.keys(b.regs)) { if (a.regs[id] === b.regs[id]) continue; const fl = Object.entries(fields[id] || {}); let covered = 0n;
        fl.forEach(([name, f]) => { covered |= f.mask << f.lo; const x = (a.regs[id] >> f.lo) & f.mask, y = (b.regs[id] >> f.lo) & f.mask; if (x !== y) out.push({ target: id + '.' + name, from: x, to: y, by: causeOf(id, f.mask << f.lo) }); });
        if (!fl.length || ((a.regs[id] ^ b.regs[id]) & ~covered) !== 0n) out.push({ target: id + (fl.length ? '（其它位）' : ''), from: a.regs[id] & ~(fl.length ? covered : 0n), to: b.regs[id] & ~(fl.length ? covered : 0n), by: causeOf(id, ~covered), whole: true }); }
      for (const k of Object.keys(b.vars)) { const x = a.vars[k] || 0n; if (x !== b.vars[k]) out.push({ target: k, from: x, to: b.vars[k], by: causeOf(null, 0n, k), isVar: true }); }
      return out;
    };
    /* power-on */
    compiled.forEach(c => { if (c.ok && c.r.trigger === 'edge') { try { active[c.r.id] = IPE.evaluate(c.w.ast, getv) !== 0n; } catch (e) { active[c.r.id] = false; } } });
    log = []; const e0 = [], f0 = new Set(), s0 = [], before0 = snap(); const st0 = settle(e0, f0, s0, true); const init = { state: snap(), changes: diff(before0, snap(), log), settled: st0.settled, errors: s0 };
    const steps = []; let fatal = false;
    sc.steps.forEach((st, i) => {
      if (fatal) return; log = []; const events = [], fired = new Set(), stepErrs = [], before = snap(), writes = [];
      (st.writes || []).forEach(w => { if (!(w.reg in widths)) { stepErrs.push('写入的寄存器 ' + w.reg + ' 不存在或位宽不支持'); return; } const raw = BigInt(w.value), nv = raw & ((1n << BigInt(widths[w.reg])) - 1n); if (nv !== raw) stepErrs.push('写入 ' + w.reg + ' 的值 0x' + raw.toString(16).toUpperCase() + ' 超出 ' + widths[w.reg] + ' 位，已截断'); if (regs[w.reg] !== nv) { log.push({ reg: w.reg, bits: regs[w.reg] ^ nv, by: '写入' }); regs[w.reg] = nv; } writes.push({ reg: w.reg, value: nv }); });
      const afterWrites = snap(), r = settle(events, fired, stepErrs, false); if (r.aborted) fatal = true;
      if (!r.settled && !r.aborted) stepErrs.push('规则在 ' + MAX_PASSES + ' 轮内没有稳定下来（可能互相推翻）；以下是第 ' + MAX_PASSES + ' 轮的状态');
      const after = snap(); steps.push({ index: i, title: st.title, writes, changes: diff(before, after, log), fired: Array.from(fired), events, passes: r.passes, settled: r.settled, errors: stepErrs, state: after, viaRules: diff(afterWrites, after, log).length });
    });
    const used = new Set(); steps.forEach(s => s.fired.forEach(x => used.add(x)));
    return { ok: true, scene: sc.id, name: sc.name, confidence: '推导', init, steps, rules: rules.map(r => ({ id: r.id, name: r.name, trigger: r.trigger, ev: r.ev })), firedRules: Array.from(used), unverified: Array.from(used).filter(id => { const r = rules.find(x => x.id === id); return !(r.ev && STRONG.includes(r.ev.level)); }), errors: errs, limits: { passes: MAX_PASSES, bits: MAX_BITS } };
  }
  /* BigInt → Number (or decimal string when it would not be exact): the shape the UI and the MCP server print */
  const plain = r => { const c = v => (typeof v === 'bigint' ? toNum(v) : v); const st = s => { const o = { regs: N0(), vars: N0() }; Object.keys(s.regs).forEach(k => { o.regs[k] = c(s.regs[k]); }); Object.keys(s.vars).forEach(k => { o.vars[k] = c(s.vars[k]); }); return o; }; const ch = L => L.map(x => Object.assign({}, x, { from: c(x.from), to: c(x.to) }));
    if (!r.ok) return r; return Object.assign({}, r, { init: Object.assign({}, r.init, { state: st(r.init.state), changes: ch(r.init.changes) }), steps: r.steps.map(s => Object.assign({}, s, { writes: s.writes.map(w => ({ reg: w.reg, value: c(w.value) })), changes: ch(s.changes), state: st(s.state) })) }); };
  const API = { simulate, plain, MAX_PASSES, MAX_BITS };
  G.ChipBenchIPS = API; if (G.ChipBench) G.ChipBench.IPS = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
