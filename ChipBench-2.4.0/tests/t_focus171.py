"""1.7.1 · dialogs trap keyboard focus (Tab / Shift+Tab cycle inside) and give it back on close; Esc closes."""
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
            b, ctx, pg, errs = await launch(p, srv, base_fs(), w=1300, h=800); ev = pg.evaluate
            async def wait(ms=300): await pg.wait_for_timeout(ms)
            await ev("ChipBench.ws.addRootPath('C:\\\\Work')"); await wait(600); await ev("ChipBench.openPath('C:\\\\Work\\\\DFA培训\\\\讲稿.md')"); await wait(800)
            await ev("document.querySelector('#st-ws').focus()"); before = await ev("document.activeElement.id")
            await ev("ChipBench.run('mcp.info')"); await wait(1200)
            inside = await ev("!!document.activeElement.closest('.modal')"); chk('opening a dialog without inputs moves focus into it', inside, await ev("document.activeElement.outerHTML.slice(0,80)"))
            out = []
            for i in range(30):
                await pg.keyboard.press('Tab'); out.append(await ev("!!document.activeElement.closest('.modal')"))
            chk('30 x Tab never leaves the dialog', all(out), out.count(False))
            out = []
            for i in range(30):
                await pg.keyboard.press('Shift+Tab'); out.append(await ev("!!document.activeElement.closest('.modal')"))
            chk('30 x Shift+Tab never leaves the dialog', all(out), out.count(False))
            await pg.keyboard.press('Escape'); await wait(300)
            chk('Esc closes it', await ev("document.querySelectorAll('.modal').length") == 0)
            chk('focus returns to the element that had it before', await ev("document.activeElement.id") == before, [before, await ev("document.activeElement.id")])
            # a dialog with an input (prompt) still focuses the input and traps focus
            await ev("(window.__pr = ChipBench.prompt('名称', 'x'), 1)"); await wait(400)
            chk('prompt focuses its input', await ev("document.activeElement.tagName") == 'INPUT')
            seq = []
            for i in range(8):
                await pg.keyboard.press('Tab'); seq.append(await ev("!!document.activeElement.closest('.modal')"))
            chk('prompt traps focus too', all(seq), seq)
            await pg.keyboard.press('Escape'); await wait(200)
            chk('no console errors', not errs, errs[:3]); await b.close()
    print(json.dumps({'passed': sum(R.values()), 'total': len(R), 'fails': fails}, ensure_ascii=False))
    raise SystemExit(1 if fails else 0)
asyncio.run(main())
