/* workspace model 1.7: schema version, integrity check / repair, relocation with size disambiguation, shared refs. node tests/model.test.js */
const X = require('../app/js/logic.js'); const W = require('../app/js/model.js'); let ok = 0, bad = 0;
const t = (n, c, d) => { if (c) ok++; else { bad++; console.log('FAIL', n, d === undefined ? '' : JSON.stringify(d)); } };
let ws = W.create('P'); t('schema is 2', ws.version === 2 && W.SCHEMA === 2);
const v1 = { format: 'chipbench-workspace', version: 1, id: 'x', name: 'old', roots: [], collections: [{ type: 'group', name: 'g', children: [{ type: 'ref', kind: 'file', path: 'D:\\a\\m.pdf' }] }], layout: {}, settings: {}, recent: [] };
const mig = W.validate(JSON.parse(JSON.stringify(v1))); t('v1 → v2 migration keeps content and adds ids', mig.version === 2 && mig.collections[0].children[0].id && mig.collections[0].children[0].path === 'D:\\a\\m.pdf');
ws = W.create('P'); const r = W.addRoot(ws, 'D:\\Proj').root; const g1 = W.addGroup(ws, 'A'), g2 = W.addGroup(ws, 'B');
W.addRef(ws, { kind: 'file', path: 'D:\\Proj\\x.md' }, { parentId: g1.id }); W.addRef(ws, { kind: 'file', path: 'D:\\Proj\\x.md' }, { parentId: g2.id });
t('same file in two collections is allowed', W.membership(ws, 'D:\\Proj\\x.md').length === 2); t('multiRefs / stats.shared', W.multiRefs(ws).get(X.pkey('D:\\Proj\\x.md')) === 2 && W.stats(ws).shared === 1); t('check: clean workspace', W.check(ws).ok, W.check(ws));
const bad1 = JSON.parse(JSON.stringify(ws)); const gg = bad1.collections[0]; gg.children.push(Object.assign({}, gg.children[0])); bad1.collections[1].children[0].root = 'gone';
let c = W.check(bad1); t('check finds dup-id / dup-ref / dangling-root', ['dup-id', 'dup-ref', 'dangling-root'].every(k => c.issues.some(i => i.code === k)), c.issues.map(i => i.code));
const fx = W.repair(bad1); c = W.check(bad1); t('repair fixes everything it can', c.ok && fx.length >= 3, [fx, c.issues]); t('repair keeps the first ref and the path of the dangling one', bad1.collections[0].children.length === 1 && bad1.collections[1].children[0].path === 'D:\\Proj\\x.md');
ws = W.create('R'); const g = W.addGroup(ws, 'G'); const n1 = W.addRef(ws, { kind: 'file', path: 'D:\\old\\datasheet.pdf' }, { parentId: g.id }).node; W.setFingerprint(ws, 'D:\\old\\datasheet.pdf', 1234, 1); const n2 = W.addRef(ws, { kind: 'file', path: 'D:\\old\\unique.md' }, { parentId: g.id }).node;
let fixed = W.relocate(ws, ['D:\\old\\datasheet.pdf', 'D:\\old\\unique.md'], [{ path: 'E:\\new\\a\\datasheet.pdf', size: 999 }, { path: 'E:\\new\\b\\datasheet.pdf', size: 1234 }, 'E:\\new\\unique.md']);
t('relocate: ambiguous name resolved by size', fixed.find(f => f.from.endsWith('datasheet.pdf')).to === 'E:\\new\\b\\datasheet.pdf' && fixed[0].how === 'name+size', fixed); t('relocate: unique name still works with plain strings', n2.path === 'E:\\new\\unique.md');
ws = W.create('R2'); const n3 = W.addRef(ws, { kind: 'file', path: 'D:\\old\\same.pdf' }).node; t('relocate: ambiguous without fingerprint stays untouched', W.relocate(ws, ['D:\\old\\same.pdf'], [{ path: 'E:\\1\\same.pdf', size: 1 }, { path: 'E:\\2\\same.pdf', size: 2 }]).length === 0 && n3.path === 'D:\\old\\same.pdf');
t('relocate: re-roots when the new place is under a root', (() => { const w = W.create('R3'); const rt = W.addRoot(w, 'E:\\new').root; const n = W.addRef(w, { kind: 'file', path: 'D:\\o\\f.md' }).node; W.relocate(w, ['D:\\o\\f.md'], ['E:\\new\\sub\\f.md']); return n.root === rt.id && n.rel === 'sub/f.md'; })());
const pt = W.toPortable(ws, 'D:\\Proj'); t('portable keeps version', pt.version === 2 && W.fromPortable(pt, 'D:\\Proj').version === 2);
console.log(ok + ' passed, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
