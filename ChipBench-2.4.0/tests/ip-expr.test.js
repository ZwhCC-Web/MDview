/* the rule expression language (2.3):  node tests/ip-expr.test.js */
const E = require('../app/js/ip-expr.js'); let ok = 0, bad = 0;
const t = (n, c, d) => { if (c) ok++; else { bad++; console.log('FAIL', n, d === undefined ? '' : JSON.stringify(d, (k, v) => typeof v === 'bigint' ? v.toString() : v)); } };
const env = { A: 5n, B: 3n, Z: 0n, 'R.F': 7n, 'R.G': 1n, BIG: 2n ** 70n }; const get = (n, f) => { const k = f ? n + '.' + f : n; return k in env ? env[k] : 0n; };
const val = s => { const r = E.parse(s); if (!r.ok) throw new Error('parse: ' + r.msg); return E.evaluate(r.ast, get); };
const eq = (s, v) => { try { return val(s) === BigInt(v); } catch (e) { return false; } };
const perr = s => { const r = E.parse(s); return r.ok ? null : r; };
const everr = s => { const r = E.parse(s); if (!r.ok) return 'parse'; try { E.evaluate(r.ast, get); return null; } catch (e) { return e.message; } };
/* arithmetic and precedence */
t('precedence: * before +', eq('1+2*3', 7)); t('parentheses', eq('(1+2)*3', 9)); t('left associativity of - and /', eq('10-3-2', 5) && eq('100/5/2', 10));
t('shifts bind looser than +', eq('1<<2+1', 8)); t('comparison looser than shifts', eq('1<<3 == 8', 1)); t('& looser than ==  (C rule): A & B == 3 is A & (B==3)', eq('A & B == 3', 1) && eq('(A & B) == 3', 0));
t('^ between & and |', eq('1|2^3&1', 3)); t('&& before ||', eq('1||0&&0', 1)); t('unary ! ~ -', eq('!A', 0) && eq('!Z', 1) && eq('~0', -1) && eq('-A', -5) && eq('--A', 5) && eq('!!A', 1));
t('comparisons give 1 / 0', eq('A>B', 1) && eq('A<B', 0) && eq('A>=5', 1) && eq('A<=4', 0) && eq('A!=B', 1) && eq('A==A', 1));
t('logical operators give 1 / 0 (not the operand)', eq('A&&B', 1) && eq('A||0', 1) && eq('Z||Z', 0));
t('&& and || short-circuit (the right side is not evaluated)', eq('Z && 1/0', 0) && eq('A || 1/0', 1) && everr('A && 1/0') === '除数为 0');
t('division truncates toward zero', eq('7/2', 3) && eq('-7/2', -3) && eq('7/-2', -3)); t('modulo has the sign of the dividend', eq('7%3', 1) && eq('-7%3', -1) && eq('7%-3', 1));
t('division / modulo by zero is a clear error', everr('1/0') === '除数为 0' && everr('1%0') === '除数为 0' && everr('A/Z') === '除数为 0');
t('shifts: left, right, arithmetic on negatives', eq('1<<4', 16) && eq('0xFF>>4', 15) && eq('-16>>2', -4) && eq('1<<64', 2n ** 64n));
t('shift count must be 0..4096', everr('1<<-1') !== null && everr('1<<4097') !== null && everr('1<<4096') === null && everr('1>>-3') !== null);
t('integers are unbounded (no silent 64-bit wrap)', eq('BIG*2', 2n ** 71n) && eq('0xFFFFFFFFFFFFFFFF+1', 2n ** 64n));
t('literals: decimal, hex, binary, underscores, case', eq('255', 255) && eq('0xff', 255) && eq('0XFF', 255) && eq('0b1010', 10) && eq('1_000_000', 1000000) && eq('0xFF_FF', 65535));
t('references: NAME and NAME.FIELD, unknown → the env decides', eq('A', 5) && eq('R.F', 7) && eq('R.F + R.G', 8) && eq('NOPE', 0));
t('whitespace is free; newlines too', eq('  1 +\n 2 ', 3));
/* errors carry a position */
for (const [s, frag, pos] of [['1 +', '意外结束', 3], ['(1+2', '右括号', 4], ['1 2', '多余', 2], ['a.b.c', '两级', 3], ['a..b', '位域名', 2], ['x = 1', '赋值', 2], ['"s"', '字符串', 0], ["'s'", '字符串', 0], ['', '空', 0], ['@', '不认识', 0], ['1 + * 2', '这里不该出现', 4]]) { const r = perr(s); t('error: ' + JSON.stringify(s) + ' → ' + frag + ' at ' + pos, r && r.msg.includes(frag) && r.pos === pos, r); }
/* it is NOT a programming language */
t('function calls are refused, and the message says so', /函数调用/.test((perr('foo(1)') || {}).msg) && /函数调用/.test((perr('A.B(2)') || {}).msg) && perr('Math.max(1,2)') !== null);
t('no member access chains, indexing, braces, semicolons, commas, ternary, backticks', ['a.b.c', 'a[1]', 'a{1}', '1;2', '1,2', 'A?1:2', '`x`', '$x', '#x', 'A=B', 'A===B', 'A&=1'].every(s => perr(s) !== null));
t('prototype-pollution names are refused as names and as fields', ['__proto__', 'constructor', 'prototype', 'A.__proto__', 'A.constructor', 'prototype.A'].every(s => perr(s) !== null));
t('keywords of other languages are just names (no meaning)', eq('true', 0) && eq('null', 0) && eq('this', 0) && eq('eval', 0) && eq('process', 0));
t('an over-long expression is refused', perr('1+'.repeat(300) + '1') !== null && /太长/.test(perr('1+'.repeat(300) + '1').msg));
t('deep nesting is refused, not a stack overflow', /嵌套/.test((perr('('.repeat(100) + '1' + ')'.repeat(100)) || {}).msg) && /嵌套/.test((perr('-'.repeat(100) + '1') || {}).msg));
t('moderate nesting is fine', eq('((((((((((1))))))))))', 1) && eq('-'.repeat(20) + '1', 1));
t('a number glued to a letter is an error (typo guard)', perr('0x') !== null && perr('12ab') !== null && perr('1 0') !== null);
t('refs(): every name and name.field the expression reads', JSON.stringify(E.refs(E.parse('R.F + A * (B - R.G) + R.F').ast)) === JSON.stringify([{ name: 'R', field: 'F' }, { name: 'A', field: null }, { name: 'B', field: null }, { name: 'R', field: 'G' }, { name: 'R', field: 'F' }]));
t('parse never throws on arbitrary bytes', (() => { for (const s of ['\u0000', '\uD800', '😀', '1+\u202E', '\t\r\n', 'a'.repeat(1000), '9'.repeat(300), '((' + '1'.repeat(10)]) { try { E.parse(s); } catch (e) { return false; } } return true; })());
t('parse is pure: the same text gives the same AST twice', JSON.stringify(E.parse('A+1').ast, (k, v) => typeof v === 'bigint' ? v.toString() : v) === JSON.stringify(E.parse('A+1').ast, (k, v) => typeof v === 'bigint' ? v.toString() : v));
t('evaluating twice with the same inputs gives the same answer (no hidden state)', val('A*B+R.F') === val('A*B+R.F') && val('A*B+R.F') === 22n);
t('only ASCII whitespace (space, tab, CR, LF) separates tokens; invisible Unicode characters are an error', eq('1\t+\r\n2', 3) && ['\ufeff1', '1\u00a0+2', '\u200b1', '\u30001', '1\u2003+2', '\u000b1', '\u000c1'].every(x => perr(x) !== null));
/* actions */
const act = s => E.parseAction(s);
t('set NAME = expr', (() => { const a = act('set CNT = CNT + 1'); return a.ok && a.kind === 'set' && a.target.name === 'CNT' && a.target.field === null && a.expr.t === 'bin'; })());
t('set REG.FIELD = expr', (() => { const a = act('  set RFSTS.RFE =  (A>B) '); return a.ok && a.target.name === 'RFSTS' && a.target.field === 'RFE'; })());
t('set with == in the value is not confused with the assignment', (() => { const a = act('set X = A == B'); return a.ok && a.expr.op === '=='; })() && act('set X == 1').ok === false);
t('emit "text"', (() => { const a = act('emit "接收 FIFO 满"'); return a.ok && a.kind === 'emit' && a.text === '接收 FIFO 满' && a.node === null; })());
t('emit "text" @node (node ids may contain - and _)', (() => { const a = act('emit "x" @rx-fifo_0'); return a.ok && a.node === 'rx-fifo_0'; })());
t('emit text limits: 1–120 chars, no quotes / backslash / newline', act('emit ""').ok === false && act('emit "' + 'x'.repeat(121) + '"').ok === false && act('emit "a"b"').ok === false && act('emit "a\\b"').ok === false && act('emit "a\nb"').ok === false && act('emit "' + 'x'.repeat(120) + '"').ok);
t('action errors point inside the expression (offset by the prefix)', (() => { const a = act('set X = 1 +'); return !a.ok && a.pos >= 'set X = '.length; })());
t('unknown actions say what is available', /不认识的动作/.test(act('delete X').msg) && /emit 的写法/.test(act('emit hello').msg) && !act('').ok && !act('set').ok && !act('set = 1').ok);
t('forbidden names are refused as targets', !act('set __proto__ = 1').ok && !act('set A.constructor = 1').ok);
t('no code can hide in an action: calls, assignments chains, semicolons', ['set X = f(1)', 'set X = 1; set Y = 2', 'set X = Y = 1', 'set X = "s"'].every(s => !act(s).ok));
console.log(ok + ' passed, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
