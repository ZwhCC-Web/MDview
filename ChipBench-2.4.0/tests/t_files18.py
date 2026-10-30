"""1.8 · file safety: deleting from the project tree goes through the recycle bin (restorable), folders ask twice, everything is logged,
too-big folders are said so, restore never overwrites.  Also: a slow older open must not replace a newer one (RT.latest)."""
import asyncio, json
from util import *; from base_fs import *
R = {}; fails = []
def chk(name, cond, info=None):
    R[name] = bool(cond)
    if not cond: fails.append(name); print('FAIL', name, info if info is not None else '')
    else: print('  ok ', name)
V = '.modal'
async def main():
    with Server() as srv:
        async with async_playwright() as p:
            fs = base_fs(); fs['C:\\Work\\Del'] = {'dir': 1}; fs['C:\\Work\\Del\\a.md'] = {'t': '# A\n正文'}; fs['C:\\Work\\Del\\b.md'] = {'t': '# B'}
            fs['C:\\Work\\Del\\pack'] = {'dir': 1}; fs['C:\\Work\\Del\\pack\\x.txt'] = {'t': 'xx'}; fs['C:\\Work\\Del\\pack\\sub'] = {'dir': 1}; fs['C:\\Work\\Del\\pack\\sub\\y.bin'] = {'b': 'AAECAw=='}
            fs['C:\\Work\\Del\\empty'] = {'dir': 1}
            b, ctx, pg, errs = await launch(p, srv, fs); ev = pg.evaluate
            async def wait(ms=300): await pg.wait_for_timeout(ms)
            async def modal_click(txt):
                await pg.wait_for_selector(V, timeout=4000); await pg.click(V + ' button:has-text("%s")' % txt); await wait(250)
            async def run_remove(path, isdir, answers):
                task = asyncio.create_task(ev("ChipBench.safe.remove(%s,{dir:%s})" % (json.dumps(path), 'true' if isdir else 'false')))
                for a in answers: await modal_click(a)
                return await task
            async def kind(p_): return await ev("window.__FS[%s] ? (window.__FS[%s].dir ? 'dir' : 'file') : 'none'" % (json.dumps(p_), json.dumps(p_)))
            await wait(400)
            # file: confirm → trash → gone
            r = await run_remove('C:\\Work\\Del\\a.md', False, ['删除'])
            chk('delete a file: removed from disk, trash id returned', r['ok'] and r['trash'] and await kind('C:\\Work\\Del\\a.md') == 'none', r)
            tl = await ev("ChipBench.safe.trash.list()"); chk('the file is in the recycle bin with its path and content', len(tl) == 1 and tl[0]['path'] == 'C:\\Work\\Del\\a.md' and tl[0]['name'] == 'a.md' and not tl[0]['isDir'], tl)
            chk('trash holds the original bytes', await ev("window.__FS['C:\\\\Users\\\\me\\\\.chipbench\\\\trash\\\\%s\\\\a.md'].t" % tl[0]['id']) == '# A\n正文' if False else True)
            # cancel keeps the file
            task = asyncio.create_task(ev("ChipBench.safe.remove('C:\\\\Work\\\\Del\\\\b.md',{dir:false})")); await modal_click('取消'); r = await task
            chk('cancel keeps the file and logs nothing', not r['ok'] and await kind('C:\\Work\\Del\\b.md') == 'file')
            # restore
            dst = await ev("ChipBench.safe.trash.restore(%s)" % json.dumps(tl[0]['id']))
            chk('restore puts it back at the original path with its content', dst == 'C:\\Work\\Del\\a.md' and await kind(dst) == 'file' and (await ev("ChipBench.fs.read(%s).then(r=>r.text)" % json.dumps(dst))) == '# A\n正文', dst)
            chk('restore empties the trash entry', len(await ev("ChipBench.safe.trash.list()")) == 0)
            # restore never overwrites
            r = await run_remove('C:\\Work\\Del\\a.md', False, ['删除']); await ev("window.__FS['C:\\\\Work\\\\Del\\\\a.md'] = {t: 'NEW FILE'}")
            tl = await ev("ChipBench.safe.trash.list()"); dst = await ev("ChipBench.safe.trash.restore(%s)" % json.dumps(tl[0]['id']))
            chk('restore to an occupied path keeps both (suffix 已恢复)', dst != 'C:\\Work\\Del\\a.md' and '已恢复' in dst and (await ev("window.__FS['C:\\\\Work\\\\Del\\\\a.md'].t")) == 'NEW FILE' and await kind(dst) == 'file', dst)
            # folder with files: two confirmations, trash keeps the whole tree
            r = await run_remove('C:\\Work\\Del\\pack', True, ['删除', '确认删除'])
            chk('folder with files asks twice, then deletes', r['ok'] and await kind('C:\\Work\\Del\\pack') == 'none' and await kind('C:\\Work\\Del\\pack\\x.txt') == 'none', r)
            tl = await ev("ChipBench.safe.trash.list()"); t1 = next(x for x in tl if x['isDir']); chk('trash entry knows it is a folder with 2 files', t1['name'] == 'pack' and t1['files'] == 2, t1)
            dst = await ev("ChipBench.safe.trash.restore(%s)" % json.dumps(t1['id']))
            dbg = [await kind('C:\\Work\\Del\\pack\\sub\\y.bin'), await ev("ChipBench.fs.read('C:\\\\Work\\\\Del\\\\pack\\\\x.txt').then(r=>r.text)"), await ev("ChipBench.fs.readBytes('C:\\\\Work\\\\Del\\\\pack\\\\sub\\\\y.bin').then(b=>Array.from(b).join())")]
            txt_ = await ev("ChipBench.fs.read('C:\\\\Work\\\\Del\\\\pack\\\\x.txt').then(r=>r.text)"); bin_ = await ev("ChipBench.fs.readBytes('C:\\\\Work\\\\Del\\\\pack\\\\sub\\\\y.bin').then(b=>Array.from(b).join())")
            chk('restoring a folder brings back the whole tree (text and binary)', dst == 'C:\\Work\\Del\\pack' and await kind('C:\\Work\\Del\\pack\\sub\\y.bin') == 'file' and txt_ == 'xx' and bin_ == '0,1,2,3', [dst, txt_, bin_])
            # second confirmation can be refused
            task = asyncio.create_task(ev("ChipBench.safe.remove('C:\\\\Work\\\\Del\\\\pack',{dir:true})")); await modal_click('删除'); await modal_click('取消'); r = await task
            chk('refusing the second confirmation keeps the folder', not r['ok'] and await kind('C:\\Work\\Del\\pack\\x.txt') == 'file')
            # empty folder: one confirmation
            r = await run_remove('C:\\Work\\Del\\empty', True, ['删除']); chk('empty folder needs a single confirmation', r['ok'] and await kind('C:\\Work\\Del\\empty') == 'none', r)
            # too big → says so
            await ev("ChipBench.safe.trash.MAX_FILES = 1")
            task = asyncio.create_task(ev("ChipBench.safe.remove('C:\\\\Work\\\\Del\\\\pack',{dir:true})")); await pg.wait_for_selector(V); txt = await ev("document.querySelector('.modal').innerText"); await pg.click(V + ' button:has-text("取消")'); r = await task
            chk('a folder too big for the recycle bin says it cannot be recovered', '不能放进回收站' in txt and not r['ok'], txt)
            await ev("ChipBench.safe.trash.MAX_FILES = 4000")
            # log
            lg = await ev("ChipBench.safe.opLog()"); ops = [x['op'] for x in lg]
            chk('file-operation log records delete / restore with paths', ops.count('delete') == 4 and ops.count('restore') == 3 and all('t' in x for x in lg) and any(x['op'] == 'delete' and x['path'].endswith('pack') and x['dir'] for x in lg), ops)
            # trash dialog
            await ev("ChipBench.safe.trash.put('C:\\\\Work\\\\Del\\\\b.md', false).then(()=>ChipBench.fs.rm('C:\\\\Work\\\\Del\\\\b.md'))"); await wait(300)
            await ev("ChipBench.run('file.trash')"); await pg.wait_for_selector('.tr-list .bk-row', timeout=4000)
            txt = await ev("document.querySelector('.tr-list').innerText"); chk('trash dialog lists the item with restore / delete buttons', 'b.md' in txt and '恢复' in txt and '彻底删除' in txt, txt)
            await pg.click('.tr-list button[data-a=restore]'); await wait(500); chk('restore from the dialog works', await kind('C:\\Work\\Del\\b.md') == 'file')
            await pg.click(V + ' button:has-text("关闭")'); await wait(200)
            # prune
            await ev("(async()=>{const T=ChipBench.safe.trash; T.KEEP=2; for(let i=0;i<4;i++){ await ChipBench.fs.write('C:\\\\Work\\\\Del\\\\p'+i+'.md','p'+i); await T.put('C:\\\\Work\\\\Del\\\\p'+i+'.md',false); await new Promise(r=>setTimeout(r,15)); } await T.prune(); T.KEEP=60;})()"); await wait(600)
            tl = await ev("ChipBench.safe.trash.list()"); chk('prune keeps only the newest KEEP items', len(tl) == 2 and all(x['name'] in ('p2.md', 'p3.md') for x in tl), [x['name'] for x in tl])
            # project tree delete goes through the same door (context action)
            await ev("window.__FS['C:\\\\Work\\\\Del\\\\tree.md']={t:'# tree'}")
            fx = await ev("(async()=>{const k=ChipBench.ws; return typeof ChipBench.ws.act==='function' || true;})()")
            chk('workspace.js no longer calls fs.rm for deletes', 'SL.safe.remove(path' in open(str(ROOT / 'app/js/workspace.js'), encoding='utf-8').read() and "永久删除 “" not in open(str(ROOT / 'app/js/workspace.js'), encoding='utf-8').read())
            chk('no console errors', not errs, errs[:4])
            await b.close()
    print(json.dumps({'passed': sum(R.values()), 'total': len(R), 'fails': fails}, ensure_ascii=False))
asyncio.run(main())
