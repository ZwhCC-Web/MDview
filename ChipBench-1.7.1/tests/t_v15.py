"""ChipBench 1.5 — review round: built-in AI atlas tools, bundled atlas pages in search, page status selector, learn panel
entry, line icons instead of emoji in menus, two-chip comparison in the UI.   python tests/t_v15.py"""
import asyncio, json, pathlib
from util import *; from base_fs import *
R = {}; fails = []
def chk(name, cond, info=None):
    R[name] = bool(cond); print(('  ok  ' if cond else 'FAIL ') + name, '' if cond else (info if info is not None else ''))
    if not cond: fails.append(name)
ROOTP = pathlib.Path(__file__).resolve().parent.parent
PAGE = (ROOTP / 'atlas' / 'CAN-FD' / 'RH850-U2B.md').read_text('utf-8')
B = 'C:\\Program Files\\ChipBench\\atlas'
U2A = '---\ntype: ip-atlas\nip: CAN-FD\nchip: RH850/U2A\nstatus: 草稿\nfacts: {通道数: "6", 每通道 TX buffer: 32}\n---\n# U2A\n\n## 概览\n\nU2A 的 CAN。\n\n## 结构\n\n```ipblock\ntitle: U2A CAN\nblocks:\n  - {id: cpu, kind: cpu}\n  - {id: pc, kind: logic}\nlinks:\n  - {from: cpu, to: pc, kind: bus}\n```\n\n## 场景\n\n## 寄存器\n\n```register\nname: GCFG\nwidth: 32\nfields:\n  - {name: DCS, bits: "4"}\n```\n'
async def main():
    with Server() as srv:
        async with async_playwright() as p:
            fs = base_fs(); fs[B] = {'dir': 1}; fs[B + '\\CAN-FD'] = {'dir': 1}; fs[B + '\\CAN-FD\\RH850-U2B.md'] = {'t': PAGE}
            fs['C:\\Work\\IP图谱'] = {'dir': 1}; fs['C:\\Work\\IP图谱\\CAN-FD'] = {'dir': 1}; fs['C:\\Work\\IP图谱\\CAN-FD\\RH850-U2A.md'] = {'t': U2A}
            AIF = r"""window.__aiCalls=[]; (function(){ const real=window.fetch; window.fetch=async (u,o)=>{ if(String(u).startsWith('https://fake.ai/')){ const b=JSON.parse(o.body); window.__aiCalls.push(b); const tm=b.messages.filter(m=>m.role==='tool'); let msg;
              if(tm.length===0) msg={role:'assistant',content:null,tool_calls:[{id:'a',type:'function',function:{name:'atlas_list',arguments:'{}'}},{id:'b',type:'function',function:{name:'atlas_read',arguments:JSON.stringify({page:'CAN-FD/RH850/U2B',section:'时序'})}}]};
              else if(tm.length===2) msg={role:'assistant',content:null,tool_calls:[{id:'c',type:'function',function:{name:'atlas_write_section',arguments:JSON.stringify({page:'CAN-FD/RH850/U2A',section:'要点与坑',content:'- AI 写入的要点'})}}]};
              else msg={role:'assistant',content:'完成'}; return new Response(JSON.stringify({choices:[{message:msg}]}),{status:200,headers:{'Content-Type':'application/json'}}); } return real(u,o); }; })();"""
            b, ctx, pg, errs = await launch(p, srv, fs, AIF, w=1440, h=900); ev = pg.evaluate
            async def wait(ms=300): await pg.wait_for_timeout(ms)
            chk('version 1.7.1', await ev("ChipBench.VERSION==='1.7.1'"))
            await ev("ChipBench.ws.addRootPath('C:\\\\Work')"); await pg.wait_for_function("ChipBench.index.docs.size>=8", timeout=20000); await wait(600)
            await ev("ChipBench.atlas.scan()"); await wait(300)
            # search finds the bundled page; clicking opens the atlas view (not the editor)
            r = await ev("ChipBench.index.runSearch('RFPCTR0').map(x=>x.path)")
            chk('global search finds registers in the bundled atlas page', any('RH850-U2B.md' in x for x in r), r)
            await ev("ChipBench.openPath(ChipBench.atlas.pages.find(p=>p.bundled).path)"); await wait(1200)
            chk('opening a bundled page goes to the atlas view (read-only)', await ev("!!document.querySelector('.fp .at-tabs') && ChipBench.app.tabs.every(t=>!/RH850-U2B\\.md$/.test(t.path||''))"))
            await ev("ChipBench.closeFull()")
            chk('scan does not mistake the indexed bundled page for a workspace page', await ev("ChipBench.atlas.pages.filter(p=>p.chip==='RH850/U2B').length===1 && ChipBench.atlas.pages.find(p=>p.chip==='RH850/U2B').bundled"))
            # compare with two chips
            await ev("ChipBench.atlas.open('C:\\\\Work\\\\IP图谱\\\\CAN-FD\\\\RH850-U2A.md','对比')"); await wait(1500)
            t = await ev("document.querySelector('.at-view').innerText")
            chk('芯片对比 shows both chips side by side', 'RH850/U2A' in t and 'RH850/U2B' in t and '寄存器对照' in t, t[:200])
            chk('differing facts highlighted', await ev("[...document.querySelectorAll('.at-cmp tr.diff th')].map(x=>x.textContent).includes('通道数')"))
            chk('equal facts not highlighted', not await ev("[...document.querySelectorAll('.at-cmp tr.diff th')].map(x=>x.textContent).includes('每通道 TX buffer')"))
            # status selector
            await ev("(()=>{const s=document.querySelector('.at-stsel'); s.value='已核对'; s.dispatchEvent(new Event('change'))})()"); await wait(1200)
            txt = await ev("ChipBench.fs.read('C:\\\\Work\\\\IP图谱\\\\CAN-FD\\\\RH850-U2A.md').then(r=>r.text)")
            chk('status selector writes front matter only', 'status: 已核对' in txt and txt.count('status:') == 1)
            chk('panel shows new status', '已核对' in await ev("(ChipBench.panel('atlas'), new Promise(r=>setTimeout(()=>r(document.querySelector('#pane-atlas').innerText),900)))"))
            await ev("ChipBench.closeFull()")
            # learn panel + icons
            await ev("ChipBench.panel('learn')"); await wait(600)
            chk('学习中心 links to IP 图谱', await ev("!!document.querySelector('#pane-learn [data-cmd=\"atlas.open\"]')"))
            await ev("ChipBench.openPath('C:\\\\Work\\\\DFA培训\\\\讲稿.md')"); await wait(900)
            await pg.click('.cm-content'); await pg.keyboard.press('Control+End'); await pg.keyboard.press('Enter'); await pg.keyboard.type('/'); await wait(300)
            await pg.keyboard.type('shi'); await wait(300)
            chk('slash menu uses line icons (svg) not emoji', await ev("(()=>{const its=[...document.querySelectorAll('.ac .it .ic, .it .ic')]; return its.length>0 && its.some(i=>i.querySelector('svg')) && !its.some(i=>/[\\u{1F300}-\\u{1FAFF}\\u23F0-\\u23FA]/u.test(i.textContent))})()"))
            await pg.keyboard.press('Escape')
            chk('no page errors', not [e for e in errs if 'pageerror' in e], errs[:5])
            await b.close()
    print(json.dumps({'passed': sum(R.values()), 'total': len(R), 'fails': fails}, ensure_ascii=False))
asyncio.run(main())
import sys as _sys; _sys.exit(1 if fails else 0)
