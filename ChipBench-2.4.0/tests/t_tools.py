import asyncio, json, zipfile, io, base64
from util import *; from base_fs import *
from t_features_shared import AIFETCH
R = {}; fails = []
def chk(name, cond, info=None):
    R[name] = bool(cond)
    print('  ok ' if cond else '  FAIL', name, '' if cond else (info if info is not None else ''), flush=True)
    if not cond: fails.append(name)
NOTE = 'C:\\Work\\DFA培训\\讲稿.md'
def zip_names(b64s): return zipfile.ZipFile(io.BytesIO(base64.b64decode(b64s))).namelist()
async def main():
    with Server() as srv:
        async with async_playwright() as p:
            b, ctx, pg, errs = await launch(p, srv, base_fs(), 'window.__PDFTEXT=' + json.dumps(PDFTEXT) + ';' + AIFETCH + "window.__saveTo='C:\\\\Out';"); ev = pg.evaluate
            async def wait(ms=300): await pg.wait_for_timeout(ms)
            await ev("window.__pickFolder='C:\\\\Work\\\\DFA培训'"); await pg.click('#pane-workspace [data-a=add-root]'); await pg.wait_for_function('ChipBench.index.docs.size>=5', timeout=8000)
            await ev("ChipBench.openPath('" + NOTE.replace('\\', '\\\\') + "')"); await pg.wait_for_function("ChipBench.app.current() && ChipBench.app.current().loaded", timeout=10000); await wait(900)
            # ---------- AI chat
            # ---------- exports
            await ev("ChipBench.run('export.html')"); await wait(2500)
            html = await ev("(window.__FS['C:\\\\Out\\\\讲稿.html']||{}).t||''"); chk('export html (self-contained)', '<!DOCTYPE html>' in html and 'DFA' in html and '<svg' in html, len(html))
            await ev("ChipBench.run('export.docx')"); await wait(4000)
            f = await ev("window.__FS['C:\\\\Out\\\\讲稿.docx']"); chk('export docx is a valid package', bool(f) and 'word/document.xml' in zip_names(f['b']), bool(f))
            if f:
                z = zipfile.ZipFile(io.BytesIO(base64.b64decode(f['b']))); doc = z.read('word/document.xml').decode()
                chk('docx content: heading + table + image', 'DFA 培训讲稿' in doc and '<w:tbl>' in doc and ('<w:drawing>' in doc))
            await ev("ChipBench.app.ed.replace(0, ChipBench.app.ed.length, '# 第一页\\n\\n- 要点 A\\n- 要点 B\\n\\n<!-- notes: 讲稿备注 -->\\n\\n---\\n\\n# 第二页\\n\\n| 列1 | 列2 |\\n| --- | --- |\\n| 1 | 2 |\\n', 0)"); await wait(400)
            await ev("ChipBench.run('export.pptx')"); await wait(3500)
            f = await ev("window.__FS['C:\\\\Out\\\\讲稿.pptx']"); chk('export pptx valid + 2 slides + notes', bool(f) and len([n for n in zip_names(f['b']) if n.startswith('ppt/slides/slide') and n.endswith('.xml')]) == 2 and any('notesSlide' in n for n in zip_names(f['b'])), zip_names(f['b'])[:12] if f else None)
            await ev("ChipBench.run('export.eml')"); await wait(300); await pg.fill('.modal input', 'a@b.com'); await pg.click('.modal-f .primary'); await wait(2000)
            chk('outlook draft .eml written + opened', 'X-Unsent: 1' in (await ev("(window.__FS['C:\\\\Temp\\\\讲稿.eml']||{}).b ? atob(window.__FS['C:\\\\Temp\\\\讲稿.eml'].b) : ''")))
            # ---------- presenter
            await ev("ChipBench.run('present')"); await pg.wait_for_selector('.present .pr-slide h1', timeout=5000); await wait(300)
            chk('presenter shows slide 1', '第一页' in await ev("document.querySelector('.pr-slide').innerText"))
            await pg.keyboard.press('ArrowRight'); await wait(500); chk('presenter next slide', '第二页' in await ev("document.querySelector('.pr-slide').innerText"))
            await pg.keyboard.press('s'); await wait(200); chk('presenter view (notes)', not await ev("document.querySelector('.pr-side').classList.contains('hide')"))
            await pg.keyboard.press('Escape'); await wait(300); chk('presenter closes', await ev("!document.querySelector('.present')"))
            # ---------- history
            await ev("ChipBench.history.last={}"); await ev("ChipBench.app.ed.replace(0, ChipBench.app.ed.length, '# 版本一\\n\\n内容 A\\n', 0)"); await ev("ChipBench.app.save()"); await wait(500)
            await ev("ChipBench.history.last={}"); await ev("ChipBench.app.ed.replace(0, ChipBench.app.ed.length, '# 版本二\\n\\n内容 B\\n', 0)"); await ev("ChipBench.app.save()"); await wait(500)
            await ev("void ChipBench.run('history.open')"); await pg.wait_for_selector('.hist .row-i', timeout=5000); await wait(300)
            chk('history lists versions', await ev("document.querySelectorAll('.hist .row-i').length")>=2)
            await pg.click('.hist .row-i:nth-child(2)'); await wait(250)
            chk('history diff vs current', await ev("document.querySelectorAll('.hist .dl.add, .hist .dl.del').length")>0)
            await pg.click('.modal-f .primary'); await wait(400)
            chk('history restore', '版本一' in await ev("ChipBench.app.ed.value"))
            # ---------- compare
            await ev("window.__pickFiles=['C:\\\\Work\\\\DFA培训\\\\章节\\\\01-背景.md']"); await ev("void ChipBench.run('compare')"); await pg.wait_for_selector('.cmp .cr', timeout=5000)
            chk('compare shows differences', await ev("document.querySelectorAll('.cmp .cr.del, .cmp .cr.add, .cmp .cr.chg').length")>0); await pg.keyboard.press('Escape'); await wait(200)
            # ---------- annotate
            await ev("""(async()=>{ const c=document.createElement('canvas'); c.width=300;c.height=200; const g=c.getContext('2d'); g.fillStyle='#fff'; g.fillRect(0,0,300,200); const b=await new Promise(r=>c.toBlob(r,'image/png')); ChipBench.annotate(b); })()"""); await pg.wait_for_selector('.anno-box canvas', timeout=5000); await wait(400)
            box = await ev("(()=>{const r=document.querySelector('.anno-box canvas').getBoundingClientRect(); return [r.x,r.y,r.width,r.height]})()")
            await pg.mouse.move(box[0]+30, box[1]+30); await pg.mouse.down(); await pg.mouse.move(box[0]+150, box[1]+100, steps=4); await pg.mouse.up()
            await pg.click('.anno-box [data-t=arrow]'); await pg.mouse.move(box[0]+200, box[1]+150); await pg.mouse.down(); await pg.mouse.move(box[0]+160, box[1]+110, steps=4); await pg.mouse.up()
            chk('annotator draws shapes', await ev("ChipBench.annotated.shapes.map(s=>s.t).join()") == 'rect,arrow'); await pg.click('.modal-f .primary'); await wait(1200)
            chk('annotated image inserted into note (assets)', any('annotated' in k or '\\assets\\image-' in k for k in await ev('Object.keys(window.__FS)')))
            # ---------- quick capture
            await ev("ChipBench.ws.cur.settings.journal='C:\\\\Work\\\\日志'"); await pg.keyboard.press('Control+Alt+n'); await pg.wait_for_selector('#cp-t', timeout=4000); await pg.fill('#cp-t', '随手记：样品已寄出'); await pg.keyboard.press('Control+Enter'); await wait(900)
            jp = [k for k in await ev('Object.keys(window.__FS)') if '\\日志\\' in k and k.endswith('.md')]; chk('quick capture appends to today journal', len(jp) == 1 and '样品已寄出' in await ev("window.__FS[%s].t" % json.dumps(jp[0])), jp)
            await ev("window.__listeners['quick-capture'] && window.__listeners['quick-capture']({payload:null})"); await wait(500); chk('global hot key event opens capture', await ev("!!document.querySelector('#cp-t')")); await pg.keyboard.press('Escape'); await wait(200)
            # ---------- whiteboard
            await ev("void ChipBench.run('board.new')"); await wait(300); await pg.fill('.modal input', '系统框图'); await pg.click('.modal-f .primary'); await pg.wait_for_selector('.brd-canvas svg', timeout=8000); await wait(400)
            cb = await ev("(()=>{const r=document.querySelector('.view-host:not(.hide) .brd-canvas').getBoundingClientRect(); return [r.x,r.y]})()")
            await pg.click('.view-host:not(.hide) [data-t=rect]'); await pg.mouse.move(cb[0]+100, cb[1]+100); await pg.mouse.down(); await pg.mouse.move(cb[0]+260, cb[1]+180, steps=5); await pg.mouse.up(); await wait(300)
            await pg.click('.view-host:not(.hide) [data-t=arrow]'); await pg.mouse.move(cb[0]+260, cb[1]+140); await pg.mouse.down(); await pg.mouse.move(cb[0]+420, cb[1]+140, steps=5); await pg.mouse.up(); await wait(1200)
            bf = [k for k in await ev('Object.keys(window.__FS)') if k.endswith('.cbboard')]; chk('whiteboard saves shapes to .cbboard', len(bf) == 1 and len(json.loads(await ev("window.__FS[%s].t" % json.dumps(bf[0])))['shapes']) == 2, bf)
            await ev("ChipBench.app.activate(ChipBench.app.tabs.findIndex(t=>t.kind==='md'))"); await wait(800); chk('board block embedded in note', '```board' in await ev("ChipBench.app.ed.value"))
            # ---------- dialogs / commands
            await pg.keyboard.press('Control+,'); await wait(300); chk('preferences dialog', '偏好设置' in await ev("document.querySelector('.modal-h').innerText"))
            await ev("document.querySelector('.modal select[data-k=theme]').value='graphite'; document.querySelector('.modal select[data-k=theme]').dispatchEvent(new Event('change',{bubbles:true}))"); await wait(200); chk('theme graphite', await ev("document.documentElement.dataset.theme") == 'graphite'); await pg.click('.modal-f .primary'); await wait(200)
            await ev("ChipBench.prefs.theme='light'; ChipBench.applyPrefs()")
            await pg.keyboard.press('F1'); await wait(300); sk = await ev("document.querySelector('.modal').innerText"); chk('shortcut help lists commands (2.1: searchable sheet shows keys as "Ctrl + S")', 'Ctrl + S' in sk or 'Ctrl+S' in sk, sk[:80]); await pg.keyboard.press('Escape')
            await ev("void ChipBench.run('about')"); await wait(300); chk('about dialog (product name)', 'ChipBench' in await ev("document.querySelector('.modal').innerText") and 'Typora' not in await ev("document.body.innerText")); await pg.keyboard.press('Escape')
            await ev("void ChipBench.run('mcp.info')"); await wait(300); chk('MCP dialog', 'chipbench_mcp.py' in await ev("document.querySelector('.modal').innerText")); await pg.keyboard.press('Escape')
            await ev("ChipBench.app.ed.replace(0, ChipBench.app.ed.length, '# 标题\\n\\n# 标题\\n\\n[[不存在的笔记]] TODO 修复\\n', 0)"); await ev("void ChipBench.run('doc.check')"); await wait(600); chk('document check finds issues', await ev("document.querySelectorAll('.modal .row-i').length")>=3); await pg.keyboard.press('Escape')
            await pg.keyboard.press('Control+Shift+p'); await wait(300); await pg.keyboard.type('时钟'); await wait(300); chk('command palette', '时钟树' in await ev("document.querySelector('.palette .pal-list').innerText")); await pg.keyboard.press('Escape')
            await pg.keyboard.press('Control+p'); await pg.keyboard.type('=0xFF<<4|3'); await wait(300); chk('palette calculator', '4083' in await ev("document.querySelector('.palette .pal-list').innerText")); await pg.keyboard.press('Escape')
            await ev("void ChipBench.run('calc')"); await wait(300); await pg.fill('#cl', '0x3F00'); await wait(200); chk('number converter', '16128' in await ev("document.querySelector('.modal').innerText")); await pg.keyboard.press('Escape')
            await ev("void ChipBench.run('timing')"); await wait(400); chk('timing calculator (UART + CAN)', 'UART' in await ev("document.querySelector('.modal').innerText") and '采样点' in await ev("document.querySelector('.modal').innerText")); await pg.keyboard.press('Escape')
            chk('MCP state published', await ev("!!window.__state && window.__state.app==='ChipBench'"))
            chk('commands registered', await ev("ChipBench.commands.size") > 100)
            chk('no console errors', not errs, errs[:3])
            print(json.dumps({'passed': sum(R.values()), 'total': len(R), 'fails': fails}, ensure_ascii=False))
            await b.close()
asyncio.run(main())

import sys as _sys; _sys.exit(1 if fails else 0)  # CI: non-zero exit on any failed check
