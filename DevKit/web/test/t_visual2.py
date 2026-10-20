import asyncio
from util import *
async def main():
    async with async_playwright() as p:
        b,pg,errs = await page(p, native=True)
        ev=pg.evaluate
        await pg.wait_for_timeout(600); await pg.screenshot(path='v_imgs.png')
        await pg.click('.menu>button >> nth=0'); await pg.wait_for_timeout(150); await pg.screenshot(path='v_menu.png'); await pg.keyboard.press('Escape')
        await ev("MDView.openDoc(window.__SAMPLE__,'示例.md')"); await pg.wait_for_timeout(300)
        await ev("MDView.setMode('source')"); await pg.wait_for_timeout(300)
        await pg.keyboard.press('Control+f'); await pg.fill('#find-q','待办'); await pg.wait_for_timeout(300)
        await pg.screenshot(path='v_src.png'); await pg.keyboard.press('Escape')
        await ev("MDView.setMode('live')"); await pg.keyboard.press('Control+j'); await pg.wait_for_timeout(300); await pg.screenshot(path='v_ai_empty.png'); await pg.keyboard.press('Control+j')
        await pg.keyboard.press('Control+p'); await pg.keyboard.type('=0x40000000|1<<5'); await pg.wait_for_timeout(150); await pg.screenshot(path='v_calc.png'); await pg.keyboard.press('Escape')
        await pg.keyboard.press('Control+,'); await pg.wait_for_timeout(200); await pg.screenshot(path='v_prefs.png'); await pg.keyboard.press('Escape')
        print(errs)
        await b.close()
asyncio.run(main())
