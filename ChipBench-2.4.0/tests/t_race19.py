"""1.9 · overlapping opens of the same view tab keep only the newest view (PDF / HTML / log ... share V.open)."""
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
            fs = base_fs(); fs['C:\\Work\\r'] = {'dir': 1}; fs['C:\\Work\\r\\a.log'] = {'t': 'line1\nline2\nline3\n'}; fs['C:\\Work\\r\\p.html'] = {'t': '<html><body><h1>hi</h1></body></html>'}
            b, ctx, pg, errs = await launch(p, srv, fs); ev = pg.evaluate
            async def wait(ms=300): await pg.wait_for_timeout(ms)
            await wait(400)
            for name in ('a.log', 'p.html'):
                await ev("ChipBench.openPath(%s)" % json.dumps('C:\\Work\\r\\' + name)); await wait(1200)
                n = await ev("(async()=>{const t=ChipBench.app.current(); const a=ChipBench.viewers.open(t), b=ChipBench.viewers.open(t); await Promise.all([a,b]); return t.el.querySelectorAll(':scope > .vw').length;})()")
                chk(name + ': two overlapping opens leave exactly one view', n == 1, n)
                ok = await ev("(()=>{const t=ChipBench.app.current(); return t.el.querySelector(':scope > .vw').innerText.length>0 || !!t.el.querySelector('iframe, .vw *');})()"); chk(name + ': the surviving view has content', ok)
            sig = await ev("(async()=>{const t=ChipBench.app.current(); const s0=t.signal; const a=ChipBench.viewers.open(t); const s1=t.signal; await a; return [!!s0, s0 && s0.aborted, s1 && s1.aborted, s0 !== s1];})()")
            chk('a new open aborts the previous open’s signal and gets its own (audit CB-010)', sig[0] and sig[1] is True and sig[2] is False and sig[3] is True, sig)
            sg = await ev("(async()=>{const t=ChipBench.app.current(); const s=t.signal; await ChipBench.app.close(ChipBench.app.tabs.indexOf(t), true); return s ? s.aborted : 'no-signal:' + t.kind + ':' + t.view;})()")
            chk('closing the tab aborts its signal', sg is True, sg)
            await ev("ChipBench.openPath('C:\\\\Work\\\\r\\\\a.log')"); await wait(900)
            ca = await ev("(async()=>{const t=ChipBench.app.current(); const r=await ChipBench.viewers.open(Object.assign(t,{signal:{aborted:true}})); return [!!t.el, document.querySelectorAll('.view-host:not(.hide) .state.error').length];})()")
            chk('a stale (aborted) open ends quietly — no error panel', ca[1] == 0, ca)
            lat = await ev("(()=>{const R=ChipBench.rt; const a=R.latest('x'), b=R.latest('x'); return [a.ok(), b.ok()];})()"); chk('rt.latest is exposed in the app', lat == [False, True], lat)
            chk('no console errors', not errs, errs[:3])
            await b.close()
    print(json.dumps({'passed': sum(R.values()), 'total': len(R), 'fails': fails}, ensure_ascii=False))
asyncio.run(main())
