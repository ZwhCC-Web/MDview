"""ChipBench IP behaviour-rule expression language — Python mirror of app/js/ip-expr.js.  PURE: no eval, no exec, no host access.
Same grammar, same limits, same error texts and positions (mcp/test_ip23.py runs one corpus through both and demands identical results)."""
import re

MAX_LEN, MAX_DEPTH, MAX_SHIFT = 400, 48, 4096
FORBIDDEN = {"__proto__", "constructor", "prototype"}
OPS = ["<<", ">>", "<=", ">=", "==", "!=", "&&", "||", "<", ">", "+", "-", "*", "/", "%", "&", "|", "^", "!", "~", "(", ")", "."]
BIN = [["||"], ["&&"], ["|"], ["^"], ["&"], ["==", "!="], ["<", "<=", ">", ">="], ["<<", ">>"], ["+", "-"], ["*", "/", "%"]]


class ExprError(Exception):
    def __init__(self, msg, pos=-1):
        super().__init__(msg)
        self.msg = msg
        self.pos = -1 if pos is None else pos


def tokenize(src):
    if len(src) > MAX_LEN:
        raise ExprError("表达式太长（最多 %d 个字符）" % MAX_LEN, MAX_LEN)
    out, i = [], 0
    while i < len(src):
        c = src[i]
        if c in " \t\r\n":   # ASCII whitespace only (see ip-expr.js)
            i += 1
            continue
        if "0" <= c <= "9":
            m = re.match(r"(0[xX][0-9a-fA-F_]+|0[bB][01_]+|[0-9][0-9_]*)", src[i:])
            raw = m.group(0)
            nxt = src[i + len(raw): i + len(raw) + 1]
            if re.match(r"[0-9]*[A-Za-z_]", nxt) and not re.match(r"[0-9a-fA-F_]", nxt):
                raise ExprError("数字后面不能直接跟字母：" + raw + src[i + len(raw)], i)
            t = raw.replace("_", "")
            if re.fullmatch(r"0[xX]", t) or re.fullmatch(r"0[bB]", t):
                raise ExprError("数字不完整：" + raw, i)
            out.append({"k": "num", "v": int(t, 0) if t[:2].lower() in ("0x", "0b") else int(t, 10), "pos": i})
            i += len(raw)
            continue
        if re.match(r"[A-Za-z_]", c) and c.isascii():
            m = re.match(r"[A-Za-z_][A-Za-z0-9_]*", src[i:])
            out.append({"k": "name", "v": m.group(0), "pos": i})
            i += len(m.group(0))
            continue
        op = next((o for o in OPS if src.startswith(o, i)), None)
        if op:
            out.append({"k": "op", "v": op, "pos": i})
            i += len(op)
            continue
        if c == "=":
            raise ExprError("表达式里不能赋值；比较相等请用 ==", i)
        if c in "\"'":
            raise ExprError("表达式里不能有字符串", i)
        raise ExprError("不认识的字符 “%s”" % c, i)
    return out


def parse(src):
    try:
        src = "" if src is None else str(src)
        toks = tokenize(src)
        if not toks:
            raise ExprError("表达式是空的", 0)
        st = {"p": 0, "depth": 0}

        def peek():
            return toks[st["p"]] if st["p"] < len(toks) else None

        def is_op(v):
            t = peek()
            return t is not None and t["k"] == "op" and t["v"] == v

        def level(n):
            if n >= len(BIN):
                return unary()
            a = level(n + 1)
            while True:
                t = peek()
                if t is not None and t["k"] == "op" and t["v"] in BIN[n]:
                    st["p"] += 1
                    b = level(n + 1)
                    a = {"t": "bin", "op": t["v"], "a": a, "b": b}
                else:
                    return a

        def unary():
            t = peek()
            if t is not None and t["k"] == "op" and t["v"] in ("!", "~", "-"):
                st["p"] += 1
                st["depth"] += 1
                if st["depth"] > MAX_DEPTH:
                    raise ExprError("表达式嵌套太深", toks[st["p"] - 1]["pos"])
                a = unary()
                st["depth"] -= 1
                return {"t": "un", "op": t["v"], "a": a}
            return primary()

        def primary():
            t = peek()
            if t is None:
                raise ExprError("表达式在这里意外结束", len(src))
            if t["k"] == "num":
                st["p"] += 1
                return {"t": "num", "v": t["v"]}
            if t["k"] == "name":
                st["p"] += 1
                if t["v"] in FORBIDDEN:
                    raise ExprError("名字 %s 不能使用" % t["v"], t["pos"])
                if is_op("("):
                    raise ExprError("不支持函数调用：%s(…)" % t["v"], toks[st["p"]]["pos"])
                field = None
                if is_op("."):
                    st["p"] += 1
                    f = peek()
                    if f is None or f["k"] != "name":
                        raise ExprError("“.” 后面要写位域名", f["pos"] if f else len(src))
                    if f["v"] in FORBIDDEN:
                        raise ExprError("名字 %s 不能使用" % f["v"], f["pos"])
                    st["p"] += 1
                    field = f["v"]
                    if is_op("("):
                        raise ExprError("不支持函数调用：%s.%s(…)" % (t["v"], f["v"]), toks[st["p"]]["pos"])
                    if is_op("."):
                        raise ExprError("最多只能写 寄存器.位域 两级", toks[st["p"]]["pos"])
                return {"t": "ref", "name": t["v"], "field": field}
            if t["k"] == "op" and t["v"] == "(":
                st["p"] += 1
                st["depth"] += 1
                if st["depth"] > MAX_DEPTH:
                    raise ExprError("表达式嵌套太深", t["pos"])
                e = level(0)
                st["depth"] -= 1
                if not is_op(")"):
                    nx = peek()
                    raise ExprError("缺少右括号", nx["pos"] if nx else len(src))
                st["p"] += 1
                return e
            raise ExprError("这里不该出现 “%s”" % str(t["v"]), t["pos"])

        ast = level(0)
        if st["p"] < len(toks):
            raise ExprError("多余的内容：" + str(toks[st["p"]]["v"]), toks[st["p"]]["pos"])
        return {"ok": True, "ast": ast}
    except ExprError as e:
        return {"ok": False, "msg": e.msg, "pos": e.pos}


def _trunc(a, b):
    q = abs(a) // abs(b)
    return q if (a >= 0) == (b >= 0) else -q


def evaluate(ast, get):
    def ev(n):
        t = n["t"]
        if t == "num":
            return n["v"]
        if t == "ref":
            return get(n["name"], n["field"])
        if t == "un":
            a = ev(n["a"])
            return (1 if a == 0 else 0) if n["op"] == "!" else (~a if n["op"] == "~" else -a)
        op = n["op"]
        if op == "&&":
            return 1 if (ev(n["a"]) != 0 and ev(n["b"]) != 0) else 0
        if op == "||":
            return 1 if (ev(n["a"]) != 0 or ev(n["b"]) != 0) else 0
        a, b = ev(n["a"]), ev(n["b"])
        if op == "+":
            return a + b
        if op == "-":
            return a - b
        if op == "*":
            return a * b
        if op == "/":
            if b == 0:
                raise ExprError("除数为 0")
            return _trunc(a, b)
        if op == "%":
            if b == 0:
                raise ExprError("除数为 0")
            return a - b * _trunc(a, b)
        if op in ("<<", ">>"):
            if b < 0 or b > MAX_SHIFT:
                raise ExprError("移位个数要在 0 到 %d 之间" % MAX_SHIFT)
            return a << b if op == "<<" else a >> b
        if op == "&":
            return a & b
        if op == "|":
            return a | b
        if op == "^":
            return a ^ b
        return 1 if {"==": a == b, "!=": a != b, "<": a < b, "<=": a <= b, ">": a > b, ">=": a >= b}[op] else 0
    return ev(ast)


def refs(ast):
    out = []

    def w(n):
        if n["t"] == "ref":
            out.append({"name": n["name"], "field": n["field"]})
        elif n["t"] == "un":
            w(n["a"])
        elif n["t"] == "bin":
            w(n["a"])
            w(n["b"])
    w(ast)
    return out


_SET = re.compile(r"^\s*set\s+([A-Za-z_][A-Za-z0-9_]*)(?:\.([A-Za-z_][A-Za-z0-9_]*))?\s*=(?!=)\s*([\s\S]*)$")
_EMIT = re.compile(r'^\s*emit\s+"([^"\\\n]{1,120})"(?:\s+@([A-Za-z_][A-Za-z0-9_\-]*))?\s*$')


def parse_action(text):
    text = "" if text is None else str(text)
    m = _SET.match(text)
    if m:
        if m.group(1) in FORBIDDEN or (m.group(2) or "") in FORBIDDEN:
            return {"ok": False, "msg": "名字 %s 不能使用" % (m.group(1) if m.group(1) in FORBIDDEN else m.group(2)), "pos": 0}
        off = len(text) - len(m.group(3))
        r = parse(m.group(3))
        if not r["ok"]:
            return {"ok": False, "msg": r["msg"], "pos": r["pos"] + off}
        return {"ok": True, "kind": "set", "target": {"name": m.group(1), "field": m.group(2) or None}, "expr": r["ast"]}
    m = _EMIT.match(text)
    if m:
        return {"ok": True, "kind": "emit", "text": m.group(1), "node": m.group(2) or None}
    if re.match(r"^\s*emit\b", text):
        return {"ok": False, "msg": "emit 的写法：emit \"文字\" 或 emit \"文字\" @节点id（文字 1–120 个字符，不含引号）", "pos": 0}
    return {"ok": False, "msg": "不认识的动作；可用：set 名字 = 表达式 · set 寄存器.位域 = 表达式 · emit \"文字\" @节点", "pos": 0}
