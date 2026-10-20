"""MDView performance benchmark (headless Chromium).
   python bench.py [cm|textarea] [lines]   -> one JSON line
   'textarea' disables the CodeMirror kernel (window.__MDV_NOCM) to measure the plain-textarea baseline,
   which is the lower bound of the previous (v3 overlay) source editor."""
import asyncio, json, sys, statistics, pathlib
from playwright.async_api import async_playwright
EXE = '/opt/pw-browsers/chromium-1208/chrome-linux64/chrome'
HERE = pathlib.Path(__file__).resolve().parent
HTML = (HERE / '../dist/MDView.html').resolve()
MODE = sys.argv[1] if len(sys.argv) > 1 else 'cm'
DOC = (HERE / 'big20k.md').read_text(encoding='utf-8')
if len(sys.argv) > 2: DOC = '\n'.join(DOC.split('\n')[:int(sys.argv[2])])
LAT = "window.__lat=[];document.addEventListener('keydown',e=>{const t0=performance.now();requestAnimationFrame(()=>setTimeout(()=>__lat.push(performance.now()-t0),0))},true);"
p50 = lambda a: round(statistics.median(a), 1)
p95 = lambda a: round(sorted(a)[max(0, int(len(a) * .95) - 1)], 1)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=EXE, args=['--no-sandbox', '--enable-precise-memory-info', '--js-flags=--expose-gc'])
        pg = await b.new_page(viewport={'width': 1400, 'height': 900})
        await pg.route('http*://**', lambda r: r.abort())
        if MODE == 'textarea': await pg.add_init_script('window.__MDV_NOCM=true')
        await pg.add_init_script(LAT)
        await pg.goto(HTML.as_uri()); await pg.wait_for_function('window.__MDV_READY', timeout=20000)
        await pg.wait_for_function('MDView.CMK.ok || MDView.CMK.failed', timeout=20000)
        ev = pg.evaluate; R = {'mode': MODE, 'lines': DOC.count('\n') + 1}
        R['startup_ms'] = round(await ev('window.__MDV_READY'))
        R['open_ms'] = round(await ev("""async d=>{const t=performance.now(); await MDView.openDoc(d,'big.md'); document.body.offsetHeight; await new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0))); return performance.now()-t}""", DOC))
        await pg.wait_for_timeout(300)
        n = R['lines']; ts = []
        for k in range(6):
            ts.append(await ev("""i=>{const bl=MDView.S.result.blocks; const idx=bl.findIndex(b=>b.type==='para'&&b.start>i); MDView.startEdit(idx,'end'); const ta=MDView.S.editing.ta; ta.value=ta.value+' x'; const t=performance.now(); MDView.commit(); document.body.offsetHeight; return performance.now()-t}""", int(n * .45) + k * 40))
        R['live_commit_ms'] = p50(ts)
        await ev("""()=>{const bl=MDView.S.result.blocks; MDView.startEdit(bl.findIndex(b=>b.type==='para'&&b.start>%d),'end'); __lat.length=0}""" % int(n * .5))
        for ch in 'abcdefghijkl': await pg.keyboard.type(ch, delay=70)
        await pg.wait_for_timeout(150)
        lat = await ev('__lat'); R['live_type_p50'] = p50(lat); R['live_type_p95'] = p95(lat)
        await pg.keyboard.press('Escape')
        t0 = await ev('performance.now()'); await ev("MDView.setMode('source')"); await ev('document.body.offsetHeight')
        R['to_source_ms'] = round(await ev('performance.now()') - t0)
        await pg.wait_for_timeout(600)
        await ev("""()=>{const e=MDView.srcEd; const v=e.value; const p=v.indexOf('\\n',v.length/2); e.focus(); e.setSelectionRange(p,p); __lat.length=0}""")
        await pg.wait_for_timeout(200)
        for ch in 'quick brown fox jumps': await pg.keyboard.type(ch, delay=70)
        await pg.keyboard.press('Enter'); await pg.keyboard.type('- item', delay=70); await pg.keyboard.press('Enter')
        await pg.wait_for_timeout(500)
        lat = await ev('__lat'); R['source_type_p50'] = p50(lat); R['source_type_p95'] = p95(lat)
        t0 = await ev('performance.now()'); await ev("(()=>{const e=MDView.srcEd; e.setSelectionRange(e.length-1,e.length-1,true)})()"); await ev('document.body.offsetHeight')
        R['source_jump_end_ms'] = round(await ev('performance.now()') - t0)
        await ev("MDView.setMode('live')"); await pg.wait_for_timeout(300)
        await ev('gc && gc()'); await pg.wait_for_timeout(200)
        R['heap_mb'] = round(await ev('performance.memory.usedJSHeapSize') / 1048576, 1)
        await b.close()
    print(json.dumps(R, ensure_ascii=False))
asyncio.run(main())
