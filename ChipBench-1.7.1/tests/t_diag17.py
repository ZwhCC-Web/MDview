"""1.7 · timing probes + diagnostics report."""
import asyncio, json
from util import *; from base_fs import *
R = {}; fails = []
def chk(name, cond, info=None):
    R[name] = bool(cond)
    if not cond: fails.append(name); print('FAIL', name, info if info is not None else '')
    else: print('  ok ', name)
async def main():
    with Server() as srv:
        async with async_playwright() as p:
            b, ctx, pg, errs = await launch(p, srv, base_fs()); ev = pg.evaluate
            async def wait(ms=300): await pg.wait_for_timeout(ms)
            await ev("ChipBench.rt.perf.reset()")
            for f in ('C:\\Work\\DFA培训\\讲稿.md', 'C:\\Work\\DFA培训\\章节\\01-背景.md'): await ev("ChipBench.openPath(%s)" % json.dumps(f)); await wait(400)
            await ev("ChipBench.app.activate(0)"); await wait(300); await ev("ChipBench.app.setMode('read')"); await wait(300)
            sp = await ev("ChipBench.rt.perf.report().spans")
            chk('probes record open-file / tab-switch / mode-switch', sp.get('open-file', {}).get('n', 0) >= 2 and sp.get('tab-switch', {}).get('n', 0) >= 1 and sp.get('mode-switch', {}).get('n', 0) >= 1, list(sp))
            chk('probe values are sane (ms)', 0 < sp['open-file']['avg'] < 5000, sp.get('open-file'))
            await ev("ChipBench.run('app.diagnostics')"); await pg.wait_for_selector('.modal', timeout=5000); await wait(300)
            txt = await ev("document.querySelector('.modal').innerText"); chk('dialog shows open / tab timings and the saved report path', '打开文件' in txt and '切换标签' in txt and 'chipbench-diagnostics-' in txt, txt)
            files = await ev("Object.keys(window.__FS).filter(k=>/diagnostics.chipbench-diagnostics-.*json$/.test(k))"); chk('report file written under <data>/diagnostics', len(files) == 1, files)
            rep = json.loads(await ev("window.__FS[%s].t" % json.dumps(files[0]))) if files else {}
            chk('report has perf / caches / modules / env / errors / tasks', all(k in rep for k in ('perf', 'caches', 'modules', 'env', 'errors', 'tasks')), list(rep))
            chk('no console errors', not errs, errs[:3]); await b.close()
    print(json.dumps({'passed': sum(R.values()), 'total': len(R), 'fails': fails}, ensure_ascii=False))
    raise SystemExit(1 if fails else 0)
asyncio.run(main())
