import asyncio, json, base64
from util import *
EXCEL = '<table><tr><td>料号</td><td>数量</td></tr><tr><td>R7F701</td><td>20</td></tr></table>'
async def main():
    async with async_playwright() as p:
        b,pg,errs = await page(p, native=True)
        ev=pg.evaluate; R={}
        await pg.wait_for_timeout(500)
        await pg.keyboard.press('Control+Shift+o'); await pg.wait_for_timeout(600)
        # rich paste of an Excel table into a new block
        await pg.click('.add-zone'); await pg.wait_for_timeout(100)
        await ev("""h=>{const ed=MDView.S.editing.ta; const e=new Event('paste',{bubbles:true,cancelable:true}); e.clipboardData={items:[],getData:t=>t==='text/html'?h:''}; ed.view.contentDOM.dispatchEvent(e);}""", EXCEL)
        await pg.wait_for_timeout(200); R['paste_table'] = await ev("MDView.S.editing.ta.value")
        # paste an image -> saved to assets/ next to the document
        await ev("""(async()=>{const b=await (await fetch('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==')).blob(); const ed=MDView.S.editing.ta; ed.focus(); ed.setSelectionRange(ed.length,ed.length); const e=new Event('paste',{bubbles:true,cancelable:true}); e.clipboardData={items:[{type:'image/png',getAsFile:()=>new File([b],'x.png',{type:'image/png'})}],getData:()=>''}; ed.view.contentDOM.dispatchEvent(e);})()""")
        await pg.wait_for_timeout(500)
        R['pasted_assets'] = [k for k in await ev("Object.keys(__fs)") if 'image-' in k]
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
        R['pasted_img_render'] = await ev("[...document.querySelectorAll('#write img')].filter(i=>i.dataset.src.startsWith('assets/image-')).map(i=>i.src.slice(0,5))")
        # image changed on disk -> refreshed
        before = await ev("document.querySelector('#write img').src")
        await ev("__fs['C:\\\\docs\\\\assets\\\\x.png'].m=99; __TAURI__.event.__emit('fs-changed',['C:\\\\docs\\\\assets\\\\x.png'])"); await pg.wait_for_timeout(800)
        R['img_refreshed'] = before != await ev("document.querySelector('#write img').src")
        # Enter in the middle of a paragraph splits it; Backspace on empty block goes to previous
        await ev("MDView.openDoc('第一句。第二句。\\n\\n后一段','split.md')"); await pg.wait_for_timeout(200)
        await pg.click('#write .blk >> nth=0'); await ev("MDView.S.editing.ta.setSelectionRange(4,4)"); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(150)
        R['enter_split'] = await ev("MDView.S.src")
        await pg.keyboard.press('ArrowDown'); await pg.keyboard.press('ArrowDown'); await pg.wait_for_timeout(100)
        R['arrow_nav'] = await ev("MDView.S.editing && MDView.S.editing.ta.value")
        await pg.keyboard.press('Escape')
        # history restore
        await ev("MDView.switchTab(0)"); await pg.wait_for_timeout(200)
        await pg.click('#write h1'); await pg.keyboard.press('End'); await pg.keyboard.type('V2'); await pg.keyboard.press('Escape'); await pg.keyboard.press('Control+s'); await pg.wait_for_timeout(300)
        await pg.keyboard.press('Control+Alt+h'); await pg.wait_for_timeout(400)
        await pg.click('.hist-it >> nth=1'); await pg.click('#h-restore'); await pg.wait_for_timeout(200)
        R['hist_restored'] = (await ev("MDView.S.src.split('\\n')[0]"))
        # graph
        await pg.keyboard.press('Control+Shift+g'); await pg.wait_for_timeout(1200); R['graph'] = await pg.inner_text('#g-info'); await pg.keyboard.press('Escape')
        # inline-image HTML export (native writes file)
        await ev("document.querySelector('[data-act=htmlinline]').click()"); await pg.wait_for_timeout(800)
        h = await ev("Object.entries(__fs).find(([k])=>k.endsWith('a.html'))"); R['html_inline_has_data'] = bool(h) and h[1]['t'].count('src="data:image/png;base64') >= 3 and 'R0lGODlh' not in h[1]['t'].split('<body>')[1]
        # wiki link to a missing note creates it
        await ev("MDView.openDoc('见 [[全新笔记]]','w.md',null,['w.md'])"); await pg.wait_for_timeout(200)
        await pg.click('#write a.wikilink'); await pg.wait_for_timeout(600); R['wiki_new'] = [k for k in await ev("Object.keys(__fs)") if '全新笔记' in k]
        # source mode slash menu + undo fallback + find highlight
        await ev("MDView.newTab()"); await ev("MDView.setMode('source')"); await pg.wait_for_timeout(300)
        await pg.keyboard.type('/bg'); await pg.wait_for_timeout(150); R['src_slash'] = await ev("document.getElementById('ac').classList.contains('show')")
        await pg.keyboard.press('Enter'); await pg.wait_for_timeout(100); R['src_table'] = await ev("MDView.srcEd.value")
        await pg.keyboard.press('Control+z'); await pg.keyboard.press('Control+z'); await pg.wait_for_timeout(100); R['src_undo'] = await ev("MDView.srcEd.value")
        await pg.keyboard.type('alpha beta alpha'); await pg.keyboard.press('Control+f'); await pg.fill('#find-q','alpha'); await pg.wait_for_timeout(300)
        R['src_find'] = (await pg.inner_text('#find-cnt'), await ev("document.querySelectorAll('.cm-searchhit').length"))
        await pg.keyboard.press('Escape')
        # split scroll sync
        await ev("MDView.openDoc(Array.from({length:200},(_, i)=>'## 标题'+i+'\\n\\n段落 '+i).join('\\n\\n'),'long.md')"); await ev("MDView.setMode('split')"); await pg.wait_for_timeout(500)
        await ev("document.getElementById('preview-scroll').scrollTop=4000"); await pg.wait_for_timeout(400)
        R['split_sync_line'] = await ev("MDView.topLine()")
        await ev("MDView.setMode('live')"); await pg.wait_for_timeout(300)
        R['live_after_split_line'] = await ev("MDView.topLine()")
        # AI error path
        await pg.route('https://bad.example.com/**', lambda r: r.fulfill(status=500, body='{"error":"boom"}'))
        await ev("localStorage.setItem('mdview.ai', JSON.stringify({provider:'azure',base:'https://bad.example.com',key:'k',deployment:'gpt4o',apiVersion:'2024-06-01'}))")
        reqs=[]; pg.on('request', lambda r: reqs.append(r.url) if 'bad.example' in r.url else None)
        await ev("MDView.newTab('请总结这段话。','x.md')"); await ev("document.querySelector('[data-ai=summary]').click()"); await pg.wait_for_timeout(800)
        R['ai_err'] = await ev("document.querySelector('#ai-msgs .ai-msg.err .bubble')?.innerText"); R['azure_url'] = reqs[:1]
        # copy as mail produces inline styles
        m = await ev("MDView.mailHtml(false).then(r=>r.html)"); R['mail_inline'] = 'style="' in m and 'class=' not in m
        # session restore after reload
        await ev("localStorage.removeItem('mdview.ai')"); await pg.wait_for_timeout(1500)
        await pg.reload(); await pg.wait_for_function('window.__MDV_READY'); await pg.wait_for_timeout(800)
        R['restored_tabs'] = await ev("MDView.S.tabs.length")
        R['errs'] = errs
        for k,v in R.items(): print(k, '=>', v if not isinstance(v,str) else v[:300].replace('\n','⏎'))
        await b.close()
asyncio.run(main())
