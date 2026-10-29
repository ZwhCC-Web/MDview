"""ChipBench 1.6.0 — robustness fixes from the deep review: malformed scene / register data, 64-bit values, atlas page zoom,
welcome entry, scene animation paused off-screen, MCP argument validation.   python tests/t_v141.py"""
import asyncio, json, pathlib
from util import *; from base_fs import *
R = {}; fails = []
def chk(name, cond, info=None):
    R[name] = bool(cond); print(('  ok  ' if cond else 'FAIL ') + name, '' if cond else (info if info is not None else ''))
    if not cond: fails.append(name)
ROOTP = pathlib.Path(__file__).resolve().parent.parent
PAGE = (ROOTP / 'atlas' / 'CAN-FD' / 'RH850-U2B.md').read_text('utf-8')
BAD = '# x\n\n```ipblock\ntitle: X\nblocks:\n  - {id: a, kind: cpu}\n```\n\n```scene\ntitle: S2\nsteps: oops\n```\n\n```register\nname: R\nwidth: 32\nfields:\n  - {name: F, bits: "abc"}\n  - {name: G, bits: "40:33"}\n  - {name: H, bits: "3:0"}\n```\n\n```scene\ntitle: S3\nsteps:\n  - {t: 大值, hl: [a], regs: [{r: R, v: 0x1FFFFFFFF}, {r: R, v: hello}, {r: R, v: 0x5}]}\n  - just text\n```\n'
B = 'C:\\Program Files\\ChipBench\\atlas'
async def main():
    with Server() as srv:
        async with async_playwright() as p:
            fs = base_fs(); fs[B] = {'dir': 1}; fs[B + '\\CAN-FD'] = {'dir': 1}; fs[B + '\\CAN-FD\\RH850-U2B.md'] = {'t': PAGE}; fs['C:\\Work\\bad.md'] = {'t': BAD}
            b, ctx, pg, errs = await launch(p, srv, fs, w=1440, h=900); ev = pg.evaluate
            async def wait(ms=300): await pg.wait_for_timeout(ms)
            chk('version 1.7.1', await ev("ChipBench.VERSION==='1.7.1'"))
            chk('welcome page has IP 图谱 entry', await ev("!!document.querySelector('.welcome [data-c=\"atlas.open\"]')"))
            await ev("ChipBench.ws.addRootPath('C:\\\\Work')"); await wait(700)
            await ev("ChipBench.openPath('C:\\\\Work\\\\bad.md')"); await wait(1200); await ev("ChipBench.app.setMode('read')"); await wait(3000)
            t = await ev("[...document.querySelectorAll('#pv-pane .widget')].map(w=>w.innerText.replace(/\\s+/g,' ')).join(' ¦ ')")
            chk('scene with steps: "oops" explains the list format (no crash)', 'steps 必须是列表' in t and '没有可播放的步骤' in t, t[:300])
            chk('register: invalid bit definition reported', 'F 的位定义 “abc” 无效' in t and 'G 超出寄存器宽度' in t, t[:400])
            s3 = await ev("[...document.querySelectorAll('#pv-pane .sc')].find(x=>x.innerText.includes('S3')).querySelector('.sc-nar').innerText.replace(/\\s+/g,' ')")
            chk('scene: >32-bit value shown in full + width warning', '0x1FFFFFFFF' in s3 and '值超出 32 位宽度' in s3, s3)
            chk('scene: non-numeric value explained', '值 “hello” 不是数字' in s3, s3)
            chk('scene: valid field still decoded; bad fields listed', 'H' in s3 and '位定义无效：F、G' in s3, s3)
            chk('scene: non-map step skipped (1 step)', await ev("[...document.querySelectorAll('#pv-pane .sc')].find(x=>x.innerText.includes('S3')).querySelectorAll('.sc-steps button').length") == 1)
            v = await ev("ChipBench.atlas.validate(ChipBench.atlas.parse(ChipBench.app.ed ? ChipBench.app.ed.value : '')).map(x=>x[1]).join('|')")
            chk('validate flags steps-not-a-list and non-map step', 'steps 必须是列表' in v and '不是 {…} 格式' in v, v)
            await ev("ChipBench.app.setMode('live')")
            # atlas zoom
            await ev("ChipBench.atlas.scan().then(()=>ChipBench.atlas.open(ChipBench.atlas.pages[0].path,'概览'))"); await wait(1300)
            await pg.mouse.move(600, 400); await pg.keyboard.down('Control'); await pg.mouse.wheel(0, -100); await pg.keyboard.up('Control'); await wait(200)
            chk('Ctrl+wheel zooms the atlas page', await ev("getComputedStyle(document.querySelector('.at-view')).zoom") == '1.1')
            await ev("ChipBench.run('zoomIn')"); await wait(100)
            chk('Ctrl+= zooms the atlas page when it is open', await ev("getComputedStyle(document.querySelector('.at-view')).zoom") == '1.25')
            await ev("ChipBench.run('zoomReset')"); await wait(100)
            chk('reset restores 100%', await ev("getComputedStyle(document.querySelector('.at-view')).zoom") == '1')
            # off-screen scenes pause
            await ev("document.querySelector('.at-tabs [data-t=\"场景\"]').click()"); await pg.wait_for_function("document.querySelectorAll('.at-view .sc .ipb-svg').length===3", timeout=30000); await wait(800)
            await ev("document.querySelector('.at-view').scrollTop=0"); await wait(400)
            chk('scene below the fold is marked off-screen (animations paused)', await ev("(()=>{const s=[...document.querySelectorAll('.at-view .sc')]; return !s[0].classList.contains('sc-off') && s[2].classList.contains('sc-off')})()"))
            await ev("ChipBench.closeFull()")
            # learn stats on one line
            await ev("ChipBench.panel('learn')"); await wait(500)
            chk('learn stat labels do not wrap', await ev("[...document.querySelectorAll('.lc-stat span')].every(s=>s.getBoundingClientRect().height<20)"))
            chk('no page errors', not [e for e in errs if 'pageerror' in e], errs[:5])
            await b.close()
    print(json.dumps({'passed': sum(R.values()), 'total': len(R), 'fails': fails}, ensure_ascii=False))
asyncio.run(main())
import sys as _sys; _sys.exit(1 if fails else 0)
