"""2.2 · big models: a 300-node chip opens as an OVERVIEW (top-level groups collapsed, parallel links merged ×N), groups open on double-click, expanding all asks first,
highlighting in big diagrams uses a veil (cost ∝ lit items), hover emphasises edges without dimming, an edit that does not change the drawing does not rebuild it,
a failed layout offers a way out, and a big model without groups is simply laid out."""
import asyncio, json, pathlib, subprocess
from util import *; from base_fs import *
R = {}; fails = []
def chk(name, cond, info=None):
    R[name] = bool(cond)
    if not cond: fails.append(name); print('FAIL', name, info if info is not None else '')
    else: print('  ok ', name)
ROOT_ = pathlib.Path(__file__).resolve().parent.parent
def gen(n): subprocess.run(['node', str(ROOT_ / 'tools/gen-large-ip.js'), str(n), '/tmp/_b%d.cbip' % n], capture_output=True, text=True, check=True); return pathlib.Path('/tmp/_b%d.cbip' % n).read_text('utf-8')
def flat(n):
    nodes = [dict(id='cpu', type='cpu', kind='cpu', name='CPU', params={}, ports=[dict(id='bus', type='bus', dir='out')], registers=[], ev={'level': '待核对'})]; edges = []
    for i in range(n):
        nodes.append(dict(id='p%d' % i, type='periph', kind='periph', name='外设 %d' % i, params={}, ports=[dict(id='bus', type='bus', dir='in')], registers=[], ev={'level': '待核对'})); edges.append(dict(id='e%d' % i, source='cpu.bus', target='p%d.bus' % i, type='bus', ev={}))
    return json.dumps(dict(schema='chipbench.ip/1', id='flat', name='无分组大模型', kind='instance', rev=1, chip='', family='', extends='', source='', docrev='', description='', refs=[], nodes=nodes, edges=edges, registers={}, scenes=[]))
SEL = ".view-host:not(.hide) "; P = 'C:\\Work\\Big\\big.cbip'; PF = 'C:\\Work\\Big\\flat.cbip'
async def main():
    with Server() as srv:
        async with async_playwright() as p:
            fs = base_fs(); fs['C:\\Work\\Big'] = {'dir': 1}; fs[P] = {'t': gen(300)}; fs[PF] = {'t': flat(150)}
            b, ctx, pg, errs = await launch(p, srv, fs); ev = pg.evaluate; V = "ChipBench.app.current().viewer"
            async def wait(ms=300): await pg.wait_for_timeout(ms)
            async def text(p_): return await ev("(window.__FS[%s]||{}).t || null" % json.dumps(p_))
            NODES = "document.querySelectorAll('.view-host:not(.hide) .ipb-node').length"
            async def until(js, cmp, limit=60000): return await ev("(async()=>{const t0=performance.now(); while(performance.now()-t0<%d){ const n=%s; if(n %s) return Math.round(performance.now()-t0); await new Promise(x=>setTimeout(x,25)); } return -1;})()" % (limit, js, cmp))
            await wait(500); await ev("ChipBench.ipstudio.warm()")
            await ev("ChipBench.openPath(%s)" % json.dumps(P)); await pg.wait_for_selector(SEL + '.ipm .ipb-node', timeout=60000); await wait(500)
            n_groups = await ev("ChipBench.app.current().viewer.state.model.nodes.filter(n=>n.kind==='group').length"); blocks = await ev(NODES)
            chk('a 300-node model opens as an overview: one block per group + CPU + INTC', blocks == n_groups + 2 and n_groups >= 10, [blocks, n_groups])
            bn = await ev("(()=>{const e=document.querySelector('.view-host:not(.hide) .ipm-big'); return e?e.innerText:null;})()"); chk('a banner says how many nodes are folded into how many groups', bn and '大模型' in bn and '展开全部' in bn and str(n_groups) in bn, bn)
            labels = await ev("[...document.querySelectorAll('.view-host:not(.hide) .ipb-edge text')].map(t=>t.textContent).filter(x=>/^×\\d+$/.test(x))"); links = await ev("document.querySelectorAll('.view-host:not(.hide) .ipb-edge').length")
            chk('the overview has few links, merged parallel ones are labelled ×N', links < 60 and len(labels) >= 5 and max(int(x[1:]) for x in labels) >= 10, [links, labels[:6]])
            chk('the toolbar says all nodes are in the model (not just the visible ones)', '287 个节点' in await ev("document.querySelector('.view-host:not(.hide) .ipm-bar').innerText"), await ev("document.querySelector('.view-host:not(.hide) .ipm-bar').innerText"))
            chk('nothing was written to disk just by opening (the overview is derived)', await text(P + '.layout.json') is None)
            # select / details in the overview
            await pg.click(SEL + '.ipb-node[data-id="g3"]'); await wait(300); pt = await ev("document.querySelector('.view-host:not(.hide) .ipm-pane').innerText")
            chk('clicking a group block shows its details with an expand button', '子系统 3' in pt and '展开分组' in pt, pt[:120])
            # search in the overview highlights the group that holds the hit
            await ev("(()=>{const i=document.querySelector('.view-host:not(.hide) .ipm-find input'); i.value='IP 7.4'; i.dispatchEvent(new Event('input'));})()"); await wait(300)
            hit = await ev("[...document.querySelectorAll('.view-host:not(.hide) .ipb-node.fm, .view-host:not(.hide) .ipb-group.fm')].map(n=>n.dataset.id)"); chk('search finds a node inside a folded group and lights the group it is in', hit == ['g7'], hit)
            await ev("(()=>{const i=document.querySelector('.view-host:not(.hide) .ipm-find input'); i.value=''; i.dispatchEvent(new Event('input'));})()"); await wait(200)
            # open ONE group with a double click
            svg0 = await ev("(window.__svg0 = document.querySelector('.view-host:not(.hide) svg.ipb-svg'), 1)")
            await ev("document.querySelector('.view-host:not(.hide) .ipb-node[data-id=\"g3\"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))")
            took = await until(NODES, '> %d' % (blocks + 5)); after = await ev(NODES); chk('double-click opens just that group', took > 0 and blocks + 15 <= after <= blocks + 25 and await ev("!!document.querySelector('.view-host:not(.hide) .ipb-group[data-id=\"g3\"]')"), [blocks, after])
            lay = json.loads(await text(P + '.layout.json')); chk('your choice is saved in the layout sidecar (manual) and the other groups stay folded', lay['view'].get('collapse') == 'manual' and 'g3' not in lay['collapsed'] and len(lay['collapsed']) == n_groups - 1, lay['view'])
            chk('the “big model” banner is gone once you chose yourself', not await ev("!!document.querySelector('.view-host:not(.hide) .ipm-big')"))
            chk('the model file itself is untouched by all that', json.loads(await text(P)) == json.loads(gen(300)))
            # reopen: manual state is respected
            await ev("ChipBench.app.close(ChipBench.app.cur, true)"); await wait(400); await ev("ChipBench.openPath(%s)" % json.dumps(P)); await pg.wait_for_selector(SEL + '.ipm .ipb-node', timeout=60000); await wait(700)
            chk('reopening restores your folding (not the automatic overview)', await ev(NODES) == after and not await ev("!!document.querySelector('.view-host:not(.hide) .ipm-big')"), [await ev(NODES), after])
            # collapse all → overview again (toolbar) → then expand all asks first
            await ev("document.querySelector('.view-host:not(.hide) [data-a=collapse]').click()"); await until(NODES, '< %d' % (blocks + 3)); chk('the toolbar button folds everything', await ev(NODES) == blocks, await ev(NODES))
            await wait(900); lay = json.loads(await text(P + '.layout.json'))   # let the debounced layout write land before we delete it
            # remove the saved manual state to get the automatic overview back, then use the banner
            await ev("window.__FS[%s] = undefined; delete window.__FS[%s]" % (json.dumps(P + '.layout.json'), json.dumps(P + '.layout.json'))); await ev("ChipBench.app.close(ChipBench.app.cur, true)"); await wait(400)
            await ev("ChipBench.openPath(%s)" % json.dumps(P)); await pg.wait_for_selector(SEL + '.ipm .ipb-node', timeout=60000); await wait(600)
            await pg.click(SEL + '[data-a=expandall]'); await pg.wait_for_selector('.modal', timeout=3000); mt = await ev("document.querySelector('.modal').innerText"); chk('“expand all” asks first, names the block count and warns it is slow', '272' in mt and '慢' in mt, mt)
            await pg.click('.modal button:has-text("取消")'); await wait(300); chk('cancel keeps the overview', await ev(NODES) == blocks)
            await pg.click(SEL + '[data-a=expandall]'); await pg.wait_for_selector('.modal'); await pg.click('.modal button:has-text("展开全部")')
            took = await until(NODES, '> 200', 90000); chk('confirming shows all blocks (and the diagram is flagged big)', took > 0 and await ev("document.querySelector('.view-host:not(.hide) svg.ipb-svg').classList.contains('ipb-big')"), took); await wait(1200)
            # ---- big diagram behaviour
            await ev("%s.scenes.pick('sc0')" % V); await pg.click(SEL + '.ipm-tab[data-tab=scenes]'); await wait(500); await ev("%s.scenes.go(3)" % V); await wait(500)
            st = await ev("(()=>{const s=document.querySelector('.view-host:not(.hide) svg.ipb-svg'); const v=s.querySelector(':scope > .ipb-veil'); return {veil:!!v, clones:v?v.querySelectorAll('[data-clone]').length:0, litOrig:s.querySelectorAll(':scope > .ipb-nodes .ipb-node.lit, :scope > .ipb-groups .ipb-group.lit, :scope > .ipb-edges .ipb-edge.lit').length, focusCls:s.classList.contains('sc-focus'), rect:!!(v&&v.querySelector('rect.vl')), pe:v?v.getAttribute('pointer-events'):null};})()")
            chk('scene step in a big diagram: one veil + a few clones of the lit items; the 270 originals are not touched', st['veil'] and 2 <= st['clones'] <= 8 and st['litOrig'] == 0 and not st['focusCls'] and st['rect'] and st['pe'] == 'none', st)
            await ev("%s.scenes.go(7)" % V); await wait(400); c2 = await ev("document.querySelectorAll('.view-host:not(.hide) .ipb-veil').length"); chk('stepping replaces the veil (never stacks them)', c2 == 1, c2)
            chk('the clones are marked (data-clone) and carry no id, so queries by id still find the originals', await ev("(()=>{const s=document.querySelector('.view-host:not(.hide) svg.ipb-svg'); const c=s.querySelectorAll('[data-clone]'); return c.length>0 && [...c].every(x=>!x.hasAttribute('data-id')) && s.querySelectorAll('[data-id=\"cpu\"]').length===1;})()"))
            await ev("(()=>{const i=document.querySelector('.view-host:not(.hide) .ipm-find input'); i.value='IP 7.'; i.dispatchEvent(new Event('input'));})()"); await wait(400)
            sv = await ev("(()=>{const v=document.querySelector('.view-host:not(.hide) svg.ipb-svg > .ipb-veil'); return v?[v.getAttribute('class'), v.querySelectorAll('[data-clone]').length]:null;})()"); chk('search in a big diagram: the veil switches to the search layer with the hits', sv and 'fm-layer' in sv[0] and sv[1] == 18, sv)
            await ev("(()=>{const i=document.querySelector('.view-host:not(.hide) .ipm-find input'); i.value=''; i.dispatchEvent(new Event('input'));})()"); await wait(400)
            sv = await ev("(()=>{const v=document.querySelector('.view-host:not(.hide) svg.ipb-svg > .ipb-veil'); return v?v.getAttribute('class'):null;})()"); chk('clearing the search brings the scene highlight back', sv and 'fm-layer' not in sv, sv)
            await pg.click(SEL + '.ipm-tab[data-tab=detail]'); await wait(300); chk('leaving the scenes tab removes the veil', not await ev("!!document.querySelector('.view-host:not(.hide) svg.ipb-svg > .ipb-veil')"))
            # hover emphasis
            hv = await ev("(()=>{const s=document.querySelector('.view-host:not(.hide) svg.ipb-svg'); s.querySelector('.ipb-node[data-id=\"p4_5\"]').dispatchEvent(new MouseEvent('mouseover',{bubbles:true})); return [s.querySelectorAll('.ipb-edge.hi').length, s.classList.contains('focus')];})()")
            chk('hover: the connected edges are emphasised, nothing is dimmed (no focus class)', hv[0] >= 1 and hv[1] is False, hv)
            hv2 = await ev("(()=>{const s=document.querySelector('.view-host:not(.hide) svg.ipb-svg'); s.querySelector('.ipb-node[data-id=\"p9_1\"]').dispatchEvent(new MouseEvent('mouseover',{bubbles:true})); return s.querySelectorAll('.ipb-edge.hi').length;})()"); chk('moving to another node moves the emphasis (the old edges are released)', 1 <= hv2 <= 4, hv2)
            # an edit that does not change the drawing keeps the same SVG
            await ev("window.__svg1 = document.querySelector('.view-host:not(.hide) svg.ipb-svg')")
            await ev("%s.commit([{op:'set_param',node:'cpu',key:'k',value:1}],'param')" % V); await wait(900)
            same = await ev("window.__svg1 === document.querySelector('.view-host:not(.hide) svg.ipb-svg')"); chk('setting a parameter does not rebuild the diagram (same SVG element)', same)
            await ev("%s.commit([{op:'set_evidence',target:'node:p3_5',ev:{level:'手册确认',page:12}}],'ev')" % V)
            rebuilt = await until("(window.__svg1 === document.querySelector('.view-host:not(.hide) svg.ipb-svg')) ? 0 : 1", '> 0', 30000); chk('…but changing evidence (the node status colour and page tag are drawn) does', rebuilt > 0, rebuilt)
            # failure → way out
            await ev("window.__r0 = ChipBench.ipblock.render; ChipBench.ipblock.render = async () => { throw new Error('ELK 布局超时（20 秒）'); }; 0"); await ev("document.querySelector('.view-host:not(.hide) [data-a=dir]').click()"); await wait(700)
            et = await ev("(()=>{const e=document.querySelector('.view-host:not(.hide) .ipm-canvas .state.error'); return e?e.innerText:null;})()")
            chk('a failed layout says what happened, the impact and what to do, with a button to fold into the overview', et and '原因' in et and '影响' in et and '下一步' in et and '折叠成概览' in et and '没有被改动' in et, et)
            await ev("ChipBench.ipblock.render = window.__r0; 0"); await pg.click(SEL + '.ipm-canvas [data-a=collapse]'); took = await until(NODES, '> 5', 60000); await wait(300); n_ov = await ev(NODES); chk('“fold into the overview” recovers: the diagram is back, folded', took > 0 and n_ov < 30, [took, n_ov])
            # a big model WITHOUT groups: no overview, simply laid out
            await ev("ChipBench.openPath(%s)" % json.dumps(PF)); await pg.wait_for_selector(SEL + '.ipm .ipb-node', timeout=60000); await wait(1500)
            fl = await ev("[document.querySelectorAll('.view-host:not(.hide) .ipb-node').length, !!document.querySelector('.view-host:not(.hide) .ipm-big'), document.querySelector('.view-host:not(.hide) svg.ipb-svg').classList.contains('ipb-big')]"); chk('151 blocks without groups: laid out as they are (nothing to fold), flagged big', fl == [151, False, True], fl)
            real = [e for e in errs if 'ELK' not in e]; chk('no console errors', not real, real[:4])
            await b.close()
    print(json.dumps({'passed': sum(R.values()), 'total': len(R), 'fails': fails}, ensure_ascii=False))
asyncio.run(main())
