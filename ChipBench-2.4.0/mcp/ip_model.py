"""ChipBench IP model (.cbip) — Python mirror of app/js/ip-model.js.  Pure: no I/O.
mcp/test_ip18.py runs the same scenarios through both implementations and compares the results, so the two stay in step.

Every change to a model is an OP (plain dict).  apply() is atomic: any failing op -> nothing changes.
Templates describe STRUCTURE only; a model never invents hardware facts."""
import copy
import json
import re

import ip_expr as IPE

SCHEMA = "chipbench.ip/1"
LAYOUT_SCHEMA = "chipbench.ip.layout/1"
PROPOSAL_SCHEMA = "chipbench.ip.proposal/1"
ID_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_\-]*$")
# the names of everything a JS object inherits — reserved in BOTH implementations (see RESERVED in app/js/ip-model.js) so that they make the same decisions
RESERVED = frozenset({"__proto__", "constructor", "prototype", "toString", "valueOf", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString", "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__"})
KINDS = ["cpu", "bus", "mem", "dma", "periph", "logic", "io", "clock", "irq", "ext", "analog", "group"]
PORT_TYPES = ["clock", "reset", "irq", "data", "bus", "ctrl", "dma", "io"]
DIRS = ["in", "out", "inout"]
EV_LEVELS = ["手册确认", "实测", "推导", "示意", "待核对"]
MODEL_KINDS = ["instance", "template", "family"]
LKIND = {"clock": "clock", "reset": "ctrl", "irq": "irq", "data": "data", "bus": "bus", "ctrl": "ctrl", "dma": "dma", "io": "data"}


class IpErr(Exception):
    def __init__(self, code, msg):
        super().__init__(msg)
        self.code = code
        self.msg = msg


def E(code, msg):
    raise IpErr(code, msg)


def clone(o):
    return copy.deepcopy(o)


def is_obj(v):
    return isinstance(v, dict)


def is_id(s):
    return isinstance(s, str) and bool(ID_RE.match(s)) and s not in RESERVED


def _s(v):
    """JS String(v), including the containers: [1,[2,3],null] -> "1,2,3,"  and  {} -> "[object Object]"  (the two implementations must make the same decisions on junk input)"""
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    if isinstance(v, list):
        return ",".join("" if x is None else _s(x) for x in v)
    if isinstance(v, dict):
        return "[object Object]"
    return str(v)


def _int(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and float(v).is_integer()


def parse_pages(v):
    if v is None or v == "":
        return []
    out = []
    parts = re.split(r"[,;，、\s]+", ",".join(_s(i) for i in (v if isinstance(v, list) else [v])))
    for part in [p for p in parts if p]:
        m = re.fullmatch(r"(\d+)(?:-(\d+))?", part)
        if not m:
            return None
        a = int(m.group(1))
        b = int(m.group(2)) if m.group(2) else a
        if b < a or b - a > 200:
            return None
        out += list(range(a, b + 1))
    return sorted(set(out))


def parse_bits(b):
    s = ("" if b is None else _s(b)).strip()
    m = re.fullmatch(r"(\d+)\s*:\s*(\d+)", s)
    if m:
        hi, lo = int(m.group(1)), int(m.group(2))
        return (hi, lo) if hi >= lo else None
    m = re.fullmatch(r"(\d+)", s)
    return (int(m.group(1)), int(m.group(1))) if m else None


def to_int(v):
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return int(v) if _int(v) else None
    s = str(v).strip()
    if re.fullmatch(r"0[xX][0-9a-fA-F_]+", s):
        return int(s.replace("_", ""), 16)
    return int(s) if re.fullmatch(r"-?\d+", s) else None


def ev_of(o, default=None):
    if o is None:
        o = {}
    if not is_obj(o):
        E("bad-ev", "依据必须是对象")
    r = {}
    lv = o["level"] if o.get("level") is not None else (o["ev"] if o.get("ev") is not None else default)
    if lv is not None and lv != "":
        if lv not in EV_LEVELS:
            E("bad-ev", "依据等级 “%s” 无效（%s）" % (lv, " / ".join(EV_LEVELS)))
        r["level"] = lv
    if o.get("page") is not None and o.get("page") != "":
        if parse_pages(o["page"]) is None:
            E("bad-ev", "页码 “%s” 格式不对（应为 123 或 12-14）" % _s(o["page"]))
        r["page"] = o["page"]
    if o.get("sec") is not None and o.get("sec") != "":
        r["sec"] = _s(o["sec"])
    if o.get("cond") is not None and o.get("cond") != "":
        r["cond"] = _s(o["cond"])
    return r


def endpoint(s):
    s = "" if s is None else _s(s)
    i = s.find(".")
    return {"node": s, "port": None} if i < 0 else {"node": s[:i], "port": s[i + 1:]}


def node_of(m, i):
    for n in m["nodes"]:
        if n["id"] == i:
            return n
    E("no-node", "节点不存在：" + _s(i))


def port_of(n, pid):
    for p in _listof(n.get("ports"), True):
        if p["id"] == pid:
            return p
    return None


def create(o=None):
    base = {"schema": SCHEMA, "id": "model", "name": "未命名 IP 模型", "kind": "instance", "rev": 1}
    base.update(o or {})
    return normalize(base)


def _str(v):
    return _s(v) if v else ""


def normalize(m):
    m = m or {}
    name = m.get("name") or m.get("id") or "未命名 IP 模型"
    return {"schema": m.get("schema") or SCHEMA, "id": _s(m.get("id") or "model"), "name": _s(name),
            "kind": m.get("kind") if m.get("kind") in MODEL_KINDS else "instance", "rev": m["rev"] if _int(m.get("rev")) else 1,
            "chip": _str(m.get("chip")), "family": _str(m.get("family")), "extends": _str(m.get("extends")), "source": _str(m.get("source")),
            "docrev": _s(m["docrev"]) if m.get("docrev") is not None else "", "description": _str(m.get("description")),
            "refs": [dict(x) for x in m["refs"] if is_obj(x)] if isinstance(m.get("refs"), list) else [],
            "nodes": m["nodes"] if isinstance(m.get("nodes"), list) else [], "edges": m["edges"] if isinstance(m.get("edges"), list) else [],
            "registers": m["registers"] if is_obj(m.get("registers")) else {},
            "scenes": m["scenes"] if isinstance(m.get("scenes"), list) else [],
            "rules": m["rules"] if isinstance(m.get("rules"), list) else [],
            "timings": m["timings"] if isinstance(m.get("timings"), list) else []}


def check_param(k, v):
    if not isinstance(k, str) or not k:
        E("bad-param", "参数名不能为空")
    if k in RESERVED:
        E("bad-param", "参数名 %s 是保留名" % k)
    if v is not None and not isinstance(v, (str, int, float, bool)):
        E("bad-param", "参数 %s 的值只能是字符串 / 数字 / 布尔" % k)


def port_shape(p):
    if not is_obj(p) or not is_id(p.get("id")):
        E("bad-id", "端口 id “%s” 无效" % _s(p.get("id") if is_obj(p) else None))
    if p.get("type") not in PORT_TYPES:
        E("bad-port-type", "端口类型 “%s” 无效（%s）" % (_s(p.get("type")), " / ".join(PORT_TYPES)))
    if p.get("dir") not in DIRS:
        E("bad-dir", "端口方向 “%s” 无效（in / out / inout）" % _s(p.get("dir")))
    q = {"id": p["id"], "type": p["type"], "dir": p["dir"]}
    if p.get("name"):
        q["name"] = _s(p["name"])
    return q


def node_shape(n, default_level):
    if not is_obj(n):
        E("bad-node", "节点必须是对象")
    if not is_id(n.get("id")):
        E("bad-id", "节点 id “%s” 无效（字母 / 数字 / _ / -，字母或 _ 开头，不能含 .）" % _s(n.get("id")))
    kind = n["kind"] if n.get("kind") is not None else (n["type"] if n.get("type") in KINDS else "logic")
    if kind not in KINDS:
        E("bad-kind", "节点类型 “%s” 无效（%s）" % (_s(kind), " / ".join(KINDS)))
    o = {"id": n["id"], "type": _s(n.get("type") or kind), "kind": kind, "name": _s(n.get("name") or n["id"])}
    if n.get("parent"):
        o["parent"] = _s(n["parent"])
    if n.get("params") is not None and not is_obj(n["params"]):
        E("bad-param", "params 必须是对象")
    o["params"] = {}
    for k, v in (n.get("params") or {}).items():
        check_param(k, v)
        o["params"][k] = v
    o["ports"] = []
    seen = set()
    for p in _listof(n.get("ports"), True):
        q = port_shape(p)
        if q["id"] in seen:
            E("dup-port", "端口重复：%s.%s" % (n["id"], q["id"]))
        seen.add(q["id"])
        o["ports"].append(q)
    o["registers"] = [_s(x) for x in n["registers"]] if isinstance(n.get("registers"), list) else []
    o["ev"] = ev_of(n.get("ev"), default_level)
    if n.get("note"):
        o["note"] = _s(n["note"])
    return o


def descendants(m, i, idx=None):
    kids = idx
    if kids is None:
        kids = {}
        for n in m["nodes"]:
            if n.get("parent"):
                kids.setdefault(n["parent"], []).append(n["id"])
    out, q = set(), [i]
    while q:
        c = q.pop()
        for x in kids.get(c, []):
            if x not in out:
                out.add(x)
                q.append(x)
    return out


def edge_id(m, s, t):
    base = "e_" + (s + "_" + t).replace(".", "_")
    i, k = base, 2
    while any(e["id"] == i for e in m["edges"]):
        i = "%s_%d" % (base, k)
        k += 1
    return i


def reg_shape(r):
    if not is_obj(r) or not is_id(r.get("id")):
        E("bad-id", "寄存器 id “%s” 无效" % _s(r.get("id") if is_obj(r) else None))
    o = {"id": r["id"], "name": _s(r.get("name") or r["id"])}
    w = 32 if r.get("width") is None else r["width"]
    if not _int(w) or w < 1:
        E("bad-reg", "寄存器 %s 位宽无效" % r["id"])
    o["width"] = int(w)
    if r.get("address") is not None and r.get("address") != "":
        a = to_int(r["address"])
        if a is None or a < 0:
            E("bad-reg", "寄存器 %s 地址无效：%s" % (r["id"], _s(r["address"])))
        o["address"] = a
    if r.get("reset") is not None and r.get("reset") != "":
        a = to_int(r["reset"])
        if a is None or a < 0:
            E("bad-reg", "寄存器 %s 复位值无效：%s" % (r["id"], _s(r["reset"])))
        o["reset"] = a
    if r.get("desc"):
        o["desc"] = _s(r["desc"])
    o["fields"] = []
    for f in _listof(r.get("fields"), True):
        if not is_obj(f) or not f.get("name"):
            E("bad-reg", "寄存器 %s 的位域缺少 name" % r["id"])
        x = {"name": _s(f["name"]), "bits": "" if f.get("bits") is None else _s(f["bits"])}
        if f.get("desc"):
            x["desc"] = _s(f["desc"])
        x["ev"] = ev_of(f.get("ev"))
        o["fields"].append(x)
    o["ev"] = ev_of(r.get("ev"))
    return o


# ---------------------------------------------------------------- scenes (2.0)
def scene_of(m, i):
    for sc in m["scenes"]:
        if sc["id"] == i:
            return sc
    E("no-scene", "场景不存在：" + _s(i))


def _uniq(a):
    seen, out = set(), []
    for x in a:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def step_shape(m, s):
    if not is_obj(s):
        E("bad-step", "步骤必须是对象")
    title = ("" if s.get("title") is None else _s(s["title"])).strip()
    if not title:
        E("bad-step", "步骤需要标题（title）")
    nodes = _uniq([_s(x) for x in _listof(s.get("nodes"))])
    for i in nodes:
        node_of(m, i)
    edges = _uniq([_s(x) for x in _listof(s.get("edges"))])
    for i in edges:
        if not any(e["id"] == i for e in m["edges"]):
            E("no-edge", "连线不存在：" + i)
    writes = []
    for w in _listof(s.get("writes")):
        if not is_obj(w) or w.get("reg") is None:
            E("bad-write", "寄存器写入需要 reg")
        reg = _s(w["reg"])
        if reg not in m["registers"]:
            E("no-register", "寄存器不存在：" + reg)
        v = to_int(w.get("value"))
        if v is None or v < 0:
            E("bad-write", "寄存器 %s 的值无效：%s" % (reg, _s(w.get("value"))))
        o = {"reg": reg, "value": v}
        if w.get("note"):
            o["note"] = _s(w["note"])
        writes.append(o)
    o = {"title": title, "note": _s(s["note"]) if s.get("note") else "", "nodes": nodes, "edges": edges, "writes": writes, "ev": ev_of(s.get("ev"))}
    if s.get("line") is not None and s.get("line") != "":
        if not _int(s["line"]) or s["line"] < 0:
            E("bad-step", "代码行号必须是非负整数")
        o["line"] = int(s["line"])
    return o


def scene_shape(m, sc):
    if not is_obj(sc) or not is_id(sc.get("id")):
        E("bad-id", "场景 id “%s” 无效" % _s(sc.get("id") if is_obj(sc) else None))
    o = {"id": sc["id"], "name": _s(sc.get("name") or sc["id"]), "desc": _s(sc["desc"]) if sc.get("desc") else "", "ev": ev_of(sc.get("ev"), "待核对"), "steps": []}
    for x in _listof(sc.get("steps")):
        o["steps"].append(step_shape(m, x))
    return o


def _drop_edge_refs(m, gone):
    if not gone:
        return
    for sc in m["scenes"]:
        for st in sc["steps"]:
            st["edges"] = [x for x in st["edges"] if x not in gone]


def _disp(i):
    """1-based number for display; anything else is shown as it was sent (mirror of disp() in ip-model.js)"""
    return str(i + 1) if _int(i) else _s(i)


def step_at(sc, i):
    if not _int(i) or i < 0 or i >= len(sc["steps"]):
        E("no-step", "场景 %s 没有第 %s 步（共 %d 步）" % (sc["id"], _s(i + 1 if _int(i) else i), len(sc["steps"])))
    return sc["steps"][int(i)]


# ---------------------------------------------------------------- behaviour rules (2.3)  — mirror of the rules section of ip-model.js
RULE_MAX, ACT_MAX = 200, 16


def _trim(x):
    return _s(x).strip(" \t\r\n")


def _key(x):
    return x["name"] + "." + x["field"] if x["field"] is not None else x["name"]


def rule_parse(m, r):
    errs, reads, writes, acts = [], {}, {}, {"then": [], "else": []}

    def e1(code, msg):
        errs.append({"code": code, "msg": msg})

    def ref_ok(ref, where):
        R = m["registers"].get(ref["name"])
        if ref["field"] is not None:
            if not R:
                e1("rule-ref", "%s：%s.%s 不是寄存器位域（“%s”不是已定义的寄存器）" % (where, ref["name"], ref["field"], ref["name"]))
                return
            if not any(f["name"] == ref["field"] for f in (R.get("fields") or [])):
                e1("rule-ref", "%s：寄存器 %s 没有位域 %s" % (where, ref["name"], ref["field"]))

    w = "" if r.get("when") is None else _s(r["when"])
    pw = IPE.parse(w)
    if not pw["ok"]:
        e1("rule-expr", "条件：" + pw["msg"] + ("（第 %d 个字符）" % (pw["pos"] + 1) if pw["pos"] >= 0 else ""))
    else:
        for x in IPE.refs(pw["ast"]):
            ref_ok(x, "条件")
            reads[_key(x)] = 1
    for side in ("then", "else"):
        lst = r.get(side) if isinstance(r.get(side), list) else []
        label = "满足时" if side == "then" else "否则"
        if side == "else" and lst and r.get("trigger") == "edge":
            e1("rule-else-edge", "“边沿”规则没有“否则”分支（它只在条件由假变真的那一刻动作）")
        if len(lst) > ACT_MAX:
            e1("rule-too-many", "%s最多 %d 条动作" % (label, ACT_MAX))
        for i, txt in enumerate(lst):
            where = "%s第 %d 条" % (label, i + 1)
            a = IPE.parse_action(txt)
            if not a["ok"]:
                e1("rule-expr", "%s：%s%s" % (where, a["msg"], "（第 %d 个字符）" % (a["pos"] + 1) if a["pos"] > 0 else ""))
                continue
            if a["kind"] == "emit":
                if r.get("trigger") != "edge":
                    e1("rule-emit-level", "%s：emit 只能用在“边沿”规则里（事件是“发生了一次”，电平规则表示的是“状态”）" % where)
                if a["node"] and not any(n["id"] == a["node"] for n in m["nodes"]):
                    e1("rule-ref", "%s：节点 %s 不存在" % (where, a["node"]))
                acts[side].append(a)
                continue
            tk = _key(a["target"])
            ref_ok(a["target"], where)
            writes[tk] = 1
            xr = IPE.refs(a["expr"])
            for x in xr:
                ref_ok(x, where)
                reads[_key(x)] = 1
            if r.get("trigger") != "edge":
                tgt = a["target"]
                if any(_key(x) == tk or (tgt["field"] is not None and x["field"] is None and x["name"] == tgt["name"]) or (tgt["field"] is None and x["field"] is not None and x["name"] == tgt["name"]) for x in xr):
                    e1("rule-selfref", "%s：电平规则里的动作不能读它自己要写的 %s（那是“每次加 1”这种边沿行为，请把规则类型改为“边沿”）" % (where, tk))
            acts[side].append(a)
    return {"errs": errs, "reads": reads, "writes": writes, "acts": acts}


def rule_shape(m, r):
    if not is_obj(r) or not is_id(r.get("id")):
        E("bad-id", "规则 id “%s” 无效" % _s(r.get("id") if is_obj(r) else r))
    trig = "level" if r.get("trigger") is None else r["trigger"]
    if trig not in ("level", "edge"):
        E("bad-rule", "规则类型必须是 level（电平）或 edge（边沿）")
    nm = r["id"] if (r.get("name") is None or r.get("name") == "") else r["name"]
    o = {"id": r["id"], "name": _s(nm)[:80], "trigger": trig, "when": _trim("" if r.get("when") is None else r["when"]),
         "then": [x for x in (_trim(y) for y in (r["then"] if isinstance(r.get("then"), list) else [])) if x],
         "else": [x for x in (_trim(y) for y in (r["else"] if isinstance(r.get("else"), list) else [])) if x],
         "note": _s(r["note"])[:300] if r.get("note") else "", "ev": ev_of(r.get("ev"), "待核对")}
    chk = rule_parse(m, o)
    if chk["errs"]:
        E(chk["errs"][0]["code"], "规则 %s · %s" % (o["id"], chk["errs"][0]["msg"]))
    if not o["then"] and not o["else"]:
        E("bad-rule", "规则 %s 没有任何动作（满足时 / 否则 至少写一条）" % o["id"])
    return o


_EMIT_RE = re.compile(r'^(\s*emit\s+"[^"\\\n]{1,120}")(?:\s+@([A-Za-z_][A-Za-z0-9_\-]*))?\s*$')


def rewrite_emit(m, fn):
    for r in m["rules"]:
        for side in ("then", "else"):
            out = []
            for t in r[side]:
                mm = _EMIT_RE.match(t)
                if not mm or not mm.group(2):
                    out.append(t)
                    continue
                nn = fn(mm.group(2))
                out.append(t if nn == mm.group(2) else (mm.group(1) + " @" + nn if nn else mm.group(1)))
            r[side] = out


def rules_using(m, reg):
    out = []
    for r in m["rules"]:
        c = rule_parse(m, r)
        if any(k == reg or k.startswith(reg + ".") for k in list(c["reads"]) + list(c["writes"])):
            out.append(r["id"])
    return out


# ---------------------------------------------------------------- timing diagrams (2.3) — mirror of the timings section of ip-model.js
WAVE_CH = "01xzpPnNlLhH=23456789.|"
TIM_MAX_SIG, TIM_MAX_WAVE = 32, 256


def timing_shape(m, t):
    if not is_obj(t) or not is_id(t.get("id")):
        E("bad-id", "时序图 id “%s” 无效" % _s(t.get("id") if is_obj(t) else t))
    hs = 1 if t.get("hscale") is None else t["hscale"]
    if not _int(hs) or hs < 1 or hs > 8:
        E("bad-timing", "时序图 %s 的横向缩放（hscale）必须是 1–8 的整数" % t["id"])
    hs = int(hs)
    sigs = t["signals"] if isinstance(t.get("signals"), list) else []
    if not sigs:
        E("bad-timing", "时序图 %s 至少要有一个信号" % t["id"])
    if len(sigs) > TIM_MAX_SIG:
        E("bad-timing", "时序图 %s 最多 %d 个信号" % (t["id"], TIM_MAX_SIG))
    signals = []
    for i, s in enumerate(sigs):
        if not is_obj(s) or not _s("" if s.get("name") is None else s["name"]).strip(" \t\r\n\f\v"):
            E("bad-timing", "时序图 %s 第 %d 个信号需要名字" % (t["id"], i + 1))
        name = _s(s["name"]).strip(" \t\r\n\f\v")[:40]
        wave = _s("" if s.get("wave") is None else s["wave"])
        if len(wave) > TIM_MAX_WAVE:
            E("bad-wave", "信号 %s 的波形太长（最多 %d 个字符）" % (name, TIM_MAX_WAVE))
        bad = next((c for c in wave if c not in WAVE_CH), None)
        if bad is not None:
            E("bad-wave", "信号 %s 的波形里有不支持的字符 “%s”（可用：0 1 x z p P n N l L h H = 2–9 . |）" % (name, bad))
        d = s.get("data")
        raw = d if isinstance(d, list) else [x for x in re.split(r"[ \t\r\n]+", _s("" if d is None else d)) if x]
        if len(raw) > 64:
            E("bad-wave", "信号 %s 的数据标签最多 64 个" % name)
        signals.append({"name": name, "wave": wave, "data": [_s(x)[:40] for x in raw]})
    nm = t["id"] if (t.get("name") is None or t.get("name") == "") else t["name"]
    return {"id": t["id"], "name": _s(nm)[:80], "hscale": hs, "signals": signals, "note": _s(t["note"])[:300] if t.get("note") else "", "ev": ev_of(t.get("ev"), "待核对")}


def wave_labels(w):
    return sum(1 for c in w if c in "=23456789")


# ---------------------------------------------------------------- ops
def op_add_node(m, p):
    n = node_shape(p.get("node"), "待核对")
    if any(x["id"] == n["id"] for x in m["nodes"]):
        E("dup-node", "节点 id 已存在：" + n["id"])
    if n.get("parent"):
        if n["parent"] == n["id"]:
            E("bad-parent", "节点不能是自己的父节点")
        node_of(m, n["parent"])
    m["nodes"].append(n)


def op_remove_node(m, p):
    node_of(m, p.get("id"))
    gone = descendants(m, p["id"])
    gone.add(p["id"])
    m["nodes"] = [n for n in m["nodes"] if n["id"] not in gone]
    rewrite_emit(m, lambda i: "" if i in gone else i)   # an event that pointed at a removed node keeps its text, loses the highlight
    dead = {e["id"] for e in m["edges"] if endpoint(e["source"])["node"] in gone or endpoint(e["target"])["node"] in gone}
    m["edges"] = [e for e in m["edges"] if e["id"] not in dead]
    _drop_edge_refs(m, dead)
    for sc in m["scenes"]:
        for st in sc["steps"]:
            st["nodes"] = [x for x in st["nodes"] if x not in gone]


def op_update_node(m, p):
    n = node_of(m, p.get("id"))
    s = _or(p.get("set"), {})
    if not is_obj(s):
        E("bad-op", "set 必须是对象")
    for k in s:
        if k not in ("name", "type", "kind", "note", "ev", "parent"):
            E("bad-op", "不能通过 update_node 修改 %s（参数用 set_param，端口用 add_port / remove_port，id 用 rename_node）" % k)
    if "kind" in s:
        if s["kind"] not in KINDS:
            E("bad-kind", "节点类型 “%s” 无效" % _s(s["kind"]))
        n["kind"] = s["kind"]
    if "name" in s:
        n["name"] = _s(s["name"])
    if "type" in s:
        n["type"] = _s(s["type"])
    if "note" in s:
        if s["note"]:
            n["note"] = _s(s["note"])
        else:
            n.pop("note", None)
    if "ev" in s:
        n["ev"] = dict(n.get("ev") or {}, **ev_of(s["ev"]))
    if "parent" in s:
        if not s["parent"]:
            n.pop("parent", None)
        else:
            node_of(m, s["parent"])
            if s["parent"] == n["id"] or s["parent"] in descendants(m, n["id"]):
                E("bad-parent", "会形成循环的父子关系：%s → %s" % (n["id"], s["parent"]))
            n["parent"] = _s(s["parent"])


def op_rename_node(m, p):
    n = node_of(m, p.get("id"))
    if not is_id(p.get("to")):
        E("bad-id", "新 id “%s” 无效" % _s(p.get("to")))
    if any(x["id"] == p["to"] for x in m["nodes"]):
        E("dup-node", "节点 id 已存在：" + p["to"])
    old = n["id"]
    n["id"] = p["to"]
    rewrite_emit(m, lambda i: p["to"] if i == old else i)
    for sc in m["scenes"]:
        for st in sc["steps"]:
            st["nodes"] = [p["to"] if x == old else x for x in st["nodes"]]
    for x in m["nodes"]:
        if x.get("parent") == old:
            x["parent"] = p["to"]
    for e in m["edges"]:
        s, t = endpoint(e["source"]), endpoint(e["target"])
        if s["node"] == old:
            e["source"] = p["to"] + ("." + s["port"] if s["port"] else "")
        if t["node"] == old:
            e["target"] = p["to"] + ("." + t["port"] if t["port"] else "")


def op_add_port(m, p):
    n = node_of(m, p.get("node"))
    q = port_shape(p.get("port"))
    if port_of(n, q["id"]):
        E("dup-port", "端口重复：%s.%s" % (n["id"], q["id"]))
    n["ports"].append(q)


def op_remove_port(m, p):
    n = node_of(m, p.get("node"))
    if not port_of(n, p.get("port")):
        E("no-port", "端口不存在：%s.%s" % (p.get("node"), p.get("port")))
    n["ports"] = [x for x in n["ports"] if x["id"] != p["port"]]
    key = "%s.%s" % (p["node"], p["port"])
    dead = {e["id"] for e in m["edges"] if e["source"] == key or e["target"] == key}
    m["edges"] = [e for e in m["edges"] if e["id"] not in dead]
    _drop_edge_refs(m, dead)


def op_add_edge(m, p):
    e = p.get("edge")
    if not is_obj(e):
        E("bad-edge", "连线必须是对象")
    S, T = endpoint(e.get("source")), endpoint(e.get("target"))
    sn, tn = node_of(m, S["node"]), node_of(m, T["node"])
    if S["port"] is not None and not port_of(sn, S["port"]):
        E("no-port", "端口不存在：" + _s(e.get("source")))
    if T["port"] is not None and not port_of(tn, T["port"]):
        E("no-port", "端口不存在：" + _s(e.get("target")))
    if e["source"] == e["target"]:
        E("self-edge", "连线两端相同：" + e["source"])
    typ = e.get("type")
    if not typ:
        typ = (S["port"] and port_of(sn, S["port"])["type"]) or (T["port"] and port_of(tn, T["port"])["type"]) or "data"
    if typ not in PORT_TYPES:
        E("bad-edge", "连线类型 “%s” 无效" % _s(typ))
    if any(x["source"] == e["source"] and x["target"] == e["target"] and x["type"] == typ for x in m["edges"]):
        E("dup-edge", "重复的连线：%s → %s（%s）" % (e["source"], e["target"], typ))
    i = _s(e["id"]) if e.get("id") else edge_id(m, e["source"], e["target"])
    if not is_id(i):
        E("bad-id", "连线 id “%s” 无效" % i)
    if any(x["id"] == i for x in m["edges"]):
        E("dup-edge-id", "连线 id 已存在：" + i)
    o = {"id": i, "source": e["source"], "target": e["target"], "type": typ}
    if e.get("name"):
        o["name"] = _s(e["name"])
    o["ev"] = ev_of(e.get("ev"))
    m["edges"].append(o)


def op_remove_edge(m, p):
    if not any(e["id"] == p.get("id") for e in m["edges"]):
        E("no-edge", "连线不存在：" + _s(p.get("id")))
    m["edges"] = [e for e in m["edges"] if e["id"] != p["id"]]
    _drop_edge_refs(m, {p["id"]})


def op_set_param(m, p):
    n = node_of(m, p.get("node"))
    val = p.get("value")
    check_param(p.get("key"), val)
    if val is None:
        n["params"].pop(p["key"], None)
    else:
        n["params"][p["key"]] = val


def op_set_registers(m, p):
    n = node_of(m, p.get("node"))
    if not isinstance(p.get("registers"), list):
        E("bad-op", "registers 必须是列表")
    ids = [_s(x) for x in p["registers"]]
    n["registers"] = ids if p.get("replace") else n["registers"] + [x for x in ids if x not in n["registers"]]


def op_define_register(m, p):
    r = reg_shape(p.get("register"))
    m["registers"][r["id"]] = r
    # redefining must not bypass the protection remove_register has: a rule that reads a field this definition no longer has would be left dangling
    broken = []
    for x in m["rules"]:
        errs = [e for e in rule_parse(m, x)["errs"] if e["code"] == "rule-ref" and ("寄存器 %s 没有位域" % r["id"] in e["msg"] or (r["id"] + ".") in e["msg"])]
        if errs:
            broken.append((x["id"], errs[0]["msg"]))
    if broken:
        E("in-use", "寄存器 %s 的新定义去掉了规则 %s 还在引用的位域（%s）：先修改或删除这些规则" % (r["id"], "、".join(b[0] for b in broken), re.sub(r"^.*：", "", broken[0][1])))


def op_remove_register(m, p):
    if p.get("id") not in m["registers"]:
        E("no-register", "寄存器不存在：" + _s(p.get("id")))
    u = rules_using(m, p["id"])
    if u:
        E("in-use", "寄存器 %s 被规则 %s 引用：先修改或删除这些规则（公式里的名字不会被自动改写）" % (p["id"], "、".join(u)))
    del m["registers"][p["id"]]
    for n in m["nodes"]:
        n["registers"] = [x for x in n["registers"] if x != p["id"]]
    for sc in m["scenes"]:
        for st in sc["steps"]:
            st["writes"] = [w for w in st["writes"] if w["reg"] != p["id"]]


def op_set_evidence(m, p):
    t = _s(p.get("target") or "")
    i = t.find(":")
    kind, ident = (t[:i], t[i + 1:]) if i >= 0 else ("", t)
    if kind == "node":
        o = node_of(m, ident)
    elif kind == "edge":
        o = next((e for e in m["edges"] if e["id"] == ident), None) or E("no-edge", "连线不存在：" + ident)
    elif kind == "register":
        o = m["registers"].get(ident) or E("no-register", "寄存器不存在：" + ident)
    elif kind == "field":
        r, _, f = ident.partition(".")
        R = m["registers"].get(r) or E("no-register", "寄存器不存在：" + r)
        o = next((x for x in R["fields"] if x["name"] == f), None) or E("no-field", "位域不存在：" + ident)
    else:
        E("bad-op", "target 应为 node:ID / edge:ID / register:ID / field:REG.FIELD")
    o["ev"] = dict(o.get("ev") or {}, **ev_of(p.get("ev")))


def op_set_meta(m, p):
    s = _or(p.get("set"), {})
    for k in s:
        if k not in ("name", "chip", "family", "kind", "extends", "source", "docrev", "description", "refs"):
            E("bad-op", "不能修改元数据 " + k)
        if k == "kind" and s[k] not in MODEL_KINDS:
            E("bad-kind", "模型类型无效：" + _s(s[k]))
        if k == "refs":
            if not isinstance(s["refs"], list) or not all(is_obj(x) for x in s["refs"]):
                E("bad-op", "refs 必须是对象列表")
            m["refs"] = clone(s["refs"])
        else:
            m[k] = _s(s[k])


def op_add_timing(m, p):
    if len(m["timings"]) >= 100:
        E("too-many", "时序图最多 100 个")
    t = timing_shape(m, p.get("timing"))
    if any(x["id"] == t["id"] for x in m["timings"]):
        E("dup-timing", "时序图 id 已存在：" + t["id"])
    m["timings"].append(t)


def op_remove_timing(m, p):
    if not any(x["id"] == p.get("id") for x in m["timings"]):
        E("no-timing", "时序图不存在：" + _s(p.get("id")))
    m["timings"] = [x for x in m["timings"] if x["id"] != p["id"]]


def op_update_timing(m, p):
    idx = next((i for i, x in enumerate(m["timings"]) if x["id"] == p.get("id")), -1)
    if idx < 0:
        E("no-timing", "时序图不存在：" + _s(p.get("id")))
    s = _or(p.get("set"), {})
    if not is_obj(s):
        E("bad-op", "set 必须是对象")
    for k in s:
        if k not in ("name", "hscale", "signals", "note", "ev"):
            E("bad-op", "不能修改时序图的 %s（id 不能改）" % k)
    cur = m["timings"][idx]
    merged = dict(cur)
    merged.update(s)
    if "ev" in s:
        merged["ev"] = dict(cur.get("ev") or {}, **ev_of(s["ev"]))
    m["timings"][idx] = timing_shape(m, merged)


def op_add_rule(m, p):
    if len(m["rules"]) >= RULE_MAX:
        E("too-many", "规则最多 %d 条" % RULE_MAX)
    r = rule_shape(m, p.get("rule"))
    if any(x["id"] == r["id"] for x in m["rules"]):
        E("dup-rule", "规则 id 已存在：" + r["id"])
    m["rules"].append(r)


def op_remove_rule(m, p):
    if not any(x["id"] == p.get("id") for x in m["rules"]):
        E("no-rule", "规则不存在：" + _s(p.get("id")))
    m["rules"] = [x for x in m["rules"] if x["id"] != p["id"]]


def op_update_rule(m, p):
    idx = next((i for i, x in enumerate(m["rules"]) if x["id"] == p.get("id")), -1)
    if idx < 0:
        E("no-rule", "规则不存在：" + _s(p.get("id")))
    s = _or(p.get("set"), {})
    if not is_obj(s):
        E("bad-op", "set 必须是对象")
    for k in s:
        if k not in ("name", "trigger", "when", "then", "else", "note", "ev"):
            E("bad-op", "不能修改规则的 %s（id 不能改；要换 id 请删除后重新添加）" % k)
    cur = m["rules"][idx]
    merged = dict(cur)
    merged.update(s)
    if "ev" in s:
        merged["ev"] = dict(cur.get("ev") or {}, **ev_of(s["ev"]))
    m["rules"][idx] = rule_shape(m, merged)


def op_add_scene(m, p):
    sc = scene_shape(m, p.get("scene"))
    if any(x["id"] == sc["id"] for x in m["scenes"]):
        E("dup-scene", "场景 id 已存在：" + sc["id"])
    m["scenes"].append(sc)


def op_remove_scene(m, p):
    scene_of(m, p.get("id"))
    m["scenes"] = [x for x in m["scenes"] if x["id"] != p["id"]]


def op_update_scene(m, p):
    sc = scene_of(m, p.get("id"))
    s = _or(p.get("set"), {})
    if not is_obj(s):
        E("bad-op", "set 必须是对象")
    for k in s:
        if k not in ("name", "desc", "ev"):
            E("bad-op", "不能通过 update_scene 修改 %s（步骤用 add_step / update_step / remove_step / move_step）" % k)
    if "name" in s:
        sc["name"] = _s(s["name"] or sc["id"])
    if "desc" in s:
        sc["desc"] = _s(s["desc"]) if s["desc"] else ""
    if "ev" in s:
        sc["ev"] = dict(sc.get("ev") or {}, **ev_of(s["ev"]))


def op_add_step(m, p):
    sc = scene_of(m, p.get("scene"))
    st = step_shape(m, p.get("step"))
    i = len(sc["steps"]) if p.get("index") is None else p["index"]
    if not _int(i) or i < 0 or i > len(sc["steps"]):
        E("no-step", "插入位置 %s 无效（0–%d）" % (_s(p.get("index")), len(sc["steps"])))
    sc["steps"].insert(int(i), st)


def op_update_step(m, p):
    sc = scene_of(m, p.get("scene"))
    cur = step_at(sc, p.get("index"))
    s = _or(p.get("set"), {})
    if not is_obj(s):
        E("bad-op", "set 必须是对象")
    for k in s:
        if k not in ("title", "note", "nodes", "edges", "writes", "line", "ev"):
            E("bad-op", "不能修改步骤的 " + k)
    merged = dict(cur)
    merged.update(s)
    if "ev" in s:
        merged["ev"] = dict(cur.get("ev") or {}, **ev_of(s["ev"]))
    if "line" in s and (s["line"] is None or s["line"] == ""):
        merged.pop("line", None)
    sc["steps"][int(p["index"])] = step_shape(m, merged)


def op_remove_step(m, p):
    sc = scene_of(m, p.get("scene"))
    step_at(sc, p.get("index"))
    del sc["steps"][int(p["index"])]


def op_move_step(m, p):
    sc = scene_of(m, p.get("scene"))
    step_at(sc, p.get("from"))
    t = p.get("to")
    if not _int(t) or t < 0 or t >= len(sc["steps"]):
        E("no-step", "目标位置 %s 无效（0–%d）" % (_s(t), len(sc["steps"]) - 1))
    x = sc["steps"].pop(int(p["from"]))
    sc["steps"].insert(int(t), x)


OPS = {"add_node": op_add_node, "remove_node": op_remove_node, "update_node": op_update_node, "rename_node": op_rename_node, "add_port": op_add_port,
       "remove_port": op_remove_port, "add_edge": op_add_edge, "remove_edge": op_remove_edge, "set_param": op_set_param, "set_registers": op_set_registers,
       "define_register": op_define_register, "remove_register": op_remove_register, "set_evidence": op_set_evidence, "set_meta": op_set_meta,
       "add_timing": op_add_timing, "remove_timing": op_remove_timing, "update_timing": op_update_timing, "add_rule": op_add_rule, "remove_rule": op_remove_rule, "update_rule": op_update_rule, "add_scene": op_add_scene, "remove_scene": op_remove_scene, "update_scene": op_update_scene, "add_step": op_add_step, "update_step": op_update_step, "remove_step": op_remove_step, "move_step": op_move_step}
OP_NAMES = list(OPS)


def apply(model, ops):
    """-> {ok, model, errors:[{index, op, code, msg}], applied}.  Atomic."""
    m = normalize(clone(model))
    errors = []
    lst = ops if isinstance(ops, list) else [ops]
    for i, op in enumerate(lst):
        try:
            if not is_obj(op) or not isinstance(op.get("op"), str) or op["op"] not in OPS:
                E("bad-op", "未知操作：%s（可用：%s）" % (_s(op.get("op") if is_obj(op) else None), " / ".join(OP_NAMES)))
            OPS[op["op"]](m, op)
        except IpErr as e:
            errors.append({"index": i, "op": op.get("op") if is_obj(op) else None, "code": e.code, "msg": e.msg})
        except Exception:   # noqa: BLE001 — safety net: whatever is inside, a malformed operation is a refusal, never an exception (same code and text as IPM.apply)
            errors.append({"index": i, "op": op.get("op") if is_obj(op) else None, "code": "bad-args", "msg": "操作 %s 的参数格式不对（类型错误或缺少必要字段）" % _s(op.get("op") if is_obj(op) else None)})
    if errors:
        return {"ok": False, "model": normalize(clone(model)), "errors": errors, "applied": 0}
    m["rev"] = (m["rev"] if _int(m.get("rev")) else 1) + 1
    return {"ok": True, "model": m, "errors": [], "applied": len(lst)}


# ---------------------------------------------------------------- validate
def validate(model):
    m = normalize(model)
    out = []

    def push(level, code, msg, ref=None):
        out.append({"level": level, "code": code, "msg": msg, "ref": ref})
    if m["schema"] != SCHEMA:
        push("err", "schema", "schema 应为 %s，当前是 “%s”" % (SCHEMA, m["schema"]))
    ids = {}
    for n in m["nodes"]:
        ref = {"kind": "node", "id": n["id"]}
        if not is_id(n["id"]):
            push("err", "bad-id", "节点 id “%s” 无效" % n["id"], ref)
        if n["id"] in ids:
            push("err", "dup-node", "节点 id 重复：" + n["id"], ref)
        ids[n["id"]] = n
        if n.get("kind") not in KINDS:
            push("err", "bad-kind", "节点 %s 的类型 “%s” 无效" % (n["id"], _s(n.get("kind"))), ref)
        seen = set()
        for p in _listof(n.get("ports"), True):
            if p["id"] in seen:
                push("err", "dup-port", "端口重复：%s.%s" % (n["id"], p["id"]), ref)
            seen.add(p["id"])
            if p.get("type") not in PORT_TYPES:
                push("err", "bad-port-type", "端口 %s.%s 类型无效：%s" % (n["id"], p["id"], _s(p.get("type"))), ref)
            if p.get("dir") not in DIRS:
                push("err", "bad-dir", "端口 %s.%s 方向无效：%s" % (n["id"], p["id"], _s(p.get("dir"))), ref)
        e = n.get("ev")
        if e and e.get("level") and e["level"] not in EV_LEVELS:
            push("err", "bad-ev", "节点 %s 的依据等级无效：%s" % (n["id"], e["level"]), ref)
        if e and e.get("page") is not None and parse_pages(e["page"]) is None:
            push("err", "bad-ev", "节点 %s 的页码格式不对：%s" % (n["id"], _s(e["page"])), ref)
    for n in m["nodes"]:
        if n.get("parent"):
            ref = {"kind": "node", "id": n["id"]}
            if n["parent"] not in ids:
                push("err", "parent-missing", "节点 %s 的父节点不存在：%s" % (n["id"], n["parent"]), ref)
            else:
                c, k = n["parent"], 0
                while c and k < 1000:
                    k += 1
                    if c == n["id"]:
                        push("err", "parent-cycle", "节点 %s 的父子关系形成循环" % n["id"], ref)
                        break
                    c = (ids.get(c) or {}).get("parent")
    eids, used = set(), set()
    for e in m["edges"]:
        ref = {"kind": "edge", "id": e["id"]}
        if e["id"] in eids:
            push("err", "dup-edge-id", "连线 id 重复：" + e["id"], ref)
        eids.add(e["id"])
        S, T = endpoint(e["source"]), endpoint(e["target"])
        sn, tn = ids.get(S["node"]), ids.get(T["node"])
        ok = True
        if not sn:
            push("err", "no-endpoint", "连线 %s 的起点节点不存在：%s" % (e["id"], S["node"]), ref)
            ok = False
        if not tn:
            push("err", "no-endpoint", "连线 %s 的终点节点不存在：%s" % (e["id"], T["node"]), ref)
            ok = False
        if not ok:
            continue
        used.add(S["node"])
        used.add(T["node"])
        sp = port_of(sn, S["port"]) if S["port"] is not None else None
        tp = port_of(tn, T["port"]) if T["port"] is not None else None
        if S["port"] is not None and not sp:
            push("err", "no-port", "连线 %s 的起点端口不存在：%s" % (e["id"], e["source"]), ref)
            continue
        if T["port"] is not None and not tp:
            push("err", "no-port", "连线 %s 的终点端口不存在：%s" % (e["id"], e["target"]), ref)
            continue
        if e.get("type") not in PORT_TYPES:
            push("err", "bad-edge", "连线 %s 的类型无效：%s" % (e["id"], _s(e.get("type"))), ref)
        for p in (sp, tp):
            if p and p["type"] != e.get("type"):
                push("warn", "edge-type-mismatch", "连线 %s（%s）连到了 %s 端口 %s" % (e["id"], e.get("type"), p["type"], e["source"] if p is sp else e["target"]), ref)
        if sp and sp["dir"] == "in":
            push("warn", "edge-direction", "连线 %s 的起点是输入端口 %s" % (e["id"], e["source"]), ref)
        if tp and tp["dir"] == "out":
            push("warn", "edge-direction", "连线 %s 的终点是输出端口 %s" % (e["id"], e["target"]), ref)
    with_kids = {n["parent"] for n in m["nodes"] if n.get("parent")}
    for n in m["nodes"]:
        if n["id"] not in used and n["id"] not in with_kids and not n.get("parent") and m["edges"]:
            push("info", "orphan-node", "节点 %s 没有任何连线" % n["id"], {"kind": "node", "id": n["id"]})
    reg_ids = set(m["registers"])
    for n in m["nodes"]:
        for r in n.get("registers") or []:
            if r not in reg_ids:
                push("warn", "reg-missing", "节点 %s 引用的寄存器 %s 没有定义" % (n["id"], r), {"kind": "node", "id": n["id"]})
    addr = {}
    for rid, r in m["registers"].items():
        ref = {"kind": "register", "id": rid}
        if r.get("width") not in (8, 16, 32, 64):
            push("warn", "reg-width", "寄存器 %s 的位宽 %s 不是 8/16/32/64" % (rid, _s(r.get("width"))), ref)
        if r.get("address") is not None:
            if r["address"] in addr:
                push("warn", "reg-address", "寄存器 %s 与 %s 地址相同" % (rid, addr[r["address"]]), ref)
            else:
                addr[r["address"]] = rid
        if r.get("reset") is not None and r["width"] < 53 and r["reset"] >= 2 ** r["width"]:
            push("err", "reg-reset", "寄存器 %s 的复位值超出 %d 位" % (rid, r["width"]), ref)
        taken = []
        for f in _listof(r.get("fields"), True):
            fref = {"kind": "field", "id": "%s.%s" % (rid, f["name"])}
            b = parse_bits(f.get("bits"))
            if not b:
                push("err", "reg-bits", "寄存器 %s 位域 %s 的 bits “%s” 格式不对" % (rid, f["name"], _s(f.get("bits"))), fref)
                continue
            if b[0] >= r["width"]:
                push("err", "reg-bits", "寄存器 %s 位域 %s 的 bit %d 超出位宽 %d" % (rid, f["name"], b[0], r["width"]), fref)
            hit = next((t for t in taken if not (b[0] < t[1][1] or b[1] > t[1][0])), None)
            if hit:
                push("warn", "field-overlap", "寄存器 %s 位域 %s 与 %s 的位范围重叠" % (rid, f["name"], hit[0]["name"]), fref)
            taken.append((f, b))
    sids = set()
    for sc in m["scenes"]:
        sref = {"kind": "scene", "id": sc["id"]}
        if not is_id(sc["id"]):
            push("err", "bad-id", "场景 id “%s” 无效" % sc["id"], sref)
        if sc["id"] in sids:
            push("err", "dup-scene", "场景 id 重复：" + sc["id"], sref)
        sids.add(sc["id"])
        e_ = sc.get("ev")
        if e_ and e_.get("level") and e_["level"] not in EV_LEVELS:
            push("err", "bad-ev", "场景 %s 的依据等级无效：%s" % (sc["id"], e_["level"]), sref)
        if not sc["steps"]:
            push("warn", "scene-empty", "场景 %s 没有步骤" % sc["id"], sref)
        for i, st in enumerate(sc["steps"]):
            at = "%s 第 %d 步" % (sc["id"], i + 1)
            r = {"kind": "scene", "id": sc["id"]}
            if not _s(st.get("title") or "").strip():
                push("err", "scene-step", "场景 %s 没有标题" % at, r)
            for x in st.get("nodes") or []:
                if x not in ids:
                    push("err", "scene-ref", "场景 %s 高亮的节点 %s 不存在" % (at, x), r)
            for x in st.get("edges") or []:
                if x not in eids:
                    push("err", "scene-ref", "场景 %s 高亮的连线 %s 不存在" % (at, x), r)
            for w in st.get("writes") or []:
                R = m["registers"].get(w["reg"])
                if not R:
                    push("err", "scene-ref", "场景 %s 写入的寄存器 %s 没有定义" % (at, w["reg"]), r)
                    continue
                if R["width"] < 53 and w["value"] >= 2 ** R["width"]:
                    push("err", "scene-write", "场景 %s：寄存器 %s 的值 0x%X 超出 %d 位" % (at, w["reg"], w["value"], R["width"]), r)
            if not (st.get("nodes") or []) and not (st.get("edges") or []):
                push("info", "step-no-highlight", "场景 %s 没有高亮任何节点或连线" % at, r)
    rids, assigned, read_by = set(), set(), {}
    for r in m["rules"]:
        rref = {"kind": "rule", "id": r["id"]}
        if not is_id(r["id"]):
            push("err", "bad-id", "规则 id “%s” 无效" % r["id"], rref)
        if r["id"] in rids:
            push("err", "dup-rule", "规则 id 重复：" + r["id"], rref)
        rids.add(r["id"])
        e_ = r.get("ev")
        if e_ and e_.get("level") and e_["level"] not in EV_LEVELS:
            push("err", "bad-ev", "规则 %s 的依据等级无效：%s" % (r["id"], e_["level"]), rref)
        if r.get("trigger") not in ("level", "edge"):
            push("err", "bad-rule", "规则 %s 的类型无效：%s" % (r["id"], _s(r.get("trigger"))), rref)
        if not (r.get("then") or []) and not (r.get("else") or []):
            push("err", "bad-rule", "规则 %s 没有任何动作" % r["id"], rref)
        c = rule_parse(m, r)
        for e in c["errs"]:
            push("err", e["code"], "规则 %s · %s" % (r["id"], e["msg"]), rref)
        assigned.update(c["writes"])
        for k in c["reads"]:
            read_by.setdefault(k, r["id"])
    for k, rid in read_by.items():
        if "." not in k and k not in m["registers"] and k not in assigned:
            push("warn", "rule-var", "规则 %s 读取的 %s 不是寄存器，也没有任何规则给它赋值（拼写错误？）" % (rid, k), {"kind": "rule", "id": rid})
    tids = set()
    for tm in m["timings"]:
        tref = {"kind": "timing", "id": tm["id"]}
        if not is_id(tm["id"]):
            push("err", "bad-id", "时序图 id “%s” 无效" % tm["id"], tref)
        if tm["id"] in tids:
            push("err", "dup-timing", "时序图 id 重复：" + tm["id"], tref)
        tids.add(tm["id"])
        e_ = tm.get("ev")
        if e_ and e_.get("level") and e_["level"] not in EV_LEVELS:
            push("err", "bad-ev", "时序图 %s 的依据等级无效：%s" % (tm["id"], e_["level"]), tref)
        if not _int(tm.get("hscale")) or tm["hscale"] < 1 or tm["hscale"] > 8:
            push("err", "timing-hscale", "时序图 %s 的横向缩放必须是 1–8 的整数" % tm["id"], tref)
        if not (tm.get("signals") or []):
            push("err", "timing-empty", "时序图 %s 没有信号" % tm["id"], tref)
        seen = set()
        for sg in tm.get("signals") or []:
            w = _s(sg.get("wave") or "")
            bad = next((c for c in w if c not in WAVE_CH), None)
            if bad is not None:
                push("err", "timing-wave", "时序图 %s 信号 %s 的波形里有不支持的字符 “%s”" % (tm["id"], sg["name"], bad), tref)
            need, have = wave_labels(w), len(sg.get("data") or [])
            if need != have and (need or have):
                push("warn", "timing-data", "时序图 %s 信号 %s：波形里有 %d 个需要标签的段，数据标签有 %d 个" % (tm["id"], sg["name"], need, have), tref)
            if sg["name"] in seen:
                push("warn", "timing-dup-signal", "时序图 %s 里信号名重复：%s" % (tm["id"], sg["name"]), tref)
            seen.add(sg["name"])
    if m["kind"] == "template":
        bad = sum(1 for n in m["nodes"] if not n.get("ev") or n["ev"].get("level") != "示意") + sum(1 for r in m["registers"].values() if r.get("address") is not None or r.get("reset") is not None) \
            + sum(1 for sc in m["scenes"] if not sc.get("ev") or sc["ev"].get("level") != "示意" or any(st["writes"] for st in sc["steps"])) + len(m["rules"]) + len(m["timings"])
        if bad:
            push("warn", "template-fact", "模板只描述结构：%d 项不是“示意”等级或带有地址 / 复位值" % bad)
    else:
        strong = ("手册确认", "实测")
        facts = sum(1 for n in m["nodes"] if n.get("params") and not (n.get("ev") and n["ev"].get("level") in strong)) \
            + sum(1 for r in m["registers"].values() if (r.get("address") is not None or r.get("reset") is not None) and not (r.get("ev") and r["ev"].get("level") in strong))
        ut = sum(1 for x in m["timings"] if not (x.get("ev") and x["ev"].get("level") in strong))
        if ut:
            push("info", "unverified-timings", "%d 个时序图还没有“手册确认”或“实测”依据" % ut)
        ur = sum(1 for r in m["rules"] if not (r.get("ev") and r["ev"].get("level") in strong))
        if ur:
            push("info", "unverified-rules", "%d 条规则还没有“手册确认”或“实测”依据：推演结果只和规则一样可靠" % ur)
        us = sum(1 for sc in m["scenes"] if not (sc.get("ev") and sc["ev"].get("level") in strong))
        if us:
            push("info", "unverified-scenes", "%d 个场景还没有“手册确认”或“实测”依据" % us)
        if facts:
            push("info", "unverified-facts", "%d 项带参数 / 地址 / 复位值的内容还没有“手册确认”或“实测”依据" % facts)
        if m["source"]:
            np_ = sum(1 for n in m["nodes"] if not (n.get("ev") and n["ev"].get("page") is not None and n["ev"]["page"] != ""))
            if np_:
                push("warn", "no-page", "%d 个节点没有手册页码" % np_)
        elif m["nodes"]:
            push("info", "no-source", "没有填写 source（手册文件名），页码无法跳转")
    return out


def summary(model):
    m = normalize(model)
    v = validate(m)
    lv = {l: 0 for l in EV_LEVELS}
    for n in m["nodes"]:
        lv[(n.get("ev") or {}).get("level") or "待核对"] += 1
    return {"id": m["id"], "name": m["name"], "kind": m["kind"], "rev": m["rev"], "nodes": len(m["nodes"]), "edges": len(m["edges"]), "registers": len(m["registers"]), "scenes": len(m["scenes"]), "rules": len(m["rules"]), "timings": len(m["timings"]),
            "errors": sum(1 for x in v if x["level"] == "err"), "warnings": sum(1 for x in v if x["level"] == "warn"), "nodeEvidence": lv}


def subgraph(model, node=None, depth=1):
    m = normalize(model)
    if not node:
        return clone(m)
    root = node_of(m, node)
    keep = descendants(m, root["id"])
    keep.add(root["id"])
    front = set(keep)
    for _ in range(1 if depth is None else depth):
        nxt = set()
        for e in m["edges"]:
            s, t = endpoint(e["source"])["node"], endpoint(e["target"])["node"]
            if s in front and t not in keep:
                nxt.add(t)
            if t in front and s not in keep:
                nxt.add(s)
        for x in nxt:
            keep.add(x)
            keep |= descendants(m, x)
        front = nxt
        if not nxt:
            break
    r = clone(m)
    r["nodes"] = [n for n in r["nodes"] if n["id"] in keep]
    for n in r["nodes"]:
        if n.get("parent") and n["parent"] not in keep:
            del n["parent"]
    r["edges"] = [e for e in r["edges"] if endpoint(e["source"])["node"] in keep and endpoint(e["target"])["node"] in keep]
    need = {x for n in r["nodes"] for x in n["registers"]}
    for k in list(r["registers"]):
        if k not in need:
            del r["registers"][k]
    r["scenes"] = []
    r["rules"] = []
    r["timings"] = []
    r["fragment"] = {"node": root["id"], "depth": 1 if depth is None else depth, "of": m["id"]}
    return r


def canonical(m):
    return json.dumps(normalize(m), sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def _same(a, b):
    return json.dumps(a, sort_keys=True, ensure_ascii=False) == json.dumps(b, sort_keys=True, ensure_ascii=False)


def diff(a, b):
    a, b = normalize(a), normalize(b)
    d = {"nodes": {"added": [], "removed": [], "modified": []}, "edges": {"added": [], "removed": [], "modified": []}, "registers": {"added": [], "removed": [], "modified": []}, "scenes": {"added": [], "removed": [], "modified": []}, "rules": {"added": [], "removed": [], "modified": []}, "timings": {"added": [], "removed": [], "modified": []}, "meta": []}

    def cmp(xs, ys, key, bucket):
        X, Y = {key(x): x for x in xs}, {key(x): x for x in ys}
        for k, v in Y.items():
            if k not in X:
                bucket["added"].append(k)
            elif not _same(X[k], v):
                bucket["modified"].append(k)
        for k in X:
            if k not in Y:
                bucket["removed"].append(k)
    cmp(a["nodes"], b["nodes"], lambda n: n["id"], d["nodes"])
    cmp(a["edges"], b["edges"], lambda e: e["id"], d["edges"])
    cmp(list(a["registers"].values()), list(b["registers"].values()), lambda r: r["id"], d["registers"])
    cmp(a["scenes"], b["scenes"], lambda x: x["id"], d["scenes"])
    cmp(a["rules"], b["rules"], lambda x: x["id"], d["rules"])
    cmp(a["timings"], b["timings"], lambda x: x["id"], d["timings"])
    for k in ("name", "chip", "family", "kind", "extends", "source", "docrev", "description"):
        if a[k] != b[k]:
            d["meta"].append(k)
    if not _same(a["refs"], b["refs"]):
        d["meta"].append("refs")
    d["empty"] = not (d["meta"] or any(d[k]["added"] or d[k]["removed"] or d[k]["modified"] for k in ("nodes", "edges", "registers", "scenes", "rules", "timings")))
    return d


def _t(v):
    """JS truthiness (an empty list / dict is truthy in JS)"""
    return not (v is None or v is False or v == "" or (isinstance(v, (int, float)) and not isinstance(v, bool) and v == 0))


def _or(v, default):
    """JS `v || default` (an empty list / dict is truthy in JS)"""
    return v if _t(v) else default


def _len(v):
    """length of an optional list for a description: missing -> 0; anything that is not a list is malformed (TypeError -> “参数不完整”), like (x || []).map in the JS mirror"""
    if v is None:
        return 0
    if not isinstance(v, list):
        raise TypeError("not a list")
    return len(v)


def _listof(v, chars=False):
    """JS `(v || []).map / .forEach` (and, with chars=True, `for (const x of v || [])`, which also walks the characters of a string): a falsy value is an empty list; a truthy value that is not a list throws TypeError in JS (-> the apply safety net: bad-args).  Python must make the same decision instead of iterating a string or a dict."""
    v = _or(v, [])
    if chars and isinstance(v, str):
        return list(v)
    if not isinstance(v, list):
        raise TypeError("not a list")
    return v


def _join(sep, arr):
    """JS Array.prototype.join: null / undefined become "", every other element goes through String(); a non-array has no .join (TypeError)"""
    if not isinstance(arr, list):
        raise TypeError("not an array")
    return sep.join("" if x is None else _s(x) for x in arr)


def describe_op(op):
    """One-line description of an operation — mirror of IPM.describeOp.  Every interpolated value goes through _s (= JS String()) so that a junk value prints the same in both."""
    if not is_obj(op):
        return "无效操作（不是对象）"
    if any(op.get(k) is not None and not is_obj(op.get(k)) for k in ("node", "port", "register", "edge", "scene", "step", "rule", "timing", "set", "ev")):
        return "%s（参数不完整）" % _s(op.get("op"))
    d, g = _s, op.get
    keys = lambda: "、".join(_or(g("set"), {}).keys())
    nm = lambda o, key: ("（" + d(o.get("name")) + "）") if _t(o.get("name")) and o.get("name") != o.get(key) else ""
    f = {"add_node": lambda: "添加节点 " + d(op["node"]["id"]) + nm(op["node"], "id"),
         "remove_node": lambda: "删除节点 " + d(g("id")) + "（连带子节点和连线）", "update_node": lambda: "修改节点 " + d(g("id")) + "：" + keys(),
         "rename_node": lambda: "重命名节点 " + d(g("id")) + " → " + d(g("to")),
         "add_port": lambda: "添加端口 " + d(g("node")) + "." + d(op["port"]["id"]) + "（" + d(op["port"]["type"]) + " / " + d(op["port"]["dir"]) + "）",
         "remove_port": lambda: "删除端口 " + d(g("node")) + "." + d(g("port")),
         "add_edge": lambda: "连线 " + d(op["edge"]["source"]) + " → " + d(op["edge"]["target"]) + (("（" + d(op["edge"].get("type")) + "）") if _t(op["edge"].get("type")) else ""),
         "remove_edge": lambda: "删除连线 " + d(g("id")),
         "set_param": lambda: ("删除参数 " if g("value") is None else "设置参数 ") + d(g("node")) + "." + d(g("key")) + ("" if g("value") is None else " = " + d(g("value"))),
         "set_registers": lambda: ("设置" if _t(g("replace")) else "关联") + "寄存器 " + d(g("node")) + " ← " + _join("、", g("registers")),
         "define_register": lambda: "定义寄存器 " + d(op["register"]["id"]), "remove_register": lambda: "删除寄存器 " + d(g("id")),
         "set_evidence": lambda: "设置依据 " + d(g("target")) + "：" + "，".join(k + "=" + d(v) for k, v in (g("ev") or {}).items()),
         "set_meta": lambda: "修改模型信息：" + keys(),
         "add_timing": lambda: "添加时序图 " + d(op["timing"]["id"]) + nm(op["timing"], "id") + "，" + d(_len(op["timing"].get("signals"))) + " 个信号",
         "remove_timing": lambda: "删除时序图 " + d(g("id")), "update_timing": lambda: "修改时序图 " + d(g("id")) + "：" + keys(),
         "add_rule": lambda: "添加规则 " + d(op["rule"]["id"]) + nm(op["rule"], "id") + "：" + ("边沿" if op["rule"].get("trigger") == "edge" else "电平") + " · 当 " + d(op["rule"].get("when")),
         "remove_rule": lambda: "删除规则 " + d(g("id")), "update_rule": lambda: "修改规则 " + d(g("id")) + "：" + keys(),
         "add_scene": lambda: "添加场景 " + d(op["scene"]["id"]) + nm(op["scene"], "id") + "，" + d(_len(op["scene"].get("steps"))) + " 步",
         "remove_scene": lambda: "删除场景 " + d(g("id")), "update_scene": lambda: "修改场景 " + d(g("id")) + "：" + keys(),
         "add_step": lambda: "场景 " + d(g("scene")) + " 添加步骤：" + d((g("step") or {}).get("title") if _t(g("step")) else g("step")),
         "update_step": lambda: "场景 " + d(g("scene")) + " 修改第 " + _disp(g("index")) + " 步：" + keys(),
         "remove_step": lambda: "场景 " + d(g("scene")) + " 删除第 " + _disp(g("index")) + " 步",
         "move_step": lambda: "场景 " + d(g("scene")) + " 把第 " + _disp(g("from")) + " 步移到第 " + _disp(g("to")) + " 位"}
    try:
        return f[op["op"]]() if isinstance(op.get("op"), str) and op["op"] in f else "未知操作 " + d(op.get("op"))
    except Exception:   # noqa: BLE001 — a description must never raise
        return "%s（参数不完整）" % _s(op.get("op"))


def instantiate(tpl, prefix, parent=None, name=None):
    tpl = normalize(tpl)
    if not is_id(prefix):
        E("bad-id", "前缀 “%s” 无效" % _s(prefix))
    roots = [n for n in tpl["nodes"] if not n.get("parent")]
    top = roots[0]["id"] if len(roots) == 1 else None
    mp = lambda i: prefix if i == top else prefix + "_" + i
    ops = []
    for n in tpl["nodes"]:
        c = clone(n)
        c["id"] = mp(n["id"])
        if n["id"] == top:
            if parent:
                c["parent"] = parent
            else:
                c.pop("parent", None)
            if name:
                c["name"] = name
        else:
            if n.get("parent"):
                c["parent"] = mp(n["parent"])
            elif parent:
                c["parent"] = parent
            else:
                c.pop("parent", None)
        ops.append({"op": "add_node", "node": c})

    def mps(s):
        x = endpoint(s)
        return mp(x["node"]) + ("." + x["port"] if x["port"] else "")
    for e in tpl["edges"]:
        c = clone(e)
        c["id"] = prefix + "_" + e["id"]
        c["source"], c["target"] = mps(e["source"]), mps(e["target"])
        ops.append({"op": "add_edge", "edge": c})
    for k in tpl["registers"]:
        r = clone(tpl["registers"][k])
        r["id"] = prefix + "_" + k
        ops.append({"op": "define_register", "register": r})
    for op in ops:
        if op["op"] == "add_node":
            op["node"]["registers"] = [prefix + "_" + r for r in (op["node"].get("registers") or [])]
    return ops


def svd_ops(regs, peripheral=None, node=None, taken=()):
    """registers of one SVD peripheral -> ops (mirror of IPM.svdOps).  Vendor SVD is not the manual: everything is 待核对, sec 'SVD'."""
    ops, ids, used = [], [], set(taken or [])
    for r in regs or []:
        name = _s(r.get("name"))
        if peripheral and name.split(".")[0] != peripheral:
            continue
        short = "_".join(name.split(".")[1:]) or name
        rid = re.sub(r"[^A-Za-z0-9_\-]", "_", short if peripheral else name.replace(".", "_"))
        if not re.match(r"^[A-Za-z_]", rid):
            rid = "_" + rid
        base, k = rid, 2
        while rid in used:
            rid = "%s_%d" % (base, k)
            k += 1
        used.add(rid)
        width = r.get("width") if _int(r.get("width")) and r.get("width") > 0 else 32
        reg = {"id": rid, "name": short, "width": int(width), "desc": r.get("desc") or "", "fields": [], "ev": {"level": "待核对", "sec": "SVD"}}
        a = r.get("address")
        if isinstance(a, (int, float)) and not isinstance(a, bool) and a == a and a >= 0:
            reg["address"] = int(a)
        rs = r.get("reset")
        if isinstance(rs, (int, float)) and not isinstance(rs, bool) and rs == rs and rs >= 0 and width < 53 and rs < 2 ** width:
            reg["reset"] = int(rs)
        for f in _listof(r.get("fields"), True):
            if not f.get("name") or not re.fullmatch(r"\d+(:\d+)?", _s(f.get("bits"))):
                continue
            vals = ", ".join("%s=%s" % (k2, _s(v).split(" — ")[0]) for k2, v in (f.get("values") or {}).items())
            desc = " ".join(x for x in [f.get("desc") or "", "[%s]" % f["access"] if f.get("access") else "", vals] if x).strip()
            reg["fields"].append({"name": _s(f["name"]), "bits": _s(f["bits"]), "desc": desc, "ev": {"level": "待核对", "sec": "SVD"}})
        ops.append({"op": "define_register", "register": reg})
        ids.append(rid)
    if node and ids:
        ops.append({"op": "set_registers", "node": node, "registers": ids})
    return ops


def from_template(tpl, id, name, chip="", source="", docrev="", description=""):
    """mirror of IPT.instance: a concrete model derived from a template — structure kept, every node / edge 待核对, extends = the template id"""
    m = clone(normalize(tpl))
    m["id"], m["name"], m["kind"], m["description"], m["extends"] = id, name, "instance", description or "", tpl["id"]
    for k, v in (("chip", chip), ("source", source), ("docrev", docrev)):
        if v:
            m[k] = _s(v)
    for n in m["nodes"]:
        n["ev"] = {"level": "待核对"}
    for e in m["edges"]:
        e["ev"] = {"level": "待核对"}
    return normalize(m)


def to_ipblock(model, collapsed=None, direction="right"):
    """mirror of IPM.toIpblock: index-based; links whose end was lifted onto a collapsed group are merged per (from, to, kind) and labelled ×N"""
    m = normalize(model)
    collapsed = set(collapsed or [])
    by_id = {n["id"]: n for n in m["nodes"]}
    kids_of = {}
    for n in m["nodes"]:
        if n.get("parent"):
            kids_of.setdefault(n["parent"], []).append(n["id"])
    hidden = set()
    for cid in collapsed:
        q = list(kids_of.get(cid, []))
        while q:
            c = q.pop()
            if c in hidden:
                continue
            hidden.add(c)
            q.extend(kids_of.get(c, []))
    groups, blocks, shown = [], [], set()
    for n in m["nodes"]:
        if n["id"] in hidden:
            continue
        shown.add(n["id"])
        if n["id"] in kids_of and n["id"] not in collapsed:
            g = {"id": n["id"], "label": n["name"]}
            if n.get("parent") and n["parent"] not in hidden:
                g["parent"] = n["parent"]
            groups.append(g)
        else:
            b = {"id": n["id"], "label": n["name"], "kind": "logic" if n["kind"] == "group" else n["kind"], "regs": list(n["registers"]), "ports": [{"id": p["id"], "dir": p["dir"]} for p in n["ports"]]}
            if n.get("parent"):
                b["group"] = n["parent"]
            e = n.get("ev") or {}
            if e.get("page") is not None:
                b["page"] = e["page"]
            if e.get("level") == "手册确认":
                b["status"] = "verified"
            elif e.get("level") == "待核对":
                b["status"] = "todo"
            if n.get("note"):
                b["note"] = n["note"]
            if b.get("group") and b["group"] in hidden:
                del b["group"]
            blocks.append(b)

    def lift(x):
        i = x["node"]
        if i not in hidden:
            return x, False
        while i and i in hidden:
            i = (by_id.get(i) or {}).get("parent")
        return {"node": i, "port": None}, True
    links, merged = [], {}
    for e in m["edges"]:
        (s, sl), (t, tl) = lift(endpoint(e["source"])), lift(endpoint(e["target"]))
        if not s["node"] or not t["node"] or s["node"] == t["node"] or s["node"] not in shown or t["node"] not in shown:
            continue
        frm = s["node"] + ("." + s["port"] if s["port"] else "")
        to = t["node"] + ("." + t["port"] if t["port"] else "")
        kind = LKIND.get(e["type"], "data")
        if sl or tl:
            k = (frm, to, kind)
            hit = merged.get(k)
            if hit:
                hit["count"] += 1
                hit["link"]["label"] = "×%d" % hit["count"]
                hit["link"]["count"] = hit["count"]
                continue
            link = {"from": frm, "to": to, "kind": kind, "label": e.get("name") or ""}
            merged[k] = {"link": link, "count": 1}
            links.append(link)
            continue
        links.append({"from": frm, "to": to, "kind": kind, "label": e.get("name") or ""})
    return {"title": m["name"], "source": m["source"], "direction": direction, "groups": groups, "blocks": blocks, "links": links}


def _fix_id(s):
    s = re.sub(r"[^A-Za-z0-9_\-]", "_", _s(s))
    return "_" + s if not re.match(r"^[A-Za-z_]", s) else s


def from_atlas(text, mini_yaml, o=None):
    """Markdown atlas page -> model (mirror of IPM.fromAtlas).  mini_yaml: the server's YAML subset parser."""
    o = o or {}
    fm = {}
    mfm = re.match(r"^---\n(.*?)\n---", text.replace("\r\n", "\n"), re.S)
    if mfm:
        try:
            fm = mini_yaml(mfm.group(1)) or {}
        except Exception:  # noqa: BLE001
            fm = {}
    meta = {k: ("" if fm.get(k) is None else _s(fm[k])) for k in ("ip", "chip", "source", "docrev", "chapter")}
    mid = o.get("id") or _fix_id((meta["ip"] or "ip") + "-" + (meta["chip"] or "chip"))
    m = create({"id": mid, "name": "%s · %s" % (meta["ip"] or "IP", meta["chip"]), "chip": meta["chip"], "source": meta["source"], "docrev": meta["docrev"], "description": meta["chapter"]})
    warnings, taken = [], set()

    def evx(x):
        r = {}
        lv = x.get("ev")
        lv = "待核对" if lv is None or lv == "" else lv
        lv = {"confirmed": "手册确认", "manual": "手册确认", "measured": "实测", "derived": "推导", "schematic": "示意", "todo": "待核对", "unverified": "待核对", "已确认": "手册确认", "已核对": "手册确认"}.get(_s(lv).lower(), lv)
        if lv in EV_LEVELS:
            r["level"] = lv
        if x.get("page") is not None and parse_pages(x["page"]) is not None:
            r["page"] = x["page"]
        if x.get("sec") not in (None, ""):
            r["sec"] = _s(x["sec"])
        if x.get("cond") not in (None, ""):
            r["cond"] = _s(x["cond"])
        return r
    links_raw = []
    regs_raw = []
    scenes_raw = []
    wave_raw = []
    for lang, body in re.findall(r"```([\w-]+)[^\n]*\n(.*?)\n```", text, re.S):
        lang = lang.lower()
        try:
            y = mini_yaml(body) if lang in ("ipblock", "register", "scene") else None
        except Exception:  # noqa: BLE001
            continue
        if lang == "ipblock" and is_obj(y):
            for g in y.get("groups") or []:
                if is_obj(g) and g.get("id") is not None:
                    gid = _s(g["id"])
                    if gid in taken:
                        warnings.append("重复的 id 已跳过：" + gid)
                        continue
                    taken.add(gid)
                    n = {"id": gid, "type": "group", "kind": "group", "name": _s(g.get("label") or gid), "params": {}, "ports": [], "registers": [], "ev": {"level": "待核对"}}
                    if g.get("parent") is not None:
                        n["parent"] = _s(g["parent"])
                    m["nodes"].append(n)
            for b in y.get("blocks") or y.get("nodes") or []:
                if not (is_obj(b) and b.get("id") is not None):
                    continue
                bid = _s(b["id"])
                if bid in taken:
                    warnings.append("重复的 id 已跳过：" + bid)
                    continue
                taken.add(bid)
                kind = _s(b.get("kind") or "logic").lower()
                kind = kind if kind in KINDS and kind != "group" else "logic"
                ports = []
                for p in b.get("ports") or []:
                    if is_obj(p) and p.get("id") is not None:
                        d = _s(p.get("dir") or "inout")
                        ports.append({"id": _s(p["id"]), "type": "data", "dir": d if d in DIRS else "inout"})
                n = {"id": bid, "type": kind, "kind": kind, "name": _s(b.get("label") or bid), "params": {}, "ports": ports,
                     "registers": [_s(r) for r in (b.get("regs") if isinstance(b.get("regs"), list) else [])], "ev": evx(b)}
                if b.get("group") is not None:
                    n["parent"] = _s(b["group"])
                if b.get("status") == "verified" and not n["ev"].get("level"):
                    n["ev"]["level"] = "手册确认"
                if not n["ev"].get("level"):
                    n["ev"]["level"] = "待核对"
                m["nodes"].append(n)
            ids = {n["id"] for n in m["nodes"]}
            for l in y.get("links") or y.get("edges") or []:
                if is_obj(l):
                    links_raw.append((l, ids))
        elif lang == "register" and is_obj(y) and y.get("name"):
            regs_raw.append(y)
        elif lang == "wavedrom":
            wave_raw.append(body)
        elif lang == "scene" and is_obj(y):
            scenes_raw.append(y)
    for n in m["nodes"]:
        pass
    idset = {n["id"] for n in m["nodes"]}

    def base(v):
        v = _s(v)
        if v in idset:
            return v, None
        i = v.rfind(".")
        return (v[:i], v[i + 1:]) if i > 0 and v[:i] in idset else (v, None)
    LT = {"bus": "bus", "data": "data", "clock": "clock", "irq": "irq", "dma": "dma", "ctrl": "ctrl"}
    for i, (l, _) in enumerate(links_raw):
        (f, fp), (t, tp) = base(l.get("from")), base(l.get("to"))
        typ = LT.get(_s(l.get("kind") or "data").lower(), "data")
        for nid, port, d in ((f, fp, "out"), (t, tp, "in")):
            n = next((x for x in m["nodes"] if x["id"] == nid), None)
            if n and port and not any(p["id"] == port for p in n["ports"]):
                n["ports"].append({"id": port, "type": typ, "dir": d})
        if not any(n["id"] == f for n in m["nodes"]) or not any(n["id"] == t for n in m["nodes"]):
            warnings.append("连线 %s → %s 引用了不存在的节点，已跳过" % (_s(l.get("from")), _s(l.get("to"))))
            continue
        e = {"id": "e%d" % (i + 1), "source": f + ("." + fp if fp else ""), "target": t + ("." + tp if tp else ""), "type": typ, "ev": {}}
        if l.get("label"):
            e["name"] = _s(l["label"])
        m["edges"].append(e)
    names = {}
    for y in regs_raw:
        name = _s(y["name"]).upper()
        if name in names:
            continue
        rid = _fix_id(name)
        names[name] = rid
        r = {"id": rid, "name": _s(y.get("name")), "width": int(y.get("width") or 32), "desc": y.get("desc") or "", "fields": [], "ev": evx(y)}
        a, rs = to_int(y.get("address")), to_int(y.get("reset"))
        if a is not None:
            r["address"] = a
        if rs is not None:
            r["reset"] = rs
        for f in y.get("fields") or []:
            if is_obj(f) and f.get("name") is not None:
                r["fields"].append({"name": _s(f["name"]), "bits": _s(f.get("bits")), "desc": f.get("desc") or "", "ev": evx(f)})
        m["registers"][rid] = r
    for n in m["nodes"]:
        n["registers"] = [_fix_id(names.get(r.upper(), r)) for r in n["registers"]]
    sids = set()
    for si, y in enumerate(scenes_raw):
        title = _s(y.get("title")) if y.get("title") else ""
        sid = re.sub(r"^_+|_+$", "", re.sub(r"[^A-Za-z0-9_\-]+", "_", title))
        if not sid or not re.match(r"^[A-Za-z_]", sid):
            sid = "scene%d" % (si + 1)
        b0, k = sid, 2
        while sid in sids:
            sid = "%s_%d" % (b0, k)
            k += 1
        sids.add(sid)
        ttl = title or sid
        steps = []
        raw_steps = y.get("steps") if isinstance(y.get("steps"), list) else []
        for i, st in enumerate(raw_steps):
            if not is_obj(st):
                warnings.append("场景 %s 第 %d 步格式不对，已跳过" % (ttl, i + 1))
                continue
            nodes = []
            for x in (st.get("hl") if isinstance(st.get("hl"), list) else []):
                x = _s(x)
                if any(n["id"] == x for n in m["nodes"]):
                    nodes.append(x)
                else:
                    warnings.append("场景 %s 第 %d 步高亮了不存在的模块 %s" % (ttl, i + 1, x))
            edges = []
            for l in (st.get("links") if isinstance(st.get("links"), list) else []):
                parts = [q.strip() for q in _s(l).split(">")]
                a_, b_ = (parts + ["", ""])[:2]
                hit = [e for e in m["edges"] if (endpoint(e["source"])["node"] == a_ and endpoint(e["target"])["node"] == b_) or (endpoint(e["source"])["node"] == b_ and endpoint(e["target"])["node"] == a_)]
                if not hit:
                    warnings.append("场景 %s 第 %d 步的连线 %s 在模型里没有对应的边" % (ttl, i + 1, _s(l)))
                for e in hit:
                    if e["id"] not in edges:
                        edges.append(e["id"])
            writes = []
            for r in (st.get("regs") if isinstance(st.get("regs"), list) else []):
                if not is_obj(r):
                    continue
                rid = _fix_id(_s(r.get("r")).upper())
                if rid not in m["registers"]:
                    warnings.append("场景 %s 第 %d 步写入的寄存器 %s 没有定义，已跳过" % (ttl, i + 1, _s(r.get("r"))))
                    continue
                v = to_int(r.get("v"))
                if v is None or v < 0:
                    warnings.append("场景 %s 第 %d 步寄存器 %s 的值不是数字，已跳过" % (ttl, i + 1, _s(r.get("r"))))
                    continue
                w = {"reg": rid, "value": v}
                if r.get("n"):
                    w["note"] = _s(r["n"])
                writes.append(w)
            step = {"title": _s(st.get("t")) if st.get("t") else "步骤 %d" % (i + 1), "note": _s(st["x"]) if st.get("x") else "", "nodes": nodes, "edges": edges, "writes": writes, "ev": evx(st)}
            if _int(st.get("line")) and st["line"] >= 0:
                step["line"] = int(st["line"])
            steps.append(step)
        m["scenes"].append({"id": sid, "name": ttl, "desc": ("图：" + _s(y["diagram"])) if y.get("diagram") else "", "ev": {"level": "待核对"}, "steps": steps})
    import json as _json
    for ti, body in enumerate(wave_raw):
        label = "时序图 %d" % (ti + 1)
        try:
            y = _json.loads(body)
        except ValueError:
            y = None
        if not is_obj(y) or not isinstance(y.get("signal"), list):
            warnings.append(label + " 不是有效的 WaveDrom（没有 signal 列表），已跳过")
            continue
        sig, skipped = [], []
        for k, sg in enumerate(y["signal"]):
            if is_obj(sg) and sg.get("name") is not None and isinstance(sg.get("wave"), str) and all(c in WAVE_CH for c in sg["wave"]):
                d = sg.get("data")
                sig.append({"name": _s(sg["name"]), "wave": sg["wave"], "data": [_s(x) for x in d] if isinstance(d, list) else [x for x in re.split(r"[ \t\r\n]+", _s("" if d is None else d)) if x]})
            else:
                skipped.append(k + 1)
        if skipped:
            warnings.append(label + " 的第 " + "、".join(str(x) for x in skipped) + " 项（分组 / 不支持的波形字符）已跳过")
        if not sig:
            warnings.append(label + " 没有可迁移的信号，已跳过")
            continue
        cfg = y.get("config") if is_obj(y.get("config")) else {}
        hs = cfg.get("hscale") or y.get("hscale") or 1
        head = y.get("head") if is_obj(y.get("head")) else {}
        m["timings"].append({"id": "timing%d" % (ti + 1), "name": _s(head.get("text") or label), "hscale": int(hs) if _int(hs) and 1 <= hs <= 8 else 1, "signals": sig, "note": "", "ev": {"level": "待核对"}})
    if o.get("path"):
        m["refs"].append({"type": "atlas-page", "path": o["path"]})
    return {"model": normalize(m), "warnings": warnings}


def normalize_layout(l):
    b = {"schema": LAYOUT_SCHEMA, "positions": {}, "collapsed": [], "view": {"mode": "结构", "zoom": 1, "direction": "right"}, "auto": True}
    if not is_obj(l):
        return b
    pos = l["positions"] if is_obj(l.get("positions")) else {}
    view = dict(b["view"])
    if is_obj(l.get("view")):
        view.update(l["view"])
    return {"schema": LAYOUT_SCHEMA, "positions": pos, "collapsed": [_s(x) for x in l["collapsed"]] if isinstance(l.get("collapsed"), list) else [], "view": view,
            "auto": (l.get("auto") is not False and not pos) or l.get("auto") is True}
