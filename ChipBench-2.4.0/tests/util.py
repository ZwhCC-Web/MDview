import asyncio, base64, json, os, pathlib, subprocess, sys, time, socket, contextlib
from playwright.async_api import async_playwright
ROOT = pathlib.Path(__file__).resolve().parent.parent
VER = json.loads((ROOT / 'package.json').read_text('utf-8'))['version']   # the version every test compares against (never hard-code it)
EXE = os.environ.get('CHROME') or next((c for c in ['/opt/pw-browsers/chromium-current/chrome-linux64/chrome'] if os.path.exists(c)), None)  # None -> Playwright's own Chromium
def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p
class Server:
    def __init__(self): self.port = free_port(); self.p = None
    def __enter__(self):
        self.p = subprocess.Popen([sys.executable, '-m', 'http.server', str(self.port), '--bind', '127.0.0.1', '--directory', str(ROOT / 'app')], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(60):
            try: socket.create_connection(('127.0.0.1', self.port), timeout=.2).close(); break
            except OSError: time.sleep(.1)
        return self
    def __exit__(self, *a): self.p.terminate()
    @property
    def url(self): return f'http://127.0.0.1:{self.port}/index.html'
async def launch(p, srv, fs=None, extra_init='', w=1440, h=900, native=True, grant=True, kv=None):
    b = await p.chromium.launch(executable_path=EXE, args=['--no-sandbox', '--enable-precise-memory-info', '--js-flags=--expose-gc'])
    ctx = await b.new_context(viewport={'width': w, 'height': h}, accept_downloads=True)
    if grant:
        try: await ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
        except Exception: pass
    # fixed "today": the fixtures hard-code 2026-10-21 (planner tests). Time keeps running. Override: CHIPBENCH_TEST_NOW=2026-10-21T10:00:00
    NOW = os.environ.get('CHIPBENCH_TEST_NOW', '2026-10-21T10:00:00')
    await ctx.add_init_script("(()=>{const RD=Date, off=RD.parse('" + NOW + "')-RD.now(); function FD(...a){ if(!new.target) return new RD(RD.now()+off).toString(); return a.length ? new RD(...a) : new RD(RD.now()+off); } FD.prototype=RD.prototype; FD.now=()=>RD.now()+off; FD.parse=RD.parse; FD.UTC=RD.UTC; window.Date=FD; })()")
    pg = await ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
    pg.on('console', lambda m: errs.append('console.error: ' + m.text) if m.type == 'error' else None)
    if native:
        await pg.add_init_script(path=str(ROOT / 'tests/mock_tauri.js'))
    if fs: await pg.add_init_script('window.__FS = Object.assign(window.__FS || {}, ' + json.dumps(fs) + ');')
    if kv: await pg.add_init_script('window.__KV = Object.assign(window.__KV || {}, ' + json.dumps(kv) + ');')
    if extra_init: await pg.add_init_script(extra_init)
    await pg.goto(srv.url); await pg.wait_for_function('window.ChipBench && ChipBench.bootMs !== undefined', timeout=20000)
    return b, ctx, pg, errs
def b64(p): return base64.b64encode(pathlib.Path(p).read_bytes()).decode()
