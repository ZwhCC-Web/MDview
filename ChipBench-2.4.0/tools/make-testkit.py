#!/usr/bin/env python3
"""Build the reusable test kit:  python tools/make-testkit.py [outdir]
   → ChipBench-testkit-<ver>.zip  and  ChipBench-testkit-<ver>-package.html
   Unzip INTO the root of any ChipBench source tree (it overlays tests/, mcp/test_*.py, tools/run-tests.py) and run  python tools/run-tests.py."""
import base64, datetime, hashlib, html, io, json, pathlib, sys, zipfile
root = pathlib.Path(__file__).resolve().parent.parent; ver = json.loads((root / 'package.json').read_text('utf-8'))['version']
name = 'ChipBench-testkit-' + ver; out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else root.parent); out.mkdir(parents=True, exist_ok=True)
SKIP = {'__pycache__', 'node_modules', 'target', '.git'}
KIT = lambda r: (r.parts[0] == 'tests' and not (set(r.parts) & {'out', '__pycache__', 's31'}) and not r.name.startswith(('shot_', 'report-')) and r.name != 'perf_results17.json') or (r.parts[0] == 'mcp' and r.name.startswith('test_') and r.suffix == '.py') or r.as_posix() in ('tools/run-tests.py', 'tools/export-templates.js', 'tools/gen-large-ip.js', 'tools/elk-bench.py', 'tools/check-css.py', 'tools/check-modules.py', 'tools/check-rust.py', 'tools/css-baseline.json', 'TESTKIT.md')
files = sorted(p for p in root.rglob('*') if p.is_file() and not (set(p.relative_to(root).parts) & SKIP) and not p.name.endswith(('.pyc', '.bak')) and KIT(p.relative_to(root)))
buf = io.BytesIO(); man = []
with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for p in files:
        rel = p.relative_to(root).as_posix(); d = p.read_bytes(); z.writestr(rel, d); man.append('%s %10d  %s' % (hashlib.sha256(d).hexdigest(), len(d), rel))
zb = buf.getvalue(); zsha = hashlib.sha256(zb).hexdigest(); (out / (name + '.zip')).write_bytes(zb)
now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
meta = {'format': 'CHIPBENCH-ZIP-HTML v1', 'root': name, 'zipName': name + '.zip', 'created': now, 'files': len(files), 'zipBytes': len(zb), 'zipSha256': zsha}
b64 = base64.b64encode(zb).decode(); b64 = '\n'.join(b64[i:i + 76] for i in range(0, len(b64), 76))
page = f'''<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>{name}.zip · 测试包</title>
<style>body{{font:14px/1.6 "Segoe UI","Microsoft YaHei",sans-serif;max-width:900px;margin:30px auto;padding:0 20px;color:#1d2330}}button{{background:#0f9d8a;color:#fff;border:0;border-radius:6px;padding:10px 20px;font-size:15px;cursor:pointer}}pre{{background:#f6f7f9;padding:10px;overflow:auto;font-size:12px}}code{{font-size:12px}}</style></head><body>
<h1>{name}.zip</h1>
<p>ChipBench {ver} 测试包 · 解压到任意 ChipBench 源码根目录后运行 python tools/run-tests.py<br>{len(files)} 个文件 · ZIP {len(zb)/1048576:.2f} MB · 生成于 {now}<br>ZIP SHA-256：<code>{zsha}</code></p>
<p><button id="dl">下载 {name}.zip</button> <span id="st"></span></p>
<script type="application/json" id="cb-meta">{json.dumps(meta)}</script>
<h3>文件清单（sha256 / 字节 / 路径）</h3><pre id="cb-manifest">{html.escape(chr(10).join(man))}</pre>
<script type="text/plain" id="cb-zip-b64">{b64}</script>
<script>
document.getElementById('dl').onclick=async function(){{
  var b=atob(document.getElementById('cb-zip-b64').textContent.replace(/\\s+/g,'')),u=new Uint8Array(b.length);
  for(var i=0;i<b.length;i++)u[i]=b.charCodeAt(i);
  var meta=JSON.parse(document.getElementById('cb-meta').textContent);
  var h=await crypto.subtle.digest('SHA-256',u),hex=Array.from(new Uint8Array(h)).map(function(x){{return x.toString(16).padStart(2,'0')}}).join('');
  document.getElementById('st').textContent=hex===meta.zipSha256?'✓ 校验通过':'✗ 校验失败';
  var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([u],{{type:'application/zip'}}));a.download=meta.zipName;a.click();
}};
</script>
</body></html>
'''
(out / (name + '-package.html')).write_text(page, encoding='utf-8')
print('wrote', out / (name + '.zip'), len(zb), 'bytes,', len(files), 'files'); print('wrote', out / (name + '-package.html'))
