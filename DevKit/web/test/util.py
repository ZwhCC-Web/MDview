import asyncio, pathlib
from playwright.async_api import async_playwright
import os
EXE=os.environ.get('CHROME','/opt/pw-browsers/chromium-1208/chrome-linux64/chrome')
ROOT=pathlib.Path(__file__).resolve().parent.parent
URL=(ROOT/'dist/MDView.html').as_uri()
async def page(p, native=False, w=1400, h=900, init=None):
    b = await p.chromium.launch(executable_path=EXE, args=['--no-sandbox','--enable-precise-memory-info'])
    ctx = await b.new_context(viewport={'width':w,'height':h}, accept_downloads=True)
    await ctx.grant_permissions(['clipboard-read','clipboard-write'], origin='null') if False else None
    pg = await ctx.new_page()
    await pg.route('http*://**', lambda r: r.abort())
    if native: await pg.add_init_script(path=str(ROOT/'test/mock_tauri.js'))
    if init: await pg.add_init_script(init)
    errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append('console:'+m.text) if m.type=='error' and 'net::' not in m.text and 'Failed to load resource' not in m.text else None)
    pg.on('dialog', lambda d: asyncio.ensure_future(d.accept(d.default_value or '')))
    await pg.goto(URL); await pg.wait_for_function('window.__MDV_READY', timeout=20000)
    await pg.wait_for_function('MDView.CMK.ok || MDView.CMK.failed', timeout=20000)
    return b, pg, errs
