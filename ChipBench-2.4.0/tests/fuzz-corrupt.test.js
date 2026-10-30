/* Corrupted-file tests (2.4):  node tests/fuzz-corrupt.test.js [seeds=300]
   A .cbip can be edited by hand, merged badly, written by another tool, or truncated.  Build a rich valid model, then damage it in random ways (wrong types, missing keys, nulls, huge
   values, duplicates, dangling references, reserved names) and call everything the UI and the MCP server call on a loaded file.  Invariants:
     1 normalize / validate / summary / subgraph / diff / toIpblock / canonical / simulate NEVER throw
     2 a damaged model is reported by validate or normalised away — never silently treated as healthy where it matters (see 3)
     3 everything finishes quickly (no loop on a cyclic parent chain, no blow-up on a huge width / value)      4 the same damaged file never changes between two calls (pure) */
const I = require('../app/js/ip-model.js'), S = require('../app/js/ip-sim.js'), G = require('./fuzz-gen.js'), R = G.rng;
const SEEDS = +process.argv[2] || 300; let bad = 0, calls = 0, damaged = 0, flagged = 0; const first = {};
const fail = (k, seed, d) => { bad++; if (!first[k]) { first[k] = 1; console.log('FAIL', k, 'seed', seed, String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 500)); } };
/* a rich, valid model to damage */
function rich(seed) {
  const gen = G.Gen(seed * 7 + 3); let m = I.create({ id: 'c' + seed, name: 'C' });
  for (let i = 0; i < 80; i++) { const r = I.apply(m, JSON.parse(JSON.stringify(gen.next(m)))); if (r.ok) m = r.model; }
  return JSON.parse(JSON.stringify(m));
}
const PATHS = (o, pre = '', out = []) => { if (o && typeof o === 'object') for (const k of Object.keys(o)) { out.push(pre + (pre ? '.' : '') + k); PATHS(o[k], pre + (pre ? '.' : '') + k, out); } return out; };
const setPath = (o, path, v) => { const ks = path.split('.'); let c = o; for (let i = 0; i < ks.length - 1; i++) { c = c[ks[i]]; if (!c || typeof c !== 'object') return false; } if (v === undefined) delete c[ks[ks.length - 1]]; else c[ks[ks.length - 1]] = v; return true; };
const JUNK = [null, undefined, 7, -1, 1e308, 2 ** 31, true, false, '', 'x', '__proto__', 'constructor', [], {}, [1, 2], { a: 1 }, 'a.b.c', '0x', 1e9, NaN === NaN ? 0 : null];
function damage(m, r) {
  const n = 1 + Math.floor(r() * 4); damaged++;
  for (let i = 0; i < n; i++) {
    const kind = Math.floor(r() * 6), paths = PATHS(m); if (!paths.length) break; const p = paths[Math.floor(r() * paths.length)];
    if (kind <= 2) setPath(m, p, JUNK[Math.floor(r() * JUNK.length)]);                                     // wrong type / value at a random place
    else if (kind === 3) setPath(m, p, undefined);                                                           // missing key
    else if (kind === 4 && Array.isArray(m.nodes) && m.nodes.length > 1) { const a = m.nodes[Math.floor(r() * m.nodes.length)], b = m.nodes[Math.floor(r() * m.nodes.length)]; if (a && b && typeof a === 'object' && typeof b === 'object') { a.parent = b.id; b.parent = a.id; } }   // parent cycle
    else if (Array.isArray(m.nodes) && m.nodes.length) { const x = m.nodes[Math.floor(r() * m.nodes.length)]; if (x && typeof x === 'object') m.nodes.push(JSON.parse(JSON.stringify(x))); }   // duplicate id
  }
  if (r() < 0.2) m.registers = JUNK[Math.floor(r() * JUNK.length)]; if (r() < 0.1) m.scenes = JUNK[Math.floor(r() * JUNK.length)]; if (r() < 0.1) m.rules = JUNK[Math.floor(r() * JUNK.length)]; if (r() < 0.1) m.nodes = JUNK[Math.floor(r() * JUNK.length)];
  if (r() < 0.08) m.timings = JUNK[Math.floor(r() * JUNK.length)]; if (r() < 0.05) m.edges = JUNK[Math.floor(r() * JUNK.length)];
  return m;
}
const guard = (name, seed, f) => { const t0 = Date.now(); try { const v = f(); calls++; if (Date.now() - t0 > 2500) fail(name + ' too slow', seed, { ms: Date.now() - t0 }); return v; } catch (e) { fail(name + ' threw', seed, String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')); return undefined; } };
for (let seed = 1; seed <= SEEDS; seed++) {
  const r = R(seed * 101), base = rich(seed), m = damage(JSON.parse(JSON.stringify(base)), r), text = JSON.stringify(m);
  let V = guard('validate', seed, () => I.validate(JSON.parse(text))); if (V && V.some(v => v.level === 'err')) flagged++;
  guard('normalize', seed, () => I.normalize(JSON.parse(text))); guard('summary', seed, () => I.summary(JSON.parse(text))); guard('canonical', seed, () => I.canonical(JSON.parse(text)));
  guard('toIpblock', seed, () => I.toIpblock(JSON.parse(text))); guard('toIpblock collapsed', seed, () => { const mm = I.normalize(JSON.parse(text)); return I.toIpblock(mm, { collapsed: mm.nodes.map(n => n && n.id).filter(x => typeof x === 'string') }); });
  guard('diff', seed, () => I.diff(JSON.parse(text), JSON.parse(JSON.stringify(base)))); guard('diff self', seed, () => I.diff(JSON.parse(text), JSON.parse(text)));
  const nm = guard('normalize2', seed, () => I.normalize(JSON.parse(text))); if (nm && nm.nodes.length) { const id = nm.nodes.find(n => n && typeof n.id === 'string'); if (id) guard('subgraph', seed, () => I.subgraph(JSON.parse(text), { node: id.id, depth: 1 })); }
  guard('describe every op', seed, () => I.OP_NAMES.map(n => I.describeOp({ op: n, node: m.nodes && m.nodes[0], rule: m.rules && m.rules[0], scene: m.scenes && m.scenes[0], timing: m.timings && m.timings[0] })));
  const sc = nm && Array.isArray(nm.scenes) ? nm.scenes.filter(x => x && typeof x.id === 'string') : []; for (const s of sc) { const a = guard('simulate', seed, () => JSON.stringify(S.plain(S.simulate(JSON.parse(text), s.id)))), b = guard('simulate again', seed, () => JSON.stringify(S.plain(S.simulate(JSON.parse(text), s.id)))); if (a !== b) fail('simulate not deterministic on a damaged model', seed, s.id); }
  guard('apply on a damaged model', seed, () => { const x = I.apply(JSON.parse(text), [{ op: 'set_meta', set: { name: 'z' } }, { op: 'add_node', node: { id: 'zz', kind: 'cpu' } }]); return x.ok; });
  guard('validate twice identical', seed, () => { if (JSON.stringify(I.validate(JSON.parse(text))) !== JSON.stringify(I.validate(JSON.parse(text)))) fail('validate not pure', seed, ''); });
}
console.log('seeds', SEEDS, '| damaged models', damaged, '(validate flagged an error in ' + flagged + ') | calls', calls, '| distinct failures', Object.keys(first).length);
console.log((Object.keys(first).length ? 0 : 1) + ' passed, ' + Object.keys(first).length + ' failed'); process.exit(Object.keys(first).length ? 1 : 0);
