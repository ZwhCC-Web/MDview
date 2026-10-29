import asyncio, json, zipfile, io, base64
from util import *; from base_fs import *
R = {}; fails = []
def chk(name, cond, info=None):
    R[name] = bool(cond); print('  ok ' if cond else '  FAIL', name, flush=True) if cond else None
    if not cond: fails.append(name); print('FAIL', name, info if info is not None else '')
NOTE = 'C:\\Work\\DFA培训\\讲稿.md'
AIFETCH = """
window.__aiCalls = []; window.__fetch = async (u, o) => { window.__aiCalls.push({u, body: o && o.body});
  const body = JSON.parse(o.body), last = body.messages[body.messages.length-1].content; let text;
  if (/提取「/.test(last)) text = '```yaml\\ntype: clock-tree\\ntitle: AI 时钟树\\nsource: manual.pdf\\nnodes:\\n  - {id: mosc, label: Main OSC, kind: source, freq: 20MHz, page: 1}\\n  - {id: pll, label: PLL0, kind: pll, in: mosc, mul: 24, max: 480MHz, page: 2}\\n  - {id: bad, label: 编造节点, kind: div, in: pll, div: 4, max: 999MHz, page: 2}\\n```';
  else if (/学习问答卡片/.test(last)) text = 'Q: 时钟源？ p.1\\nA: Main OSC\\n\\nQ: PLL 上限？ p.2\\nA: 480 MHz';
  else text = '这是 AI 的回答：' + last.slice(0, 20);
  const enc = new TextEncoder(); const chunks = text.match(/.{1,8}/gs).map(c => enc.encode('data: ' + JSON.stringify({choices:[{delta:{content:c}}]}) + '\\n\\n')); chunks.push(enc.encode('data: [DONE]\\n\\n'));
  let i = 0; return { ok: true, status: 200, body: { getReader() { return { read: async () => i < chunks.length ? { done: false, value: chunks[i++] } : { done: true } }; } }, text: async () => '' }; };
"""
async def main():
    with Server() as srv:
        async with async_playwright() as p:
            fs = base_fs(); fs['C:\\Users\\me\\.chipbench\\cache\\office\\规格.docx.pdf'] = {'b': b64(F / 'manual.pdf')}
            b, ctx, pg, errs = await launch(p, srv, fs, 'window.__PDFTEXT=' + json.dumps(PDFTEXT) + ';' + AIFETCH + "window.__saveTo='C:\\\\Out';"); ev = pg.evaluate
            async def wait(ms=300): await pg.wait_for_timeout(ms)
            await ev("window.__pickFolder='C:\\\\Work\\\\DFA培训'"); await pg.click('.btn[data-a=add-root]'); await wait(300)
            await ev("window.__pickFolder='D:\\\\Share'"); await pg.click('#side-actions [data-a=add]'); await pg.click('.menu-pop [data-k=add-root]'); await pg.wait_for_function('ChipBench.index.docs.size>=9', timeout=8000)
            await ev("ChipBench.openPath('" + NOTE.replace('\\', '\\\\') + "')"); await pg.wait_for_function("ChipBench.app.current() && ChipBench.app.current().loaded", timeout=10000); await wait(600)
            # ---------- search (notes + pdf pages)
            await ev("ChipBench.panel('search')"); await pg.fill('#sq', '样品'); await wait(500)
            chk('search: note results', '问题跟踪' in await ev("document.querySelector('#sq-res').innerText") or '会议纪要' in await ev("document.querySelector('#sq-res').innerText"), await ev("document.querySelector('#sq-res').innerText"))
            await pg.wait_for_function("ChipBench.index.search.size > 10", timeout=15000)  # pdf/office text extracted in background
            await pg.fill('#sq', 'receive filter'); await wait(600)
            chk('search: pdf page hit with page number', 'p.3' in await ev("document.querySelector('#sq-res').innerText"), await ev("document.querySelector('#sq-res').innerText"))
            await pg.fill('#sq', '规格'); await wait(400)
            await pg.click('#sq-scope [data-s=regex]'); await pg.fill('#sq', 'CAN.*错误'); await wait(600); chk('search: regex via Rust', '问题跟踪' in await ev("document.querySelector('#sq-res').innerText"))
            # ---------- right panel: links / props
            await pg.keyboard.press('Control+Shift+r'); await wait(500)
            chk('right panel links', await ev("document.querySelector('#right').classList.contains('open')") and '反向链接' in await ev("document.querySelector('#right').innerText"))
            await pg.click('#right [data-t=props]'); await wait(300)
            chk('props tab lists front matter', 'status' in await ev("document.querySelector('#right').innerText") and '进行中' in await ev("[...document.querySelectorAll('#right .prop input')].map(i=>i.value).join()"))
            await ev("document.querySelector('#right .prop input[data-k=status]').value='完成'; document.querySelector('#right .prop input[data-k=status]').dispatchEvent(new Event('change',{bubbles:true}))"); await wait(300)
            chk('props edit writes yaml', 'status: 完成' in await ev("ChipBench.app.ed.value"))
            await ev("ChipBench.run('right.toggle')")
            # ---------- widgets: query board drag -> front matter
            await ev("ChipBench.openPath('C:\\\\Work\\\\DFA培训\\\\章节\\\\03-Combine.md')"); await pg.wait_for_selector('.lv-w .qry.board .kcard', timeout=10000); await wait(300)
            chk('query board lanes', await ev("document.querySelectorAll('.lv-w .kcol').length") == 2 and await ev("document.querySelectorAll('.lv-w .kcard').length") >= 3)
            await ev("ChipBench.app.ed.select(0)")
            card = pg.locator('.lv-w .kcard', has_text='SWC 使用'); lane = pg.locator('.lv-w .kcol[data-lane="完成"]')
            await card.drag_to(lane); await wait(1200)
            chk('board drag updates front matter on disk', 'status: 完成' in await ev("window.__FS['C:\\\\Work\\\\DFA培训\\\\章节\\\\02-SWC.md'].t"), await ev("window.__FS['C:\\\\Work\\\\DFA培训\\\\章节\\\\02-SWC.md'].t.slice(0,80)"))
            async def show(tag):   # CodeMirror only renders block widgets near the viewport: scroll to the block under test
                await ev("(t=>{const ed=ChipBench.app.ed, L=ed.value.split('\\n'), i=L.findIndex(l=>l.startsWith('```'+t)); if(i>=0) ed.scrollToLine(i)})('" + tag + "')"); await wait(900)
            # pin / memmap / partdecode / chart via insert commands
            await ev("ChipBench.app.activate(0)"); await wait(500)
            await ev("""(()=>{const ed=ChipBench.app.ed; ed.select(ed.length); ed.insert('\\n\\n'+ChipBench.E.tools.SNIP.pinout+'\\n\\n'+ChipBench.E.tools.SNIP.memmap+'\\n\\n'+ChipBench.E.tools.SNIP.partdecode+'\\n\\n'+ChipBench.E.tools.SNIP.chart+'\\n\\n'+ChipBench.E.tools.SNIP.structure+'\\n\\n'); ed.select(0);})()"""); await wait(1200)
            await show('pinout')
            chk('pinout widget + search highlight', await ev("!!document.querySelector('.lv-w .pins svg')")); 
            await pg.fill('.lv-w .pins input', 'CAN'); await wait(200); chk('pin function highlight', await ev("document.querySelectorAll('.lv-w .pins .pin.hit').length") == 2)
            chk('memmap widget', 'FLASH' in await ev("document.querySelector('.lv-w .mem')?.innerText||''"))
            await pg.fill('.lv-w .qry input.mono', 'R7F701A'); await wait(300); chk('part decode', 'U2A' in await ev("document.querySelector('.lv-w .pd-out')?.innerText||''"), await ev("document.querySelector('.lv-w .pd-out')?.innerText"))
            chk('chart widget', await ev("document.querySelectorAll('.lv-w .chart polyline').length") == 2)
            await show('structure')
            await pg.locator('.lv-w .dg', has_text='CAN 控制器结构').locator('[data-a=play]').click(); await wait(500)
            CANDG = "[...document.querySelectorAll('.lv-w .dg')].find(d=>((d.querySelector('.t')||{}).innerText||'')==='CAN 控制器结构')"
            chk('data-flow player', await ev("!!(" + CANDG + "||document.body).querySelector('.dg-node.flow')") and '收到一帧报文' in await ev("((" + CANDG + ")||document.body).querySelector('.dg-flow').innerText"))
            await pg.locator('.lv-w .dg', has_text='CAN 控制器结构').locator('.dg-node[data-id=flt]').click(); await wait(200)
            await pg.locator('.lv-w .dg', has_text='CAN 控制器结构').locator('[data-st=verified]').click(); await wait(500)
            chk('node verify writes status into source', 'status: verified' in await ev("ChipBench.app.ed.value") or 'status: "verified"' in await ev("ChipBench.app.ed.value"), await ev("ChipBench.app.ed.value.slice(-600)"))
            # ---------- planner
            await pg.keyboard.press('Control+Shift+t'); await pg.wait_for_selector('.fp .plan', timeout=8000); await wait(500)
            chk('planner: pool + timeline', await ev("document.querySelectorAll('.fp .pool .ptask').length")>=2 and '准备第 3 章' in await ev("document.querySelector('.fp [data-drop=\"t09:30\"]').innerText"), await ev("document.querySelector('.fp').innerText.slice(0,300)"))
            await pg.locator('.fp .pool .ptask', has_text='整理 SWC').drag_to(pg.locator('.fp [data-drop="t14:00"]')); await wait(900)
            chk('planner: drag to time slot writes ⏳ ⏰', '⏰ 14:00' in await ev("window.__FS['C:\\\\Work\\\\DFA培训\\\\章节\\\\02-SWC.md'].t") or '⏰ 14:00' in await ev("(ChipBench.app.tabs.find(t=>t.name==='02-SWC.md')||{}).text||''"))
            await pg.locator('.fp .ptask', has_text='回复样品').locator('input').click(); await wait(900)
            chk('planner: complete writes ✅', '✅' in await ev("ChipBench.app.ed.value.split('\\n').find(l=>l.includes('回复样品付款方式'))||''") or '✅' in await ev("(window.__FS['C:\\\\Work\\\\DFA培训\\\\讲稿.md']||{}).t.split('\\n').find(l=>l.includes('回复样品付款方式'))"))
            await pg.locator('.fp .ptask', has_text='准备第 3 章').locator('[data-timer]').click(); await wait(1200); chk('timer starts', await ev("!!ChipBench.plan.timer"), [errs[-3:], await ev("document.querySelectorAll('.fp [data-timer]').length"), await ev("document.querySelector('.fp .ptask.running')?.innerText")])
            await ev("ChipBench.plan.timer.start -= 120000"); await pg.locator('.fp .ptask', has_text='准备第 3 章').locator('[data-timer]').click(); await wait(600)
            chk('timer stop records session', await ev("ChipBench.plan.sessions.length")==1 and await ev("(ChipBench.plan.sessions[0].end-ChipBench.plan.sessions[0].start)/60000")>=2)
            await pg.click('.fp [data-m=week]'); await wait(400); chk('planner: week view 7 columns', await ev("document.querySelectorAll('.fp .week .col').length") == 7)
            await pg.click('.fp [data-m=review]'); await wait(400); chk('planner: time review', '本周计时' in await ev("document.querySelector('.fp').innerText"))
            await pg.click('.fp [data-x=roll]'); await wait(900); await pg.click('.fp [data-x=report]'); await wait(800)
            chk('planner: weekly report doc', '周报' in await ev("ChipBench.app.current().name") and '本周完成' in await ev("ChipBench.app.ed.value"))
            # ---------- learning: manual -> structure with mock AI
            await ev("ChipBench.openPath('C:\\\\Work\\\\DFA培训\\\\资料\\\\manual.pdf')"); await pg.wait_for_selector('.view-host:not(.hide) .pdf-page canvas', timeout=15000); await wait(500)
            await pg.click('.view-host:not(.hide) .view-tools button:has-text("生成结构图")'); await wait(400)
            await pg.fill('#ls-a', '1'); await pg.fill('#ls-b', '2'); await ev("[...document.querySelectorAll('.modal-f button')].find(b=>b.textContent==='复制提示词').click()"); await wait(500)
            chk('prompt with page markers copied for external AI', '[p.1]' in (await ev("navigator.clipboard.readText()")))
            await ev("document.querySelector('#ls-yaml').value='type: clock-tree\\ntitle: AI 时钟树\\nsource: manual.pdf\\nnodes:\\n  - {id: mosc, label: Main OSC, kind: source, freq: 20MHz, page: 1}\\n  - {id: pll, label: PLL0, kind: pll, in: mosc, mul: 24, max: 480MHz, page: 2}\\n  - {id: bad, label: 编造节点, kind: div, in: pll, div: 4, max: 999MHz, page: 2}'"); await pg.click('.modal-f .primary'); await pg.wait_for_selector('#ls-out .dg-node', timeout=15000); await wait(300)
            chk('structure generated with page-verified nodes', await ev("document.querySelectorAll('#ls-out .dg-node.doubt').length") == 1 and await ev("document.querySelectorAll('#ls-out .dg-node').length") == 3, await ev("document.querySelector('#ls-out').innerText.slice(0,200)"))
            chk('verification flags invented node (999MHz not in text)', await ev("document.querySelector('#ls-out .dg-node.doubt').textContent.includes('编造')"))
            await pg.click('#ls-out [data-c=ins]'); await wait(700); await pg.keyboard.press('Escape'); await wait(200)
            chk('structure inserted into note as clocktree block', '```clocktree' in await ev("ChipBench.app.ed ? ChipBench.app.ed.value : ''"))
            # study cards
            await ev("ChipBench.learn.study()"); await pg.wait_for_selector('.study .flash', timeout=8000); await pg.keyboard.press('Space'); await wait(200)
            chk('study: shows answer', 'Dedicated' in await ev("document.querySelector('.study').innerText"))
            await pg.click('.study [data-g="4"]'); await wait(800)
            chk('study: SM-2 state written into note', '<!-- sr:' in await ev("window.__FS['C:\\\\Work\\\\DFA培训\\\\章节\\\\01-背景.md'].t"))
            await pg.keyboard.press('Escape'); await wait(200)
            # resource card + library
            await ev("ChipBench.learn.makeCard('C:\\\\Work\\\\DFA培训\\\\资料\\\\manual.pdf')"); await wait(900)
            cp = [k for k in await ev("Object.keys(window.__FS)") if k.endswith('.card.md')]; chk('resource card created', len(cp) == 1 and 'type: card' in await ev("window.__FS[%s].t" % json.dumps(cp[0])))
            await ev("ChipBench.learn.library()"); await pg.wait_for_selector('.lib-grid .rcard', timeout=8000); chk('card library lists card', await ev("document.querySelectorAll('.lib-grid .rcard').length") == 1); await pg.keyboard.press('Escape'); await wait(200)
            # chapter notes
            await ev("window.__FS['C:\\\\Work\\\\.chipbench-placeholder']={t:''}"); await ev("ChipBench.ws.cur.settings.inbox='C:\\\\Work\\\\收件箱'"); await ev("ChipBench.openPath('C:\\\\Work\\\\DFA培训\\\\资料\\\\manual.pdf')"); await wait(500)
            await ev("void ChipBench.learn.chapterNotes()"); await wait(700); await pg.click('.modal-f .primary'); await wait(2000)
            chk('chapter notes created from bookmarks', len([k for k in await ev("Object.keys(window.__FS)") if 'Chapter' in k and k.endswith('.md')]) == 6)
            # glossary hover source
            chk('glossary from 术语表', (await ev("ChipBench.learn.glossary()")).get('PLL') == 'Phase Locked Loop')
            # init sequence + cross-chip + reg tree (pure parts already unit-tested) -> init seq command
            await ev("ChipBench.openPath('C:\\\\Work\\\\DFA培训\\\\讲稿.md')"); await wait(800)
            await ev("(()=>{const ed=ChipBench.app.ed, i=ed.value.indexOf('mosc'); ed.select(i);})()"); await ev("ChipBench.run('learn.initseq')"); await wait(500)
            chk('init sequence checklist inserted', '初始化顺序' in await ev("ChipBench.app.ed.value") and '- [ ] 1.' in await ev("ChipBench.app.ed.value"))
            chk('no console errors so far', not errs, errs[:3])
            print(json.dumps({'passed': sum(R.values()), 'total': len(R), 'fails': fails}, ensure_ascii=False))
            await b.close()
asyncio.run(main())

import sys as _sys; _sys.exit(1 if fails else 0)  # CI: non-zero exit on any failed check
