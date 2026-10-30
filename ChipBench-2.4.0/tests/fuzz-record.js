/* Run the adaptive fuzz on the JS model and print everything the Python mirror has to reproduce:  node tests/fuzz-record.js <seeds> <batches> [firstSeed]
   per seed: the batches (as JSON), for each batch ok + error codes / messages, and at the end the model, validation findings, summary and the simulation of every scene. */
const I = require('../app/js/ip-model.js'), S = require('../app/js/ip-sim.js'), G = require('./fuzz-gen.js');
const N = +process.argv[2] || 100, LEN = +process.argv[3] || 40, FIRST = +process.argv[4] || 1, out = [];
for (let seed = FIRST; seed < FIRST + N; seed++) {
  const gen = G.Gen(seed); let m = I.create({ id: 'f' + seed, name: 'F' }); const batches = [], res = [];
  for (let i = 0; i < LEN; i++) { const b = JSON.parse(JSON.stringify(gen.next(m))); batches.push(b); const r = I.apply(m, b); res.push({ desc: b.map(I.describeOp), ok: r.ok, errors: r.errors.map(e => [e.index, e.op === undefined ? null : e.op, e.code, e.msg]) }); if (r.ok) m = r.model; }
  out.push({ seed, batches, res, model: m, validate: I.validate(m).map(v => v.level + ':' + v.code + ':' + v.msg), summary: I.summary(m), sims: m.scenes.map(sc => S.plain(S.simulate(m, sc.id))), ipblock: I.toIpblock(m), diffEmpty: I.diff(m, m).empty });
}
process.stdout.write(JSON.stringify(out));
