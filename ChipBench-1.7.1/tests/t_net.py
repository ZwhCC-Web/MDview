"""ChipBench 1.0 — Ethernet workbench, widgets, skills library, rail.   python tests/t_net.py"""
import asyncio, json
from util import *; from base_fs import *
R = {}; fails = []
def chk(name, cond, info=None):
    R[name] = bool(cond); print(('  ok  ' if cond else 'FAIL ') + name, '' if cond else (info if info is not None else ''))
    if not cond: fails.append(name)
GCL = '```gcl\\ntitle: T\\nlink: 1Gbps\\ncycle: 400us\\nexpress: [7]\\nentries:\\n  - {dur: 100us, gates: [7]}\\n  - {dur: 200us, gates: [0, 1]}\\n```'
WAVE = '```wavedrom\\n{"signal": [{"name": "clk", "wave": "p...."}, {"name": "d", "wave": "x34.x", "data": "A B"}]}\\n```'
async def main():
    with Server() as srv:
        async with async_playwright() as p:
            fs = base_fs(); fs['C:\\Work\\DFA培训\\资料\\ivn.pcap'] = {'b': b64(F / 'ivn_sample.pcap')}
            sk = 'C:\\Program Files\\ChipBench\\skills'
            fs[sk] = {'dir': 1}; fs[sk + '\\pcap-triage'] = {'dir': 1}; fs[sk + '\\pcap-triage\\SKILL.md'] = {'t': '---\nname: pcap-triage\ndescription: 抓包初筛\n---\n# x\n'}
            fs[sk + '\\pcap-triage\\scripts'] = {'dir': 1}; fs[sk + '\\pcap-triage\\scripts\\aenet.py'] = {'t': 'print(1)\n'}
            b, ctx, pg, errs = await launch(p, srv, fs); ev = pg.evaluate
            async def wait(ms=300): await pg.wait_for_timeout(ms)
            rail = await ev("[...document.querySelectorAll('#rail [data-p]')].map(b=>b.dataset.p+(b.classList.contains('rb-sec')?'*':'')).join()")
            chk('rail: 6 primary entries (incl. IP 图谱), outline secondary, no git / ai', rail.startswith('workspace,search,learn,tools,atlas,plan,outline*') and 'git' not in rail and 'ai' not in rail.split(','), rail)
            chk('version 1.7.1 + name', await ev("ChipBench.VERSION==='1.7.1' && ChipBench.NAME==='ChipBench' && ChipBench.s31.version==='1.7.1'"))
            await ev("ChipBench.openPath(%s)" % json.dumps('C:\\Work\\DFA培训\\资料\\ivn.pcap')); await pg.wait_for_selector('.view-host:not(.hide) .net-tbl tbody tr', timeout=10000); await wait()
            n = await ev("document.querySelectorAll('.view-host:not(.hide) .net-tbl tbody tr').length")
            chk('pcap: 29 packets listed', n == 29, n)
            txt = await ev("document.querySelector('.view-host:not(.hide) .net-cards').innerText")
            chk('pcap: issues + gPTP + DoIP + SOME/IP-SD cards', '路由激活失败' not in txt and all(k in txt for k in ['3 倍', 'SubscribeAck', '路由激活响应', 'Follow_Up', 'RST']), txt[:400])
            await pg.fill('.view-host:not(.hide) #net-q', 'NRC'); await wait(400)
            chk('pcap: filter', await ev("document.querySelectorAll('.view-host:not(.hide) .net-tbl tbody tr').length") == 1)
            await pg.click('.view-host:not(.hide) [data-a="report"]'); await wait(800)
            chk('pcap: report note created', '## gPTP' in await ev("ChipBench.app.ed ? ChipBench.app.ed.value : ''"))
            await ev("ChipBench.newDoc(%s, 'tsn.md', {keep:true})" % json.dumps(GCL.replace('\\n', '\n') + '\n\n' + WAVE.replace('\\n', '\n') + '\n')); await wait(300)
            await ev("ChipBench.app.setMode('read')"); await wait(1200)
            chk('gcl widget: 8 queue rows + timeline', await ev("document.querySelectorAll('.gcl-svg').length>=1 && document.querySelectorAll('.gcl-tbl tr').length===9"))
            gi = await ev("[...document.querySelectorAll('.gcl .dg-issues .chip')].map(c=>c.innerText).join('|')")
            chk('gcl widget: cycle + guard-band issues', '总时长' in gi and '保护带' in gi, gi)
            chk('wavedrom widget: lanes + labels', await ev("(()=>{const s=document.querySelector('.wave-svg'); return !!s && [...s.querySelectorAll('.wave-lbl')].map(t=>t.textContent).join()==='A,B' && s.querySelectorAll('.wave-name').length===2})()"))
            await ev("ChipBench.run('net.cbs')"); await wait(300)
            chk('cbs dialog', '75000 kbit/s' in await ev("document.querySelector('.modal').innerText"))
            await ev("document.querySelector('.modal-bg').remove()")
            await ev("ChipBench.ws.addRootPath(%s)" % json.dumps('C:\\Work')); await wait(600)
            await ev("ChipBench.run('skills.open')"); await wait(1200)
            mt = await ev("document.querySelector('.modal').innerText")
            chk('skills library lists bundled skill', 'pcap-triage' in mt and '内置' in mt, mt[:300])
            roots = await ev("ChipBench.ws.cur.roots.map(r=>r.path)")
            await pg.click('.modal [data-i]', timeout=8000); await wait(1500)
            if len(roots) > 1:
                await pg.click('.modal-bg:last-child [data-r]'); await wait(1500)
            inst = await ev("Object.keys(window.__FS).filter(k=>k.includes(%s)).join('|')" % json.dumps('.agents\\skills\\pcap-triage'))
            chk('skills: install copies folder into workspace', 'SKILL.md' in inst and 'aenet.py' in inst, inst)
            chk('tools panel: Ethernet group', await ev("(ChipBench.s31.panels.TOOLS||[]).some(g=>g.g==='车载以太网' && g.items.length===4)"))
            chk('no console / page errors', not errs, errs[:3])
            await b.close()
    print(json.dumps({'passed': sum(R.values()), 'total': len(R), 'fails': fails}, ensure_ascii=False))
asyncio.run(main())

import sys as _sys; _sys.exit(1 if fails else 0)  # CI: non-zero exit on any failed check
