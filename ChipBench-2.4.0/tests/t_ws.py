import asyncio, json
from util import *; from base_fs import *
import pathlib as _pl; OUTDIR = _pl.Path(__file__).resolve().parent / "out"; OUTDIR.mkdir(exist_ok=True)
R = {}; fails = []
def chk(name, cond, info=None):
    R[name] = bool(cond)
    if not cond: fails.append(name); print('FAIL', name, info if info is not None else '')
async def main():
    with Server() as srv:
        async with async_playwright() as p:
            b, ctx, pg, errs = await launch(p, srv, base_fs(), 'window.__PDFTEXT=' + json.dumps(PDFTEXT)); ev = pg.evaluate
            async def wait(ms=250): await pg.wait_for_timeout(ms)
            # --- add roots (and reject nesting)
            await ev("window.__pickFolder='C:\\\\Work\\\\DFA培训'"); await pg.click('#pane-workspace [data-a=add-root]'); await wait(500)
            chk('root added', await ev('ChipBench.ws.cur.roots.length') == 1)
            chk('tree shows root', 'DFA培训' in await ev("document.querySelector('#ws-body').innerText"))
            await wait(300)
            names = await ev("[...document.querySelectorAll('#ws-body .ws-row .nm')].map(n=>n.innerText)")
            chk('root expands (dirs first)', names[:3] == ['DFA培训', '章节', '资料'] or names[1:3] == ['章节', '资料'], names)
            await ev("window.__pickFolder='C:\\\\Work\\\\DFA培训\\\\章节'"); await pg.click('#side-actions [data-a=add]'); await pg.click('.menu-pop [data-k=add-root]'); await wait(300)
            chk('nested root rejected', await ev('ChipBench.ws.cur.roots.length') == 1)
            await ev("window.__pickFolder='D:\\\\Share'"); await pg.click('#side-actions [data-a=add]'); await pg.click('.menu-pop [data-k=add-root]'); await wait(400)
            chk('second root (other drive)', await ev('ChipBench.ws.cur.roots.length') == 2)
            # index built from roots
            await pg.wait_for_function('ChipBench.index.docs.size >= 7', timeout=8000)
            chk('index covers roots', await ev('ChipBench.index.docs.size') >= 7, await ev('ChipBench.index.docs.size'))
            # open a file from the tree
            await pg.click('.ws-row[data-t=dir] >> text=章节'); await wait(200)
            await pg.click('.ws-row[data-t=file]:has-text("02-SWC.md")'); await pg.wait_for_function("ChipBench.app.current() && ChipBench.app.current().loaded", timeout=8000)
            chk('opens note from tree', await ev('ChipBench.app.current().name') == '02-SWC.md')
            chk('active row highlighted', await ev("!!document.querySelector('#ws-body .row-i.on')"))
            chk('breadcrumb shows root name', 'DFA培训' in await ev("document.querySelector('#crumbs .bc').innerText"))
            # filter across roots (index based)
            await pg.fill('#ws-q', 'swc'); await wait(300)
            chk('filter finds file', (await ev("[...document.querySelectorAll('#ws-body .ws-row .nm')].map(n=>n.innerText).join()")).startswith('02-SWC'))
            await pg.fill('#ws-q', '')
            # collections: groups + refs from several places + multi membership
            await pg.click('#ws-views [data-v=collections]'); await wait(150)
            await ev("window.__pickAny=['C:\\\\Work\\\\DFA培训\\\\讲稿.md','D:\\\\Share\\\\A公司\\\\问题跟踪.md','C:\\\\Work\\\\客户\\\\emb.map']")
            await pg.click('#side-actions [data-a=add]'); await pg.click('.menu-pop [data-k=add-files]'); await wait(500)
            chk('refs added from 2 drives', await ev('ChipBench.W.stats(ChipBench.ws.cur).files') == 3)
            await pg.click('#side-actions [data-a=add]'); await pg.click('.menu-pop [data-k=add-group]'); await wait(200)
            await pg.fill('.modal input', '样品跟进'); await pg.click('.modal-f .primary'); await wait(300)
            chk('group created', await ev("ChipBench.ws.cur.collections.some(n=>n.type==='group'&&n.name==='样品跟进')"))
            await pg.locator('.ws-row[data-t=ref]', has_text='问题跟踪').drag_to(pg.locator('.ws-row[data-t=group]', has_text='样品跟进'), target_position={'x': 60, 'y': 14}); await wait(300)
            chk('drag ref into group', await ev("ChipBench.ws.cur.collections.find(n=>n.name==='样品跟进').children.length") == 1)
            await pg.keyboard.down('Control'); await pg.locator('.ws-row[data-t=ref]', has_text='讲稿').drag_to(pg.locator('.ws-row[data-t=group]', has_text='样品跟进'), target_position={'x': 60, 'y': 14}); await pg.keyboard.up('Control'); await wait(300)
            chk('ctrl-drag copies (multi-membership)', await ev("ChipBench.W.membership(ChipBench.ws.cur,'C:\\\\Work\\\\DFA培训\\\\讲稿.md').length") == 2, await ev("ChipBench.W.membership(ChipBench.ws.cur,'C:\\\\Work\\\\DFA培训\\\\讲稿.md')"))
            chk('multi-membership chip', await ev("!!document.querySelector('#ws-body .chip.brand')"))
            # alias via context menu
            await pg.locator('.ws-row[data-t=ref]', has_text='emb.map').click(button='right'); await pg.click('.menu-pop [data-k=rename]'); await pg.fill('.modal input', '链接脚本占用'); await pg.click('.modal-f .primary'); await wait(250)
            chk('alias shown', '链接脚本占用' in await ev("document.querySelector('#ws-body').innerText"))
            # open non-md ref in viewer
            await pg.locator('.ws-row[data-t=ref]', has_text='链接脚本占用').click(); await pg.wait_for_function("ChipBench.app.current().kind==='view'", timeout=8000); await wait(300)
            chk('map opens in viewer', await ev('ChipBench.app.current().view') == 'map' and await ev("!!document.querySelector('.view-host:not(.hide) .mem')"))
            # layout snapshot + switch workspace restores tabs
            await pg.click('#ws-views [data-v=roots]'); await wait(100)
            ids_before = await ev('ChipBench.app.tabs.map(t=>t.name).join()')
            await ev('ChipBench.ws.captureLayout()'); await wait(700)
            await pg.click('#pane-workspace [data-a=menu]'); await pg.click('.menu-pop [data-k=new]'); await pg.fill('.modal input', '客户 B'); await pg.click('.modal-f .primary'); await wait(700)
            chk('new workspace is empty', await ev('ChipBench.ws.cur.name') == '客户 B' and await ev('ChipBench.ws.cur.roots.length') == 0)
            await pg.click('#pane-workspace [data-a=menu]'); await wait(150); await pg.click('.menu-pop .mi:has-text("我的项目")'); await wait(1500)
            chk('switch restores tabs', await ev('ChipBench.ws.cur.name') == '我的项目' and await ev('ChipBench.app.tabs.map(t=>t.name).join()') == ids_before, [ids_before, await ev('ChipBench.app.tabs.map(t=>t.name).join()')])
            # missing + repoint root
            await ev("(()=>{ const fs=window.__FS; Object.keys(fs).forEach(k=>{ if(k.toLowerCase().startsWith('d:\\\\share')) { fs['D:\\\\Moved'+k.slice(8)]=fs[k]; delete fs[k]; } }); fs['D:\\\\Moved']={dir:1}; })()")
            await pg.click('#side-actions [data-a=refresh]'); await wait(500)
            chk('missing detected', await ev('ChipBench.ws.missing.size') >= 1, await ev('ChipBench.ws.missing.size'))
            await ev("window.__pickFolder='D:\\\\Moved'"); await pg.click('#ws-views [data-v=roots]'); await wait(300); await pg.locator('.ws-row.root-h.miss').first.click(); await wait(600)
            chk('repoint root heals refs', await ev('ChipBench.ws.missing.size') == 0 and await ev("ChipBench.W.refPath(ChipBench.ws.cur, ChipBench.W.findRef(ChipBench.ws.cur,'D:\\\\Moved\\\\A公司\\\\问题跟踪.md'))") == 'D:\\Moved\\A公司\\问题跟踪.md', await ev('[...ChipBench.ws.missing]'))
            # portable project file
            await ev("window.__saveTo='C:\\\\Work'"); await pg.click('#pane-workspace [data-a=menu]'); await pg.click('.menu-pop [data-k=save-project]'); await wait(500)
            f = json.loads(await ev("window.__FS['C:\\\\Work\\\\我的项目.cbws'].t")); chk('portable file uses relative paths', f.get('portable') and all('..' in r['path'] or not r['path'][1] == ':' for r in f['roots']), f['roots'])
            # persistence
            await wait(800); chk('workspace persisted', any(k.endswith('.cbws') for k in await ev('Object.keys(window.__FS)')))
            # palette quick open
            await pg.keyboard.press('Control+p'); await wait(300); await pg.keyboard.type('swc'); await wait(300)
            chk('quick open lists file', '02-SWC' in await ev("document.querySelector('.palette .pal-list').innerText"))
            await pg.keyboard.press('Escape'); await wait(100)
            await pg.screenshot(path=str(OUTDIR / 's_ws.png'))
            chk('no console errors', not errs, errs)
            print(json.dumps({'passed': sum(R.values()), 'total': len(R), 'fails': fails}, ensure_ascii=False))
            await b.close()
asyncio.run(main())

import sys as _sys; _sys.exit(1 if fails else 0)  # CI: non-zero exit on any failed check
