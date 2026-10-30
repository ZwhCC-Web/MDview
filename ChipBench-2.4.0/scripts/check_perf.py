"""Fail the build when a performance budget is exceeded.
   python scripts/check_perf.py        reads tests/perf_results.json   (written by tests/t_perf.py: one big document)
   python scripts/check_perf.py 17     reads tests/perf_results17.json (written by tests/t_perf17.py: start-up, workspace switch, file open, long run)"""
import json, pathlib, sys
T = pathlib.Path(__file__).resolve().parent.parent / 'tests'
LEGACY = {'type_live_median_ms': 60, 'type_source_median_ms': 60, 'type_source_p95_ms': 120, 'type_live_p95_ms': 150, 'open_big_live_ms': 3000, 'outline_from_syntax_tree_ms': 60, 'search_unique_ms': 20, 'log_300k_lines_open_ms': 1000, 'heap_big_open_mb': 160, 'dom_content_loaded_ms': 1500}
SCENARIOS = {  # ceilings ≈ 2–3× the measured values on the headless CI browser: they catch regressions, they do not certify device numbers
    'boot_ms': 400, 'dom_content_loaded_ms': 2500, 'startup_js_kb': 1000, 'startup_longtasks': 3, 'ws_switch_p95_ms': 150, 'ws_switch_longtasks': 3,
    'open_md_p95_ms': 250, 'open_md_longtasks': 10, 'open_pdf_median_ms': 1500, 'open_xlsx_median_ms': 300, 'open_docx_median_ms': 300, 'open_log_median_ms': 300,
    'tab_switch_p95_ms': 250, 'input_latency_p95_ms': 120, 'longrun_heap_growth_mb': 30, 'longrun_dom_growth': 200, 'longrun_tasks_left': 0, 'caches_over_limit': 0, 'rt_errors': 0, 'console_errors': 0}
which = sys.argv[1] if len(sys.argv) > 1 else ''
res, budget = (json.loads((T / 'perf_results17.json').read_text()), SCENARIOS) if which == '17' else (json.loads((T / 'perf_results.json').read_text()), LEGACY)
bad = [(k, res[k], v) for k, v in budget.items() if k in res and res[k] > v]
for k, v in budget.items(): print(('FAIL ' if (k, res.get(k), v) in bad else 'ok   ') + f'{k}: {res.get(k)} (budget {v})')
sys.exit(1 if bad else 0)
