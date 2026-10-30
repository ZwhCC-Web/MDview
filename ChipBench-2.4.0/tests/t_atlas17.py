"""1.7 · IP atlas as one knowledge model: evidence & consistency tab, register impact, port-level links in ipblock."""
import asyncio, json, pathlib
from util import *; from base_fs import *
R = {}; fails = []
def chk(name, cond, info=None):
    R[name] = bool(cond)
    if not cond: fails.append(name); print('FAIL', name, info if info is not None else '')
    else: print('  ok ', name)
ROOTP = pathlib.Path(__file__).resolve().parent.parent; PAGE = (ROOTP / 'atlas' / 'CAN-FD' / 'RH850-U2B.md').read_text('utf-8'); B = 'C:\\Program Files\\ChipBench\\atlas'
PORTS = "# 端口\n\n```ipblock\ntitle: 端口示例\ndirection: right\nblocks:\n  - {id: pins, label: 引脚, kind: io, ports: [{id: tx, dir: out}, {id: rx, dir: in}]}\n  - {id: pc, label: 协议控制器, kind: logic}\nlinks:\n  - {from: pins.rx, to: pc, kind: data}\n  - {from: pc, to: pins.tx, kind: data}\n```\n"
async def main():
    with Server() as srv:
        async with async_playwright() as p:
            fs = base_fs(); fs[B] = {'dir': 1}; fs[B + '\\CAN-FD'] = {'dir': 1}; fs[B + '\\CAN-FD\\RH850-U2B.md'] = {'t': PAGE}; fs[B + '\\CAN-FD\\RH850-U2B.lab.html'] = {'t': '<html></html>'}; fs['C:\\Work\\ports.md'] = {'t': PORTS}
            b, ctx, pg, errs = await launch(p, srv, fs); ev = pg.evaluate
            async def wait(ms=300): await pg.wait_for_timeout(ms)
            await ev("ChipBench.panel('atlas')"); await wait(900); await pg.click('#pane-atlas .at-row'); await wait(1200)
            await ev("document.querySelector('.at-tabs [data-t=\"依据\"]').click()"); await pg.wait_for_selector('.ev-wrap', timeout=8000)
            cards = await ev("[...document.querySelectorAll('.ev-card')].map(c=>c.querySelector('.ev-k').innerText+':'+c.querySelector('.ev-n').innerText.replace(/\\s/g,''))")
            chk('evidence cards: 13 blocks / 33 registers / 21 steps, 0 with page (honest)', cards[0].startswith('模块:0/13') and cards[1].startswith('寄存器:0/33') and cards[3].startswith('场景步骤:0/21'), cards)
            txt = await ev("document.querySelector('.ev-wrap').innerText")
            chk('shows manual source and missing docrev', 'r01uh0923ej0130-rh850u2b.pdf' in txt and '未填写' in txt)
            chk('consistency: 0 errors, page reminder present', '0 个错误' in txt and '13 个模块没有手册页码' in txt, txt[:600]); chk('missing-page list names blocks', 'afl' in txt and 'GCTR' in txt)
            await pg.fill('.ev-sel input', 'RFSTS0'); await wait(300); it = await ev("document.querySelector('.ev-out').innerText")
            chk('impact: lists owning block, scene steps and code lines', '所属模块（1）' in it or '所属模块（2）' in it, it[:400]); chk('impact: lists scene step with changed fields', '变化：' in it and 'RFMC' in it, it)
            await pg.fill('.ev-sel input', 'ZZZ'); await wait(200); chk('impact: unknown register', '本页没有这个寄存器' in await ev("document.querySelector('.ev-out').innerText"))
            await ev("document.querySelector('.at-head [data-x=validate]').click()"); await wait(300)
            chk('检查 dialog still works (no errors, page reminder)', '错误' not in await ev("document.querySelector('.modal').innerText") and '没有手册页码' in await ev("document.querySelector('.modal').innerText"))
            await pg.keyboard.press('Escape'); await wait(200); await ev("ChipBench.closeFull && ChipBench.closeFull()"); await wait(300)
            await ev("ChipBench.openPath('C:\\\\Work\\\\ports.md')"); await wait(900); await ev("ChipBench.app.mode='read'; ChipBench.run('mode.read')"); await wait(300)
            await pg.wait_for_function("document.querySelector('.ipb-svg')", timeout=20000); await wait(400)
            lbl = await ev("[...document.querySelectorAll('.ipb-svg text')].map(t=>t.textContent).join('|')"); chk('port link without label gets a port label', 'rx' in lbl and 'tx' in lbl, lbl)
            chk('port ends resolve to blocks: 2 nodes, no "不存在" issue', await ev("document.querySelectorAll('.ipb-svg .ipb-node').length") == 2 and '不存在' not in await ev("document.body.innerText"))
            await pg.click('.ipb-node[data-id="pins"]'); await wait(300); side = await ev("document.querySelector('.ipb-side').innerText")
            chk('side panel lists ports with link counts', '端口' in side and 'rx' in side and '1 条连线' in side, side)
            chk('no console errors', not errs, errs[:3]); await b.close()
    print(json.dumps({'passed': sum(R.values()), 'total': len(R), 'fails': fails}, ensure_ascii=False))
    raise SystemExit(1 if fails else 0)
asyncio.run(main())
