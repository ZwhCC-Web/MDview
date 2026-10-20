#!/usr/bin/env python3
"""Build the single-file MDView:  python build.py  ->  dist/MDView.html   (no Node.js needed)"""
import json, pathlib
root = pathlib.Path(__file__).resolve().parent; src = root / 'src'; v = src / 'vendor'
app = ''.join((src / f).read_text(encoding='utf-8') for f in ['app1-core.js', 'app2-edit.js', 'app3-files.js', 'app4-features.js', 'app5-pro.js'])
chunks = (v / 'cm/chunks.json').read_text(encoding='utf-8').replace('</', '<\\/')
t = (src / 'template.html').read_text(encoding='utf-8')
for k, val in [('/*CSS*/', (src / 'app.css').read_text(encoding='utf-8')),
               ('/*PRISM*/', (v / 'prism-bundle.js').read_text(encoding='utf-8').replace('</script', '<\\/script')),
               ('/*SAMPLE*/', json.dumps((src / 'sample.md').read_text(encoding='utf-8'), ensure_ascii=False).replace('</', '<\\/')),
               ('/*CMMETA*/', (v / 'cm/meta.json').read_text(encoding='utf-8')),
               ('/*CMCHUNKS*/', chunks),
               ('/*PARSER*/', (src / 'parser.js').read_text(encoding='utf-8')),
               ('/*APP*/', app)]:
    assert k in t, k
    t = t.replace(k, lambda m=None, val=val: val, 1) if False else t.replace(k, val, 1)
out = root / 'dist'; out.mkdir(exist_ok=True)
(out / 'MDView.html').write_text(t, encoding='utf-8')
print('dist/MDView.html', len(t.encode()) // 1024, 'KB')
