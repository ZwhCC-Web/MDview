"""2.3 parity: the rule expression language and (later) the behaviour engine give identical results in the app (JS) and in the MCP server (Python).   python mcp/test_ip23.py"""
import json, subprocess, sys, pathlib
here = pathlib.Path(__file__).resolve().parent; root = here.parent
sys.path.insert(0, str(here))
import ip_expr as PE
import importlib.util
spec = importlib.util.spec_from_file_location("srv", here / "chipbench_mcp.py"); srv = importlib.util.module_from_spec(spec); spec.loader.exec_module(srv)
bad = 0
def check(c, n, i=""):
    global bad; print(("PASS " if c else "FAIL ") + n + ("" if c else "  " + str(i)[:700])); bad += 0 if c else 1

ENV = {"A": 5, "B": 3, "Z": 0, "R.F": 7, "R.G": 1, "BIG": 2 ** 70, "NEG": -9}
EXPRS = ["1+2*3", "(1+2)*3", "10-3-2", "100/5/2", "1<<2+1", "1<<3 == 8", "A & B == 3", "(A & B) == 3", "1|2^3&1", "1||0&&0", "!A", "!Z", "~0", "-A", "--A", "!!A", "A>B", "A<B", "A>=5", "A<=4", "A!=B", "A==A",
         "A&&B", "A||0", "Z||Z", "Z && 1/0", "A || 1/0", "A && 1/0", "7/2", "-7/2", "7/-2", "-7/-2", "7%3", "-7%3", "7%-3", "-7%-3", "1/0", "1%0", "A/Z", "1<<4", "0xFF>>4", "-16>>2", "1<<64", "1<<-1", "1<<4097", "1<<4096", "1>>-3",
         "BIG*2", "0xFFFFFFFFFFFFFFFF+1", "255", "0xff", "0XFF", "0b1010", "1_000_000", "0xFF_FF", "A", "R.F", "R.F + R.G", "NOPE", "  1 +\n 2 ", "NEG/2", "NEG%4", "NEG>>1", "NEG&0xFF", "~NEG", "BIG>>60", "BIG%1000",
         "1 +", "(1+2", "1 2", "a.b.c", "a..b", "x = 1", '"s"', "'s'", "", "@", "1 + * 2", "foo(1)", "A.B(2)", "Math.max(1,2)", "a[1]", "a{1}", "1;2", "1,2", "A?1:2", "`x`", "$x", "#x", "A=B", "A===B", "A&=1",
         "__proto__", "constructor", "prototype", "A.__proto__", "A.constructor", "prototype.A", "true", "null", "eval", "process", "1+" * 300 + "1", "(" * 100 + "1" + ")" * 100, "-" * 100 + "1", "((((((((((1))))))))))", "-" * 20 + "1",
         "0x", "12ab", "1 0", "5a", "0b2", "0b", "1__0", "_x", "x_", "A.B.C", "A .F", "A. F", "\t1\t", "\u00e9", "1\u2028+2", "9" * 300, "(" + "1" * 10, "!", "~", "-", "()", "( )", "1+()", "A B", "R.F.", ".F", "1.5", "1e3", "0x1G", "0X", "7 ==== 7", "\ufeff1", "1\ufeff+2", "\u00a01", "1\u00a0+\u00a02", "\u180e1", "\u200b1", "\u30001", "1\u2003+ 2", "\u0085 1", "\u001c1", "\u000b1", "\u000c1"]
ACTIONS = ["set CNT = CNT + 1", "  set RFSTS.RFE =  (A>B) ", "set X = A == B", "set X == 1", 'emit "接收 FIFO 满"', 'emit "x" @rx-fifo_0', 'emit ""', 'emit "' + "x" * 121 + '"', 'emit "a"b"', 'emit "a\\b"', 'emit "a\nb"', 'emit "' + "x" * 120 + '"', "set X = 1 +", "delete X", "emit hello", "", "set", "set = 1",
           "set __proto__ = 1", "set A.constructor = 1", "set X = f(1)", "set X = 1; set Y = 2", "set X = Y = 1", 'set X = "s"', "set R.F = BIG", "set  A  =  1", "setX = 1", "set A.B.C = 1", "set A. B = 1", 'emit "x" @', 'emit "x" @1a', 'emit "x"  @n  ', "emit 'x'", 'EMIT "x"', "Set X = 1"]
JS = r"""
const E=require(process.argv[1]+'/app/js/ip-expr.js'); const IN=JSON.parse(require('fs').readFileSync(0,'utf8')); const ENV=IN.env;
const get=(n,f)=>{ const k=f?n+'.'+f:n; return k in ENV ? BigInt(ENV[k]) : 0n; };
const ser=n=>JSON.parse(JSON.stringify(n,(k,v)=>typeof v==='bigint'?'#'+v.toString():v));
const out={expr:[],act:[]};
for (const s of IN.exprs) { const r=E.parse(s); if(!r.ok){ out.expr.push({ok:false,msg:r.msg,pos:r.pos}); continue; } let v=null, err=null; try{ v=E.evaluate(r.ast,get).toString(); }catch(e){ err=e.message; } out.expr.push({ok:true,ast:ser(r.ast),v,err,refs:E.refs(r.ast)}); }
for (const s of IN.acts) { const r=E.parseAction(s); out.act.push(r.ok?{ok:true,kind:r.kind,target:r.target,expr:r.expr?ser(r.expr):null,text:r.text,node:r.node}:{ok:false,msg:r.msg,pos:r.pos}); }
console.log(JSON.stringify(out));"""
r = subprocess.run(["node", "-e", JS, str(root)], input=json.dumps({"exprs": EXPRS, "acts": ACTIONS, "env": {k: str(v) for k, v in ENV.items()}}), capture_output=True, text=True, encoding="utf-8"); assert r.returncode == 0, r.stderr
J = json.loads(r.stdout)
def ser(n):
    if isinstance(n, dict):
        return {k: ser(v) for k, v in n.items()}
    if isinstance(n, list):
        return [ser(x) for x in n]
    if isinstance(n, int) and not isinstance(n, bool):
        return "#%d" % n
    return n
def get(n, f):
    k = n + "." + f if f else n
    return ENV.get(k, 0)
mism = []
for s, j in zip(EXPRS, J["expr"]):
    p = PE.parse(s)
    if not p["ok"]:
        py = {"ok": False, "msg": p["msg"], "pos": p["pos"]}
    else:
        v = err = None
        try:
            v = str(PE.evaluate(p["ast"], get))
        except PE.ExprError as e:
            err = e.msg
        py = {"ok": True, "ast": ser(p["ast"]), "v": v, "err": err, "refs": PE.refs(p["ast"])}
    if py != j:
        mism.append((s[:40], py if not py.get("ast") else {k: v for k, v in py.items() if k != "ast"}, j if not j.get("ast") else {k: v for k, v in j.items() if k != "ast"}))
check(not mism, "expressions: %d inputs (valid, hostile, malformed, unicode, huge) give identical AST / value / error text and position in JS and Python" % len(EXPRS), mism[:2])
check(sum(1 for j in J["expr"] if j["ok"] and not j["err"]) >= 70 and sum(1 for j in J["expr"] if not j["ok"]) >= 50, "the corpus really exercises both sides (>= 70 evaluated, >= 50 refused)", [sum(1 for j in J["expr"] if j["ok"]), sum(1 for j in J["expr"] if not j["ok"])])
mism = []
for s, j in zip(ACTIONS, J["act"]):
    a = PE.parse_action(s)
    py = {"ok": False, "msg": a["msg"], "pos": a["pos"]} if not a["ok"] else {"ok": True, "kind": a["kind"], "target": a.get("target"), "expr": ser(a["expr"]) if a.get("expr") else None, "text": a.get("text"), "node": a.get("node")}
    jj = dict(j)
    if jj.get("ok"):
        jj = {"ok": True, "kind": jj["kind"], "target": jj.get("target"), "expr": jj.get("expr"), "text": jj.get("text"), "node": jj.get("node")}
    if py != jj:
        mism.append((s[:40], py, jj))
check(not mism, "actions: %d inputs give identical results in JS and Python" % len(ACTIONS), mism[:2])

# ================================================================= rules: ops + engine, JS vs Python
import ip_model as PM, ip_sim as PS
def node(i, kind="mem"): return dict(op="add_node", node=dict(id=i, kind=kind))
def reg(i, width=8, fields=(), reset=None):
    r = dict(id=i, width=width, fields=[dict(name=n, bits=b) for n, b in fields])
    if reset is not None: r["reset"] = reset
    return dict(op="define_register", register=r)
BASE = [node("fifo"), node("cpu", "cpu"), reg("STS", 8, [("FULL", "0"), ("IRQ", "1"), ("CNT", "7:4")], 0), reg("EN", 8, [("IE", "0")]), reg("CTRL", 8, [("PUSH", "0"), ("CLR", "1")]), reg("W16", 16, [], 0xFFFF)]
def rule(**k): return dict(op="add_rule", rule=k)
def scene(steps): return dict(op="add_scene", scene=dict(id="s", name="S", steps=steps))
def st(title, *w): return dict(title=title, writes=[dict(reg=a, value=b) for a, b in w])
LV = rule(id="irq", trigger="level", when="STS.FULL && EN.IE", then=["set STS.IRQ = 1"], **{"else": ["set STS.IRQ = 0"]})
EDGE = rule(id="push", trigger="edge", when="CTRL.PUSH", then=["set N = N + 1", 'emit "推入" @fifo'])
RS = {
 "level follows condition": [LV, scene([st("en", ("EN", 1)), st("full", ("STS", 1)), st("dis", ("EN", 0)), st("en again", ("EN", 1))])],
 "edge once per rising edge": [EDGE, scene([st("p1", ("CTRL", 1)), st("hold", ("EN", 1)), st("release", ("CTRL", 0)), st("p2", ("CTRL", 1)), st("p2 held", ("CTRL", 1))])],
 "edge already true at power-on": [rule(id="e", trigger="edge", when="1", then=["set N = N + 1"]), scene([st("a"), st("b")])],
 "level true at power-on": [rule(id="always", trigger="level", when="1", then=["set LINE = 7"]), scene([st("a"), st("b")])],
 "chain edge then level": [EDGE, rule(id="cnt", trigger="level", when="1", then=["set STS.CNT = N"]), scene([st("p1", ("CTRL", 1)), st("r", ("CTRL", 0)), st("p2", ("CTRL", 1))])],
 "attribution per field": [LV, rule(id="full", trigger="edge", when="CTRL.PUSH", then=["set STS.FULL = 1"]), scene([st("en", ("EN", 1)), st("push", ("CTRL", 1))])],
 "bits outside every field": [LV, scene([st("w", ("STS", 0xFF), ("EN", 1))])],
 "register without fields": [scene([st("w", ("W16", 0))])],
 "truncated write": [scene([st("w", ("W16", 0x1FFFF))])],
 "field mask on set": [rule(id="m", trigger="level", when="1", then=["set STS.CNT = 0x1F"]), scene([st("a")])],
 "register mask on set": [rule(id="m", trigger="level", when="1", then=["set STS = 0x1FF"]), scene([st("a")])],
 "oscillation": [rule(id="osc", trigger="level", when="X == 0", then=["set X = 1"], **{"else": ["set X = 0"]}), scene([st("a"), st("b")])],
 "runaway growth": [rule(id="a", trigger="level", when="1", then=["set A = B * B + 2"]), rule(id="b", trigger="level", when="1", then=["set B = A * A"]), scene([st("go"), st("after")])],
 "division by zero in action": [rule(id="d", trigger="level", when="1", then=["set X = 1 / Z"]), scene([st("go")])],
 "error in condition": [rule(id="c", trigger="level", when="1 / Z", then=["set X = 1"]), scene([st("go")])],
 "big numbers": [rule(id="big", trigger="level", when="1", then=["set B = 1 << 80", "set C = B * B"]), scene([st("a")])],
 "negative arithmetic": [rule(id="n", trigger="level", when="1", then=["set N = -7 / 2", "set M = -7 % 3", "set S = -16 >> 2", "set X = ~0"]), scene([st("a")])],
 "evidence and unverified": [dict(op="add_rule", rule=dict(id="irq", trigger="level", when="STS.FULL && EN.IE", then=["set STS.IRQ = 1"], ev=dict(level="手册确认", page=123))), EDGE, scene([st("en", ("EN", 1), ("STS", 1)), st("push", ("CTRL", 1))])],
 "emit order and nodes": [rule(id="a", trigger="edge", when="CTRL.PUSH", then=['emit "一" @fifo', 'emit "二"', 'emit "三" @cpu']), rule(id="b", trigger="edge", when="CTRL.PUSH", then=['emit "四"']), scene([st("p", ("CTRL", 1))])],
 "set whole register from field expr": [rule(id="x", trigger="edge", when="EN.IE", then=["set CTRL = STS.CNT + 3"]), scene([st("en", ("EN", 1))])],
 "no rules": [scene([st("w", ("EN", 1)), st("v", ("CTRL", 3))])],
 "shift edge cases": [rule(id="s", trigger="level", when="1", then=["set A = 1 << 64", "set B = 1 << 4096"]), scene([st("a")])],
 "var read before set": [rule(id="r", trigger="level", when="TYPO > 0", then=["set OUT = 1"]), scene([st("a")])],
}
refuse = {
 "refuse syntax": [rule(id="x", when="STS.FULL &&", then=["set V = 1"])],
 "refuse unknown field": [rule(id="x", when="STS.NOPE", then=["set V = 1"])],
 "refuse field on non-register": [rule(id="x", when="FOO.BAR", then=["set V = 1"])],
 "refuse unknown node": [rule(id="x", trigger="edge", when="1", then=['emit "a" @ghost'])],
 "refuse level self-ref": [rule(id="x", when="1", then=["set V = V + 1"])],
 "refuse level self-ref field": [rule(id="x", when="1", then=["set STS.FULL = STS.FULL ^ 1"])],
 "refuse level self-ref whole": [rule(id="x", when="1", then=["set STS = STS.FULL"])],
 "refuse emit in level": [rule(id="x", when="1", then=['emit "a"'])],
 "refuse else on edge": [rule(id="x", trigger="edge", when="1", then=["set V = 1"], **{"else": ["set V = 0"]})],
 "refuse no action": [rule(id="x", when="1")],
 "syntax error beats no-action": [rule(id="x", when="1 +")],
 "unknown ref beats no-action": [rule(id="x", when="STS.NOPE")],
 "refuse bad trigger": [rule(id="x", trigger="pulse", when="1", then=["set V = 1"])],
 "refuse bad id": [rule(id="1x", when="1", then=["set V = 1"])],
 "refuse too many actions": [rule(id="x", when="1", then=["set V%d = 1" % i for i in range(17)])],
 "refuse duplicate": [LV, LV],
 "refuse bad action": [rule(id="x", when="1", then=["delete V"])],
 "refuse forbidden name": [rule(id="x", when="__proto__", then=["set V = 1"])],
 "refuse remove used register": [LV, dict(op="remove_register", id="STS")],
 "allow remove unused register": [LV, dict(op="remove_register", id="CTRL")],
 "rename node follows emit": [rule(id="e", trigger="edge", when="STS.FULL", then=['emit "满" @fifo']), dict(op="rename_node", id="fifo", to="rxfifo")],
 "remove node drops highlight": [rule(id="e", trigger="edge", when="STS.FULL", then=['emit "满" @fifo']), dict(op="remove_node", id="fifo")],
 "emit text containing @name untouched": [rule(id="e", trigger="edge", when="1", then=['emit "见 @fifo 说明"']), dict(op="rename_node", id="fifo", to="q")],
 "redefine drops a used field": [LV, reg("STS", 8, [("FULL", "0")])],
 "redefine keeps the used fields": [LV, reg("STS", 16, [("FULL", "0"), ("IRQ", "4"), ("X", "9")])],
 "redefine drops an unused field": [LV, reg("STS", 8, [("FULL", "0"), ("IRQ", "1")])],
 "redefine with the rule removed first": [LV, dict(op="remove_rule", id="irq"), reg("STS", 8, [("FULL", "0")])],
 "refuse op named constructor": [dict(op="constructor")],
 "refuse op named __proto__": [dict(op="__proto__")],
 "refuse op named toString": [dict(op="toString")],
 "refuse op list": [dict(op=[])],
 "refuse op dict": [dict(op={})],
 "refuse register id __proto__": [reg("__proto__", 8)],
 "refuse register id toString": [reg("toString", 8)],
 "refuse node id constructor": [node("constructor")],
 "refuse rule id hasOwnProperty": [rule(id="hasOwnProperty", when="1", then=["set A = 1"])],
 "refuse scene id valueOf": [dict(op="add_scene", scene=dict(id="valueOf", steps=[]))],
 "refuse timing id prototype": [dict(op="add_timing", timing=dict(id="prototype", signals=[dict(name="A", wave="0")]))],
 "refuse param key __proto__": [node("fifo2"), dict(op="set_param", node="fifo2", key="__proto__", value=1)],
 "refuse remove register constructor": [dict(op="remove_register", id="constructor")],
 "variables named like inherited properties": [rule(id="v", trigger="level", when="toString + 1 > 0", then=["set valueOf = toString + 5", "set isPrototypeOf = hasOwnProperty + 7"]), scene([st("a")])],
 "update ok": [LV, dict(op="update_rule", id="irq", set=dict(name="新名字", when="STS.FULL", ev=dict(level="手册确认", page=12)))],
 "update refused": [LV, dict(op="update_rule", id="irq", set=dict(when="STS.NOPE"))],
 "update id refused": [LV, dict(op="update_rule", id="irq", set=dict(id="other"))],
 "remove rule": [LV, dict(op="remove_rule", id="irq")],
 "remove missing rule": [dict(op="remove_rule", id="ghost")],
 "whitespace trimmed (ASCII only)": [rule(id="x", when="  STS.FULL\t", then=["  set V = 1 \r\n"])],
 "name default and truncation": [rule(id="x", name="n" * 120, when="1", then=["set V = 1"], note="z" * 400)],
}
SCN = dict(RS); SCN.update(refuse)
JS2 = r"""
const I=require(process.argv[1]+'/app/js/ip-model.js'), S=require(process.argv[1]+'/app/js/ip-sim.js'); const IN=JSON.parse(require('fs').readFileSync(0,'utf8')); const out={};
for (const [k,ops] of Object.entries(IN.scen)) { const r=I.apply(I.create({id:'t',name:'T'}),IN.base.concat(ops)); const o={ok:r.ok,errors:r.errors.map(e=>({code:e.code,msg:e.msg})),model:r.model,validate:I.validate(r.model).map(v=>v.level+':'+v.code).sort(),summary:I.summary(r.model),desc:ops.map(I.describeOp)};
  if (r.ok && r.model.scenes.some(s=>s.id==='s')) { o.sim=S.plain(S.simulate(r.model,'s')); } out[k]=o; }
const a=I.apply(I.create({id:'t',name:'T'}),IN.base.concat([IN.scen['level follows condition'][0]])).model, b=I.apply(a,[{op:'add_rule',rule:{id:'extra',when:'1',then:['set Q = 1']}}]).model; out.diff=[I.diff(a,b),I.diff(b,a),I.diff(a,a)]; out.sub=I.subgraph(b,{node:'fifo',depth:0});
console.log(JSON.stringify(out));"""
r = subprocess.run(["node", "-e", JS2, str(root)], input=json.dumps({"scen": SCN, "base": BASE}), capture_output=True, text=True, encoding="utf-8"); assert r.returncode == 0, r.stderr
J2 = json.loads(r.stdout)
norm = lambda x: json.loads(json.dumps(x, sort_keys=True, ensure_ascii=False))
fail_ops, fail_val, fail_sim, fail_desc = [], [], [], []
for k, ops in SCN.items():
    res = PM.apply(PM.create(dict(id="t", name="T")), BASE + ops); j = J2[k]
    if res["ok"] != j["ok"] or [dict(code=e["code"], msg=e["msg"]) for e in res["errors"]] != j["errors"] or norm(res["model"]) != norm(j["model"]):
        fail_ops.append((k, res["ok"], j["ok"], [e["msg"] for e in res["errors"]][:1], [e["msg"] for e in j["errors"]][:1]))
    if sorted("%s:%s" % (v["level"], v["code"]) for v in PM.validate(res["model"])) != j["validate"] or norm(PM.summary(res["model"])) != norm(j["summary"]):
        fail_val.append(k)
    if res["ok"] and "sim" in j and norm(PS.plain(PS.simulate(res["model"], "s"))) != norm(j["sim"]):
        fail_sim.append(k)
    if not res["ok"] and False: pass
    if [PM.describe_op(o) for o in ops] != j["desc"]:
        fail_desc.append((k, [a for a, b in zip([PM.describe_op(o) for o in ops], j["desc"]) if a != b][:1]))
check(not fail_ops, "rule ops: %d scenarios (accepted, refused with the SAME error code and text, resulting model) identical in JS and Python" % len(SCN), fail_ops[:2])
check(not fail_val, "validation findings and summary identical for every scenario", fail_val[:3])
check(not fail_sim, "simulation: %d scenes replayed — every step's state, changes (with their causes), fired rules, events, passes, errors identical in JS and Python" % sum(1 for j in J2.values() if isinstance(j, dict) and "sim" in j), fail_sim[:3])
check(not fail_desc, "describe_op text identical", fail_desc[:2])
nsim = sum(1 for j in J2.values() if isinstance(j, dict) and "sim" in j); nref = sum(1 for k in refuse if not J2[k]["ok"])
check(nsim >= 20 and nref >= 30, "the corpus really covers both sides (>= 20 simulations, >= 19 refusals)", [nsim, nref])
a = PM.apply(PM.create(dict(id="t", name="T")), BASE + [LV])["model"]; b = PM.apply(a, [dict(op="add_rule", rule=dict(id="extra", when="1", then=["set Q = 1"]))])["model"]
check([norm(PM.diff(a, b)), norm(PM.diff(b, a)), norm(PM.diff(a, a))] == J2["diff"] and norm(PM.subgraph(b, "fifo", 0)) == norm(J2["sub"]) and J2["sub"]["rules"] == [], "diff (rules added / removed / empty) and subgraph (drops rules) identical")
sims = [j["sim"] for j in J2.values() if isinstance(j, dict) and "sim" in j]
check(any(not x["steps"][0]["settled"] for x in sims) and any(any("1024" in e for s in x["steps"] for e in s["errors"]) for x in sims) and any(x["unverified"] for x in sims) and any(any(s["events"] for s in x["steps"]) for x in sims), "…including oscillation, runaway growth, unverified rules and events", None)


# ================================================================= timings, JS vs Python
def tm(**k): return dict(op="add_timing", timing=k)
SPI = dict(id="spi", name="SPI 读", hscale=2, signals=[dict(name="SCK", wave="p......."), dict(name="MOSI", wave="x3.4.5.x", data=["CMD", "ADDR", "DAT"])])
TS = {
 "timing ok": [dict(op="add_timing", timing=SPI)],
 "timing data as string": [tm(id="x", signals=[dict(name="D", wave="3.4", data="A B")])],
 "timing defaults": [tm(id="x", signals=[dict(name="A", wave="01")])],
 "timing name and note truncated": [tm(id="x", name="n" * 120, note="z" * 400, signals=[dict(name="s" * 80, wave="0")])],
 "timing refuse bad char": [tm(id="x", signals=[dict(name="A", wave="01q0")])],
 "timing refuse unicode char": [tm(id="x", signals=[dict(name="A", wave="01é0")])],
 "timing refuse no signals": [tm(id="x", signals=[])],
 "timing refuse too many signals": [tm(id="x", signals=[dict(name="s%d" % i, wave="0") for i in range(33)])],
 "timing refuse unnamed": [tm(id="x", signals=[dict(name=" ", wave="0")])],
 "timing refuse hscale 9": [tm(id="x", hscale=9, signals=[dict(name="A", wave="0")])],
 "timing refuse hscale float": [tm(id="x", hscale=1.5, signals=[dict(name="A", wave="0")])],
 "timing hscale 2.0 ok": [tm(id="x", hscale=2.0, signals=[dict(name="A", wave="0")])],
 "timing refuse bad id": [tm(id="1x", signals=[dict(name="A", wave="0")])],
 "timing refuse duplicate": [dict(op="add_timing", timing=SPI), dict(op="add_timing", timing=SPI)],
 "timing refuse long wave": [tm(id="x", signals=[dict(name="A", wave="0" * 257)])],
 "timing long wave ok": [tm(id="x", signals=[dict(name="A", wave="0" * 256)])],
 "timing refuse 65 labels": [tm(id="x", signals=[dict(name="A", wave="3", data=["d"] * 65)])],
 "timing label count mismatch": [tm(id="x", signals=[dict(name="A", wave="3.4.", data=["one"])])],
 "timing label surplus": [tm(id="x", signals=[dict(name="A", wave="3.4.", data=["a", "b", "c"])])],
 "timing dup signal names": [tm(id="x", signals=[dict(name="A", wave="0"), dict(name="A", wave="1")])],
 "timing update ok": [dict(op="add_timing", timing=SPI), dict(op="update_timing", id="spi", set=dict(name="新名", hscale=3, ev=dict(level="手册确认", page=77)))],
 "timing update refused": [dict(op="add_timing", timing=SPI), dict(op="update_timing", id="spi", set=dict(signals=[dict(name="A", wave="zz!")]))],
 "timing update id refused": [dict(op="add_timing", timing=SPI), dict(op="update_timing", id="spi", set=dict(id="o"))],
 "timing update missing": [dict(op="update_timing", id="nope", set={})],
 "timing remove": [dict(op="add_timing", timing=SPI), dict(op="remove_timing", id="spi")],
 "timing remove missing": [dict(op="remove_timing", id="nope")],
 "timing in a template": [dict(op="set_meta", set=dict(kind="template")), dict(op="add_timing", timing=SPI)],
}
JS3 = r"""
const I=require(process.argv[1]+'/app/js/ip-model.js'), AM=require(process.argv[1]+'/app/js/atlas-model.js'); const IN=JSON.parse(require('fs').readFileSync(0,'utf8')); const out={scen:{}};
for (const [k,ops] of Object.entries(IN.scen)) { const r=I.apply(I.create({id:'t',name:'T'}),ops); out.scen[k]={ok:r.ok,errors:r.errors.map(e=>({code:e.code,msg:e.msg})),model:r.model,validate:I.validate(r.model).map(v=>v.level+':'+v.code).sort(),summary:I.summary(r.model),desc:ops.map(I.describeOp)}; }
const mg=I.fromAtlas(IN.atlas,AM); out.atlas={timings:mg.model.timings,warnings:mg.warnings,validate:I.validate(mg.model).map(v=>v.level+':'+v.code).sort()};
const real=I.fromAtlas(require('fs').readFileSync(process.argv[1]+'/atlas/CAN-FD/RH850-U2B.md','utf8'),AM); out.real={timings:real.model.timings,warnings:real.warnings,validate:I.validate(real.model).map(v=>v.level+':'+v.code).sort()};
console.log(JSON.stringify(out));"""
ATL = "---\nip: X\nchip: Y\n---\n# X\n```wavedrom\n{\"signal\": [{\"name\": \"CLK\", \"wave\": \"p.......\"}, {\"name\": \"D\", \"wave\": \"x3.4.5.x\", \"data\": \"A B C\"}, [\"grp\", {\"name\": \"Q\", \"wave\": \"01\"}], {\"name\": \"Bad\", \"wave\": \"0q1\"}], \"config\": {\"hscale\": 2}}\n```\n\n```wavedrom\nnot json at all\n```\n\n```wavedrom\n{\"signal\": [[\"only\", {\"name\": \"A\", \"wave\": \"0\"}]]}\n```\n\n```wavedrom\n{\"signal\": [{\"name\": \"P\", \"wave\": \"p.\"}], \"head\": {\"text\": \"带标题\"}, \"config\": {\"hscale\": 9}}\n```\n"
r = subprocess.run(["node", "-e", JS3, str(root)], input=json.dumps({"scen": TS, "atlas": ATL}), capture_output=True, text=True, encoding="utf-8"); assert r.returncode == 0, r.stderr
J3 = json.loads(r.stdout)
f_ops, f_val, f_desc = [], [], []
for k, ops in TS.items():
    res = PM.apply(PM.create(dict(id="t", name="T")), ops); j = J3["scen"][k]
    if res["ok"] != j["ok"] or [dict(code=e["code"], msg=e["msg"]) for e in res["errors"]] != j["errors"] or norm(res["model"]) != norm(j["model"]):
        f_ops.append((k, [e["msg"] for e in res["errors"]][:1], [e["msg"] for e in j["errors"]][:1]))
    if sorted("%s:%s" % (v["level"], v["code"]) for v in PM.validate(res["model"])) != j["validate"] or norm(PM.summary(res["model"])) != norm(j["summary"]):
        f_val.append(k)
    if [PM.describe_op(o) for o in ops] != j["desc"]:
        f_desc.append(k)
check(not f_ops, "timing ops: %d scenarios (accepted / refused with the SAME code and text / resulting model) identical in JS and Python" % len(TS), f_ops[:2])
check(not f_val and not f_desc, "timing validation findings, summary and op descriptions identical", [f_val[:3], f_desc[:3]])
mg = PM.from_atlas(ATL, srv.mini_yaml)
check(norm(mg["model"]["timings"]) == norm(J3["atlas"]["timings"]) and mg["warnings"] == J3["atlas"]["warnings"] and sorted("%s:%s" % (v["level"], v["code"]) for v in PM.validate(mg["model"])) == J3["atlas"]["validate"], "atlas ```wavedrom migration: timings, warning text and validation identical (groups, bad chars, unreadable blocks, hscale out of range, head text)", [mg["warnings"], J3["atlas"]["warnings"]])
check(len(J3["atlas"]["timings"]) == 2 and any("第 3、4 项" in w for w in J3["atlas"]["warnings"]) and any("没有 signal" in w for w in J3["atlas"]["warnings"]) and any("没有可迁移" in w for w in J3["atlas"]["warnings"]) and J3["atlas"]["timings"][1]["name"] == "带标题" and J3["atlas"]["timings"][1]["hscale"] == 1, "…and the migration cases are really there", J3["atlas"])
real_txt = (root / "atlas" / "CAN-FD" / "RH850-U2B.md").read_text("utf-8"); pr = PM.from_atlas(real_txt, srv.mini_yaml)
check(norm(pr["model"]["timings"]) == norm(J3["real"]["timings"]) and pr["warnings"] == J3["real"]["warnings"] and len(J3["real"]["timings"]) == 2, "the bundled CAN-FD page: its 2 waveforms migrate identically in JS and Python", [len(pr["model"]["timings"]), len(J3["real"]["timings"])])
check("warn:timing-data" in J3["real"]["validate"] and any("timing-data" in x for x in J3["real"]["validate"]), "…and validation finds the real label-count mismatch in the shipped page (CAN0TX: 8 cells, 9 labels)", J3["real"]["validate"])

print("ALL PASS" if not bad else "%d FAILED" % bad); sys.exit(1 if bad else 0)
