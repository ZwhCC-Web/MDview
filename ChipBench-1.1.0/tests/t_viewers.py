import asyncio, json
from util import *; from base_fs import *
R = {}; fails = []
def chk(name, cond, info=None):
    R[name] = bool(cond)
    if not cond: fails.append(name); print('FAIL', name, info if info is not None else '')
P = lambda s: 'C:\\Work\\' + s
async def main():
    with Server() as srv:
        async with async_playwright() as p:
            fs = base_fs(); fs['C:\\Users\\me\\.chipbench\\cache\\office\\规格.docx.pdf'] = {'b': b64(F / 'manual.pdf')}
            b, ctx, pg, errs = await launch(p, srv, fs, 'window.__PDFTEXT=' + json.dumps(PDFTEXT)); ev = pg.evaluate
            async def wait(ms=300): await pg.wait_for_timeout(ms)
            async def open_(path, sel, t=12000):
                await ev("ChipBench.openPath(%s)" % json.dumps(path)); await pg.wait_for_selector('.view-host:not(.hide) ' + sel, timeout=t); await wait(300)
            await ev("ChipBench.newDoc('', '笔记.md', {keep:true})"); await wait(500)
            # xlsx
            await open_(P('DFA培训\\资料\\样品.xlsx'), '.grid')
            chk('xlsx: 2 sheets + data', await ev("[...document.querySelectorAll('.view-host:not(.hide) .sheet-tabs button')].map(b=>b.innerText).join()") == '样品,温度' and 'R7F701A' in await ev("document.querySelector('.view-host:not(.hide) .grid').innerText"))
            await pg.click('.view-host:not(.hide) td[data-r="0"][data-c="0"]'); await pg.click('.view-host:not(.hide) td[data-r="2"][data-c="2"]', modifiers=['Shift']); await wait(150)
            chk('xlsx: selection', await ev("document.querySelectorAll('.view-host:not(.hide) td.sel').length") == 9)
            await pg.click('.view-host:not(.hide) .view-tools .btn.primary'); await wait(800)
            chk('xlsx: selection -> markdown table in note', '| 料号 | 版本 | 数量 |' in await ev("ChipBench.app.ed ? ChipBench.app.ed.value : ''"), await ev("ChipBench.app.current().name"))
            await ev("ChipBench.app.activate(ChipBench.app.tabs.findIndex(t=>t.name==='样品.xlsx'))"); await wait(500)
            await pg.click('.view-host:not(.hide) .sheet-tabs button:nth-child(2)'); await wait(200)
            # docx
            await open_(P('DFA培训\\资料\\规格.docx'), '.v-doc')
            chk('docx: heading/list/table/image', await ev("(()=>{const d=document.querySelector('.view-host:not(.hide) .v-doc'); return d.querySelector('h1')?.innerText==='客户规格书' && d.querySelectorAll('li').length===2 && d.querySelectorAll('table tr').length===2 && !!d.querySelector('img') && d.querySelector('strong')?.innerText==='加粗'})()"))
            await pg.click('.view-host:not(.hide) .view-tools button:has-text("高保真")'); await pg.wait_for_selector('.view-host:not(.hide) .pdf-page canvas', timeout=15000)
            chk('docx: high-fidelity via office_to_pdf -> pdf viewer', True)
            # pptx
            await open_(P('DFA培训\\资料\\培训.pptx'), '.slide-card, .pp-slide .sc')   # 3.0 viewer or the 3.1 viewer
            if await ev("!!document.querySelector('.view-host:not(.hide) .pp')"):   # 3.1 viewer: the speaker notes are behind the 备注 button
                await pg.click('.view-host:not(.hide) .view-tools >> text=备注'); await wait(600)
            PPTX_TXT = await ev("document.querySelector('.view-host:not(.hide) .slide-card, .view-host:not(.hide) .pp').innerText")
            chk('pptx: slide + notes', 'DFA 概述' in PPTX_TXT and '讲稿' in PPTX_TXT, PPTX_TXT[:100])
            # eml
            await open_(P('DFA培训\\资料\\邮件.eml'), '.v-mail')
            chk('eml: subject/from/attachments/body', await ev("(()=>{const m=document.querySelector('.view-host:not(.hide) .v-mail'); return m.innerText.includes('样品寄送确认') && m.innerText.includes('Wendy') && m.querySelector('iframe').srcdoc.includes('样品已寄出')})()"))
            # hex + diff
            await open_(P('客户\\fw_a.hex'), '.hexv')
            chk('hex: summary + rows', '512 B' in await ev("document.querySelector('.view-host:not(.hide) .kvs').innerText") and await ev("document.querySelectorAll('.view-host:not(.hide) .hexv .hr').length")>5)
            await ev("window.__pickAny=['C:\\\\Work\\\\客户\\\\fw_b.hex']"); await pg.click('.view-host:not(.hide) .view-tools button:has-text("对比")'); await wait(700)
            chk('hex: diff highlights 2 bytes', await ev("document.querySelectorAll('.view-host:not(.hide) .hexv .diff').length") == 2, await ev("document.querySelectorAll('.view-host:not(.hide) .hexv .diff').length"))
            # elf
            await open_(P('客户\\emb.elf'), '.hexv'); chk('elf: symbols', 'main' in await ev("document.querySelector('.view-host:not(.hide)').innerText") and 'table' in await ev("document.querySelector('.view-host:not(.hide)').innerText"))
            # map + lookup + diff
            await open_(P('客户\\emb.map'), '.mem')
            chk('map: regions/usage', 'FLASH' in await ev("document.querySelector('.view-host:not(.hide) .mem').innerText"))
            await pg.fill('.view-host:not(.hide) input.mono', '0x08000006'); await wait(200)
            chk('map: address lookup', 'main' in await ev("document.querySelector('.view-host:not(.hide) .lk').innerText"), await ev("document.querySelector('.view-host:not(.hide) .lk').innerText"))
            # svd -> register bench
            await open_(P('客户\\t.svd'), '.reg-bench'); await pg.click('.view-host:not(.hide) .rb-list .row-i'); await wait(300)
            chk('svd: register bench decodes', await ev("!!document.querySelector('.view-host:not(.hide) .reg svg') && document.querySelector('.view-host:not(.hide) .reg').innerText.includes('MODE')"))
            # log (Rust streaming API)
            await open_(P('客户\\uart.log'), '.logv')
            chk('log: virtual rows', await ev("document.querySelectorAll('.view-host:not(.hide) .logv .hr').length")>10 and '5,000' in await ev("document.querySelector('.view-host:not(.hide) .view-tools').innerText") or '5000' in await ev("document.querySelector('.view-host:not(.hide) .view-tools').innerText"))
            await pg.fill('.view-host:not(.hide) #lgq', 'ERROR'); await pg.keyboard.press('Enter'); await wait(600)
            chk('log: regex filter (log_grep)', '52' in await ev("document.querySelector('.view-host:not(.hide) #lgi').innerText"), await ev("document.querySelector('.view-host:not(.hide) #lgi').innerText"))
            # pdf
            await open_(P('DFA培训\\资料\\manual.pdf'), '.pdf-page canvas', 20000)
            chk('pdf: page canvases + text layer', await ev("document.querySelectorAll('.view-host:not(.hide) .pdf-page canvas').length")>=1 and await ev("document.querySelectorAll('.view-host:not(.hide) .textLayer span').length")>0)
            chk('pdf: bookmarks', await ev("document.querySelectorAll('.view-host:not(.hide) .pdf-side .ol-i').length") == 6)
            await pg.click('.view-host:not(.hide) .pdf-side .ol-i:nth-child(4)'); await wait(900)
            chk('pdf: bookmark jumps to page 3', await ev("document.querySelector('.view-host:not(.hide) #pg').value") == '3', await ev("document.querySelector('.view-host:not(.hide) #pg').value"))
            await pg.fill('.view-host:not(.hide) #psq', 'PLL0'); await pg.keyboard.press('Enter'); await wait(1500)
            chk('pdf: search finds text on page 2', '1/1' in await ev("document.querySelector('.view-host:not(.hide) #pcnt').innerText") and await ev("document.querySelector('.view-host:not(.hide) #pg').value") == '2', await ev("document.querySelector('.view-host:not(.hide) #pcnt').innerText"))
            await pg.click('.view-host:not(.hide) .view-tools button:has-text("页面链接")'); await wait(700)
            chk('pdf: page link inserted into note', '[[manual.pdf#p=2]]' in await ev("ChipBench.app.ed ? ChipBench.app.ed.value : ''"))
            # reading progress persisted
            chk('pdf: reading progress stored', await ev("ChipBench.learn.readingList().then(l=>l.length>0 && l[0].page>0)"))
            # pdf highlight -> notes sidecar
            await ev("ChipBench.app.activate(ChipBench.app.tabs.findIndex(t=>t.name==='manual.pdf'))"); await wait(700)
            await ev("""(()=>{ const sp=[...document.querySelectorAll('.view-host:not(.hide) .textLayer span')].find(s=>s.textContent.includes('Clock')||s.textContent.includes('PLL')); const r=document.createRange(); r.selectNodeContents(sp); const s=getSelection(); s.removeAllRanges(); s.addRange(r); document.querySelector('.view-host:not(.hide) .pdf-main').dispatchEvent(new MouseEvent('mouseup',{bubbles:true})); })()"""); await wait(300)
            await pg.click('.view-host:not(.hide) .pdf-hl [data-a=hl]'); await wait(300); await pg.fill('.modal input', '很重要'); await pg.click('.modal-f .primary'); await wait(500)
            nt = await ev("(window.__FS['C:\\\\Work\\\\DFA培训\\\\资料\\\\manual.notes.md']||{}).t||''")
            chk('pdf: highlight saved as markdown sidecar', '==' in nt and '很重要' in nt and '[[manual.pdf#p=' in nt, nt)
            # image viewer
            await ev("window.__putB('C:\\\\Work\\\\客户\\\\x.png', '%s')" % b64(F / 'i.png')); await open_(P('客户\\x.png'), 'img'); chk('image viewer', True)
            await pg.screenshot(path='s_view.png')
            chk('no console errors', not errs, errs[:3])
            print(json.dumps({'passed': sum(R.values()), 'total': len(R), 'fails': fails}, ensure_ascii=False))
            await b.close()
asyncio.run(main())
