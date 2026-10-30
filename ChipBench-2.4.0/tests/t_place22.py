"""2.2 · manual placement, multi-select, minimap in IP Studio.
drag a node = move it (saved as an offset in the layout sidecar, ELK does not run again) · drop ON another node = connect / move inside (as before) ·
drag on empty canvas = marquee · Shift / Ctrl+click = multi-select (group / delete / drag together) · reset positions · minimap for big diagrams."""
import asyncio, json, pathlib, subprocess
from util import *; from base_fs import *
R = {}; fails = []
def chk(name, cond, info=None):
    R[name] = bool(cond)
    if not cond: fails.append(name); print('FAIL', name, info if info is not None else '')
    else: print('  ok ', name)
ROOT_ = pathlib.Path(__file__).resolve().parent.parent
def node(i, kind, name, **k): return dict(id=i, type=kind, kind=kind, name=name, params={}, ports=k.get('ports', []), registers=[], ev={'level': '待核对'}, **({'parent': k['parent']} if k.get('parent') else {}))
def port(i, t, d): return dict(id=i, type=t, dir=d)
MODEL = dict(schema='chipbench.ip/1', id='pl', name='摆放示例', kind='instance', rev=1, chip='', family='', extends='', source='', docrev='', description='', refs=[], registers={}, scenes=[],
  nodes=[node('cpu', 'cpu', 'CPU', ports=[port('bus', 'bus', 'out')]), node('sub', 'group', '子系统'), node('can', 'periph', 'CAN', parent='sub', ports=[port('bus', 'bus', 'in'), port('irq', 'irq', 'out')]), node('eth', 'periph', 'ETH', parent='sub', ports=[port('bus', 'bus', 'in')]),
         node('intc', 'irq', 'INTC', ports=[port('in0', 'irq', 'in')]), node('far', 'ext', '收发器'), node('tim', 'periph', 'TIM', ports=[port('bus', 'bus', 'in')])],
  edges=[dict(id='e1', source='cpu.bus', target='can.bus', type='bus', ev={}), dict(id='e2', source='cpu.bus', target='eth.bus', type='bus', ev={}), dict(id='e3', source='can.irq', target='intc.in0', type='irq', ev={}), dict(id='e4', source='can', target='far', type='data', ev={}), dict(id='e5', source='cpu.bus', target='tim.bus', type='bus', ev={})])
def gen(n): subprocess.run(['node', str(ROOT_ / 'tools/gen-large-ip.js'), str(n), '/tmp/_p%d.cbip' % n], capture_output=True, text=True, check=True); return pathlib.Path('/tmp/_p%d.cbip' % n).read_text('utf-8')
SEL = ".view-host:not(.hide) "; P = 'C:\\Work\\IP\\pl.cbip'; PB = 'C:\\Work\\IP\\big.cbip'
async def main():
    with Server() as srv:
        async with async_playwright() as p:
            fs = base_fs(); fs['C:\\Work\\IP'] = {'dir': 1}; fs[P] = {'t': json.dumps(MODEL, ensure_ascii=False)}; fs[PB] = {'t': gen(100)}
            b, ctx, pg, errs = await launch(p, srv, fs, w=1500, h=900); ev = pg.evaluate; V = "ChipBench.app.current().viewer"
            async def wait(ms=300): await pg.wait_for_timeout(ms)
            async def text(p_): return await ev("(window.__FS[%s]||{}).t || null" % json.dumps(p_))
            async def lay(): t = await text(P + '.layout.json'); return json.loads(t) if t else None
            async def box(i): return await ev("(()=>{const e=document.querySelector('.view-host:not(.hide) [data-id=\"%s\"]:not([data-clone])'); if(!e) return null; const r=(e.querySelector('.ipb-box')||e.querySelector('rect')||e).getBoundingClientRect(); return [r.x, r.y, r.width, r.height, r.x+r.width/2, r.y+r.height/2];})()" % i)
            async def boxU(i):   # position in DIAGRAM units (independent of the fit-to-width scale)
                return await ev("(()=>{const e=document.querySelector('.view-host:not(.hide) [data-id=\"%s\"]:not([data-clone])'); if(!e) return null; const s=document.querySelector('.view-host:not(.hide) svg.ipb-svg'), sr=s.getBoundingClientRect(), k=s.viewBox.baseVal.width/sr.width, r=(e.querySelector('.ipb-box')||e.querySelector('rect')).getBoundingClientRect(); return [(r.left-sr.left)*k, (r.top-sr.top)*k];})()" % i)
            async def drag(frm, to_xy, steps=8):
                a = await box(frm); ax, ay = a[4], a[5]
                await pg.mouse.move(ax, ay); await pg.mouse.down(); await pg.mouse.move(ax + 12, ay + 8, steps=2); await pg.mouse.move(to_xy[0], to_xy[1], steps=steps); await wait(120); await pg.mouse.up(); await wait(500)
            async def open_(path):
                await ev("ChipBench.openPath(%s)" % json.dumps(path)); await pg.wait_for_selector(SEL + '.ipm .ipb-node', timeout=60000); await wait(900)
            await wait(500); await ev("ChipBench.ipstudio.warm()"); await open_(P)
            # ---- move a node into empty space
            before = await box('tim'); cv = await ev("(()=>{const r=document.querySelector('.view-host:not(.hide) .ipm-canvas').getBoundingClientRect(); return [r.x, r.y, r.width, r.height];})()")
            ex, ey = cv[0] + cv[2] - 120, cv[1] + cv[3] - 80
            await drag('tim', (ex, ey)); after = await box('tim')
            chk('dragging a node moves it where you let go (within a few px)', abs(after[4] - ex) < 12 and abs(after[5] - ey) < 12, [before[4:6], after[4:6], (ex, ey)])
            chk('no menu appears when you drop on empty space (it is just a move)', not await ev("!!document.querySelector('.menu-pop')"))
            L = await lay(); chk('the move is saved as an offset in the layout sidecar (not in the model)', L and 'tim' in L['positions'] and (L['positions']['tim']['dx'] or L['positions']['tim']['dy']), L)
            m = json.loads(await text(P)); chk('the model file itself is untouched (rev unchanged, no coordinates in it)', m['rev'] == 1 and 'positions' not in json.dumps(m) and 'tim' in [n['id'] for n in m['nodes']])
            chk('the toolbar now offers “重置位置”', '重置位置' in await ev("document.querySelector('.view-host:not(.hide) .ipm-bar').innerText"))
            e5 = await ev("(()=>{const e=[...document.querySelectorAll('.view-host:not(.hide) .ipb-edge')].find(x=>x.dataset.to==='tim.bus'||x.dataset.to==='tim'); if(!e) return null; const d=e.querySelector('path').getAttribute('d'); const pts=d.replace('M','').split(' L').map(s=>s.split(',').map(Number)); return pts[pts.length-1];})()")
            tb = await ev("(()=>{const r=document.querySelector('.view-host:not(.hide) [data-id=\"tim\"] .ipb-box').getBoundingClientRect(); const s=document.querySelector('.view-host:not(.hide) svg.ipb-svg'), sr=s.getBoundingClientRect(), k=s.viewBox.baseVal.width/sr.width; return [(r.left-sr.left)*k,(r.right-sr.left)*k,(r.top-sr.top)*k,(r.bottom-sr.top)*k];})()")
            chk('the link to the moved node follows: its end touches the node’s box', e5 and tb[0] - 3 <= e5[0] <= tb[1] + 3 and tb[2] - 3 <= e5[1] <= tb[3] + 3, [e5, tb])
            # ---- survives reopening, without running ELK again
            await ev("ChipBench.app.close(ChipBench.app.cur, true)"); await wait(400); await ev("window.__elkCalls = 0; const _l = ChipBench.elk.layout; ChipBench.elk.layout = function(g,o){ window.__elkCalls++; return _l.apply(this, arguments); }; 0")
            await open_(P); a2 = await box('tim'); chk('reopening restores the position', abs(a2[4] - after[4]) < 6 and abs(a2[5] - after[5]) < 6, [after[4:6], a2[4:6]])
            n0 = await ev("window.__elkCalls"); await drag('tim', (ex - 140, ey - 60)); n1 = await ev("window.__elkCalls")
            chk('moving a node does not run the layout engine again beyond the cached layout (ELK is asked with the same graph → cache)', n1 - n0 <= 1 and await ev("ChipBench.elk.lastCached === true"), [n0, n1, await ev("ChipBench.elk.lastCached")])
            # ---- moving a GROUP moves its members; group moved on screen, members keep relative positions
            ca, ea = await box('can'), await box('eth'); ga = await box('sub')
            await drag('sub', (ga[4] + 100, ga[5] + 70)); cb, eb, gb = await box('can'), await box('eth'), await box('sub')
            chk('dragging a group moves every member by the same amount', abs((cb[4] - ca[4]) - (eb[4] - ea[4])) < 3 and abs((cb[5] - ca[5]) - (eb[5] - ea[5])) < 3 and cb[4] - ca[4] > 60, [cb[4] - ca[4], eb[4] - ea[4]])
            chk('…and the relative position of the members is unchanged', abs((eb[4] - cb[4]) - (ea[4] - ca[4])) < 3 and abs((eb[5] - cb[5]) - (ea[5] - ca[5])) < 3)
            L = await lay(); chk('only the group got an offset (the members carry none of their own)', 'sub' in L['positions'] and 'can' not in L['positions'] and 'eth' not in L['positions'], list(L['positions']))
            # ---- one member out of its group: ask
            ca = await box('can'); gx = await ev("(()=>{const r=document.querySelector('.view-host:not(.hide) .ipb-group[data-id=\"sub\"] > rect').getBoundingClientRect(); return [r.x, r.y, r.width, r.height];})()")   # the group FRAME (not its label)
            # a point outside the frame that is truly empty: try to the right, then below, until nothing but canvas is under it
            def_pt = await ev("""((fx,fy,fw,fh,cx,cy,cw,ch)=>{ const ok=(x,y)=>{ if(x<cx+10||y<cy+10||x>cx+cw-10||y>cy+ch-10) return false; if(x>=fx-4&&x<=fx+fw+4&&y>=fy-4&&y<=fy+fh+4) return false; const el=document.elementFromPoint(x,y); return !!el && !el.closest('.ipb-node, .ipb-group, .ipb-edge, .ipm-mini, .ipm-find, .ipm-focus, .ipm-side'); };
                for (let dy=0; dy<=Math.max(fh, 200)+300; dy+=24) for (let dx=40; dx<=700; dx+=24) { const x=fx+fw+dx, y=fy+dy; if(ok(x,y)) return [x,y]; } for (let dx=0; dx<=fw; dx+=24) for (let dy=30; dy<=400; dy+=24){ const x=fx+dx, y=fy+fh+dy; if(ok(x,y)) return [x,y]; } return null; })(%f,%f,%f,%f,%f,%f,%f,%f)""" % (gx[0], gx[1], gx[2], gx[3], cv[0], cv[1], cv[2], cv[3]))
            chk('(test setup) found empty space outside the group', def_pt is not None, def_pt)
            await drag('can', tuple(def_pt)); mt = await ev("document.querySelector('.menu-pop') ? document.querySelector('.menu-pop').innerText : ''")
            chk('dragging a member outside its group asks: stay in it (group grows) or leave it', '留在' in mt and '移出' in mt, mt)
            mp = await ev("(()=>{const m=document.querySelector('.menu-pop'); if(!m) return null; const r=m.getBoundingClientRect(); return [Math.round(r.left),Math.round(r.top),Math.round(r.right),Math.round(r.bottom), innerWidth, innerHeight];})()"); chk('the menu opens fully inside the window', mp and mp[0] >= 0 and mp[1] >= 0 and mp[2] <= mp[4] and mp[3] <= mp[5], mp)
            await wait(400); await ev("document.querySelector('.menu-pop [data-k=here]').click()"); await wait(700); gg = await box('sub'); cc = await box('can')
            chk('“stay”: the group grows to contain the node', cc[0] >= gg[0] - 2 and cc[0] + cc[2] <= gg[0] + gg[2] + 2 and gg[2] > gx[2] + 20, [gx[2], gg[2]])
            m = json.loads(await text(P)); chk('…and the model still has the node in the group', next(n for n in m['nodes'] if n['id'] == 'can').get('parent') == 'sub')
            # ---- drop ON a node: connect / move inside (unchanged behaviour)
            far = await box('far'); await drag('intc', (far[4], far[5])); mt = await ev("document.querySelector('.menu-pop') ? document.querySelector('.menu-pop').innerText : ''")
            chk('dropping a node ON another still offers connect / move inside', '连线' in mt and '移入' in mt, mt)
            await pg.keyboard.press('Escape'); await wait(300)
            # ---- reset
            await pg.click(SEL + '[data-a=resetpos]'); await wait(900); L = await lay(); chk('“重置位置” clears every offset', L and not L['positions'], L)
            t2 = await box('tim'); chk('…and the node is back where the automatic layout put it', abs(t2[4] - before[4]) < 6 and abs(t2[5] - before[5]) < 6, [before[4:6], t2[4:6]])
            chk('the reset button disappears when there is nothing to reset', '重置位置' not in await ev("document.querySelector('.view-host:not(.hide) .ipm-bar').innerText"))
            # ---- single-node reset from the detail pane
            await drag('tim', (ex, ey)); await pg.click(SEL + '.ipb-node[data-id="tim"]'); await wait(400)
            chk('a placed node shows its offset and a button to put it back', '已手动摆放' in await ev("document.querySelector('.view-host:not(.hide) .ipm-pane').innerText"))
            await pg.click(SEL + '.ipm-pane [data-a=unpin]'); await wait(800); L = await lay(); chk('that button clears just that node', 'tim' not in L['positions'])
            # ---- a tiny movement is still a click
            rev = json.loads(await text(P))['rev']; a = await box('cpu'); await pg.mouse.move(a[4], a[5]); await pg.mouse.down(); await pg.mouse.move(a[4] + 2, a[5] + 1); await pg.mouse.up(); await wait(300)
            L = await lay(); chk('a click with a tiny movement selects (no move, no offset)', await ev("%s.state.sel && %s.state.sel.id" % (V, V)) == 'cpu' and not (L and L['positions']))
            # ---- multi-select
            await pg.click(SEL + '.ipb-node[data-id="can"]'); await pg.keyboard.down('Shift'); await pg.click(SEL + '.ipb-node[data-id="eth"]'); await pg.keyboard.up('Shift'); await wait(400)
            ms = await ev("%s.state.msel" % V); chk('Shift+click adds to the selection (the first click counts)', sorted(ms) == ['can', 'eth'], ms)
            pt = await ev("document.querySelector('.view-host:not(.hide) .ipm-pane').innerText"); chk('the inspector shows “已选 2 个” with group / delete actions', '已选 2 个' in pt and '放进新分组' in pt and '删除所选' in pt, pt[:100])
            chk('selected nodes are outlined in the diagram', await ev("document.querySelectorAll('.view-host:not(.hide) .msel').length") == 2)
            await pg.keyboard.down('Shift'); await pg.click(SEL + '.ipb-node[data-id="can"]'); await pg.keyboard.up('Shift'); await wait(300); chk('Shift+click on a selected node removes it (one left → a normal selection)', await ev("%s.state.msel.length" % V) == 0 and await ev("%s.state.sel.id" % V) == 'eth')
            # ---- marquee
            await pg.keyboard.press('Escape'); a, c2, i2 = await box('cpu'), await box('can'), await box('intc'); x0, y0 = min(a[0], c2[0], i2[0]) - 25, min(a[1], c2[1], i2[1]) - 25; x1, y1 = max(a[0] + a[2], c2[0] + c2[2], i2[0] + i2[2]) + 25, max(a[1] + a[3], c2[1] + c2[3], i2[1] + i2[3]) + 25
            await pg.mouse.move(x0, y0); await pg.mouse.down(); await pg.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, steps=4); band = await ev("!!document.querySelector('.ipm-band')"); await pg.mouse.move(x1, y1, steps=4); await pg.mouse.up(); await wait(400)
            chk('dragging on empty canvas draws a rectangle while you drag', band)
            ms = await ev("%s.state.msel" % V); chk('…and selects everything it touches', {'cpu', 'can', 'intc'} <= set(ms), ms)
            chk('the rectangle is removed afterwards', not await ev("!!document.querySelector('.ipm-band')"))
            # ---- drag the multi-selection together
            ma, mb = await boxU('cpu'), await boxU('intc'); sc = await box('cpu'); await drag('cpu', (sc[4] + 90, sc[5] + 50)); na, nb = await boxU('cpu'), await boxU('intc')
            chk('dragging one of the selected nodes moves all of them together (same shift in diagram units)', abs((na[0] - ma[0]) - (nb[0] - mb[0])) < 2 and abs((na[1] - ma[1]) - (nb[1] - mb[1])) < 2 and na[0] - ma[0] > 60, [na[0] - ma[0], nb[0] - mb[0], na[1] - ma[1], nb[1] - mb[1]])
            L = await lay(); chk('…each selected top-level item gets the same offset', L['positions'].get('cpu') and L['positions'].get('intc') and L['positions']['cpu'] == L['positions']['intc'], L['positions'])
            await pg.click(SEL + '[data-a=resetpos]'); await wait(700)
            # ---- group the selection
            await pg.click(SEL + '.ipb-node[data-id="tim"]'); await pg.keyboard.down('Shift'); await pg.click(SEL + '.ipb-node[data-id="far"]'); await pg.keyboard.up('Shift'); await wait(300)
            await pg.click(SEL + '.ipm-pane [data-a=ms-group]'); await pg.wait_for_selector('.modal input', timeout=3000); await pg.fill('.modal input', '杂项'); await pg.keyboard.press('Enter'); await wait(900); m = json.loads(await text(P))
            g = next((n for n in m['nodes'] if n['name'] == '杂项'), None); chk('“放进新分组”: one new group, both nodes are its children, one undo step', g and g['kind'] == 'group' and all(next(n for n in m['nodes'] if n['id'] == i).get('parent') == g['id'] for i in ('tim', 'far')) and m['rev'] == 2, g)
            await pg.click(SEL + '[data-a=undo]'); await wait(700); m = json.loads(await text(P)); chk('undo removes the group and puts the nodes back', not any(n['name'] == '杂项' for n in m['nodes']) and m['rev'] == 1)
            # ---- delete the selection
            await pg.click(SEL + '.ipb-node[data-id="tim"]'); await pg.keyboard.down('Shift'); await pg.click(SEL + '.ipb-node[data-id="far"]'); await pg.keyboard.up('Shift'); await wait(300)
            await pg.click(SEL + '.ipm-pane [data-a=ms-del]'); await pg.wait_for_selector('.modal'); mt = await ev("document.querySelector('.modal').innerText"); chk('delete asks first and says how many nodes and links go', '2 项' in mt and '连线' in mt, mt)
            await pg.click('.modal button:has-text("取消")'); await wait(300); chk('cancel keeps everything', len(json.loads(await text(P))['nodes']) == 7)
            await pg.click(SEL + '.ipm-pane [data-a=ms-del]'); await pg.wait_for_selector('.modal'); await pg.click('.modal button:has-text("删除")'); await wait(900); m = json.loads(await text(P)); ids = [n['id'] for n in m['nodes']]
            chk('confirmed: both nodes and their links are gone in ONE step', 'tim' not in ids and 'far' not in ids and not any(e['id'] in ('e4', 'e5') for e in m['edges']) and m['rev'] == 2, [ids, m['rev']])
            await pg.click(SEL + '[data-a=undo]'); await wait(700); chk('one undo brings them back', len(json.loads(await text(P))['nodes']) == 7)
            # ---- while recording a scene step, the rectangle picks nodes for the step
            await ev("(()=>{const m=ChipBench.IPM.apply(%s.state.model,[{op:'add_scene',scene:{id:'s',name:'S',steps:[]}}]); return m.ok;})()" % V); await ev("%s.commit([{op:'add_scene',scene:{id:'s',name:'S',steps:[]}}],'scene')" % V); await wait(700)
            await ev("%s.scenes.pick('s'); %s.scenes.record('add', 0)" % (V, V)); await wait(500)
            a, c2 = await box('cpu'), await box('can'); await pg.mouse.move(min(a[0], c2[0]) - 25, min(a[1], c2[1]) - 25); await pg.mouse.down(); await pg.mouse.move(max(a[0] + a[2], c2[0] + c2[2]) + 25, max(a[1] + a[3], c2[1] + c2[3]) + 25, steps=6); await pg.mouse.up(); await wait(500)
            dn = await ev("%s.state.draft.step.nodes" % V); chk('recording a step: the rectangle adds the nodes to the step (no multi-selection)', {'cpu', 'can'} <= set(dn) and await ev("%s.state.msel.length" % V) == 0, dn)
            real = [e for e in errs if 'ELK' not in e]; chk('no console errors', not real, real[:4])
            await b.close()
    print(json.dumps({'passed': sum(R.values()), 'total': len(R), 'fails': fails}, ensure_ascii=False))
asyncio.run(main())
