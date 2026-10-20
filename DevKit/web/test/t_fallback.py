import asyncio
from util import *
async def main():
    async with async_playwright() as p:
        b,pg,errs = await page(p, init='window.__MDV_NOCM=true')
        ev=pg.evaluate; R={}
        R['engine'] = await pg.inner_text('#st-engine')
        await ev("MDView.newTab()"); await pg.wait_for_timeout(200)
        for s,k in [('# 标题','Enter'),('- a','Enter'),('b','Enter'),(None,'Enter'),('/bg','Enter'),('X',None)]:
            if s: await pg.keyboard.type(s)
            if k: await pg.keyboard.press(k)
        await pg.keyboard.press('Escape'); R['live'] = await ev("MDView.S.src")
        await ev("MDView.setMode('source')"); await pg.wait_for_timeout(200)
        await ev("(()=>{const e=MDView.srcEd; e.focus(); e.setSelectionRange(e.value.length,e.value.length)})()")
        await pg.keyboard.type('\n\n- q'); await pg.keyboard.press('Enter'); await pg.keyboard.type('w'); await pg.wait_for_timeout(400)
        R['src'] = await ev("MDView.S.src.split('\\n').slice(-2)")
        await ev("MDView.setMode('live')"); R['back'] = await ev("MDView.S.src.endsWith('- w')")
        R['errs']=errs
        for k,v in R.items(): print(k,'=>',v)
        await b.close()
asyncio.run(main())
