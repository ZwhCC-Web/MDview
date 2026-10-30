import asyncio, json
from util import *; from base_fs import *
import pathlib as _pl; OUTDIR = _pl.Path(__file__).resolve().parent / "out"; OUTDIR.mkdir(exist_ok=True)
async def main():
    with Server() as srv:
        async with async_playwright() as p:
            b, ctx, pg, errs = await launch(p, srv, base_fs(), 'window.__PDFTEXT=' + json.dumps(PDFTEXT))
            ev = pg.evaluate
            print('bootMs', await ev('ChipBench.bootMs'), 'tabs', await ev('ChipBench.app.tabs.length'))
            print('rail', await ev("[...document.querySelectorAll('#rail .rb')].map(b=>b.dataset.p||b.dataset.x).join(',')"))
            print('ws', await ev('ChipBench.ws.cur && ChipBench.ws.cur.name'), 'panel', await ev("document.querySelector('#side .pane.on')?.id"))
            print('cmds', await ev('ChipBench.commands.size'))
            await pg.screenshot(path=str(OUTDIR / 's_boot.png'))
            print('ERRS', errs); globals()['_errs'] = [e for e in errs if 'pageerror' in e]
            await b.close()
asyncio.run(main())
import sys as _sys; _sys.exit(1 if globals().get('_errs') else 0)
