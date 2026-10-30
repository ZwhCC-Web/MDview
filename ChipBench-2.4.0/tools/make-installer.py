#!/usr/bin/env python3
"""ChipBench 安装包工具（只用标准库）。
  --check     构建前检查：版本一致 / tauri 资源齐全（含 MCP 依赖的 aenet.py）/ 图标源 / Rust 命令注册 / 模块清单
  --collect   构建后整理：把 NSIS 安装包、MSI、便携 exe 收进 dist/ChipBench-<版本>/，生成 SHA256SUMS.txt、INSTALL.txt、RELEASE-NOTES.md
  --collect --bundle <目录>   指定 bundle 位置（测试用）
build-installer.bat 依次调用：--check → cargo test → tauri build → --collect。退出码非 0 = 有问题。"""
import hashlib, json, os, pathlib, re, shutil, subprocess, sys
try: sys.stdout.reconfigure(encoding='utf-8', errors='replace'); sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception: pass
ROOT = pathlib.Path(__file__).resolve().parent.parent
errs, warns, oks = [], [], []
read = lambda p: (ROOT / p).read_text('utf-8') if (ROOT / p).exists() else ''
def versions():
    v = {}
    for k, f in (('package.json', lambda: json.loads(read('package.json'))['version']), ('tauri.conf.json', lambda: json.loads(read('src-tauri/tauri.conf.json'))['version'])):
        try: v[k] = f()
        except Exception: v[k] = None
    for k, path, rx in (('Cargo.toml', 'src-tauri/Cargo.toml', r'^version\s*=\s*"([^"]+)"'), ('app/js/core.js', 'app/js/core.js', r"SL\.VERSION\s*=\s*'([^']+)'"), ('mcp/chipbench_mcp.py', 'mcp/chipbench_mcp.py', r'^VERSION\s*=\s*"([^"]+)"')):
        m = re.search(rx, read(path), re.M); v[k] = m.group(1) if m else None
    return v
def check():
    v = versions(); vals = {x for x in v.values() if x}
    if None in v.values(): errs.append('读不到版本号：' + ', '.join(k for k, x in v.items() if x is None))
    elif len(vals) == 1: oks.append('版本号一致：' + next(iter(vals)))
    else: errs.append('版本号不一致：' + '；'.join(f'{k}={x}' for k, x in v.items()))
    mv = re.search(r'> 版本 ([0-9]+(?:\.[0-9]+)*) ·', read('docs/MANUAL.md'))   # 2.4: the manual must name the version it describes
    if not mv: errs.append('docs/MANUAL.md 开头没有“> 版本 X.Y.Z ·”')
    elif len(vals) == 1 and mv.group(1) != next(iter(vals)): errs.append('手册写的版本是 %s，程序是 %s（运行 python tools/embed-docs.py 同步）' % (mv.group(1), next(iter(vals))))
    else: oks.append('手册版本号一致：' + mv.group(1))
    try: conf = json.loads(read('src-tauri/tauri.conf.json'))
    except Exception as e: conf = {}; errs.append('tauri.conf.json 无法解析：%s' % e)
    res = (conf.get('bundle') or {}).get('resources') or {}; shipped = set()
    for src, dst in (res.items() if isinstance(res, dict) else []):
        p = (ROOT / 'src-tauri' / src).resolve()
        if not p.exists(): errs.append('资源不存在：%s → %s' % (src, dst))
        else: shipped.add(p.name if p.is_file() else p.name + '/')
    mcp = read('mcp/chipbench_mcp.py'); local = {p.stem for p in (ROOT / 'mcp').glob('*.py')} - {'chipbench_mcp'} - {p.stem for p in (ROOT / 'mcp').glob('test_*.py')}
    for mod in sorted(local):
        if re.search(r'^\s*(?:import|from)\s+%s\b' % re.escape(mod), mcp, re.M):
            (oks if mod + '.py' in shipped else errs).append(('MCP 依赖 %s.py 已打进安装包' if mod + '.py' in shipped else 'MCP 依赖 %s.py，但 bundle.resources 没有它：装好后以太网工具会失败（1.6.1 的实际缺陷）') % mod)
    for need in ('chipbench_mcp.py', 'skills/', 'atlas/', 'templates/'): (oks if need in shipped else errs).append(('资源已列入：' if need in shipped else '资源缺失：') + need)
    (oks if (ROOT / 'app-icon.png').exists() else errs).append('图标源 app-icon.png ' + ('存在' if (ROOT / 'app-icon.png').exists() else '缺失'))
    for tool, label in (('tools/check-rust.py', 'Rust 命令注册（静态）'), ('tools/check-modules.py', '前端模块清单')):
        if (ROOT / tool).exists():
            r = subprocess.run([sys.executable, str(ROOT / tool)], capture_output=True, encoding='utf-8', errors='replace',
                               env={**os.environ, 'PYTHONUTF8': '1', 'PYTHONIOENCODING': 'utf-8'})
            (oks if r.returncode == 0 else errs).append('%s：%s' % (label, (r.stdout.strip().splitlines() or [''])[-1] if r.returncode == 0 else (r.stdout + r.stderr).strip()[-300:]))
    for exe in ('cargo', 'node', 'npm', 'python'): (oks if shutil.which(exe) else warns).append(('工具链：%s 可用' if shutil.which(exe) else '工具链：未找到 %s（Windows 构建机上需要）') % exe)
newest = lambda d, pat: next(iter(sorted(d.glob(pat), key=lambda p: p.stat().st_mtime, reverse=True)), None) if d.exists() else None
def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''): h.update(b)
    return h.hexdigest()
INSTALL = """ChipBench {ver} 安装说明
==========================
文件
  ChipBench-{ver}-setup.exe     推荐：NSIS 安装程序（当前用户安装，无需管理员）
  ChipBench-{ver}-x64.msi       企业分发（Intune / 软件中心 / 组策略）
  ChipBench-{ver}-portable.exe  免安装；在 exe 旁新建 data 文件夹即为“便携模式”，数据都放在里面
  SHA256SUMS.txt                校验：  certutil -hashfile <文件> SHA256   与本文件逐项比对

首次运行
  1. SmartScreen 提示“已保护你的电脑”：点“更多信息 → 仍要运行”（程序未签名，见 SIGNING.md）。从网盘 / 邮件下载的文件先右键 → 属性 → 勾选“解除锁定”。
  2. 需要 WebView2 运行时（Windows 11 自带；缺失时安装程序会下载引导）。
  3. 让 Claude / Copilot / Cursor 读写工作区：安装 Python 3.8+（勾选 Add python.exe to PATH 或设置环境变量 CHIPBENCH_PYTHON），
     在 ChipBench 里运行命令“MCP 连接中心…” → “配置”页一键写入客户端配置。
数据位置：默认 %USERPROFILE%\\.chipbench；便携模式为 exe 旁的 data；卸载不会删除你的数据。
升级：直接运行新版安装程序覆盖安装；项目文件（.cbws）首次打开时自动备份为 .v1.bak 后升级。
"""
def collect(bundle=None):
    ver = versions().get('package.json') or '0.0.0'; tgt = ROOT / 'src-tauri' / 'target' / 'release'
    b = pathlib.Path(bundle) if bundle else tgt / 'bundle'; nsis = newest(b / 'nsis', '*.exe'); msi = newest(b / 'msi', '*.msi')
    cand = (pathlib.Path(bundle).parent / 'chipbench.exe') if bundle else tgt / 'chipbench.exe'; portable = cand if cand.exists() else None
    if not nsis and not msi: errs.append('没有找到安装包（%s）。先运行 tauri build。' % b); return
    out = ROOT / 'dist' / ('ChipBench-' + ver); shutil.rmtree(out, ignore_errors=True); out.mkdir(parents=True); files = []
    for src, name in ((nsis, 'ChipBench-%s-setup.exe'), (msi, 'ChipBench-%s-x64.msi'), (portable, 'ChipBench-%s-portable.exe')):
        if src: dst = out / (name % ver); shutil.copy2(src, dst); files.append(dst); oks.append('已收集 %s（%.1f MB）' % (dst.name, dst.stat().st_size / 1048576))
        else: warns.append('缺少 ' + (name % ver))
    (out / 'SHA256SUMS.txt').write_text(''.join('%s *%s\n' % (sha(f), f.name) for f in files), 'utf-8'); (out / 'INSTALL.txt').write_text(INSTALL.format(ver=ver), 'utf-8')
    t = read('docs/CHANGELOG.md'); m = re.search(r'^## .*?\n(.*?)(?=^## |\Z)', t, re.M | re.S); h = re.search(r'^(## .*)$', t, re.M)
    (out / 'RELEASE-NOTES.md').write_text((h.group(1) + '\n' + m.group(1)).strip() + '\n' if m and h else '', 'utf-8')
    for extra in ('docs/SIGNING.md', 'docs/MANUAL.md'):
        if (ROOT / extra).exists(): shutil.copy2(ROOT / extra, out / pathlib.Path(extra).name)
    oks.append('输出目录：%s' % out)
def main():
    a = sys.argv[1:]
    if '--check' in a: check()
    if '--collect' in a: collect(a[a.index('--bundle') + 1] if '--bundle' in a else None)
    if not ({'--check', '--collect'} & set(a)): print(__doc__); return 2
    for m in oks: print('  ok   ' + m)
    for m in warns: print('  warn ' + m)
    for m in errs: print('  FAIL ' + m)
    print('结果：%d 通过，%d 提醒，%d 失败' % (len(oks), len(warns), len(errs))); return 1 if errs else 0
if __name__ == '__main__': sys.exit(main())
