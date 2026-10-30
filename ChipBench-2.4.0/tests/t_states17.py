"""1.7 · unified loading / error / empty states for viewer tabs."""
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
            fs = base_fs(); fs['C:\\Work\\坏.pdf'] = {'t': 'this is not a pdf'}; fs['C:\\Work\\占用.xlsx'] = {'b': b64(F / '样品.xlsx')}; fs['C:\\Work\\慢.docx'] = {'b': b64(F / '规格.docx')}
            b, ctx, pg, errs = await launch(p, srv, fs); ev = pg.evaluate
            async def wait(ms=300): await pg.wait_for_timeout(ms)
            m = await ev("[ChipBench.ui.friendly('os error 2').title, ChipBench.ui.friendly('Access is denied. (os error 5)').title, ChipBench.ui.friendly('The process cannot access the file because it is being used by another process. (os error 32)').title, ChipBench.ui.friendly('Invalid PDF structure').title, ChipBench.ui.friendly('weird').title]")
            chk('friendly(): not found / denied / locked / invalid / fallback', m == ['文件不存在或已被移动', '没有权限读取这个文件', '文件正被其他程序占用', '文件格式有问题或已损坏', '无法打开这个文件'], m)
            await ev("(()=>{const r=ChipBench.fs.readBytes; window.__r0=r; ChipBench.fs.readBytes=async p=>{ if(/慢\\.docx$/.test(p)) await new Promise(x=>setTimeout(x,1200)); return r(p); }; return 0})()")
            await ev("(window.__p1 = ChipBench.openPath('C:\\\\Work\\\\慢.docx'), 1)"); await wait(400)
            txt = await ev("document.querySelector('.view-host:not(.hide)').innerText"); chk('loading: spinner + file name', '正在打开' in txt and '慢.docx' in txt and await ev("!!document.querySelector('.state.loading .spin')"), txt)
            await wait(1500); chk('loading → document appears', await ev("!!document.querySelector('.view-host:not(.hide) .v-doc')"))
            await ev("(window.__p2 = ChipBench.openPath('C:\\\\Work\\\\坏.pdf'), 1)"); await pg.wait_for_selector('.state.error-s', timeout=15000); await wait(200)
            txt = await ev("document.querySelector('.state.error-s').innerText"); btn = await ev("[...document.querySelectorAll('.state.error-s button')].map(b=>b.innerText)")
            chk('error: plain title + file name + hint', '格式有问题或已损坏' in txt and '坏.pdf' in txt and '换一份副本' in txt, txt)
            chk('error: actions retry / reveal / system open / copy / close', btn == ['重试', '在文件夹中显示', '用系统程序打开', '复制错误信息', '关闭标签'], btn)
            chk('error: raw message kept in details', await ev("document.querySelector('.state.error-s details pre').textContent.length") > 3)
            await pg.click('.state.error-s [data-i="1"]'); await wait(200); chk('reveal action calls the shell', await ev("window.__revealed") == 'C:\\Work\\坏.pdf')
            await ev("window.__put('C:\\\\Work\\\\坏.pdf', '')"); await ev("window.__putB('C:\\\\Work\\\\坏.pdf', %s)" % json.dumps(b64(F / 'manual.pdf')))
            await pg.click('.state.error-s [data-i="0"]'); await pg.wait_for_selector('.view-host:not(.hide) .pdf-page canvas', timeout=15000); chk('retry re-opens the repaired file', True)
            await ev("(()=>{ChipBench.fs.readBytes=async p=>{ if(/占用\\.xlsx$/.test(p)) throw 'The process cannot access the file because it is being used by another process. (os error 32)'; return window.__r0(p); }; return 0})()")
            n0 = await ev("ChipBench.app.tabs.length"); await ev("(window.__p3 = ChipBench.openPath('C:\\\\Work\\\\占用.xlsx'), 1)"); await pg.wait_for_selector('.state.error-s', timeout=8000); await wait(200)
            chk('locked file → “正被其他程序占用”', '正被其他程序占用' in await ev("document.querySelector('.state.error-s').innerText"))
            await pg.click('.state.error-s [data-i="4"]'); await wait(400); tn = await ev("ChipBench.app.tabs.length"); chk('close-tab action closes it', tn == n0, [tn, n0])
            await ev("(()=>{const d=document.createElement('div'); d.id='tst'; document.body.appendChild(d); ChipBench.ui.empty(d,{title:'没有结果',msg:'换个关键词',actions:[{t:'清除筛选',primary:true,fn:()=>{window.__cleared=1}}]});})()")
            await ev("document.querySelector('#tst .btn.primary').click()"); chk('empty(): title, hint, action', '没有结果' in await ev("document.getElementById('tst').innerText") and await ev("window.__cleared") == 1)
            chk('no unexpected page errors', all('pageerror' not in e for e in errs), errs[:3]); await b.close()
    print(json.dumps({'passed': sum(R.values()), 'total': len(R), 'fails': fails}, ensure_ascii=False))
    raise SystemExit(1 if fails else 0)
asyncio.run(main())
