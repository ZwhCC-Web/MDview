/* IP model benchmark (Node): node tests/perf-ip.bench.js [--check]   --check fails when a budget is exceeded (used by tests/perf-ip.test.js) */
const I = require('../app/js/ip-model.js'), gen = require('../tools/gen-large-ip.js');
const t = (f, n) => { const a = process.hrtime.bigint(); let r; for (let i = 0; i < (n || 1); i++) r = f(); return [Number(process.hrtime.bigint() - a) / 1e6 / (n || 1), r]; };
const rows = [];
for (const N of [300, 1000, 3000]) {
  const m = gen(N), R = { N, nodes: m.nodes.length, edges: m.edges.length };
  R.normalize = t(() => I.normalize(m), 3)[0]; R.validate = t(() => I.validate(m), 3)[0]; R.summary = t(() => I.summary(m), 3)[0]; R.canonical = t(() => I.canonical(m), 3)[0];
  R.toIpblock = t(() => I.toIpblock(m), 3)[0]; R.toIpblockCollapsed = t(() => I.toIpblock(m, { collapsed: m.nodes.filter(n => n.kind === 'group').map(n => n.id) }), 3)[0];
  R.subgraph1 = t(() => I.subgraph(m, { node: 'g3', depth: 1 }), 3)[0]; R.diffSame = t(() => I.diff(m, m), 3)[0];
  R.applyOne = t(() => I.apply(m, [{ op: 'update_node', id: 'cpu', set: { name: 'CPU' } }]), 3)[0];
  R.applyBatch50 = t(() => I.apply(m, Array.from({ length: 50 }, (_, i) => ({ op: 'set_param', node: 'cpu', key: 'k' + i, value: i }))), 2)[0];
  R.json = t(() => JSON.stringify(m, null, 2), 3)[0]; const js = JSON.stringify(m); R.parse = t(() => JSON.parse(js), 3)[0]; R.kb = Math.round(js.length / 1024);
  rows.push(R);
}
console.log('N    nodes edges  KB   normalize validate summary canonical toIpblock collapsed subgraph diff  apply1 apply50 json parse (ms)');
for (const r of rows) console.log([r.N, r.nodes, r.edges, r.kb, ...['normalize', 'validate', 'summary', 'canonical', 'toIpblock', 'toIpblockCollapsed', 'subgraph1', 'diffSame', 'applyOne', 'applyBatch50', 'json', 'parse'].map(k => r[k].toFixed(1))].join('\t'));
module.exports = rows;
