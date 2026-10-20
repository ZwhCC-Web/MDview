import asyncio
from util import *
async def main():
    async with async_playwright() as p:
        b,pg,errs = await page(p)
        ev=pg.evaluate
        print('cm', await ev('MDView.CMK.ok'), 'ready ms', round(await ev('window.__MDV_READY')))
        await pg.screenshot(path='s1.png')
        await pg.click('#write .blk[data-t="para"] >> nth=0'); await pg.wait_for_timeout(200)
        print('editor', await ev("MDView.S.editing && MDView.S.editing.ta.cm"))
        await pg.keyboard.press('End'); await pg.keyboard.type(' 追加文字'); await pg.wait_for_timeout(100)
        await pg.screenshot(path='s2.png')
        await pg.keyboard.press('Escape')
        print('edit ok', ' 追加文字' in await ev("MDView.S.src"))
        await ev("MDView.setMode('source')"); await pg.wait_for_timeout(400)
        await pg.screenshot(path='s3.png')
        await ev("MDView.setMode('split')"); await pg.wait_for_timeout(400)
        await pg.screenshot(path='s4.png')
        print('errs', errs)
        await b.close()
asyncio.run(main())
