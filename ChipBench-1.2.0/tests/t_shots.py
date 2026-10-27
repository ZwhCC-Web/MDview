import asyncio, json
from util import *; from base_fs import *
from t_features_shared import AIFETCH
NOTE = 'C:\\Work\\DFA培训\\讲稿.md'
async def main():
    with Server() as srv:
        async with async_playwright() as p:
            fs = base_fs(); fs['C:\\Users\\me\\.chipbench\\cache\\office\\规格.docx.pdf'] = {'b': b64(F / 'manual.pdf')}
            b, ctx, pg, errs = await launch(p, srv, fs, 'window.__PDFTEXT=' + json.dumps(PDFTEXT) + ';' + AIFETCH, w=1440, h=900); ev = pg.evaluate
            async def wait(ms=400): await pg.wait_for_timeout(ms)
            await ev("window.__pickFolder='C:\\\\Work\\\\DFA培训'"); await pg.click('.btn[data-a=add-root]'); await wait(600)
            await ev("window.__pickFolder='D:\\\\Share'"); await pg.click('#side-actions [data-a=add]'); await pg.click('.menu-pop [data-k=add-root]'); await wait(800)
            await ev("ChipBench.openPath('" + NOTE.replace('\\', '\\\\') + "')"); await pg.wait_for_function("ChipBench.app.current() && ChipBench.app.current().loaded", timeout=10000); await wait(1200)
            await ev("ChipBench.app.ed.select(ChipBench.app.ed.value.indexOf('介绍'))"); await ev("ChipBench.app.ed.view.scrollDOM.scrollTop=0"); await wait(700); await pg.screenshot(path='shot_live_light.png')
            await ev("ChipBench.prefs.theme='dark'; ChipBench.applyPrefs()"); await wait(500); await pg.screenshot(path='shot_live_dark.png'); await ev("ChipBench.prefs.theme='light'; ChipBench.applyPrefs()")
            await pg.click('#ws-views [data-v=collections]'); await ev("window.__pickAny=['C:\\\\Work\\\\DFA培训\\\\讲稿.md','D:\\\\Share\\\\A公司\\\\问题跟踪.md']"); await pg.click('#side-actions [data-a=add]'); await pg.click('.menu-pop [data-k=add-files]'); await wait(500)
            await pg.click('#side-actions [data-a=add]'); await pg.click('.menu-pop [data-k=add-group]'); await pg.fill('.modal input', '样品跟进'); await pg.click('.modal-f .primary'); await wait(300); await pg.click('#ws-views [data-v=roots]'); await wait(200)
            await pg.click('.ws-row[data-t=dir]:has-text("资料")'); await wait(300); await pg.screenshot(path='shot_ws.png')
            await pg.keyboard.press('Control+Shift+t'); await pg.wait_for_selector('.fp .plan'); await wait(600); await pg.screenshot(path='shot_plan.png'); await pg.keyboard.press('Escape')
            await ev("ChipBench.openPath('C:\\\\Work\\\\DFA培训\\\\资料\\\\manual.pdf')"); await pg.wait_for_selector('.view-host:not(.hide) .pdf-page canvas', timeout=15000); await wait(900); await pg.screenshot(path='shot_pdf.png')
            await ev("ChipBench.openPath('C:\\\\Work\\\\客户\\\\emb.map')"); await wait(1200); await pg.screenshot(path='shot_map.png')
            await ev("ChipBench.openPath('C:\\\\Work\\\\DFA培训\\\\资料\\\\样品.xlsx')"); await wait(1000); await pg.screenshot(path='shot_sheet.png')
            await ev("ChipBench.panel('search')"); await pg.fill('#sq', '时钟'); await wait(700); await pg.keyboard.press('Control+j'); await wait(500); await pg.screenshot(path='shot_search_ai.png'); await pg.keyboard.press('Control+j')
            await pg.keyboard.press('Control+p'); await wait(500); await pg.screenshot(path='shot_palette.png'); await pg.keyboard.press('Escape')
            await ev("ChipBench.prefs.theme='graphite'; ChipBench.applyPrefs()"); await ev("ChipBench.app.activate(0)"); await wait(900); await pg.screenshot(path='shot_graphite.png')
            print('errs', errs)
            await b.close()
asyncio.run(main())
