"""ChipBench 超大场景压力测试（1.6.1 起随包提供）
每个场景记录：耗时、主线程长任务(>50ms)数量/最大值、堆内存变化、JS 错误。单个任务 > 1000 ms 判为“卡死”。
用法:  python tests/t_stress.py            全部场景（约 10–15 分钟）
       python tests/t_stress.py B         只跑名字以 B 开头的场景
结果写入 tests/out/stress_result.json"""
import asyncio, json, sys, os, time, random, pathlib
sys.path.insert(0, os.path.dirname(__file__)); from util import *; from base_fs import *
FREEZE = 1000
ONLY = sys.argv[1] if len(sys.argv) > 1 else ''
def huge_md(n):
    out = ['# 超大文档\n']
    for i in range(n):
        out.append(f'## 第 {i} 节 RSCFD 寄存器\n\nCAN FD 位时序 **粗体** `code` [[链接{i%300}]] 0x{i:05X}，PLL 配置说明第 {i} 段。\n\n- [ ] 待办 {i} ⏳ 2026-10-{i%28+1:02d} ~15m\n- 要点 {i}\n\n| 项 | 值 |\n| --- | --: |\n| a | {i} |\n')
        if i % 50 == 0: out.append('```c\nint f%d(void){ return %d; }\n```\n' % (i, i))
    return '\n'.join(out)
def fs_huge():
    fs = base_fs(); R = 'H:\\Mega'; fs[R] = {'dir': 1}
    for a in range(8):
        da = f'{R}\\chip{a}'; fs[da] = {'dir': 1}
        for b in range(5):
            db = f'{da}\\mod{b}'; fs[db] = {'dir': 1}
            for i in range(250):
                ext = ['md', 'c', 'h', 'txt', 'pdf'][i % 5]
                fs[f'{db}\\f{i:03d}.{ext}'] = {'t': (f'# 笔记 {a}-{b}-{i}\n\n' + f'CAN 时钟 寄存器 RSCFD{i} 中断 ' * 8) if ext != 'pdf' else 'x'}
    B = 'H:\\Big'
    fs[B + '\\huge.md'] = {'t': huge_md(11000)}
    fs[B + '\\oneline.js'] = {'t': 'var a=' + ','.join(str(i) for i in range(600000)) + ';'}
    fs[B + '\\wide.csv'] = {'t': '\n'.join(','.join(f'r{r}c{c}' for c in range(30)) for r in range(60000))}
    fs[B + '\\big.html'] = {'t': '<html><body>' + ''.join(f'<section><h2>S{i}</h2><p>{"文本 "*40}</p><table>' + '<tr><td>1</td><td>2</td></tr>' * 10 + '</table></section>' for i in range(4000)) + '</body></html>'}
    fs[B + '\\huge.log'] = {'t': '\n'.join(f'[{i:07d}] {"ERROR CAN bus-off" if i % 997 == 0 else "INFO tick"} v={i%255}' for i in range(400000))}
    fs[B + '\\many_links.md'] = {'t': '# 链接\n\n' + '\n'.join(f'- [[f{i%250:03d}]] [x](f{i%250:03d}.md) ![img](nope{i}.png)' for i in range(3000))}
    fs[B + '\\many_tasks.md'] = {'t': '# 任务\n\n' + '\n'.join(f'- [ ] 任务 {i} ⏳ 2026-10-{i%28+1:02d} ~{(i%5+1)*10}m {"!!" if i%7==0 else ""}' for i in range(5000))}
    fs[B + '\\many_blocks.md'] = {'t': '# 图块\n\n' + '\n'.join('```register\nname: R%d\nwidth: 32\nreset: 0x%X\nfields:\n  - {name: EN, bits: 0}\n  - {name: MODE, bits: "3:1"}\n  - {name: DIV, bits: "15:8"}\n```\n\n```mermaid\ngraph LR\n  A%d --> B%d\n```\n' % (i, i, i, i) for i in range(150))}
    fs[B + '\\wide_table.md'] = {'t': '# 宽表\n\n|' + '|'.join(f'C{c}' for c in range(60)) + '|\n|' + '---|' * 60 + '\n' + '\n'.join('|' + '|'.join(str(r * c) for c in range(60)) + '|' for r in range(3000))}
    fs[B + '\\deepnest.md'] = {'t': '# 嵌套\n\n' + ''.join('  ' * i + f'- 层 {i}\n' for i in range(300)) + '\n' + '>' * 200 + ' 深引用\n'}
    fs[B + '\\unicode.md'] = {'t': '# 混排\n\n' + ('中文English日本語한국어😀🚗 𝒜 \u200b\u202e ' * 20 + '\n\n') * 2000}
    A = 'C:\\Program Files\\ChipBench\\atlas'; fs[A] = {'dir': 1}; fs[A + '\\CAN-FD'] = {'dir': 1}
    for f in ['RH850-U2B.md', 'RH850-U2B.lab.html']: fs[A + '\\CAN-FD\\' + f] = {'t': (ROOT / 'atlas' / 'CAN-FD' / f).read_text('utf-8')}
    return fs
LT = "window.__lt=[];window.__ph='';new PerformanceObserver(l=>l.getEntries().forEach(e=>window.__lt.push([window.__ph,Math.round(e.duration)]))).observe({entryTypes:['longtask']});"
async def main():
    res, fails = {}, []
    with Server() as srv:
        async with async_playwright() as p:
            b, ctx, pg, errs = await launch(p, srv, fs_huge(), LT, w=1440, h=900); ev = pg.evaluate
            W = lambda ms=300: pg.wait_for_timeout(ms)
            heap = lambda: ev("Math.round(performance.memory.usedJSHeapSize/1048576)")
            async def gc():
                try: await ev("window.gc && gc()")
                except Exception: pass
            async def scene(name, coro, budget_ms=None):
                if ONLY and not any(name.startswith(o) for o in ONLY.split(',')): return
                await ev(f"window.__ph={json.dumps(name)}"); e0 = len(errs); h0 = await heap(); t = time.time(); note = None
                try: note = await asyncio.wait_for(coro(), 180)
                except asyncio.TimeoutError:
                    # watchdog: is the UI thread alive? (frozen UI = real bug; responsive UI = harness stall)
                    try: alive = await asyncio.wait_for(ev("performance.now()"), 10); fails.append(f'{name}: 场景超时 180s，界面仍响应（测试驱动停滞）')
                    except Exception: fails.append(f'{name}: 场景超时 180s，界面无响应（真实卡死）')
                    note = 'TIMEOUT'
                except Exception as ex: fails.append(f'{name}: 异常 {str(ex)[:200]}'); note = 'EXC'
                dt = round((time.time() - t) * 1000); await W(200); await gc(); h1 = await heap()
                lt = [d for k, d in await ev("window.__lt") if k == name]
                r = {'ms': dt, 'long': len(lt), 'max': max(lt or [0]), 'heapΔMB': h1 - h0, 'errs': errs[e0:][:3]}
                if note not in (None, 'EXC'): r['note'] = note
                if r['max'] > FREEZE: fails.append(f'{name}: 卡死 {r["max"]}ms')
                if r['errs']: fails.append(f'{name}: 错误 {r["errs"][0][:160]}')
                if budget_ms and dt > budget_ms: fails.append(f'{name}: 超时 {dt}>{budget_ms}ms')
                res[name] = r; print(name, json.dumps(r, ensure_ascii=False), flush=True)
            res['_heap_boot_MB'] = await heap()
            async def openw(path, cond="true", to=60000):
                await ev(f"void ChipBench.openPath({json.dumps(path)})"); await pg.wait_for_function(f"ChipBench.app.current() && ChipBench.app.current().path && ChipBench.app.current().path.toLowerCase()==={json.dumps(path.lower())} && ({cond})", timeout=to)
            # ---- A 工作区 / 索引 / 搜索 / 项目
            async def a1():
                await ev("ChipBench.ws.addRootPath('H:\\\\Mega')")
                await pg.wait_for_function("ChipBench.index.status && ChipBench.index.status.state!=='building' && ChipBench.index.docs.size>=6000", timeout=240000)
                return await ev("({docs:ChipBench.index.docs.size})")
            await scene('A1 添加 1 万文件根目录并建索引', a1, 120000)
            async def a2():
                for i in range(8): await ev(f"(()=>{{const n=[...document.querySelectorAll('#side [data-path]')].find(x=>/chip{i}$/.test(x.dataset.path)); if(n) n.click()}})()"); await W(150)
            await scene('A2 展开 8 个大目录', a2)
            async def a3():
                await ev("ChipBench.panel('search')"); await W(200); out = []
                for q in ['寄存器', 'RSCFD1', 'CAN 时钟', 'zzz不存在', 'R', '中']:
                    t = time.time(); await pg.fill('#sq', q); await W(700); out.append([q, await ev("document.querySelectorAll('#sq-res [data-p]').length")])
                return out
            await scene('A3 全局搜索 1 万文档（含单字）', a3)
            async def a4():
                await ev("ChipBench.panel('search')"); await W(100)
                for i in range(40): await pg.type('#sq', random.choice('寄存器时钟中断CAN'), delay=15)
                await W(800)
            await scene('A4 搜索框连续快速输入 40 字', a4)
            async def a5():
                for i in range(5): await ev(f"(async()=>{{await ChipBench.ws.create('压测项目{i}'); await ChipBench.ws.addRootPath('H:\\\\\\\\Mega\\\\\\\\chip{i}')}})()"); await W(400)
                ids = [w['id'] for w in await ev("ChipBench.ws.list()")]
                for i in range(20): await ev(f"void ChipBench.ws.switchTo({json.dumps(ids[i % len(ids)])})"); await W(120)
                await W(3000); return {'projects': len(ids)}
            await scene('A5 项目快速切换 ×20', a5)
            # ---- B 超大文件
            async def b1():
                await openw('H:\\Big\\huge.md', "ChipBench.app.current().loaded"); await W(800); return await ev("ChipBench.app.ed.view.state.doc.lines")
            await scene('B1 打开 12 万行 Markdown', b1, 15000)
            async def b2():
                await ev("(async()=>{const e=ChipBench.app.ed; e.select(e.length-5); for(let i=0;i<100;i++){e.insert('写'); await new Promise(r=>setTimeout(r,30));}})()"); await W(4500)
            await scene('B2 12 万行文档连续输入 100 字', b2)
            async def b3():
                await ev("(()=>{const v=ChipBench.app.ed.view; v.dispatch({changes:{from:0,to:0,insert:'X'.repeat(200000)+'\\n'}})})()"); await W(1500)
            await scene('B3 一次粘贴 20 万字符', b3)
            async def b4():
                for m in ['read', 'split', 'source', 'live']: await ev(f"ChipBench.app.setMode('{m}')"); await W(1500)
            await scene('B4 12 万行 四种模式切换', b4)
            async def b5():
                await ev("ChipBench.app.save()"); await W(3000); return await ev("ChipBench.app.current().dirty")
            await scene('B5 12 万行保存', b5)
            async def b6():
                await ev("(async()=>{const s=ChipBench.app.ed.view.scrollDOM; for(let i=0;i<60;i++){s.scrollTop=Math.random()*s.scrollHeight; await new Promise(r=>setTimeout(r,40));}})()"); await W(3000)
            await scene('B6 12 万行随机跳转滚动 ×60', b6)
            for nm, f, cond in [('B7 打开单行 4MB 文件', 'oneline.js', 'true'), ('B8 打开 6 万行 CSV', 'wide.csv', 'true'), ('B9 打开 6MB HTML', 'big.html', 'true'), ('B10 打开 40 万行日志', 'huge.log', 'true')]:
                async def bx(f=f, cond=cond): await openw('H:\\Big\\' + f, cond); await W(2500); return await ev("(ChipBench.app.current()||{}).view||'md'")
                await scene(nm, bx, 15000)
            async def b8s():
                await openw('H:\\Big\\wide.csv'); await W(500)
                await ev("(async()=>{const s=document.querySelector('.view-host:not(.hide) .sheet-scroll'); for(let i=0;i<40;i++){s.scrollTop=Math.random()*s.scrollHeight; await new Promise(r=>setTimeout(r,30));}})()"); await W(2000)
            await scene('B11 6 万行 CSV 随机滚动 ×40', b8s)
            for nm, f in [('B12 3000 链接 + 3000 缺失图片', 'many_links.md'), ('B13 150 寄存器 + 150 Mermaid', 'many_blocks.md'), ('B14 60 列 × 3000 行宽表', 'wide_table.md'), ('B15 300 层嵌套 / 200 层引用', 'deepnest.md'), ('B16 多语种 + emoji + 控制字符', 'unicode.md')]:
                async def bx(f=f):
                    await openw('H:\\Big\\' + f, "ChipBench.app.current().loaded"); await W(1500); await ev("ChipBench.app.setMode('read')"); await W(3000)
                    await ev("(()=>{const p=document.querySelector('#pv-pane'); if(p) for(let i=0;i<10;i++) p.scrollTop=p.scrollHeight*i/10})()"); await W(1500); await ev("ChipBench.app.setMode('live')"); await W(800)
                await scene(nm, bx, 25000)
            # ---- C 标签 / 内存
            async def c1():
                await pg.screenshot(path=str(ROOT/'tests'/'out_c1_before.png')) if os.environ.get('SHOT') else None
                paths = await ev("[...ChipBench.index.docs.values()].map(d=>d.path).filter(p=>/\\.(md|txt)$/i.test(p)).slice(0,60)")
                for x in paths:
                    try: await asyncio.wait_for(ev(f"ChipBench.openPath({json.dumps(x)})"), 8)
                    except asyncio.TimeoutError:
                        await pg.screenshot(path='/home/claude/w/c1_stuck.png'); raise RuntimeError('openPath 卡住: ' + x + ' modal=' + str(await ev("(document.querySelector('.modal')||{}).innerText||''")))
                await W(1000); n = await ev("ChipBench.app.tabs.length")
                for i in range(30): await ev(f"ChipBench.app.activate({i*7 % n})"); await W(40)
                return n
            await scene('C1 打开 60+ 标签并快速轮切 ×30', c1)
            async def c2():
                await ev("(async()=>{for(const t of ChipBench.app.tabs) t.dirty=false; for(let i=ChipBench.app.tabs.length-1;i>=0;i--) await ChipBench.app.close(i,true)})()"); await W(1500); return await ev("ChipBench.app.tabs.length")
            await scene('C2 关闭全部标签', c2)
            async def c3():
                await gc(); h0 = await heap()
                for i in range(25):
                    await openw('H:\\Big\\many_blocks.md', "ChipBench.app.current().loaded"); await W(250); await ev("ChipBench.app.close(ChipBench.app.cur,true)"); await W(80)
                await W(1500); await gc(); await W(500); return {'heap_before': h0, 'heap_after': await heap()}
            await scene('C3 反复开关大图块文档 ×25（泄漏）', c3)
            # ---- D 面板 / IP / 计划 / 交互
            async def d1():
                for i in range(120): await ev(f"ChipBench.panel({json.dumps(['search','learn','tools','atlas','plan','workspace'][i%6])})"); await W(15)
                await W(800)
            await scene('D1 侧栏面板狂切 ×120', d1)
            async def d2():
                await openw('H:\\Big\\many_tasks.md', "ChipBench.app.current().loaded"); await ev("ChipBench.index.indexText(ChipBench.app.current().path, ChipBench.app.textOf(ChipBench.app.current()))"); await W(2500); await ev("ChipBench.panel('plan')"); await W(1500); return await ev("ChipBench.index.tasks().length")
            await scene('D2 计划面板（5000+ 任务）', d2)
            async def d3():
                await ev("ChipBench.atlas.scan()"); await W(500); pth = await ev("ChipBench.atlas.pages.find(p=>p.bundled).path")
                for i in range(6):
                    await ev(f"ChipBench.atlas.open({json.dumps(pth)})"); await W(700)
                    for tb in ['结构', '场景', '寄存器', '概览']: await ev(f"(()=>{{const b=document.querySelector('.fp .at-tabs [data-t=\"{tb}\"]'); b&&b.click()}})()"); await W(200)
                    await ev("ChipBench.closeFull()"); await W(150)
            await scene('D3 IP 图谱开/切 4 页/关 ×6', d3)
            async def d4():
                for i in range(10): await pg.keyboard.press('F11'); await W(120)
                await pg.keyboard.press('Escape'); await W(300)
            await scene('D4 F11 全屏连按 ×10', d4)
            async def d5():
                for w, h in [(800, 600), (1024, 640), (1920, 1080), (640, 480), (2560, 1440), (1440, 900)]: await pg.set_viewport_size({'width': w, 'height': h}); await W(250)
            await scene('D5 窗口尺寸 640→2560 反复调整', d5)
            async def d6():
                await openw('C:\\Work\\DFA培训\\资料\\样品.xlsx'); await W(600)
                for i in range(30): await ev(f"ChipBench.zoom.step({1 if i%3 else -1})"); await W(30)
                await ev("ChipBench.zoom.reset()"); await W(400); return await ev("ChipBench.zoom.get(ChipBench.app.current())")
            await scene('D6 缩放连续 30 次 + 还原', d6)
            res['_heap_end_MB'] = await heap(); res['_dom_nodes_end'] = await ev("document.getElementsByTagName('*').length"); res['_fails'] = fails
            await b.close()
    out = ROOT / 'tests' / 'out'; out.mkdir(exist_ok=True); (out / ('stress_' + (ONLY.replace(',', '_') or 'all') + '.json')).write_text(json.dumps(res, ensure_ascii=False, indent=1), 'utf-8')
    print(json.dumps({'fails': fails}, ensure_ascii=False))
if __name__ == '__main__':
    if ONLY: asyncio.run(main())
    else:
        # each group in a fresh browser (B/C/D first rebuild the 1万-file workspace with A1)
        import subprocess; allf = []
        for g in ['A', 'A1,B', 'A1,C', 'A1,D']:
            print('=== group', g, flush=True); r = subprocess.run([sys.executable, __file__, g], capture_output=True, text=True, timeout=1500)
            print(r.stdout, flush=True); line = [l for l in r.stdout.splitlines() if l.startswith('{"fails"')]
            allf += json.loads(line[-1])['fails'] if line else [f'group {g}: 无结果 rc={r.returncode} {r.stderr[-300:]}']
        print(json.dumps({'fails': allf}, ensure_ascii=False))
