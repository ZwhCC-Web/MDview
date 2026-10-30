#!/usr/bin/env python3
"""ChipBench 统一测试入口（所有功能一次跑完，输出一份报告）。
  python tools/run-tests.py                全部（Node 单元 + Python/MCP + 静态检查 + 浏览器端到端）
  python tools/run-tests.py --fast         只跑 Node / MCP / 静态检查（几秒）
  python tools/run-tests.py --only t_ws    只跑名字含 t_ws 的
  python tools/run-tests.py --report out   报告写到 out.md / out.json（默认 tests/report-<版本>.md）
退出码 0 = 全部通过。浏览器测试需要 playwright + Chromium（设置 CHROME 环境变量或使用默认路径）。"""
import json, os, pathlib, re, subprocess, sys, time
ROOT = pathlib.Path(__file__).resolve().parent.parent
VER = json.loads((ROOT / 'package.json').read_text('utf-8'))['version']
args = sys.argv[1:]; FAST = '--fast' in args; ONLY = args[args.index('--only') + 1] if '--only' in args else None
OUT = pathlib.Path(args[args.index('--report') + 1]) if '--report' in args else ROOT / 'tests' / ('report-' + VER)
os.environ.setdefault('CHROME', '/opt/pw-browsers/chromium-current/chrome-linux64/chrome')
rows = []
def run(kind, name, cmd, timeout=420):
    if ONLY and ONLY not in name: return
    t0 = time.time()
    try:
        p = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=timeout); out = p.stdout + p.stderr; rc = p.returncode
    except subprocess.TimeoutExpired as e: out = 'TIMEOUT after %ds' % timeout; rc = 124
    m = re.findall(r'"passed":\s*(\d+),\s*"total":\s*(\d+)', out) or re.findall(r'(\d+) passed, (\d+) failed', out)
    if m and 'failed' in out and re.search(r'(\d+) passed, (\d+) failed', out): a, b = map(int, re.findall(r'(\d+) passed, (\d+) failed', out)[-1]); passed, total = a, a + b
    elif m: passed, total = map(int, m[-1])
    else: passed = total = None
    fails = re.findall(r'^FAIL .*$', out, re.M)[:6]
    ok = rc == 0 and (total is None or passed == total) and not (kind == 'e2e' and 'ERRS [' in out and 'ERRS []' not in out)
    rows.append({'kind': kind, 'name': name, 'ok': ok, 'passed': passed, 'total': total, 'sec': round(time.time() - t0, 1), 'fails': fails, 'tail': '' if ok else out.strip()[-400:]})
    print(('PASS ' if ok else 'FAIL ') + '%-22s %s %5.1fs' % (name, '' if total is None else '%d/%d' % (passed, total), time.time() - t0), flush=True)
    for f in fails: print('     ' + f[:160])
py = sys.executable
for t in sorted((ROOT / 'tests').glob('*.test.js')): run('unit', 'node ' + t.stem, ['node', str(t)], 120)
for t in ('test_mcp', 'test_mcp17', 'test_mcp18', 'test_aenet', 'test_atlas_parity', 'test_ip18'):
    if (ROOT / 'mcp' / (t + '.py')).exists(): run('mcp', t, [py, 'mcp/%s.py' % t], 180)
for name, cmd in (('check-modules', ['tools/check-modules.py']), ('check-css', ['tools/check-css.py']), ('check-rust', ['tools/check-rust.py']), ('sync-skills', ['tools/sync-skills.py', '--check']), ('make-installer', ['tools/make-installer.py', '--check'])):
    if (ROOT / cmd[0]).exists(): run('static', name, [py] + cmd, 120)
if not FAST:
    order = ['t_boot', 't_editor', 't_ws', 't_ws17', 't_viewers', 't_pdfnav', 't_features', 't_modules', 't_misc', 't_filesafe', 't_readfill', 't_treecolor', 't_mcp17', 't_atlas17', 't_states17', 't_diag17', 't_ux171', 't_focus171', 't_keys171', 't_editkeys171']
    rest = sorted(p.stem for p in (ROOT / 'tests').glob('t_*.py') if p.stem not in order and p.stem not in ('t_perf', 't_stress', 't_shots', 't_perf17'))
    for t in order + rest:
        if (ROOT / 'tests' / (t + '.py')).exists(): run('e2e', t, [py, '-u', 'tests/%s.py' % t])
bad = [r for r in rows if not r['ok']]
md = ['# ChipBench %s 测试报告' % VER, '', '%s · %d 组，通过 %d，失败 %d' % (time.strftime('%Y-%m-%d %H:%M'), len(rows), len(rows) - len(bad), len(bad)), '', '| 类别 | 测试 | 结果 | 用例 | 秒 |', '|---|---|---|---|---|']
for r in rows: md.append('| %s | %s | %s | %s | %s |' % (r['kind'], r['name'], '✅' if r['ok'] else '❌', '' if r['total'] is None else '%d/%d' % (r['passed'], r['total']), r['sec']))
if bad: md += ['', '## 失败详情'] + ['- **%s**：%s' % (r['name'], ' / '.join(r['fails']) or r['tail'][-200:].replace('\n', ' ')) for r in bad]
OUT.with_suffix('.md').write_text('\n'.join(md) + '\n', 'utf-8'); OUT.with_suffix('.json').write_text(json.dumps(rows, ensure_ascii=False, indent=1), 'utf-8')
print('\n%d 组：通过 %d，失败 %d → %s' % (len(rows), len(rows) - len(bad), len(bad), (OUT.with_suffix('.md').relative_to(ROOT) if ROOT in OUT.resolve().parents else OUT.with_suffix('.md')))); sys.exit(1 if bad else 0)
