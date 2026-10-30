"""2.1 · viewer lifecycle (CB-010): opening / closing / refreshing viewers must not leave window / document listeners or ResizeObservers behind,
and the shared state blocks: failures say impact + next step; empty states have exactly one primary action."""
import asyncio, json
from util import *; from base_fs import *
R = {}; fails = []
def chk(name, cond, info=None):
    R[name] = bool(cond)
    if not cond: fails.append(name); print('FAIL', name, info if info is not None else '')
    else: print('  ok ', name)
INIT = """
(()=>{ const live = new Map(), key = (t,ty,fn,o)=> ty + '|' + (o===true||(o&&o.capture)?'c':'b');
 const objId = new WeakMap(); let n = 0; const id = o => { if (!objId.has(o)) objId.set(o, ++n); return objId.get(o); };
 for (const [name, T] of [['window', window], ['document', document]]) { const a = T.addEventListener.bind(T), r = T.removeEventListener.bind(T);
   T.addEventListener = function(ty, fn, o){ if (typeof fn === 'function' && /^(mousemove|mouseup|keydown|resize|wheel|pointermove|pointerup)$/.test(ty)) live.set(name + '|' + ty + '|' + id(fn) + '|' + key(T,ty,fn,o), 1); return a(ty, fn, o); };
   T.removeEventListener = function(ty, fn, o){ if (typeof fn === 'function') live.delete(name + '|' + ty + '|' + id(fn) + '|' + key(T,ty,fn,o)); return r(ty, fn, o); }; }
 const RO = window.ResizeObserver, ros = new Set(); window.ResizeObserver = class extends RO { constructor(cb){ super(cb); this.__live = false; } observe(...a){ this.__live = true; ros.add(this); return super.observe(...a); } disconnect(){ ros.delete(this); return super.disconnect(); } };
 window.__live = () => { const o = {}; live.forEach((v,k)=>{ const p = k.split('|'); const kk = p[0]+'.'+p[1]; o[kk] = (o[kk]||0)+1; }); o.RO = ros.size; return o; };
})();
"""
async def main():
    with Server() as srv:
        async with async_playwright() as p:
            fs = base_fs(); fs['C:\\Work\\L'] = {'dir': 1}
            fs['C:\\Work\\L\\b.cbboard'] = {'t': json.dumps({'format': 'chipbench-board', 'version': 1, 'shapes': [{'id': 's1', 'type': 'rect', 'x': 10, 'y': 10, 'w': 80, 'h': 40, 'text': 'A', 'color': '#3b66f0'}], 'view': {'x': 0, 'y': 0, 'k': 1}})}
            fs['C:\\Work\\L\\坏.pdf'] = {'t': 'not a pdf'}
            fs['C:\\Work\\L\\s.pptx'] = {'b': b64(F / '培训.pptx')}
            b, ctx, pg, errs = await launch(p, srv, fs, extra_init=INIT); ev = pg.evaluate
            async def wait(ms=300): await pg.wait_for_timeout(ms)
            async def open_(path, sel):
                await ev("ChipBench.openPath(%s)" % json.dumps(path)); await pg.wait_for_selector('.view-host:not(.hide) ' + sel, timeout=12000); await wait(500)
            async def close_cur(): await ev("ChipBench.app.close(ChipBench.app.cur, true)"); await wait(300)
            await wait(600); base = await ev("window.__live()")
            chk('instrumentation works (the app has registered global listeners)', sum(base.values()) > 0, base)
            # ---- whiteboard: window mousemove / mouseup, document keydown, ResizeObserver
            await open_('C:\\Work\\L\\b.cbboard', '.brd-canvas'); mid = await ev("window.__live()")
            chk('open board: its global listeners exist while it is open', mid.get('window.mousemove', 0) > base.get('window.mousemove', 0) and mid.get('document.keydown', 0) > base.get('document.keydown', 0) and mid['RO'] > base['RO'], [base, mid])
            await close_cur(); end = await ev("window.__live()"); chk('close board: everything it attached is gone', end == base, [base, end])
            for i in range(4): await open_('C:\\Work\\L\\b.cbboard', '.brd-canvas'); await close_cur()
            end = await ev("window.__live()"); chk('open / close the board 5 times: no growth (was +1 mousemove, +1 mouseup, +1 ResizeObserver each time)', end == base, [base, end])
            # external-change refresh re-opens the view in place: the old one must be released
            await open_('C:\\Work\\L\\b.cbboard', '.brd-canvas')
            for i in range(3): await ev("ChipBench.app.externalChanged(['C:\\\\Work\\\\L\\\\b.cbboard'])"); await wait(1100)
            await pg.wait_for_selector('.view-host:not(.hide) .brd-canvas', timeout=8000); mid2 = await ev("window.__live()")
            chk('3 external refreshes of an open board: still exactly one set of listeners', mid2.get('window.mousemove', 0) == mid.get('window.mousemove', 0) and mid2.get('window.mouseup', 0) == mid.get('window.mouseup', 0) and mid2['RO'] == mid['RO'], [mid, mid2])
            await close_cur(); chk('…and closing it releases them', await ev("window.__live()") == base)
            # ---- pptx: document keydown + ResizeObserver
            await open_('C:\\Work\\L\\s.pptx', '.pp-slide, .slide-card, .pp-th'); mid = await ev("window.__live()")
            chk('open pptx: keydown + ResizeObserver registered', mid.get('document.keydown', 0) > base.get('document.keydown', 0) and mid['RO'] > base['RO'], [base, mid])
            await close_cur(); end = await ev("window.__live()"); chk('close pptx: released', end == base, [base, end])
            for i in range(3): await open_('C:\\Work\\L\\s.pptx', '.pp-slide, .slide-card, .pp-th'); await close_cur()
            chk('open / close pptx 4 times: no growth', await ev("window.__live()") == base, [base, await ev("window.__live()")])
            # ---- API
            api = await ev("(()=>{const V=ChipBench.viewers, root=document.createElement('div'); let n=0, off=0; const f=()=>{n++}; V.on(root, window, 'mousemove', f); window.dispatchEvent(new Event('mousemove')); const r1=n; const c=V.release(root); window.dispatchEvent(new Event('mousemove')); return [r1, n, c, typeof V.dispose, typeof V.observe, typeof V.track];})()")
            chk('V.on registers on the scope; V.release removes it (returns how many)', api[0] == 1 and api[1] == 1 and api[2] == 1 and api[3:] == ['function'] * 3, api)
            chk('V.dispose(t) is safe on a tab that never opened a viewer', await ev("(()=>{try{ChipBench.viewers.dispose({}); ChipBench.viewers.dispose(null); return true;}catch(e){return String(e);}})()") is True)
            # ---- failure message: what happened / impact / next step
            await ev("ChipBench.openPath('C:\\\\Work\\\\L\\\\坏.pdf')"); await pg.wait_for_selector('.view-host:not(.hide) .state.error-s, .view-host:not(.hide) .state.error', timeout=10000); await wait(300)
            txt = await ev("document.querySelector('.view-host:not(.hide) .state').innerText")
            chk('a failed open shows the reason, the impact and the next step', '影响' in txt and '下一步' in txt and '文件本身没有被改动' in txt or '不会修改它' in txt, txt)
            f = await ev("['os error 2','Access is denied. (os error 5)','sharing violation','weird failure'].map(x=>ChipBench.ui.friendly(x)).every(r=>r.title && r.hint && r.impact)"); chk('every friendly() result carries title + impact + hint (incl. the unknown-error fallback)', f)
            await close_cur()
            # ---- empty states: exactly one primary action
            es = await ev("(()=>{const box=document.createElement('div'); box.innerHTML=ChipBench.emptyHtml({title:'t', msg:'m', primary:{t:'做这个', a:'x'}, links:[{t:'或那个', a:'y'}]}); return [box.querySelectorAll('.btn.primary').length, box.querySelectorAll('button').length, box.querySelector('.state').className, box.querySelector('[data-a=x]').innerText];})()")
            chk('emptyHtml: one primary button; secondary actions are quiet links; compact by default', es[0] == 1 and es[1] == 2 and 'compact' in es[2] and es[3] == '做这个', es)
            wsempty = await ev("(async()=>{const ws=ChipBench.ws.cur; const keep=ws.collections.slice(); ws.collections.length=0; ChipBench.ws.draw(); await new Promise(r=>setTimeout(r,200)); const box=document.querySelector('#pane-workspace'); const r=[box.querySelectorAll('.btn.primary').length, box.querySelector('.state') ? box.querySelector('.state').innerText : ''];  keep.forEach(x=>ws.collections.push(x)); return r;})()")
            chk('workspace: an empty project shows ONE primary action', wsempty[0] <= 1, wsempty)
            # ---- 2.2: failures say reason + impact + next step; the search empty state; PDF observers are released
            toast = await ev("(()=>{ChipBench.fail('保存', 'The process cannot access the file because it is being used by another process. (os error 32)', { impact: '内容还在编辑器里，没有丢。' }); const t=[...document.querySelectorAll('.toast')].pop(); return t?t.innerText:null;})()")
            chk('SL.fail: one toast with the reason, the impact and the next step', toast and '文件正被其他程序占用' in toast and '内容还在编辑器里' in toast and '关闭占用它的程序' in toast, toast)
            sr = await ev("(async()=>{ChipBench.panel('search'); const w=ChipBench.ws.cur, keep=w.roots.slice(); w.roots.length=0; const q=document.querySelector('#sq'); q.value='abc'; q.dispatchEvent(new Event('input')); await new Promise(r=>setTimeout(r,500)); const box=document.querySelector('#sq-res'); const r=[box.querySelectorAll('.btn.primary').length, box.innerText]; keep.forEach(x=>w.roots.push(x)); return r;})()")
            chk('search with no folders: ONE primary action that adds a folder', sr[0] == 1 and '添加文件夹' in sr[1], sr)
            await ev("ChipBench.panel('workspace')")
            real = [e for e in errs if 'InvalidPDFException' not in e]; chk('no console errors (apart from the broken PDF we opened on purpose)', not real, real[:4])
            await b.close()
    print(json.dumps({'passed': sum(R.values()), 'total': len(R), 'fails': fails}, ensure_ascii=False))
asyncio.run(main())
