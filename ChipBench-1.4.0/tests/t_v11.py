"""ChipBench 1.1 — responsive layout, context tab, PDF excerpt, AI tool calling + log + undo, secrets, node editor,
SVD import, index cache, icons, type/spacing tokens.   python tests/t_v11.py"""
import asyncio, json
from util import *; from base_fs import *
R = {}; fails = []
def chk(name, cond, info=None):
    R[name] = bool(cond); print(('  ok  ' if cond else 'FAIL ') + name, '' if cond else (info if info is not None else ''))
    if not cond: fails.append(name)
W = 'C:\\\\Work\\\\DFA培训\\\\'
NOTE = '# 时钟\\n\\n见 [[manual.pdf#p=2]] 的说明。\\n\\n- [ ] 核对 PLL ⏳ 2026-10-21 📅 2026-10-25\\n\\n```clocktree\\ntitle: 测试时钟树\\nsource: manual.pdf\\nnodes:\\n  - {id: mosc, label: Main OSC, kind: source, freq: 20MHz, page: 1}\\n  - {id: pll, label: PLL0, kind: pll, in: mosc, mul: 24, div: 1, max: 480MHz, page: 2}\\n  - {id: cpu, label: CPU, kind: div, in: pll, div: 2, max: 240MHz, page: 2}\\n```\\n'

# a fake OpenAI-compatible endpoint: 1st call -> tool calls, 2nd call -> final answer
FAKE_AI = r"""
window.__aiCalls = [];
(function(){ const real = window.fetch; window.fetch = async (u, o) => {
  if (String(u).startsWith('https://fake.ai/')) { const b = JSON.parse(o.body); window.__aiCalls.push(b);
    const toolMsgs = b.messages.filter(m => m.role === 'tool');
    let msg;
    if (!b.tools) msg = null;
    else if (toolMsgs.length === 0) msg = { role: 'assistant', content: null, tool_calls: [
      { id: 'c1', type: 'function', function: { name: 'search_workspace', arguments: JSON.stringify({ query: 'Combine' }) } },
      { id: 'c2', type: 'function', function: { name: 'calc_can_timing', arguments: JSON.stringify({ clock: '80MHz', bitrate: '500k' }) } } ] };
    else if (toolMsgs.length === 2) msg = { role: 'assistant', content: null, tool_calls: [
      { id: 'c3', type: 'function', function: { name: 'update_component', arguments: JSON.stringify({ path: 'C:\\Work\\DFA培训\\clk.md', index: 0, yaml: 'title: 测试时钟树\nsource: manual.pdf\nnodes:\n  - {id: mosc, label: Main OSC, kind: source, freq: 20MHz, page: 1, status: verified}\n  - {id: pll, label: PLL0, kind: pll, in: mosc, mul: 20, div: 1, max: 480MHz, page: 2, status: verified}\n  - {id: cpu, label: CPU, kind: div, in: pll, div: 2, max: 240MHz, page: 2}\n' }) } } ] };
    else msg = { role: 'assistant', content: '完成：PLL 倍频改为 20，CAN 位时序已算出。' };
    if (!msg) { const enc = new TextEncoder(); return new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"普通回答"}}]}\n\ndata: [DONE]\n\n')); c.close(); } }), { status: 200 }); }
    return new Response(JSON.stringify({ choices: [{ message: msg }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return real(u, o); }; })();
"""

async def main():
    with Server() as srv:
        async with async_playwright() as p:
            fs = base_fs(); fs['C:\\Work\\DFA培训\\clk.md'] = {'t': NOTE.replace('\\n', '\n')}
            b, ctx, pg, errs = await launch(p, srv, fs, 'window.__PDFTEXT=' + json.dumps(PDFTEXT) + ';' + FAKE_AI); ev = pg.evaluate
            async def wait(ms=300): await pg.wait_for_timeout(ms)
            chk('version 1.4.0', await ev("ChipBench.VERSION==='1.4.0' && ChipBench.ext && ChipBench.ext===ChipBench.s31"))
            # ---------- tokens / icons
            chk('css: type ramp + spacing tokens defined', await ev("(()=>{const s=getComputedStyle(document.documentElement); return s.getPropertyValue('--fs-sm').trim()==='12px' && s.getPropertyValue('--sp-3').trim()==='12px' && s.getPropertyValue('--fs').trim()==='16px' && s.getPropertyValue('--lh').trim()==='1.75'})()"))
            await ev("ChipBench.ws.addRootPath('C:\\\\Work')"); await wait(900)
            await ev("ChipBench.openPath('" + W + "clk.md')"); await pg.wait_for_function("ChipBench.app.current() && ChipBench.app.current().loaded"); await wait(600)
            chk('live editor: task emoji rendered as SVG icons', await ev("document.querySelectorAll('.cm-content .tki-plan').length===1 && document.querySelectorAll('.cm-content .tki-due').length===1"))
            await ev("ChipBench.app.setMode('read')"); await wait(1000)
            chk('preview: task dates use icons, no emoji glyphs', await ev("(()=>{const d=[...document.querySelectorAll('#pv-pane .due')]; return d.length===2 && d.every(x=>x.querySelector('.tki')) && !d.some(x=>/[⏳\\u{1F4C5}]/u.test(x.textContent))})()"))
            await ev("ChipBench.app.setMode('live')"); await wait(500)
            # ---------- context tab (note)
            await ev("ChipBench.run('right.ctx')"); await wait(500)
            t = await ev("document.querySelector('#right [data-tab=ctx]').innerText")
            chk('context (note): cited page + component status', 'manual.pdf' in t and 'p.2' in t and '测试时钟树' in t and '0/3 已确认' in t, t[:300])
            # ---------- node editor in clocktree widget
            await ev("ChipBench.app.setMode('read')"); await wait(1200)
            await ev("document.querySelector('#pv-pane .dg-node[data-id=\"cpu\"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))"); await wait(200)
            chk('diagram side: edit buttons', await ev("!!document.querySelector('#pv-pane .dg-side [data-ne=edit]') && !!document.querySelector('#pv-pane .dg-side [data-ne=add]')"))
            await ev("ChipBench.app.setMode('live')"); await wait(800)
            await ev("document.querySelector('.cm-content .dg-node[data-id=\"cpu\"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))"); await wait(200)
            await ev("document.querySelector('.cm-content .dg-side [data-ne=edit]').click()"); await wait(300)
            await ev("(()=>{const i=document.querySelector('.modal [data-k=div]'); i.value='4'; const l=document.querySelector('.modal [data-k=label]'); l.value='CPU 时钟'; })()")
            await ev("[...document.querySelectorAll('.modal button')].find(b=>b.textContent==='保存').click()"); await wait(500)
            v = await ev("ChipBench.app.ed.value")
            chk('node editor: writes YAML back, status reset', 'CPU 时钟' in v and 'div: 4' in v and v.count('status: unverified') >= 1, v[v.find('nodes'):][:400])
            await ev("document.querySelector('.cm-content .dg-node[data-id=\"pll\"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))"); await wait(200)
            await ev("document.querySelector('.cm-content .dg-side [data-ne=add]').click()"); await wait(300)
            await ev("(()=>{document.querySelector('.modal [data-k=id]').value='can'; document.querySelector('.modal [data-k=label]').value='CAN 时钟'; document.querySelector('.modal [data-k=div]').value='6'; })()")
            await ev("[...document.querySelectorAll('.modal button')].find(b=>b.textContent==='保存').click()"); await wait(500)
            v = await ev("ChipBench.app.ed.value")
            chk('node editor: add downstream node', 'id: can' in v and 'in: pll' in v.split('id: can')[1][:80], v[-300:])
            await ev("ChipBench.app.save(ChipBench.app.current())"); await wait(400)
            # ---------- PDF excerpt + context (pdf)
            await ev("ChipBench.openPath('" + W + "资料\\\\manual.pdf')"); await pg.wait_for_selector('.view-host:not(.hide) .pdf-page canvas', timeout=15000); await wait(800)
            ok = await ev("""(async()=>{ const span=[...document.querySelectorAll('.view-host:not(.hide) .pdf-page[data-n="1"] .textLayer span')].find(s=>s.textContent.trim().length>3); if(!span) return 'nospan'; const r=document.createRange(); r.selectNodeContents(span); const s=getSelection(); s.removeAllRanges(); s.addRange(r); document.querySelector('.view-host:not(.hide) .pdf-main').dispatchEvent(new MouseEvent('mouseup',{bubbles:true})); await new Promise(r=>setTimeout(r,60)); const b=document.querySelector('.pdf-hl:not(.hide) [data-a=ex]'); if(!b) return 'nobtn'; b.click(); return span.textContent.trim(); })()""")
            await wait(700)
            v = await ev("ChipBench.app.current().name==='clk.md' ? ChipBench.app.ed.value : 'not-switched:'+ChipBench.app.current().name")
            chk('pdf excerpt: quote + [[manual.pdf#p=1]] inserted into last note', isinstance(ok, str) and ok not in ('nospan', 'nobtn') and '[[manual.pdf#p=1]]' in v and ('> ' + ok[:6]) in v, (ok, v[-200:]))
            await ev("ChipBench.app.save(ChipBench.app.current())"); await wait(300); await ev("ChipBench.index.refreshFile && ChipBench.index.refreshFile('" + W + "clk.md')"); await wait(400)
            await ev("ChipBench.openPath('" + W + "资料\\\\manual.pdf')"); await wait(600); await ev("ChipBench.right.open('ctx')"); await wait(400)
            t = await ev("document.querySelector('#right [data-tab=ctx]').innerText")
            chk('context (pdf p.1): citing note + component nodes', 'clk' in t and 'Main OSC' in t, t[:400])
            # ---------- responsive
            await pg.set_viewport_size({'width': 960, 'height': 800}); await wait(300)
            chk('narrow (<1000): side stays docked and visible (1.2)', await ev("document.body.classList.contains('w-narrow') && getComputedStyle(document.querySelector('#side')).position!=='fixed' && document.querySelector('#side').getBoundingClientRect().width>150"))
            await ev("document.querySelector('#rail .rb[data-p=search]').click()"); await wait(400)
            chk('narrow: rail click switches panel, side still docked', await ev("!document.body.classList.contains('side-peek') && document.querySelector('#rail .rb[data-p=search]').classList.contains('on') && document.querySelector('#side').getBoundingClientRect().width>150"))
            await pg.mouse.click(450, 400); await wait(300)
            chk('narrow: clicking document does not hide side', await ev("document.querySelector('#side').getBoundingClientRect().width>150"))
            chk('narrow: right panel floats', await ev("getComputedStyle(document.querySelector('#right')).position==='fixed'"))
            await ev("ChipBench.openPath('" + W + "clk.md')"); await wait(400); await ev("ChipBench.app.setMode('split')"); await wait(600)
            chk('narrow: split stacks vertically', await ev("getComputedStyle(document.querySelector('#stage')).flexDirection==='column'"))
            await ev("ChipBench.app.setMode('live')")
            await pg.set_viewport_size({'width': 1200, 'height': 800}); await wait(300)
            chk('mid (1000–1399): right floats, side docked', await ev("document.body.classList.contains('w-mid') && getComputedStyle(document.querySelector('#right')).position==='fixed' && getComputedStyle(document.querySelector('#side')).position!=='fixed'"))
            await pg.set_viewport_size({'width': 1440, 'height': 900}); await wait(300)
            chk('wide: right docked', await ev("document.body.classList.contains('w-wide') && getComputedStyle(document.querySelector('#right')).position!=='fixed'"))
            # ---------- AI: secret storage
            await ev("ChipBench.ai.cfg.url='https://fake.ai/v1'; ChipBench.ai.cfg.key='sk-test-123'; ChipBench.ai.cfg.model='m'; ChipBench.ai.cfg.provider='openai'; ChipBench.ai.cfg.confirmWrites=true; ChipBench.ai.cfg.useTools=true")
            await ev("ChipBench.ai.save()"); await wait(200)
            chk('API key → credential store, not kv', await ev("(window.__secrets||{})['ai-key']==='sk-test-123'") and 'sk-test-123' not in (await ev("JSON.stringify(window.__kv||{})+JSON.stringify(ChipBench.store?1:0)")))
            kvv = await ev("ChipBench.store.get('ai',null).then(v=>JSON.stringify(v))")
            chk('kv settings keep no key', 'sk-test' not in kvv and '"keyInOs":true' in kvv, kvv)
            # ---------- AI: tool calling loop, confirm, log, undo
            await ev("ChipBench.run('ai.open')"); await wait(400)
            await ev("document.querySelector('#ai-ctx').checked=false; document.querySelector('#ai-t').value='把 PLL 改成 20 倍并算 CAN 位时序'; document.querySelector('#ai-send').click()"); await wait(900)
            chk('AI: write requires confirmation (diff shown)', await ev("!!document.querySelector('.modal .ai-diff') && document.querySelector('.modal .ai-diff').innerText.includes('mul: 20')"))
            await ev("[...document.querySelectorAll('.modal button')].find(b=>b.textContent==='允许写入').click()"); await wait(1200)
            calls = await ev("window.__aiCalls.length"); tl = await ev("[...document.querySelectorAll('#ai-log .ai-tool')].map(x=>x.innerText+'|'+x.className).join(' / ')")
            chk('AI: 3 round-trips with tools schema', calls == 3 and await ev("window.__aiCalls.every(c=>c.tools && c.tools.length>=15)"), (calls,))
            chk('AI: tool progress lines shown', tl.count('ok') >= 3 and '搜索工作区' in tl and '修改组件' in tl, tl)
            chk('AI: final answer rendered', '完成：PLL 倍频改为 20' in await ev("document.querySelector('#ai-log').innerText"))
            tm = await ev("JSON.stringify(window.__aiCalls[1].messages.filter(m=>m.role==='tool').map(m=>m.content))")
            chk('AI: tool results fed back (search + CAN timing)', 'clk.md' in tm or 'Combine' in tm and 'brp' in tm.lower(), tm[:300])
            v = await ev("ChipBench.app.ed.value")
            chk('AI: component updated; changed node unverified; AI cannot self-confirm', 'mul: 20' in v and v.split('id: pll')[1].split('}')[0].count('status: unverified') == 1 and 'verified' not in v.split('id: mosc')[1].split('}')[0], v[v.find('nodes'):][:500])
            await ev("ChipBench.right.open('ailog')"); await wait(300)
            lg = await ev("document.querySelector('#right [data-tab=ailog]').innerText")
            chk('AI log: lists tool calls with undo', 'update_component' in lg and '撤销此修改' in lg, lg[:300])
            await ev("document.querySelector('#right [data-undo]').click()"); await wait(300); await ev("[...document.querySelectorAll('.modal button')].find(b=>/确定|好|是|OK/.test(b.textContent)) && [...document.querySelectorAll('.modal button')].find(b=>/确定|好|是|OK/.test(b.textContent)).click()"); await wait(600)
            v = await ev("ChipBench.app.ed.value")
            chk('AI log: undo restores previous content', 'mul: 24' in v and 'mul: 20' not in v, v[v.find('id: pll'):][:120])
            # reject path
            await ev("window.__aiCalls=[]; document.querySelector('#ai-t').value='再改一次'; document.querySelector('#ai-send').click()"); await wait(900)
            await ev("[...document.querySelectorAll('.modal button')].find(b=>b.textContent==='拒绝').click()"); await wait(900)
            v = await ev("ChipBench.app.ed.value")
            rej = await ev("JSON.stringify(window.__aiCalls[2]&&window.__aiCalls[2].messages.filter(m=>m.role==='tool').slice(-1))")
            chk('AI: rejected write is not applied and reported back', 'mul: 24' in v and '拒绝' in rej, rej)
            # plain mode
            await ev("ChipBench.ai.cfg.useTools=false; window.__aiCalls=[]; document.querySelector('#ai-t').value='你好'; document.querySelector('#ai-send').click()"); await wait(800)
            chk('AI: tools off → streaming plain chat', await ev("window.__aiCalls.length===1 && !window.__aiCalls[0].tools && window.__aiCalls[0].stream===true") and '普通回答' in await ev("document.querySelector('#ai-log').innerText"))
            # direct tool checks
            r = await ev("ChipBench.wb.runTool('read_file',{path:'C:\\\\Windows\\\\win.ini'})")
            chk('AI tools: paths outside workspace rejected', 'error' in r and '工作区' in r['error'], r)
            r = await ev("ChipBench.wb.runTool('read_pdf_pages',{path:'manual.pdf',from:1,to:2})")
            chk('AI tools: read_pdf_pages', isinstance(r, dict) and r.get('pages') and len(r['pages']) == 2, str(r)[:200])
            r = await ev("ChipBench.wb.runTool('list_components',{path:'clk.md'})")
            chk('AI tools: list_components', isinstance(r, list) and r and r[0]['lang'] == 'clocktree' and r[0]['nodes'] >= 3, r)
            r = await ev("ChipBench.wb.runTool('calc_cbs',{link:'1Gbps',bandwidthPct:20})")
            chk('AI tools: calc_cbs', r.get('idleSlopeKbps') == 200000, r)
            r = await ev("ChipBench.wb.runTool('list_tasks',{})")
            chk('AI tools: list_tasks', isinstance(r, list) and any('核对 PLL' in x['text'] for x in r), str(r)[:200])
            # ---------- SVD import
            await ev("window.__pickFiles=['C:\\\\Work\\\\客户\\\\t.svd']"); await ev("ChipBench.app.ed.select(ChipBench.app.ed.length)")
            await ev("void ChipBench.run('reg.svd')"); await wait(500)
            await ev("document.querySelector('.modal .svd-list input').checked=true"); await ev("[...document.querySelectorAll('.modal button')].find(b=>b.textContent==='插入到笔记').click()"); await wait(500)
            v = await ev("ChipBench.app.ed.value")
            chk('SVD import: register blocks inserted', v.count('```register') >= 1 and 'source: t.svd' in v and 'fields:' in v.split('```register')[1], v[-400:])
            # ---------- typewriter
            await ev("ChipBench.run('view.typewriter')"); await wait(100)
            chk('typewriter mode toggles', await ev("document.body.classList.contains('typewriter') && ChipBench.prefs.typewriter===true"))
            await ev("ChipBench.run('view.typewriter')")
            # ---------- index cache persisted
            await ev("ChipBench.wb.saveIndex.flush ? ChipBench.wb.saveIndex.flush() : null"); await wait(7500)
            n = await ev("ChipBench.store.get('idx.'+ChipBench.ws.cur.id,null).then(c=>c?c.docs.length:0)")
            chk('index cache written', n >= 8, n)
            kv = await ev("JSON.stringify(window.__kvDump ? window.__kvDump() : null)")
            chk('no page errors', not [e for e in errs if 'pageerror' in e], errs[:5])
            await b.close()
        # ---------- second launch: restore index cache instantly
        async with async_playwright() as p:
            fs = base_fs()
            b, ctx, pg, errs = await launch(p, srv, fs); ev = pg.evaluate
            await ev("ChipBench.ws.addRootPath('C:\\\\Work')"); await pg.wait_for_function("ChipBench.index.docs.size>=8", timeout=20000)
            id_ = await ev("ChipBench.ws.cur.id"); docs = await ev("Array.from(ChipBench.index.docs.values()).map(d=>({...d}))")
            texts = await ev("Array.from(ChipBench.index.docs.keys()).map(k=>(ChipBench.index.search.docs.get(k)||{}).text||'')")
            await b.close()
            kv = {'idx.' + id_: json.dumps({'v': 1, 't': 1, 'docs': docs, 'texts': texts, 'pages': []}), 'workspaces': None}
            b, ctx, pg, errs = await launch(p, srv, fs); ev = pg.evaluate
            await ev("ChipBench.ws.cur.id=" + json.dumps(id_) + "; ChipBench.store.set('idx.'+" + json.dumps(id_) + ", " + kv['idx.' + id_] + ")")
            await ev("ChipBench.index.docs.clear(); ChipBench.wb.restoreIndex && (window.__r = ChipBench.wb.restoreIndex())"); await wait(300)
            chk('index cache: restore makes search instant', await ev("ChipBench.index.docs.size>=8 && ChipBench.index.runSearch('Combine').length>0"), await ev("ChipBench.index.docs.size"))
            await b.close()
    print(json.dumps({'passed': sum(R.values()), 'total': len(R), 'fails': fails}, ensure_ascii=False))
asyncio.run(main())
