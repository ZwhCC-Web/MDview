import asyncio, json, statistics, sys
from util import *; from base_fs import *
def big_doc(n_sections=1700):
    parts = ['---\ntitle: 大型文档\nstatus: 测试\n---\n']
    for i in range(n_sections):
        parts.append(f'## 第 {i} 节 时钟与外设配置\n\n这是第 {i} 节的说明，包含 **粗体**、*斜体*、`code` 与 [[链接{i % 50}]]，寄存器值 0x{i:04X}。CAN FD 位时序与 PLL 配置需要参考手册，请按照手册第 {i % 900} 页的流程逐项核对时钟源、分频与使能顺序，并在寄存器写入之后读回确认；若出现不一致，先检查复位状态再检查外设时钟门控。\n\n- 要点 A {i}\n- 要点 B\n- [ ] 待办 {i} ⏳ 2026-10-{(i % 28) + 1:02d} ~30m\n\n| 项 | 值 |\n| --- | --: |\n| a | {i} |\n')
        if i % 25 == 0: parts.append('```c\nint main(void) {\n  return %d;\n}\n```\n' % i)
    return '\n'.join(parts)
async def main():
    doc = big_doc(); lines = doc.count('\n') + 1
    fs = {'C:\\Big': {'dir': 1}, 'C:\\Big\\big.md': {'t': doc}, 'C:\\Big\\small.md': {'t': '# 小文档\n\n' + '段落\n\n' * 100}}
    out = {'doc_lines': lines, 'doc_chars': len(doc)}
    with Server() as srv:
        async with async_playwright() as p:
            b, ctx, pg, errs = await launch(p, srv, fs); ev = pg.evaluate
            out['boot_ms'] = await ev('ChipBench.bootMs')
            nav = await ev("(()=>{const n=performance.getEntriesByType('navigation')[0]; return {dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd)}})()"); out['dom_content_loaded_ms'] = nav['dcl']; out['load_event_ms'] = nav['load']
            out['heap_boot_mb'] = round(await ev('performance.memory.usedJSHeapSize') / 1048576, 1)
            await ev("window.__lt=[]; new PerformanceObserver(l=>l.getEntries().forEach(e=>window.__lt.push(e.duration))).observe({entryTypes:['longtask']})")
            # open small doc first (editor warm-up) then big doc in live mode
            await ev("ChipBench.openPath('C:\\\\Big\\\\small.md')"); await pg.wait_for_function("ChipBench.app.current() && ChipBench.app.current().loaded", timeout=15000)
            t0 = await ev("performance.now()"); await ev("ChipBench.openPath('C:\\\\Big\\\\big.md')"); await pg.wait_for_function("ChipBench.app.current().name==='big.md' && ChipBench.app.current().loaded", timeout=30000); await ev("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))"); t1 = await ev("performance.now()")
            out['open_big_live_ms'] = round(t1 - t0)
            out['dom_lines_rendered'] = await ev("document.querySelectorAll('.cm-line').length")
            bench = """async (n) => { const ed = ChipBench.app.ed; const times = []; ed.select(Math.floor(ed.length/2)); for (let i=0;i<n;i++){ const t0=performance.now(); ed.insert('x'); await new Promise(r=>requestAnimationFrame(()=>r())); await new Promise(r=>setTimeout(r,0)); times.push(performance.now()-t0); await new Promise(r=>setTimeout(r,25)); } return times; }"""
            async def stats(name, t):
                t = sorted(t); out[name + '_median_ms'] = round(statistics.median(t), 1); out[name + '_p95_ms'] = round(t[int(len(t) * .95) - 1], 1); out[name + '_max_ms'] = round(t[-1], 1)
            await ev("window.__lt.length=0")
            await stats('type_live', await ev("(" + bench + ")(80)")); out['longtasks_live'] = await ev("window.__lt.filter(x=>x>50).length"); out['perf_live_decos'] = await ev('JSON.stringify(ChipBench.E.perf)')
            await ev("ChipBench.app.setMode('source')"); await pg.wait_for_timeout(600); await ev("window.__lt.length=0")
            await stats('type_source', await ev("(" + bench + ")(80)")); out['longtasks_source'] = await ev("window.__lt.filter(x=>x>50).length")
            # scroll jump latency in live mode
            await ev("ChipBench.app.setMode('live')"); await pg.wait_for_timeout(500)
            sc = await ev("""(async()=>{ const v=ChipBench.app.ed.view, ts=[]; for (const f of [0.1,0.5,0.9,0.3,0.7]) { const t0=performance.now(); v.scrollDOM.scrollTop = (v.scrollDOM.scrollHeight)*f; await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); ts.push(performance.now()-t0); } return ts; })()"""); out['scroll_jump_live_ms'] = [round(x) for x in sc]
            # preview in worker + virtualised groups
            t0 = await ev("performance.now()"); await ev("ChipBench.app.setMode('read')"); await pg.wait_for_function("document.querySelectorAll('#pv-pane .pv-g').length>0", timeout=30000); t1 = await ev("performance.now()")
            out['read_mode_first_paint_ms'] = round(t1 - t0); await pg.wait_for_timeout(800)
            out['preview_groups_total'] = await ev("document.querySelectorAll('#pv-pane .pv-g').length"); out['preview_groups_hydrated'] = await ev("document.querySelectorAll('#pv-pane .pv-g').length && [...document.querySelectorAll('#pv-pane .pv-g')].filter(g=>g.__on).length")
            out['preview_dom_nodes'] = await ev("document.querySelector('#pv-pane').getElementsByTagName('*').length")
            await ev("ChipBench.app.setMode('live')"); await pg.wait_for_timeout(300)
            # incremental preview update (split): type, measure until preview reflects the edit
            await ev("ChipBench.app.setMode('split')"); await pg.wait_for_timeout(1500)
            ut = await ev("""(async()=>{ const ed=ChipBench.app.ed, ts=[]; for (let i=0;i<8;i++){ ed.select(40); const mark='标记'+i+'z'; const t0=performance.now(); ed.insert(mark); while(!document.querySelector('#pv-pane').innerText.includes(mark)) await new Promise(r=>setTimeout(r,5)); ts.push(performance.now()-t0); } return ts; })()"""); out['split_preview_update_median_ms'] = round(statistics.median(ut)); out['split_preview_update_max_ms'] = round(max(ut))
            out['heap_big_open_raw_mb'] = round(await ev('performance.memory.usedJSHeapSize') / 1048576, 1); await ev('window.gc && gc()'); await pg.wait_for_timeout(300); out['heap_big_open_mb'] = round(await ev('performance.memory.usedJSHeapSize') / 1048576, 1)  # 1.1: after GC (live objects only)
            # outline cost: syntax-tree based
            await ev("ChipBench.app.setMode('live')"); await pg.wait_for_timeout(500)
            oc = await ev("(()=>{ const t0=performance.now(); const h=ChipBench.app.ed.headings(); return [h.length, performance.now()-t0]; })()"); out['outline_headings'] = oc[0]; out['outline_from_syntax_tree_ms'] = round(oc[1], 1)
            out['word_count_ms'] = round(await ev("(()=>{ const t=ChipBench.app.ed.value; const t0=performance.now(); ChipBench.app.countWords(t); return performance.now()-t0; })()"), 1)
            await b.close()
        # ---- index of 2000 notes
        fs2 = {'C:\\Many': {'dir': 1}}
        for i in range(2000): fs2['C:\\Many\\n%04d.md' % i] = {'t': f'---\nstatus: s{i%5}\n---\n# 笔记 {i}\n\n' + ('CAN 时钟 PLL 配置说明 ' * 40) + f'\n唯一关键词Z{i}\n- [ ] 待办 {i}\n[[n{(i+1)%2000:04d}]]\n'}
        async with async_playwright() as p:
            b, ctx, pg, errs = await launch(p, srv, fs2); ev = pg.evaluate
            await ev("window.__pickFolder='C:\\\\Many'"); t0 = await ev("performance.now()"); await ev("ChipBench.ws.addRootPath('C:\\\\Many')"); await pg.wait_for_function("ChipBench.index.docs.size>=2000", timeout=60000); out['index_2000_notes_ms'] = round(await ev("performance.now()") - t0)
            sr = await ev("(()=>{ const t0=performance.now(); const r=ChipBench.index.runSearch('唯一关键词Z1234'); const t1=performance.now(); const r2=ChipBench.index.runSearch('时钟 配置'); return [r.length, t1-t0, r2.length, performance.now()-t1]; })()"); out['search_unique_ms'] = round(sr[1], 2); out['search_common_term_ms'] = round(sr[3], 2); out['search_unique_hits'] = sr[0]
            out['backlinks_ms'] = round(await ev("(()=>{ const t0=performance.now(); ChipBench.index.backlinks('C:\\\\Many\\\\n0100.md'); return performance.now()-t0; })()"), 1)
            out['heap_index_2000_mb'] = round(await ev('performance.memory.usedJSHeapSize') / 1048576, 1)
            await b.close()
        # ---- log viewer on a 300k-line file (mock Rust API) and CSV
        fs3 = {'C:\\L': {'dir': 1}, 'C:\\L\\big.log': {'t': '\n'.join(f'[{i}] INFO value={i%97}' for i in range(300000))}}
        async with async_playwright() as p:
            b, ctx, pg, errs = await launch(p, srv, fs3); ev = pg.evaluate
            t0 = await ev("performance.now()"); await ev("ChipBench.openPath('C:\\\\L\\\\big.log')"); await pg.wait_for_selector('.view-host:not(.hide) .logv .hr', timeout=20000); out['log_300k_lines_open_ms'] = round(await ev("performance.now()") - t0)
            out['log_dom_rows'] = await ev("document.querySelectorAll('.view-host:not(.hide) .logv .hr').length")
            await b.close()
    print(json.dumps(out, ensure_ascii=False, indent=1)); json.dump(out, open(ROOT / 'tests' / 'perf_results.json', 'w'), ensure_ascii=False, indent=1)
asyncio.run(main())
