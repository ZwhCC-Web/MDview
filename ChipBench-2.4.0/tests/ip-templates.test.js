/* IP templates (1.8): structure only — no facts invented.  node tests/ip-templates.test.js */
const I = require('../app/js/ip-model.js'), T = require('../app/js/ip-templates.js'); let ok = 0, bad = 0;
const t = (n, c, d) => { if (c) ok++; else { bad++; console.log('FAIL', n, d === undefined ? '' : JSON.stringify(d)); } };
const keys = Object.keys(T.templates); t('twelve templates: CAN, Ethernet, DMA, timer, serial, Flash, RAM, GTM, clock & reset, multicore, CPU core, interrupt controller', keys.join() === 'can,eth,dma,timer,uart,flash,ram,gtm,clock,multicore,core,intc', keys);
for (const k of keys) {
  const m = T.model(k), v = I.validate(m).filter(x => x.level !== 'info');
  t(k + ': validates with no errors or warnings', v.length === 0, v);
  t(k + ': kind is template, one top node, children under it', m.kind === 'template' && m.nodes.filter(n => !n.parent).length === 1 && m.nodes.filter(n => n.parent === 'top').length === m.nodes.length - 1);
  t(k + ': every node and edge is 示意', m.nodes.every(n => n.ev.level === '示意') && m.edges.every(e => e.ev.level === '示意'));
  t(k + ': no hardware facts (no registers, params, pages, addresses)', !Object.keys(m.registers).length && m.nodes.every(n => !Object.keys(n.params).length && n.ev.page == null && !n.registers.length), m.nodes.filter(n => Object.keys(n.params).length));
  t(k + ': every internal edge has typed ports at both ends', m.edges.every(e => I.endpoint(e.source).port && I.endpoint(e.target).port));
  t(k + ': boundary ports include bus / clock / reset / irq', ['bus', 'clk', 'rst', 'irq'].every(p => m.nodes[0].ports.some(q => q.id === p)));
  const base = I.create({ id: 'u2b', name: 'U2B', chip: 'RH850/U2B' }); const ops = I.instantiate(m, { prefix: k + '0', name: k.toUpperCase() + '0' }); const r = I.apply(base, ops);
  t(k + ': instantiates into a model', r.ok && r.model.nodes.some(n => n.id === k + '0') && r.model.nodes.some(n => n.parent === k + '0'), r.errors);
  t(k + ': instance copy validates (only "unverified" info allowed)', r.ok && I.validate(r.model).every(x => x.level !== 'err'));
  const r2 = r.ok ? I.apply(r.model, I.instantiate(m, { prefix: k + '1' })) : null; t(k + ': two instances side by side', r2 && r2.ok);
  const ib = r.ok ? I.toIpblock(r.model) : null; t(k + ': renders (group + blocks + links)', ib && ib.groups.length === 1 && ib.blocks.length === m.nodes.length - 1 && ib.links.length === m.edges.length, ib && [ib.groups.length, ib.blocks.length, ib.links.length]);
}
const fsx = require('fs'), pth = require('path');
for (const k of keys) { const f = pth.join(__dirname, '../templates', k + '.cbip'); t(k + ': the bundled templates/' + k + '.cbip matches the code (run: node tools/export-templates.js)', fsx.existsSync(f) && fsx.readFileSync(f, 'utf8') === JSON.stringify(T.model(k), null, 2) + '\n'); }
t('no stray template files (every templates/*.cbip is a known template)', fsx.readdirSync(pth.join(__dirname, '../templates')).filter(f => f.endsWith('.cbip')).every(f => keys.includes(f.slice(0, -5))));
for (const k of keys) { const m = T.model(k); t(k + ': a real structure (>= 6 nodes, >= nodes-3 links)', m.nodes.length >= 6 && m.edges.length >= m.nodes.length - 3, [m.nodes.length, m.edges.length]);
  const touched = new Set(); m.edges.forEach(e => { touched.add(I.endpoint(e.source).node); touched.add(I.endpoint(e.target).node); }); const lone = m.nodes.filter(n => n.parent && !touched.has(n.id)).map(n => n.id); t(k + ': every child takes part in at least one link', lone.length === 0, lone);
  t(k + ': node ids are unique and plain (lower-case letters / digits)', new Set(m.nodes.map(n => n.id)).size === m.nodes.length && m.nodes.every(n => /^[a-z][a-z0-9]*$/.test(n.id)));
  const inst = T.instance(k, { id: 'my_' + k, name: '我的 ' + k, chip: 'RH850/U2B', source: 'manual.pdf' }); t(k + ': instance() extends the template, all 待核对, no facts, validates', inst.kind === 'instance' && inst.extends === m.id && inst.chip === 'RH850/U2B' && inst.nodes.every(n => n.ev.level === '待核对') && inst.edges.every(e => e.ev.level === '待核对') && !Object.keys(inst.registers).length && !I.validate(inst).some(v => v.level === 'err'), I.validate(inst).filter(v => v.level === 'err')); }
t('instance(): an unknown key is a clear error', (() => { try { T.instance('nope', { id: 'x', name: 'x' }); return false; } catch (e) { return /未知模板/.test(e.message); } })());
t('the GTM note says the module split follows the public GTM IP and the chip manual decides', /公开/.test(T.model('gtm').description) && /手册/.test(T.model('gtm').description) && /CMU/.test(T.model('gtm').description));
t('every template description starts with the structure-only reminder', keys.every(k => /只描述结构/.test(T.model(k).description)));
t('model() throws a clear error for an unknown template', (() => { try { T.model('nope'); return false; } catch (e) { return true; } })());
console.log(ok + ' passed, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
