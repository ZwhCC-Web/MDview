"""1.7.1 · shortcuts: no two commands share a key (1.7.0 had three conflicts where one command's advertised shortcut was dead), and the
re-assigned keys really fire their commands."""
import asyncio, json, collections
from util import *; from base_fs import *
R = {}; fails = []
def chk(name, cond, info=None):
    R[name] = bool(cond)
    if not cond: fails.append(name); print('FAIL', name, info if info is not None else '')
    else: print('  ok ', name)
async def main():
    with Server() as srv:
        async with async_playwright() as p:
            b, ctx, pg, errs = await launch(p, srv, base_fs(), w=1300, h=800); ev = pg.evaluate
            async def wait(ms=300): await pg.wait_for_timeout(ms)
            cmds = await ev("[...ChipBench.commands.values()].filter(c=>c.key).map(c=>({id:c.id,key:c.key}))"); by = collections.defaultdict(list)
            for c in cmds: by[c['key'].strip().lower()].append(c['id'])
            chk('no duplicate shortcuts among %d commands' % len(cmds), not {k: v for k, v in by.items() if len(v) > 1}, {k: v for k, v in by.items() if len(v) > 1})
            await ev("ChipBench.ws.addRootPath('C:\\\\Work')"); await wait(600); await ev("ChipBench.openPath('C:\\\\Work\\\\DFA培训\\\\讲稿.md')"); await wait(900)
            await ev("window.__ran=[]; const r=ChipBench.run; ChipBench.run=function(id,a){ window.__ran.push(id); return r.call(this,id,a) }")
            for key, cid in (('Control+Alt+KeyG', 'insert.table'), ('Control+Alt+KeyL', 'skills.open'), ('Control+Alt+KeyD', 'reg.bench'), ('Control+Alt+KeyT', 'plan.timer'), ('Control+Alt+KeyS', 'saveAll'), ('Control+Alt+KeyR', 'right.ctx')):
                await ev("window.__ran.length=0; document.querySelectorAll('.modal-bg,.palette,.menu-pop').forEach(m=>m.remove())"); await pg.keyboard.press(key); await wait(250)
                ran = await ev("window.__ran.slice()"); chk('%s fires %s (and only it)' % (key.replace('Control', 'Ctrl').replace('Key', ''), cid), ran == [cid], ran)
                await ev("document.querySelectorAll('.modal-bg,.palette,.menu-pop').forEach(m=>m.remove())"); await pg.keyboard.press('Escape'); await wait(100)
                await ev("if(!ChipBench.app.tabs.length) ChipBench.openPath('C:\\\\Work\\\\DFA培训\\\\讲稿.md')")
            # ---- reopen closed tab (1.7.0 had no way back)
            for f in ('DFA培训\\\\章节\\\\01-背景.md', 'DFA培训\\\\资料\\\\术语表.md'): await ev("ChipBench.openPath('C:\\\\Work\\\\%s')" % f); await wait(400)
            await ev("(async()=>{const A=ChipBench.app; await A.close(A.tabs.findIndex(t=>t.name==='术语表.md'), true); await A.close(A.tabs.findIndex(t=>t.name==='01-背景.md'), true)})()"); await wait(400)
            await pg.keyboard.press('Control+Alt+KeyZ'); await wait(600); chk('Ctrl+Alt+Z reopens the last closed tab (01-背景.md)', await ev("ChipBench.app.current().name") == '01-背景.md', await ev("ChipBench.app.current().name"))
            await pg.keyboard.press('Control+Alt+KeyZ'); await wait(600); chk('...pressing it again reopens the one before (术语表.md)', await ev("ChipBench.app.current().name") == '术语表.md', await ev("ChipBench.app.current().name"))
            await pg.keyboard.press('Control+Alt+KeyZ'); await wait(400); chk('with nothing left it says so', '没有可恢复' in await ev("document.getElementById('toasts').innerText"))
            chk('no console errors', not [e for e in errs if 'pageerror' in e], errs[:3]); await b.close()
    print(json.dumps({'passed': sum(R.values()), 'total': len(R), 'fails': fails}, ensure_ascii=False))
    raise SystemExit(1 if fails else 0)
asyncio.run(main())
