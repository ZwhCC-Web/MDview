"""IP model parity: the app (app/js/ip-model.js) and the MCP server (mcp/ip_model.py) must agree on every op, every validation rule, subgraph, diff,
template instantiation, the render adapter and the Markdown-atlas migration.   python mcp/test_ip18.py"""
import json, subprocess, sys, pathlib, importlib.util
here = pathlib.Path(__file__).resolve().parent; root = here.parent
sys.path.insert(0, str(here))
import ip_model as P
spec = importlib.util.spec_from_file_location("srv", here / "chipbench_mcp.py"); srv = importlib.util.module_from_spec(spec); spec.loader.exec_module(srv)
bad = 0
def check(c, n, i=""):
    global bad; print(("PASS " if c else "FAIL ") + n + ("" if c else "  " + str(i)[:600])); bad += 0 if c else 1

node = lambda i, **k: dict(op="add_node", node=dict(id=i, **k))
BASE = [node("cpu", kind="cpu", name="CPU", ports=[dict(id="bus", type="bus", dir="out")]),
        node("can", kind="periph", name="RS-CANFD", ports=[dict(id="bus", type="bus", dir="in"), dict(id="irq", type="irq", dir="out"), dict(id="clk", type="clock", dir="in")]),
        node("intc", kind="irq", ports=[dict(id="in0", type="irq", dir="in")]),
        dict(op="add_edge", edge=dict(source="cpu.bus", target="can.bus")), dict(op="add_edge", edge=dict(source="can.irq", target="intc.in0"))]
REG = [dict(op="define_register", register=dict(id="CFDC", name="Channel control", width=32, address="0xFFC00000", reset=0, fields=[dict(name="PTE", bits="0"), dict(name="DCS", bits="5:4")])),
       dict(op="set_registers", node="can", registers=["CFDC"])]
SCEN = {
 "base": BASE, "base+reg": BASE + REG,
 "dup node": BASE + [node("cpu", kind="cpu")], "bad id": [node("a.b", kind="periph")], "bad kind": [node("z", kind="banana")],
 "bad port type": BASE + [dict(op="add_port", node="cpu", port=dict(id="p", type="wifi", dir="in"))], "bad dir": BASE + [dict(op="add_port", node="cpu", port=dict(id="p", type="data", dir="up"))],
 "dup port": BASE + [dict(op="add_port", node="can", port=dict(id="irq", type="irq", dir="out"))], "edge missing node": BASE + [dict(op="add_edge", edge=dict(source="cpu.bus", target="nope.x"))],
 "edge missing port": BASE + [dict(op="add_edge", edge=dict(source="cpu.bus", target="can.zzz"))], "self edge": BASE + [dict(op="add_edge", edge=dict(source="cpu.bus", target="cpu.bus"))],
 "dup edge": BASE + [dict(op="add_edge", edge=dict(source="cpu.bus", target="can.bus"))], "unknown op": BASE + [dict(op="explode")],
 "parent cycle": BASE + [node("g1", kind="group"), node("g2", kind="group", parent="g1"), dict(op="update_node", id="g1", set=dict(parent="g2"))],
 "update bad key": BASE + [dict(op="update_node", id="can", set=dict(ports=[]))], "param object": BASE + [dict(op="set_param", node="can", key="k", value=dict(a=1))],
 "bad evidence": BASE + [dict(op="set_evidence", target="node:can", ev=dict(level="瞎猜"))], "bad page": BASE + [dict(op="set_evidence", target="node:can", ev=dict(page="abc"))],
 "rename": BASE + [dict(op="rename_node", id="can", to="canfd")], "remove node": BASE + [dict(op="remove_node", id="can")], "remove port": BASE + [dict(op="remove_port", node="can", port="irq")],
 "params+ev": BASE + [dict(op="set_param", node="can", key="channels", value=6), dict(op="set_evidence", target="node:can", ev=dict(level="手册确认", page="3299-3305", sec="31.1")), dict(op="set_meta", set=dict(source="r01.pdf", docrev="1.20"))],
 "bad meta": BASE + [dict(op="set_meta", set=dict(rev=9))], "remove reg": BASE + REG + [dict(op="remove_register", id="CFDC")],
 "reg overflow": BASE + [dict(op="define_register", register=dict(id="R", width=8, reset=0x1FF, address=0x10, fields=[dict(name="A", bits="7:4"), dict(name="B", bits="5"), dict(name="C", bits="9"), dict(name="D", bits="x")])),
                         dict(op="define_register", register=dict(id="R2", width=12, address=0x10)), dict(op="set_registers", node="cpu", registers=["MISSING", "R"])],
 "set_registers replace": BASE + REG + [dict(op="set_registers", node="can", registers=["R9"], replace=True)],
 "orphan+group": BASE + [node("lone", kind="logic"), node("sub", kind="group"), node("ch0", kind="logic", parent="sub")],
 "mismatch": BASE + [dict(op="add_edge", edge=dict(source="can.bus", target="cpu.bus", type="data"))],
 "template": [dict(op="set_meta", set=dict(kind="template"))] + BASE[:1] + [node("x", kind="mem", ev=dict(level="手册确认"))],
}
SCENE = [dict(op="add_scene", scene=dict(id="rx", name="接收", desc="d", steps=[dict(title="采样", note="n", nodes=["cpu", "can"], edges=["e_cpu_bus_can_bus"], writes=[dict(reg="CFDC", value="0x3", note="PTE=1")], line=2, ev=dict(level="手册确认", page=12)), dict(title="中断", nodes=["can", "intc"], edges=["e_can_irq_intc_in0"])]))]
SCEN.update({
 "scene": BASE + REG + SCENE,
 "scene steps": BASE + REG + SCENE + [dict(op="add_step", scene="rx", index=1, step=dict(title="过滤", nodes=["can"])), dict(op="update_step", scene="rx", index=0, set=dict(title="采样 2", note="", line=None, ev=dict(sec="3.1"), writes=[dict(reg="CFDC", value=0x10)])), dict(op="move_step", scene="rx", **{"from": 2, "to": 0}), dict(op="remove_step", scene="rx", index=1), dict(op="update_scene", id="rx", set=dict(name="接收一帧", desc="", ev=dict(level="推导")))],
 "scene dup": BASE + REG + SCENE + SCENE, "scene ghost node": BASE + [dict(op="add_scene", scene=dict(id="a", steps=[dict(title="t", nodes=["ghost"])]))],
 "scene ghost edge": BASE + [dict(op="add_scene", scene=dict(id="a", steps=[dict(title="t", edges=["nope"])]))], "scene ghost reg": BASE + [dict(op="add_scene", scene=dict(id="a", steps=[dict(title="t", writes=[dict(reg="X", value=1)])]))],
 "scene bad value": BASE + REG + [dict(op="add_scene", scene=dict(id="a", steps=[dict(title="t", writes=[dict(reg="CFDC", value="zz")])]))], "scene no title": BASE + [dict(op="add_scene", scene=dict(id="a", steps=[dict(title=" ")]))],
 "scene bad id": BASE + [dict(op="add_scene", scene=dict(id="a.b"))], "scene bad line": BASE + [dict(op="add_scene", scene=dict(id="a", steps=[dict(title="t", line=-1)]))],
 "scene bad ops": BASE + REG + SCENE + [dict(op="update_scene", id="rx", set=dict(steps=[])), dict(op="update_step", scene="rx", index=0, set=dict(id="x")), dict(op="add_step", scene="rx", index=9, step=dict(title="t")), dict(op="remove_step", scene="rx", index=5), dict(op="move_step", scene="rx", **{"from": 0, "to": 7}), dict(op="remove_scene", id="zz"), dict(op="add_step", scene="zz", step=dict(title="t"))],
 "scene empty": BASE + [dict(op="add_scene", scene=dict(id="e", name="空"))], "scene reg overflow": BASE + [dict(op="define_register", register=dict(id="R", width=8)), dict(op="add_scene", scene=dict(id="a", steps=[dict(title="t", writes=[dict(reg="R", value=256)])]))],
 "scene rename": BASE + REG + SCENE + [dict(op="rename_node", id="can", to="canfd")], "scene remove node": BASE + REG + SCENE + [dict(op="remove_node", id="intc")], "scene remove edge": BASE + REG + SCENE + [dict(op="remove_edge", id="e_cpu_bus_can_bus")],
 "scene remove reg": BASE + REG + SCENE + [dict(op="remove_register", id="CFDC")], "scene remove port": BASE + REG + SCENE + [dict(op="remove_port", node="can", port="irq")],
 "scene template": [dict(op="set_meta", set=dict(kind="template"))] + BASE[:1] + [node("x", kind="mem", ev=dict(level="示意")), dict(op="define_register", register=dict(id="R", width=8)), dict(op="add_scene", scene=dict(id="a", ev=dict(level="示意"), steps=[dict(title="t", writes=[dict(reg="R", value=1)])]))],
})
TPL = P.apply(P.create(dict(id="tpl-can", kind="template", name="CAN")), [node("ctl", kind="periph", name="CAN", ev=dict(level="示意"), ports=[dict(id="bus", type="bus", dir="in"), dict(id="irq", type="irq", dir="out")]),
        node("buf", kind="mem", parent="ctl", ev=dict(level="示意")), dict(op="add_edge", edge=dict(id="x", source="ctl.irq", target="buf", type="data"))])["model"]
ATLAS = "---\nip: CAN\nchip: U2B\nsource: r01.pdf\n---\n# CAN\n```ipblock\ntitle: demo\ngroups:\n  - id: grp\n    label: 子系统\nblocks:\n  - id: cpu\n    label: CPU\n    kind: cpu\n    page: 12\n    ev: 手册确认\n  - id: can\n    label: CAN\n    kind: periph\n    group: grp\n    regs: [CFDC]\n    ports: [{id: irq, dir: out}]\nlinks:\n  - {from: cpu, to: can, kind: bus}\n  - {from: can.irq, to: ghost}\n```\n\n```scene\ntitle: 接收一帧\nsteps:\n  - {t: 采样, hl: [cpu, can, ghost], links: [cpu>can, can>nope], regs: [{r: CFDC, v: 0x3, n: PTE=1}, {r: NOPE, v: 1}, {r: CFDC, v: x}], x: \"说明, 有逗号\", line: 4, ev: 手册确认, page: 12}\n  - {t: 下一步, hl: [can]}\n```\n\n```scene\ntitle: 接收一帧\nsteps:\n  - {t: 重名场景}\n```\n\n```register\nname: CFDC\naddress: 0xFFC00000\nwidth: 32\nreset: 0\nfields:\n  - {name: PTE, bits: \"0\"}\n  - {name: DCS, bits: \"5:4\"}\n```\n"
JS = r"""
const I=require(process.argv[1]+'/app/js/ip-model.js'), AM=require(process.argv[1]+'/app/js/atlas-model.js'); const IN=JSON.parse(require('fs').readFileSync(0,'utf8')); const out={scen:{}};
for (const [k,ops] of Object.entries(IN.scen)) { const r=I.apply(I.create({id:'m',name:'M',chip:'U2B'}),ops); out.scen[k]={ok:r.ok,codes:r.errors.map(e=>e.code),model:r.model,validate:I.validate(r.model).map(v=>v.level+':'+v.code),summary:I.summary(r.model),ipblock:I.toIpblock(r.model),ipblockC:I.toIpblock(r.model,{collapsed:['sub']}),
  desc:ops.map(I.describeOp)}; }
const b=I.apply(I.create({id:'m',name:'M'}),IN.scen['base+reg']).model; const big=I.apply(b,IN.big).model;
out.sub=[I.subgraph(big,{node:'sub',depth:0}),I.subgraph(big,{node:'sub',depth:1}),I.subgraph(big,{node:'sub',depth:2}),I.subgraph(big,{node:'cpu'})];
out.diff=[I.diff(b,big),I.diff(big,b),I.diff(b,b)];
out.inst=I.instantiate(IN.tpl,{prefix:'can1',name:'CAN1'}); out.inst2=I.instantiate(IN.tpl,{prefix:'can2',parent:'sub'});
const mg=I.fromAtlas(IN.atlas,AM); out.atlas={model:mg.model,warnings:mg.warnings,validate:I.validate(mg.model).map(v=>v.level+':'+v.code)};
out.layout=[I.normalizeLayout(null),I.normalizeLayout({positions:{a:{x:1,y:2}},collapsed:['q']}),I.normalizeLayout({auto:true,positions:{a:{}}})];
const sc1=out.scen['scene'].model, sc2=out.scen['scene steps'].model; out.diffS=[I.diff(sc1,sc2),I.diff(sc2,sc1),I.diff(sc1,sc1)]; out.subS=I.subgraph(sc1,{node:'can',depth:1});
const bigM=require(process.argv[1]+'/tools/gen-large-ip.js')(100), gids=bigM.nodes.filter(n=>n.kind==='group').map(n=>n.id); out.bigModel=bigM; out.ov=[I.toIpblock(bigM,{collapsed:gids}), I.toIpblock(bigM,{collapsed:gids.slice(0,2)}), I.toIpblock(bigM)];
const TT=require(process.argv[1]+'/app/js/ip-templates.js'); out.tpl={}; for (const k of Object.keys(TT.templates)) out.tpl[k]=TT.instance(k,{id:'inst_'+k,name:'实例 '+k,chip:'U2B',source:'m.pdf',docrev:'1.0',description:'d'});
out.svd=[I.svdOps(IN.svd,{peripheral:'CAN0',node:'can',taken:['CTRL']}),I.svdOps(IN.svd,{}),I.svdOps(IN.svd,{peripheral:'UART0'})];
console.log(JSON.stringify(out));"""
BIG = [node("sub", kind="group"), node("ch0", kind="logic", parent="sub"), node("ch1", kind="logic", parent="sub"), dict(op="add_edge", edge=dict(source="can", target="sub", type="data")), node("far", kind="mem"), dict(op="add_edge", edge=dict(source="sub", target="far", type="data"))]
SVDREGS = [dict(name='CAN0.CTRL', address=0x40000000, width=32, reset=1, desc='ctl', fields=[dict(name='EN', bits='0:0', access='', desc=''), dict(name='MODE', bits='3:1', access='read-write', desc='mode', values={'0': 'NORMAL — n', '2': 'LOOP'}), dict(name='BAD', bits='x')]), dict(name='CAN0.STS', address=0x40000004, width=32, reset=None, fields=[]), dict(name='UART0.DR', address=0x40070000, width=8, reset=0, fields=[]), dict(name='CAN0.1BAD', address=0x40000008, width=0, reset=2**40, fields=[])]
inp = dict(scen=SCEN, big=BIG, tpl=TPL, atlas=ATLAS, svd=SVDREGS)
r = subprocess.run(["node", "-e", JS, str(root)], input=json.dumps(inp), capture_output=True, text=True, encoding="utf-8"); assert r.returncode == 0, r.stderr
J = json.loads(r.stdout)
strip = lambda o: json.loads(json.dumps(o))   # drop None-vs-missing differences the same way JSON does
for k, ops in SCEN.items():
    res = P.apply(P.create(dict(id="m", name="M", chip="U2B")), ops); j = J["scen"][k]
    m = res["model"]
    check(res["ok"] == j["ok"] and [e["code"] for e in res["errors"]] == j["codes"], "scenario ‘%s’: ops accepted/rejected the same" % k, (res["ok"], [e["code"] for e in res["errors"]], j["ok"], j["codes"]))
    check(strip(m) == j["model"], "scenario ‘%s’: resulting model identical" % k, (json.dumps(m, ensure_ascii=False)[:300], json.dumps(j["model"], ensure_ascii=False)[:300]))
    pv = sorted("%s:%s" % (v["level"], v["code"]) for v in P.validate(m)); jv = sorted(j["validate"])
    check(pv == jv, "scenario ‘%s’: validation findings identical" % k, (pv, jv))
    check(strip(P.summary(m)) == j["summary"], "scenario ‘%s’: summary identical" % k)
    check(strip(P.to_ipblock(m)) == j["ipblock"] and strip(P.to_ipblock(m, collapsed=["sub"])) == j["ipblockC"], "scenario ‘%s’: render adapter identical" % k, (P.to_ipblock(m), j["ipblock"]))
    check(not res["ok"] or [P.describe_op(o) for o in ops] == j["desc"], "scenario ‘%s’: op descriptions identical" % k, [(a, b) for a, b in zip([P.describe_op(o) for o in ops], j["desc"]) if a != b][:2])
b = P.apply(P.create(dict(id="m", name="M")), SCEN["base+reg"])["model"]; big = P.apply(b, BIG)["model"]
sub = [P.subgraph(big, "sub", 0), P.subgraph(big, "sub", 1), P.subgraph(big, "sub", 2), P.subgraph(big, "cpu")]
check(all(strip(a) == c for a, c in zip(sub, J["sub"])), "subgraph (depth 0/1/2/default) identical", [(i, json.dumps(strip(a), ensure_ascii=False)[:200]) for i, (a, c) in enumerate(zip(sub, J["sub"])) if strip(a) != c][:1])
check([strip(P.diff(b, big)), strip(P.diff(big, b)), strip(P.diff(b, b))] == J["diff"], "diff identical (added / removed / empty)")
check(strip(P.instantiate(TPL, "can1", name="CAN1")) == J["inst"] and strip(P.instantiate(TPL, "can2", parent="sub")) == J["inst2"], "template instantiation identical")
mg = P.from_atlas(ATLAS, srv.mini_yaml); ja = J["atlas"]
check(strip(mg["model"]) == ja["model"], "atlas migration: model identical", (json.dumps(strip(mg["model"]), ensure_ascii=False)[:400], json.dumps(ja["model"], ensure_ascii=False)[:400]))
check(mg["warnings"] == ja["warnings"] and len(mg["warnings"]) == 5, "atlas migration: the same warnings in the same order (ghost block / link / register, bad value, ...)", (mg["warnings"], ja["warnings"]))
check([x["id"] for x in mg["model"]["scenes"]] == ["scene1", "scene2"] and [len(x["steps"]) for x in mg["model"]["scenes"]] == [2, 1] and mg["model"]["scenes"][0]["steps"][0]["writes"] == [{"reg": "CFDC", "value": 3, "note": "PTE=1"}] and mg["model"]["scenes"][0]["steps"][0]["edges"] == ["e1"], "atlas migration: scenes migrated (ids, steps, writes with notes, link → edge id)", mg["model"]["scenes"][0])
check(sorted("%s:%s" % (v["level"], v["code"]) for v in P.validate(mg["model"])) == sorted(ja["validate"]), "atlas migration: validation identical")
check([P.normalize_layout(None), P.normalize_layout({"positions": {"a": {"x": 1, "y": 2}}, "collapsed": ["q"]}), P.normalize_layout({"auto": True, "positions": {"a": {}}})] == J["layout"], "layout normalisation identical")
smA, smB = P.apply(P.create(dict(id="m", name="M", chip="U2B")), SCEN["scene"])["model"], P.apply(P.create(dict(id="m", name="M", chip="U2B")), SCEN["scene steps"])["model"]
check([strip(P.diff(smA, smB)), strip(P.diff(smB, smA)), strip(P.diff(smA, smA))] == J["diffS"] and J["diffS"][0]["scenes"]["modified"] == ["rx"] and J["diffS"][2]["empty"], "diff: scenes modified / empty identical", J["diffS"][0]["scenes"])
check(strip(P.subgraph(smA, "can", 1)) == J["subS"] and J["subS"]["scenes"] == [], "subgraph drops scenes (a fragment is not the whole story) identically")
bigm = J["bigModel"]; pov = [P.to_ipblock(bigm, collapsed=[n["id"] for n in bigm["nodes"] if n["kind"] == "group"]), P.to_ipblock(bigm, collapsed=[n["id"] for n in bigm["nodes"] if n["kind"] == "group"][:2]), P.to_ipblock(bigm)]
check([strip(x) for x in pov] == J["ov"] and any(l.get("count", 0) > 5 for l in J["ov"][0]["links"]), "overview (all groups collapsed / two collapsed / none): blocks, merged ×N links identical in JS and Python", [(i, len(a["links"]), len(b["links"])) for i, (a, b) in enumerate(zip(pov, J["ov"])) if strip(a) != b][:2])
tdir = root / "templates"
ok_t = True; why = []
for f in sorted(tdir.glob("*.cbip")):
    k = f.stem; tpl = json.loads(f.read_text("utf-8")); py = P.from_template(tpl, "inst_" + k, "实例 " + k, "U2B", "m.pdf", "1.0", "d")
    if strip(py) != J["tpl"].get(k):
        ok_t = False; why.append(k)
check(ok_t and len(list(tdir.glob("*.cbip"))) == 12 and set(J["tpl"]) == {f.stem for f in tdir.glob("*.cbip")}, "template instances: JS instance() and Python from_template() produce identical models for all 12 templates", why)
pyv = [P.svd_ops(SVDREGS, "CAN0", "can", ["CTRL"]), P.svd_ops(SVDREGS), P.svd_ops(SVDREGS, "UART0")]
check([strip(x) for x in pyv] == J["svd"], "SVD import: ops identical in JS and Python (ids, widths, reset guards, evidence, enum text)", [(i, json.dumps(strip(a), ensure_ascii=False)[:300], json.dumps(b, ensure_ascii=False)[:300]) for i, (a, b) in enumerate(zip(pyv, J["svd"])) if strip(a) != b][:1])
print("ALL PASS" if not bad else "%d FAILED" % bad); sys.exit(1 if bad else 0)
