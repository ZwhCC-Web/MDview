"""1.7 · safe writes: conflict detection (manual + auto-save), touch-only mtime change, rolling backup, restore list; re-activating the current tab keeps typing."""
import asyncio, json
from util import *; from base_fs import *
R = {}; fails = []
def chk(name, cond, info=None):
    R[name] = bool(cond)
    if not cond: fails.append(name); print('FAIL', name, info if info is not None else '')
    else: print('  ok ', name)
P = 'C:\\Work\\DFA培训\\讲稿.md'; J = json.dumps(P)
async def main():
    with Server() as srv:
        async with async_playwright() as p:
            b, ctx, pg, errs = await launch(p, srv, base_fs()); ev = pg.evaluate
            async def wait(ms=300): await pg.wait_for_timeout(ms)
            add = lambda s: ev("(()=>{ChipBench.app.ed.value = ChipBench.app.ed.value + '\\n%s\\n';})()" % s)
            await ev("ChipBench.openPath(%s)" % J); await wait(900); orig = await ev("window.__FS[%s].t" % J)
            await add('LOCAL-1'); await wait(200); ok = await ev("ChipBench.app.save(ChipBench.app.current())"); await wait(300)
            chk('normal save succeeds', ok is True and 'LOCAL-1' in await ev("window.__FS[%s].t" % J))
            bk = await ev("ChipBench.safe.list(%s)" % J); chk('first save creates a backup of the previous content', len(bk) == 1, bk)
            chk('backup holds the ORIGINAL text', (await ev("ChipBench.fs.read(%s).then(r=>r.text)" % json.dumps(bk[0]['path']))) == orig if bk else False)
            put = lambda t: ev("window.__put(%s, %s)" % (J, json.dumps(t)))
            await put('EXTERNAL VERSION\n'); await put('EXTERNAL VERSION\n'); await add('LOCAL-2'); await wait(200)
            pr = asyncio.ensure_future(ev("ChipBench.app.save(ChipBench.app.current())")); await pg.wait_for_selector('.modal', timeout=5000)
            txt = await ev("document.querySelector('.modal').innerText"); chk('conflict dialog is shown', '被其他程序修改' in txt, txt)
            await pg.click('.modal button:has-text("取消")'); r = await pr
            chk('cancel: save returns false, external version kept', r is False and await ev("window.__FS[%s].t" % J) == 'EXTERNAL VERSION\n')
            chk('tab stays dirty after cancel', await ev("ChipBench.app.current().dirty") is True)
            r = await ev("ChipBench.app.save(ChipBench.app.current(), true)"); chk('auto-save refuses to overwrite a conflicting file', r is False and await ev("window.__FS[%s].t" % J) == 'EXTERNAL VERSION\n')
            pr = asyncio.ensure_future(ev("ChipBench.app.save(ChipBench.app.current())")); await pg.wait_for_selector('.modal', timeout=5000)
            await pg.click('.modal button:has-text("覆盖保存")'); r = await pr; await wait(300)
            chk('overwrite: content written', r is True and 'LOCAL-2' in await ev("window.__FS[%s].t" % J))
            bk = await ev("ChipBench.safe.list(%s)" % J); texts = [await ev("ChipBench.fs.read(%s).then(r=>r.text)" % json.dumps(x['path'])) for x in bk]
            chk('overwrite: the external version was backed up first', 'EXTERNAL VERSION\n' in texts, texts)
            await add('LOCAL-3'); await wait(200); chk('no false conflict after our own save', await ev("ChipBench.app.save(ChipBench.app.current())") is True)
            cur = await ev("window.__FS[%s].t" % J); await put(cur); await put(cur); await add('LOCAL-4'); await wait(200)
            chk('touch-only mtime change (same content) is not a conflict', await ev("ChipBench.app.save(ChipBench.app.current())") is True and not await ev("document.querySelector('.modal')"))
            pr_ = await ev("ChipBench.safe._.prune(Array.from({length:15},(_, i)=>'20261029-1000'+String(i).padStart(2,'0')+'-a.md'), 12)"); chk('prune deletes the 3 oldest', pr_ == ['20261029-100002-a.md', '20261029-100001-a.md', '20261029-100000-a.md'], pr_)
            await ev("(ChipBench.safe.restoreDialog(%s), 1)" % J); await wait(500); chk('restore dialog lists backups', await ev("document.querySelectorAll('.bk-row').length") >= 2)
            await pg.keyboard.press('Escape'); await wait(200)
            await add('TYPED-LIVE'); await wait(150)
            await ev("ChipBench.app.activate(ChipBench.app.cur)"); await wait(500); chk('activate(current tab) keeps unsaved typing (1.6.1 dropped it)', 'TYPED-LIVE' in await ev("ChipBench.app.ed.value"))
            await ev("ChipBench.openPath(%s)" % J); await wait(500); chk('openPath(already-open file) keeps unsaved typing', 'TYPED-LIVE' in await ev("ChipBench.app.ed.value"))
            chk('no console errors', not errs, errs[:3])
            await b.close()
    print(json.dumps({'passed': sum(R.values()), 'total': len(R), 'fails': fails}, ensure_ascii=False))
    raise SystemExit(1 if fails else 0)
asyncio.run(main())
