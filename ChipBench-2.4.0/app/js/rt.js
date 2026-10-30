/* ChipBench · rt.js — runtime services (1.7).  One place for the four things every module used to improvise:
     1. 错误 rt.report / rt.safe         统一错误出口：环形日志、去重提示、全局 error / unhandledrejection 兜底
     2. 任务 rt.task / rt.cancel         可取消的异步任务（AbortSignal）；同组新任务自动取消旧任务（“最新者胜”）
     3. 缓存 rt.lru / rt.cacheStats      有上限的 LRU（Map 的直接替代品），统一登记、统一清理、内存压力时自动收缩
     4. 性能 rt.perf                      长任务 / 输入延迟 P50-P95-P99 / 内存 / 自定义耗时，可导出基准
   以及模块注册表 rt.modules：声明依赖、按需加载（rt.load）。
   不依赖 DOM 即可加载（Node 测试 tests/rt.test.js）；浏览器能力在存在时才启用。 */
(function (G) {
  'use strict';
  const SL = (G.ChipBench = G.ChipBench || {});
  const RT = (SL.rt = SL.rt || {});
  const now = () => (G.performance && performance.now ? performance.now() : Date.now());
  const hasDOM = typeof document !== 'undefined' && !!document.createElement;

  /* ================================================================ 1. errors */
  const LOG_MAX = 300, log = (RT.log = []), seen = new Map();
  const text = e => (e && (e.message || e.reason || e)) + '';
  RT.report = function (err, ctx, o) {
    o = o || {};
    const rec = { t: Date.now(), ctx: ctx || '', msg: text(err).slice(0, 400), stack: err && err.stack ? String(err.stack).split('\n').slice(0, 6).join('\n') : '', level: o.level || 'error' };
    log.push(rec); if (log.length > LOG_MAX) log.splice(0, log.length - LOG_MAX);
    if (o.level !== 'quiet') { try { (console[rec.level === 'warn' ? 'warn' : 'error'])('[' + (ctx || 'rt') + ']', err); } catch (e) { } }
    if (o.toast !== false && o.level !== 'quiet' && SL.toast) {
      const k = (ctx || '') + '|' + rec.msg, last = seen.get(k) || 0;
      if (Date.now() - last > 8000) { seen.set(k, Date.now()); if (seen.size > 200) seen.delete(seen.keys().next().value); SL.toast((ctx ? ctx + '：' : '') + rec.msg.slice(0, 140), 4500, rec.level === 'warn' ? 'warn' : 'bad'); }
    }
    return rec;
  };
  RT.safe = (fn, ctx, fallback) => function () { try { const r = fn.apply(this, arguments); if (r && typeof r.then === 'function') return r.catch(e => { RT.report(e, ctx); return fallback; }); return r; } catch (e) { RT.report(e, ctx); return fallback; } };
  RT.diagnostics = () => ({ version: SL.VERSION || '', time: new Date().toISOString(), ua: typeof navigator !== 'undefined' ? navigator.userAgent : 'node', errors: log.slice(-100), perf: RT.perf.report(), caches: RT.cacheStats(), tasks: RT.tasks(), modules: RT.modules.status() });
  if (G.addEventListener) {
    G.addEventListener('error', e => { if (e && e.message && /ResizeObserver loop/.test(e.message)) return; RT.report(e && e.error || (e && e.message), 'window.onerror', { toast: false }); });
    G.addEventListener('unhandledrejection', e => { RT.report(e && e.reason, 'unhandledrejection', { toast: false }); });
  }

  /* ================================================================ 2. tasks */
  const live = new Map(); let tseq = 0;
  RT.CANCELLED = 'CANCELLED';
  /* RT.task(name, fn(signal, ctl), { group, timeout }) — tasks in the same group cancel each other (latest wins), e.g. switching workspaces
     cancels the previous scan.  Rejects with an Error whose .code === RT.CANCELLED when cancelled. */
  RT.task = function (name, fn, o) {
    o = o || {}; const id = ++tseq, ctl = typeof AbortController !== 'undefined' ? new AbortController() : { signal: { aborted: false }, abort() { this.signal.aborted = true; } };
    const rec = { id, name, group: o.group || name, t0: now(), ctl };
    if (o.group !== false) for (const [k, r] of live) if (r.group === rec.group) { r.ctl.abort(); live.delete(k); }
    live.set(id, rec);
    const api = { signal: ctl.signal, id, check() { if (ctl.signal.aborted) { const e = new Error('任务已取消：' + name); e.code = RT.CANCELLED; throw e; } }, cancel() { ctl.abort(); live.delete(id); } };
    let timer = 0; if (o.timeout) timer = setTimeout(() => { if (live.has(id)) ctl.abort(); }, o.timeout);
    return Promise.resolve().then(() => fn(ctl.signal, api)).then(r => { api.check(); return r; }).finally(() => { clearTimeout(timer); live.delete(id); RT.perf.span(name, now() - rec.t0); });
  };
  RT.cancel = group => { let n = 0; for (const [k, r] of live) if (r.group === group || r.name === group) { r.ctl.abort(); live.delete(k); n++; } return n; };
  RT.cancelAll = () => { const n = live.size; for (const r of live.values()) r.ctl.abort(); live.clear(); return n; };
  RT.tasks = () => Array.from(live.values()).map(r => ({ id: r.id, name: r.name, group: r.group, ms: Math.round(now() - r.t0) }));
  /* 1.8: "latest wins" — const g = RT.latest('atlas.open'); …await…; if (!g.ok()) return;  An older async job (opened, then superseded by a newer one) must not paint over the newer result. */
  const gens = new Map(); RT.latest = key => { const n = (gens.get(key) || 0) + 1; gens.set(key, n); return { key, n, ok: () => gens.get(key) === n }; };
  RT.isCancel = e => !!(e && e.code === RT.CANCELLED);
  RT.yield = () => (G.scheduler && typeof G.scheduler.yield === 'function') ? G.scheduler.yield() : new Promise(r => setTimeout(r, 0));
  /* run `step` over items in time slices of ~budget ms (keeps input responsive); stops early on cancel */
  RT.chunked = async (items, step, o) => { o = o || {}; const budget = o.budget || 8; let t = now(); for (let i = 0; i < items.length; i++) { if (o.signal && o.signal.aborted) return false; step(items[i], i); if (now() - t > budget) { await RT.yield(); t = now(); } } return true; };
  RT.debounce = (fn, ms) => { let t = 0; const f = function () { const a = arguments, self = this; clearTimeout(t); t = setTimeout(() => fn.apply(self, a), ms); }; f.cancel = () => clearTimeout(t); return f; };

  /* ================================================================ 3. caches */
  const caches = new Map();
  /* LRU is a Map: get() refreshes recency, set() evicts the oldest entries beyond `max` entries or `maxCost` (cost(value), default 1). */
  class LRU extends Map {
    constructor(name, max, o) { super(); o = o || {}; this.name = name; this.max = max || 200; this.maxCost = o.maxCost || 0; this.cost = o.cost || null; this.onEvict = o.onEvict || null; this._c = 0; this.hits = 0; this.misses = 0; this.evictions = 0; }
    get(k) { if (!super.has(k)) { this.misses++; return undefined; } const v = super.get(k); super.delete(k); super.set(k, v); this.hits++; return v; }
    set(k, v) { if (super.has(k)) { if (this.cost) this._c -= this.cost(super.get(k)) || 0; super.delete(k); } super.set(k, v); if (this.cost) this._c += this.cost(v) || 0; this._trim(); return this; }
    delete(k) { if (super.has(k) && this.cost) this._c -= this.cost(super.get(k)) || 0; return super.delete(k); }
    clear() { super.clear(); this._c = 0; }
    _trim(max, maxCost) { max = max == null ? this.max : max; maxCost = maxCost == null ? this.maxCost : maxCost; while (this.size > max || (maxCost && this._c > maxCost && this.size > 1)) { const k = this.keys().next().value, v = super.get(k); this.delete(k); this.evictions++; if (this.onEvict) { try { this.onEvict(k, v); } catch (e) { } } } }
    shrink(ratio) { this._trim(Math.floor(this.max * ratio), this.maxCost ? this.maxCost * ratio : 0); }
    stats() { return { name: this.name, size: this.size, max: this.max, cost: this._c, maxCost: this.maxCost, hits: this.hits, misses: this.misses, evictions: this.evictions }; }
  }
  RT.LRU = LRU;
  RT.lru = (name, max, o) => { const c = new LRU(name, max, o); let n = name, i = 1; while (caches.has(n)) n = name + '#' + (++i); c.name = n; caches.set(n, c); return c; };
  RT.cacheStats = () => Array.from(caches.values()).map(c => c.stats());
  RT.trimCaches = level => { for (const c of caches.values()) { if (level >= 2) c.clear(); else c.shrink(0.5); } RT.perf.count('cache-trim-' + level); return RT.cacheStats(); };
  RT.onTrim = fn => { (RT._trimHooks = RT._trimHooks || []).push(fn); };

  /* ================================================================ 4. performance */
  const P = (RT.perf = { long: { n: 0, total: 0, max: 0, recent: [] }, input: [], spans: {}, counters: {}, mem: [], started: Date.now() });
  const pct = (arr, p) => { if (!arr.length) return 0; const a = arr.slice().sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.max(0, Math.ceil(p / 100 * a.length) - 1))]; };
  RT.percentile = pct;
  P.count = (k, n) => { P.counters[k] = (P.counters[k] || 0) + (n == null ? 1 : n); };
  P.span = (name, ms) => { const s = P.spans[name] || (P.spans[name] = { n: 0, total: 0, max: 0, v: [] }); s.n++; s.total += ms; if (ms > s.max) s.max = ms; s.v.push(ms); if (s.v.length > 200) s.v.shift(); };
  P.time = async (name, fn) => { const t = now(); try { return await fn(); } finally { P.span(name, now() - t); } };
  /* wrap a (sync or async) function so every call is timed under `name` */
  P.wrap = (name, fn) => function () { const t = now(); let r; try { r = fn.apply(this, arguments); } catch (e) { P.span(name, now() - t); throw e; } if (r && typeof r.then === 'function') return r.finally(() => P.span(name, now() - t)); P.span(name, now() - t); return r; };
  P.memory = () => { const m = G.performance && performance.memory; return m ? { usedMB: +(m.usedJSHeapSize / 1048576).toFixed(1), totalMB: +(m.totalJSHeapSize / 1048576).toFixed(1), limitMB: +(m.jsHeapSizeLimit / 1048576).toFixed(0) } : null; };
  P.sample = () => { const m = P.memory(); if (m) { P.mem.push(Object.assign({ t: Math.round((Date.now() - P.started) / 1000) }, m)); if (P.mem.length > 600) P.mem.shift(); } return m; };
  P.report = () => {
    const spans = {}; for (const k in P.spans) { const s = P.spans[k]; spans[k] = { n: s.n, avg: +(s.total / s.n).toFixed(1), p95: +pct(s.v, 95).toFixed(1), max: +s.max.toFixed(1) }; }
    const inp = P.input, mem = P.mem, first = mem[0], last = mem[mem.length - 1];
    return { uptimeSec: Math.round((Date.now() - P.started) / 1000), longTasks: { count: P.long.n, totalMs: Math.round(P.long.total), maxMs: Math.round(P.long.max) },
      inputLatencyMs: { n: inp.length, p50: pct(inp, 50), p95: pct(inp, 95), p99: pct(inp, 99) }, memory: P.memory(), memoryGrowthMB: first && last ? +(last.usedMB - first.usedMB).toFixed(1) : null, spans, counters: Object.assign({}, P.counters) };
  };
  P.reset = () => { P.long = { n: 0, total: 0, max: 0, recent: [] }; P.input.length = 0; P.spans = {}; P.counters = {}; P.mem.length = 0; P.started = Date.now(); };
  P.start = () => {
    if (P._on || typeof PerformanceObserver === 'undefined') return; P._on = true;
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) { P.long.n++; P.long.total += e.duration; if (e.duration > P.long.max) P.long.max = e.duration; P.long.recent.push({ t: Math.round(e.startTime), ms: Math.round(e.duration) }); if (P.long.recent.length > 50) P.long.recent.shift(); } }).observe({ type: 'longtask', buffered: true }); } catch (e) { }
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) { if (e.interactionId || /^(keydown|pointerdown|click|keyup|input)$/.test(e.name)) { P.input.push(e.duration); if (P.input.length > 2000) P.input.shift(); } } }).observe({ type: 'event', durationThreshold: 16, buffered: true }); } catch (e) { }
    const trim = lv => { RT.trimCaches(lv); (RT._trimHooks || []).forEach(f => { try { f(lv); } catch (e) { } }); };
    setInterval(() => { const m = P.sample(); const lim = m && m.limitMB ? m.usedMB / m.limitMB : 0; if (lim > 0.82) trim(2); else if (lim > 0.65) trim(1); }, 15000);
    if (hasDOM) document.addEventListener('visibilitychange', () => { if (document.hidden) setTimeout(() => { if (document.hidden) trim(1); }, 60000); });
  };

  /* ================================================================ 5. module registry / lazy loading */
  const M = (RT.modules = { defs: new Map(), loaded: new Set(), loading: new Map(), base: 'js/' });
  M.define = (id, d) => { M.defs.set(id, Object.assign({ id, file: id + '.js', deps: [], lazy: false }, d || {})); return M; };
  M.markLoaded = id => { M.loaded.add(id); };
  /* generated list (js/modules-registry.js): defines every module; eager ones count as loaded once their <script> is in the page */
  M.registerAll = list => { list.forEach(d => M.define(d.id, d)); if (hasDOM) { const have = new Set(Array.from(document.scripts).map(s => (s.getAttribute('src') || '').split('/').pop())); list.forEach(d => { if (have.has(d.file) || !d.lazy) M.loaded.add(d.id); }); } };
  M.status = () => ({ loaded: Array.from(M.loaded), lazyPending: Array.from(M.defs.values()).filter(d => d.lazy && !M.loaded.has(d.id)).map(d => d.id), loading: Array.from(M.loading.keys()) });
  M.graph = () => Array.from(M.defs.values()).map(d => ({ id: d.id, deps: d.deps.slice(), lazy: !!d.lazy }));
  const inject = src => new Promise((res, rej) => { if (!hasDOM) return rej(new Error('no DOM')); const s = document.createElement('script'); s.src = src; s.async = false; s.onload = () => res(); s.onerror = () => rej(new Error('模块加载失败：' + src)); document.head.appendChild(s); });
  /* load a module (and its not-yet-loaded dependencies) once; concurrent callers share the same promise */
  RT.load = function (id) {
    if (M.loaded.has(id)) return Promise.resolve(true);
    if (M.loading.has(id)) return M.loading.get(id);
    const d = M.defs.get(id); if (!d) return Promise.reject(new Error('未登记的模块：' + id));
    const t0 = now();
    const p = (async () => { for (const dep of d.deps) await RT.load(dep); await inject(M.base + d.file); M.loaded.add(id); P.span('module:' + id, now() - t0); if (SL.emit) SL.emit('module-loaded', id); return true; })()
      .catch(e => { M.loading.delete(id); RT.report(e, '模块'); throw e; });
    M.loading.set(id, p); p.then(() => M.loading.delete(id), () => { }); return p;
  };
  RT.preload = (ids, delay) => { const go = () => ids.reduce((p, id) => p.then(() => RT.load(id)).catch(() => { }), Promise.resolve()); if (G.requestIdleCallback) requestIdleCallback(go, { timeout: delay || 4000 }); else setTimeout(go, delay || 1500); };

  if (hasDOM) P.start();
  if (typeof module !== 'undefined' && module.exports) module.exports = RT;
})(typeof window !== 'undefined' ? window : globalThis);
