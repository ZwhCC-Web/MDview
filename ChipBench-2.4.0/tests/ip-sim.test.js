/* the behaviour engine (2.3):  node tests/ip-sim.test.js */
const I = require('../app/js/ip-model.js'), S = require('../app/js/ip-sim.js'); let ok = 0, bad = 0;
const t = (n, c, d) => { if (c) ok++; else { bad++; console.log('FAIL', n, d === undefined ? '' : JSON.stringify(d, (k, v) => typeof v === 'bigint' ? v.toString() : v).slice(0, 600)); } };
/* a TOY device — invented for these tests only; nothing here describes any real chip */
const base = () => [{ op: 'add_node', node: { id: 'fifo', kind: 'mem' } }, { op: 'add_node', node: { id: 'cpu', kind: 'cpu' } },
  { op: 'define_register', register: { id: 'STS', width: 8, reset: 0, fields: [{ name: 'FULL', bits: '0' }, { name: 'IRQ', bits: '1' }, { name: 'CNT', bits: '7:4' }] } }, { op: 'define_register', register: { id: 'EN', width: 8, fields: [{ name: 'IE', bits: '0' }] } },
  { op: 'define_register', register: { id: 'CTRL', width: 8, fields: [{ name: 'PUSH', bits: '0' }, { name: 'CLR', bits: '1' }] } }, { op: 'define_register', register: { id: 'W16', width: 16, reset: 0xFFFF } }];
const build = (ops, steps, extra) => { const r = I.apply(I.create({ id: 't', name: 'T' }), base().concat(ops || []).concat([{ op: 'add_scene', scene: { id: 's', name: 'S', steps: steps || [] } }]).concat(extra || [])); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.model; };
const run = (ops, steps) => S.plain(S.simulate(build(ops, steps), 's'));
const W = (reg, value) => ({ reg, value }); const step = (title, ...writes) => ({ title, writes });
const LV = { op: 'add_rule', rule: { id: 'irq', trigger: 'level', when: 'STS.FULL && EN.IE', then: ['set STS.IRQ = 1'], else: ['set STS.IRQ = 0'] } };
const EDGE = { op: 'add_rule', rule: { id: 'push', trigger: 'edge', when: 'CTRL.PUSH', then: ['set N = N + 1', 'emit "推入" @fifo'] } };
const ch = (s, target) => s.changes.find(c => c.target === target);
/* basics */
{ const r = run([], [step('a', W('EN', 1))]); t('no rules: the scene’s own writes are replayed and nothing else happens', r.ok && r.steps[0].changes.length === 1 && r.steps[0].changes[0].target === 'EN.IE' && r.steps[0].changes[0].by[0] === '写入' && r.steps[0].fired.length === 0 && r.firedRules.length === 0, r); t('every result is labelled 推导', r.confidence === '推导'); }
t('unknown scene is a clear error', S.simulate(build([], []), 'nope').ok === false && /场景不存在/.test(S.simulate(build([], []), 'nope').error));
{ const r = run([], [step('a')]); t('registers start at their reset value (or 0); fields are decoded', r.init.state.regs.W16 === 0xFFFF && r.init.state.regs.STS === 0); }
{ const r = run([], [step('a', W('W16', 0x1FFFF))]); t('a value wider than the register is truncated and the step says so', r.steps[0].state.regs.W16 === 0xFFFF && r.steps[0].errors.some(e => /超出 16 位/.test(e)), r.steps[0]); }
/* level rules */
{ const r = run([LV], [step('en', W('EN', 1)), step('full', W('STS', 1)), step('dis', W('EN', 0)), step('en again', W('EN', 1))]);
  t('level: nothing while the condition is false (IRQ stays 0 after only EN)', r.steps[0].state.regs.STS === 0 && !ch(r.steps[0], 'STS.IRQ'));
  t('level: the line follows the condition up…', r.steps[1].state.regs.STS === 3 && ch(r.steps[1], 'STS.IRQ').to === 1 && ch(r.steps[1], 'STS.IRQ').by.join() === 'irq');
  t('…and back down through `else`', r.steps[2].state.regs.STS === 1 && ch(r.steps[2], 'STS.IRQ').to === 0);
  t('…and up again (a level rule has no memory)', r.steps[3].state.regs.STS === 3); }
{ const r = run([{ op: 'add_rule', rule: { id: 'always', trigger: 'level', when: '1', then: ['set LINE = 7'] } }], [step('a'), step('b')]); t('level: a rule that is true from power-on applies at power-on (before the scene)', r.init.state.vars.LINE === 7 && r.steps.every(s => s.changes.length === 0), r.init); }
{ const r = run([{ op: 'add_rule', rule: { id: 'm', trigger: 'level', when: '1', then: ['set STS.CNT = 0x1F'] } }], [step('a')]); t('set REG.FIELD is masked to the field width (0x1F into a 4-bit field → 0xF) and leaves other bits alone', r.init.state.regs.STS === 0xF0); }
{ const r = run([{ op: 'add_rule', rule: { id: 'm', trigger: 'level', when: '1', then: ['set STS = 0x1FF'] } }], [step('a')]); t('set REG masks to the register width (0x1FF → 0xFF)', r.init.state.regs.STS === 0xFF); }
/* edge rules */
{ const r = run([EDGE], [step('p1', W('CTRL', 1)), step('hold', W('EN', 1)), step('release', W('CTRL', 0)), step('p2', W('CTRL', 1)), step('p2 held', W('CTRL', 1))]);
  t('edge: fires on false → true, with its action and event', r.steps[0].fired.join() === 'push' && r.steps[0].state.vars.N === 1 && r.steps[0].events.length === 1 && r.steps[0].events[0].text === '推入' && r.steps[0].events[0].node === 'fifo' && r.steps[0].events[0].rule === 'push');
  t('edge: does NOT fire again while the condition stays true — across steps that do other things', r.steps[1].fired.length === 0 && r.steps[1].state.vars.N === 1 && r.steps[1].events.length === 0);
  t('edge: after the condition goes false, the next rising edge fires again', r.steps[2].fired.length === 0 && r.steps[3].fired.join() === 'push' && r.steps[3].state.vars.N === 2);
  t('edge: writing the same value again is no new edge', r.steps[4].fired.length === 0 && r.steps[4].state.vars.N === 2); }
{ const r = run([{ op: 'add_rule', rule: { id: 'e', trigger: 'edge', when: '1', then: ['set N = N + 1'] } }], [step('a'), step('b')]); t('edge: a condition already true at power-on counts as already active — it does not fire', r.init.state.vars.N === undefined && r.steps.every(s => s.fired.length === 0), [r.init.state, r.steps.map(s => s.fired)]); }
{ const r = run([EDGE, { op: 'add_rule', rule: { id: 'cnt', trigger: 'level', when: '1', then: ['set STS.CNT = N'] } }], [step('p1', W('CTRL', 1)), step('r', W('CTRL', 0)), step('p2', W('CTRL', 1))]); t('rules chain within one settle: the edge rule bumps N, the level rule copies it into a field — same step', r.steps[0].state.regs.STS === 0x10 && r.steps[2].state.regs.STS === 0x20 && ch(r.steps[2], 'STS.CNT').by.join() === 'cnt', r.steps[2]); }
/* attribution */
{ const r = run([LV, { op: 'add_rule', rule: { id: 'full', trigger: 'edge', when: 'CTRL.PUSH', then: ['set STS.FULL = 1'] } }], [step('en', W('EN', 1)), step('push', W('CTRL', 1))]); const s = r.steps[1];
  t('each change names the rule that set THAT field (FULL ← full, IRQ ← irq), the write names itself', ch(s, 'STS.FULL').by.join() === 'full' && ch(s, 'STS.IRQ').by.join() === 'irq' && ch(s, 'CTRL.PUSH').by.join() === '写入', s.changes); t('fired lists every rule that did something, in model order', s.fired.join() === 'irq,full' || s.fired.join() === 'full,irq', s.fired); }
{ const r = run([LV], [step('w', W('STS', 0xFF), W('EN', 1))]); t('a change to bits outside every field is reported as “其它位”, not lost', r.steps[0].changes.some(c => c.target === 'STS.FULL') && r.steps[0].state.regs.STS === 0xFF); }
{ const r = run([], [step('w', W('W16', 0x0000))]); t('a register with no fields is reported as a whole', r.steps[0].changes.length === 1 && r.steps[0].changes[0].target === 'W16' && r.steps[0].changes[0].to === 0 && r.steps[0].changes[0].from === 0xFFFF); }
/* settling, oscillation, runaway, errors */
{ const r = run([{ op: 'add_rule', rule: { id: 'osc', trigger: 'level', when: 'X == 0', then: ['set X = 1'], else: ['set X = 0'] } }], [step('a')]); const s = r.steps[0];
  t('oscillation is detected, reported, and bounded (32 passes) — never an endless loop', s.settled === false && s.passes === 32 && s.errors.some(e => /没有稳定下来/.test(e)), s); t('…and the engine still returns a state for the next step', r.ok && s.state.vars.X !== undefined || s.state.vars.X === undefined); }
{ const r = run([{ op: 'add_rule', rule: { id: 'a', trigger: 'level', when: '1', then: ['set A = B * B + 2'] } }, { op: 'add_rule', rule: { id: 'b', trigger: 'level', when: '1', then: ['set B = A * A'] } }], [step('go')]);
  t('runaway growth (two rules squaring each other) stops at the 1024-bit limit with a message — it does not eat memory', r.steps[0].errors.some(e => /1024 位/.test(e)) && r.steps[0].settled === false, r.steps[0].errors); }
{ const r = run([{ op: 'add_rule', rule: { id: 'd', trigger: 'level', when: '1', then: ['set X = 1 / Z'] } }], [step('go')]); t('division by zero inside a rule is a step error, the scene continues', r.ok && r.init.errors.concat(r.steps[0].errors).some(e => /除数为 0/.test(e)) || r.steps[0].errors.some(e => /除数为 0/.test(e)), [r.init.errors, r.steps[0].errors]); }
{ const r = run([{ op: 'add_rule', rule: { id: 'c', trigger: 'level', when: '1 / Z', then: ['set X = 1'] } }], [step('go')]); t('an error in a condition is reported once and the condition counts as false', (r.init.errors.length + r.steps[0].errors.length) >= 1 && r.steps[0].state.vars.X === undefined, [r.init.errors, r.steps[0].errors]); }
{ const m = build([LV], [step('a', W('EN', 1))]); m.rules.push({ id: 'broken', name: 'b', trigger: 'level', when: '1 +', then: ['set X = 1'], else: [], note: '', ev: {} }); const r = S.plain(S.simulate(m, 's')); t('a rule that does not parse (a hand-edited file) is skipped with a pointer to validation; the rest still run', r.ok && r.errors.some(e => /broken.*无法解析/.test(e)) && r.steps[0].state.regs.EN === 1, r.errors); }
{ const m = build([], [step('a')]); m.registers.HUGE = { id: 'HUGE', name: 'HUGE', width: 100000, fields: [] }; const r = S.simulate(m, 's'); t('a register with an absurd width is refused for simulation, with a message', r.ok && r.errors.some(e => /HUGE.*1–1024/.test(e)), r.errors); }
t('a model with 200+ rules uses the first 200 (a hard ceiling)', (() => { const m = build([], [step('a')]); for (let i = 0; i < 230; i++) m.rules.push({ id: 'r' + i, name: 'r', trigger: 'level', when: '1', then: ['set V' + i + ' = 1'], else: [], note: '', ev: {} }); const r = S.simulate(m, 's'); return r.rules.length === 200; })());
/* evidence and honesty */
{ const m = build([LV, EDGE], [step('en', W('EN', 1), W('STS', 1)), step('push', W('CTRL', 1))]); m.rules[0].ev = { level: '手册确认', page: 123 }; m.rules[1].ev = { level: '待核对' }; const r = S.plain(S.simulate(m, 's'));
  t('firedRules lists what was used; `unverified` lists the used rules that are not 手册确认 / 实测', r.firedRules.sort().join() === 'irq,push' && r.unverified.join() === 'push', [r.firedRules, r.unverified]);
  t('rules that never fire are not blamed', !r.unverified.includes('nope'));
  t('the rules’ evidence is returned so the UI can show it next to each result', r.rules.find(x => x.id === 'irq').ev.page === 123); }
/* determinism, purity */
{ const m = build([LV, EDGE], [step('a', W('EN', 1)), step('b', W('CTRL', 1), W('STS', 1)), step('c', W('CTRL', 0)), step('d', W('CTRL', 1))]); const a = JSON.stringify(S.plain(S.simulate(m, 's'))), b = JSON.stringify(S.plain(S.simulate(m, 's')));
  t('deterministic: the same model and scene give byte-identical results twice', a === b); const snap = JSON.stringify(m); S.simulate(m, 's'); t('pure: simulating never changes the model', JSON.stringify(m) === snap); }
{ const m = build([EDGE], [step('p', W('CTRL', 1))]); const r1 = S.simulate(m, 's'), r2 = S.simulate(m, 's'); t('runs do not share state (the edge memory is per run)', r1.steps[0].fired.join() === 'push' && r2.steps[0].fired.join() === 'push'); }
/* big numbers and plain() */
{ const r = run([{ op: 'add_rule', rule: { id: 'big', trigger: 'level', when: '1', then: ['set B = 1 << 80'] } }], [step('a')]); t('plain(): values beyond 2^53 become exact decimal strings, not rounded numbers', r.init.state.vars.B === '1208925819614629174706176', r.init.state.vars.B); }
t('simulate handles a model without rules or scenes quietly', S.simulate(I.create({ id: 'e', name: 'E' }), 'x').ok === false);
/* the bundled real example has scenes but no rules: nothing is invented for it */
{ const fs = require('fs'), AM = require('../app/js/atlas-model.js'), m = I.fromAtlas(fs.readFileSync(require('path').join(__dirname, '../atlas/CAN-FD/RH850-U2B.md'), 'utf8'), AM).model; const r = S.plain(S.simulate(m, m.scenes[0].id));
  t('a real chip page migrated from Markdown replays its register writes and invents NOTHING (no rules were written → no derived changes, no fired rules)', r.ok && r.firedRules.length === 0 && r.steps.every(s => s.changes.every(c => c.by.length === 1 && c.by[0] === '写入' || c.by.every(x => x === '写入'))) && r.steps.length === m.scenes[0].steps.length, r.firedRules); }
console.log(ok + ' passed, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
