"""1.7.1 · usability fixes found by the feature-by-feature audit: breadcrumb keeps the file name at half-screen width, status-bar targets >= 24 px,
status-bar contrast >= 4.5 in all themes, context-aware command palette (最近使用 / 当前文件相关)."""
import asyncio, json
from util import *; from base_fs import *
R = {}; fails = []
def chk(name, cond, info=None):
    R[name] = bool(cond)
    if not cond: fails.append(name); print('FAIL', name, info if info is not None else '')
    else: print('  ok ', name)
CR = """(sel)=>{const lum=c=>{const a=c.match(/[\\d.]+/g).map(Number);const f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)};return .2126*f(a[0])+.7152*f(a[1])+.0722*f(a[2])};
 const e=document.querySelector(sel); const bgOf=n=>{while(n){const b=getComputedStyle(n).backgroundColor; if(b&&b!=='rgba(0, 0, 0, 0)'&&b!=='transparent') return b; n=n.parentElement} return 'rgb(255,255,255)'};
 const L1=lum(getComputedStyle(e).color), L2=lum(bgOf(e)); return +((Math.max(L1,L2)+.05)/(Math.min(L1,L2)+.05)).toFixed(2)}"""
async def main():
    with Server() as srv:
        async with async_playwright() as p:
            b, ctx, pg, errs = await launch(p, srv, base_fs(), w=640, h=700); ev = pg.evaluate
            async def wait(ms=300): await pg.wait_for_timeout(ms)
            await ev("ChipBench.ws.addRootPath('C:\\\\Work')"); await wait(600)
            await ev("ChipBench.openPath('C:\\\\Work\\\\DFA培训\\\\讲稿.md')"); await wait(800)
            g = await ev("(()=>{const c=document.querySelector('#crumbs .bc .cur'); return [c.scrollWidth, c.clientWidth, c.innerText, document.querySelector('#crumbs .bc').title]})()")
            chk('640 px: the file name is shown in full (ancestors shrink first)', g[0] <= g[1] + 1 and g[2] == '讲稿.md', g)
            chk('breadcrumb has the full path as tooltip', g[3].endswith('讲稿.md') and 'DFA培训' in g[3], g[3])
            hs = await ev("[...document.querySelectorAll('#status > .clk')].map(e=>Math.round(e.getBoundingClientRect().height))")
            hs = [h for h in hs if h > 0]; chk('status-bar click targets are >= 24 px high', hs and min(hs) >= 24, hs)
            for th in ('light', 'dark', 'graphite'):
                await ev("ChipBench.prefs.theme=%s; ChipBench.applyPrefs()" % json.dumps(th)); await wait(200)
                cs = [await ev("(" + CR + ")('%s')" % s) for s in ('#st-pos', '#st-ws', '#st-enc')]
                chk('status-bar contrast >= 4.5 (%s): %s' % (th, cs), min(cs) >= 4.5, cs)
            await ev("ChipBench.prefs.theme='light'; ChipBench.applyPrefs()")
            # ---- context-aware palette
            async def pal():
                await ev("ChipBench.palette('>')"); await wait(400)
                r = await ev("[...document.querySelectorAll('.pal-g')].map(g=>g.innerText)"); items = await ev("[...document.querySelectorAll('.pal-it')].map(i=>i.innerText.split('\\n')[0])"); return r, items
            gs, items = await pal(); chk('palette (md tab, empty query): 当前文件相关 first, with insert / table commands', gs and gs[0] == '当前文件相关' and any('表格' in i or '插入' in i for i in items[:18]), (gs[:4], items[:6]))
            chk('palette: no 最近使用 yet', '最近使用' not in gs)
            await pg.keyboard.press('Enter'); await wait(500)
            await ev("document.querySelectorAll('.modal-bg').forEach(m=>m.remove()); document.querySelectorAll('.palette').forEach(m=>m.remove())")
            gs2, items2 = await pal(); chk('palette: the command just run is now listed under 最近使用', gs2 and gs2[0] == '最近使用', (gs2[:3], items2[:3]))
            persisted = await ev("ChipBench.store.get('cmd.recent', [])"); chk('recent commands are persisted', len(persisted) == 1, persisted)
            await pg.keyboard.press('Escape'); await wait(150)
            await ev("ChipBench.openPath('C:\\\\Work\\\\DFA培训\\\\资料\\\\manual.pdf')"); await pg.wait_for_selector('.view-host:not(.hide) .pdf-page canvas', timeout=15000); await wait(400)
            gs3, items3 = await pal(); chk('palette (pdf tab): 当前文件相关 differs from the Markdown one (learning commands)', '当前文件相关' in gs3 and gs3.index('当前文件相关') <= 1, gs3[:4])
            await ev("document.querySelector('.pal-in').value='>学习'; document.querySelector('.pal-in').dispatchEvent(new Event('input'))"); await wait(400)
            n = await ev("document.querySelectorAll('.pal-it').length"); chk('typing a query still searches the commands that apply (学习 → learning commands in a PDF tab)', n >= 5, n)
            await pg.keyboard.press('Escape'); await wait(150)
            # ---- find in a PDF focuses the PDF search box (1.7.0: nothing happened)
            await ev("ChipBench.run('find')"); await wait(300); chk('Ctrl+F in a PDF tab focuses the PDF search box', await ev("document.activeElement && document.activeElement.id") == 'psq')
            await ev("ChipBench.run('save')"); await wait(200); chk('Save on a PDF explains itself instead of doing nothing', '用于 Markdown' in await ev("document.getElementById('toasts').innerText"))
            chk('no console errors', not errs, errs[:3])
            await b.close()
            # ---- welcome screen: nothing to act on
            b, ctx, pg, errs = await launch(p, srv, base_fs(), w=1300, h=800); ev = pg.evaluate
            await wait(600); await ev("ChipBench.openPath && 0")
            blocked = {}
            for cid in ('save', 'saveAs', 'close', 'nextTab', 'reveal', 'find', 'goto', 'mode.read', 'insert.table', 'table.al-left', 'table.format', 'more', 'export.html', 'doc.check'):
                await ev("document.getElementById('toasts') && (document.getElementById('toasts').innerHTML='')"); r = await ev("ChipBench.run(%s)" % json.dumps(cid)); await wait(120)
                blocked[cid] = (r, (await ev("(document.getElementById('toasts')||{innerText:''}).innerText")).strip())
            chk('welcome screen: every document command refuses with a reason (no silent no-op)', all(v[0] is False and len(v[1]) > 6 for v in blocked.values()), {k: v for k, v in blocked.items() if not (v[0] is False and len(v[1]) > 6)})
            chk('welcome screen: no raw "Cannot read properties" errors', not [e for e in errs if 'Cannot read' in e or 'TypeError' in e], errs[:3])
            await pg.keyboard.press('Control+KeyS'); await wait(300); chk('Ctrl+S on the welcome screen shows the hint', '先打开' in await ev("document.getElementById('toasts').innerText") or '用于 Markdown' in await ev("document.getElementById('toasts').innerText"), await ev("document.getElementById('toasts').innerText"))
            await ev("ChipBench.palette('>')"); await wait(400); names = await ev("[...document.querySelectorAll('.pal-it')].map(i=>i.innerText.split('\\n')[0])")
            chk('welcome screen: palette hides commands that cannot work (保存 / 表格 …)', [n for n in names if n.startswith('保存') or ('表格' in n and '宽度' not in n) or n.startswith('恢复历史')] == [] and len(names) > 20, [n for n in names if n.startswith('保存') or ('表格' in n and '宽度' not in n) or n.startswith('恢复历史')])
            await b.close()
    print(json.dumps({'passed': sum(R.values()), 'total': len(R), 'fails': fails}, ensure_ascii=False))
    raise SystemExit(1 if fails else 0)
asyncio.run(main())
