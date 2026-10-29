"""1.7.1 · real keyboard typing in the editor: leaving lists / quotes with Enter, nested outdent, continuation still works,
and the Ctrl+Alt+G (insert table) / Ctrl+Alt+T (timer) split inside the editor."""
import asyncio, json
from util import *; from base_fs import *
R = {}; fails = []
def chk(name, cond, info=None):
    R[name] = bool(cond)
    if not cond: fails.append(name); print('FAIL', name, info if info is not None else '')
    else: print('  ok ', name)
async def main():
    with Server() as srv:
        async with async_playwright() as p:
            b, ctx, pg, errs = await launch(p, srv, base_fs(), w=1300, h=800); ev = pg.evaluate; kb = pg.keyboard; n = [0]
            async def doc(mode='source'):
                n[0] += 1; await ev("ChipBench.newDoc('', 'k%d.md', {keep:true})" % n[0]); await pg.wait_for_timeout(450); await ev("ChipBench.app.setMode(%s)" % json.dumps(mode)); await pg.wait_for_timeout(300); await pg.click('.cm-content')
            val = lambda: ev("ChipBench.app.ed.value")
            async def enters(k=1):
                for _ in range(k): await kb.press('Enter'); await pg.wait_for_timeout(80)
            for name, first, want in (('bullet', '- a', '- a\n\n'), ('ordered', '1. a', '1. a\n\n'), ('task', '- [ ] a', '- [ ] a\n\n'), ('quote', '> q', '> q\n\n')):
                await doc(); await kb.type(first); await enters(2); chk('%s: Enter on the empty item leaves the list' % name, await val() == want, await val())
            await doc(); await kb.type('- a'); await enters(); await kb.type('b'); await enters(2); chk('two-item list exits too', await val() == '- a\n- b\n\n', await val())
            await doc(); await kb.type('- a'); await enters(); chk('Enter after text still continues the list', await val() == '- a\n- ', await val())
            await doc(); await kb.type('1. a'); await enters(); chk('ordered list numbering continues', await val() == '1. a\n2. ', await val())
            await kb.type('b'); await enters(); await kb.type('c'); chk('...and keeps counting', (await val()).endswith('3. c'), await val())
            await doc(); await kb.type('- x'); await enters(); await kb.press('Tab'); await kb.type('y'); await enters()
            v = await val(); chk('nested item continues at the nested level', v.split('\n')[-1].strip() == '-' and v.split('\n')[-1].startswith(' '), v)
            await enters(); v = await val(); last = v.split('\n')[-1]; chk('Enter on an empty NESTED item outdents one level (still a list item)', last.strip() == '-' and not last.startswith(' '), v)
            await enters(); v = await val(); chk('...and the next Enter leaves the list', v.rstrip('\n').endswith('- y') or v.endswith('\n\n'), v)
            await doc(); await kb.type('正文'); await enters(); await kb.type('更多'); chk('plain paragraphs are untouched', await val() == '正文\n更多', await val())
            await doc(); await kb.type('| a | b |'); await kb.press('Enter'); await kb.type('|---|---|'); await kb.press('Enter'); await kb.type('| 1 | 2 |'); await kb.press('Enter'); await pg.wait_for_timeout(200); chk('table: Enter at the end of a row adds a new row', (await val()).split('\n')[-1].strip().startswith('|'), await val())
            await doc(); await kb.type('```'); await enters(); chk('code fence Enter still closes the fence', (await val()).count('```') == 2, await val())
            # keys inside the editor
            await doc(); await kb.press('Control+Alt+KeyG'); await pg.wait_for_timeout(300); chk('Ctrl+Alt+G in the editor inserts a table', '|' in await val(), await val())
            await doc(); await ev("window.__ran=[]; const r=ChipBench.run; ChipBench.run=function(id,a){ window.__ran.push(id); return r.call(this,id,a) }")
            await kb.type('- [ ] 待办'); await kb.press('Control+Alt+KeyT'); await pg.wait_for_timeout(300)
            chk('Ctrl+Alt+T in the editor starts the timer and does NOT insert a table', 'plan.timer' in await ev("window.__ran") and '| ' not in await val(), [await ev("window.__ran"), await val()])
            chk('no console errors', not [e for e in errs if 'pageerror' in e or 'TypeError' in e], errs[:3]); await b.close()
    print(json.dumps({'passed': sum(R.values()), 'total': len(R), 'fails': fails}, ensure_ascii=False))
    raise SystemExit(1 if fails else 0)
asyncio.run(main())
