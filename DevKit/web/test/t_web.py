import asyncio, json, base64
from util import *
SSE = ''.join('data: ' + json.dumps({'choices':[{'delta':{'content':c}}]}, ensure_ascii=False) + '\n\n' for c in ['这是', '润色后的', '**结果**。']) + 'data: [DONE]\n\n'
async def main():
    async with async_playwright() as p:
        b,pg,errs = await page(p, init="localStorage.setItem('mdview.ai', JSON.stringify({provider:'openai',base:'https://ai.example.com/v1',key:'k',model:'test-model'}))")
        async def ai_route(route):
            req = route.request; body = json.loads(req.post_data); ai_route.last = body
            await route.fulfill(status=200, headers={'content-type':'text/event-stream','access-control-allow-origin':'*'}, body=SSE)
        await pg.route('https://ai.example.com/**', ai_route)
        ev=pg.evaluate
        R = {}
        # --- typing flow on a fresh tab (block editor = CodeMirror)
        await ev("MDView.newTab()"); await pg.wait_for_timeout(200)
        for s,k in [('# 标题','Enter'),('第一段','Enter'),('- 项目一','Enter'),('项目二','Enter'),(None,'Enter'),('/bg','Enter'),('型号','Tab'),('引脚','Tab'),('封装','Tab'),('U5L4','Tab'),('176',None)]:
            if s: await pg.keyboard.type(s)
            if k: await pg.keyboard.press(k)
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(100)
        await pg.click('.add-zone'); await pg.keyboard.type('见 [[项目'); await pg.wait_for_timeout(150)
        R['wiki_ac'] = await ev("document.getElementById('ac').classList.contains('show')")
        await pg.keyboard.press('Enter'); await pg.keyboard.type(' 和 :roc'); await pg.wait_for_timeout(100); await pg.keyboard.press('Enter'); await pg.keyboard.press('Escape')
        R['typed'] = await ev("MDView.S.src")
        # undo in live mode
        await pg.keyboard.press('Control+z'); R['undo'] = await ev("MDView.S.src.includes('[[项目]]')")
        await pg.keyboard.press('Control+y')
        # --- fmt bar + bold via toolbar
        await pg.click('#write h1'); await pg.keyboard.press('End'); await pg.keyboard.press('Shift+Home'); await pg.wait_for_timeout(150)
        R['fmtbar'] = await ev("document.getElementById('fmt-bar').classList.contains('show')")
        await pg.keyboard.press('Escape')
        # --- source mode: list continuation, table Tab, find/replace, typing
        await pg.keyboard.press('Control+/'); await pg.wait_for_timeout(300)
        await ev("(()=>{const e=MDView.srcEd; e.focus(); e.setSelectionRange(e.length,e.length)})()")
        await pg.keyboard.type('\n\n- a'); await pg.keyboard.press('Enter'); await pg.keyboard.type('b'); await pg.keyboard.press('Enter'); await pg.keyboard.press('Enter')
        await pg.keyboard.type('| x | y |\n| - | - |\n| 1 | 2 |'); await pg.keyboard.press('Tab'); await pg.keyboard.type('新'); 
        await pg.wait_for_timeout(400)
        R['source_text'] = await ev("MDView.S.src.split('\\n').slice(-8).join('\\n')")
        await pg.keyboard.press('Control+h'); await pg.fill('#find-q', '项目'); await pg.wait_for_timeout(300)
        R['find_cnt'] = await pg.inner_text('#find-cnt')
        await pg.fill('#find-r', 'Item'); await pg.click('#find-repall'); await pg.wait_for_timeout(200)
        R['replaced'] = await ev("(MDView.S.src.match(/Item/g)||[]).length")
        await pg.keyboard.press('Escape')
        await pg.screenshot(path='w_src.png')
        # --- split
        await ev("MDView.setMode('split')"); await pg.wait_for_timeout(300); await pg.screenshot(path='w_split.png')
        await ev("MDView.setMode('live')"); await pg.wait_for_timeout(200)
        # --- calc
        await pg.keyboard.press('Control+p'); await pg.keyboard.type('=0x3F<<4 | 0b1010'); await pg.wait_for_timeout(100)
        R['calc'] = await pg.inner_text('#qo-list'); await pg.keyboard.press('Escape')
        R['calc2'] = await ev("JSON.stringify([MDView.calc('-1'),MDView.calc('3/4'),MDView.calc('2k+1')])")
        # --- palette
        await pg.keyboard.press('Control+Shift+P'); await pg.keyboard.type('导出'); await pg.wait_for_timeout(100)
        R['palette'] = await ev("document.querySelectorAll('#qo-list .qo-it').length"); await pg.keyboard.press('Escape')
        # --- AI: select text in block editor, quick action polish, replace
        await ev("MDView.openDoc('# AI 测试\\n\\n这个段落需要润色一下。\\n\\n另一段。','ai.md')"); await pg.wait_for_timeout(200)
        await pg.click('#write .blk[data-t=para] >> nth=0'); await pg.keyboard.press('Control+a'); await pg.wait_for_timeout(100)
        await ev("document.querySelector('[data-ai=polish]').click()"); await pg.wait_for_timeout(800)
        R['ai_reply'] = await ev("document.querySelector('#ai-msgs .ai-msg:last-child .bubble').innerText")
        R['ai_req_has_ctx'] = '这个段落需要润色一下' in json.dumps(ai_route.last, ensure_ascii=False)
        await pg.click('#ai-msgs [data-a=replace]'); await pg.wait_for_timeout(300)
        await pg.keyboard.press('Escape'); await pg.wait_for_timeout(200)
        R['ai_replaced'] = await ev("MDView.S.src")
        await pg.screenshot(path='w_ai.png')
        await ev("document.querySelector('[data-act=ai]').click()")
        # --- tasks pane (single doc)
        await ev("MDView.openDoc('# T\\n\\n- [ ] 逾期 📅 2020-01-01\\n- [ ] 今天 📅 '+new Date().toISOString().slice(0,10)+'\\n- [x] 完成\\n','t.md')"); await pg.wait_for_timeout(200)
        await pg.keyboard.press('Control+Shift+Digit4'); await pg.wait_for_timeout(400)
        R['tasks'] = await ev("document.getElementById('tk-list').innerText.replace(/\\n+/g,' | ')")
        await pg.click('#tk-list .tk-it:has-text("逾期") input'); await pg.wait_for_timeout(300)
        R['task_toggled'] = await ev("MDView.S.src.includes('- [x] 逾期')")
        await pg.screenshot(path='w_tasks.png')
        # --- images: data uri works; relative shows banner-free error (no file handle)
        await ev("MDView.openDoc('![d](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==)\\n\\n![r](assets/x.png)','img.md')"); await pg.wait_for_timeout(300)
        R['img_web'] = await ev("[...document.querySelectorAll('#write img')].map(i=>i.src.slice(0,5)+':'+i.style.display)")
        R['img_err'] = await ev("[...document.querySelectorAll('.img-err')].map(e=>e.textContent)")
        # --- slides + pptx + docx + eml + html downloads
        await ev("MDView.openDoc(MDView.fillTpl(MDView.TEMPLATES.find(t=>t.id==='talk').body,'技术培训')+'\\n\\n---\\n\\n## 代码页\\n\\n```c\\nint main(){return 0;}\\n```\\n\\n- 说明一\\n- 说明二\\n','deck.md')"); await pg.wait_for_timeout(300)
        await pg.keyboard.press('F5'); await pg.wait_for_timeout(300); R['slides'] = await pg.inner_text('#slides .num'); await pg.keyboard.press('Escape')
        for act, fn in [('pptx','deck.pptx'),('docx','deck.docx'),('eml','.eml'),('html','deck.html')]:
            async with pg.expect_download() as d:
                await ev(f"document.querySelector('[data-act={act}]').click()")
            dl = await d.value; path = '/home/claude/w/out_web_' + act + '.' + ('eml' if act=='eml' else act if act!='html' else 'html'); await dl.save_as(path); R['dl_'+act] = dl.suggested_filename
        # --- lint
        await ev("MDView.openDoc('# A\\n\\n### 跳级\\n\\n# A\\n\\n![](x.png)\\n\\n\\n\\n正文[^9]','lint.md')")
        await ev("document.querySelector('[data-act=lint]').click()"); await pg.wait_for_timeout(150)
        R['lint'] = await ev("document.querySelectorAll('.lint-it').length"); await pg.keyboard.press('Escape')
        R['errs'] = errs
        for k,v in R.items(): print(k, '=>', v if not isinstance(v,str) else v[:400].replace('\n','⏎'))
        await b.close()
asyncio.run(main())
