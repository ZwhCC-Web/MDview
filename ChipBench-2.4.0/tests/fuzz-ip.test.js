/* Randomised model tests (2.4):  node tests/fuzz-ip.test.js [seeds=400] [len=40]
   Thousands of random operation batches, many of them invalid or wrongly typed.  Invariants, for EVERY step:
     1 apply never throws                                   2 a refused batch leaves the model byte-identical (atomic)
     3 an accepted batch never leaves a STRUCTURAL error (dangling edge / port / node / scene / rule reference…) — only the documented semantic ones may remain
     4 normalize is idempotent and survives a JSON round trip   5 toIpblock only refers to things that exist   6 simulate() terminates, is deterministic, and never changes the model
   A violation prints the seed so it can be replayed:  node tests/fuzz-ip.test.js <seed> 1 */
const I = require('../app/js/ip-model.js'), S = require('../app/js/ip-sim.js'), G = require('./fuzz-gen.js');
const SEEDS = +process.argv[2] || 400, LEN = +process.argv[3] || 40, ONE = process.argv[3] === '1';
/* codes that MAY appear after an accepted batch: they describe the QUALITY of the content (wrong width, unfilled evidence …), not a broken reference */
const SEMANTIC = new Set(['reg-reset', 'reg-bits', 'scene-write']);
let ok = 0, bad = 0, ops = 0, accepted = 0, refused = 0, sims = 0, firstBad = {};
const fail = (name, seed, detail) => { bad++; if (!firstBad[name]) { firstBad[name] = { seed, detail }; console.log('FAIL', name, 'seed', seed, JSON.stringify(detail).slice(0, 700)); } };
const canon = m => I.canonical(m);
for (let seed = 1; seed <= SEEDS; seed++) {
  const gen = G.Gen(seed); let m = I.create({ id: 'f' + seed, name: 'F' }), prev;
  for (let bi = 0; bi < LEN; bi++) {
    const batch = JSON.parse(JSON.stringify(gen.next(m))); ops += batch.length; prev = canon(m); let r;
    try { r = I.apply(m, batch); } catch (e) { fail('apply threw', seed, { batch, err: String(e && e.stack || e).slice(0, 300) }); break; }
    if (typeof r.ok !== 'boolean' || !Array.isArray(r.errors)) { fail('apply result shape', seed, r); break; }
    if (!r.ok) { refused++; if (canon(r.model) !== prev) fail('refused batch changed the model', seed, { batch, errors: r.errors.slice(0, 2) }); if (!r.errors.length) fail('refused without a reason', seed, batch); if (r.errors.some(e => !e.code || !e.msg)) fail('error without code / message', seed, r.errors); continue; }
    accepted++; m = r.model;
    if (canon(I.normalize(JSON.parse(JSON.stringify(m)))) !== canon(m)) { fail('normalize / JSON round trip not stable', seed, { batch }); break; }
    const errs = I.validate(m).filter(v => v.level === 'err' && !SEMANTIC.has(v.code));
    if (errs.length) { fail('accepted batch left a structural error: ' + errs[0].code, seed, { batch, errs: errs.slice(0, 2).map(e => e.code + ': ' + e.msg), model: { nodes: m.nodes.map(n => n.id), regs: Object.keys(m.registers), rules: m.rules.map(x => x.id) } }); break; }
    /* rendering input must be self-consistent */
    try { const pb = I.toIpblock(m), ids = new Set(pb.blocks.map(b => b.id).concat(pb.groups.map(g => g.id)));
      if (ids.size !== pb.blocks.length + pb.groups.length) fail('toIpblock duplicate ids', seed, {});
      pb.links.forEach(l => { const a = String(l.from).split('.')[0], b = String(l.to).split('.')[0]; if (!ids.has(a) || !ids.has(b)) fail('toIpblock link to a missing block', seed, l); });
      pb.blocks.forEach(b => { if (b.group && !pb.groups.some(g => g.id === b.group)) fail('toIpblock block in a missing group', seed, b); });
      pb.groups.forEach(g => { if (g.parent && !pb.groups.some(x => x.id === g.parent)) fail('toIpblock group in a missing group', seed, g); });
      const coll = m.nodes.filter(n => m.nodes.some(k => k.parent === n.id)).map(n => n.id), pc = I.toIpblock(m, { collapsed: coll }); const cids = new Set(pc.blocks.map(b => b.id).concat(pc.groups.map(g => g.id))); pc.links.forEach(l => { if (!cids.has(String(l.from).split('.')[0]) || !cids.has(String(l.to).split('.')[0])) fail('collapsed toIpblock link to a missing block', seed, l); });
    } catch (e) { fail('toIpblock threw', seed, String(e).slice(0, 200)); break; }
    /* the simulation of every scene */
    for (const sc of m.scenes) { const snap = canon(m), t0 = Date.now(); let a, b; try { a = JSON.stringify(S.plain(S.simulate(m, sc.id))); b = JSON.stringify(S.plain(S.simulate(m, sc.id))); } catch (e) { fail('simulate threw', seed, { scene: sc.id, err: String(e && e.stack || e).slice(0, 300) }); break; } sims++;
      if (a !== b) fail('simulate not deterministic', seed, sc.id); if (canon(m) !== snap) fail('simulate changed the model', seed, sc.id); if (Date.now() - t0 > 3000) fail('simulate too slow', seed, { ms: Date.now() - t0 }); }
  }
  /* whole-model properties at the end */
  try {
    const d = I.diff(m, m); if (!d.empty) fail('diff(m, m) is not empty', seed, d);
    const s = I.summary(m); if (s.nodes !== m.nodes.length || s.rules !== m.rules.length || s.timings !== m.timings.length) fail('summary counts wrong', seed, s);
    const top = m.nodes[0]; if (top) { const sg = I.subgraph(m, { node: top.id, depth: 1 }); const ids = new Set(sg.nodes.map(n => n.id)); sg.edges.forEach(e => { if (!ids.has(I.endpoint(e.source).node) || !ids.has(I.endpoint(e.target).node)) fail('subgraph edge leaves the fragment', seed, e); }); sg.nodes.forEach(n => { if (n.parent && !ids.has(n.parent)) fail('subgraph node with a missing parent', seed, n); });
      const sv = I.validate(sg).filter(v => v.level === 'err' && !SEMANTIC.has(v.code)); if (sv.length) fail('subgraph has a structural error: ' + sv[0].code, seed, sv[0].msg); }
    I.OP_NAMES.length === 27 || fail('op count', seed, I.OP_NAMES.length);
  } catch (e) { fail('whole-model property threw', seed, String(e && e.stack || e).slice(0, 300)); }
}
ok = SEEDS * 1 - Object.keys(firstBad).length;
console.log('seeds', SEEDS, '| batches', accepted + refused, '(accepted ' + accepted + ', refused ' + refused + ') | ops', ops, '| simulations', sims, '| distinct failures', Object.keys(firstBad).length);
console.log((Object.keys(firstBad).length ? 0 : 1) + ' passed, ' + Object.keys(firstBad).length + ' failed'); process.exit(Object.keys(firstBad).length ? 1 : 0);
