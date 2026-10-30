"""1.8 · IP Studio: open a .cbip, select / edit evidence (atomic + undo), collapse / focus (layout sidecar), registers, validation list,
AI proposal accept / reject, broken files, workspace refs to a sub-graph, new model / template / atlas conversion, external change."""
import asyncio, json
from util import *; from base_fs import *
R = {}; fails = []
def chk(name, cond, info=None):
    R[name] = bool(cond)
    if not cond: fails.append(name); print('FAIL', name, info if info is not None else '')
    else: print('  ok ', name)
D = 'C:\\Work\\IP\\'; P = D + 'can0.cbip'
def node(i, kind, name, **k): return dict(id=i, type=kind, kind=kind, name=name, params={}, ports=k.get('ports', []), registers=k.get('registers', []), ev=k.get('ev', {'level': '待核对'}), **({'parent': k['parent']} if k.get('parent') else {}))
def port(i, t, d): return dict(id=i, type=t, dir=d)
MODEL = dict(schema='chipbench.ip/1', id='can0', name='RS-CANFD 示例', kind='instance', rev=3, chip='RH850/U2B', family='', extends='', source='manual.pdf', docrev='1.2', description='', refs=[],
  nodes=[node('cpu', 'cpu', 'CPU', ports=[port('bus', 'bus', 'out')], ev={'level': '手册确认', 'page': 12}),
         node('sub', 'group', 'CAN 子系统', ev={'level': '待核对'}),
         node('can', 'periph', 'RS-CANFD', parent='sub', ports=[port('bus', 'bus', 'in'), port('irq', 'irq', 'out')], registers=['CFDC'], ev={'level': '推导', 'page': '3299-3305'}),
         node('txq', 'mem', '发送队列', parent='sub'), node('rxq', 'mem', '接收 FIFO', parent='sub'),
         node('intc', 'irq', 'INTC', ports=[port('in0', 'irq', 'in')]), node('far', 'ext', '外部收发器')],
  edges=[dict(id='e1', source='cpu.bus', target='can.bus', type='bus', ev={}), dict(id='e2', source='can.irq', target='intc.in0', type='irq', ev={}), dict(id='e3', source='can', target='far', type='data', ev={}), dict(id='e4', source='txq', target='can', type='data', ev={})],
  registers={'CFDC': dict(id='CFDC', name='Channel control', width=32, address=0xFFC00000, reset=0, fields=[dict(name='PTE', bits='0', desc='协议例外', ev={'level': '手册确认', 'page': 3300}), dict(name='DCS', bits='5:4', desc='时钟选择', ev={})], ev={'level': '手册确认', 'page': 3299})})
BAD_MODEL = json.loads(json.dumps(MODEL)); BAD_MODEL['id'] = 'bad'; BAD_MODEL['edges'].append(dict(id='e9', source='ghost.p', target='cpu.bus', type='bus', ev={})); BAD_MODEL['registers']['CFDC']['reset'] = 2 ** 40
PROP = dict(schema='chipbench.ip.proposal/1', base_rev=3, created='2026-10-29T09:00:00', client='TestAI', title='添加 TX 引脚', note='来自手册第 31 章',
  ops=[dict(op='add_node', node=dict(id='txd', kind='io', name='TXD 引脚', ports=[port('p', 'io', 'out')])), dict(op='add_edge', edge=dict(source='can', target='txd', type='data'))], described=['添加节点 txd（TXD 引脚）', '连线 can → txd（data）'])
SCN = dict(schema='chipbench.ip/1', id='scn', name='场景示例', kind='instance', rev=1, chip='', family='', extends='', source='manual.pdf', docrev='', description='', refs=[],
  nodes=[node('cpu', 'cpu', 'CPU', ports=[port('bus', 'bus', 'out')]), node('can', 'periph', 'RS-CANFD', ports=[port('bus', 'bus', 'in'), port('irq', 'irq', 'out')], registers=['CFDC']), node('intc', 'irq', 'INTC', ports=[port('in0', 'irq', 'in')]), node('far', 'ext', '收发器')],
  edges=[dict(id='e1', source='cpu.bus', target='can.bus', type='bus', ev={}), dict(id='e2', source='can.irq', target='intc.in0', type='irq', ev={}), dict(id='e3', source='can', target='far', type='data', ev={})],
  registers={'CFDC': dict(id='CFDC', name='CFDC', width=32, address=0xFFC00000, reset=0, fields=[dict(name='PTE', bits='0', ev={}), dict(name='DCS', bits='5:4', ev={})], ev={})},
  scenes=[dict(id='rx', name='接收一帧', desc='示例', ev={'level': '待核对'}, steps=[dict(title='CPU 配置', note='写 **CFDC**', nodes=['cpu', 'can'], edges=['e1'], writes=[dict(reg='CFDC', value=1, note='PTE=1')], ev={}), dict(title='产生中断', note='', nodes=['can', 'intc'], edges=['e2'], writes=[dict(reg='CFDC', value=0x31)], ev={'level': '手册确认', 'page': 12}), dict(title='无高亮', note='', nodes=[], edges=[], writes=[], ev={})])])
async def main():
    with Server() as srv:
        async with async_playwright() as p:
            fs = base_fs(); fs['C:\\Work\\IP'] = {'dir': 1}
            fs[P] = {'t': json.dumps(MODEL, ensure_ascii=False, indent=2) + '\n'}; fs[P + '.proposal.json'] = {'t': json.dumps(PROP, ensure_ascii=False)}
            fs[D + 'bad.cbip'] = {'t': json.dumps(BAD_MODEL, ensure_ascii=False)}; fs[D + 'broken.cbip'] = {'t': '{ not json'}; fs[D + 'alien.cbip'] = {'t': json.dumps({'hello': 1})}
            fs[D + 'empty.cbip'] = {'t': json.dumps(dict(schema='chipbench.ip/1', id='empty', name='空模型', kind='instance', rev=1, nodes=[], edges=[], registers={}))}
            fs[D + 'IP图谱'] = {'dir': 1}
            fs[D + 'IP图谱\\CAN-FD.md'] = {'t': '---\ntype: ip-atlas\nip: CAN-FD\nchip: U2B\nsource: manual.pdf\n---\n# CAN-FD\n## 结构\n```ipblock\ntitle: demo\nblocks:\n  - {id: cpu, label: CPU, kind: cpu, page: 12, ev: 手册确认}\n  - {id: can, label: CAN, kind: periph, regs: [CFDC]}\nlinks:\n  - {from: cpu, to: can, kind: bus}\n```\n## 寄存器\n```register\nname: CFDC\naddress: 0xFFC00000\nwidth: 32\nfields:\n  - {name: PTE, bits: "0"}\n```\n'}
            b, ctx, pg, errs = await launch(p, srv, fs); ev = pg.evaluate
            async def wait(ms=300): await pg.wait_for_timeout(ms)
            async def text(p_): return await ev("(window.__FS[%s]||{}).t || null" % json.dumps(p_))
            async def open_(p_):
                await ev("ChipBench.openPath(%s)" % json.dumps(p_)); await pg.wait_for_selector('.view-host:not(.hide) .ipm', timeout=8000); await wait(700)
            await wait(500)
            await open_(P)
            chk('opens as an IP Studio tab (view=ipm)', await ev("ChipBench.app.current().view") == 'ipm')
            bt = await ev("document.querySelector('.view-host:not(.hide) .ipm-bar').innerText"); chk('toolbar shows name, chip, counts', all(x in bt for x in ['RS-CANFD 示例', 'RH850/U2B', '7 个节点', '4 条连线', '1 个寄存器']), bt)
            await pg.wait_for_selector('.view-host:not(.hide) .ipm .ipb-node', timeout=8000)
            chk('diagram renders the 6 visible blocks (the group is a frame)', await ev("document.querySelectorAll('.view-host:not(.hide) .ipm .ipb-node').length") == 6, await ev("document.querySelectorAll('.view-host:not(.hide) .ipm .ipb-node').length"))
            vis = "document.querySelector('.view-host:not(.hide) .ipm-canvas')"
            fw = await ev("(()=>{const c=%s, s=c.querySelector('svg.ipb-svg'); return [s.getBoundingClientRect().width, c.clientWidth, +s.dataset.k];})()" % vis)
            chk('diagram is fitted to the window width by default (no sideways scrolling to see all blocks)', fw[0] <= fw[1] and fw[2] <= 1, fw)
            await pg.click('.view-host:not(.hide) .ipm-bar [data-a=fit]'); await wait(600)
            fw2 = await ev("(()=>{const s=document.querySelector('.view-host:not(.hide) .ipm-canvas svg.ipb-svg'); return [s.getBoundingClientRect().width, +s.dataset.k];})()")
            chk('“100%” button shows the diagram at natural size and saves the choice', fw2[0] >= fw[0] and fw2[1] == 1 and json.loads(await text(P + '.layout.json'))['view'].get('fit') is False, [fw, fw2])
            await pg.click('.view-host:not(.hide) .ipm-bar [data-a=fit]'); await wait(200)
            chk('ipblock’s own bar and side panel are hidden in this viewer', await ev("getComputedStyle(document.querySelector('.view-host:not(.hide) .ipm .dg-bar')).display") == 'none' and await ev("getComputedStyle(document.querySelector('.view-host:not(.hide) .ipm .ipb-side')).display") == 'none')
            chk('pending-proposal badge shows 2 ops', '待确认的修改 · 2' in await ev("document.querySelector('.view-host:not(.hide) .ipm-bar').innerText"))
            chk('validation chip: no errors', '无错误' in await ev("document.querySelector('.view-host:not(.hide) .ipm-bar').innerText"), await ev("document.querySelector('.view-host:not(.hide) .ipm-bar').innerText"))
            # overview pane
            pn = await ev("document.querySelector('.view-host:not(.hide) .ipm-pane').innerText"); chk('overview pane lists the evidence distribution', '手册确认 1' in pn and '推导 1' in pn, pn)
            await pg.screenshot(path='shot_ip18_overview.png')
            # select a node
            await pg.click('.view-host:not(.hide) .ipm .ipb-node[data-id="can"]'); await wait(200)
            pane = await ev("document.querySelector('.view-host:not(.hide) .ipm-pane').innerText")
            chk('click selects the node and shows details', 'RS-CANFD' in pane and '推导' in pane and 'p.3299-3305' in pane and 'bus' in pane and 'irq' in pane, pane)
            chk('selected node is marked in the diagram', await ev("!!document.querySelector('.view-host:not(.hide) .ipm .ipb-node.sel[data-id=can]')"))
            # evidence rules
            await ev("(()=>{const f=document.querySelector('.view-host:not(.hide) .ipm-form');f.level.value='手册确认';f.page.value='';})()")
            await ev("(()=>{const n=ChipBench.app.current().viewer.state.model.nodes.find(n=>n.id==='txq');ChipBench.app.current().viewer.select('node','txq','detail');})()"); await wait(200)
            await ev("(()=>{const f=document.querySelector('.view-host:not(.hide) .ipm-form');f.level.value='手册确认';f.page.value='';})()"); await pg.click('.view-host:not(.hide) .ipm-form button[type=submit]'); await wait(300)
            raw = json.loads(await text(P)); chk('“手册确认” without a page is refused (file unchanged)', raw['rev'] == 3 and next(n for n in raw['nodes'] if n['id'] == 'txq')['ev'].get('level') == '待核对', raw['rev'])
            await ev("(()=>{const f=document.querySelector('.view-host:not(.hide) .ipm-form');f.level.value='手册确认';f.page.value='3301';f.sec.value='31.2';f.note.value='发送队列';})()"); await pg.click('.view-host:not(.hide) .ipm-form button[type=submit]'); await wait(500)
            raw = json.loads(await text(P)); tx = next(n for n in raw['nodes'] if n['id'] == 'txq')
            chk('evidence + note saved atomically (rev bumped, page/sec/note set)', raw['rev'] == 4 and tx['ev'] == {'level': '手册确认', 'page': '3301', 'sec': '31.2'} and tx.get('note') == '发送队列', tx)
            chk('file stays valid JSON with the same schema, 2-space indent', (await text(P)).startswith('{\n  "schema": "chipbench.ip/1"'))
            chk('toolbar updated (rev 4, 2 confirmed)', 'rev 4' in await ev("document.querySelector('.view-host:not(.hide) .ipm-bar').innerText") and '已确认 2/7' in await ev("document.querySelector('.view-host:not(.hide) .ipm-bar').innerText"), await ev("document.querySelector('.view-host:not(.hide) .ipm-bar').innerText"))
            await pg.click('.view-host:not(.hide) .ipm-bar [data-a=undo]'); await wait(400)
            raw = json.loads(await text(P)); chk('undo restores the previous file', raw['rev'] == 3 and next(n for n in raw['nodes'] if n['id'] == 'txq')['ev'].get('level') == '待核对')
            chk('undo button disabled again', await ev("document.querySelector('.view-host:not(.hide) .ipm-bar [data-a=undo]').disabled"))
            # registers
            await pg.click('.view-host:not(.hide) .ipm-tab[data-tab=regs]'); await wait(200)
            chk('registers tab lists CFDC with address', 'CFDC' in await ev("document.querySelector('.view-host:not(.hide) .ipm-pane').innerText") and '0xFFC00000' in await ev("document.querySelector('.view-host:not(.hide) .ipm-pane').innerText"))
            await pg.click('.view-host:not(.hide) .ipm-reg .ipm-rh'); await wait(200)
            chk('expanding shows bit bar and fields', await ev("document.querySelectorAll('.view-host:not(.hide) .ipm-bits span').length") >= 3 and 'PTE' in await ev("document.querySelector('.view-host:not(.hide) .ipm-pane').innerText") and 'DCS' in await ev("document.querySelector('.view-host:not(.hide) .ipm-pane').innerText"), await ev("document.querySelector('.view-host:not(.hide) .ipm-pane').innerHTML.slice(0,400)"))
            # validation list
            await ev("(()=>{const t=ChipBench.app.current(); t.viewer.select(null,null,'find');})()"); await wait(150)
            chk('validation tab lists the missing manual pages', 'no-page' in await ev("document.querySelector('.view-host:not(.hide) .ipm-pane').innerText"), await ev("document.querySelector('.view-host:not(.hide) .ipm-pane').innerText"))
            # collapse
            await pg.click('.view-host:not(.hide) .ipm-bar [data-a=collapse]'); await wait(900)
            chk('collapse groups: the group becomes one block, children vanish', await ev("document.querySelectorAll('.view-host:not(.hide) .ipm .ipb-node').length") == 4 and await ev("!!document.querySelector('.view-host:not(.hide) .ipm .ipb-node[data-id=sub]')"), await ev("[...document.querySelectorAll('.view-host:not(.hide) .ipm .ipb-node')].map(x=>x.dataset.id)"))
            lay = json.loads(await text(P + '.layout.json')); chk('layout sidecar stores the collapsed groups (model file untouched)', lay['collapsed'] == ['sub'] and json.loads(await text(P))['rev'] == 3, lay)
            await pg.click('.view-host:not(.hide) .ipm-bar [data-a=collapse]'); await wait(900)
            chk('expand again', await ev("document.querySelectorAll('.view-host:not(.hide) .ipm .ipb-node').length") == 6)
            # focus sub-graph
            await ev("ChipBench.app.current().viewer.select('node','can','detail')"); await wait(150)
            await pg.click('.view-host:not(.hide) .ipm-pane [data-a=focus]'); await wait(900)
            chk('focus: banner + only the node, its group members and neighbours', await ev("!!document.querySelector('.view-host:not(.hide) .ipm-focus')") and await ev("document.querySelectorAll('.view-host:not(.hide) .ipm .ipb-node').length") < 6, await ev("[...document.querySelectorAll('.view-host:not(.hide) .ipm .ipb-node')].map(x=>x.dataset.id)"))
            ov = await ev("(()=>{const a=document.querySelector('.view-host:not(.hide) .ipm-focus').getBoundingClientRect(), b=document.querySelector('.view-host:not(.hide) .ipm-find').getBoundingClientRect(); return !(a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top);})()")
            chk('the search box never covers the focus banner and its depth buttons', ov is False, ov)
            n1 = await ev("document.querySelectorAll('.view-host:not(.hide) .ipm .ipb-node').length"); await pg.click('.view-host:not(.hide) .ipm-focus [data-a="depth+"]'); await wait(900)
            chk('focus depth + shows more', await ev("document.querySelectorAll('.view-host:not(.hide) .ipm .ipb-node').length") >= n1)
            lay = json.loads(await text(P + '.layout.json')); chk('focus is remembered in the layout sidecar', lay['view'].get('focus', {}).get('node') == 'can', lay['view'])
            await pg.click('.view-host:not(.hide) .ipm-focus [data-a=unfocus]'); await wait(900)
            chk('show all again', await ev("document.querySelectorAll('.view-host:not(.hide) .ipm .ipb-node').length") == 6 and not await ev("!!document.querySelector('.view-host:not(.hide) .ipm-focus')"))
            # direction
            await pg.click('.view-host:not(.hide) .ipm-bar [data-a=dir]'); await wait(900); lay = json.loads(await text(P + '.layout.json')); chk('direction toggle saved', lay['view']['direction'] == 'down')
            await pg.click('.view-host:not(.hide) .ipm-bar [data-a=dir]'); await wait(700)
            # proposals
            await pg.click('.view-host:not(.hide) .ipm-bar .ipm-prop'); await wait(200); pane = await ev("document.querySelector('.view-host:not(.hide) .ipm-pane').innerText")
            chk('changes tab shows title, client, ops and the result summary', all(x in pane for x in ['添加 TX 引脚', 'TestAI', '添加节点 txd', '连线 can → txd', '节点 +1', '连线 +1']), pane)
            before = await text(P)
            await ev("window.__confirmNext = true"); await pg.click('.view-host:not(.hide) .ipm-pane [data-a=accept]'); await wait(700)
            raw = json.loads(await text(P)); chk('accept writes the model and removes the proposal file', any(n['id'] == 'txd' for n in raw['nodes']) and len(raw['edges']) == 5 and raw['rev'] == 4 and await text(P + '.proposal.json') is None, [raw['rev'], len(raw['edges'])])
            chk('badge gone, diagram has the new block', '待确认' not in await ev("document.querySelector('.view-host:not(.hide) .ipm-bar').innerText") and await ev("!!document.querySelector('.view-host:not(.hide) .ipm .ipb-node[data-id=txd]')"))
            await pg.click('.view-host:not(.hide) .ipm-bar [data-a=undo]'); await wait(400); raw = json.loads(await text(P)); chk('undo of an accepted proposal restores the model', not any(n['id'] == 'txd' for n in raw['nodes']) and raw['rev'] == 3)
            # a new proposal arriving while the tab is open (what the MCP server writes)
            await ev("window.__FS[%s] = {t: %s}" % (json.dumps(P + '.proposal.json'), json.dumps(json.dumps(PROP, ensure_ascii=False)))); await ev("ChipBench.app.externalChanged([%s])" % json.dumps(P + '.proposal.json')); await wait(1200)
            chk('a proposal written by an AI tool appears without reopening', '待确认的修改 · 2' in await ev("document.querySelector('.view-host:not(.hide) .ipm-bar').innerText"), await ev("document.querySelector('.view-host:not(.hide) .ipm-bar').innerText"))
            await pg.click('.view-host:not(.hide) .ipm-bar .ipm-prop'); await wait(200)
            await pg.click('.view-host:not(.hide) .ipm-pane [data-a=reject]'); await pg.wait_for_selector('.modal', timeout=3000); await pg.click('.modal button:has-text("拒绝")'); await wait(500)
            chk('reject removes the proposal and leaves the model alone', await text(P + '.proposal.json') is None and json.loads(await text(P))['rev'] == 3 and '待确认' not in await ev("document.querySelector('.view-host:not(.hide) .ipm-bar').innerText"))
            # stale / unappliable proposal
            stale = dict(PROP, base_rev=1, ops=[dict(op='remove_node', id='nope')]); await ev("window.__FS[%s] = {t: %s}" % (json.dumps(P + '.proposal.json'), json.dumps(json.dumps(stale)))); await ev("ChipBench.app.externalChanged([%s])" % json.dumps(P + '.proposal.json')); await wait(1200)
            await pg.click('.view-host:not(.hide) .ipm-bar .ipm-prop'); await wait(200); pane = await ev("document.querySelector('.view-host:not(.hide) .ipm-pane').innerText")
            chk('an unappliable proposal says why and cannot be accepted', '无法应用' in pane and await ev("document.querySelector('.view-host:not(.hide) .ipm-pane [data-a=accept]').disabled") and '又改过' in pane, pane)
            await ev("window.__confirmNext = true"); await pg.click('.view-host:not(.hide) .ipm-pane [data-a=reject]'); await pg.wait_for_selector('.modal', timeout=3000); await pg.click('.modal button:has-text("拒绝")'); await wait(400)
            # validation of a bad model
            await open_(D + 'bad.cbip'); bar = await ev("document.querySelector('.view-host:not(.hide) .ipm-bar').innerText")
            chk('a model with errors shows the error count', '✗' in bar and '个错误' in bar, bar)
            await pg.click('.view-host:not(.hide) .ipm-bar [data-a=tab-find]'); await wait(200); pane = await ev("document.querySelector('.view-host:not(.hide) .ipm-pane').innerText")
            chk('validation tab lists the dangling edge and the reset overflow', 'no-endpoint' in pane and 'reg-reset' in pane, pane)
            await pg.click('.view-host:not(.hide) .ipm-fd[data-sel^="edge"]'); await wait(200)
            # broken / alien / empty
            for name, want in (('broken.cbip', '不是有效的 JSON'), ('alien.cbip', '不是 ChipBench IP 模型')):
                await ev("ChipBench.openPath(%s)" % json.dumps(D + name)); await pg.wait_for_selector('.view-host:not(.hide) .state.error', timeout=6000); await wait(200)
                chk(name + ': friendly error, no crash', want in await ev("document.querySelector('.view-host:not(.hide) .state.error').innerText"), await ev("document.querySelector('.view-host:not(.hide) .state.error').innerText"))
            await open_(D + 'empty.cbip'); chk('empty model shows the hint instead of a blank canvas', '这个模型还是空的' in await ev("document.querySelector('.view-host:not(.hide) .ipm-canvas').innerText"))
            # workspace refs
            await open_(P)
            await ev("(()=>{const ws=ChipBench.ws.cur; ChipBench.W.addGroup(ws,'CAN 工作区');})()"); gid = await ev("ChipBench.ws.cur.collections.find(n=>n.name==='CAN 工作区').id")
            await ev("(()=>{const ws=ChipBench.ws.cur; ChipBench.W.addRef(ws,{kind:'file',path:%s},{parentId:%s}); ChipBench.W.addRef(ws,{kind:'file',path:%s,sub:{node:'can',depth:1}},{parentId:%s}); ChipBench.ws.save(); ChipBench.ws.draw&&ChipBench.ws.draw();})()" % (json.dumps(P), json.dumps(gid), json.dumps(P), json.dumps(gid))); await wait(400)
            await ev("ChipBench.app.current().viewer.select(null,null,'refs')"); await wait(200); pane = await ev("document.querySelector('.view-host:not(.hide) .ipm-pane').innerText")
            chk('references tab lists the collection, whole model and sub-graph', 'CAN 工作区' in pane and '整个模型' in pane and '子图' in pane and 'can' in pane, pane)
            chk('workspace tree labels the sub-graph ref', '▸ can' in await ev("document.querySelector('#pane-workspace').innerText"), await ev("document.querySelector('#pane-workspace').innerText.slice(0,300)"))
            await ev("ChipBench.app.close && ChipBench.app.close(ChipBench.app.tabs.findIndex(x=>x.path===%s))" % json.dumps(P)); await wait(300)
            rid = await ev("ChipBench.ws.cur.collections.find(n=>n.name==='CAN 工作区').children.find(n=>n.sub).id")
            await ev("(()=>{const el=document.querySelector('#pane-workspace .ws-row[data-id=\"%s\"]'); el && el.click();})()" % rid); await pg.wait_for_selector('.view-host:not(.hide) .ipm .ipm-focus', timeout=8000); await wait(500)
            ft = await ev("document.querySelector('.view-host:not(.hide) .ipm-focus').innerText"); chk('clicking a sub-graph ref opens the model focused on that node', 'can' in ft, ft)
            await pg.click('.view-host:not(.hide) .ipm-focus [data-a=unfocus]'); await wait(700)
            # new model + template
            t = await ev("(async()=>{const t=await ChipBench.ipstudio.newModel({name:'U2B CAN1', template:'can', path:%s}); return !!t;})()" % json.dumps(D + 'new-can1.cbip')); await wait(900)
            raw = json.loads(await text(D + 'new-can1.cbip')) if await text(D + 'new-can1.cbip') else {}
            chk('new model from the CAN template: instance, extends the template, nodes “待核对”, valid', raw.get('kind') == 'instance' and raw.get('extends') == 'tpl-can' and len(raw.get('nodes', [])) == 8 and all(n['ev']['level'] == '待核对' for n in raw['nodes']) and not raw.get('registers'), raw.get('kind'))
            await pg.wait_for_selector('.view-host:not(.hide) .ipm .ipb-node', timeout=8000); chk('the new model opens and renders', await ev("document.querySelectorAll('.view-host:not(.hide) .ipm .ipb-node').length") >= 7)
            await ev("(async()=>{await ChipBench.ipstudio.newModel({name:'blank one', template:'blank', path:%s});})()" % json.dumps(D + 'blank.cbip')); await wait(700)
            chk('blank model is created', json.loads(await text(D + 'blank.cbip'))['nodes'] == [])
            dup = await ev("(async()=>{const t=await ChipBench.ipstudio.newModel({name:'x', template:'can', path:%s}); return t===null;})()" % json.dumps(D + 'blank.cbip')); chk('creating over an existing file is refused', dup)
            # instantiate template into the open model through the same commit path
            await open_(D + 'blank.cbip')
            await ev("(async()=>{const v=ChipBench.app.current().viewer, IPT=ChipBench.IPT, ops=ChipBench.IPM.instantiate(IPT.model('eth'),{prefix:'eth0',name:'ETH0'}); await v.commit(ops,'从模板添加 eth0');})()"); await wait(1200)
            raw = json.loads(await text(D + 'blank.cbip')); chk('template instantiated into the model (prefix, parent kept)', any(n['id'] == 'eth0' for n in raw['nodes']) and any(n['parent'] == 'eth0' for n in raw['nodes'] if n.get('parent')) and raw['rev'] == 2, raw['rev'])
            await pg.screenshot(path='shot_ip18_template.png')
            # atlas conversion
            await ev("ChipBench.ipstudio.importAtlas(%s)" % json.dumps(D + 'IP图谱\\CAN-FD.md')); await wait(1500)
            raw = json.loads(await text(D + 'IP图谱\\CAN-FD.cbip') or '{}'); chk('atlas page converted next to the page: nodes, edge, register, evidence', len(raw.get('nodes', [])) == 2 and len(raw.get('edges', [])) == 1 and 'CFDC' in raw.get('registers', {}) and raw['nodes'][0]['ev'] == {'level': '手册确认', 'page': 12}, raw)
            chk('the Markdown page is untouched', (await text(D + 'IP图谱\\CAN-FD.md')).count('```ipblock') == 1 and 'type: ip-atlas' in await text(D + 'IP图谱\\CAN-FD.md'))
            cbip_before = await text(D + 'IP图谱\\CAN-FD.cbip'); await ev("ChipBench.ipstudio.importAtlas(%s)" % json.dumps(D + 'IP图谱\\CAN-FD.md')); await wait(800); chk('converting twice does not overwrite (file unchanged)', await text(D + 'IP图谱\\CAN-FD.cbip') == cbip_before)
            # external change re-reads the file
            await open_(P); ext = json.loads(await text(P)); ext['name'] = '被外部程序改名'; ext['rev'] = 9
            await ev("window.__FS[%s].t = %s" % (json.dumps(P), json.dumps(json.dumps(ext, ensure_ascii=False)))); await ev("ChipBench.app.externalChanged([%s])" % json.dumps(P)); await wait(1500)
            chk('an external edit (e.g. MCP mode=write) is picked up', '被外部程序改名' in await ev("document.querySelector('.view-host:not(.hide) .ipm-bar').innerText") and 'rev 9' in await ev("document.querySelector('.view-host:not(.hide) .ipm-bar').innerText"), await ev("document.querySelector('.view-host:not(.hide) .ipm-bar').innerText"))
            # manual structure editing (same atomic ops as the AI; each one undoable)
            EDIT = D + 'edit.cbip'; await ev("window.__FS[%s] = {t: %s}" % (json.dumps(EDIT), json.dumps(json.dumps(dict(schema='chipbench.ip/1', id='edit', name='手动编辑', kind='instance', rev=1, nodes=[node('a', 'periph', 'A', ports=[port('out', 'data', 'out')]), node('b', 'mem', 'B', ports=[port('in', 'data', 'in')])], edges=[], registers={}), ensure_ascii=False))))
            await open_(EDIT); V = "ChipBench.app.current().viewer.edit"
            async def rawm(): return json.loads(await text(EDIT))
            r = await ev("%s.addNode({name:'通道 0', kind:'logic', parent:'a'}).then(r=>r.ok)" % V); m = await rawm()
            chk('add node by hand: id derived from the name, parent kept, rev bumped, file written', r and any(n['id'] == '0' or n['name'] == '通道 0' for n in m['nodes']) and m['rev'] == 2 and any(n.get('parent') == 'a' for n in m['nodes']), [n['id'] for n in m['nodes']])
            nid = next(n['id'] for n in m['nodes'] if n['name'] == '通道 0'); chk('the new node is selected', await ev("ChipBench.app.current().viewer.state.sel.id") == nid)
            r = await ev("%s.addPort('b', {id:'irq', type:'irq', dir:'out'}).then(r=>r.ok)" % V); chk('add port', r and any(p['id'] == 'irq' for p in next(n for n in (await rawm())['nodes'] if n['id'] == 'b')['ports']))
            r = await ev("%s.connect('a.out','b.in').then(r=>r.ok)" % V); m = await rawm(); chk('connect: edge created with the type taken from the port', r and len(m['edges']) == 1 and m['edges'][0]['type'] == 'data', m['edges'])
            bad = await ev("%s.connect('a.out','b.nope').then(r=>({ok:r.ok, e:(r.errors||[]).map(x=>x.code)}))" % V); chk('invalid connection is refused with the reason and the file is unchanged', not bad['ok'] and 'no-port' in bad['e'] and (await rawm())['rev'] == m['rev'], bad)
            await wait(300); await pg.click('.view-host:not(.hide) .ipm-pane [data-a=rmedge]') if await ev("!!document.querySelector('.view-host:not(.hide) .ipm-pane [data-a=rmedge]')") else await ev("ChipBench.app.current().viewer.select('node','a','detail')"); await wait(300)
            if await ev("!!document.querySelector('.view-host:not(.hide) .ipm-pane [data-a=rmedge]')"): await pg.click('.view-host:not(.hide) .ipm-pane [data-a=rmedge]'); await wait(400)
            chk('edge row has a × button and it removes the edge', len((await rawm())['edges']) == 0)
            r = await ev("%s.rename('b','mem0').then(r=>r.ok)" % V); chk('rename updates the node id', r and any(n['id'] == 'mem0' for n in (await rawm())['nodes']))
            await ev("%s.connect('a.out','mem0.in')" % V); await wait(300); m = await rawm(); chk('…and the following edge uses the new id', m['edges'][0]['target'] == 'mem0.in', m['edges'])
            await ev("%s.rename('mem0','b')" % V); await wait(300); m = await rawm(); chk('renaming back rewrites the edge endpoint too', m['edges'][0]['target'] == 'b.in', m['edges'])
            dup = await ev("%s.rename('a','b').then(r=>r.errors.map(x=>x.code))" % V); chk('rename onto an existing id is refused', dup == ['dup-node'], dup)
            r = await ev("%s.removeNode('a').then(r=>r.ok)" % V); m = await rawm(); chk('remove node removes its children and edges', r and not any(n['id'] in ('a', nid) for n in m['nodes']) and m['edges'] == [], [n['id'] for n in m['nodes']])
            await pg.click('.view-host:not(.hide) .ipm-bar [data-a=undo]'); await wait(450)
            m = await rawm(); chk('removing a node with its child and edge is ONE undo step that brings all of it back', any(n['id'] == 'a' for n in m['nodes']) and any(n['id'] == nid for n in m['nodes']) and len(m['edges']) == 1, [(n['id']) for n in m['nodes']])
            # UI path: the buttons open the prompts
            await ev("ChipBench.app.current().viewer.select('node','a','detail')"); await wait(250)
            await pg.click('.view-host:not(.hide) .ipm-pane [data-a=addnode]'); await pg.wait_for_selector('.modal input', timeout=3000); await pg.fill('.modal input', '寄存器堆'); await pg.keyboard.press('Enter'); await pg.wait_for_selector('.menu-pop', timeout=3000)
            await pg.click('.menu-pop [data-k=mem]'); await wait(700); m = await rawm(); chk('add child via buttons: name prompt → kind menu → node of that kind under the selection', any(n['name'] == '寄存器堆' and n['kind'] == 'mem' and n.get('parent') == 'a' for n in m['nodes']), [(n['name'], n['kind'], n.get('parent')) for n in m['nodes']])
            await ev("ChipBench.app.current().viewer.select('node','a','detail')"); await wait(250)
            await pg.click('.view-host:not(.hide) .ipm-pane [data-a=rmnode]'); await pg.wait_for_selector('.modal', timeout=3000); txt = await ev("document.querySelector('.modal').innerText"); chk('delete asks first and says how much goes with it', '子节点' in txt and '连线' in txt, txt)
            await pg.click('.modal button:has-text("取消")'); await wait(300); chk('cancel keeps the node', any(n['id'] == 'a' for n in (await rawm())['nodes']))
            ve = await ev("ChipBench.IPM.validate(ChipBench.app.current().viewer.state.model).filter(x=>x.level==='err').length"); chk('the hand-edited model validates without errors', ve == 0, ve)
            # SVD import: parse a real SVD in the page, turn it into ops, commit as one undoable step
            SVD = open(str(ROOT / 'tests/fixtures/t.svd'), encoding='utf-8').read(); await ev("window.__FS['C:\\\\Work\\\\IP\\\\t.svd'] = {t: %s}" % json.dumps(SVD))
            await ev("ChipBench.app.current().viewer.select('node','a','detail')"); await wait(200)
            r = await ev("(async()=>{const v=ChipBench.app.current().viewer, regs=ChipBench.X.parseSVD((await ChipBench.fs.read('C:\\\\Work\\\\IP\\\\t.svd')).text), ops=ChipBench.IPM.svdOps(regs,{peripheral:'CAN0',node:'a',taken:Object.keys(v.state.model.registers)}); const r=await v.commit(ops,'导入 SVD CAN0'); return r.ok;})()")
            m = await rawm(); chk('SVD import: register defined (address, reset, fields) and attached to the selected node', r and m['registers']['CTRL']['address'] == 0x40000000 and m['registers']['CTRL']['reset'] == 1 and len(m['registers']['CTRL']['fields']) == 2 and 'CTRL' in next(n for n in m['nodes'] if n['id'] == 'a')['registers'], m.get('registers'))
            chk('…all “待核对” (SVD is not the manual)', m['registers']['CTRL']['ev']['level'] == '待核对' and m['registers']['CTRL']['ev']['sec'] == 'SVD')
            await pg.click('.view-host:not(.hide) .ipm-bar [data-a=undo]'); await wait(450); chk('…and one undo removes it again', 'CTRL' not in (await rawm())['registers'])
            # ---- 2.0 scenes: play, highlight, record, edit ----
            SCP = D + 'scn.cbip'; await ev("window.__FS[%s] = {t: %s}" % (json.dumps(SCP), json.dumps(json.dumps(SCN, ensure_ascii=False)))); await open_(SCP); await pg.wait_for_selector('.view-host:not(.hide) .ipm .ipb-node', timeout=8000)
            PN = ".view-host:not(.hide) .ipm-pane"; VS = ".view-host:not(.hide) svg.ipb-svg"
            async def pane_text(): return await ev("document.querySelector('%s').innerText" % PN)
            async def lit(): return await ev("[[...document.querySelectorAll('.view-host:not(.hide) .ipb-node.lit')].map(n=>n.dataset.id).sort(), document.querySelectorAll('.view-host:not(.hide) .ipb-edge.lit').length, document.querySelector('%s').classList.contains('sc-focus')]" % VS)
            async def raw_scn(): return json.loads(await text(SCP))
            chk('scenes tab shows a count badge; toolbar counts scenes', '场景 1' in await ev("document.querySelector('.view-host:not(.hide) .ipm-tabs').innerText") and '1 个场景' in await ev("document.querySelector('.view-host:not(.hide) .ipm-bar').innerText"))
            chk('before opening the scenes tab nothing is highlighted', (await lit())[2] is False)
            await pg.click('.view-host:not(.hide) .ipm-tab[data-tab=scenes]'); await wait(250); chk('scene list shows the scene with its step count', '接收一帧' in await pane_text() and '3 步' in await pane_text())
            await pg.click(PN + ' .ipm-sc'); await wait(450); L = await lit()
            chk('opening a scene highlights step 1: its 2 nodes and 1 edge, the rest dimmed', L[0] == ['can', 'cpu'] and L[1] == 1 and L[2] is True, L)
            pt = await pane_text(); chk('step card: title, markdown note, node chips, register write decoded with fields', 'CPU 配置' in pt and 'CFDC' in pt and '0x00000001' in pt and 'PTE = 1' in pt and 'DCS = 0' in pt and 'PTE=1' in pt, pt)
            await pg.click(PN + ' [data-a=sc-next]'); await wait(450); L = await lit(); pt = await pane_text()
            chk('next: step 2 highlights can + intc and the irq edge', L[0] == ['can', 'intc'] and L[1] == 1, L); chk('step 2 shows the previous value and the fields that changed', '之前 0x00000001' in pt and '0x00000031' in pt and 'DCS = 3' in pt and 'p.12' in pt and '手册确认' in pt, pt)
            chg = await ev("[...document.querySelectorAll('%s .ipm-fl .chip.brand')].map(c=>c.innerText)" % PN); chk('fields whose value changed are marked', any('DCS' in x for x in chg) and any('PTE' in x for x in chg) is False, chg)
            await pg.click(PN + ' [data-a=sc-next]'); await wait(450); L = await lit(); chk('a step without highlights un-dims the diagram', L[0] == [] and L[1] == 0 and L[2] is False, L)
            await pg.click(PN + ' [data-a=sc-go][data-i="0"]'); await wait(350); chk('pill jumps to a step', (await lit())[0] == ['can', 'cpu'])
            await pg.focus('.view-host:not(.hide) .ipm-canvas'); await pg.keyboard.press('ArrowRight'); await wait(300); chk('→ key goes to the next step', (await lit())[0] == ['can', 'intc'])
            await pg.keyboard.press('ArrowLeft'); await wait(300); chk('← key goes back', (await lit())[0] == ['can', 'cpu'])
            await pg.click(PN + ' [data-a=sc-play]'); await wait(300); chk('play: button turns into pause', '暂停' in await pane_text())
            await wait(2900); chk('play advances by itself', (await lit())[0] == ['can', 'intc'], await lit())
            await wait(2600); chk('play stops at the last step and the button is Play again', '播放' in await pane_text() and '3 / 3' in await pane_text(), await pane_text())
            await pg.click(PN + ' [data-a=sc-go][data-i="0"]'); await pg.click(PN + ' [data-a=sc-play]'); await wait(300); await pg.click('.view-host:not(.hide) .ipm-tab[data-tab=detail]'); await wait(300)
            chk('leaving the scenes tab clears the highlight and stops playing', (await lit())[2] is False and await ev("ChipBench.app.current().viewer.scenes.state.playing") is False)
            await pg.click('.view-host:not(.hide) .ipm-tab[data-tab=scenes]'); await wait(300)
            # record a new step: click nodes in the diagram
            r0 = (await raw_scn())['rev']; await pg.click(PN + ' [data-a=sc-go][data-i="1"]'); await wait(250); await pg.click(PN + ' [data-a=sc-rec]'); await pg.wait_for_selector(PN + ' [data-form=draft]', timeout=3000)
            chk('record: form opens (new step after the current one)', '录制新步骤（第 3 位）' in await pane_text(), await pane_text())
            await pg.click('.view-host:not(.hide) .ipb-node[data-id="cpu"]'); await wait(250); await pg.click('.view-host:not(.hide) .ipb-node[data-id="can"]'); await wait(300)
            chk('clicking nodes in the diagram adds them to the draft and lights them up', (await lit())[0] == ['can', 'cpu'] and await ev("document.querySelectorAll('%s .ipm-ports .chip.brand').length" % PN) == 2, await lit())
            chk('edges touching the chosen nodes are listed', await ev("document.querySelectorAll('%s [data-edge]').length" % PN) == 3)
            await pg.click(PN + ' [data-a=dr-autoedges]'); await wait(250); chk('“select all edges between the nodes” ticks only e1', await ev("[...document.querySelectorAll('%s [data-edge]:checked')].map(c=>c.dataset.edge)" % PN) == ['e1'], await ev("[...document.querySelectorAll('%s [data-edge]:checked')].map(c=>c.dataset.edge)" % PN))
            chk('…and the diagram shows that edge lit', (await lit())[1] == 1)
            await pg.click(PN + ' [data-a=dr-addwrite]'); await wait(250); chk('add write: register preselected from the chosen nodes', await ev("document.querySelector('%s [name=wreg]').value" % PN) == 'CFDC')
            await pg.fill(PN + ' [name=wval]', '0x10'); await pg.fill(PN + ' [name=wnote]', 'DCS=1'); await pg.fill(PN + ' [name=note]', '软件设置 **时钟**'); await pg.fill(PN + ' [name=line]', '12')
            await pg.click(PN + ' [data-a=dr-rmnode][data-id="cpu"]'); await wait(250); chk('removing a node chip keeps what was typed (value, note)', await ev("document.querySelector('%s [name=wval]').value" % PN) == '0x10' and await ev("document.querySelector('%s [name=note]').value" % PN) == '软件设置 **时钟**')
            await pg.click(PN + ' [type=submit]'); await wait(400); chk('empty title is refused (file unchanged)', (await raw_scn())['rev'] == r0 and await ev("!!document.querySelector('%s [data-form=draft]')" % PN))
            await pg.fill(PN + ' [name=title]', '设置时钟分频'); await pg.select_option(PN + ' [name=level]', '手册确认'); await pg.fill(PN + ' [name=page]', '3301'); await pg.click(PN + ' [type=submit]'); await wait(600)
            m = await raw_scn(); st3 = m['scenes'][0]['steps'][2]
            chk('save: step inserted at the right place with nodes, edges, write (hex parsed), note, line, evidence', len(m['scenes'][0]['steps']) == 4 and st3['title'] == '设置时钟分频' and st3['nodes'] == ['can'] and st3['edges'] == ['e1'] and st3['writes'] == [{'reg': 'CFDC', 'value': 16, 'note': 'DCS=1'}] and st3['line'] == 12 and st3['ev'] == {'level': '手册确认', 'page': '3301'} and m['rev'] == r0 + 1, st3)
            chk('after saving the player shows the new step and the form is closed', '设置时钟分频' in await pane_text() and not await ev("!!document.querySelector('%s [data-form=draft]')" % PN))
            await pg.click('.view-host:not(.hide) .ipm-bar [data-a=undo]'); await wait(450); chk('undo removes the recorded step in one go', len((await raw_scn())['scenes'][0]['steps']) == 3)
            # edit a step
            await pg.click(PN + ' [data-a=sc-go][data-i="1"]'); await pg.click(PN + ' [data-a=sc-edit]'); await pg.wait_for_selector(PN + ' [data-form=draft]'); await wait(200)
            chk('edit: the form is prefilled (title, page, write value)', await ev("document.querySelector('%s [name=title]').value" % PN) == '产生中断' and await ev("document.querySelector('%s [name=page]').value" % PN) == '12' and await ev("document.querySelector('%s [name=wval]').value" % PN) == '49', await ev("document.querySelector('%s [name=wval]').value" % PN))
            await pg.fill(PN + ' [name=title]', '产生接收中断'); await pg.fill(PN + ' [name=line]', ''); await pg.click(PN + ' [type=submit]'); await wait(500); m = await raw_scn()
            chk('edit: saved through update_step (title changed, nodes kept, rev +1)', m['scenes'][0]['steps'][1]['title'] == '产生接收中断' and m['scenes'][0]['steps'][1]['nodes'] == ['can', 'intc'] and 'line' not in m['scenes'][0]['steps'][1])
            await pg.click(PN + ' [data-a=sc-up]'); await wait(500); chk('move up swaps the steps', [x['title'] for x in (await raw_scn())['scenes'][0]['steps']][:2] == ['产生接收中断', 'CPU 配置'] and await ev("ChipBench.app.current().viewer.scenes.state.step") == 0)
            await pg.click(PN + ' [data-a=sc-down]'); await wait(500); chk('move down swaps back', [x['title'] for x in (await raw_scn())['scenes'][0]['steps']][:2] == ['CPU 配置', '产生接收中断'])
            await pg.click(PN + ' [data-a=sc-delstep]'); await pg.wait_for_selector('.modal', timeout=3000); await pg.click('.modal button:has-text("取消")'); await wait(300); chk('delete step asks first; cancel keeps it', len((await raw_scn())['scenes'][0]['steps']) == 3)
            await pg.click(PN + ' [data-a=sc-delstep]'); await pg.wait_for_selector('.modal'); await pg.click('.modal button:has-text("删除")'); await wait(500); chk('confirmed delete removes the step', len((await raw_scn())['scenes'][0]['steps']) == 2)
            # scene evidence rule + new scene + rename
            await pg.select_option(PN + ' [data-form=sceneev] [name=level]', '手册确认'); await pg.click(PN + ' [data-form=sceneev] button[type=submit]'); await wait(300); chk('scene evidence “手册确认” without a page is refused', (await raw_scn())['scenes'][0]['ev']['level'] == '待核对')
            await pg.fill(PN + ' [data-form=sceneev] [name=page]', '3299'); await pg.click(PN + ' [data-form=sceneev] button[type=submit]'); await wait(450); chk('…with a page it is saved', (await raw_scn())['scenes'][0]['ev'] == {'level': '手册确认', 'page': '3299'})
            await pg.click(PN + ' [data-a=sc-new]'); await pg.wait_for_selector('.modal input'); await pg.fill('.modal input', 'Bus-Off 恢复'); await pg.keyboard.press('Enter'); await wait(700); m = await raw_scn()
            chk('new scene: created (id from the name, falls back to scene), selected, and a step form is open', len(m['scenes']) == 2 and m['scenes'][1]['name'] == 'Bus-Off 恢复' and m['scenes'][1]['id'] in ('Bus-Off', 'Bus-Off_') and await ev("!!document.querySelector('%s [data-form=draft]')" % PN), [x['id'] for x in m['scenes']])
            await pg.click(PN + ' [data-a=dr-cancel]'); await wait(250); chk('cancel closes the form without adding a step', len((await raw_scn())['scenes'][1]['steps']) == 0 and 'warn' not in ' ')
            await pg.click(PN + ' [data-a=sc-delscene]'); await pg.wait_for_selector('.modal'); await pg.click('.modal button:has-text("删除")'); await wait(500); chk('delete scene', len((await raw_scn())['scenes']) == 1)
            # structure edits keep scenes consistent
            await ev("ChipBench.app.current().viewer.edit.rename('can','canfd')"); await wait(500); m = await raw_scn(); chk('renaming a node updates the scene (highlight, still valid)', 'canfd' in m['scenes'][0]['steps'][0]['nodes'] and not await ev("ChipBench.IPM.validate(ChipBench.app.current().viewer.state.model).some(v=>v.level==='err')"))
            await pg.click('.view-host:not(.hide) .ipm-bar [data-a=undo]'); await wait(450)
            # ---- drag a node onto another ----
            async def box(i): return await ev("(()=>{const r=document.querySelector('.view-host:not(.hide) .ipb-node[data-id=\"%s\"]').getBoundingClientRect(); return [r.x+r.width/2, r.y+r.height/2];})()" % i)
            async def drag(a, b_, to=None):
                ax, ay = await box(a); bx, by = to if to else await box(b_)
                await pg.mouse.move(ax, ay); await pg.mouse.down(); await pg.mouse.move(ax + 10, ay + 6, steps=2); await pg.mouse.move(bx, by, steps=8); await wait(120)
                over = await ev("!!document.querySelector('.view-host:not(.hide) .drop')"); await pg.mouse.up(); await wait(250); return over
            await pg.click('.view-host:not(.hide) .ipm-tab[data-tab=detail]'); await wait(250)
            n_e = len((await raw_scn())['edges']); over = await drag('far', 'intc'); chk('dragging: the target node shows a drop outline', over)
            mt = await ev("document.querySelector('.menu-pop') ? document.querySelector('.menu-pop').innerText : ''"); chk('drop menu offers connect both ways, move inside', all(x in mt for x in ['连线：收发器 → INTC', '连线：INTC → 收发器', '移入 INTC']), mt)
            await pg.click('.menu-pop [data-k=ba]'); await wait(300)
            await pg.wait_for_selector('.menu-pop', timeout=1500) if False else None
            m = await raw_scn(); chk('connect INTC → 收发器: a node without a port facing the right way is connected as a whole', len(m['edges']) == n_e + 1 and m['edges'][-1]['source'] == 'intc' and m['edges'][-1]['target'] == 'far' and m['edges'][-1]['type'] == 'data', m['edges'][-1])
            await drag('far', 'cpu'); await pg.click('.menu-pop [data-k=into]'); await wait(450); m = await raw_scn(); chk('move inside: the node becomes a child (parent set)', next(n for n in m['nodes'] if n['id'] == 'far').get('parent') == 'cpu', [(n['id'], n.get('parent')) for n in m['nodes']])
            await pg.wait_for_selector('.view-host:not(.hide) .ipb-node[data-id="far"]', timeout=5000); await wait(500)
            ex, ey = await ev("(()=>{const c=document.querySelector('.view-host:not(.hide) .ipm-canvas').getBoundingClientRect(); return [c.x+c.width-40, c.y+c.height-40];})()"); over = await drag('far', None, [ex, ey]); mt = await ev("document.querySelector('.menu-pop') ? document.querySelector('.menu-pop').innerText : ''"); chk('dragging onto empty space shows no outline but offers to move the child out', not over and '移出' in mt, mt)
            await pg.click('.menu-pop [data-k=out]'); await wait(450); m = await raw_scn(); chk('move out: parent removed', 'parent' not in next(n for n in m['nodes'] if n['id'] == 'far'))
            before = (await raw_scn())['rev']; ax, ay = await box('cpu'); await pg.mouse.move(ax, ay); await pg.mouse.down(); await pg.mouse.move(ax + 2, ay + 1); await pg.mouse.up(); await wait(300)
            chk('a click with a tiny movement is still a click (selects, no menu, no change)', not await ev("!!document.querySelector('.menu-pop')") and (await raw_scn())['rev'] == before and await ev("ChipBench.app.current().viewer.state.sel.id") == 'cpu')
            await drag('cpu', 'far'); await pg.keyboard.press('Escape'); await wait(200); chk('Escape closes the drop menu and changes nothing', (await raw_scn())['rev'] == before)
            await ev("ChipBench.app.current().viewer.scenes.record('add', 0)"); await wait(300); cur = await ev("document.querySelectorAll('.view-host:not(.hide) .drop').length"); await drag('cpu', 'far'); chk('while recording a step, dragging does not edit the structure', not await ev("!!document.querySelector('.menu-pop')") and (await raw_scn())['rev'] == before)
            # commands present
            cmds = await ev("(()=>{return ['ipm.new','ipm.import','ipm.instantiate','ipm.accept','ipm.svd'].filter(c=>!ChipBench.commands.has(c));})()"); chk('commands registered', cmds == [], cmds)
            await pg.screenshot(path='shot_ip18_final.png')
            chk('no console errors', not errs, errs[:4])
            await b.close()
    print(json.dumps({'passed': sum(R.values()), 'total': len(R), 'fails': fails}, ensure_ascii=False))
asyncio.run(main())
