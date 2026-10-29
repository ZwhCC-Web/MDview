#!/usr/bin/env python3
"""Keep bundled skills consistent.   python tools/sync-skills.py [--check]
   · copies mcp/aenet.py into every skill that ships scripts/aenet.py (single source of truth)
   · validates SKILL.md front matter: name == folder name (lowercase, digits, hyphens), description present and <= 1024 chars"""
import pathlib, re, shutil, sys
root = pathlib.Path(__file__).resolve().parent.parent; src = root / 'mcp' / 'aenet.py'; check = '--check' in sys.argv; bad = []
for d in sorted((root / 'skills').iterdir()):
    if not d.is_dir(): continue
    f = d / 'SKILL.md'
    if not f.is_file(): bad.append(f'{d.name}: SKILL.md missing'); continue
    m = re.match(r'^---\s*\n(.*?)\n---', f.read_text(encoding='utf-8'), re.S); meta = dict(re.findall(r'^(\w[\w-]*):\s*(.+)$', m.group(1), re.M)) if m else {}
    if meta.get('name') != d.name or not re.fullmatch(r'[a-z0-9]+(-[a-z0-9]+)*', d.name): bad.append(f'{d.name}: name must equal folder name')
    if not meta.get('description') or len(meta['description']) > 1024: bad.append(f'{d.name}: description missing or too long')
    a = d / 'scripts' / 'aenet.py'
    if a.exists() and a.read_bytes() != src.read_bytes():
        if check: bad.append(f'{d.name}: scripts/aenet.py is out of date (run tools/sync-skills.py)')
        else: shutil.copy(src, a); print('synced', a.relative_to(root))
print('\n'.join(bad) if bad else 'skills OK (%d)' % sum(1 for d in (root / 'skills').iterdir() if d.is_dir())); sys.exit(1 if bad else 0)
