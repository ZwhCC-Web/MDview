"""1.7 · MCP connection center + AI activity: connection report, client configs (absolute python path, merge, backup), permission,
activity feed -> toast / badge / auto-reload of SEVERAL open files, diff view, undo."""
import asyncio, json, hashlib
from util import *; from base_fs import *
R = {}; fails = []
def chk(name, cond, info=None):
    R[name] = bool(cond)
    if not cond: fails.append(name); print('FAIL', name, info if info is not None else '')
    else: print('  ok ', name)
D = 'C:\\Users\\me\\.chipbench'; ACT = D + '\\mcp-activity.jsonl'; SESS = D + '\\mcp-session.json'
N = ['C:\\Work\\ai1.md', 'C:\\Work\\ai2.md', 'C:\\Work\\ai3.md']; base = lambda n: n.split('\\')[-1][:-3]
CLAUDE = 'C:\\Users\\me\\AppData\\Roaming\\Claude\\claude_desktop_config.json'; VSC = 'C:\\Users\\me\\AppData\\Roaming\\Code\\User\\mcp.json'
sha = lambda t: hashlib.sha1(t.encode('utf-8')).hexdigest()
def entry(i, op, path, **k): return json.dumps(dict({'id': '19a%05x000' % i, 't': '2026-10-29T10:%02d:00' % i, 'tool': 'replace_in_note', 'client': 'Claude Desktop', 'op': op, 'path': path, 'rel': path.split('\\')[-1], 'added': 1, 'removed': 1, 'diff': '--- before\n+++ after\n@@ -1 +1 @@\n-旧\n+新'}, **k), ensure_ascii=False)
async def main():
    with Server() as srv:
        async with async_playwright() as p:
            fs = base_fs()
            for n in N: fs[n] = {'t': '# ' + base(n) + '\n\n旧\n'}
            fs[CLAUDE] = {'t': json.dumps({'theme': 'dark', 'mcpServers': {'other': {'command': 'node', 'args': ['x.js']}}})}
            fs[VSC] = {'t': '// VS Code mcp.json\n{ "servers": {} }'}
            b, ctx, pg, errs = await launch(p, srv, fs, w=1500, h=900); ev = pg.evaluate
            async def wait(ms=300): await pg.wait_for_timeout(ms)
            await ev("ChipBench.ws.addRootPath('C:\\\\Work')"); await wait(600)
            for n in N: await ev("ChipBench.openPath(%s)" % json.dumps(n)); await wait(500)
            await ev("ChipBench.run('mcp.info')"); await pg.wait_for_selector('.mc-row', timeout=8000); await wait(300)
            txt = await ev("document.querySelector('.mc').innerText")
            chk('connect: python path, tools, data dir, roots, level', 'C:\\Python312\\python.exe' in txt and '46 个工具' in txt and 'C:\\Users\\me\\.chipbench' in txt and '读写' in txt and '以太网工具' in txt, txt[:500])
            chk('connect: no AI client yet', '还没有 AI 客户端连接过' in txt)
            await ev("window.__selftest={ok:true,version:'1.7.0',data_dir:'C:\\\\x',state_exists:false,app_running:false,roots:['C:\\\\Work'],roots_source:'current folder',tools:46,write_tools:17,level:'read',ethernet_tools:'No module named aenet',problems:['state.json not found']}")
            await pg.click('.mc [data-a=retest]'); await wait(700); txt = await ev("document.querySelector('.mc').innerText")
            chk('connect: problems explained (missing state, missing aenet, read-only)', 'state.json not found' in txt and '缺少 aenet.py' in txt and '只读' in txt, txt[:600])
            await ev("window.__python=[]"); await pg.click('.mc [data-a=retest]'); await wait(700)
            chk('connect: no Python -> clear instruction', 'Add python.exe to PATH' in await ev("document.querySelector('.mc').innerText"))
            await ev("window.__python=undefined; window.__selftest=undefined"); await pg.click('.mc [data-a=retest]'); await wait(700)
            await pg.click('.mc-tabs [data-t=cfg]'); await wait(700); txt = await ev("document.querySelector('.mc').innerText")
            chk('config: clients + claude code command + json', 'Claude Desktop' in txt and 'VS Code' in txt and 'Cursor' in txt and 'claude mcp add chipbench --' in txt and '"mcpServers"' in txt, txt[:300])
            chk('config: absolute python path (not "python")', '"command": "C:\\\\Python312\\\\python.exe"' in await ev("document.querySelector('#mc-snip').innerText"))
            await pg.click('.mc-cli:has-text("Claude Desktop") [data-a=write]'); await wait(700)
            cfg = json.loads(await ev("window.__FS[%s].t" % json.dumps(CLAUDE)))
            chk('config: chipbench added, other server and settings kept', cfg['mcpServers']['chipbench']['command'] == 'C:\\Python312\\python.exe' and cfg['mcpServers']['chipbench']['args'][0].endswith('chipbench_mcp.py') and cfg['mcpServers']['other']['command'] == 'node' and cfg['theme'] == 'dark', cfg)
            bak = await ev("(window.__FS[%s]||{}).t" % json.dumps(CLAUDE + '.chipbench-bak')); chk('config: original backed up', bak and 'other' in bak and 'chipbench' not in bak)
            before = await ev("window.__FS[%s].t" % json.dumps(VSC))
            await pg.click('.mc-cli:has-text("VS Code") [data-a=write]'); await wait(600)
            chk('config: a JSONC file is NOT overwritten, user is told', await ev("window.__FS[%s].t" % json.dumps(VSC)) == before and '标准 JSON' in await ev("document.getElementById('toasts').innerText"))
            root = await ev("ChipBench.ws.cur.roots[0].path")
            await pg.click('.mc-cli:has-text("当前项目") [data-a=write]'); await wait(700)
            pj = json.loads(await ev("window.__FS[%s].t" % json.dumps(root + '\\.vscode\\mcp.json'))); pm = json.loads(await ev("window.__FS[%s].t" % json.dumps(root + '\\.mcp.json')))
            chk('config: project .vscode/mcp.json (servers+type) and .mcp.json (mcpServers)', pj['servers']['chipbench']['type'] == 'stdio' and pm['mcpServers']['chipbench']['command'].endswith('python.exe'), (pj, pm))
            await pg.click('.mc-tabs [data-t=perm]'); await wait(300); await pg.click('.mc input[name=lv][value=read]'); await wait(400)
            chk('permission: read-only written', json.loads(await ev("window.__FS[%s].t" % json.dumps(D + '\\mcp-config.json')))['level'] == 'read')
            await pg.click('.mc input[name=lv][value=write]'); await wait(300); chk('permission: back to write', json.loads(await ev("window.__FS[%s].t" % json.dumps(D + '\\mcp-config.json')))['level'] == 'write')
            await pg.click('.modal [data-x]'); await wait(300)
            await ev("window.__put(%s, '')" % json.dumps(ACT)); await wait(3200)
            newtexts = {n: '# ' + base(n) + '\n\n新\n' for n in N}; lines = []
            for i, n in enumerate(N):
                await ev("window.__put(%s, %s)" % (json.dumps(n), json.dumps(newtexts[n])))
                bk = 'C:\\Work\\.chipbench\\backup\\' + n.split('\\')[-1] + '.bak'
                lines.append(entry(i + 1, 'modify', n, backup=bk, after_hash=sha(newtexts[n]))); await ev("window.__put(%s, %s)" % (json.dumps(bk), json.dumps('# ' + base(n) + '\n\n旧\n')))
            await ev("window.__put(%s, %s)" % (json.dumps(ACT), json.dumps('\n'.join(lines) + '\n')))
            await ev("window.__put(%s, JSON.stringify({client:'Claude Desktop',level:'write',time:new Date().toISOString()}))" % json.dumps(SESS)); await wait(3600)
            tst = await ev("document.getElementById('toasts').innerText"); chk('toast announces the AI change', 'Claude Desktop' in tst and 'ai1.md' in tst, tst)
            chk('badge: AI · 3 项改动', 'AI · 3' in await ev("document.getElementById('st-ai').innerText"))
            reloaded = []
            for n in N:
                await ev("ChipBench.app.activate(ChipBench.app.tabs.findIndex(t=>t.path===%s))" % json.dumps(n)); await wait(350)
                v = await ev("ChipBench.app.ed.value"); reloaded.append('新' in v and '旧' not in v)
            chk('ALL THREE open files were reloaded with the AI rewrite (1.6.1: only the first)', all(reloaded), reloaded)
            await ev("ChipBench.run('mcp.activity')"); await pg.wait_for_selector('.mc-ev', timeout=5000); await wait(300)
            chk('activity: 3 rows, newest first, tool + client', await ev("document.querySelectorAll('.mc-ev').length") == 3 and 'ai3.md' in await ev("document.querySelector('.mc-ev').innerText") and 'replace_in_note' in await ev("document.querySelector('.mc-ev').innerText"))
            chk('opening the activity tab clears the badge count', 'AI · ' not in await ev("document.getElementById('st-ai').innerText"))
            await pg.click('.mc-ev [data-a=diff]'); await pg.wait_for_selector('.mc-diff', timeout=4000)
            chk('diff view colours added / removed lines', await ev("document.querySelectorAll('.mc-diff .add').length") == 1 and await ev("document.querySelectorAll('.mc-diff .del').length") == 1)
            await ev("document.querySelectorAll('.modal-bg')[1].querySelector('[data-x]').click()"); await wait(200)
            await pg.click('.mc-ev [data-a=undo]'); await pg.wait_for_selector('.modal .btn.primary', timeout=4000)
            msg = await ev("[...document.querySelectorAll('.modal')].pop().innerText"); chk('undo asks for confirmation (no “changed since” warning)', '恢复到 AI 修改之前' in msg and '又变过' not in msg, msg)
            await ev("[...document.querySelectorAll('.modal .btn.primary')].pop().click()"); await wait(900)
            chk('undo restored the previous content on disk', await ev("ChipBench.fs.read(%s).then(r=>r.text)" % json.dumps(N[2])) == '# ai3\n\n旧\n')
            await wait(900); await ev("ChipBench.app.activate(ChipBench.app.tabs.findIndex(t=>t.path===%s))" % json.dumps(N[2])); await wait(400)
            chk('undo is reflected in the open tab', '旧' in await ev("ChipBench.app.ed.value"))
            chk('entry is marked undone', await ev("document.querySelectorAll('.mc-ev.undone').length") == 1)
            await ev("window.__put(%s, '# ai1\\n\\n我又改了\\n')" % json.dumps(N[0])); await wait(300)
            rows = await ev("[...document.querySelectorAll('.mc-ev')].map(r=>r.innerText)"); idx = [i for i, r in enumerate(rows) if 'ai1.md' in r][0]
            await ev("document.querySelectorAll('.mc-ev')[%d].querySelector('[data-a=undo]').click()" % idx); await pg.wait_for_selector('.modal .btn.primary', timeout=4000)
            msg = await ev("[...document.querySelectorAll('.modal')].pop().innerText"); chk('undo warns when the file changed after the AI edit', '又变过' in msg, msg)
            await ev("[...document.querySelectorAll('.modal .btn.primary')].pop().click()"); await wait(900)
            allb = await ev("Object.entries(window.__FS).filter(([k,v])=>!v.dir && /backup/i.test(k)).map(([k,v])=>v.t!=null?v.t:new TextDecoder().decode(Uint8Array.from(atob(v.b),c=>c.charCodeAt(0))))")
            chk('...and keeps a backup of the newer content first', any('我又改了' in t for t in allb), allb)
            await pg.click('.modal [data-x]'); await wait(200)
            chk('session shows AI online in the badge', 'AI ●' in await ev("document.getElementById('st-ai').innerText"))
            chk('no console errors', not errs, errs[:3])
            await b.close()
    print(json.dumps({'passed': sum(R.values()), 'total': len(R), 'fails': fails}, ensure_ascii=False))
    raise SystemExit(1 if fails else 0)
asyncio.run(main())
