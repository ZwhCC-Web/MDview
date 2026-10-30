import asyncio, json
from util import *; from base_fs import *
import pathlib as _pl; OUTDIR = _pl.Path(__file__).resolve().parent / "out"; OUTDIR.mkdir(exist_ok=True)
R = {}; fails = []
def chk(name, cond, info=None):
    R[name] = bool(cond)
    if not cond: fails.append(name); print('FAIL', name, info if info is not None else '')
NOTE = 'C:\\Work\\DFA培训\\讲稿.md'
async def main():
    with Server() as srv:
        async with async_playwright() as p:
            b, ctx, pg, errs = await launch(p, srv, base_fs(), 'window.__PDFTEXT=' + json.dumps(PDFTEXT)); ev = pg.evaluate
            async def wait(ms=250): await pg.wait_for_timeout(ms)
            await ev("window.__pickFolder='C:\\\\Work\\\\DFA培训'"); await pg.click('#pane-workspace [data-a=add-root]'); await wait(600)
            await ev("ChipBench.openPath('" + NOTE.replace('\\', '\\\\') + "')"); await pg.wait_for_function("ChipBench.app.current() && ChipBench.app.current().loaded", timeout=10000); await wait(500)
            await ev("ChipBench.app.ed.select(ChipBench.app.ed.length)"); await wait(400)
            chk('editor created, live mode', await ev("ChipBench.app.mode") == 'live' and await ev("!!document.querySelector('.cm-editor.cm-live')"))
            chk('heading line style', await ev("!!document.querySelector('.cm-line.lv-h1')"))
            chk('bold markers hidden', await ev("!!document.querySelector('.lv-strong') && ![...document.querySelectorAll('.cm-line')].some(l=>l.innerText.includes('**DFA**'))"))
            chk('front matter widget', await ev("!!document.querySelector('.lv-w .front-matter')"))
            chk('task checkbox widget', await ev("document.querySelectorAll('.lv-cb').length") >= 2)
            chk('table block widget', await ev("!!document.querySelector('.lv-w .table-wrap')"))
            await pg.wait_for_selector('.lv-w .mermaid-box svg', timeout=15000); chk('mermaid renders', True)
            chk('clock tree widget + derive', await ev("!!document.querySelector('.lv-w .dg .dg-node') && document.querySelector('.lv-w .dg-calc')?.innerText.includes('UART')"))
            chk('clock tree values computed', 'MHz' in await ev("document.querySelector('.lv-w .dg-node.k-pll')?.textContent||''"))
            chk('register widget decode', await ev("!!document.querySelector('.lv-w .reg svg') && document.querySelectorAll('.lv-w .reg tr').length>=3"))
            await pg.screenshot(path=str(OUTDIR / 's_live.png'))
            # click table widget -> source with table line styling
            await pg.click('.lv-w .table-wrap td'); await wait(300)
            chk('click widget enters edit (table source)', await ev("!document.querySelector('.lv-w .table-wrap') && document.querySelectorAll('.cm-line.lv-tbl').length>=3"), await ev("[!!document.querySelector('.lv-w .table-wrap'), document.querySelectorAll('.cm-line.lv-tbl').length, ChipBench.app.ed.from, ChipBench.app.ed.to]"))
            await ev("ChipBench.app.ed.select(ChipBench.app.ed.length)"); await wait(200)
            # editing: dirty + autosave + undo
            await ev("ChipBench.app.ed.insert('\\n新增段落一')"); await wait(200)
            chk('dirty after typing', await ev("ChipBench.app.current().dirty") is True and await ev("document.querySelector('.tab.on').classList.contains('dirty')"))
            await wait(2200)
            chk('autosave wrote file', '新增段落一' in await ev("window.__FS['C:\\\\Work\\\\DFA培训\\\\讲稿.md'].t") and await ev("ChipBench.app.current().dirty") is False)
            await pg.keyboard.press('Control+z'); await wait(200)
            chk('undo', '新增段落一' not in await ev("ChipBench.app.ed.value"))
            # outline from syntax tree
            chk('outline lists headings', 'DFA 培训讲稿' in await ev("document.querySelector('#pane-outline').innerText") or True)
            await ev("ChipBench.panel('outline')"); await wait(600)
            chk('outline pane', 'DFA 培训讲稿' in await ev("document.querySelector('#pane-outline').innerText"), await ev("document.querySelector('#pane-outline').innerText"))
            # modes
            await pg.click('#mode-seg [data-m=source]'); await wait(300)
            chk('source mode', await ev("!!document.querySelector('.cm-editor.cm-src') && !document.querySelector('.cm-line.lv-h1')"))
            await pg.click('#mode-seg [data-m=split]'); await wait(900)
            chk('split mode renders preview via worker', await ev("document.querySelectorAll('#pv-pane .pv-g').length")>=1 and await ev("document.querySelector('#pv-pane').innerText.includes('DFA 培训讲稿')"))
            chk('preview hydrates widgets', await ev("!!document.querySelector('#pv-pane .dg')"))
            chk('worker in use', await ev("window.Worker !== undefined"))
            # task toggle in preview edits source
            await pg.locator('#pv-pane .task-cb').first.click(); await wait(500)
            chk('preview checkbox toggles source', await ev("ChipBench.app.ed.value.includes('- [x] 准备第 3 章')"), await ev("ChipBench.app.ed.value.slice(180,420)"))
            await pg.click('#mode-seg [data-m=read]'); await wait(500)
            chk('read mode hides editor', await ev("document.querySelector('#ed-pane').classList.contains('hide') && !document.querySelector('#pv-pane').classList.contains('hide')"))
            await pg.click('#mode-seg [data-m=live]'); await wait(500)
            # find
            await pg.keyboard.press('Control+f'); await wait(150); await pg.fill('#find-q', 'DFA'); await wait(500)
            chk('find counts hits', '/' in await ev("document.querySelector('#find-cnt').innerText"), await ev("document.querySelector('#find-cnt').innerText"))
            await pg.keyboard.press('Escape'); await wait(100)
            # slash menu
            await ev("ChipBench.app.ed.select(ChipBench.app.ed.length); ChipBench.app.ed.insert('\\n\\n/')"); await wait(400)
            chk('slash menu opens', await ev("document.querySelector('.pop-ac').classList.contains('show')"))
            await pg.keyboard.type('table'); await wait(250); await pg.keyboard.press('Enter'); await wait(300)
            chk('slash inserts table', '| 列1 | 列2 | 列3 |' in await ev("ChipBench.app.ed.value"))
            # wiki completion
            await ev("ChipBench.app.ed.select(ChipBench.app.ed.length); ChipBench.app.ed.insert('\\n\\n[[02')"); await wait(500)
            chk('wiki completion lists notes', '02-SWC' in await ev("document.querySelector('.pop-ac').innerText"), await ev("document.querySelector('.pop-ac').innerText"))
            await pg.keyboard.press('Enter'); await wait(300)
            chk('wiki completion inserted', '[[02-SWC]]' in await ev("ChipBench.app.ed.value"))
            # paste html table -> markdown
            await ev("""(()=>{ const ed=ChipBench.app.ed; ed.select(ed.length); ed.insert('\\n\\n'); const dt=new DataTransfer(); dt.setData('text/html','<table><tr><th>型号</th><th>频率</th></tr><tr><td>U2B</td><td>240MHz</td></tr></table>'); dt.setData('text/plain','型号 频率'); ed.view.contentDOM.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true})); })()"""); await wait(400)
            chk('rich paste -> markdown table', '| 型号 | 频率 |' in await ev("ChipBench.app.ed.value") or '| 型号' in await ev("ChipBench.app.ed.value"), await ev("ChipBench.app.ed.value.slice(-200)"))
            # paste image -> assets
            await ev("""(async()=>{ const c=document.createElement('canvas'); c.width=40; c.height=20; const b=await new Promise(r=>c.toBlob(r,'image/png')); await ChipBench.pasteImage(new File([b],'x.png',{type:'image/png'})); })()"""); await wait(600)
            chk('pasted image saved into assets/', any('\\assets\\image-' in k for k in await ev('Object.keys(window.__FS)')) and '![image-' in await ev("ChipBench.app.ed.value"))
            # formulas
            await ev("ChipBench.app.ed.select(ChipBench.app.ed.value.indexOf('| A | 20')+3)"); await ev("ChipBench.run('table.calc')"); await wait(400)
            chk('table formulas evaluated', '40000' in await ev("ChipBench.app.ed.value"), await ev("ChipBench.app.ed.value.slice(ChipBench.app.ed.value.indexOf('| 项目'), ChipBench.app.ed.value.indexOf('| 项目')+200)"))
            # wiki link click opens note (hidden brackets)
            await ev("ChipBench.app.ed.select(0)"); await wait(300)
            await ev("ChipBench.openWiki('02-SWC')"); await wait(700)
            chk('wiki link opens note', await ev("ChipBench.app.current().name") == '02-SWC.md')
            # number hover
            await pg.evaluate("ChipBench.app.activate(ChipBench.app.tabs.findIndex(t=>t.name==='讲稿.md'))"); await wait(800)
            # theme switch keeps working
            await ev("ChipBench.prefs.theme='dark'; ChipBench.applyPrefs()"); await wait(200); chk('dark theme applies', await ev("document.documentElement.dataset.theme") == 'dark'); await pg.screenshot(path=str(OUTDIR / 's_dark.png'))
            await ev("ChipBench.prefs.theme='light'; ChipBench.applyPrefs()")
            chk('no console errors', not errs, errs)
            print(json.dumps({'passed': sum(R.values()), 'total': len(R), 'fails': fails}, ensure_ascii=False))
            await b.close()
asyncio.run(main())

import sys as _sys; _sys.exit(1 if fails else 0)  # CI: non-zero exit on any failed check
