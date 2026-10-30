"""Regenerate docs/screenshots for 1.0:  python tests/shots_v1.py"""
import asyncio, json
from util import *; from base_fs import *
OUT = ROOT / 'docs' / 'screenshots'
NOTE = '# TSN 配置笔记\n\n来源：U2B UM Section 28，Table 28.654（p.4169）。\n\n```gcl\ntitle: TAS 门控列表（ETND0）\nsource: UM Section 28\npage: 4169\nlink: 1Gbps\ncycle: 500us\nmaxFrame: 1522\nexpress: [7, 6]\npreemptable: [3, 2, 1, 0]\nentries:\n  - {dur: 100us, gates: "11000000", note: 控制流}\n  - {dur: 390us, gates: "00111111", note: 尽力而为}\n  - {dur: 10us, gates: "00000000", note: 保护带}\n```\n\n```wavedrom\n{"signal": [{"name": "SCK", "wave": "p......."}, {"name": "CS", "wave": "10.....1"}, {"name": "MOSI", "wave": "x3.4.5.x", "data": "CMD ADDR DATA"}]}\n```\n'
async def main():
    with Server() as srv:
        async with async_playwright() as p:
            fs = base_fs(); fs['C:\\Work\\DFA培训\\资料\\ivn.pcap'] = {'b': b64(F / 'ivn_sample.pcap')}; fs['C:\\Work\\DFA培训\\TSN.md'] = {'t': NOTE}
            sk = 'C:\\Program Files\\ChipBench\\skills'; fs[sk] = {'dir': 1}
            for d in sorted((ROOT / 'skills').iterdir()):
                fs[sk + '\\' + d.name] = {'dir': 1}; fs[sk + '\\' + d.name + '\\SKILL.md'] = {'t': (d / 'SKILL.md').read_text('utf-8')}
            b, ctx, pg, errs = await launch(p, srv, fs, w=1440, h=900); ev = pg.evaluate
            async def wait(ms=500): await pg.wait_for_timeout(ms)
            await ev("ChipBench.ws.addRootPath(%s)" % json.dumps('C:\\Work\\DFA培训')); await wait(800)
            await ev("ChipBench.openPath(%s)" % json.dumps('C:\\Work\\DFA培训\\TSN.md')); await wait(1500); await ev("ChipBench.app.setMode('read')"); await wait(1500)
            await pg.screenshot(path=str(OUT / 'tsn-widgets.png'))
            await ev("ChipBench.panel('tools')"); await wait(600)
            await ev("ChipBench.openPath(%s)" % json.dumps('C:\\Work\\DFA培训\\资料\\ivn.pcap')); await wait(1500); await pg.screenshot(path=str(OUT / 'pcap-viewer.png'))
            await ev("ChipBench.run('skills.open')"); await wait(4000); await pg.screenshot(path=str(OUT / 'skills.png'))
            print('errs', errs); await b.close()
asyncio.run(main())
