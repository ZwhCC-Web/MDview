"""2.1 · narrow windows: 900 x 700 is the supported minimum.  No page overflow, every side panel and overlay fits, IP Studio keeps a readable
diagram (inspector starts hidden and returns when you select / record), the toolbar wraps instead of clipping, the choice is remembered."""
import asyncio, json
from util import *; from base_fs import *
R = {}; fails = []
def chk(name, cond, info=None):
    R[name] = bool(cond)
    if not cond: fails.append(name); print('FAIL', name, info if info is not None else '')
    else: print('  ok ', name)
def node(i, kind, name, **k): return dict(id=i, type=kind, kind=kind, name=name, params={}, ports=k.get('ports', []), registers=k.get('registers', []), ev=k.get('ev', {'level': '待核对'}), **({'parent': k['parent']} if k.get('parent') else {}))
def port(i, t, d): return dict(id=i, type=t, dir=d)
SCN = dict(schema='chipbench.ip/1', id='scn', name='场景示例', kind='instance', rev=1, chip='', family='', extends='', source='manual.pdf', docrev='', description='', refs=[],
  nodes=[node('cpu', 'cpu', 'CPU', ports=[port('bus', 'bus', 'out')]), node('can', 'periph', 'RS-CANFD', ports=[port('bus', 'bus', 'in'), port('irq', 'irq', 'out')], registers=['CFDC']), node('intc', 'irq', 'INTC', ports=[port('in0', 'irq', 'in')]), node('far', 'ext', '收发器')],
  edges=[dict(id='e1', source='cpu.bus', target='can.bus', type='bus', ev={}), dict(id='e2', source='can.irq', target='intc.in0', type='irq', ev={}), dict(id='e3', source='can', target='far', type='data', ev={})],
  registers={'CFDC': dict(id='CFDC', name='CFDC', width=32, address=0xFFC00000, reset=0, fields=[dict(name='PTE', bits='0', ev={}), dict(name='DCS', bits='5:4', ev={})], ev={})},
  scenes=[dict(id='rx', name='接收一帧', desc='示例', ev={'level': '待核对'}, steps=[dict(title='CPU 配置', note='写 **CFDC**', nodes=['cpu', 'can'], edges=['e1'], writes=[dict(reg='CFDC', value=1, note='PTE=1')], ev={}), dict(title='产生中断', note='', nodes=['can', 'intc'], edges=['e2'], writes=[dict(reg='CFDC', value=0x31)], ev={'level': '手册确认', 'page': 12}), dict(title='无高亮', note='', nodes=[], edges=[], writes=[], ev={})])])

SEL = ".view-host:not(.hide) "
async def main():
    with Server() as srv:
        async with async_playwright() as p:
            fs = base_fs(); fs['C:\\Work\\IP'] = {'dir': 1}; fs['C:\\Work\\IP\\scn.cbip'] = {'t': json.dumps(SCN, ensure_ascii=False)}
            b, ctx, pg, errs = await launch(p, srv, fs, w=900, h=700); ev = pg.evaluate
            async def wait(ms=300): await pg.wait_for_timeout(ms)
            async def text(p_): return await ev("(window.__FS[%s]||{}).t || null" % json.dumps(p_))
            await wait(700)
            doc = lambda: ev("[document.documentElement.scrollWidth, document.documentElement.clientWidth, document.body.scrollWidth]")
            d0 = await doc(); chk('no horizontal page overflow at boot', d0[0] <= d0[1] and d0[2] <= d0[1], d0)
            # every side panel
            bad = {}
            for pid in ['workspace', 'search', 'learn', 'tools', 'atlas', 'plan', 'outline']:
                await ev("ChipBench.panel(%s)" % json.dumps(pid)); await wait(350)
                r = await ev("""(()=>{const s=document.querySelector('#side').getBoundingClientRect(), pane=document.querySelector('#side .pane.on'); const o=[]; pane.querySelectorAll('*').forEach(e=>{if(getComputedStyle(e).display==='none') return; const r=e.getBoundingClientRect(); if(r.width>0&&r.right>s.right+1) o.push((e.className&&typeof e.className==='string'?e.className:e.tagName).slice(0,30));}); return [pane.scrollWidth-pane.clientWidth, o.slice(0,3)];})()""")
                if r[0] > 1 or r[1]: bad[pid] = r
            chk('all 7 side panels fit inside the 260 px sidebar (no clipped controls)', not bad, bad)
            await ev("ChipBench.panel('workspace')")
            # editor
            await ev("ChipBench.openPath('C:\\\\Work\\\\DFA培训\\\\讲稿.md')"); await wait(900)
            m = await ev("(()=>{const r=s=>document.querySelector(s).getBoundingClientRect(); const st=document.querySelector('#status'); return {ed:Math.round(r('#ed-pane').width), tabs:[Math.round(r('#tabs').left), Math.round(r('#tabs').right)], st:[st.scrollWidth, st.clientWidth], side:Math.round(r('#side').width)};})()")
            chk('editor keeps at least 540 px next to the sidebar', m['ed'] >= 540, m); chk('the tab strip stays inside the window', m['tabs'][1] <= 900, m); chk('the status bar does not clip its buttons', m['st'][0] <= m['st'][1] + 1, m)
            clipped = await ev("[...document.querySelectorAll('#status button')].filter(b=>{const r=b.getBoundingClientRect(); return r.right>innerWidth||r.left<0;}).map(b=>b.innerText)"); chk('every status-bar button is inside the window', not clipped, clipped)
            # overlays
            await pg.keyboard.press('F1'); await wait(450); ov = await ev("(()=>{const m=document.querySelector('.modal'); if(!m) return null; const b=m.getBoundingClientRect(); return [b.left>=0, b.right<=innerWidth, b.top>=0, b.bottom<=innerHeight];})()"); chk('F1 shortcut sheet fits the window', ov == [True, True, True, True], ov)
            await pg.keyboard.press('Escape'); await wait(300); await pg.keyboard.press('Control+Shift+P'); await wait(450); ov = await ev("(()=>{const m=document.querySelector('.modal, .palette'); if(!m) return null; const b=m.getBoundingClientRect(); return [b.left>=0, b.right<=innerWidth, b.bottom<=innerHeight];})()"); chk('command palette fits the window', ov == [True, True, True], ov)
            await pg.keyboard.press('Escape'); await wait(300)
            for cmd in ('help.hub', 'plan.week'):
                await ev("ChipBench.run(%s)" % json.dumps(cmd)); await wait(900)
                fp = await ev("(()=>{const f=document.querySelector('.fp'); if(!f) return null; const b=f.getBoundingClientRect(); return [Math.round(b.left),Math.round(b.right),Math.round(f.scrollWidth-f.clientWidth)];})()")
                chk(cmd + ': the full-page view fits (no sideways scrolling)', fp is not None and fp[1] <= 900 and fp[2] <= 1, fp)
                await pg.keyboard.press('Escape'); await wait(400)
            # IP Studio
            await ev("ChipBench.openPath('C:\\\\Work\\\\IP\\\\scn.cbip')"); await pg.wait_for_selector(SEL + '.ipm .ipb-node', timeout=9000); await wait(800)
            g = await ev("(()=>{const q=s=>document.querySelector('.view-host:not(.hide) '+s); const c=q('.ipm-canvas').getBoundingClientRect(); const svg=q('svg.ipb-svg'); return {hidden:q('.ipm').classList.contains('no-side'), cw:Math.round(c.width), k:+svg.dataset.k, pressed:q('[data-a=side]').getAttribute('aria-pressed'), side:getComputedStyle(q('.ipm-side')).display};})()")
            chk('IP Studio at 900 px starts with the inspector hidden', g['hidden'] and g['side'] == 'none' and g['pressed'] == 'false', g)
            chk('…so the canvas is wide (>= 540 px) and the diagram is shown at >= 70 % (was 40 %)', g['cw'] >= 540 and g['k'] >= 0.7, g)
            tb = await ev("(()=>{const bar=document.querySelector('.view-host:not(.hide) .ipm-bar'); const r=bar.getBoundingClientRect(); const out=[...bar.querySelectorAll('button')].filter(b=>{const x=b.getBoundingClientRect(); return x.right>r.right+1||x.left<r.left-1;}).map(b=>b.innerText); return [out, bar.scrollWidth-bar.clientWidth];})()")
            chk('the toolbar wraps instead of clipping or scrolling sideways', tb[0] == [] and tb[1] <= 1, tb)
            await pg.click(SEL + '.ipb-node[data-id="can"]'); await wait(500)
            g = await ev("(()=>{const q=s=>document.querySelector('.view-host:not(.hide) '+s); return {hidden:q('.ipm').classList.contains('no-side'), pane:q('.ipm-pane').innerText.slice(0,40), tabs:[...document.querySelectorAll('.view-host:not(.hide) .ipm-tab')].map(t=>Math.round(t.getBoundingClientRect().height)), tw:[q('.ipm-tabs').scrollWidth, q('.ipm-tabs').clientWidth]};})()")
            chk('selecting a node brings the inspector back with its details', not g['hidden'] and 'RS-CANFD' in g['pane'], g)
            chk('inspector tabs stay on one line (no wrapped labels)', max(g['tabs']) <= 40, g)
            await pg.click(SEL + '[data-a=side]'); await wait(400); lay = json.loads(await text('C:\\Work\\IP\\scn.cbip.layout.json'))
            chk('the 面板 button hides it and the choice is saved in the layout sidecar', await ev("document.querySelector('.view-host:not(.hide) .ipm').classList.contains('no-side')") and lay['view'].get('inspector') is False, lay['view'])
            await pg.click(SEL + '.ipb-node[data-id="cpu"]'); await wait(400); chk('after an explicit hide, selecting does not reopen it', await ev("document.querySelector('.view-host:not(.hide) .ipm').classList.contains('no-side')"))
            await pg.click(SEL + '[data-a=side]'); await wait(400); lay = json.loads(await text('C:\\Work\\IP\\scn.cbip.layout.json')); chk('and the button shows it again (saved as true)', not await ev("document.querySelector('.view-host:not(.hide) .ipm').classList.contains('no-side')") and lay['view'].get('inspector') is True)
            await pg.click(SEL + '[data-a=side]'); await wait(300)
            await ev("ChipBench.app.current().viewer.scenes.pick('rx')"); await wait(300); await ev("ChipBench.app.current().viewer.scenes.record('add', 0)"); await wait(400)
            chk('recording a scene step brings the inspector back (the form lives there)', not await ev("document.querySelector('.view-host:not(.hide) .ipm').classList.contains('no-side')") and await ev("!!document.querySelector('.view-host:not(.hide) [data-form=draft]')"))
            await pg.screenshot(path='shot_narrow21.png')
            chk('no console errors', not errs, errs[:4])
            await b.close()
    print(json.dumps({'passed': sum(R.values()), 'total': len(R), 'fails': fails}, ensure_ascii=False))
asyncio.run(main())
