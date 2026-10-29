/* rt.js (runtime services): LRU, tasks / cancellation, percentile, perf spans, module registry.  node tests/rt.test.js */
globalThis.ChipBench = {};
const RT = require('../app/js/rt.js'); let pass = 0, fail = 0; const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, d === undefined ? '' : d); } };
(async () => {
  const c = RT.lru('t', 3); c.set('a', 1); c.set('b', 2); c.set('c', 3); c.get('a'); c.set('d', 4);
  ok('lru evicts least-recently-used', !c.has('b') && c.has('a') && c.has('c') && c.has('d') && c.size === 3, [...c.keys()]); ok('lru is a Map', c instanceof Map && c.evictions === 1);
  const cc = RT.lru('cost', 100, { maxCost: 10, cost: v => v.length }); cc.set('x', '12345'); cc.set('y', '12345'); cc.set('z', '1'); ok('lru cost-bounded', cc.size === 2 && !cc.has('x') && cc._c === 6, cc.stats()); cc.delete('y'); ok('lru cost tracks delete', cc._c === 1);
  const ev = []; const ce = RT.lru('ev', 1, { onEvict: k => ev.push(k) }); ce.set(1, 1); ce.set(2, 2); ok('lru onEvict', ev.join() === '1');
  c.shrink(0.34); ok('lru shrink', c.size === 1); RT.trimCaches(2); ok('trim hard clears all', RT.cacheStats().every(s => s.size === 0)); ok('registry names unique', RT.lru('t', 1).name === 't#2');
  ok('percentile', RT.percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95) === 10 && RT.percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50) === 5 && RT.percentile([], 95) === 0);
  const t1 = RT.task('scan', async () => { await new Promise(r => setTimeout(r, 30)); return 1; }, { group: 'ws' }), t2 = RT.task('scan2', async () => { await new Promise(r => setTimeout(r, 5)); return 2; }, { group: 'ws' });
  const r1 = await t1.then(() => 'ok', e => RT.isCancel(e) ? 'cancelled' : 'err:' + e.message), r2 = await t2.then(v => v, () => 'err'); ok('task: older task of the group is cancelled', r1 === 'cancelled' && r2 === 2, [r1, r2]);
  ok('task: finished tasks leave the table', RT.tasks().length === 0);
  ok('task: timeout cancels', (await RT.task('slow', async () => { await new Promise(r => setTimeout(r, 80)); return 1; }, { timeout: 10 }).then(() => 'ok', e => RT.isCancel(e) ? 'cancelled' : 'err')) === 'cancelled');
  ok('task resolves value', (await RT.task('x', async () => 5, { group: 'g4' })) === 5);
  ok('cancel(group)', (() => { RT.task('a1', () => new Promise(r => setTimeout(r, 50)), { group: 'gg' }).catch(() => { }); return RT.cancel('gg') === 1; })());
  const ctl = new AbortController(); let n = 0; const done = await RT.chunked(Array.from({ length: 100 }, (_, i) => i), i => { n++; if (i === 10) ctl.abort(); }, { signal: ctl.signal, budget: 1000 }); ok('chunked stops on abort', done === false && n === 11, n);
  RT.perf.reset(); RT.perf.span('a', 10); RT.perf.span('a', 30); await RT.perf.time('b', async () => 1); RT.perf.count('x', 3); const rep = RT.perf.report(); ok('perf report spans', rep.spans.a.n === 2 && rep.spans.a.avg === 20 && rep.spans.b.n === 1 && rep.counters.x === 3, rep);
  const w1 = RT.perf.wrap('wrapped', (a, b) => a + b), wa = RT.perf.wrap('wrapped-async', async x => x * 2); ok('perf.wrap: sync + async', w1(2, 3) === 5 && (await wa(4)) === 8 && RT.perf.report().spans.wrapped.n === 1 && RT.perf.report().spans['wrapped-async'].n === 1);
  let thrown = false; try { RT.perf.wrap('boom', () => { throw new Error('x'); })(); } catch (e) { thrown = true; } ok('perf.wrap rethrows and records', thrown && RT.perf.report().spans.boom.n === 1);
  const before = RT.log.length; RT.report(new Error('boom'), 'unit', { toast: false, level: 'quiet' }); ok('report logs', RT.log.length === before + 1 && RT.log.at(-1).msg === 'boom');
  ok('safe returns fallback', RT.safe(() => { throw new Error('x'); }, 'safe', 'fb')() === 'fb'); ok('safe async fallback', (await RT.safe(async () => { throw new Error('y'); }, 'safe', 'fb2')()) === 'fb2'); ok('diagnostics shape', RT.diagnostics().errors.length > 0 && Array.isArray(RT.diagnostics().caches));
  RT.modules.define('a', { lazy: true }).define('b', { deps: ['a'], lazy: true }).define('core'); RT.modules.markLoaded('core'); const st = RT.modules.status(); ok('module status', st.loaded.includes('core') && st.lazyPending.join() === 'a,b' && RT.modules.graph().find(g => g.id === 'b').deps[0] === 'a');
  let rej = false; try { await RT.load('nope'); } catch (e) { rej = true; } ok('load unknown rejects', rej);
  console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();
