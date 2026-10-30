"""1.7 · scenario benchmarks (repeatable P95 / peak-memory / long-task / switch-time numbers):
   S1 start-up · S2 workspace switching (2 projects × 400 notes) · S3 opening files (md / pdf / xlsx / docx / log) · S4 long run (memory, caches, tasks, DOM).
Writes tests/perf_results17.json;  python scripts/check_perf.py 17  compares it with the budgets.  Headless software-rendered Chromium: use it to catch regressions, not as device numbers."""
import asyncio, json, statistics, pathlib
from util import *; from base_fs import *
OUT = pathlib.Path(__file__).resolve().parent / 'perf_results17.json'
def p95(v): v = sorted(v); return round(v[max(0, int(len(v) * .95 + .999) - 1)], 1) if v else 0
def med(v): return round(statistics.median(v), 1) if v else 0
def ws_json(i, name, root):
    return json.dumps({'format': 'chipbench-workspace', 'version': 2, 'id': i, 'name': name, 'created': 1, 'updated': 1, 'roots': [{'id': 'r' + i, 'path': root, 'name': name}], 'collections': [{'id': 'g' + i, 'type': 'group', 'name': '资料', 'children': [{'id': 'n%s%d' % (i, k), 'type': 'ref', 'kind': 'file', 'root': 'r' + i, 'rel': 'n%03d.md' % k, 'path': root + '\\n%03d.md' % k} for k in range(40)]}], 'recent': [], 'layout': {'tabs': [], 'active': None}, 'settings': {'restore': True, 'exclude': []}}, ensure_ascii=False)
async def main():
    R = {}; fs = base_fs()
    for i, name in (('wa', 'ProjA'), ('wb', 'ProjB')):
        root = 'C:\\Perf\\' + name; fs[root] = {'dir': 1}
        for k in range(400): fs[root + '\\n%03d.md' % k] = {'t': '---\ntitle: 笔记 %d\nstatus: 进行中\n---\n# 笔记 %d\n\n' % (k, k) + ('段落 [[n%03d]] 寄存器 0x%04X 时钟配置。\n\n- [ ] 任务 %d ⏳ 2026-10-3%d\n' % ((k + 1) % 400, k, k, k % 9)) * 12}
        fs['C:\\Users\\me\\.chipbench\\workspaces\\%s.cbws' % i] = {'t': ws_json(i, name, root)}
    fs['C:\\Perf\\ProjA\\manual.pdf'] = {'b': b64(F / 'manual.pdf')}; fs['C:\\Perf\\ProjA\\样品.xlsx'] = {'b': b64(F / '样品.xlsx')}; fs['C:\\Perf\\ProjA\\规格.docx'] = {'b': b64(F / '规格.docx')}
    fs['C:\\Perf\\ProjA\\uart.log'] = {'t': '\n'.join('[%05d] INFO tick temp=%d' % (i, 20 + i % 7) for i in range(20000))}
    with Server() as srv:
        async with async_playwright() as p:
            b, ctx, pg, errs = await launch(p, srv, fs, kv={'ws.current': json.dumps('wa')}); ev = pg.evaluate
            async def wait(ms=300): await pg.wait_for_timeout(ms)
            await ev("window.__lt=[]; new PerformanceObserver(l=>l.getEntries().forEach(e=>window.__lt.push(e.duration))).observe({entryTypes:['longtask']})")
            R['boot_ms'] = await ev('ChipBench.bootMs'); R['dom_content_loaded_ms'] = (await ev("(()=>{const n=performance.getEntriesByType('navigation')[0]; return {dcl: Math.round(n.domContentLoadedEventEnd)}})()"))['dcl']
            R['startup_js_kb'] = await ev("Math.round(performance.getEntriesByType('resource').filter(r=>/\\/js\\//.test(r.name)).reduce((a,r)=>a+(r.decodedBodySize||0),0)/1024)")
            R['lazy_modules_pending'] = await ev("ChipBench.rt.modules.status().lazyPending.length"); R['startup_longtasks'] = await ev("window.__lt.filter(x=>x>50).length")
            await wait(2500); R['index_docs'] = await ev("ChipBench.index.docs.size")
            sw = []; lt = []
            for i in range(12):
                tgt = 'wb' if i % 2 == 0 else 'wa'; await ev("window.__lt.length=0")
                sw.append(await ev("(async(id)=>{const t0=performance.now(); await ChipBench.ws.switchTo(id); return performance.now()-t0})('%s')" % tgt)); lt.append(await ev("window.__lt.filter(x=>x>50).length")); await wait(250)
            R['ws_switch_median_ms'] = med(sw); R['ws_switch_p95_ms'] = p95(sw); R['ws_switch_max_ms'] = round(max(sw), 1); R['ws_switch_longtasks'] = sum(lt)
            await ev("ChipBench.ws.switchTo('wa')"); await wait(1200)
            files = {'md': ['C:\\Perf\\ProjA\\n%03d.md' % k for k in range(30)], 'pdf': ['C:\\Perf\\ProjA\\manual.pdf'], 'xlsx': ['C:\\Perf\\ProjA\\样品.xlsx'], 'docx': ['C:\\Perf\\ProjA\\规格.docx'], 'log': ['C:\\Perf\\ProjA\\uart.log']}
            async def open_(path):
                await ev("window.__lt.length=0"); t = await ev("(async(p)=>{const t0=performance.now(); await ChipBench.openPath(p); await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); return performance.now()-t0})(%s)" % json.dumps(path)); return t, await ev("window.__lt.filter(x=>x>50).length")
            for kind, L in files.items():
                ts = []; ltk = 0
                for pth in L: t, n = await open_(pth); ts.append(t); ltk += n; await wait(120)
                R['open_%s_median_ms' % kind] = med(ts); R['open_%s_p95_ms' % kind] = p95(ts); R['open_%s_longtasks' % kind] = ltk
            ts = [await ev("(async(i)=>{const t0=performance.now(); await ChipBench.app.activate(i); await new Promise(r=>requestAnimationFrame(r)); return performance.now()-t0})(%d)" % (i % 30)) for i in range(60)]
            R['tab_switch_median_ms'] = med(ts); R['tab_switch_p95_ms'] = p95(ts)
            await ev("ChipBench.app.activate(0)"); await wait(500)
            lat = await ev("""(async()=>{const ed=ChipBench.app.ed, ts=[]; ed.select(10); for(let i=0;i<60;i++){const t0=performance.now(); ed.insert('x'); await new Promise(r=>requestAnimationFrame(()=>r())); ts.push(performance.now()-t0);} return ts})()""")
            R['input_latency_median_ms'] = med(lat); R['input_latency_p95_ms'] = p95(lat)
            async def heap():
                await ev("(()=>{if(window.gc){gc();gc();}})()"); await wait(200); return await ev("performance.memory.usedJSHeapSize/1048576")
            await ev("(async()=>{const A=ChipBench.app; while(A.tabs.length>1) await A.close(A.tabs.length-1, true);})()")
            h0 = await heap(); dom0 = await ev("document.getElementsByTagName('*').length")
            for rnd in range(6):
                for k in range(40):
                    await ev("ChipBench.openPath(%s)" % json.dumps('C:\\Perf\\Proj%s\\n%03d.md' % ('A' if rnd % 2 == 0 else 'B', (rnd * 40 + k) % 400)))
                    if k % 8 == 7: await ev("ChipBench.openPath('C:\\\\Perf\\\\ProjA\\\\manual.pdf')"); await wait(150)
                await ev("ChipBench.ws.switchTo('%s')" % ('wb' if rnd % 2 == 0 else 'wa')); await wait(400)
                await ev("(async()=>{const A=ChipBench.app; while(A.tabs.length>1) await A.close(A.tabs.length-1, true);})()"); await wait(200)
            h1 = await heap(); dom1 = await ev("document.getElementsByTagName('*').length")
            R['longrun_heap_start_mb'] = round(h0, 1); R['longrun_heap_end_mb'] = round(h1, 1); R['longrun_heap_growth_mb'] = round(h1 - h0, 1); R['longrun_dom_growth'] = dom1 - dom0; R['longrun_tasks_left'] = await ev("ChipBench.rt.tasks().length")
            cs = await ev("ChipBench.rt.cacheStats()"); R['caches'] = {c['name']: [c['size'], c['max']] for c in cs}; R['caches_over_limit'] = sum(1 for c in cs if c['size'] > c['max'])
            R['rt_errors'] = len(await ev("ChipBench.rt.log.filter(e=>e.level==='error')")); R['console_errors'] = len(errs); R['perf_report'] = await ev("ChipBench.rt.perf.report()")
            await b.close()
    OUT.write_text(json.dumps(R, ensure_ascii=False, indent=1), 'utf-8'); print(json.dumps({k: v for k, v in R.items() if k not in ('perf_report', 'caches')}, ensure_ascii=False, indent=1))
asyncio.run(main())
