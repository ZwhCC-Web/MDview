"""3.1 modules against the REAL 3.0 application (mock desktop): format toolbar, PPTX viewer, HTML viewer, panels, help hub, routing.
Run:  python tests/t_modules.py"""
import asyncio, json
from util import *; from base_fs import *
R = {}; fails = []
def chk(name, cond, info=None):
    R[name] = bool(cond); print('  ok ' if cond else '  FAIL', name, flush=True) if cond else None
    if not cond: fails.append(name); print('FAIL', name, info if info is not None else '', flush=True)
P = lambda s: 'C:\\Work\\' + s
NOTE = P('DFA培训\\讲稿.md')
HTML = P('DFA培训\\资料\\页面.html')
async def main():
    with Server() as srv:
        async with async_playwright() as p:
            fs = base_fs()
            fs['C:\\Users\\me\\.chipbench\\cache\\office\\培训.pptx.pdf'] = {'b': b64(F / 'manual.pdf')}
            fs[HTML] = {'t': '<!doctype html><html><head><meta charset=utf-8><title>页面</title><link rel=stylesheet href="assets/s.css"></head><body><h1 id=h>标题</h1><p id=out>no</p><script src="assets/a.js"></script></body></html>'}
            fs[P('DFA培训\\资料\\assets\\s.css')] = {'t': 'h1{color:rgb(0,128,0)}'}
            fs[P('DFA培训\\资料\\assets\\a.js')] = {'t': "document.getElementById('out').textContent='script-ran'"}
            fs[P('DFA培训\\资料\\assets')] = {'dir': 1}
            b, ctx, pg, errs = await launch(p, srv, fs, 'window.__PDFTEXT=' + json.dumps(PDFTEXT)); ev = pg.evaluate
            async def wait(ms=300): await pg.wait_for_timeout(ms)
            await ev("window.__pickFolder='C:\\\\Work\\\\DFA培训'"); await pg.click('.btn[data-a=add-root]'); await wait(300)
            chk('3.1 modules loaded', await ev("!!(ChipBench.s31 && ChipBench.s31.version && ChipBench.s31.toolbar && ChipBench.s31.pptx && ChipBench.s31.html)"), await ev("ChipBench.s31 && Object.keys(ChipBench.s31)"))
            # ---------------- format toolbar on the real editor
            await ev("ChipBench.openPath('" + NOTE.replace('\\', '\\\\') + "')"); await pg.wait_for_function("ChipBench.app.current() && ChipBench.app.current().loaded", timeout=10000); await wait(600)
            chk('toolbar: present + visible for a note', await ev("(()=>{const r=document.getElementById('fmtrow'); return !!r && !r.classList.contains('hide') && r.offsetHeight>20})()"))
            async def setd(doc, a, b=None):
                await pg.evaluate("([d,a,b])=>{const ed=ChipBench.app.ed; ed.value=d; ed.select(a,b==null?a:b)}", [doc, a, b]); await wait(120)
            val = lambda: ev("ChipBench.app.ed.value")
            click = lambda a: pg.click('#fmtrow button[data-a="%s"]' % a)
            for act, mk in (('bold', '**'), ('italic', '*'), ('strike', '~~'), ('mark', '=='), ('code', '`')):
                await setd('say hello now', 4, 9); await click(act); a = await val() == 'say %shello%s now' % (mk, mk); await click(act); chk('toolbar: %s wraps and toggles off' % act, a and await val() == 'say hello now', await val())
            await setd('see text here', 4, 8); await click('link'); chk('toolbar: link', await val() == 'see [text]() here', await val())
            await setd('first line\nsecond', 3); await click('heading'); await pg.click('.fmt-menu .mi[data-v="2"]'); await wait(150)
            chk('toolbar: heading 2 + label', await val() == '## first line\nsecond' and await ev("document.querySelector('#fmtrow .hl').textContent") == '标题 2', [await val(), await ev("document.querySelector('#fmtrow .hl').textContent")])
            await click('heading'); await pg.click('.fmt-menu .mi[data-v="0"]'); chk('toolbar: heading 0 -> paragraph', await val() == 'first line\nsecond', await val())
            await setd('a\nb\nc', 0, 5); await click('ul'); a = await val() == '- a\n- b\n- c'; await click('ul'); chk('toolbar: bullet list on / off', a and await val() == 'a\nb\nc', await val())
            await setd('a\nb\nc', 0, 5); await click('ol'); chk('toolbar: numbered list', await val() == '1. a\n2. b\n3. c', await val())
            await setd('- a\n- b', 0, 7); await click('task'); chk('toolbar: list -> task', await val() == '- [ ] a\n- [ ] b', await val())
            await setd('q1\nq2', 0, 5); await click('quote'); a = await val() == '> q1\n> q2'; await click('quote'); chk('toolbar: quote on / off', a and await val() == 'q1\nq2', await val())
            await setd('int x;', 0, 6); await click('codeblock'); chk('toolbar: code block wraps selection', await val() == '```\nint x;\n```\n', await val())
            await setd('', 0); await click('table'); await pg.hover('.fmt-grid i[data-r="2"][data-c="3"]'); await pg.click('.fmt-grid i[data-r="2"][data-c="3"]'); v = await val()
            chk('toolbar: 3x2 table', v.startswith('| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n') and v.count('\n|') == 3, v)
            await setd('', 0); await click('alert'); await pg.click('.fmt-menu .mi[data-v="WARNING"]'); chk('toolbar: alert', (await val()).startswith('> [!WARNING]'), await val())
            await setd('', 0); await click('insert'); await pg.click('.fmt-menu .mi[data-v="mermaid"]'); chk('toolbar: insert menu', '```mermaid' in await val(), await val())
            await setd('abc', 3); await click('bold'); await click('undo'); chk('toolbar: undo (real CodeMirror history)', await val() == 'abc', await val()); await click('redo'); chk('toolbar: redo', await val() == 'abc****', await val())
            await setd('a **bold** b', 5); await wait(200); chk('toolbar: bold highlighted inside **x** (syntax tree)', await ev("document.querySelector('#fmtrow [data-a=bold]').classList.contains('on')"))
            await setd('plain', 2); await wait(200); chk('toolbar: bold not highlighted in plain text', not await ev("document.querySelector('#fmtrow [data-a=bold]').classList.contains('on')"))
            await ev("ChipBench.run('mode.read')"); await wait(400); chk('toolbar: read mode disables bold, keeps find', await ev("[document.querySelector('#fmtrow [data-a=bold]').disabled, document.querySelector('#fmtrow [data-a=find]').disabled]") == [True, False], await ev("ChipBench.app.mode"))
            await ev("ChipBench.run('mode.live')"); await wait(400); chk('toolbar: live mode enables bold again', await ev("document.querySelector('#fmtrow [data-a=bold]').disabled") == False)
            await click('find'); await wait(200); chk('toolbar: find opens the find bar', await ev("document.getElementById('find').classList.contains('open') || getComputedStyle(document.getElementById('find')).display !== 'none'"))
            await pg.keyboard.press('Escape')
            # ---------------- PPTX viewer (3.1) in the real viewer pipeline
            await ev("ChipBench.openPath(" + json.dumps(P('DFA培训\\资料\\培训.pptx')) + ")"); await pg.wait_for_selector('.view-host:not(.hide) .pp-slide .sc', timeout=12000); await wait(400)
            chk('pptx: toolbar hidden on a viewer tab', await ev("document.getElementById('fmtrow').classList.contains('hide')"))
            txt = await ev("document.querySelector('.view-host:not(.hide) .pp').innerText")
            chk('pptx: new viewer shows the slide text', 'DFA 概述' in txt, txt[:120])
            chk('pptx: thumbnails + search box + tools', await ev("document.querySelectorAll('.view-host:not(.hide) .pp-th').length") >= 1 and await ev("!!document.querySelector('.view-host:not(.hide) .view-tools input')"))
            await pg.click('.view-host:not(.hide) .view-tools >> text=备注'); await wait(600)
            chk('pptx: notes toggle shows the speaker notes', '讲稿' in await ev("document.querySelector('.view-host:not(.hide) .pp').innerText"), await ev("document.querySelector('.view-host:not(.hide) .pp').innerText.slice(0,200)"))
            await pg.click('.view-host:not(.hide) .view-tools button:has-text("高保真")'); await pg.wait_for_selector('.view-host:not(.hide) .pdf-page canvas', timeout=15000)
            chk('pptx: 高保真 converts via office_to_pdf and shows the PDF in place', True)
            # ---------------- HTML viewer (3.1)
            await ev("ChipBench.openPath(" + json.dumps(HTML) + ")"); await pg.wait_for_selector('.view-host:not(.hide) .hv-frame', timeout=12000); await wait(900)
            frs = [f for f in pg.frames if f != pg.main_frame]
            res = await frs[-1].evaluate("({out:document.getElementById('out').textContent, color:getComputedStyle(document.getElementById('h')).color})") if frs else None
            chk('html: scripts run and relative css / js are inlined', res == {'out': 'script-ran', 'color': 'rgb(0, 128, 0)'}, res)
            chk('html: sandbox allows scripts but not same-origin', await ev("(()=>{const s=document.querySelector('.view-host:not(.hide) .hv-frame').getAttribute('sandbox'); return s.includes('allow-scripts') && !s.includes('allow-same-origin')})()"))
            # ---------------- panels + help
            await ev("ChipBench.panel('learn')"); await wait(800)
            chk('learn panel: 3.1 layout + 3.0 handlers', await ev("!!document.querySelector('#pane-learn .lc') && ['fromPdf','study','library','chapters'].every(k=>document.querySelector('#pane-learn [data-c=\"'+k+'\"]'))"), await ev("document.querySelector('#pane-learn .side-b').innerHTML.slice(0,200)"))
            await ev("ChipBench.panel('tools')"); await wait(600)
            chk('tools panel: 3.1 layout + 3.0 actions', await ev("!!document.querySelector('#pane-tools .et') && ['calc','timing','reg','openres'].every(k=>document.querySelector('#pane-tools [data-k=\"'+k+'\"]'))"), await ev("document.querySelector('#pane-tools .side-b').innerHTML.slice(0,200)"))
            await pg.click('#pane-tools [data-k=calc]'); await wait(500); chk('tools panel: calculator (3.0 handler) still opens', await ev("!!document.querySelector('.modal, #palette, .palette, .cp-bg')"))
            await pg.keyboard.press('Escape'); await wait(200)
            await ev("ChipBench.run('help.hub')"); await wait(600)
            chk('help hub: manual rendered, 8 pages', await ev("document.querySelectorAll('.hub nav a').length") == 8 and 'ChipBench 使用手册' in await ev("document.getElementById('hub-doc').innerText"), await ev("(document.getElementById('hub-doc')||{}).innerText"))
            await pg.click('.hub nav a[data-id=about]'); await wait(200); chk('help hub: About shows the version', 'v1.6.1' in await ev("document.getElementById('hub-doc').innerText"))
            await ev("ChipBench.closeFull()")
            chk('no console / page errors', not errs, errs[:5])
            print(json.dumps({'passed': sum(R.values()), 'total': len(R), 'fails': fails}, ensure_ascii=False)); await b.close()
asyncio.run(main())

import sys as _sys; _sys.exit(1 if fails else 0)  # CI: non-zero exit on any failed check
