import asyncio, base64, io, json
from util import *
async def main():
    async with async_playwright() as p:
        b,pg,errs = await page(p, native=True)
        ev=pg.evaluate
        await pg.wait_for_timeout(600)
        print('opened', await ev("MDView.S.fileName"))
        imgs = await ev("""[...document.querySelectorAll('#write img')].map(i=>[i.dataset.src, i.src.slice(0,5), i.style.display])""")
        errs_img = await ev("""[...document.querySelectorAll('#write .img-err')].map(e=>e.textContent)""")
        print('imgs', imgs); print('img errors', errs_img)
        await pg.screenshot(path='n1.png')
        await pg.keyboard.press('Control+Shift+o'); await pg.wait_for_timeout(700)
        print('tree', await ev("MDView.S.treeFiles.map(f=>f.path.join('/'))"))
        # tasks pane
        await pg.keyboard.press('Control+Shift+Digit4'); await pg.wait_for_timeout(700)
        print('tasks', await ev("document.getElementById('tk-list').innerText.replace(/\\n+/g,' | ')"))
        await pg.screenshot(path='n2.png')
        await pg.click('#tk-list .tk-it:has-text("B 的待办") input'); await pg.wait_for_timeout(500)
        print('b.md after toggle', repr(await ev("__fs['C:\\\\docs\\\\sub\\\\b.md'].t.split('\\n').slice(-2)")))
        # backlinks
        await pg.keyboard.press('Control+Shift+Digit3'); await pg.wait_for_timeout(500)
        print('backlinks', await ev("document.getElementById('pane-links').innerText.replace(/\\n+/g,' | ')"))
        # wiki open GBK file, edit, save keeps encoding
        await pg.click('#write a.wikilink'); await pg.wait_for_timeout(500)
        print('wiki', await ev("MDView.S.fileName"), await pg.inner_text('#st-enc'))
        await pg.click('#write h1'); await pg.keyboard.press('End'); await pg.keyboard.type('改'); await pg.keyboard.press('Escape')
        await pg.keyboard.press('Control+s'); await pg.wait_for_timeout(300)
        print('saved', await ev("__fs['C:\\\\docs\\\\C笔记.md'].enc"), repr(await ev("__fs['C:\\\\docs\\\\C笔记.md'].t.split('\\n')[0]")))
        # external change via watcher
        await ev("__fs['C:\\\\docs\\\\C笔记.md']={t:'# 外部改动\\n',m:9e12}")
        await ev("__TAURI__.event.__emit('fs-changed',['C:\\\\docs\\\\C笔记.md'])"); await pg.wait_for_timeout(700)
        print('reloaded', await ev("MDView.S.src.trim()"))
        # source mode + external change
        await ev("MDView.setMode('source')"); await pg.wait_for_timeout(300)
        await ev("__fs['C:\\\\docs\\\\C笔记.md']={t:'# 第二次外部改动\\n\\n正文',m:9.1e12}")
        await ev("__TAURI__.event.__emit('fs-changed',['C:\\\\docs\\\\C笔记.md'])"); await pg.wait_for_timeout(700)
        print('src reloaded', repr(await ev("MDView.srcEd.value")))
        await ev("MDView.setMode('live')"); await pg.wait_for_timeout(200)
        # templates: user template from templates/ folder
        await ev("MDView.switchTab(0)"); await pg.wait_for_timeout(200)
        await ev("window.prompt=()=> '客户周会-测试'")
        await ev("MDView.showTemplates()"); await pg.wait_for_timeout(500)
        print('tpl count', await ev("document.querySelectorAll('.tpl').length"))
        await pg.click('.tpl:has-text("客户周会")'); await pg.wait_for_timeout(600)
        print('tpl file', [k for k in await ev("Object.keys(__fs)") if '客户周会-测试' in k], await ev("MDView.S.fileName"))
        # daily note
        await ev("MDView.dailyNote()"); await pg.wait_for_timeout(600)
        print('daily', [k for k in await ev("Object.keys(__fs)") if '日志' in k], await ev("MDView.S.fileName"))
        # state for MCP
        await pg.wait_for_timeout(900)
        st = await ev("window.__state"); print('state', st and st['file'], st and st['folder'])
        # exports
        await ev("MDView.switchTab(0)"); await pg.wait_for_timeout(300)
        await ev("MDView.exportDocx()"); await pg.wait_for_timeout(800)
        await ev("MDView.exportEml()"); await pg.wait_for_timeout(800)
        print('eml opened', await ev("window.__opened"))
        files = await ev("Object.keys(__fs).filter(k=>/\\.(docx|eml)$/.test(k))"); print('export files', files)
        docx = await ev("__fs['C:\\\\docs\\\\a.docx'].b"); open('/home/claude/w/out_native.docx','wb').write(base64.b64decode(docx))
        eml = await ev("Object.entries(__fs).find(([k])=>k.endsWith('.eml'))[1].b"); open('/home/claude/w/out_native.eml','wb').write(base64.b64decode(eml))
        # rename updates links
        await pg.click('#side-tabs [data-tab=files]'); await pg.wait_for_timeout(200)
        await ev("window.prompt=()=> 'alpha.md'")
        await pg.click('#tree .tree-file[data-path="a.md"]', button='right'); await pg.click('#ctx [data-k=rename]'); await pg.wait_for_timeout(900)
        print('after rename b:', repr(await ev("__fs['C:\\\\docs\\\\sub\\\\b.md'].t.split('\\n')[2]")))
        print('errs', errs)
        await b.close()
asyncio.run(main())
