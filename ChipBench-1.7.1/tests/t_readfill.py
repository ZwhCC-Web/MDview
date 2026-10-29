"""1.7 · reading page without blank margins: width button, 4 widths, tables stretch in fill modes, live editor too, persists."""
import asyncio, json
from util import *; from base_fs import *
R = {}; fails = []
def chk(name, cond, info=None):
    R[name] = bool(cond)
    if not cond: fails.append(name); print('FAIL', name, info if info is not None else '')
    else: print('  ok ', name)
TBL = "# 配置\n\n> 每个 RS-CANFD 单元一份全局配置。\n\n| MCAL 参数 | 对应功能 | 可选值 | 建议 |\n|---|---|---|---|\n| CanClockSourceSelect | RSCFDnCFDGCFG.DCS | CLKC / CLK_XINCAN | CAN FD 通常选择 CLKC |\n| CanEnableDLCCheck | DCE | true / false | 视需求 |\n\n正文段落。\n"
P = 'C:\\Work\\read.md'
async def main():
    with Server() as srv:
        async with async_playwright() as p:
            fs = base_fs(); fs[P] = {'t': TBL}
            b, ctx, pg, errs = await launch(p, srv, fs, w=1600, h=900); ev = pg.evaluate
            async def wait(ms=300): await pg.wait_for_timeout(ms)
            await ev("ChipBench.openPath(%s)" % json.dumps(P)); await wait(900); await ev("ChipBench.app.setMode('read')"); await wait(700)
            async def geo():
                return await ev("""(()=>{const d=document.querySelector('#pv-pane .pv-doc'), pane=document.querySelector('#pv-pane'), t=d.querySelector('table'), r=d.getBoundingClientRect(), pr=pane.getBoundingClientRect(), tr=t.getBoundingClientRect();
                  return {docW:Math.round(r.width), paneW:Math.round(pr.width), left:Math.round(r.left-pr.left), tableW:Math.round(tr.width), tableRight:Math.round(pr.right-tr.right)}})()""")
            async def pick(k):
                await pg.click('#crumbs [data-act=width]'); await wait(250); await pg.click('.menu-pop .mi[data-k="%s"]' % k); await wait(450)
            g0 = await geo(); chk('fixed: centred column with big blank sides', g0['left'] > 200 and g0['docW'] < 900, g0)
            chk('top bar has the width button (md tab)', await ev("!!document.querySelector('#crumbs [data-act=width]')"))
            await pg.click('#crumbs [data-act=width]'); await wait(300)
            items = await ev("[...document.querySelectorAll('.menu-pop .mi')].map(x=>x.innerText.replace(/\\s+/g,' ').trim())")
            chk('menu offers 固定 / 宽 / 铺满 / 贴边 and table options', len(items) == 7 and '贴边' in items[3], items)
            await pg.click('.menu-pop .mi[data-k="w:wide"]'); await wait(450); g1 = await geo(); chk('wide: >= 1280 px column', 1200 < g1['docW'] <= 1308, g1)
            await pick('w:fill'); g2 = await geo()
            chk('fill: only side padding remains', g2['left'] <= 2 and g2['docW'] >= g2['paneW'] - 20, g2)
            chk('fill: the table stretches to the text width', abs(g2['tableW'] - (g2['docW'] - 80)) <= 6 and g2['tableRight'] <= 54, g2)
            chk('button shows active state', await ev("document.querySelector('#crumbs [data-act=width]').classList.contains('on')"))
            await pick('w:edge'); g3 = await geo(); chk('edge: ~12 px each side, table full width', g3['tableRight'] <= 14 and g3['tableW'] >= g3['paneW'] - 40, g3)
            await pg.screenshot(path='tests/out/read_fill_edge.png')
            await ev("ChipBench.app.setMode('live')"); await wait(800)
            w_live = await ev("(()=>{const c=document.querySelector('.cm-live .cm-content').getBoundingClientRect().width, s=document.querySelector('.cm-live .cm-scroller').getBoundingClientRect().width; return [Math.round(c), Math.round(s)]})()")
            chk('live editor fills as well', w_live[0] >= w_live[1] - 30, w_live)
            saved = await ev("JSON.parse(localStorage.getItem('chipbench.prefs')).docWidth"); chk('preference is saved', saved == 'edge', saved)
            await ev("ChipBench.run('view.docwidth')"); await wait(300); chk('command toggles back to fixed', await ev("ChipBench.prefs.docWidth") == 'fixed')
            await ev("ChipBench.app.setMode('read')"); await wait(500); g4 = await geo(); chk('fixed again', g4['left'] > 200, g4)
            chk('status-bar label', '固定' in await ev("document.querySelector('#st-width').innerText"))
            chk('no console errors', not errs, errs[:3])
            await b.close()
    print(json.dumps({'passed': sum(R.values()), 'total': len(R), 'fails': fails}, ensure_ascii=False))
    raise SystemExit(1 if fails else 0)
asyncio.run(main())
