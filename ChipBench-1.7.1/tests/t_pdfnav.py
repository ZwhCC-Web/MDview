"""1.7 · PDF navigation: bookmarks / page box / zoom land on the right page even when page sizes differ and pages are not rendered yet; printed page labels."""
import asyncio, json
from util import *; from base_fs import *
R = {}; fails = []
def chk(name, cond, info=None):
    R[name] = bool(cond)
    if not cond: fails.append(name); print('FAIL', name, info if info is not None else '')
    else: print('  ok ', name)
PATH = 'C:\\Work\\nav40.pdf'
async def main():
    with Server() as srv:
        async with async_playwright() as p:
            fs = base_fs(); fs[PATH] = {'b': b64(F / 'nav40.pdf')}
            b, ctx, pg, errs = await launch(p, srv, fs); ev = pg.evaluate
            async def wait(ms=300): await pg.wait_for_timeout(ms)
            await ev("ChipBench.openPath(%s)" % json.dumps(PATH)); await pg.wait_for_selector('.view-host:not(.hide) .pdf-page canvas', timeout=20000); await wait(600)
            V = '.view-host:not(.hide) '
            chk('bookmarks: 5 entries', await ev("document.querySelectorAll('%s.pdf-side .ol-i').length" % V) == 5)
            async def page_of_view():
                return await ev("""(()=>{const m=document.querySelector('%s.pdf-main'); const top=m.scrollTop+m.clientHeight*0.3; let r=1; document.querySelectorAll('%s.pdf-page').forEach(e=>{ if(e.offsetTop<=top) r=+e.dataset.n }); return r})()""" % (V, V))
            for rnd, (want, idx) in enumerate([(4, 1), (17, 3), (28, 4), (39, 5), (17, 3), (4, 1), (39, 5), (28, 4)]):
                await pg.click('%s.pdf-side .ol-i:nth-child(%d)' % (V, idx + 1)); await wait(900)
                box = await ev("document.querySelector('%s#pg').value" % V); vp = await page_of_view()
                chk(f'bookmark #{idx} -> PDF page {want} (round {rnd}): box={box} viewport={vp}', box == str(want) and vp == want, (box, vp))
            await pg.fill('%s#pg' % V, '2'); await pg.keyboard.press('Enter'); await wait(800)
            chk('label shown for front matter (ii)', 'ii' in await ev("document.querySelector('%s#plabel').innerText" % V))
            await pg.fill('%s#pg' % V, '9'); await pg.keyboard.press('Enter'); await wait(800)
            chk('label shown for body (printed 5)', '5' in await ev("document.querySelector('%s#plabel').innerText" % V) and (await page_of_view()) == 9)
            await ev("ChipBench.newDoc('', 'n.md', {keep:true})"); await wait(400)
            await ev("ChipBench.app.activate(ChipBench.app.tabs.findIndex(t=>t.name==='nav40.pdf'))"); await wait(500)
            await pg.click('%s.view-tools button:has-text("页面链接")' % V); await wait(500); val = await ev("ChipBench.app.ed ? ChipBench.app.ed.value : ''")
            chk('page link: [[nav40.pdf#p=9]] + printed page', '[[nav40.pdf#p=9]]' in val and '印刷页 5' in val, val)
            chk('no console errors', not errs, errs[:3])
            await b.close()
    print(json.dumps({'passed': sum(R.values()), 'total': len(R), 'fails': fails}, ensure_ascii=False))
    raise SystemExit(1 if fails else 0)
asyncio.run(main())
