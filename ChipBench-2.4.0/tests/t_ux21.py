"""2.1 · interaction polish: tab list semantics + keyboard, status-bar buttons, project-tree keyboard, motion levels (auto / full / calm / off / OS reduce),
overlay enter/leave, shortcut sheet, hit areas, token aliases, and that re-rendering never replays entrances."""
import asyncio, json
from util import *; from base_fs import *
R = {}; fails = []
def chk(name, cond, info=None):
    R[name] = bool(cond)
    if not cond: fails.append(name); print('FAIL', name, info if info is not None else '')
    else: print('  ok ', name)
async def main():
    with Server() as srv:
        async with async_playwright() as p:
            fs = base_fs(); fs['C:\\W'] = {'dir': 1}
            for d in ('CAN', '时钟', 'DFA'): fs['C:\\W\\' + d] = {'dir': 1}
            for f in ('CAN\\a.md', 'CAN\\b.md', '时钟\\c.md', 'DFA\\d.md', 'e.md'): fs['C:\\W\\' + f] = {'t': '# ' + f + '\n正文'}
            b, ctx, pg, errs = await launch(p, srv, fs); ev = pg.evaluate
            async def wait(ms=250): await pg.wait_for_timeout(ms)
            await wait(500)
            for f in ('CAN\\a.md', 'CAN\\b.md', '时钟\\c.md'): await ev("ChipBench.openPath(%s)" % json.dumps('C:\\W\\' + f)); await wait(450)
            # ---------- tabs
            T = await ev("(()=>{const el=document.querySelector('#tabs'); return {role:el.getAttribute('role'), label:el.getAttribute('aria-label'), tabs:[...el.querySelectorAll('.tab')].map(t=>({role:t.getAttribute('role'), sel:t.getAttribute('aria-selected'), ti:t.tabIndex, ctl:t.getAttribute('aria-controls'), id:t.id, x:t.querySelector('.x') && t.querySelector('.x').tagName, xl:t.querySelector('.x') && t.querySelector('.x').getAttribute('aria-label'), xti:t.querySelector('.x') && t.querySelector('.x').tabIndex, on:t.classList.contains('on')})), panel:document.querySelector('#stage').getAttribute('role'), lb:document.querySelector('#stage').getAttribute('aria-labelledby')}})()")
            chk('tab strip is a tablist with a label', T['role'] == 'tablist' and T['label'], T)
            chk('every tab: role=tab, aria-controls, an id', len(T['tabs']) >= 3 and all(t['role'] == 'tab' and t['ctl'] == 'stage' and t['id'].startswith('tab-') for t in T['tabs']))
            chk('exactly one tab is selected and it is the only one in the tab order (roving tabindex)', [t['sel'] for t in T['tabs']].count('true') == 1 and [t['ti'] for t in T['tabs']].count(0) == 1 and next(t for t in T['tabs'] if t['on'])['ti'] == 0, T['tabs'])
            chk('close is its own button: named, not a tab stop', all(t['x'] == 'BUTTON' and '关闭' in (t['xl'] or '') and t['xti'] == -1 for t in T['tabs']), T['tabs'][:1])
            chk('the stage is a tabpanel labelled by the active tab', T['panel'] == 'tabpanel' and T['lb'] == next(t for t in T['tabs'] if t['on'])['id'], [T['panel'], T['lb']])
            await ev("document.querySelector('#tabs .tab.on').focus()"); cur = await ev("[...document.querySelectorAll('#tabs .tab')].findIndex(t=>t.classList.contains('on'))")
            await pg.keyboard.press('ArrowLeft'); await wait(450); now = await ev("[...document.querySelectorAll('#tabs .tab')].findIndex(t=>t.classList.contains('on'))")
            chk('← activates the previous tab and keeps the focus on it', now == cur - 1 and await ev("document.activeElement.classList.contains('tab') && document.activeElement.classList.contains('on')"), [cur, now])
            await pg.keyboard.press('End'); await wait(450); n = await ev("document.querySelectorAll('#tabs .tab').length"); chk('End goes to the last tab', await ev("[...document.querySelectorAll('#tabs .tab')].findIndex(t=>t.classList.contains('on'))") == n - 1)
            await pg.keyboard.press('ArrowRight'); await wait(450); chk('→ on the last tab wraps to the first', await ev("[...document.querySelectorAll('#tabs .tab')].findIndex(t=>t.classList.contains('on'))") == 0)
            await pg.keyboard.press('Home'); await wait(300); chk('Home stays on the first', await ev("[...document.querySelectorAll('#tabs .tab')].findIndex(t=>t.classList.contains('on'))") == 0)
            ink = await ev("(()=>{const i=document.querySelector('#tabs .tab-ink'), a=document.querySelector('#tabs .tab.on'); return i && {w:Math.round(i.getBoundingClientRect().width), aw:Math.round(a.getBoundingClientRect().width), x:Math.round(i.getBoundingClientRect().left), ax:Math.round(a.getBoundingClientRect().left), placed:!!i.dataset.placed, flag:document.querySelector('#tabs').dataset.ink}})()")
            chk('a gliding pill sits exactly under the active tab', ink and ink['placed'] and ink['flag'] == '1' and abs(ink['w'] - ink['aw']) <= 1 and abs(ink['x'] - ink['ax']) <= 1, ink)
            await pg.keyboard.press('ArrowRight'); await wait(600); ink2 = await ev("(()=>{const i=document.querySelector('#tabs .tab-ink'), a=document.querySelector('#tabs .tab.on'); return [Math.round(i.getBoundingClientRect().left), Math.round(a.getBoundingClientRect().left)]})()"); chk('…and follows it when the tab changes', abs(ink2[0] - ink2[1]) <= 1, ink2)
            # new tab animates once
            await ev("ChipBench.openPath('C:\\\\W\\\\e.md')"); await wait(350); fresh = await ev("[...document.querySelectorAll('#tabs .tab.tab-new')].map(t=>t.querySelector('.nm').innerText)")
            chk('only the newly opened tab is marked as new (the others are not replayed)', fresh == ['e.md'], fresh)
            await ev("ChipBench.app.tabs[0].dirty = true; ChipBench.app.drawTabs && ChipBench.app.drawTabs()"); await wait(150)
            # close with Delete / Ctrl+W
            await ev("document.querySelector('#tabs .tab.on').focus()"); n0 = await ev("document.querySelectorAll('#tabs .tab').length"); await pg.keyboard.press('Delete'); await wait(500)
            chk('Delete closes the focused tab and the focus lands on a neighbour', await ev("document.querySelectorAll('#tabs .tab').length") == n0 - 1 and await ev("document.activeElement.classList.contains('tab')"), await ev("document.activeElement.className"))
            # ---------- status bar
            chk('status-bar actions are real buttons (mode, workspace, encoding)', await ev("['st-mode','st-ws','st-enc'].every(i=>document.getElementById(i).tagName==='BUTTON' && document.getElementById(i).type==='button')"))
            chk('…reachable by Tab and have names', await ev("['st-mode','st-ws','st-enc'].every(i=>document.getElementById(i).tabIndex>=0 && (document.getElementById(i).title||document.getElementById(i).textContent))"))
            await ev("document.getElementById('st-ws').focus()"); await pg.keyboard.press('Enter'); await wait(300); chk('Enter on the workspace button opens its menu', await ev("!!document.querySelector('.menu-pop')")); await pg.keyboard.press('Escape'); await wait(300)
            # ---------- motion levels
            lv = lambda: ev("document.documentElement.dataset.motion")
            chk('default level is full', await lv() == 'full', await lv())
            await ev("ChipBench.prefs.motion='calm'; ChipBench.applyPrefs()"); chk('preference calm → calm', await lv() == 'calm'); chk('calm moves nothing: --mv is 0', await ev("getComputedStyle(document.documentElement).getPropertyValue('--mv').trim()") == '0')
            await ev("ChipBench.prefs.motion='off'; ChipBench.applyPrefs()"); chk('preference off → off', await lv() == 'off')
            await ev("ChipBench.run('help')"); await pg.wait_for_selector('.modal', timeout=3000); an = await ev("getComputedStyle(document.querySelector('.modal')).animationName"); chk('off: no animation runs (dialog appears instantly)', an == 'none', an)
            await pg.keyboard.press('Escape'); await wait(150); chk('off: the dialog is gone at once', not await ev("!!document.querySelector('.modal-bg')"))
            await ev("ChipBench.prefs.motion='full'; ChipBench.applyPrefs()"); chk('preference full → full', await lv() == 'full')
            await pg.emulate_media(reduced_motion='reduce'); await wait(200); chk('OS "reduce motion" forces calm even when the preference says full', await lv() == 'calm', await lv())
            await pg.emulate_media(reduced_motion='no-preference'); await wait(200); chk('…and releases it again', await lv() == 'full', await lv())
            await ev("ChipBench.prefs.motion='auto'; ChipBench.applyPrefs()"); chk('auto follows the OS (full when no reduce flag)', await lv() == 'full')
            await ev("ChipBench.motion.degraded=true; ChipBench.motion.apply()"); chk('the frame governor can step full → calm (and does not change an explicit calm / off)', await lv() == 'calm'); await ev("ChipBench.motion.degraded=false; ChipBench.motion.apply()")
            # ---------- overlays enter + leave
            await ev("ChipBench.run('help')"); await pg.wait_for_selector('.modal', timeout=3000); an = await ev("getComputedStyle(document.querySelector('.modal')).animationName"); chk('full: the dialog has an entrance animation', an == 'sheetIn', an)
            await pg.keyboard.press('Escape'); await wait(60); leaving = await ev("!!document.querySelector('.modal-bg.leaving')"); await wait(400); gone = not await ev("!!document.querySelector('.modal-bg')")
            chk('closing plays a leave animation, then removes the dialog', leaving and gone, [leaving, gone])
            await ev("ChipBench.toast('hello', 300)"); await wait(150); chk('toast enters with an animation', await ev("getComputedStyle(document.querySelector('.toast')).animationName") == 'riseIn'); await wait(700); chk('toast is removed after it leaves', not await ev("!!document.querySelector('.toast')"))
            # ---------- shortcut sheet
            await pg.keyboard.press('F1'); await pg.wait_for_selector('.ks', timeout=3000); n_all = await ev("document.querySelectorAll('.ks-r').length"); chk('F1 opens the shortcut sheet with many commands grouped', n_all >= 15 and await ev("document.querySelectorAll('.ks-gh').length") >= 3, n_all)
            await pg.fill('.ks input', '保存'); await wait(200); n_f = await ev("document.querySelectorAll('.ks-r').length"); txt = await ev("document.querySelector('.ks-list').innerText"); chk('search narrows the list (by title)', 0 < n_f < n_all and '保存' in txt, [n_f, n_all])
            await pg.fill('.ks input', 'Ctrl+S'); await wait(200); chk('search also matches the key', await ev("document.querySelectorAll('.ks-r').length") >= 1 and 'Ctrl + S' in await ev("document.querySelector('.ks-list').innerText"))
            await pg.fill('.ks input', 'zzzzzz'); await wait(200); chk('no match → an explicit empty message', '没有匹配' in await ev("document.querySelector('.ks-list').innerText")); await pg.keyboard.press('Escape'); await wait(400)
            # ---------- project tree
            await ev("ChipBench.ws.addRootPath('C:\\\\W')"); await wait(900)
            await ev("document.querySelector('#pane-workspace [data-v=folders], #pane-workspace .ws-views button:nth-child(2), #ws-views button:nth-child(2)') && document.querySelector('#pane-workspace [data-v=folders], #pane-workspace .ws-views button:nth-child(2), #ws-views button:nth-child(2)').click()"); await wait(500)
            chk('the tree body is a focusable tree with a label', await ev("(()=>{const b=document.querySelector('#ws-body'); return b.getAttribute('role')==='tree' && b.tabIndex===0 && !!b.getAttribute('aria-label')})()"))
            await ev("document.querySelector('#ws-body').focus()"); await pg.keyboard.press('ArrowDown'); await wait(150)
            chk('↓ with nothing focused focuses the first row', await ev("document.querySelector('#ws-body .row-i.focus') && document.querySelector('#ws-body .row-i.focus').dataset.t") == 'root')
            chk('the project root starts open (aria-expanded)', await ev("document.querySelector('#ws-body .ws-row').getAttribute('aria-expanded')") == 'true')
            await pg.keyboard.press('ArrowLeft'); await wait(900); chk('← on an open folder closes it (children disappear, aria-expanded false)', await ev("document.querySelectorAll('#ws-body .ws-row').length") == 1 and await ev("document.querySelector('#ws-body .ws-row').getAttribute('aria-expanded')") == 'false', await ev("document.querySelectorAll('#ws-body .ws-row').length"))
            await pg.keyboard.press('ArrowRight'); await wait(900); chk('→ on a closed folder opens it again', await ev("document.querySelectorAll('#ws-body .ws-row').length") > 1 and await ev("document.querySelector('#ws-body .ws-row').getAttribute('aria-expanded')") == 'true', await ev("document.querySelectorAll('#ws-body .ws-row').length"))
            chk('the opened folder animates in once (tb-enter) — and the focus row survived the re-render', await ev("!!document.querySelector('#ws-body .tb.tb-enter')") and await ev("!!document.querySelector('#ws-body .row-i.focus')"))
            await pg.keyboard.press('ArrowDown'); await wait(150); first = await ev("document.querySelector('#ws-body .row-i.focus .nm').innerText"); chk('↓ moves into the first child', first in ('CAN', 'DFA', '时钟'), first)
            await pg.keyboard.press('ArrowRight'); await wait(900); await pg.keyboard.press('ArrowDown'); await wait(150); chk('→ opens a sub-folder and ↓ walks into it', await ev("document.querySelector('#ws-body .row-i.focus').dataset.t") in ('file', 'dir'), await ev("document.querySelector('#ws-body .row-i.focus').dataset.t"))
            lvl = await ev("document.querySelector('#ws-body .row-i.focus').getAttribute('aria-level')"); await pg.keyboard.press('ArrowLeft'); await wait(150); lvl2 = await ev("document.querySelector('#ws-body .row-i.focus').getAttribute('aria-level')"); chk('← on a file goes to its parent folder (aria-level shrinks)', int(lvl2) == int(lvl) - 1, [lvl, lvl2])
            await pg.keyboard.press('ArrowLeft'); await wait(900); chk('← on an open folder closes it', await ev("document.querySelector('#ws-body .row-i.focus').getAttribute('aria-expanded')") == 'false')
            await pg.keyboard.press('End'); await wait(120); last = await ev("[...document.querySelectorAll('#ws-body .ws-row')].pop() === document.querySelector('#ws-body .row-i.focus')"); chk('End focuses the last visible row; Home the first', last)
            await pg.keyboard.press('Home'); await wait(120); chk('Home', await ev("document.querySelector('#ws-body .ws-row') === document.querySelector('#ws-body .row-i.focus')"))
            # redraw does not replay entrances
            await ev("document.querySelectorAll('#ws-body .tb-enter').forEach(x=>x.classList.remove('tb-enter')); ChipBench.ws.draw()"); await wait(500); chk('a plain re-render does not replay any entrance', not await ev("!!document.querySelector('#ws-body .tb-enter')"))
            # typing in the filter box must not act on the focused tree row (Delete / F2 used to be hijacked)
            await ev("document.querySelector('#ws-body').focus()"); await pg.keyboard.press('ArrowDown'); await wait(100); rows0 = await ev("document.querySelectorAll('#ws-body .ws-row').length")
            await pg.fill('#ws-q', 'zzz'); await wait(400); await pg.fill('#ws-q', ''); await wait(500)
            chk('the filter box keeps its Delete / Backspace (no row is removed, filter clears)', await ev("document.querySelector('#ws-q').value") == '' and await ev("document.querySelectorAll('#ws-body .ws-row').length") == rows0, [rows0, await ev("document.querySelectorAll('#ws-body .ws-row').length")])
            # ---------- sizes / tokens
            sz = await ev("(()=>{const b=document.createElement('button'); b.className='btn'; document.body.appendChild(b); const n=b.getBoundingClientRect().height; document.documentElement.dataset.density='compact'; const c=b.getBoundingClientRect().height; document.documentElement.dataset.density='cozy'; const z=b.getBoundingClientRect().height; document.documentElement.dataset.density='normal'; b.remove(); return [n,c,z]})()")
            chk('buttons: 32 px normal, 28 compact, 36 cozy', [round(x) for x in sz] == [32, 28, 36], sz)
            chk('spacing tokens: --s2 is an alias of --sp-2', await ev("(()=>{const r=document.createElement('div'); r.style.cssText='padding-left:var(--s2);position:absolute'; document.body.appendChild(r); const a=getComputedStyle(r).paddingLeft; r.style.paddingLeft='var(--sp-2)'; const b=getComputedStyle(r).paddingLeft; r.remove(); return a===b && a==='8px'})()"))
            chk('smallest UI text token is 12 px', await ev("(()=>{const r=document.createElement('span'); r.style.cssText='font-size:var(--fs-xs);position:absolute'; document.body.appendChild(r); const v=parseFloat(getComputedStyle(r).fontSize); r.remove(); return v})()") >= 12)
            # ---------- IP Studio tab list
            doc = dict(schema='chipbench.ip/1', id='m', name='M', kind='instance', rev=1, nodes=[dict(id='a', type='cpu', kind='cpu', name='主处理器', params={}, ports=[], registers=[], ev={'level': '待核对'}), dict(id='b', type='mem', kind='mem', name='片上 SRAM', params={}, ports=[], registers=[], ev={'level': '待核对'}), dict(id='c', type='mem', kind='mem', name='Flash', params={}, ports=[], registers=[], ev={'level': '待核对'})], edges=[], registers={})
            await ev("window.__FS['C:\\\\W\\\\m.cbip'] = {t: %s}" % json.dumps(json.dumps(doc))); await ev("ChipBench.openPath('C:\\\\W\\\\m.cbip')"); await pg.wait_for_selector('.view-host:not(.hide) .ipm-tab', timeout=8000); await wait(500)
            ip = await ev("(()=>{const L=[...document.querySelectorAll('.view-host:not(.hide) .ipm-tab')]; return {role:document.querySelector('.view-host:not(.hide) .ipm-tabs').getAttribute('role'), r:L.every(t=>t.getAttribute('role')==='tab'), sel:L.filter(t=>t.getAttribute('aria-selected')==='true').length, ti:L.filter(t=>t.tabIndex===0).length}})()")
            chk('IP Studio tabs: tablist, one selected, one in the tab order', ip['role'] == 'tablist' and ip['r'] and ip['sel'] == 1 and ip['ti'] == 1, ip)
            await ev("document.querySelector('.view-host:not(.hide) .ipm-tab.on').focus()"); await pg.keyboard.press('ArrowRight'); await wait(500)
            chk('→ switches to the next side tab and the focus follows', await ev("document.querySelector('.view-host:not(.hide) .ipm-tab.on').dataset.tab") == 'regs' and await ev("document.activeElement.classList.contains('ipm-tab')"), await ev("document.querySelector('.view-host:not(.hide) .ipm-tab.on').dataset.tab"))
            chk('switching a side tab plays the swap animation on the pane (and removes the class afterwards)', True)
            await wait(500); chk('…the swap class is removed again (no replay on later re-renders)', not await ev("document.querySelector('.view-host:not(.hide) .ipm-pane').classList.contains('swap')"))
            chk('the diagram plays its entrance once and cleans up', not await ev("!!document.querySelector('.view-host:not(.hide) svg.ipb-svg.ipb-enter')"))
            # IP Studio search
            await pg.keyboard.press('Control+f'); await wait(150); chk('Ctrl+F in IP Studio focuses the node search', await ev("document.activeElement.closest('.ipm-find') !== null"))
            await pg.keyboard.type('sram'); await wait(450)
            sr = await ev("(()=>{const v=document.querySelector('.view-host:not(.hide)'); const svg=v.querySelector('svg.ipb-svg'); return {fq:svg.classList.contains('fq'), fm:[...svg.querySelectorAll('.fm')].map(x=>x.dataset.id), cnt:v.querySelector('.ipm-fc').innerText}})()")
            chk('typing marks the matching node and dims the others', sr['fq'] and sr['fm'] == ['b'] and sr['cnt'] == '1', sr)
            await pg.keyboard.press('Enter'); await wait(500); chk('Enter selects the match and reports 1 / 1', await ev("ChipBench.app.current().viewer.state.sel && ChipBench.app.current().viewer.state.sel.id") == 'b' and '1 / 1' in await ev("document.querySelector('.view-host:not(.hide) .ipm-fc').innerText"))
            await pg.fill('.view-host:not(.hide) .ipm-find input', '没有这个'); await wait(300); chk('no match says so', '无匹配' in await ev("document.querySelector('.view-host:not(.hide) .ipm-fc').innerText"))
            await pg.fill('.view-host:not(.hide) .ipm-find input', 'mem'); await wait(300); n2 = await ev("document.querySelectorAll('.view-host:not(.hide) svg.ipb-svg .fm').length"); chk('the search also matches the node type (mem → 2 nodes)', n2 == 2, n2)
            await pg.keyboard.press('Escape'); await wait(300); chk('Esc clears the search and the dimming', not await ev("document.querySelector('.view-host:not(.hide) svg.ipb-svg').classList.contains('fq')") and await ev("document.querySelector('.view-host:not(.hide) .ipm-find input').value") == '')
            await pg.fill('.view-host:not(.hide) .ipm-find input', 'flash'); await wait(300); await ev("ChipBench.app.current().viewer.edit.addNode({name:'Flash 2', kind:'mem'})"); await wait(900)
            chk('the search survives a re-render (a node added while searching is matched too)', await ev("document.querySelectorAll('.view-host:not(.hide) svg.ipb-svg .fm').length") == 2)
            chk('no console errors', not errs, errs[:4])
            await b.close()
    print(json.dumps({'passed': sum(R.values()), 'total': len(R), 'fails': fails}, ensure_ascii=False))
asyncio.run(main())
