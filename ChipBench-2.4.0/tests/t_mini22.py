"""2.2 · IP Studio minimap: shown only when there is something to navigate (a big diagram that scrolls), shows the whole diagram and the part you are looking at,
click / drag moves the view, follows scrolling and the inspector, and leaves no global listeners behind."""
import asyncio, json, pathlib, subprocess
from util import *; from base_fs import *
R = {}; fails = []
def chk(name, cond, info=None):
    R[name] = bool(cond)
    if not cond: fails.append(name); print('FAIL', name, info if info is not None else '')
    else: print('  ok ', name)
ROOT_ = pathlib.Path(__file__).resolve().parent.parent
def gen(n): subprocess.run(['node', str(ROOT_ / 'tools/gen-large-ip.js'), str(n), '/tmp/_m%d.cbip' % n], capture_output=True, text=True, check=True); return pathlib.Path('/tmp/_m%d.cbip' % n).read_text('utf-8')
SMALL = json.dumps(dict(schema='chipbench.ip/1', id='s', name='小', kind='instance', rev=1, chip='', family='', extends='', source='', docrev='', description='', refs=[], registers={}, scenes=[],
  nodes=[dict(id='a', type='cpu', kind='cpu', name='A', params={}, ports=[], registers=[], ev={'level': '待核对'}), dict(id='b', type='mem', kind='mem', name='B', params={}, ports=[], registers=[], ev={'level': '待核对'})], edges=[dict(id='e', source='a', target='b', type='data', ev={})]))
SEL = ".view-host:not(.hide) "
INIT = """
(()=>{ const live=new Map(); let n=0; const ids=new WeakMap(); const id=o=>{ if(!ids.has(o)) ids.set(o,++n); return ids.get(o); };
 for (const [name,T] of [['window',window],['document',document]]) { const a=T.addEventListener.bind(T), r=T.removeEventListener.bind(T);
   T.addEventListener=function(ty,fn,o){ if(typeof fn==='function' && /^(mousemove|mouseup|keydown|resize|wheel)$/.test(ty)) live.set(name+'|'+ty+'|'+id(fn)+'|'+((o===true||(o&&o.capture))?'c':'b'),1); return a(ty,fn,o); };
   T.removeEventListener=function(ty,fn,o){ if(typeof fn==='function') live.delete(name+'|'+ty+'|'+id(fn)+'|'+((o===true||(o&&o.capture))?'c':'b')); return r(ty,fn,o); }; }
 window.__live=()=>live.size; })();
"""
async def main():
    with Server() as srv:
        async with async_playwright() as p:
            fs = base_fs(); fs['C:\\Work\\IP'] = {'dir': 1}; fs['C:\\Work\\IP\\s.cbip'] = {'t': SMALL}; fs['C:\\Work\\IP\\big.cbip'] = {'t': gen(100)}
            b, ctx, pg, errs = await launch(p, srv, fs, w=1400, h=800, extra_init=INIT); ev = pg.evaluate
            async def wait(ms=300): await pg.wait_for_timeout(ms)
            async def open_(path):
                await ev("ChipBench.openPath(%s)" % json.dumps(path)); await pg.wait_for_selector(SEL + '.ipm .ipb-node', timeout=60000); await wait(1200)
            MINI = SEL + '.ipm-mini'
            async def info(): return await ev("""(()=>{const m=document.querySelector('.view-host:not(.hide) .ipm-mini'); if(!m) return null; const c=m.querySelector('canvas').getBoundingClientRect(), v=m.querySelector('.ipm-mv').getBoundingClientRect(), mr=m.getBoundingClientRect(); const sc=document.querySelector('.view-host:not(.hide) .ipm-canvas'); if(sc && !(sc.scrollHeight>sc.clientHeight+6||sc.scrollWidth>sc.clientWidth+6)) { /* not scrollable */ } return {hidden:m.hidden||getComputedStyle(m).display==='none', cw:Math.round(c.width), ch:Math.round(c.height), v:[v.left-c.left, v.top-c.top, v.width, v.height], box:[mr.left, mr.top, mr.right, mr.bottom], sc: sc?[sc.scrollLeft, sc.scrollTop, sc.scrollWidth, sc.scrollHeight, sc.clientWidth, sc.clientHeight]:null, cvr:[c.left,c.top]};})()""")
            await wait(500); await ev("ChipBench.ipstudio.warm()")
            await open_('C:\\Work\\IP\\s.cbip'); i0 = await info(); chk('a small diagram has no minimap (nothing to navigate)', i0 is None or i0['hidden'], i0)
            await open_('C:\\Work\\IP\\big.cbip'); i = await info()
            chk('a big diagram that scrolls shows the minimap', i and not i['hidden'] and i['cw'] == 176 and i['ch'] == 116, i)
            chk('…with a viewport rectangle that is smaller than the map (you see part of the diagram)', i['v'][2] > 4 and i['v'][3] > 4 and (i['v'][2] < i['cw'] - 2 or i['v'][3] < i['ch'] - 2), i['v'])
            chk('…and drawn at the top-left to begin with (scroll position 0)', i['v'][1] <= 12 and i['sc'][1] == 0, [i['v'], i['sc']])
            ph = await ev("(()=>{const c=document.querySelector('.view-host:not(.hide) .ipm-mini canvas'); const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data; let n=0; const rows=new Set(); for(let k=3;k<d.length;k+=4) if(d[k]>40){ n++; rows.add(Math.floor((k>>2)/c.width)); } return [n, rows.size];})()")
            chk('the map is actually painted: boxes at many different heights (this diagram is tall and narrow, so only ~33 px wide)', ph[0] > 150 and ph[1] > 60, ph)
            # layout: sits next to the inspector, never over it
            side = await ev("(()=>{const s=document.querySelector('.view-host:not(.hide) .ipm-side'); const r=s.getBoundingClientRect(); return [r.left, r.width, getComputedStyle(s).display];})()")
            chk('the minimap sits left of the inspector (does not cover it)', i['box'][2] <= side[0] + 1, [i['box'], side])
            await ev("document.querySelector('.view-host:not(.hide) [data-a=side]').click()"); await wait(500); i2 = await info()
            chk('hiding the inspector moves the minimap to the right edge', i2['box'][2] > i['box'][2] + 150, [i['box'][2], i2['box'][2]])
            await ev("document.querySelector('.view-host:not(.hide) [data-a=side]').click()"); await wait(400)
            # click to navigate
            i = await info(); tx, ty = i['cvr'][0] + i['cw'] * 0.5, i['cvr'][1] + i['ch'] * 0.85
            await pg.mouse.click(tx, ty); await wait(500); j = await info()
            chk('clicking lower on the map scrolls the diagram down', j['sc'][1] > i['sc'][1] + 100, [i['sc'], j['sc']])
            chk('…and the viewport rectangle moves down with it', j['v'][1] > i['v'][1] + 10, [i['v'], j['v']])
            cy = j['v'][1] + j['v'][3] / 2; chk('…centred (within a few px) on where you clicked', abs(cy - i['ch'] * 0.85) < 14 or j['sc'][1] + j['sc'][5] >= j['sc'][3] - 2, [cy, i['ch'] * 0.85, j['sc']])
            # drag
            await pg.mouse.move(i['cvr'][0] + i['cw'] * 0.5, i['cvr'][1] + i['ch'] * 0.85); await pg.mouse.down(); await pg.mouse.move(i['cvr'][0] + i['cw'] * 0.5, i['cvr'][1] + i['ch'] * 0.1, steps=8); await pg.mouse.up(); await wait(500); k = await info()
            chk('dragging on the map moves the view continuously (back to near the top)', k['sc'][1] < j['sc'][1] - 100, [j['sc'], k['sc']])
            lv = await ev("window.__live()"); await pg.mouse.move(100, 100); await wait(100); chk('while you are not dragging there are no extra document listeners for it (a drag adds then removes them)', await ev("window.__live()") == lv)
            # scroll → rectangle follows
            await ev("(()=>{const sc=document.querySelector('.view-host:not(.hide) .ipm-canvas'); sc.scrollTop = 400;})()"); await wait(400); m2 = await info()
            chk('scrolling the diagram moves the viewport rectangle', m2['v'][1] > k['v'][1] + 4, [k['v'], m2['v']])
            # follows structural changes
            await ev("(()=>{const V=ChipBench.app.current().viewer; V.commit([{op:'add_node',node:{id:'zz',kind:'periph',name:'新'}}],'x');})()"); await wait(1500); m3 = await info()
            chk('after an edit the minimap is repainted and still visible', m3 and not m3['hidden'])
            # closing the tab removes everything
            n0 = await ev("window.__live()"); await ev("ChipBench.app.close(ChipBench.app.cur, true)"); await wait(500)
            chk('closing the tab leaves no listeners behind', await ev("window.__live()") <= n0, [n0, await ev("window.__live()")])
            chk('no console errors', not [e for e in errs if 'ELK' not in e], errs[:3])
            await b.close()
    print(json.dumps({'passed': sum(R.values()), 'total': len(R), 'fails': fails}, ensure_ascii=False))
asyncio.run(main())
