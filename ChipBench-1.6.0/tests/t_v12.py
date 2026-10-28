"""ChipBench 1.2 — UI fixes: shell never scrolls, side panel never disappears, help fills the window, compact tool lists,
front matter not rendered as headings, narrow-window controls don't wrap, table formulas, AI status / test / diagnostics,
lazy Mermaid.   python tests/t_v12.py"""
import asyncio, json
from util import *; from base_fs import *
R = {}; fails = []
def chk(name, cond, info=None):
    R[name] = bool(cond); print(('  ok  ' if cond else 'FAIL ') + name, '' if cond else (info if info is not None else ''))
    if not cond: fails.append(name)
SHELL = """(()=>{const ids=['app','main','side','right']; const bad=[]; [document.documentElement,document.body].concat(ids.map(i=>document.getElementById(i))).forEach(e=>{ if(e&&(e.scrollTop||e.scrollLeft)) bad.push((e.id||e.tagName)+':'+e.scrollTop+','+e.scrollLeft); }); const r=document.getElementById('rail').getBoundingClientRect(), t=document.getElementById('tabs').getBoundingClientRect(); if(r.top!==0) bad.push('rail.top='+r.top); if(t.top<0) bad.push('tabs.top='+t.top); return bad;})()"""
FAKE = r"""
window.__aiMode = 'ok';
(function(){ const real = window.fetch; window.fetch = async (u, o) => {
  if (String(u).startsWith('https://fake.ai/')) {
    if (window.__aiMode === '401') return new Response('{"error":{"message":"Incorrect API key provided"}}', { status: 401 });
    if (window.__aiMode === 'net') throw new TypeError('Failed to fetch');
    const enc = new TextEncoder(); return new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n')); c.close(); } }), { status: 200 });
  } return real(u, o); }; })();
"""
async def main():
    with Server() as srv:
        async with async_playwright() as p:
            fs = base_fs()
            b, ctx, pg, errs = await launch(p, srv, fs, 'window.__PDFTEXT=' + json.dumps(PDFTEXT) + ';' + FAKE); ev = pg.evaluate
            async def wait(ms=300): await pg.wait_for_timeout(ms)
            chk('version 1.6.0', await ev("ChipBench.VERSION==='1.6.0'"))
            await ev("ChipBench.ws.addRootPath('C:\\\\Work')"); await wait(900)
            await ev("ChipBench.openPath('C:\\\\Work\\\\DFA培训\\\\讲稿.md')"); await pg.wait_for_function("ChipBench.app.current() && ChipBench.app.current().loaded"); await wait(900)
            # ---- front matter
            await ev("ChipBench.app.setMode('live')"); await wait(400)
            fm = await ev("(()=>{const ls=[...document.querySelectorAll('.cm-line')].slice(0,8); return ls.map(l=>[l.className, getComputedStyle(l).fontSize, l.textContent.slice(0,20)])})()")
            chk('front matter: rendered as quiet metadata, not headings', all('lv-h' not in c for c, f, t in fm[:7]) and sum('lv-fm' in c for c, f, t in fm) >= 6 and float(fm[2][1].replace('px', '')) <= 13, fm)
            chk('front matter: real H1 after it still a heading', await ev("[...document.querySelectorAll('.cm-line')].some(l=>/lv-h1/.test(l.className) && l.textContent.includes('DFA 培训讲稿'))"))
            # ---- shell never scrolls: click every tool / learn entry, force scrollIntoView attempts
            await ev("ChipBench.panel('tools')"); await wait(300)
            n = await ev("document.querySelectorAll('#pane-tools .act').length")
            for i in range(n):
                try:
                    await pg.click(f'#pane-tools .act >> nth={i}', timeout=1500); await wait(250)
                    for _ in range(2): await pg.keyboard.press('Escape'); await wait(80)
                except Exception: pass
            await ev("ChipBench.panel('tools')"); await wait(200)
            bad = await ev(SHELL); chk('tools: clicking every entry never scrolls the shell', not bad, bad)
            chk('inserted templates land below the front matter', await ev("(()=>{const t=ChipBench.app.tabs.find(x=>x.name==='讲稿.md'); const v=ChipBench.app.textOf(t); return v.startsWith('---'+String.fromCharCode(10)+'title:') && v.slice(80).includes('```')})()"), await ev("(()=>{const t=ChipBench.app.tabs.find(x=>x.name==='讲稿.md'); return JSON.stringify(ChipBench.app.textOf(t).slice(0,160))})()"))
            await ev("document.body.scrollTop=300; document.getElementById('app').scrollTop=200; document.getElementById('main').scrollTop=120"); await wait(120)
            bad = await ev(SHELL); chk('shell resists programmatic scroll (clip + guard)', not bad, bad)
            await ev("document.querySelector('.cm-content').lastElementChild.scrollIntoView({block:'end'})"); await wait(200)
            bad = await ev(SHELL); chk('scrollIntoView inside editor keeps rail/tabs in place', not bad, bad)
            # ---- compact lists: no hero, no recent duplicates, no card borders
            chk('tools: no hero banner, no duplicate entries', await ev("(()=>{const ks=[...document.querySelectorAll('#pane-tools .act[data-k]')].map(a=>a.dataset.k); return ks.length===new Set(ks).size && getComputedStyle(document.querySelector('#pane-tools .et-hero')||document.body).display!=='block'})()") and await ev("!document.querySelector('#pane-tools [data-sec=recent]')"))
            chk('tools: rows are single-line list items (≤ 34 px, no border / shadow)', await ev("[...document.querySelectorAll('#pane-tools .act')].every(a=>{const cs=getComputedStyle(a); return a.getBoundingClientRect().height<=34 && cs.borderTopWidth==='0px' && cs.boxShadow==='none'})"))
            chk('tools: description available as tooltip', await ev("[...document.querySelectorAll('#pane-tools .act')].every(a=>a.title && a.title.includes('：'))"))
            await ev("ChipBench.panel('learn')"); await wait(400)
            chk('learn: no hero / flow banner, list rows', await ev("(()=>{const h=document.querySelector('#pane-learn .lc-hero'); return (!h||getComputedStyle(h).display==='none') && [...document.querySelectorAll('#pane-learn .act')].every(a=>a.getBoundingClientRect().height<=34)})()"))
            # ---- table formulas
            await wait(400)
            cells = await ev("[...document.querySelectorAll('.cm-content td.tcalc')].map(td=>[td.textContent.trim(), td.title])")
            chk('table formulas show computed values (title = formula)', ['40000', '=B2*C2'] in cells and ['15000', '=B3*C3'] in cells, cells)
            await ev("ChipBench.app.setMode('read')"); await wait(900)
            cells = await ev("[...document.querySelectorAll('#pv-pane td.tcalc')].map(td=>td.textContent.trim())")
            chk('table formulas computed in read mode too', '40000' in cells, cells)
            await ev("ChipBench.app.setMode('live')"); await wait(300)
            # ---- help hub fills the window, rail visible, nav not clipped
            await ev("ChipBench.run('help.hub')"); await wait(800)
            g = await ev("(()=>{const hub=document.querySelector('.hub'), fp=document.querySelector('.fp'), nav=document.querySelector('.hub nav a'), r=hub.getBoundingClientRect(), f=fp.getBoundingClientRect(); return {hubBottom:r.bottom, fpBottom:f.bottom, fpLeft:f.left, rail:document.getElementById('rail').getBoundingClientRect().right, navLeft:nav.getBoundingClientRect().left, navPad:getComputedStyle(nav).paddingLeft}})()")
            chk('help: hub fills full height', abs(g['hubBottom'] - g['fpBottom']) <= 2, g)
            chk('help: rail stays visible (page sits inside main)', g['fpLeft'] >= g['rail'] - 1, g)
            chk('help: nav text not clipped at left edge', g['navLeft'] >= g['fpLeft'] + 8, g)
            chk('help: shows version 1.6.0', '1.6.0' in await ev("document.querySelector('.fp').innerText"))
            await pg.keyboard.press('Escape'); await wait(300)
            # ---- narrow window
            await pg.set_viewport_size({'width': 760, 'height': 820}); await wait(400)
            m = await ev("[...document.querySelectorAll('#mode-seg button')].map(b=>Math.round(b.getBoundingClientRect().height))")
            chk('narrow: mode buttons stay on one line', m and max(m) <= 30, m)
            chk('narrow: side docked, editor wide enough', await ev("document.querySelector('#side').getBoundingClientRect().width>=180 && document.querySelector('#stage').getBoundingClientRect().width>=380"))
            chk('narrow: format toolbar single row (scrollable)', await ev("(()=>{const r=document.getElementById('fmtrow'); return r.getBoundingClientRect().height<=44 && getComputedStyle(r).overflowX==='auto'})()"))
            await ev("ChipBench.panel('tools')"); await wait(200)
            for i in range(4):
                try: await pg.click(f'#pane-tools .act >> nth={i}', timeout=1500); await wait(200); await pg.keyboard.press('Escape'); await wait(80)
                except Exception: pass
            await pg.mouse.click(600, 400); await wait(200)
            bad = await ev(SHELL); chk('narrow: still no shell scroll, side never vanishes', not bad and await ev("document.querySelector('#side').getBoundingClientRect().width>=180"), bad)
            await pg.set_viewport_size({'width': 1440, 'height': 900}); await wait(300)
            # ---- lazy mermaid: diagram far below the fold is not rendered until scrolled into view
            body = '# 长文\n\n' + '\n\n'.join('段落 %d ' % i + '内容 ' * 40 for i in range(120)) + '\n\n```mermaid\ngraph LR\n  X[底部] --> Y[图]\n```\n'
            await ev("ChipBench.fs.write('C:\\\\Work\\\\long.md', " + json.dumps(body) + ")"); await ev("ChipBench.openPath('C:\\\\Work\\\\long.md')"); await wait(1500)
            chk('mermaid below the fold not rendered yet', not await ev("[...document.querySelectorAll('.cm-content svg')].some(s=>s.textContent.includes('底部'))"))
            await ev("ChipBench.app.goLine(240)"); await wait(2500)
            chk('mermaid renders once scrolled into view', await ev("[...document.querySelectorAll('.cm-content svg')].some(s=>s.textContent.includes('底部'))"))
            chk('no page errors', not [e for e in errs if 'pageerror' in e], errs[:5])
            await b.close()
    print(json.dumps({'passed': sum(R.values()), 'total': len(R), 'fails': fails}, ensure_ascii=False))
asyncio.run(main())

import sys as _sys; _sys.exit(1 if fails else 0)  # CI: non-zero exit on any failed check
