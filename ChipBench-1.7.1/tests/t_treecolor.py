"""1.7 · project tree: each nesting level has its own hue + indent guides; ICONS tell kinds apart (project folder / sub-folder / collection); tooltips name the level."""
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
            fs = base_fs(); base = 'C:\\Deep'; fs[base] = {'dir': 1}; path = base
            for i in range(1, 8):
                path += '\\L%d' % i; fs[path] = {'dir': 1}; fs[path + '\\f%d.md' % i] = {'t': '# f%d\n' % i}
            b, ctx, pg, errs = await launch(p, srv, fs, w=1500, h=900); ev = pg.evaluate
            async def wait(ms=300): await pg.wait_for_timeout(ms)
            await ev("ChipBench.ws.addRootPath('C:\\\\Deep')"); await wait(700)
            await ev("document.querySelector('#ws-views button:nth-child(2)').click()"); await wait(500)
            for i in range(8):
                await ev("(()=>{const r=[...document.querySelectorAll('#pane-workspace .ws-row[data-t=root], #pane-workspace .ws-row[data-t=dir]')].filter(x=>x.querySelector('.chev:not(.open)')&&x.querySelector('.chev').textContent.trim()); if(r[0]) r[0].click();})()"); await wait(350)
            rows = await ev("""[...document.querySelectorAll('#pane-workspace .ws-row[data-lv]')].map(r=>{const i=r.querySelector('.fico, .ws-gico'), cs=getComputedStyle(i); return {t:r.dataset.t, lv:r.dataset.lv, name:r.querySelector('.nm').innerText, title:r.title, kind:i.className, col: r.querySelector('.fico')? cs.borderTopColor : cs.backgroundColor}})""")
            chk('folder rows carry a level (root 0, L1 1, ... cycling)', [r['lv'] for r in rows][:8] == ['0', '1', '2', '3', '4', '5', '0', '1'], [(r['name'], r['lv']) for r in rows])
            cols = [r['col'] for r in rows]; chk('6 consecutive levels have 6 different icon colours', len(set(cols[:6])) == 6, cols[:6]); chk('colours repeat after 6 levels', cols[6] == cols[0], cols[:8])
            chk('icon kind: project folder = filled folder, sub-folders = outline folder', rows[0]['kind'] == 'ws-gico' and all(r['kind'] == 'fico' for r in rows[1:]), [r['kind'] for r in rows])
            chk('tooltip names kind and level', '项目文件夹，第 1 层' in rows[0]['title'] and '子文件夹，第 3 层' in rows[2]['title'], [r['title'] for r in rows[:3]])
            guides = await ev("[...document.querySelectorAll('#pane-workspace .ws-row[data-t=file]')].map(r=>(r.getAttribute('style').match(/linear-gradient/g)||[]).length)")
            chk('a file at depth n has n guide lines (one per ancestor level)', sorted(guides) == [2, 3, 4, 5, 6, 7, 8], guides)
            sty = await ev("document.querySelectorAll('#pane-workspace .ws-row[data-t=file]')[2].getAttribute('style')"); chk('guide colours follow the level palette', 'var(--lv0)' in sty and 'var(--lv1)' in sty and 'var(--lv2)' in sty, sty)
            await pg.screenshot(path='tests/out/tree_colors_light.png', clip={'x': 0, 'y': 0, 'width': 340, 'height': 560})
            await ev("ChipBench.prefs.theme='dark'; ChipBench.applyPrefs()"); await wait(400)
            dcols = await ev("[...document.querySelectorAll('#pane-workspace .ws-row[data-lv]')].slice(0,6).map(r=>getComputedStyle(r.querySelector('.fico, .ws-gico')).borderTopColor+'|'+getComputedStyle(r.querySelector('.fico, .ws-gico')).backgroundColor)")
            chk('dark theme: 6 distinct colours, different from light', len(set(dcols)) == 6 and dcols[1] != cols[1], dcols)
            await ev("ChipBench.prefs.theme='light'; ChipBench.applyPrefs()")
            await ev("(()=>{const W=ChipBench.W, w=ChipBench.ws.cur; const a=W.addGroup(w,'一级'); const b=W.addGroup(w,'二级',a.id); W.addGroup(w,'三级',b.id); ChipBench.ws.persist(); })()")
            await ev("document.querySelector('#ws-views button:nth-child(1)').click()"); await wait(500)
            g = await ev("[...document.querySelectorAll('#pane-workspace .ws-row.grp')].map(r=>[r.querySelector('.nm').innerText, r.dataset.lv, getComputedStyle(r.querySelector('.ws-cico')).backgroundColor, r.title])")
            chk('collections: nested groups level 0 / 1 / 2 with different colours', len(g) == 3 and [x[1] for x in g] == ['0', '1', '2'] and len({x[2] for x in g}) == 3, g)
            chk('collection icon is the stacked-bars icon (not a folder) and its tooltip says 集合', await ev("document.querySelectorAll('#pane-workspace .ws-row.grp .ws-cico').length") == 3 and await ev("document.querySelectorAll('#pane-workspace .ws-row.grp .fico, #pane-workspace .ws-row.grp .ws-gico').length") == 0 and '集合，第 2 层' in g[1][3], g)
            await pg.screenshot(path='tests/out/tree_collections.png', clip={'x': 0, 'y': 0, 'width': 340, 'height': 330})
            await ev("ChipBench.run('ws.treecolor')"); await wait(300)
            chk('toggle off: neutral icons, no guides', await ev("document.documentElement.dataset.treecolor") == 'off' and await ev("getComputedStyle(document.querySelector('#pane-workspace .ws-row[data-t=group]')).backgroundImage") == 'none')
            await ev("ChipBench.run('ws.treecolor')"); await wait(600); chk('toggle on again, persisted', await ev("document.documentElement.dataset.treecolor") == 'on' and await ev("JSON.parse(localStorage.getItem('chipbench.prefs')).treeColor") is True)
            chk('no console errors', not errs, errs[:3])
            await b.close()
    print(json.dumps({'passed': sum(R.values()), 'total': len(R), 'fails': fails}, ensure_ascii=False))
    raise SystemExit(1 if fails else 0)
asyncio.run(main())
