/* Generate a large, VALID IP model for performance work:  node tools/gen-large-ip.js N [out.cbip]
   N nodes arranged as a bus tree: 1 CPU, N/20 groups of ~19 peripherals, each peripheral with 3 ports, ~1.4 edges per node, 2 registers per 4th node, 3 scenes of 12 steps.
   Deterministic (no Math.random) so measurements are comparable between runs. */
const I = require('../app/js/ip-model.js');
function gen(N) {
  const ops = [{ op: 'add_node', node: { id: 'cpu', kind: 'cpu', name: 'CPU', ports: [{ id: 'bus', type: 'bus', dir: 'out' }] } }, { op: 'add_node', node: { id: 'intc', kind: 'irq', name: 'INTC', ports: [{ id: 'in', type: 'irq', dir: 'in' }] } }];
  const G = Math.max(1, Math.round(N / 20)), per = Math.max(1, Math.floor((N - 2 - G) / G)); let edges = 0, regs = 0, n = 2 + G; const periph = [];
  for (let g = 0; g < G; g++) {
    ops.push({ op: 'add_node', node: { id: 'g' + g, kind: 'group', name: '子系统 ' + g, ports: [] } });
    for (let k = 0; k < per; k++) {
      const id = 'p' + g + '_' + k; n++;
      ops.push({ op: 'add_node', node: { id, kind: k % 7 === 0 ? 'mem' : k % 5 === 0 ? 'dma' : 'periph', name: 'IP ' + g + '.' + k, parent: 'g' + g, ports: [{ id: 'bus', type: 'bus', dir: 'in' }, { id: 'irq', type: 'irq', dir: 'out' }, { id: 'clk', type: 'clock', dir: 'in' }], ev: { level: k % 3 ? '待核对' : '手册确认', page: 100 + k } } });
      periph.push(id);
      if (k % 4 === 0) { const rid = 'R' + g + '_' + k; ops.push({ op: 'define_register', register: { id: rid, width: 32, address: 0x40000000 + (regs++) * 4, reset: 0, fields: [{ name: 'EN', bits: '0' }, { name: 'MODE', bits: '3:1' }, { name: 'DIV', bits: '15:8' }] } }, { op: 'set_registers', node: id, registers: [rid] }); }
    }
  }
  const seen = new Set(), E = (s, t, ty) => { const k = s + '>' + t; if (seen.has(k)) return; seen.add(k); ops.push({ op: 'add_edge', edge: { source: s, target: t, type: ty } }); edges++; };
  periph.forEach((id, i) => { E('cpu.bus', id + '.bus', 'bus'); if (i % 3 === 0) E(id + '.irq', 'intc.in', 'irq'); if (i % 5 === 0 && i + 1 < periph.length) E(periph[i + 1] + '.irq', 'intc.in', 'irq'); });
  const m0 = I.apply(I.create({ id: 'big' + N, name: '大型示例 ' + N, source: 'manual.pdf' }), ops);
  if (!m0.ok) throw new Error('gen failed: ' + JSON.stringify(m0.errors.slice(0, 3)));
  const m = m0.model, ids = m.nodes.filter(x => x.kind !== 'group').map(x => x.id), eids = m.edges.map(e => e.id), rids = Object.keys(m.registers), so = [];
  for (let s = 0; s < 3; s++) { const steps = []; for (let i = 0; i < 12; i++) steps.push({ title: '步骤 ' + (i + 1), note: '说明 ' + i, nodes: [ids[(s * 37 + i * 11) % ids.length], ids[(s * 53 + i * 7) % ids.length]], edges: [eids[(s * 29 + i * 13) % eids.length]], writes: rids.length ? [{ reg: rids[(s + i) % rids.length], value: (i + 1) * 3, note: 'w' + i }] : [] }); so.push({ op: 'add_scene', scene: { id: 'sc' + s, name: '场景 ' + s, steps } }); }
  const r2 = I.apply(m, so); if (!r2.ok) throw new Error('scenes failed: ' + JSON.stringify(r2.errors.slice(0, 3))); return r2.model;
}
module.exports = gen;
if (require.main === module) { const N = +process.argv[2] || 300, m = gen(N), out = process.argv[3]; const text = JSON.stringify(m, null, 2) + '\n'; if (out) { require('fs').writeFileSync(out, text); console.log('wrote', out, (text.length / 1024).toFixed(0) + ' KB', m.nodes.length + ' nodes', m.edges.length + ' edges', Object.keys(m.registers).length + ' registers'); } else console.log(m.nodes.length, m.edges.length, Object.keys(m.registers).length); }
