import asyncio, json
from util import *; from base_fs import *
R = {}; fails = []
def chk(name, cond, info=None):
    R[name] = bool(cond); print('  ok ' if cond else '  FAIL', name, '' if cond else (info if info is not None else ''), flush=True)
    if not cond: fails.append(name)
NOTE = 'C:\\Work\\DFA培训\\讲稿.md'; J = json.dumps
STRUCT_A = '```structure\ntitle: A\nnodes:\n  - {id: pe, label: 协议引擎, page: 1}\n  - {id: flt, label: 接收过滤器, in: pe, page: 2, regs: [CAN0]}\n  - {id: ram, label: 报文 RAM, in: flt, page: 3}\n```\n'
STRUCT_B = '```structure\ntitle: B\nnodes:\n  - {id: pe, label: 协议引擎, page: 1}\n  - {id: flt, label: 接收过滤器, in: pe, page: 2, kind: advanced}\n  - {id: tsu, label: 时间戳单元, in: pe, page: 4}\n```\n'
async def main():
    with Server() as srv:
        async with async_playwright() as p:
            fs = base_fs(); fs['C:\\Work\\DFA培训\\章节\\结构A.md'] = {'t': '# A\n\n' + STRUCT_A}; fs['C:\\Work\\DFA培训\\章节\\结构B.md'] = {'t': '# B\n\n' + STRUCT_B}
            fs['C:\\Work\\DFA培训\\章节\\热区.md'] = {'t': '# 热区\n\n```hotspot\nimage: ..\\\\资料\\\\i.png\nsource: manual.pdf\nregions:\n  - {x: 10, y: 10, w: 40, h: 40, label: 时钟, target: {page: 3}}\n```\n'}
            fs['C:\\Work\\DFA培训\\资料\\i.png'] = {'b': b64(F / 'i.png')}
            b, ctx, pg, errs = await launch(p, srv, fs, 'window.__PDFTEXT=' + J(PDFTEXT) + ";window.__ARGS=['C:\\\\Work\\\\DFA培训\\\\章节\\\\01-背景.md'];"); ev = pg.evaluate
            async def wait(ms=300): await pg.wait_for_timeout(ms)
            chk('launch argument opens file', await ev("ChipBench.app.tabs.map(t=>t.name).join()") == '01-背景.md', await ev("ChipBench.app.tabs.map(t=>t.name).join()"))
            await ev("window.__pickFolder='C:\\\\Work\\\\DFA培训'"); await pg.click('.btn[data-a=add-root]'); await pg.wait_for_function('ChipBench.index.docs.size>=7', timeout=8000)
            # ---------- drag & drop (native paths)
            await ev("window.__listeners['tauri://drag-drop']({payload:{paths:['D:\\\\Share','C:\\\\Work\\\\DFA培训\\\\讲稿.md']}})"); await wait(900)
            chk('drop folder adds root, drop file opens', await ev("ChipBench.ws.cur.roots.length") == 2 and '讲稿.md' in await ev("ChipBench.app.tabs.map(t=>t.name).join()"), await ev("[ChipBench.ws.cur.roots.map(r=>r.path), ChipBench.app.tabs.map(t=>t.name).join()]"))
            # ---------- external change
            await ev("window.__put('C:\\\\Work\\\\DFA培训\\\\讲稿.md', '# 外部修改后的标题\\n\\n正文\\n')"); await ev("window.__FS['C:\\\\Work\\\\DFA培训\\\\讲稿.md'].m = 99999"); await ev("window.__listeners['fs-changed']({payload:['C:\\\\Work\\\\DFA培训\\\\讲稿.md']})"); await wait(1200)
            chk('external edit reloads open document', '外部修改后的标题' in await ev("ChipBench.app.ed.value"), await ev("ChipBench.app.ed.value.slice(0,60)"))
            chk('index refreshed after external change', '外部修改后的标题' in (await ev("ChipBench.index.search.docs.get('c:\\\\work\\\\dfa培训\\\\讲稿.md').text")))
            # ---------- web clip + offline save
            html = '<html><head><title>CAN FD 入门</title></head><body><nav>菜单 首页</nav><article><h1>CAN FD 入门</h1><p>CAN FD 提高了数据段的速率。' + '内容很长。' * 60 + '</p><ul><li>要点一</li><li>要点二</li></ul><img src="/pic.png"></article><footer>版权</footer></body></html>'
            await ev("window.__fetch=async(u)=>{ if(/pic\\.png/.test(u)) return {ok:true,arrayBuffer:async()=>new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]).buffer,headers:new Headers({'content-type':'image/png'})}; return {ok:true,status:200,text:async()=>%s,headers:new Headers()}; }" % J(html))
            await ev("ChipBench.ws.cur.settings.inbox='C:\\\\Work\\\\收件箱'"); await ev("void ChipBench.web.clip('https://example.com/a/b')"); await wait(1500)
            clip = [k for k in await ev("Object.keys(window.__FS)") if '网页剪藏' in k and k.endswith('.md')]; txt = await ev("window.__FS[%s].t" % J(clip[0])) if clip else ''
            chk('web clip → markdown (main content, source, image downloaded)', len(clip) == 1 and '# CAN FD 入门' in txt and 'source: https://example.com/a/b' in txt and '要点一' in txt and '菜单' not in txt and '版权' not in txt and any(k.endswith('.png') and 'assets' in k for k in await ev("Object.keys(window.__FS)")), txt[:300])
            await ev("void ChipBench.web.saveOffline('https://example.com/a/b')"); await wait(1200); chk('offline single-file html saved', any(k.endswith('.html') and '网页剪藏' in k for k in await ev("Object.keys(window.__FS)")))
            await ev("ChipBench.web.open('https://example.com')"); await wait(200); chk('web window command', await ev("window.__web") == 'https://example.com')
            # ---------- hotspot widget
            await ev("ChipBench.openPath('C:\\\\Work\\\\DFA培训\\\\章节\\\\热区.md')"); await pg.wait_for_selector('.lv-w .hot-r', timeout=10000); await ev("ChipBench.app.ed.select(0)")
            await pg.click('.lv-w .hot-r'); await wait(1000); chk('hotspot region jumps to manual page', await ev("ChipBench.app.current().name") == 'manual.pdf')
            # ---------- cross-chip compare + register tree
            await ev("window.__pickAny=['C:\\\\Work\\\\DFA培训\\\\章节\\\\结构A.md','C:\\\\Work\\\\DFA培训\\\\章节\\\\结构B.md']"); await ev("void ChipBench.run('learn.cross')"); await pg.wait_for_selector('.modal .tbl', timeout=5000)
            rows = await ev("[...document.querySelectorAll('.modal .tbl tr')].slice(1).map(r=>r.innerText.replace(/\\s+/g,' '))"); chk('cross-chip diff (removed / changed / added)', len(rows) == 3 and any('移除' in r for r in rows) and any('新增' in r for r in rows) and any('变化' in r for r in rows), rows); await pg.keyboard.press('Escape'); await wait(200)
            await ev("ChipBench.openPath('C:\\\\Work\\\\DFA培训\\\\章节\\\\结构A.md')"); await pg.wait_for_function("ChipBench.app.current().name==='结构A.md' && ChipBench.app.current().loaded"); await wait(500)
            await ev("window.__pickAny=['C:\\\\Work\\\\客户\\\\t.svd']"); await ev("(()=>{ const ed=ChipBench.app.ed; ed.select(ed.value.indexOf('pe, label')); })()"); await ev("void ChipBench.run('learn.regtree')"); await wait(900)
            chk('register tree lists SVD registers for nodes', 'CAN0.CTRL' in await ev("document.querySelector('.modal')?.innerText||''"))
            await pg.click('.modal .row-i'); await wait(500); chk('register tree inserts bit-field block', '```register' in await ev("ChipBench.app.ed.value") and 'name: CAN0.CTRL' in await ev("ChipBench.app.ed.value")); await pg.keyboard.press('Escape')
            await wait(1500)
            # ---------- session restore (second launch with same KV + FS)
            await ev("ChipBench.app.setMode('split')"); await wait(1600)
            kv = json.loads(await ev("JSON.stringify(window.__KV)")); fsd = json.loads(await ev("JSON.stringify(window.__FS)")); names = await ev("ChipBench.app.tabs.map(t=>t.name).join()"); cur = await ev("ChipBench.app.current().name")
            await b.close()
            b2, ctx2, pg2, errs2 = await launch(p, srv, fsd, "window.__PDFTEXT=%s;" % J(PDFTEXT), kv=kv); ev2 = pg2.evaluate
            await pg2.wait_for_function("ChipBench.app.tabs.length>0", timeout=10000); await pg2.wait_for_timeout(1500)
            chk('session restores tabs + active tab', await ev2("ChipBench.app.tabs.map(t=>t.name).join()") == names and await ev2("ChipBench.app.current().name") == cur, [names, await ev2("ChipBench.app.tabs.map(t=>t.name).join()")])
            chk('workspace + roots restored', await ev2("ChipBench.ws.cur.roots.length") == 2 and await ev2("ChipBench.ws.cur.name") == '我的工作区')
            chk('prefs restored (mode)', await ev2("ChipBench.prefs.mode") == 'split')
            chk('no console errors', not errs and not errs2, (errs + errs2)[:3])
            print(json.dumps({'passed': sum(R.values()), 'total': len(R), 'fails': fails}, ensure_ascii=False))
            await b2.close()
asyncio.run(main())
