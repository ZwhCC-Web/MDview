"""ChipBench 1.4 — IP 图谱: panel, page view tabs, scene widget (steps, highlight, camera, registers, code), compare,
validation, new page, copy-to-workspace, writes from the atlas view, scene in the editor.   python tests/t_v14.py"""
import asyncio, json, pathlib
from util import *; from base_fs import *
R = {}; fails = []
def chk(name, cond, info=None):
    R[name] = bool(cond); print(('  ok  ' if cond else 'FAIL ') + name, '' if cond else (info if info is not None else ''))
    if not cond: fails.append(name)
ROOTP = pathlib.Path(__file__).resolve().parent.parent
PAGE = (ROOTP / 'atlas' / 'CAN-FD' / 'RH850-U2B.md').read_text('utf-8')
B = 'C:\\Program Files\\ChipBench\\atlas'

async def main():
    with Server() as srv:
        async with async_playwright() as p:
            fs = base_fs(); fs[B] = {'dir': 1}; fs[B + '\\CAN-FD'] = {'dir': 1}; fs[B + '\\CAN-FD\\RH850-U2B.md'] = {'t': PAGE}; fs[B + '\\CAN-FD\\RH850-U2B.lab.html'] = {'t': '<html><body>lab</body></html>'}
            fs['D:\\Proj'] = {'dir': 1}
            b, ctx, pg, errs = await launch(p, srv, fs, w=1440, h=900); ev = pg.evaluate
            async def wait(ms=300): await pg.wait_for_timeout(ms)
            chk('version 1.4.0', await ev("ChipBench.VERSION==='1.4.0'"))
            await ev("ChipBench.ws.addRootPath('C:\\\\Work')"); await wait(800)
            await ev("ChipBench.wsHome.apply(ChipBench.ws.cur,'D:\\\\Proj\\\\W',{subdirs:true})"); await wait(500)
            # ---- panel
            chk('rail: IP 图谱 button right after 工程工具', await ev("(()=>{const b=[...document.querySelectorAll('#rail .rb[data-p]')].map(x=>x.dataset.p); return b.indexOf('atlas')===b.indexOf('tools')+1})()"))
            await ev("ChipBench.panel('atlas')"); await wait(900)
            t = await ev("document.querySelector('#pane-atlas').innerText")
            chk('panel lists bundled CAN-FD / RH850/U2B as 示例', 'CAN-FD' in t and 'RH850/U2B' in t and '示例' in t, t[:200])
            await ev("(()=>{const i=document.querySelector('#pane-atlas .at-search input'); i.value='zzz'; i.dispatchEvent(new Event('input'))})()"); await wait(300)
            chk('panel filter', 'RH850/U2B' not in await ev("document.querySelector('#pane-atlas').innerText"))
            await ev("(()=>{const i=document.querySelector('#pane-atlas .at-search input'); i.value=''; i.dispatchEvent(new Event('input'))})()"); await wait(300)
            # ---- page view
            await pg.click('#pane-atlas .at-row'); await wait(1200)
            tabs = await ev("[...document.querySelectorAll('.at-tabs button')].map(b=>b.textContent)")
            chk('page tabs', tabs == ['概览', '结构', '场景动画', '寄存器', '时序', '代码', '要点与坑', '芯片对比', '交互实验台'], tabs)
            chk('概览: 12 facts + section text + source', await ev("document.querySelectorAll('.at-facts tr').length") == 12 and 'RS-CANFD' in await ev("document.querySelector('.at-ovtext').innerText"))
            chk('bundled page offers 复制到工作区 (not 编辑)', await ev("!!document.querySelector('.at-head [data-x=copy]') && !document.querySelector('.at-head [data-x=edit]')"))
            await ev("document.querySelector('.at-tabs [data-t=\"结构\"]').click()"); await pg.wait_for_function("document.querySelector('.at-view .ipb-svg')", timeout=20000); await wait(300)
            chk('结构: ipblock with 13 blocks', await ev("document.querySelectorAll('.at-view .ipb-node').length") == 13)
            # ---- scenes
            await ev("document.querySelector('.at-tabs [data-t=\"场景\"]').click()"); await pg.wait_for_function("document.querySelectorAll('.at-view .sc .ipb-svg').length===3", timeout=30000); await wait(700)
            chk('场景: 3 scene widgets with step pills', await ev("[...document.querySelectorAll('.sc')].map(s=>s.querySelectorAll('.sc-steps button').length).join()") == '8,8,5')
            sc = ".sc:nth-of-type(1)"
            first = await ev("(()=>{const s=document.querySelector('.sc'); return {lit:[...s.querySelectorAll('.ipb-node.lit')].map(n=>n.dataset.id).sort(), edge:[...s.querySelectorAll('.ipb-edge.lit')].length, pk:s.querySelectorAll('.sc-pk').length, title:s.querySelector('.sc-nar h4').textContent}})()")
            chk('step 1 highlights pins + pc, lit link + moving packet', first['lit'] == ['pc', 'pins'] and first['edge'] == 1 and first['pk'] == 1 and first['title'] == 'CAN0RX 采样总线', first)
            vb0 = await ev("document.querySelector('.sc .ipb-svg').getAttribute('viewBox')")
            await ev("document.querySelector('.sc [data-a=next]').click()"); await wait(100)
            for _ in range(3): await ev("document.querySelector('.sc [data-a=next]').click()"); await wait(80)
            await wait(700)
            st = await ev("(()=>{const s=document.querySelector('.sc'); return {tag:s.querySelector('.sc-tag').textContent, lit:[...s.querySelectorAll('.ipb-node.lit')].map(n=>n.dataset.id).sort(), regs:[...s.querySelectorAll('.sc-reg b.mono')].map(x=>x.textContent), fields:s.querySelector('.sc-reg .sc-fs') ? s.querySelector('.sc-reg').innerText : '', vb:s.querySelector('.ipb-svg').getAttribute('viewBox'), on:s.querySelector('.sc-steps .on').textContent}})()")
            chk('step 5: 写入 RX FIFO 0 highlights afl + msgram', st['tag'] == 'STEP 5 / 8' and st['lit'] == ['afl', 'msgram'] and '写入 RX FIFO' in st['on'], st)
            chk('step 5: registers decoded with fields from the page', st['regs'] == ['RFID0', 'RFPTR0', 'RFFDSTS0'] and 'IDE' in st['fields'] and '0x18F' in st['fields'], st)
            chk('camera follows (viewBox zoomed in)', float(st['vb'].split()[2]) < await ev("parseFloat(document.querySelector('.sc .ipb-svg').getAttribute('width'))") * .8, st['vb'])
            await ev("document.querySelector('.sc [data-a=cam]').click()"); await wait(700)
            full = await ev("(()=>{const s=document.querySelector('.sc .ipb-svg'); return [parseFloat(s.getAttribute('viewBox').split(' ')[2]), parseFloat(s.getAttribute('width'))]})()")
            chk('camera off → full diagram', abs(full[0] - full[1]) < 3, full)
            await ev("document.querySelector('.sc .sc-steps button[data-k=\"5\"]').click()"); await wait(300)
            chg = await ev("(()=>{const s=document.querySelector('.sc'); return [...s.querySelectorAll('.sc-reg')].map(r=>[r.querySelector('b.mono').textContent, r.classList.contains('chg'), r.querySelectorAll('.sc-f.ch').length])})()")
            chk('step 6: RFSTS0 first value; RFISTS', [c[0] for c in chg] == ['RFSTS0', 'RFISTS'], chg)
            await ev("document.querySelector('.sc .sc-steps button[data-k=\"7\"]').click()"); await wait(300)
            r8 = await ev("(()=>{const s=document.querySelector('.sc'); const r=[...s.querySelectorAll('.sc-reg')].find(x=>x.querySelector('b.mono').textContent==='RFSTS0'); return {chg:r.classList.contains('chg'), fch:[...r.querySelectorAll('.sc-f.ch .n')].map(x=>x.textContent), code:s.querySelector('.sc-code .on')?.textContent||''}})()")
            chk('step 8: RFSTS0 change vs step 6 marked (RFMC/RFIF/RFEMP)', r8['chg'] and set(['RFMC', 'RFIF', 'RFEMP']) <= set(r8['fch']), r8)
            chk('step 8: highlighted code line from the 2nd C block', 'RFPCTR0' in r8['code'] or 'RFSTS0 & RFEMP' in r8['code'] or 'while' in r8['code'], r8['code'])
            await ev("document.querySelector('.sc').focus()"); await pg.keyboard.press('ArrowLeft'); await wait(150)
            chk('keyboard ← moves back', await ev("document.querySelector('.sc .sc-tag').textContent") == 'STEP 7 / 8')
            await ev("document.querySelector('.sc [data-a=speed]').value='1600'; document.querySelector('.sc [data-a=play]').click()"); await wait(1900)
            chk('play advances automatically and stops at the end', await ev("document.querySelector('.sc .sc-tag').textContent") == 'STEP 8 / 8')
            # ---- registers tab
            await ev("document.querySelector('.at-tabs [data-t=\"寄存器\"]').click()"); await wait(2500)
            n = await ev("document.querySelectorAll('.at-view .widget[data-w=register]').length")
            await ev("(()=>{const i=document.querySelector('.at-rbar input'); i.value='RFSTS'; i.dispatchEvent(new Event('input'))})()"); await wait(200)
            vis = await ev("[...document.querySelectorAll('.at-view .widget[data-w=register]')].filter(w=>w.style.display!=='none').length")
            chk('寄存器: 33 blocks, search filters', n == 33 and 1 <= vis <= 3, (n, vis))
            # ---- timing / code / compare / lab / validate
            await ev("document.querySelector('.at-tabs [data-t=\"时序\"]').click()"); await wait(1200)
            chk('时序: 2 wavedrom diagrams', await ev("document.querySelectorAll('.at-view .widget[data-w=wavedrom] svg').length") >= 2)
            await ev("document.querySelector('.at-tabs [data-t=\"代码\"]').click()"); await wait(800)
            chk('代码: 3 C blocks', await ev("document.querySelectorAll('.at-view pre code, .at-view pre').length") >= 3)
            await ev("document.querySelector('.at-tabs [data-t=\"对比\"]').click()"); await wait(800)
            chk('对比 with one chip explains how to add more', '只有这一颗芯片' in await ev("document.querySelector('.at-view').innerText"))
            await ev("document.querySelector('.at-head [data-x=validate]').click()"); await wait(400)
            vt = await ev("document.querySelector('.modal').innerText")
            chk('检查: bundled page has no errors, only the honest 页码 reminder', '错误' not in vt and '没有手册页码' in vt, vt)
            await pg.keyboard.press('Escape'); await wait(200)
            # ---- copy to workspace → editable, writes from atlas view
            await ev("document.querySelector('.at-tabs [data-t=\"概览\"]').click()"); await wait(200)
            await ev("document.querySelector('.at-head [data-x=copy]').click()"); await wait(1500)
            chk('copy to workspace → D:\\Proj\\W\\IP图谱\\CAN-FD\\ (md + lab)', await ev("ChipBench.fs.kind('D:\\\\Proj\\\\W\\\\IP图谱\\\\CAN-FD\\\\RH850-U2B.md')") == 'file' and await ev("ChipBench.fs.kind('D:\\\\Proj\\\\W\\\\IP图谱\\\\CAN-FD\\\\RH850-U2B.lab.html')") == 'file')
            chk('workspace copy replaces example in panel; now 编辑源文件', await ev("ChipBench.atlas.pages.filter(p=>p.chip==='RH850/U2B').length") == 1 and await ev("!ChipBench.atlas.pages.find(p=>p.chip==='RH850/U2B').bundled") and await ev("!!document.querySelector('.at-head [data-x=edit]')"))
            await ev("document.querySelector('.at-tabs [data-t=\"结构\"]').click()"); await pg.wait_for_function("document.querySelector('.at-view .ipb-svg')", timeout=20000); await wait(300)
            await ev("document.querySelector('.at-view .ipb-node[data-id=\"afl\"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))"); await wait(150)
            await ev("document.querySelector('.at-view .ipb-side [data-st=verified]').click()"); await wait(1500)
            txt = await ev("ChipBench.fs.read('D:\\\\Proj\\\\W\\\\IP图谱\\\\CAN-FD\\\\RH850-U2B.md').then(r=>r.text)")
            chk('确认 in atlas view writes status into the file', 'status: verified' in txt.split('id: afl')[1].split('}')[0], txt[txt.find('id: afl'):][:160])
            chk('atlas view stays on 结构 tab after write', await ev("document.querySelector('.at-tabs .on').dataset.t") == '结构')
            await ev("document.querySelector('.at-tabs [data-t=\"实验台\"]').click(); document.querySelector('[data-lab]').click()"); await wait(1200)
            chk('实验台 opens the lab html in a tab', (await ev("ChipBench.app.current().name")) == 'RH850-U2B.lab.html')
            # ---- new page
            await ev("void ChipBench.atlas.newPage()"); await wait(400)
            await ev("document.querySelector('#atn-ip').value='Ethernet'; document.querySelector('#atn-chip').value='RH850/U2B'; [...document.querySelectorAll('.modal button')].find(b=>b.textContent==='创建').click()"); await wait(1800)
            chk('new page created from template and opened', await ev("ChipBench.fs.kind('D:\\\\Proj\\\\W\\\\IP图谱\\\\Ethernet\\\\RH850-U2B.md')") == 'file' and await ev("!!document.querySelector('.at-tabs [data-t=\"场景\"]')"))
            await ev("document.querySelector('.at-tabs [data-t=\"场景\"]').click()"); await pg.wait_for_function("document.querySelector('.at-view .sc .ipb-svg')", timeout=20000); await wait(400)
            chk('template scene renders and steps work', await ev("document.querySelectorAll('.at-view .sc .sc-steps button').length") == 3 and await ev("document.querySelectorAll('.at-view .sc .ipb-node.lit').length") == 2)
            await ev("document.querySelector('.at-head [data-x=validate]').click()"); await wait(300)
            chk('template validates without errors', '错误' not in await ev("document.querySelector('.modal').innerText"), await ev("document.querySelector('.modal').innerText"))
            await pg.keyboard.press('Escape'); await wait(200)
            await ev("document.querySelector('.fp [data-x=edit], .at-head [data-x=edit]').click()"); await wait(1500)
            chk('编辑源文件 opens markdown; scene renders in live editor', await ev("ChipBench.app.current().name") == 'RH850-U2B.md' and await ev("!!document.querySelector('.cm-content .sc')"))
            # ---- panel groups: two IPs
            await ev("ChipBench.panel('atlas')"); await wait(900)
            chk('panel groups by IP', await ev("[...document.querySelectorAll('#pane-atlas .at-ip b')].map(x=>x.textContent).join()") == 'CAN-FD,Ethernet')
            # ---- validation catches errors
            bad = await ev("ChipBench.atlas.validate(ChipBench.atlas.parse('---\\ntype: ip-atlas\\nip: X\\nchip: Y\\n---\\n## 结构\\n```ipblock\\ntitle: D\\nblocks:\\n  - {id: a}\\n```\\n## 场景\\n```scene\\ndiagram: D\\nsteps:\\n  - {t: s, hl: [zz], regs: [{r: Q, v: 1}], line: 3}\\n```\\n')).map(x=>x[0]+':'+x[1]).join('|')")
            chk('validate: missing block / register / code / narration', 'zz' in bad and 'Q' in bad and '代码' in bad and '讲解' in bad, bad)
            chk('no page errors', not [e for e in errs if 'pageerror' in e], errs[:5])
            await b.close()
    print(json.dumps({'passed': sum(R.values()), 'total': len(R), 'fails': fails}, ensure_ascii=False))
asyncio.run(main())
