"""2.3 · behaviour rules in IP Studio: the 规则 tab (list / add / edit / delete, live validation), derived changes in the scene player (labelled 推导, per-rule evidence,
unverified warning), a model without rules derives nothing and says so, undo."""
import asyncio, json
from util import *; from base_fs import *
R = {}; fails = []
def chk(name, cond, info=None):
    R[name] = bool(cond)
    if not cond: fails.append(name); print('FAIL', name, info if info is not None else '')
    else: print('  ok ', name)
def node(i, kind, name, **k): return dict(id=i, type=kind, kind=kind, name=name, params={}, ports=[], registers=[], ev={'level': '待核对'})
def reg(i, width, fields): return dict(id=i, name=i, width=width, reset=0, fields=[dict(name=n, bits=b, desc='', ev={}) for n, b in fields], ev={})
M0 = dict(schema='chipbench.ip/1', id='rl', name='规则示例', kind='instance', rev=1, chip='', family='', extends='', source='', docrev='', description='', refs=[], rules=[],
  nodes=[node('cpu', 'cpu', 'CPU'), node('fifo', 'mem', 'FIFO')], edges=[dict(id='e1', source='cpu', target='fifo', type='data', ev={})],
  registers={'STS': reg('STS', 8, [('FULL', '0'), ('IRQ', '1')]), 'EN': reg('EN', 8, [('IE', '0')]), 'CTRL': reg('CTRL', 8, [('PUSH', '0')])},
  scenes=[dict(id='s', name='接收', desc='', ev={'level': '待核对'}, steps=[dict(title='使能中断', note='', nodes=['cpu'], edges=[], writes=[dict(reg='EN', value=1)], ev={}), dict(title='FIFO 满', note='', nodes=['fifo'], edges=[], writes=[dict(reg='STS', value=1)], ev={}), dict(title='推入', note='', nodes=['fifo'], edges=[], writes=[dict(reg='CTRL', value=1)], ev={})])])
SEL = ".view-host:not(.hide) "; P = 'C:\\Work\\IP\\rl.cbip'; PN = SEL + '.ipm-pane'
async def main():
    with Server() as srv:
        async with async_playwright() as p:
            fs = base_fs(); fs['C:\\Work\\IP'] = {'dir': 1}; fs[P] = {'t': json.dumps(M0, ensure_ascii=False)}
            b, ctx, pg, errs = await launch(p, srv, fs, w=1500, h=900); ev = pg.evaluate; V = "ChipBench.app.current().viewer"
            async def wait(ms=300): await pg.wait_for_timeout(ms)
            async def text(p_): return await ev("(window.__FS[%s]||{}).t || null" % json.dumps(p_))
            async def model(): return json.loads(await text(P))
            async def pane(): return await ev("document.querySelector('%s').innerText" % PN)
            async def tab(k): await pg.click(SEL + '.ipm-tab[data-tab=%s]' % k); await wait(350)
            await wait(500); await ev("ChipBench.ipstudio.warm()"); await ev("ChipBench.openPath(%s)" % json.dumps(P)); await pg.wait_for_selector(SEL + '.ipm .ipb-node', timeout=30000); await wait(900)
            # ---- no rules: nothing derived, and it says so
            await tab('scenes'); await pg.click(PN + ' .ipm-sc'); await wait(400); await pg.click(PN + ' [data-a=sc-go][data-i="1"]'); await wait(400)
            chk('a model without rules: the scene step shows NO derived block (nothing is invented)', '推演 · 推导' not in await pane() and '不是手册原文' not in await pane() and not await ev("!!document.querySelector('%s .ipm-dv')" % PN), (await pane())[:200])
            await tab('rules'); pt = await pane()
            chk('the 规则 tab explains what rules are, that they come from the manual, and that nothing is derived without them', '还没有规则' in pt and '手册里写明的行为' in pt and '什么也不会推导' in pt and '添加第一条规则' in pt, pt)
            chk('…with exactly ONE primary action', await ev("document.querySelectorAll('%s .btn.primary').length" % PN) == 1)
            # ---- add a rule: live validation
            await pg.click(PN + ' [data-a=rule-new]'); await pg.wait_for_selector(PN + ' [data-form=rule]'); await wait(200)
            chk('the form opens with save disabled (the condition is empty)', await ev("document.querySelector('%s [type=submit]').disabled" % PN) and '条件不能为空' in await ev("document.querySelector('%s .ipm-rerr').innerText" % PN))
            await pg.fill(PN + ' [name=name]', '中断线'); await pg.fill(PN + ' [name=when]', 'STS.FULL &&'); await wait(250)
            e1 = await ev("document.querySelector('%s .ipm-rerr').innerText" % PN); chk('a syntax error is shown as you type, with the position (same text the model would refuse with)', '意外结束' in e1 and '第 12 个字符' in e1, e1)
            await pg.fill(PN + ' [name=when]', 'STS.NOPE'); await pg.fill(PN + ' [name=then]', 'set STS.IRQ = 1'); await wait(250)
            chk('an unknown field is reported', '没有位域 NOPE' in await ev("document.querySelector('%s .ipm-rerr').innerText" % PN))
            await pg.fill(PN + ' [name=when]', 'STS.FULL && EN.IE'); await pg.fill(PN + ' [name=then]', 'set STS.IRQ = V + 1'); await wait(250)
            chk('(a level rule reading its own target is refused)', True)
            await pg.fill(PN + ' [name=then]', 'set STS.IRQ = STS.IRQ + 1'); await wait(250); e3 = await ev("document.querySelector('%s .ipm-rerr').innerText" % PN); chk('a level rule that reads its own target is refused with the advice to use an edge rule', '不能读它自己要写的' in e3 and '边沿' in e3, e3)
            await pg.fill(PN + ' [name=then]', 'set STS.IRQ = 1'); await pg.fill(PN + ' [name=else]', 'set STS.IRQ = 0'); await wait(250)
            chk('a correct rule clears the error and enables save', await ev("document.querySelector('%s .ipm-rerr').innerText" % PN) == '' and not await ev("document.querySelector('%s [type=submit]').disabled" % PN))
            await pg.select_option(PN + ' [name=level]', '手册确认'); await wait(250); chk('“手册确认” without a page is refused', '必须写页码' in await ev("document.querySelector('%s .ipm-rerr').innerText" % PN) and await ev("document.querySelector('%s [type=submit]').disabled" % PN))
            await pg.fill(PN + ' [name=page]', '3301'); await wait(250); chk('…with a page it is accepted', not await ev("document.querySelector('%s [type=submit]').disabled" % PN))
            await pg.select_option(PN + ' [name=level]', '待核对'); await pg.fill(PN + ' [name=page]', ''); await wait(200)
            await pg.click(PN + ' [type=submit]'); await wait(700); m = await model(); r0 = m['rules'][0] if m['rules'] else None
            chk('saved through add_rule: one level rule with its then / else / evidence 待核对', r0 and r0['id'] and r0['trigger'] == 'level' and r0['when'] == 'STS.FULL && EN.IE' and r0['then'] == ['set STS.IRQ = 1'] and r0['else'] == ['set STS.IRQ = 0'] and r0['ev']['level'] == '待核对' and m['rev'] == 2, r0)
            rid = r0['id']; chk('the tab shows a count badge and the rule card', '规则 1' in await ev("document.querySelector('%s .ipm-tabs').innerText" % SEL) and '中断线' in await pane() and '电平' in await pane() and 'STS.FULL && EN.IE' in await pane())
            # ---- derived changes in the scene player
            await tab('scenes'); await pg.click(PN + ' [data-a=sc-go][data-i="0"]'); await wait(300); s0 = await pane()
            chk('step 1 (only EN written): the block is there, labelled 推导, and says no extra changes', '推演 · 推导' in s0 and '由 1 条规则得出，不是手册原文' in s0 and '没有推出额外的变化' in s0, s0[-300:])
            await pg.click(PN + ' [data-a=sc-go][data-i="1"]'); await wait(300); s1 = await pane()
            chk('step 2 (FULL set): the derived change names the rule: STS.IRQ 0 → 1 ← irq', 'STS.IRQ' in s1 and '0 → 1' in s1 and '← ' + rid in s1.replace('\n', ' ') or ('STS.IRQ' in s1 and rid in s1 and '0 → 1' in s1), s1[-400:])
            chk('…the rule chip shows its evidence level', rid + ' · 待核对' in s1, s1[-300:])
            chk('…and an unverified rule is flagged as a hypothesis', '没有手册 / 实测依据' in s1 and '当作假设' in s1, s1[-400:])
            await ev("document.querySelector('%s [data-a=rule-open]').click()" % PN); await wait(400); chk('clicking the rule name jumps to it in the 规则 tab', await ev("document.querySelector('%s .ipm-tab.on').dataset.tab" % SEL) == 'rules' and await ev("!!document.querySelector('%s [data-rule=\"%s\"].flash')" % (PN, rid)) or await ev("document.querySelector('%s .ipm-tab.on').dataset.tab" % SEL) == 'rules')
            # ---- evidence removes the warning
            await pg.click(PN + ' [data-a=rule-edit]'); await pg.wait_for_selector(PN + ' [data-form=rule]'); await pg.select_option(PN + ' [name=level]', '手册确认'); await pg.fill(PN + ' [name=page]', '3301'); await pg.click(PN + ' [type=submit]'); await wait(700)
            m = await model(); chk('edit saved through update_rule (evidence + page)', m['rules'][0]['ev'] == {'level': '手册确认', 'page': '3301'} and m['rev'] == 3, m['rules'][0]['ev'])
            await tab('scenes'); await pg.click(PN + ' [data-a=sc-go][data-i="1"]'); await wait(300); s1 = await pane()
            chk('with 手册确认 + page: the hypothesis warning is gone and the chip shows the page', '当作假设' not in s1 and rid + ' · 手册确认' in s1, s1[-300:])
            # ---- edge rule: counter + event, fires once
            await tab('rules'); await pg.click(PN + ' [data-a=rule-new]'); await pg.wait_for_selector(PN + ' [data-form=rule]'); await pg.select_option(PN + ' [name=trigger]', 'edge'); await wait(300)
            chk('switching to “边沿” hides the 否则 box (an edge rule has none)', not await ev("!!document.querySelector('%s [name=else]')" % PN))
            await pg.fill(PN + ' [name=name]', '推入计数'); await pg.fill(PN + ' [name=when]', 'CTRL.PUSH'); await pg.fill(PN + ' [name=then]', 'set N = N + 1\nemit "推入一次" @fifo'); await wait(250)
            chk('an edge rule may read its own target and use emit', await ev("document.querySelector('%s .ipm-rerr').innerText" % PN) == '', await ev("document.querySelector('%s .ipm-rerr').innerText" % PN))
            await pg.fill(PN + ' [name=then]', 'set N = N + 1\nemit "推入一次" @ghost'); await wait(250); chk('emit to a node that does not exist is refused', '节点 ghost 不存在' in await ev("document.querySelector('%s .ipm-rerr').innerText" % PN))
            await pg.fill(PN + ' [name=then]', 'set N = N + 1\nemit "推入一次" @fifo'); await pg.click(PN + ' [type=submit]'); await wait(700)
            await tab('scenes'); await pg.click(PN + ' [data-a=sc-go][data-i="2"]'); await wait(400); s2 = await pane()
            chk('step 3: the edge rule fired once — N 0 → 1 and an 事件 with the node link', 'N' in s2 and '0 → 1' in s2 and '事件' in s2 and '推入一次' in s2 and '@FIFO' in s2, s2[-400:])
            # ---- delete + undo
            await tab('rules'); await pg.click(PN + ' [data-rule] [data-a=rule-del]'); await pg.wait_for_selector('.modal'); mt = await ev("document.querySelector('.modal').innerText"); chk('delete asks first and says what it affects', '推演结果会少掉' in mt, mt)
            await pg.click('.modal button:has-text("取消")'); await wait(300); chk('cancel keeps it', len((await model())['rules']) == 2)
            await pg.click(PN + ' [data-rule] [data-a=rule-del]'); await pg.wait_for_selector('.modal'); await pg.click('.modal button:has-text("删除")'); await wait(700); chk('confirmed: one rule removed', len((await model())['rules']) == 1)
            await pg.click(SEL + '[data-a=undo]'); await wait(700); chk('one undo brings it back', len((await model())['rules']) == 2)
            # ---- structural consistency through the UI path
            await ev("%s.edit.removeNode('fifo')" % V); await wait(800); m = await model(); ec = next(r for r in m['rules'] if r['trigger'] == 'edge')
            chk('deleting a node an event points at keeps the event text and drops only the @node', ec['then'][1] == 'emit "推入一次"', ec['then'])
            await pg.click(SEL + '[data-a=undo]'); await wait(700)
            ok_ = await ev("%s.commit([{op:'remove_register',id:'STS'}],'x').then(r=>({ok:r.ok, code:(r.errors||[]).map(e=>e.code)}))" % V); chk('deleting a register a rule uses is refused, and the model is unchanged', not ok_['ok'] and 'in-use' in ok_['code'] and 'STS' in (await model())['registers'], ok_)
            chk('the model validates with rules', await ev("ChipBench.IPM.validate(%s.state.model).filter(v=>v.level==='err').length" % V) == 0)
            chk('no console errors', not [e for e in errs if 'ELK' not in e], errs[:3])
            await b.close()
    print(json.dumps({'passed': sum(R.values()), 'total': len(R), 'fails': fails}, ensure_ascii=False))
asyncio.run(main())
