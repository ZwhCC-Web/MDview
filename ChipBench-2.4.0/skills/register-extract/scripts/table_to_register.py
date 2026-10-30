#!/usr/bin/env python3
"""Convert 'bit(s) NAME ACCESS description' lines (stdin) into a ChipBench ```register block.
   bits: 26 | 31:27 | 31-27 | 31 to 27        ACCESS: R | W | R/W | RW | RO | WO | W1C"""
import argparse, re, sys
ap = argparse.ArgumentParser(); ap.add_argument('--name', required=True); ap.add_argument('--address', default=''); ap.add_argument('--width', type=int, default=32)
ap.add_argument('--reset', default='0x0'); ap.add_argument('--page', default=''); ap.add_argument('--source', default='')
a = ap.parse_args()
rows = []
for line in sys.stdin:
    m = re.match(r'^\s*(\d+)\s*(?:(?:to|-|:)\s*(\d+))?\s+([A-Za-z_][\w]*)\s+(R/W|RW|R|W|RO|WO|W1C)?\s*(.*)$', line.strip(), re.I)
    if not m: continue
    hi, lo, nm, acc, desc = m.groups(); bits = hi if not lo else '%s:%s' % (max(int(hi), int(lo)), min(int(hi), int(lo)))
    acc = (acc or ('R' if nm.upper().startswith('RSV') else 'RW')).upper().replace('R/W', 'RW')
    rows.append('  - {name: %s, bits: %s, access: %s%s}' % (nm, '"%s"' % bits if ':' in bits else bits, acc, (', desc: ' + desc.replace('}', ')').replace(',', '，')) if desc else ''))
print('```register'); print('name: ' + a.name)
if a.address: print('address: ' + a.address)
print('width: %d' % a.width); print('reset: ' + a.reset)
if a.source: print('source: ' + a.source)
if a.page: print('page: ' + str(a.page))
print('fields:'); print('\n'.join(rows)); print('```')
