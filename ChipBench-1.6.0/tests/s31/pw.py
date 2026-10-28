"""Shared Playwright helper. Env: CHIPBENCH_BASE (server root = project folder), CHIPBENCH_CHROME (optional chromium executable)."""
import os, contextlib
from playwright.sync_api import sync_playwright
BASE = os.environ.get('CHIPBENCH_BASE', 'http://localhost:8770/')
@contextlib.contextmanager
def browser(w=1300, h=800):
    with sync_playwright() as p:
        kw = {'args': ['--no-sandbox', '--font-render-hinting=none']}
        if os.environ.get('CHIPBENCH_CHROME'): kw['executable_path'] = os.environ['CHIPBENCH_CHROME']
        b = p.chromium.launch(**kw); pg = b.new_page(viewport={'width': w, 'height': h}); errs = []
        pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
        pg.on('console', lambda m: errs.append('console.' + m.type + ': ' + m.text) if m.type == 'error' and '404' not in m.text else None)
        yield pg, errs
        b.close()
