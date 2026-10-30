const X = require('../app/js/logic.js'); const W = require('../app/js/model.js'); let ok = 0, bad = 0;
const t = (n, c, x) => { if (c) ok++; else { bad++; console.log('FAIL', n, x !== undefined ? JSON.stringify(x).slice(0, 300) : ''); } };
// yaml / front matter
const y = X.yaml(`type: clock-tree\ntitle: 测试 # c\nnodes:\n  - id: mosc\n    kind: source\n    freq: 20MHz\n    page: 412\n  - {id: pll, kind: pll, in: mosc, mul: 24, div: 1, max: 480MHz}\n  - id: cpu\n    kind: div\n    in: pll\n    div: 2\n  - {id: sel, kind: mux, in: [mosc, cpu], sel: 1}\n  - {id: can, kind: gate, in: sel, enable: false}`);
t('yaml', y.type === 'clock-tree' && y.nodes.length === 5 && y.nodes[0].page === 412 && y.nodes[2].div === 2 && y.nodes[3].in[1] === 'cpu', y);
const fm = X.frontMatter('---\ntitle: A\nstatus: 调查中\ntags: [u2b, can]\n---\n# body'); t('front matter', fm.props.status === '调查中' && fm.props.tags.length === 2 && fm.body === '# body', fm);
t('setFrontProp', X.frontMatter(X.setFrontProp('---\na: 1\n---\nx', 'status', '完成')).props.status === '完成' && X.setFrontProp('x', 'a', 1).startsWith('---\na: 1'));
// clock
const c = X.clockCompute(y), f = id => c.nodes.find(n => n.id === id).freq_out; t('clock', f('pll') === 480e6 && f('cpu') === 240e6 && f('sel') === 240e6 && f('can') === 0);
const y2 = JSON.parse(JSON.stringify(y)); y2.nodes[1].mul = 30; t('over limit', X.clockCompute(y2).issues.some(i => i.kind === 'over'));
t('compareClock', X.compareClock(y, y2).filter(r => r.diff).length >= 3);
t('baud/can', X.baudError(80e6, 115200).div === 43 && X.canBitTiming(80e6, 500e3)[0].tq >= 8);
t('initSeq', X.initSeq(y).length === 5 && X.initSeq(y)[0].id === 'mosc', X.initSeq(y).map(s => s.id));
// struct
const s = X.structNormalize({ nodes: [{ id: 'a', page: 1, status: 'verified' }, { id: 'b', in: 'a' }, { id: 'c', in: ['a', 'b'], status: 'doubt' }, { id: 'd', status: 'verified' }], edges: [{ from: 'a', to: 'zz' }] });
t('struct', s.edges.length === 3 && s.stats.verified === 1 && s.stats.doubt === 1 && s.stats.unverified === 2);
const L = X.layout(s.nodes, s.edges); t('layout', L.pos.a.x < L.pos.b.x && L.pos.b.x < L.pos.c.x);
const vt = X.verifyAgainstText({ nodes: [{ id: 'x', page: 3, freq: '240MHz' }, { id: 'y', freq: '100MHz' }] }, { 3: 'max 240 MHz' }); t('verify', vt[0].ok && !vt[1].ok);
t('regTree', X.regTree({ nodes: [{ id: 'n', regs: ['CAN0.*'] }] }, [{ name: 'CAN0.CTRL' }, { name: 'UART.CTRL' }]).length === 1);
t('flow/cross', X.flowSteps({ nodes: [{ id: 'a' }], flow: [{ node: 'a', text: 'x' }, { node: 'zz' }] })[1].ok === false && X.crossChip({ nodes: [{ label: 'PLL', mul: 24 }, { label: 'X' }] }, { nodes: [{ label: 'PLL', mul: 30 }, { label: 'Y' }] }).length === 3);
// regs
const R = X.regNormalize({ name: 'CTR', width: 32, fields: [{ name: 'EN', bits: 0 }, { name: 'MODE', bits: '3:1', values: { 2: 'loopback' } }, { name: 'DIV', bits: '15:8' }] });
const dec = X.regDecode(R, 0x2A05); t('reg', dec.find(x => x.name === 'DIV').value === 0x2A && dec.find(x => x.name === 'MODE').meaning === 'loopback' && X.regEncode(R, { EN: 1, MODE: 2, DIV: 0x2A }) === 0x2A05);
t('reg overlap', X.regNormalize({ fields: [{ name: 'A', bits: '3:0' }, { name: 'B', bits: '2' }] }).issues.length > 0);
t('c header', X.parseCHeaderRegs('#define CAN_CTR_EN_Pos (0U)\n#define CAN_CTR_EN_Msk (0x1UL << CAN_CTR_EN_Pos)\n#define CAN_CTR_DIV_Pos (8U)\n#define CAN_CTR_DIV_Msk (0xFFUL << CAN_CTR_DIV_Pos)')[0].fields.find(f => f.name === 'DIV').bits === '15:8');
t('inspect/calc', X.inspectNumber('0x3F00').dec === '16128' && X.calc('0x3F<<4|0b1010').dec === '1018' && X.calc('3/4').dec === '0.75');
// map
const MAP = `Memory Configuration\n\nName             Origin             Length             Attributes\nFLASH            0x08000000         0x00010000         xr\nRAM              0x20000000         0x00002000         xrw\n*default*        0x00000000         0xffffffff\n\nLinker script and memory map\n\n.text           0x08000000     0x1200\n .text          0x08000000      0x200 build/main.o\n                0x08000000                main\n                0x08000100                helper\n .text.drv      0x08000200     0x1000 build/drv.o\n                0x08000200                drv_init\n.rodata         0x08001200      0x100\n .rodata        0x08001200      0x100 build/main.o\n.data           0x20000000       0x40 load address 0x08001300\n .data          0x20000000       0x40 build/main.o\n.bss            0x20000040      0x300\n .bss           0x20000040      0x300 build/drv.o\n.stack          0x20000300      0x100\n`;
const M = X.parseMap(MAP); t('map', M.regions.length === 2 && M.regions[0].used === 0x1300 && M.sections.length === 5 && M.symbols.length === 3 && M.issues.some(i => i.kind === 'overlap'), M.issues);
t('lookup', X.lookupAddr(M, 0x08000104).symbol === 'helper+0x4');
t('diffMaps', X.diffMaps(M, X.parseMap(MAP.replace('.text.drv      0x08000200     0x1000', '.text.drv      0x08000200     0x1800'))).some(r => r.name === 'drv.o' && r.delta === 0x800));
t('stack usage', X.parseStackUsage('a.c:10:5:main\t48\tstatic\nb.c:3:1:isr\t120\tdynamic')[0].func === 'isr');
// hex
const HEX = ':020000040800F2\n:10000000000102030405060708090A0B0C0D0E0F78\n:0400100010111213A6\n:04000005080001ED01\n:00000001FF\n'; const H = X.parseIHex(HEX);
t('ihex', H.segments.length === 1 && H.total === 20 && !H.errors.length && H.start === 0x080001ED, H.errors);
t('vector table', X.vectorTable({ segments: [{ addr: 0x100, data: new Uint8Array([1, 0, 0, 8, 5, 0, 0, 8]) }] }, 0x100, 2, [{ name: 'Reset', value: 0x08000000 }])[0].name === 'Reset');
const SR = X.parseSRec('S00F000068656C6C6F202020202000003C\nS11F00007C0802A6900100049421FFF07C6C1B787C8C23783C6000003863000026\nS9030000FC\n'); t('srec', SR.total === 28 && !SR.errors.length);
t('image diff', JSON.stringify(X.diffImages(H, X.parseIHex(HEX.replace(':0400100010111213A6', ':0400100010FF1213B0')))) === JSON.stringify([{ start: 0x08000011, end: 0x08000012 }]));
// csv / table / formulas
t('csv', X.parseCSV('a,b\n"x, y","q""z"\n1,2\n')[1][1] === 'q"z');
const T = X.evalTable('| 项 | 数量 | 单价 | 小计 |\n| --- | --: | --: | --: |\n| A | 20 | 2k | =B2*C2 |\n| B | 10 | 1.5k | =B3*C3 |\n| 合计 | =SUM(B2:B3) |  | =SUM(D2:D3) |');
t('formulas', T.rows[1][3] === '40000' && T.rows[2][3] === '15000' && T.rows[3][1] === '30' && T.rows[3][3] === '55000', T.rows);
t('formula cycle', X.evalTable('| a |\n| - |\n| =A2 |').rows[1][0] === '#ERR');
t('table fmt', X.formatMdTable('|a|b|\n|-|-|\n|1|22|').includes('| 1   | 22  |'));
// tasks/planner
const today = '2026-10-21';
const TS = X.collectTasks(`- [ ] 回复付款方式 ⏳ 2026-10-21 📅 2026-10-22 ~30m !!\n- [ ] 写培训稿 ⏳ 2026-10-21 ⏰ 09:30 ~2h\n- [ ] 昨天没做完 ⏳ 2026-10-20 ~1h\n- [ ] 无日期\n- [x] 已完成 ✅ 2026-10-21 ~45m\n\`\`\`\n- [ ] 代码里\n\`\`\``, { name: 'a.md', path: 'C:\\a.md' });
t('tasks', TS.length === 5 && TS[0].est === 30 && TS[0].pri && TS[1].time === '09:30' && TS[1].est === 120);
const PB = X.planBuckets(TS, today); t('buckets', PB.timeline.length === 1 && PB.unslotted.length === 1 && PB.pool.length === 2 && PB.minutes === 150 && PB.rollover.length === 1, PB.minutes);
t('task fields', X.setTaskField(TS[2].raw, 'plan', today) === '- [ ] 昨天没做完 ~1h ⏳ 2026-10-21' && X.setTaskDone('- [ ] a', true, today) === '- [x] a ✅ 2026-10-21' && X.setTaskDone('- [x] a ✅ 2026-10-21', false) === '- [ ] a');
t('week/review/report', X.weekBuckets(TS, today)[2].items.length === 2 && X.dayReview(TS, today).includes('已完成 · 1') && X.weekReport(TS, today).includes('第 43 周'));
const SE = [{ key: TS[0].key, start: 0, end: 45 * 60000, date: today }, { key: 'zz', start: 0, end: 15 * 60000, date: today, text: '临时', project: '样品' }];
const TR = X.timeReport(SE, TS, '2026-10-19', '2026-10-25'); t('timeReport', TR.totalMin === 60 && TR.tasks[0].act === 45 && TR.tasks[0].est === 30 && TR.byProject['样品'] === 15, TR);
// sm2 / cards / glossary / pins / part
let cd = X.sm2({}, 5, today); t('sm2', cd.interval === 1 && X.sm2(cd, 5, today).interval === 6 && X.sm2(X.sm2(cd, 5, today), 2, today).reps === 0);
const cds = X.parseCards('Q: CAN FD 位时序寄存器？ p.830\nA: DBTP\n\n问：时钟源？\n答：MOSC <!-- sr: {"ef":2.5,"interval":6,"reps":2,"due":"2026-10-25"} -->\n'); t('cards', cds.length === 2 && cds[0].page === 830 && cds[1].state.interval === 6);
t('glossary', X.extractGlossary('| DFA | Dedicated Float Accelerator |\n| --- | --- |\nPLL    Phase Locked Loop').PLL === 'Phase Locked Loop');
t('pins', X.parsePins([['Pin', 'Name', 'F1'], ['1', 'P0_0', 'CAN0TX'], ['2', 'VCC', '']]).length === 2);
t('partdecode', X.decodePart([{ name: 'U2B', prefix: 'R7F', segments: [{ len: 3, name: '系列', map: { '701': 'U2B' } }, { len: 1, name: '封装', map: { A: 'LQFP' } }] }], 'R7F701A').parts[1].meaning === 'LQFP');
// query
const docs = [{ name: 'a.md', props: { status: '调查中', customer: 'A公司', due: '2026-10-22' } }, { name: 'b.md', props: { status: '完成', customer: 'B公司', due: '2026-10-20' } }, { name: 'c.md', props: { status: '调查中', customer: 'B公司', due: '2026-10-21' } }];
t('query', X.runQuery(docs, { where: 'status = 调查中 AND customer ~ B', sort: 'due' }).length === 1 && X.runQuery(docs, { where: 'status = 完成 OR customer = A公司', sort: '-due' })[0]._doc.name === 'a.md');
// diff
t('diff', X.lineDiff('a\nb\nc', 'a\nx\nc').filter(o => o[0] !== ' ').length === 2 && X.wordDiff('CAN 时钟 20MHz', 'CAN 时钟 40MHz').some(o => o[0] === '+') && X.paraDiff('p1\n\np2', 'p1\n\np2 changed').some(o => o.kind === 'changed'));
// search
const ix = new X.SearchIndex(); ix.set('1', { title: 'U2B 手册', text: 'DFA 中断配置与时钟树 clock tree', kind: 'pdf' }); ix.set('2', { title: '笔记', text: '样品寄送流程 OCS', kind: 'md' });
t('search', ix.search('时钟树')[0].id === '1' && ix.search('ocs')[0].id === '2' && ix.search('不存在').length === 0 && (ix.remove('1'), ix.search('时钟树').length === 0));
// board
const B = X.board.create(); X.board.add(B, { type: 'rect', x: 10, y: 10, w: 100, h: 50, text: 'MCU' }); const ar = X.board.add(B, { type: 'arrow', x: 110, y: 35, x2: 200, y2: 35 }); X.board.move(ar, 5, 5);
t('board', X.board.hit(B, 50, 30).type === 'rect' && ar.x === 115 && X.board.toSvg(B).includes('<svg') && X.board.toSvg(B).includes('MCU'));
t('git parse', X.parseGitStatus(' M a.md\n?? b.md')[1].state === 'untracked' && X.parseGitLog('abc\x1f2026-10-21\x1fmsg')[0].msg === 'msg');
// ===== workspace model =====
const ws = W.create('项目A'); W.addRoot(ws, 'D:\\Projects\\DFA'); W.addRoot(ws, 'E:\\Share\\客户');
t('root overlap', !!W.addRoot(ws, 'D:\\Projects\\DFA\\sub').error && W.addRoot(ws, 'd:/projects/dfa').existed);
const g1 = W.addGroup(ws, '样品'), g2 = W.addGroup(ws, '培训');
const a = W.addRef(ws, { kind: 'file', path: 'D:\\Projects\\DFA\\章节\\02.md' }, { parentId: g1.id }).node; const b2 = W.addRef(ws, { kind: 'file', path: 'C:\\Users\\me\\Desktop\\申请.md' }, { parentId: g2.id }).node;
t('root-relative ref', a.root === ws.roots[0].id && a.rel === '章节/02.md' && !b2.root);
t('multi-membership', W.addRef(ws, { kind: 'file', path: 'D:\\Projects\\DFA\\章节\\02.md' }, { parentId: g2.id }).existed === false && W.membership(ws, 'D:\\Projects\\DFA\\章节\\02.md').join() === '样品,培训' && W.addRef(ws, { kind: 'file', path: 'd:/projects/dfa/章节/02.md' }, { parentId: g2.id }).existed === true);
t('url/search refs', W.addRef(ws, { kind: 'url', url: 'https://www.renesas.com' }).node.title === 'https://www.renesas.com' && W.addRef(ws, { kind: 'search', query: 'status = 调查中' }).node.kind === 'search');
t('rebaseRoot', (() => { W.rebaseRoot(ws, ws.roots[0].id, 'F:\\NewPlace\\DFA'); return W.refPath(ws, a) === 'F:\\NewPlace\\DFA\\章节\\02.md'; })());
t('move rules', (() => { let thr = false; try { W.move(ws, g1.id, W.addGroup(ws, '子', g1.id).id); } catch (e) { thr = true; } return thr; })());
t('copy', W.copy(ws, b2.id, g1.id).path === b2.path && W.membership(ws, b2.path).length === 2);
W.rename(ws, b2.id, '样品申请'); t('alias', W.label(b2) === '样品申请');
const keep = W.filter(ws, '申请'); t('filter', keep.size >= 1 && keep.has(b2.id));
const fx = W.relocate(ws, ['C:\\Users\\me\\Desktop\\申请.md'], ['G:\\Docs\\申请.md']); t('relocate', fx.length === 1 && b2.path === 'G:\\Docs\\申请.md');
t('rebasePrefix', W.rebasePrefix(ws, 'G:\\Docs', 'H:\\New') === 2 && b2.path === 'H:\\New\\申请.md');
const imp = W.importTree(ws, { path: 'F:\\Proj', name: 'Proj', dirs: [{ path: 'F:\\Proj\\需求', name: '需求', dirs: [], files: [{ path: 'F:\\Proj\\需求\\r1.md' }, { path: 'F:\\Proj\\需求\\x.pdf' }] }, { path: 'F:\\Proj\\空', name: '空', dirs: [], files: [{ path: 'F:\\Proj\\空\\a.png' }] }], files: [{ path: 'F:\\Proj\\R.md' }] }); t('importTree', imp.added === 2 && imp.group.children.length === 2);
W.markOpened(ws, 'D:\\x.md'); W.markOpened(ws, 'd:/x.md'); t('recent', ws.recent.length === 1);
W.setLayout(ws, [{ path: 'a.md', mode: 'live' }, null], 'a.md'); t('layout', ws.layout.tabs.length === 1);
const js = JSON.stringify(ws), v = W.validate(js); t('validate roundtrip', W.files(v).length === W.files(ws).length && v.roots.length === 2);
t('validate legacy', W.validate({ format: 'mdview-workspace', name: 'o', items: [{ type: 'group', name: 'g', children: [{ type: 'file', path: 'x.md' }] }, { type: 'folder', path: 'D:\\N' }], session: { open: ['x.md'] } }).roots.length === 1 && W.validate({ folders: [{ path: 'D:\\A' }, { path: 'D:\\B', name: 'b' }] }).roots.length === 2);
let rej = false; try { W.validate('{"x":1}'); } catch (e) { rej = true; } t('validate reject', rej);
const dp = W.duplicate(ws, '副本'); t('duplicate', dp.id !== ws.id && dp.roots[0].id !== ws.roots[0].id && W.refPath(dp, W.findRef(dp, 'F:\\NewPlace\\DFA\\章节\\02.md')) === 'F:\\NewPlace\\DFA\\章节\\02.md');
const pt = W.toPortable(ws, 'F:\\Projects'), back = W.fromPortable(JSON.parse(JSON.stringify(pt)), 'F:\\Projects'); t('portable', pt.roots[0].path.includes('..') && pt.portable && back.roots[0].path === 'F:\\NewPlace\\DFA' && W.refPath(back, W.findRef(back, 'F:\\NewPlace\\DFA\\章节\\02.md')) === 'F:\\NewPlace\\DFA\\章节\\02.md', [pt.roots[0].path, back.roots[0].path]);
t('stats', W.stats(ws).roots === 2 && W.stats(ws).files >= 4);
/* 2.2: failText — reason + impact + next step */
{ const F = X.failText;
  t('failText: locked file → plain reason, the impact, and what to do', F('保存', new Error('The process cannot access the file because it is being used by another process. (os error 32)'), { impact: '内容还在编辑器里，没有丢。' }) === '保存失败：文件正被其他程序占用。内容还在编辑器里，没有丢。关闭占用它的程序（Office、同步客户端等）后重试。', F('保存', 'os error 32', { impact: 'x。' }));
  t('failText: access denied / read-only', /没有写入权限/.test(F('保存', 'Access is denied. (os error 5)')) && /取消文件的只读属性/.test(F('保存', 'Access is denied. (os error 5)')));
  t('failText: disk full is recognised (Windows 112 and Unix 28)', /磁盘空间不足/.test(F('保存', 'There is not enough space on the disk. (os error 112)')) && /磁盘空间不足/.test(F('保存', 'No space left on device (os error 28)')));
  t('failText: not found / already exists / network / too large', /不存在/.test(F('重命名', 'os error 2')) && /同名文件已存在/.test(F('重命名', 'file already exists (os error 183)')) && /网络盘/.test(F('保存', 'operation timed out')) && /内容太大/.test(F('保存', 'file too large')));
  t('failText: an unknown error keeps a trimmed original text and a generic next step', (() => { const m = F('创建', new TypeError("Cannot read properties of undefined (reading 'x')")); return /^创建失败：/.test(m) && /Cannot read properties/.test(m) && /再试一次/.test(m) && !/TypeError/.test(m); })());
  t('failText: a very long raw error is cut (a toast must stay readable)', F('保存', 'x'.repeat(500)).length < 160);
  t('failText: no impact given → the sentence still reads (reason then next step)', F('保存', 'no space left (os error 28)') === '保存失败：磁盘空间不足。清理磁盘空间后重试。');
  t('failText: missing / empty error', /未知错误/.test(F('保存', null)) && /未知错误/.test(F('保存', '')));
  t('failText: every rule has a cause and a next step ending in a full stop', X.FAIL_RULES.every(r => r[1] && /。$/.test(r[2]))); }
console.log(ok + ' passed, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
