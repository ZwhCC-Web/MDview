#!/usr/bin/env python3
"""Summarize a GNU-ld style .map: Memory Configuration + output sections. Optional --base for a diff."""
import argparse, re
def parse(p):
    t = open(p, encoding='utf-8', errors='replace').read(); mem, secs = {}, {}
    m = re.search(r'Memory Configuration\s*\n(.*?)\n\s*\n\s*Linker script', t, re.S)
    for line in (m.group(1).splitlines() if m else []):
        f = line.split()
        if len(f) >= 3 and f[1].startswith('0x'): mem[f[0]] = (int(f[1], 16), int(f[2], 16))
    for mm in re.finditer(r'^(\.[\w.]+)\s+(0x[0-9a-fA-F]+)\s+(0x[0-9a-fA-F]+)', t, re.M):
        n, a, s = mm.group(1), int(mm.group(2), 16), int(mm.group(3), 16)
        if s: secs[n] = (a, s)
    return mem, secs
ap = argparse.ArgumentParser(); ap.add_argument('map'); ap.add_argument('--base'); ap.add_argument('--top', type=int, default=15); a = ap.parse_args()
mem, secs = parse(a.map)
print('| 区域 | 起始 | 大小 | 已用 | 占用 |\n|---|---|---:|---:|---:|')
for n, (o, l) in mem.items():
    used = sum(s for (ad, s) in secs.values() if o <= ad < o + l)
    if l: print('| %s | 0x%08X | %d | %d | %.1f%% |' % (n, o, l, used, used / l * 100))
print('\n| 段 | 地址 | 大小 |\n|---|---|---:|')
for n, (ad, s) in sorted(secs.items(), key=lambda x: -x[1][1])[:a.top]: print('| %s | 0x%08X | %d |' % (n, ad, s))
if a.base:
    _, b = parse(a.base); keys = set(b) | set(secs)
    d = sorted(((k, secs.get(k, (0, 0))[1] - b.get(k, (0, 0))[1]) for k in keys), key=lambda x: -abs(x[1]))
    print('\n| 段 | 变化 (B) |\n|---|---:|'); [print('| %s | %+d |' % (k, v)) for k, v in d[:a.top] if v]
