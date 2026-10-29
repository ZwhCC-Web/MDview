#!/usr/bin/env python3
"""Design-token lint for app/css/chipbench.css.
   python tools/check-css.py            report + fail if a counter is HIGHER than tools/css-baseline.json (new code must use tokens)
   python tools/check-css.py --fix      rewrite raw values that are exactly a token (border-radius 4/6/8/12/16px → --r1..--r5, font-size 11/12/13/15/20/28px → --fs-*)
   python tools/check-css.py --baseline write the current counters as the new baseline
Colours are only reported: #fff / #000 are often intentional (text on a brand button) and must not follow the theme."""
import json, pathlib, re, sys
ROOT = pathlib.Path(__file__).resolve().parent.parent; CSS = ROOT / 'app/css/chipbench.css'; BASE = pathlib.Path(__file__).resolve().parent / 'css-baseline.json'
RAD = {'4': '--r1', '6': '--r2', '8': '--r3', '12': '--r4', '16': '--r5'}; FS = {'11': '--fs-xs', '12': '--fs-sm', '13': '--fs-md', '15': '--fs-lg', '20': '--fs-xl', '28': '--fs-2xl'}
rad_re = re.compile(r'(border-radius:\s*)(4|6|8|12|16)px(?=\s*(?:;|\}|!important))'); fs_re = re.compile(r'(font-size:\s*)(11|12|13|15|20|28)px(?=\s*(?:;|\}|!important))')
def count(s):
    body = re.sub(r':root\s*\{.*?\n\}', '', s, count=1, flags=re.S); body = re.sub(r'(?:html)?\[data-theme[^{]*\{[^}]*\}', '', body)
    return {'raw_radius_equal_to_token': len(rad_re.findall(body)), 'raw_fontsize_equal_to_token': len(fs_re.findall(body)), 'hex_colours_outside_theme': len(re.findall(r'#[0-9a-fA-F]{3,8}\b', body)), 'important': body.count('!important')}
s = CSS.read_text('utf-8')
if '--fix' in sys.argv:
    s2 = rad_re.sub(lambda m: m.group(1) + 'var(%s)' % RAD[m.group(2)], s); s2 = fs_re.sub(lambda m: m.group(1) + 'var(%s)' % FS[m.group(2)], s2)
    n = sum(1 for a, b in zip(s.split('\n'), s2.split('\n')) if a != b); CSS.write_text(s2, 'utf-8'); print('rewrote', n, 'lines'); s = s2
c = count(s); print(json.dumps(c, indent=1))
if '--baseline' in sys.argv: BASE.write_text(json.dumps(c, indent=1) + '\n'); print('baseline written'); sys.exit(0)
if BASE.exists():
    b = json.loads(BASE.read_text()); worse = {k: (c[k], b[k]) for k in c if k in b and c[k] > b[k]}
    if worse: print('FAIL — more raw values than the baseline:', worse); sys.exit(1)
print('css tokens OK')
