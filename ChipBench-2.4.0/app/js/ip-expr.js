/* ChipBench 2.3 · ip-expr.js — the tiny expression language of IP behaviour rules.  PURE: no DOM, no eval, no host objects.  Node-testable; mcp/ip_expr.py is its mirror.
   Why a language of our own: a rule comes from a person, an AI or a shared file.  It must never be able to run code, loop forever, or reach anything — so it is parsed by
   hand into a small AST and evaluated over arbitrary-precision integers.  There are no function calls, no assignment inside expressions, no strings, no properties.
   Grammar (C-like precedence, lowest first):  ||  &&  |  ^  &  == !=  < <= > >=  << >>  + -  * / %  unary(! ~ -)  primary
   primary: integer (123, 0x1F, 0b101, 1_000) | NAME | NAME.FIELD | ( expr )
   Semantics: integers are unbounded; comparisons and logical operators give 1 / 0; `/` and `%` truncate toward zero (division by zero is an error); shifts need a count 0..4096.
   Actions: `set TARGET = expr`  (TARGET: NAME | REG.FIELD)   and   `emit "text" [@node]` . */
(function (G) {
  'use strict';
  const MAX_LEN = 400, MAX_DEPTH = 48, MAX_SHIFT = 4096, NAME = /^[A-Za-z_][A-Za-z0-9_]*$/, FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
  class ExprError extends Error { constructor(msg, pos) { super(msg); this.pos = pos == null ? -1 : pos; this.code = 'expr'; } }
  const OPS = ['<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '<', '>', '+', '-', '*', '/', '%', '&', '|', '^', '!', '~', '(', ')', '.'];
  function tokenize(src) {
    if (src.length > MAX_LEN) throw new ExprError('表达式太长（最多 ' + MAX_LEN + ' 个字符）', MAX_LEN);
    const out = []; let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }   /* ASCII whitespace only: JS and Python disagree about Unicode "whitespace" (the BOM, U+180E …), and an invisible character in a rule should be an error, not silently accepted */
      if (/[0-9]/.test(c)) { const m = /^(0[xX][0-9a-fA-F_]+|0[bB][01_]+|[0-9][0-9_]*)/.exec(src.slice(i)); const raw = m[0]; if (/^[0-9]*[A-Za-z_]/.test(src.slice(i + raw.length, i + raw.length + 1)) && !/^[0-9a-fA-F_]/.test(src.slice(i + raw.length, i + raw.length + 1))) throw new ExprError('数字后面不能直接跟字母：' + raw + src[i + raw.length], i); const t = raw.replace(/_/g, ''); if (/^0[xX]$/.test(t) || /^0[bB]$/.test(t)) throw new ExprError('数字不完整：' + raw, i); let v; try { v = BigInt(t); } catch (e) { throw new ExprError('数字无效：' + raw, i); } out.push({ k: 'num', v, pos: i }); i += raw.length; continue; }
      if (/[A-Za-z_]/.test(c)) { const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i)); out.push({ k: 'name', v: m[0], pos: i }); i += m[0].length; continue; }
      const op = OPS.find(o => src.startsWith(o, i)); if (op) { out.push({ k: 'op', v: op, pos: i }); i += op.length; continue; }
      if (c === '=') throw new ExprError('表达式里不能赋值；比较相等请用 ==', i);
      if (c === '"' || c === "'") throw new ExprError('表达式里不能有字符串', i);
      throw new ExprError('不认识的字符 “' + c + '”', i);
    }
    return out;
  }
  const BIN = [['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!='], ['<', '<=', '>', '>='], ['<<', '>>'], ['+', '-'], ['*', '/', '%']];
  function parse(src) {
    try {
      src = String(src == null ? '' : src); const toks = tokenize(src); if (!toks.length) throw new ExprError('表达式是空的', 0); let p = 0, depth = 0;
      const peek = () => toks[p], isOp = v => p < toks.length && toks[p].k === 'op' && toks[p].v === v;
      const level = n => { if (n >= BIN.length) return unary(); let a = level(n + 1); while (p < toks.length && toks[p].k === 'op' && BIN[n].includes(toks[p].v)) { const op = toks[p++].v, b = level(n + 1); a = { t: 'bin', op, a, b }; } return a; };
      const unary = () => { if (p < toks.length && toks[p].k === 'op' && (toks[p].v === '!' || toks[p].v === '~' || toks[p].v === '-')) { const op = toks[p++].v; if (++depth > MAX_DEPTH) throw new ExprError('表达式嵌套太深', toks[p - 1].pos); const a = unary(); depth--; return { t: 'un', op, a }; } return primary(); };
      const primary = () => {
        const t = peek(); if (!t) throw new ExprError('表达式在这里意外结束', src.length);
        if (t.k === 'num') { p++; return { t: 'num', v: t.v }; }
        if (t.k === 'name') { p++; if (FORBIDDEN.has(t.v)) throw new ExprError('名字 ' + t.v + ' 不能使用', t.pos); if (isOp('(')) throw new ExprError('不支持函数调用：' + t.v + '(…)', toks[p].pos); let field = null; if (isOp('.')) { p++; const f = peek(); if (!f || f.k !== 'name') throw new ExprError('“.” 后面要写位域名', f ? f.pos : src.length); if (FORBIDDEN.has(f.v)) throw new ExprError('名字 ' + f.v + ' 不能使用', f.pos); p++; field = f.v; if (isOp('(')) throw new ExprError('不支持函数调用：' + t.v + '.' + f.v + '(…)', toks[p].pos); if (isOp('.')) throw new ExprError('最多只能写 寄存器.位域 两级', toks[p].pos); } return { t: 'ref', name: t.v, field }; }
        if (t.k === 'op' && t.v === '(') { p++; if (++depth > MAX_DEPTH) throw new ExprError('表达式嵌套太深', t.pos); const e = level(0); depth--; if (!isOp(')')) throw new ExprError('缺少右括号', peek() ? peek().pos : src.length); p++; return e; }
        throw new ExprError('这里不该出现 “' + (t.k === 'num' ? t.v : t.v) + '”', t.pos);
      };
      const ast = level(0); if (p < toks.length) throw new ExprError('多余的内容：' + String(toks[p].v), toks[p].pos);
      return { ok: true, ast };
    } catch (e) { if (e instanceof ExprError) return { ok: false, msg: e.message, pos: e.pos }; throw e; }
  }
  const trunc = (a, b) => a / b;   // BigInt division truncates toward zero
  function evaluate(ast, get) {
    const ev = n => {
      switch (n.t) {
        case 'num': return n.v;
        case 'ref': return get(n.name, n.field);
        case 'un': { const a = ev(n.a); return n.op === '!' ? (a === 0n ? 1n : 0n) : n.op === '~' ? ~a : -a; }
        case 'bin': {
          if (n.op === '&&') return ev(n.a) !== 0n && ev(n.b) !== 0n ? 1n : 0n; if (n.op === '||') return ev(n.a) !== 0n || ev(n.b) !== 0n ? 1n : 0n;
          const a = ev(n.a), b = ev(n.b);
          switch (n.op) {
            case '+': return a + b; case '-': return a - b; case '*': return a * b;
            case '/': if (b === 0n) throw new ExprError('除数为 0'); return trunc(a, b);
            case '%': if (b === 0n) throw new ExprError('除数为 0'); return a - b * trunc(a, b);
            case '<<': if (b < 0n || b > BigInt(MAX_SHIFT)) throw new ExprError('移位个数要在 0 到 ' + MAX_SHIFT + ' 之间'); return a << b;
            case '>>': if (b < 0n || b > BigInt(MAX_SHIFT)) throw new ExprError('移位个数要在 0 到 ' + MAX_SHIFT + ' 之间'); return a >> b;
            case '&': return a & b; case '|': return a | b; case '^': return a ^ b;
            case '==': return a === b ? 1n : 0n; case '!=': return a !== b ? 1n : 0n; case '<': return a < b ? 1n : 0n; case '<=': return a <= b ? 1n : 0n; case '>': return a > b ? 1n : 0n; case '>=': return a >= b ? 1n : 0n;
          }
        }
      }
      throw new ExprError('内部错误：未知节点');
    };
    return ev(ast);
  }
  const refs = ast => { const out = []; const w = n => { if (n.t === 'ref') out.push({ name: n.name, field: n.field }); else if (n.t === 'un') w(n.a); else if (n.t === 'bin') { w(n.a); w(n.b); } }; w(ast); return out; };
  /* actions */
  function parseAction(text) {
    text = String(text == null ? '' : text); let m;
    if ((m = /^\s*set\s+([A-Za-z_][A-Za-z0-9_]*)(?:\.([A-Za-z_][A-Za-z0-9_]*))?\s*=(?!=)\s*([\s\S]*)$/.exec(text))) {
      if (FORBIDDEN.has(m[1]) || FORBIDDEN.has(m[2] || '')) return { ok: false, msg: '名字 ' + (FORBIDDEN.has(m[1]) ? m[1] : m[2]) + ' 不能使用', pos: 0 };
      const off = text.length - m[3].length, r = parse(m[3]); if (!r.ok) return { ok: false, msg: r.msg, pos: r.pos + off }; return { ok: true, kind: 'set', target: { name: m[1], field: m[2] || null }, expr: r.ast };
    }
    if ((m = /^\s*emit\s+"([^"\\\n]{1,120})"(?:\s+@([A-Za-z_][A-Za-z0-9_\-]*))?\s*$/.exec(text))) return { ok: true, kind: 'emit', text: m[1], node: m[2] || null };
    if (/^\s*emit\b/.test(text)) return { ok: false, msg: 'emit 的写法：emit "文字" 或 emit "文字" @节点id（文字 1–120 个字符，不含引号）', pos: 0 };
    return { ok: false, msg: '不认识的动作；可用：set 名字 = 表达式 · set 寄存器.位域 = 表达式 · emit "文字" @节点', pos: 0 };
  }
  const API = { parse, evaluate, refs, parseAction, tokenize, ExprError, MAX_LEN };
  G.ChipBenchIPE = API; if (G.ChipBench) G.ChipBench.IPE = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
