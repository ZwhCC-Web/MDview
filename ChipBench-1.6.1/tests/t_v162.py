"""ChipBench 1.6.1 (build 2) — document width (fixed / fill), table width (auto / column / window), status-bar switch, project tree follows disk.  python tests/t_v162.py"""
import asyncio, json, pathlib
from util import *; from base_fs import *
OUT = pathlib.Path(__file__).resolve().parent / 'out'; OUT.mkdir(exist_ok=True)
R = {}; fails = []
def chk(name, cond, info=None):
    R[name] = bool(cond); print(('  ok  ' if cond else 'FAIL ') + name, '' if cond else (info if info is not None else ''))
    if not cond: fails.append(name)
GEO = """(()=>{const q=s=>document.querySelector(s); const pane=q('#pv-pane'), doc=q('.pv-doc'), tw=doc&&doc.querySelector('.table-wrap'); const pr=pane.getBoundingClientRect();
 const r=el=>{const b=el.getBoundingClientRect(); return {l:Math.round(b.left-pr.left), r:Math.round(pr.right-b.right), w:Math.round(b.width)}};
 return {pane:Math.round(pr.width), pcw:pane.clientWidth, doc:r(doc), tbl:tw?r(tw):null, tblTable:tw?Math.round(tw.querySelector('table').getBoundingClientRect().width):0, hscroll:pane.scrollWidth>pane.clientWidth+1}})()"""
GEOL = """(()=>{const q=s=>document.querySelector(s); const sc=q('.cm-scroller'), ct=q('.cm-content'), tw=ct.querySelector('.table-wrap'); const sr=sc.getBoundingClientRect();
 const r=el=>{const b=el.getBoundingClientRect(); return {l:Math.round(b.left-sr.left), r:Math.round(sr.right-b.right), w:Math.round(b.width)}};
 return {sc:Math.round(sr.width), scw:sc.clientWidth, ct:r(ct), tbl:tw?r(tw):null, hscroll:sc.scrollWidth>sc.clientWidth+1}})()"""
async def main():
    with Server() as srv:
        async with async_playwright() as p:
            fs = base_fs()
            wide = '| 编号 | 寄存器 | 地址 | 位宽 | 复位值 | 说明 |\n| --- | --- | --- | --- | --- | --- |\n' + ''.join('| %d | CFDC%dNCFG | 0x%04X | 32 | 0x0 | 标称位时序配置 |\n' % (i, i, i * 4) for i in range(6))
            fs['C:\\Work\\宽表.md'] = {'t': '# 宽表\n\n正文段落，用来看版心宽度。' + '这是一段很长的文字。' * 30 + '\n\n' + wide + '\n结尾。\n'}
            b, ctx, pg, errs = await launch(p, srv, fs, w=1600, h=900); ev = pg.evaluate
            async def wait(ms=300): await pg.wait_for_timeout(ms)
            await ev("ChipBench.openPath('C:\\\\Work\\\\宽表.md')"); await wait(900)
            # ---------- defaults
            chk('defaults: fixed + auto', await ev("ChipBench.prefs.docWidth==='fixed' && ChipBench.prefs.tableFit==='auto' && document.documentElement.dataset.docw==='fixed' && document.documentElement.dataset.tblfit==='auto'"))
            chk('status-bar switch visible for a note', await ev("document.querySelector('#st-width').classList.contains('on') && document.querySelector('#st-width').textContent.includes('固定')"))
            # ---------- read view
            await ev("ChipBench.app.setMode('read')"); await wait(900)
            g = await ev(GEO); print('   read/default', g)
            chk('read: fixed column is narrower than the pane', g['doc']['w'] <= 870 and g['doc']['l'] > 200, g)
            await ev("ChipBench.run('view.docwidth')"); await wait(400)
            g = await ev(GEO); print('   read/fill', g)
            chk('read: fill → document spans the whole pane', g['doc']['l'] <= 1 and g['doc']['r'] <= 1 and g['doc']['w'] >= g['pcw'] - 2, g)
            chk('read: fill status text', '铺满' in await ev("document.querySelector('#st-width').textContent"))
            await pg.screenshot(path=str(OUT / 'w_read_fill.png'))
            await ev("ChipBench.run('view.docwidth')"); await wait(300)
            g0 = await ev(GEO)
            await ev("ChipBench.prefs.tableFit='column'; ChipBench.applyPrefs()"); await wait(300)
            g = await ev(GEO); print('   read/column', g)
            chk('read: table = column width', abs(g['tbl']['w'] - (g0['doc']['w'] - 112)) <= 3 and abs(g['tblTable'] - g['tbl']['w']) <= 3, (g, g0))
            await ev("ChipBench.prefs.tableFit='window'; ChipBench.applyPrefs()"); await wait(400)
            g = await ev(GEO); print('   read/window', g)
            chk('read: window table uses the side margins', g['tbl']['l'] < g['doc']['l'] - 100 and abs(g['tbl']['l'] - g['tbl']['r']) <= 20 and g['tbl']['w'] >= g['pcw'] - 80, g)
            chk('read: window table does not cause horizontal scroll', not g['hscroll'], g)
            chk('read: window table columns stretch', g['tblTable'] >= g['tbl']['w'] - 3, g)
            await pg.screenshot(path=str(OUT / 'w_read_tblwin.png'))
            # ---------- live view
            await ev("ChipBench.prefs.docWidth='fixed'; ChipBench.prefs.tableFit='auto'; ChipBench.applyPrefs(); ChipBench.app.setMode('live')"); await wait(1000)
            await ev("ChipBench.app.ed.view.dispatch({selection:{anchor:0}}); ChipBench.app.ed.view.requestMeasure()"); await wait(400)
            g = await ev(GEOL); print('   live/default', g)
            chk('live: fixed column', g['ct']['w'] <= 870 and g['ct']['l'] > 200, g)
            await ev("ChipBench.prefs.docWidth='fill'; ChipBench.applyPrefs()"); await wait(500)
            g = await ev(GEOL); print('   live/fill', g)
            chk('live: fill spans the scroller', g['ct']['l'] <= 1 and g['ct']['r'] <= 1, g)
            await ev("ChipBench.prefs.docWidth='fixed'; ChipBench.prefs.tableFit='window'; ChipBench.applyPrefs()"); await wait(600)
            g = await ev(GEOL); print('   live/window', g)
            chk('live: window table breaks out of the column', g['tbl'] and g['tbl']['l'] < g['ct']['l'] - 100 and abs(g['tbl']['l'] - g['tbl']['r']) <= 20 and g['tbl']['w'] >= g['scw'] - 80 and not g['hscroll'], g)
            await pg.screenshot(path=str(OUT / 'w_live_tblwin.png'))
            # resize → follows the window
            await pg.set_viewport_size({'width': 1100, 'height': 900}); await wait(700)
            g = await ev(GEOL); print('   live/window narrower', g)
            chk('live: window table follows a resized window', g['tbl']['w'] >= g['scw'] - 80 and g['tbl']['w'] <= g['scw'] and not g['hscroll'], g)
            await pg.set_viewport_size({'width': 1600, 'height': 900}); await wait(500)
            # ---------- split view + source view
            await ev("ChipBench.prefs.docWidth='fill'; ChipBench.prefs.tableFit='window'; ChipBench.applyPrefs(); ChipBench.app.setMode('split')"); await wait(1200)
            sp = await ev("(()=>{const e=document.querySelector('#ed-pane'), v=document.querySelector('#pv-pane'); const tw=v.querySelector('.pv-doc .table-wrap'); const vr=v.getBoundingClientRect(), tr=tw.getBoundingClientRect(); return {ed:e.clientWidth, pv:v.clientWidth, pvVar:v.style.getPropertyValue('--paneW'), edVar:e.style.getPropertyValue('--paneW'), tl:Math.round(tr.left-vr.left), tr:Math.round(vr.right-tr.right), hs:v.scrollWidth>v.clientWidth+1}})()")
            print('   split', sp)
            chk('split: each pane measured separately', sp['pvVar'] == str(sp['pv']) + 'px' and (sp['edVar'] == str(sp['ed']) + 'px' or sp['ed'] == 0), sp)
            chk('split: preview table fits its (half) pane', sp['tl'] >= 0 and sp['tr'] >= 0 and abs(sp['tl'] - sp['tr']) <= 20 and not sp['hs'], sp)
            await ev("ChipBench.app.setMode('source')"); await wait(800)
            chk('source: fill removes the column limit', await ev("(()=>{const c=document.querySelector('.cm-src .cm-content'), s=document.querySelector('.cm-src .cm-scroller'); return !!c && c.getBoundingClientRect().width >= s.clientWidth - 2})()"))
            await ev("ChipBench.prefs.docWidth='fixed'; ChipBench.applyPrefs()"); await wait(400)
            chk('source: fixed keeps the column', await ev("(()=>{const c=document.querySelector('.cm-src .cm-content'), s=document.querySelector('.cm-src .cm-scroller'); return c.getBoundingClientRect().width < s.clientWidth - 100})()"))
            # a big table in "撑满窗口"
            big = '| a | b | c | d |\n| --- | --- | --- | --- |\n' + ''.join('| %d | x%d | 0x%X | 说明 %d |\n' % (i, i, i, i) for i in range(1500))
            await ev("window.__FS['C:\\\\Work\\\\大表.md']={t:" + json.dumps('# 大表\n\n' + big) + "}; ChipBench.prefs.tableFit='window'; ChipBench.applyPrefs()"); await ev("ChipBench.openPath('C:\\\\Work\\\\大表.md')"); await wait(1500)
            await ev("ChipBench.app.setMode('read')"); await wait(1200)
            lt = await ev("(async()=>{window.__lt=[]; new PerformanceObserver(l=>l.getEntries().forEach(e=>window.__lt.push(e.duration))).observe({entryTypes:['longtask']}); const t0=performance.now(); ChipBench.prefs.tableFit='auto'; ChipBench.applyPrefs(); await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); ChipBench.prefs.tableFit='window'; ChipBench.applyPrefs(); await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); return {ms:Math.round(performance.now()-t0), lt:window.__lt}})()")
            print('   big table switch', lt)
            chk('1500-row table: switching table width does not freeze', lt['ms'] < 1500 and all(x < 500 for x in lt['lt']), lt)
            # ---------- status bar menu
            await pg.click('#st-width'); await wait(300)
            items = await ev("[...document.querySelectorAll('.menu-pop .mi')].map(m=>m.textContent.trim()+(m.classList.contains('chk')?' ✓':''))")
            chk('status menu lists width + table options', len(items) == 5 and any('铺满窗口' in x for x in items) and any('撑满窗口' in x and '✓' in x for x in items), items)
            await ev("[...document.querySelectorAll('.menu-pop .mi')].find(m=>m.textContent.includes('铺满窗口')).click()"); await wait(500)
            chk('menu: fill applied + saved', await ev("ChipBench.prefs.docWidth==='fill' && JSON.parse(localStorage.getItem('chipbench.prefs')).docWidth==='fill' && document.documentElement.dataset.docw==='fill'"))
            await ev("ChipBench.run('view.tablefit')"); await wait(300)
            chk('table fit command cycles', await ev("ChipBench.prefs.tableFit") == 'auto')
            # ---------- preferences dialog
            await ev("ChipBench.run('prefs')"); await wait(400)
            chk('prefs: has document width + table width', await ev("!!document.querySelector('.modal [data-k=docWidth]') && !!document.querySelector('.modal [data-k=tableFit]') && document.querySelector('.modal [data-k=docWidth]').value==='fill'"))
            await ev("(()=>{const s=document.querySelector('.modal [data-k=tableFit]'); s.value='column'; s.dispatchEvent(new Event('change',{bubbles:true}))})()"); await wait(300)
            chk('prefs: table fit change applies', await ev("document.documentElement.dataset.tblfit")=='column')
            await pg.keyboard.press('Escape'); await wait(200)
            # status switch hidden for a non-note tab
            await ev("ChipBench.openPath('C:\\\\Work\\\\客户\\\\uart.log')"); await wait(900)
            chk('status switch hidden on viewers', await ev("!document.querySelector('#st-width').classList.contains('on')"))
            # ---------- project tree follows the disk
            await ev("ChipBench.ws.addRootPath('C:\\\\Work')"); await wait(1500)
            await ev("ChipBench.ws.view='roots'; ChipBench.ws.draw()"); await wait(600)
            await ev("ChipBench.run('ws.focus')") if await ev("ChipBench.commands.has('ws.focus')") else None
            await ev("document.querySelector('#rail [data-x=workspace]') && document.querySelector('#rail [data-x=workspace]').click()"); await wait(500)
            await ev("(()=>{const r=document.querySelector('#ws-body .ws-row[data-t=root]'); if(r && !r.querySelector('.chev.open')) r.click()})()"); await wait(700)
            before = await ev("document.querySelector('#ws-body').innerText")
            chk('tree: shows the root (precondition)', 'DFA培训' in before and 'MCP新建' not in before, before[:200])
            await ev("window.__FS['C:\\\\Work\\\\MCP新建']={dir:1}; window.__FS['C:\\\\Work\\\\MCP新建\\\\from-mcp.md']={t:'# 来自 MCP\\n'}; window.__listeners['fs-changed']({payload:['C:\\\\Work\\\\MCP新建','C:\\\\Work\\\\MCP新建\\\\from-mcp.md']})"); await wait(1500)
            after = await ev("document.querySelector('#ws-body').innerText")
            chk('tree: a folder created outside appears without refresh', 'MCP新建' in after, after[:300])
            await ev("document.querySelector('#ws-body .ws-row[data-t=dir][data-path$=\"MCP新建\"]').click()"); await wait(500)
            chk('tree: …and its new file is listed', 'from-mcp.md' in await ev("document.querySelector('#ws-body').innerText"))
            await ev("window.__FS['C:\\\\Work\\\\MCP新建\\\\second.csv']={t:'a,b\\n1,2\\n'}; window.__listeners['fs-changed']({payload:['C:\\\\Work\\\\MCP新建\\\\second.csv']})"); await wait(1400)
            chk('tree: a file added to an open folder appears', 'second.csv' in await ev("document.querySelector('#ws-body').innerText"))
            chk('no page errors', not [e for e in errs if 'pageerror' in e], errs[:5])
            await b.close()
    print(json.dumps({'passed': sum(R.values()), 'total': len(R), 'fails': fails}, ensure_ascii=False))
asyncio.run(main())
import sys as _sys; _sys.exit(1 if fails else 0)
