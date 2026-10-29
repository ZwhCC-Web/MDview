"""1.7 · workspace data model in the app: v1 -> v2 migration with backup, auto-repair, health check, batch re-link (name + size)."""
import asyncio, json
from util import *; from base_fs import *
R = {}; fails = []
def chk(name, cond, info=None):
    R[name] = bool(cond)
    if not cond: fails.append(name); print('FAIL', name, info if info is not None else '')
    else: print('  ok ', name)
WSF = 'C:\\Users\\me\\.chipbench\\workspaces\\w1.cbws'
async def main():
    with Server() as srv:
        async with async_playwright() as p:
            fs = base_fs(); fs['C:\\Work\\新位置'] = {'dir': 1}; fs['C:\\Work\\新位置\\A'] = {'dir': 1}; fs['C:\\Work\\新位置\\B'] = {'dir': 1}
            fs['C:\\Work\\新位置\\A\\datasheet.pdf'] = {'t': 'x' * 10}; fs['C:\\Work\\新位置\\B\\datasheet.pdf'] = {'t': 'y' * 4321}; fs['C:\\Work\\新位置\\规格.docx'] = {'t': 'doc'}
            ws = {'format': 'chipbench-workspace', 'version': 1, 'id': 'w1', 'name': '旧项目', 'created': 1, 'updated': 1, 'roots': [{'id': 'r1', 'path': 'C:\\Work\\DFA培训', 'name': 'DFA'}],
                  'collections': [{'id': 'g1', 'type': 'group', 'name': '资料', 'children': [
                      {'id': 'n1', 'type': 'ref', 'kind': 'file', 'path': 'C:\\Work\\旧位置\\datasheet.pdf', 'fp': {'size': 4321, 'mtime': 1}},
                      {'id': 'n2', 'type': 'ref', 'kind': 'file', 'path': 'C:\\Work\\旧位置\\规格.docx'},
                      {'id': 'n3', 'type': 'ref', 'kind': 'file', 'root': 'r1', 'rel': '讲稿.md', 'path': 'C:\\Work\\DFA培训\\讲稿.md'},
                      {'id': 'n3', 'type': 'ref', 'kind': 'file', 'root': 'gone', 'path': 'C:\\Work\\DFA培训\\章节\\01-背景.md'}]}],
                  'recent': [], 'layout': {'tabs': [], 'active': None}, 'settings': {'restore': True, 'exclude': []}}
            fs[WSF] = {'t': json.dumps(ws, ensure_ascii=False)}
            b, ctx, pg, errs = await launch(p, srv, fs, kv={'ws.current': json.dumps('w1')}, extra_init="window.__pickFolder='C:\\\\Work\\\\新位置';"); ev = pg.evaluate
            async def wait(ms=300): await pg.wait_for_timeout(ms)
            await wait(600); raw = json.loads(await ev("window.__FS[%s].t" % json.dumps(WSF)))
            chk('loaded project is the migrated one', await ev("ChipBench.ws.cur.id") == 'w1' and await ev("ChipBench.ws.cur.version") == 2)
            chk('schema v1 file was backed up before the upgrade', await ev("!!window.__FS[%s]" % json.dumps(WSF + '.v1.bak')))
            chk('auto-repair: duplicate id + dangling root fixed and persisted', raw['version'] == 2 and len({n['id'] for n in raw['collections'][0]['children']}) == 4 and all(n.get('root') != 'gone' for n in raw['collections'][0]['children']), raw['collections'][0]['children'])
            chk('integrity check is clean after repair', await ev("ChipBench.W.check(ChipBench.ws.cur).ok"))
            await ev("ChipBench.run('ws.health')"); await pg.wait_for_selector('.modal', timeout=5000)
            txt = await ev("document.querySelector('.modal').innerText"); chk('health dialog shows the missing count', '缺失的文件' in txt and '2' in txt, txt)
            await pg.click('.modal button:has-text("批量重新定位")'); await wait(900)
            p1 = await ev("ChipBench.W.refPath(ChipBench.ws.cur, ChipBench.W.find(ChipBench.ws.cur, 'n1').node)"); p2 = await ev("ChipBench.W.refPath(ChipBench.ws.cur, ChipBench.W.find(ChipBench.ws.cur, 'n2').node)")
            chk('ambiguous datasheet.pdf resolved by size to the B copy', p1 == 'C:\\Work\\新位置\\B\\datasheet.pdf', p1)
            chk('unique name resolved', p2 == 'C:\\Work\\新位置\\规格.docx', p2)
            await ev("ChipBench.ws.persist()"); await wait(300)
            chk('re-link persisted', 'B\\\\datasheet.pdf' in await ev("window.__FS[%s].t" % json.dumps(WSF)))
            chk('no console errors', not errs, errs[:3])
            await b.close()
    print(json.dumps({'passed': sum(R.values()), 'total': len(R), 'fails': fails}, ensure_ascii=False))
    raise SystemExit(1 if fails else 0)
asyncio.run(main())
