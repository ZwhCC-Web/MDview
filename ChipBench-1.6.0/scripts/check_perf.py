"""Fail the build when a performance budget is exceeded (reads tests/perf_results.json written by t_perf.py)."""
import json, pathlib, sys
r = json.loads((pathlib.Path(__file__).resolve().parent.parent / 'tests' / 'perf_results.json').read_text())
BUDGET = {  # headless, software-rendered CI browser: generous ceilings, meant to catch regressions (2-3x), not to certify targets
    'type_live_median_ms': 60, 'type_source_median_ms': 60, 'type_source_p95_ms': 120, 'type_live_p95_ms': 150,
    'open_big_live_ms': 3000, 'outline_from_syntax_tree_ms': 60, 'search_unique_ms': 20, 'log_300k_lines_open_ms': 1000,
    'heap_big_open_mb': 160, 'dom_content_loaded_ms': 1500,
}
bad = [(k, r[k], v) for k, v in BUDGET.items() if k in r and r[k] > v]
for k, v in BUDGET.items(): print(('FAIL ' if (k, r.get(k), v) in bad else 'ok   ') + f'{k}: {r.get(k)} (budget {v})')
sys.exit(1 if bad else 0)
