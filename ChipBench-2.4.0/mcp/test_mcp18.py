"""1.8 MCP: the IP-model tools over stdio — propose / write, atomicity, templates, atlas import, read-only mode, dry run, path safety.   python mcp/test_mcp18.py"""
import json, os, subprocess, sys, tempfile, pathlib, hashlib
here = pathlib.Path(__file__).resolve().parent
T = lambda: pathlib.Path(tempfile.mkdtemp())
ws, data = T(), T()
(ws / "n.md").write_text("# 笔记\n\n见 [[can0]] 和 can0.cbip\n", encoding="utf-8")
(ws / "x.txt").write_text("not a model", encoding="utf-8")
env = dict(os.environ, CHIPBENCH_HOME=str(data), CHIPBENCH_STATE=str(data / "nostate.json"), PYTHONIOENCODING="utf-8"); env.pop("CHIPBENCH_MCP_LEVEL", None)
def start(level=None):
    e = dict(env); 
    if level: e["CHIPBENCH_MCP_LEVEL"] = level
    return subprocess.Popen([sys.executable, str(here / "chipbench_mcp.py"), "--root", str(ws)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=e, text=True, encoding="utf-8")
p = start(); n = 0; bad = 0
def rpc(method, params=None):
    global n
    n += 1; p.stdin.write(json.dumps({"jsonrpc": "2.0", "id": n, "method": method, "params": params or {}}) + "\n"); p.stdin.flush(); return json.loads(p.stdout.readline())
def call(tool, **a):
    r = rpc("tools/call", {"name": tool, "arguments": a})
    if "error" in r: return True, r["error"]["message"]
    r = r["result"]; return r["isError"], r["content"][0]["text"]
def check(c, name, info=""):
    global bad; print(("PASS " if c else "FAIL ") + name + ("" if c else "  " + str(info)[:500])); bad += 0 if c else 1
sha = lambda f: hashlib.sha1((ws / f).read_bytes()).hexdigest()
rpc("initialize", {"protocolVersion": "2025-06-18", "clientInfo": {"name": "t", "title": "TestAI"}})
tools = {t["name"]: t for t in rpc("tools/list")["result"]["tools"]}
IPT = ["ip_list", "ip_read", "ip_validate", "ip_references", "ip_diff", "ip_proposal", "ip_create", "ip_edit", "ip_instantiate", "ip_import_atlas", "ip_import_svd", "ip_templates", "ip_simulate"]
check(all(t in tools for t in IPT), "all 13 IP tools are listed", [t for t in IPT if t not in tools])
check(tools["ip_read"]["annotations"]["readOnlyHint"] and not tools["ip_edit"]["annotations"]["readOnlyHint"] and "dry_run" in tools["ip_edit"]["inputSchema"]["properties"], "read-only hints and dry_run on writers")
check(len(tools) >= 50, "tool count (%d)" % len(tools))
err, t = call("ip_list"); check(not err and "No IP models" in t, "ip_list: empty workspace", t)
err, t = call("ip_create", path="IP/can0", name="CAN0", chip="RH850/U2B", source="r01uh0001.pdf", docrev="1.2"); check(not err and "created" in t and (ws / "IP" / "can0.cbip").exists(), "ip_create makes IP/can0.cbip", t)
err, t = call("ip_create", path="IP/can0"); check(err and "already exists" in t, "ip_create refuses to overwrite", t)
err, t = call("ip_create", path="../escape"); check(err, "ip_create refuses paths outside the workspace", t)
err, t = call("ip_create", path="IP/k", kind="bogus"); check(err, "ip_create validates kind", t)
BASE = [{"op": "add_node", "node": {"id": "cpu", "kind": "cpu", "name": "CPU", "ports": [{"id": "bus", "type": "bus", "dir": "out"}]}},
        {"op": "add_node", "node": {"id": "can", "kind": "periph", "name": "RS-CANFD", "ports": [{"id": "bus", "type": "bus", "dir": "in"}, {"id": "irq", "type": "irq", "dir": "out"}]}},
        {"op": "add_edge", "edge": {"source": "cpu.bus", "target": "can.bus"}}]
before = sha("IP/can0.cbip")
err, t = call("ip_edit", path="IP/can0", ops=BASE, title="初始结构", note="from manual ch.31"); check(not err and "PROPOSED" in t and sha("IP/can0.cbip") == before, "ip_edit defaults to a proposal; the model file is untouched", t)
check((ws / "IP" / "can0.cbip.proposal.json").exists(), "proposal sidecar exists next to the model")
pr = json.loads((ws / "IP" / "can0.cbip.proposal.json").read_text("utf-8")); check(pr["schema"] == "chipbench.ip.proposal/1" and pr["base_rev"] == 1 and len(pr["ops"]) == 3 and pr["title"] == "初始结构" and pr["client"] == "TestAI" and len(pr["described"]) == 3, "proposal content", pr)
err, t = call("ip_read", path="IP/can0"); check(not err and "proposal with 3 op" in t and "cpu" not in t.split("NOTE")[1].split("\n", 1)[1], "ip_read warns about the pending proposal and does not show its content", t)
err, t = call("ip_proposal", path="IP/can0"); j = json.loads(t); check(not err and j["applies_cleanly"] and not j["stale"] and j["diff"]["nodes"]["added"] == ["cpu", "can"] and len(j["changes"]) == 3, "ip_proposal shows what would change", t)
err, t = call("ip_diff", path="IP/can0"); check(not err and "diff_if_accepted" in t and '"cpu"' in t, "ip_diff vs proposal", t)
err, t = call("ip_edit", path="IP/can0", ops=[{"op": "set_param", "node": "can", "key": "channels", "value": 6}, {"op": "set_evidence", "target": "node:can", "ev": {"level": "手册确认", "page": "3299"}}]); check(not err and "5 in total" in t, "a second proposal stacks on the first (validated against model + pending ops)", t)
err, t = call("ip_edit", path="IP/can0", ops=[{"op": "add_edge", "edge": {"source": "cpu.bus", "target": "ghost.p"}}, {"op": "add_node", "node": {"id": "bad.id", "kind": "periph"}}]); check(not err and "REJECTED" in t and "no-node" in t and "bad-id" in t, "invalid batch is rejected with every problem listed", t)
pr = json.loads((ws / "IP" / "can0.cbip.proposal.json").read_text("utf-8")); check(len(pr["ops"]) == 5, "rejected ops are not stored")
err, t = call("ip_edit", path="IP/can0", ops=[{"op": "explode"}]); check("REJECTED" in t and "add_node" in t, "unknown op lists the valid ones", t)
err, t = call("ip_edit", path="IP/can0", ops="[]"); check(err, "empty ops are an error", t)
err, t = call("ip_edit", path="IP/can0", ops=BASE, mode="yolo"); check(err and "mode" in t, "bad mode is an error", t)
err, t = call("ip_edit", path="IP/x.txt", ops=BASE); check(err and "not" in t.lower(), "a non-model file is refused", t)
err, t = call("ip_proposal", path="IP/can0", action="discard"); check(not err and "discarded" in t and not (ws / "IP" / "can0.cbip.proposal.json").exists(), "ip_proposal discard removes the sidecar", t)
act = [json.loads(l) for l in (data / "mcp-activity.jsonl").read_text("utf-8").splitlines()]; check(any(a["op"] == "delete" and a.get("backup") for a in act), "discard is in the activity log with a backup (so it can be undone)", [a["op"] for a in act])
err, t = call("ip_proposal", path="IP/can0"); check("No pending proposal" in t, "no proposal any more")
err, t = call("ip_edit", path="IP/can0", ops=BASE, mode="write"); m = json.loads((ws / "IP" / "can0.cbip").read_text("utf-8")); check(not err and "applied" in t and len(m["nodes"]) == 2 and m["rev"] == 2 and not (ws / "IP" / "can0.cbip.proposal.json").exists(), "mode=write applies directly (rev bumped)", t)
check(any(a["op"] == "modify" and a.get("backup") for a in [json.loads(l) for l in (data / "mcp-activity.jsonl").read_text("utf-8").splitlines()]), "the write kept a backup")
lay = ws / "IP" / "can0.cbip.layout.json"; lay.write_text(json.dumps({"schema": "chipbench.ip.layout/1", "positions": {"cpu": {"x": 5, "y": 6}}}), "utf-8"); h = sha("IP/can0.cbip.layout.json")
call("ip_edit", path="IP/can0", ops=[{"op": "update_node", "id": "cpu", "set": {"name": "Core"}}], mode="write"); check(sha("IP/can0.cbip.layout.json") == h, "the user's layout sidecar is never touched")
err, t = call("ip_validate", path="IP/can0"); j = json.loads(t); check(not err and j["errors"] == 0 and j["path"].endswith("can0.cbip"), "ip_validate: clean model", t)
call("ip_edit", path="IP/can0", ops=[{"op": "define_register", "register": {"id": "CFDC", "width": 8, "reset": 511, "fields": [{"name": "A", "bits": "9:8"}]}}], mode="write"); err, t = call("ip_validate", path="IP/can0"); j = json.loads(t); check(j["errors"] == 2 and {f["code"] for f in j["findings"]} >= {"reg-reset", "reg-bits"}, "ip_validate finds register range errors", t)
err, t = call("ip_edit", path="IP/can0", ops=[{"op": "remove_register", "id": "CFDC"}], mode="write"); check(not err, "remove the bad register again", t)
err, t = call("ip_edit", path="IP/can0", ops=[{"op": "add_node", "node": {"id": "x1", "kind": "logic"}}, {"op": "add_edge", "edge": {"source": "x1", "target": "can.irq", "type": "irq"}}], mode="write"); check(not err and "New findings" in t and "输出端口" in t, "write reports NEW findings it introduced", t)
err, t = call("ip_read", path="IP/can0", node="can", depth=0); check(not err and "RS-CANFD" in t and "cpu [" not in t and "sub-graph" in t, "ip_read node+depth returns a sub-graph", t)
err, t = call("ip_read", path="IP/can0", format="json"); check(not err and json.loads(t)["schema"] == "chipbench.ip/1", "ip_read json")
err, t = call("ip_read", path="IP/can0", format="summary"); check(not err and json.loads(t)["nodes"] >= 2, "ip_read summary")
err, t = call("ip_read", path="IP/nope"); check(err, "ip_read: missing model is an error", t)
# templates
TP = [{"op": "add_node", "node": {"id": "ctl", "kind": "periph", "name": "通用 CAN", "ev": {"level": "示意"}, "ports": [{"id": "bus", "type": "bus", "dir": "in"}, {"id": "irq", "type": "irq", "dir": "out"}]}},
      {"op": "add_node", "node": {"id": "buf", "kind": "mem", "parent": "ctl", "ev": {"level": "示意"}}}, {"op": "add_edge", "edge": {"id": "x", "source": "ctl.irq", "target": "buf", "type": "data"}}]
call("ip_create", path="IP/tpl-can", name="CAN template", kind="template"); err, t = call("ip_edit", path="IP/tpl-can", ops=TP, mode="write"); check(not err, "build a template", t)
err, t = call("ip_validate", path="IP/tpl-can"); check(json.loads(t)["errors"] == 0 and not any(f["code"] == "template-fact" for f in json.loads(t)["findings"]), "template: structure only, no facts", t)
err, t = call("ip_instantiate", path="IP/can0", template="IP/tpl-can", prefix="can1", name="CAN1"); check(not err and "PROPOSED" in t, "ip_instantiate proposes", t)
err, t = call("ip_proposal", path="IP/can0"); j = json.loads(t); check(j["applies_cleanly"] and "can1_buf" in json.dumps(j["diff"]), "proposal contains the instantiated nodes", t)
err, t = call("ip_instantiate", path="IP/can0", template="IP/tpl-can", prefix="can1", mode="write"); check(not err and "applied" in t, "ip_instantiate mode=write applies", t)
err, t = call("ip_proposal", path="IP/can0", action="discard")
err, t = call("ip_instantiate", path="IP/can0", template="IP/tpl-can", prefix="can1", mode="write"); check("REJECTED" in t and "dup-node" in t, "instantiating the same prefix twice is rejected atomically", t)
err, t = call("ip_instantiate", path="IP/can0", template="IP/tpl-can", prefix="bad.prefix"); check(err, "bad prefix is an error", t)
# diff between models
err, t = call("ip_diff", path="IP/can0", against="IP/tpl-can"); check(not err and "removed" in t, "ip_diff between two models", t)
# atlas import
err, t = call("ip_import_atlas", page="CAN-FD/RH850/U2B"); check(not err and "Migrated" in t, "ip_import_atlas converts the bundled page", t)
files = [str(f.relative_to(ws)).replace("\\", "/") for f in ws.rglob("*.cbip")]; check(any("IP图谱" in f for f in files), "…into IP图谱/ of the workspace", files)
imp = next(f for f in files if "IP图谱" in f); err, t = call("ip_validate", path=imp); j = json.loads(t); check(not err and j["errors"] == 0, "imported model validates without errors", t)
err, t = call("ip_read", path=imp, format="summary"); check(json.loads(t)["scenes"] == 3, "…and carries the 3 scenes of the CAN-FD page", t)
err, t = call("ip_import_atlas", page="CAN-FD/RH850/U2B"); check(err and "already exists" in t, "import does not overwrite", t)
err, t = call("ip_list"); j = json.loads(t); check(not err and j["count"] >= 3 and all("path" in r for r in j["models"]), "ip_list now lists models", t)
err, t = call("ip_references", path="IP/can0"); j = json.loads(t); check(not err and "n.md" in j["referenced_by_notes"], "ip_references finds the note that links the model", t)
# SVD import
(ws / "t.svd").write_text('<device><peripherals><peripheral><name>CAN0</name><baseAddress>0x40000000</baseAddress><registers><register><name>CTRL</name><addressOffset>0x0</addressOffset><size>32</size><resetValue>0x1</resetValue><fields><field><name>EN</name><bitOffset>0</bitOffset><bitWidth>1</bitWidth></field><field><name>MODE</name><bitOffset>1</bitOffset><bitWidth>3</bitWidth><enumeratedValues><enumeratedValue><name>NORMAL</name><value>0</value></enumeratedValue><enumeratedValue><name>LOOP</name><value>2</value></enumeratedValue></enumeratedValues></field></fields></register></registers></peripheral></peripherals></device>', encoding="utf-8")
(ws / "mcu.svd").write_text('<device><peripherals><peripheral><name>CAN0</name><baseAddress>0x40050000</baseAddress><registers><register><name>A</name><addressOffset>0</addressOffset></register></registers></peripheral><peripheral><name>UART0</name><baseAddress>0x40070000</baseAddress><registers><register><name>DR</name><addressOffset>0</addressOffset><size>8</size></register></registers></peripheral></peripherals></device>', encoding="utf-8")
call("ip_create", path="IP/svd1", name="SVD1"); call("ip_edit", path="IP/svd1", ops=[{"op": "add_node", "node": {"id": "can", "kind": "periph"}}], mode="write")
err, t = call("ip_import_svd", path="IP/svd1", svd="t.svd", node="can"); check(not err and "PROPOSED" in t and "CTRL" in t, "ip_import_svd proposes the registers of the single peripheral", t)
pr = json.loads((ws / "IP" / "svd1.cbip.proposal.json").read_text("utf-8")); rg = next(o for o in pr["ops"] if o["op"] == "define_register")["register"]
check(rg["id"] == "CTRL" and rg["address"] == 0x40000000 and rg["reset"] == 1 and [f["name"] for f in rg["fields"]] == ["EN", "MODE"] and rg["ev"] == {"level": "待核对", "sec": "SVD"} and "LOOP" in rg["fields"][1]["desc"], "…with address, reset, fields, enum text and evidence 待核对/SVD", rg)
check(pr["ops"][-1] == {"op": "set_registers", "node": "can", "registers": ["CTRL"]}, "…and attaches them to the node", pr["ops"][-1])
call("ip_proposal", path="IP/svd1", action="discard")
err, t = call("ip_import_svd", path="IP/svd1", svd="mcu.svd"); check(err and "peripheral" in t and "CAN0" in t and "UART0" in t, "several peripherals: the error lists them", t)
err, t = call("ip_import_svd", path="IP/svd1", svd="t.svd", peripheral="NOPE"); check(err and "not in the SVD" in t, "unknown peripheral is an error", t)
err, t = call("ip_import_svd", path="IP/svd1", svd="t.svd", node="ghost"); check(err and "not in the model" in t, "unknown node is an error", t)
err, t = call("ip_import_svd", path="IP/svd1", svd="x.txt"); check(err, "a non-SVD file is an error", t)
err, t = call("ip_import_svd", path="IP/svd1", svd="t.svd", node="can", mode="write"); m = json.loads((ws / "IP" / "svd1.cbip").read_text("utf-8")); check(not err and "CTRL" in m["registers"] and m["nodes"][0]["registers"] == ["CTRL"], "mode=write applies directly", t)
err, t = call("ip_import_svd", path="IP/svd1", svd="t.svd", mode="write"); m = json.loads((ws / "IP" / "svd1.cbip").read_text("utf-8")); check(not err and "CTRL_2" in m["registers"] and "CTRL" in m["registers"], "importing again never overwrites (suffix _2)", list(m["registers"]))
# scenes through MCP
call("ip_create", path="IP/sc1", name="SC1")
SC = [{"op": "add_node", "node": {"id": "cpu", "kind": "cpu", "ports": [{"id": "bus", "type": "bus", "dir": "out"}]}}, {"op": "add_node", "node": {"id": "can", "kind": "periph", "ports": [{"id": "bus", "type": "bus", "dir": "in"}]}}, {"op": "add_edge", "edge": {"id": "e1", "source": "cpu.bus", "target": "can.bus"}},
      {"op": "define_register", "register": {"id": "CTRL", "width": 8, "fields": [{"name": "EN", "bits": "0"}]}}, {"op": "add_scene", "scene": {"id": "init", "name": "初始化", "steps": [{"title": "使能", "nodes": ["cpu", "can"], "edges": ["e1"], "writes": [{"reg": "CTRL", "value": 1, "note": "EN=1"}]}]}}]
err, t = call("ip_edit", path="IP/sc1", ops=SC, mode="write"); check(not err and "添加场景 init" in t, "ip_edit applies scene ops (and describes them)", t)
err, t = call("ip_read", path="IP/sc1"); check(not err and "scenes:" in t and "1. 使能" in t and "CTRL=0x1 (EN=1)" in t and "edges: e1" in t, "ip_read lists scenes with steps, highlights and writes", t)
err, t = call("ip_edit", path="IP/sc1", ops=[{"op": "add_step", "scene": "init", "step": {"title": "等待", "nodes": ["ghost"]}}]); check("REJECTED" in t and "no-node" in t, "a step that highlights a missing node is rejected", t)
err, t = call("ip_edit", path="IP/sc1", ops=[{"op": "add_step", "scene": "init", "step": {"title": "写错值", "writes": [{"reg": "CTRL", "value": "0xZZ"}]}}]); check("REJECTED" in t and "bad-write" in t, "a non-numeric register value is rejected", t)
err, t = call("ip_edit", path="IP/sc1", ops=[{"op": "add_step", "scene": "init", "step": {"title": "等待", "nodes": ["can"]}}]); check(not err and "PROPOSED" in t and "场景 init 添加步骤：等待" in t, "scene edits default to a proposal as well", t)
call("ip_proposal", path="IP/sc1", action="discard")
err, t = call("ip_edit", path="IP/sc1", ops=[{"op": "rename_node", "id": "can", "to": "canfd"}], mode="write"); err, t = call("ip_read", path="IP/sc1"); check("nodes: cpu, canfd" in t, "renaming a node updates the scene highlights", t)
err, t = call("ip_validate", path="IP/sc1"); j = json.loads(t); check(j["errors"] == 0, "scene model validates", t)
err, t = call("ip_list"); j = json.loads(t); check(any(r.get("scenes") == 1 for r in j["models"]), "ip_list shows the scene count", t)
# built-in templates
err, t = call("ip_templates"); j = json.loads(t); keys = [x["key"] for x in j["templates"]]; check(not err and j["count"] == 12 and "gtm" in keys and "flash" in keys and "core" in keys and all(x["nodes"] >= 6 for x in j["templates"]), "ip_templates lists the 12 built-in templates", keys)
check(all("bus:bus/in" in x["top_ports"] and any(p.startswith("irq:") for p in x["top_ports"]) for x in j["templates"]) and "只描述结构" in j["templates"][0]["note"], "…with their boundary ports and the structure-only note")
err, t = call("ip_create", path="IP/fl", template="flash", name="U2B Flash", chip="RH850/U2B", source="r01.pdf"); m = json.loads((ws / "IP" / "fl.cbip").read_text("utf-8")); check(not err and "Started from built-in template" in t and m["kind"] == "instance" and m["extends"] == "tpl-flash" and m["chip"] == "RH850/U2B" and len(m["nodes"]) == 9 and all(n["ev"]["level"] == "待核对" for n in m["nodes"]), "ip_create(template=flash): an instance with 9 nodes, all 待核对, extends the template", t)
err, t = call("ip_validate", path="IP/fl"); j = json.loads(t); check(not err and j["errors"] == 0, "…and it validates", t)
err, t = call("ip_create", path="IP/bad", template="nope"); check(err and "no built-in template" in t and "gtm" in t, "unknown template: the error lists the available keys", t)
err, t = call("ip_create", path="IP/bad2", template="../../etc/passwd"); check(err, "a path-like template key is refused", t)
err, t = call("ip_create", path="IP/bad3", template="flash", kind="template"); check(err and "instance" in t, "template= with kind=template is refused", t)
err, t = call("ip_create", path="IP/host", name="Host"); err, t = call("ip_instantiate", path="IP/host", template="builtin:ram", prefix="ram0", name="RAM0", mode="write"); m = json.loads((ws / "IP" / "host.cbip").read_text("utf-8")); check(not err and "applied" in t and any(n["id"] == "ram0" for n in m["nodes"]) and any(n.get("parent") == "ram0" for n in m["nodes"]), "ip_instantiate(template=builtin:ram) adds it into a model", t)
err, t = call("ip_instantiate", path="IP/host", template="builtin:gtm", prefix="gtm0"); check(not err and "PROPOSED" in t, "…and by default it is a proposal like every other edit", t); call("ip_proposal", path="IP/host", action="discard")
err, t = call("ip_instantiate", path="IP/host", template="builtin:nope", prefix="x"); check(err and "no built-in template" in t, "unknown builtin in ip_instantiate", t)
# behaviour rules + ip_simulate
call("ip_create", path="IP/rl", name="Rules")
RS = [{"op": "add_node", "node": {"id": "fifo", "kind": "mem"}}, {"op": "define_register", "register": {"id": "STS", "width": 8, "fields": [{"name": "FULL", "bits": "0"}, {"name": "IRQ", "bits": "1"}]}}, {"op": "define_register", "register": {"id": "EN", "width": 8, "fields": [{"name": "IE", "bits": "0"}]}},
      {"op": "add_scene", "scene": {"id": "s", "name": "接收", "steps": [{"title": "使能", "writes": [{"reg": "EN", "value": 1}]}, {"title": "FIFO 满", "writes": [{"reg": "STS", "value": 1}]}]}}]
err, t = call("ip_edit", path="IP/rl", ops=RS, mode="write"); check(not err, "setup: model with registers and a scene", t)
err, t = call("ip_simulate", path="IP/rl", scene="s"); check(not err and "NO rules" in t and "NOT a statement of the manual" in t and "ONLY where the manual states" in t and "EN.IE 0→1 [写入]" in t, "a model without rules: the simulation says nothing is derived, warns, and only replays the writes (it invents nothing)", t)
RULE = {"op": "add_rule", "rule": {"id": "irq", "name": "中断线", "trigger": "level", "when": "STS.FULL && EN.IE", "then": ["set STS.IRQ = 1"], "else": ["set STS.IRQ = 0"], "ev": {"level": "待核对"}}}
err, t = call("ip_edit", path="IP/rl", ops=[RULE]); check(not err and "PROPOSED" in t and "添加规则 irq" in t, "a rule is a PROPOSAL by default, like every other edit", t)
check(not any("rules" in l for l in call("ip_read", path="IP/rl")[1].splitlines() if l.startswith("rules")), "…and the proposal is not in the model until accepted")
call("ip_proposal", path="IP/rl", action="discard")
err, t = call("ip_edit", path="IP/rl", ops=[RULE], mode="write"); check(not err and "applied" in t, "mode=write applies the rule", t)
err, t = call("ip_simulate", path="IP/rl", scene="s"); check(not err and "1 rule(s)" in t and "irq (待核对)" in t and "⚠ Rules used here without manual" in t and "STS.IRQ 0→1 [irq]" in t and "rules that acted: irq" in t, "with a rule: the derived change names the rule, and the unverified rule is flagged as a hypothesis", t)
check("NO rules" not in t and "推导" in t, "…and it is labelled 推导")
err, t = call("ip_simulate", path="IP/rl", scene="s", step=2); check(not err and "Step 2" in t and "Step 1" not in t, "step=2 shows just that step", t)
err, t = call("ip_simulate", path="IP/rl", scene="s", step=9); check(err and "does not exist" in t, "a missing step is an error", t)
err, t = call("ip_simulate", path="IP/rl", scene="nope"); check(err and "not in the model" in t and "s" in t, "a missing scene is an error that lists the available ones", t)
err, t = call("ip_simulate", path="IP/rl", scene="s", format="json"); j = json.loads(t); check(not err and j["confidence"] == "推导" and j["steps"][1]["state"]["regs"]["STS"] == 3 and j["unverified"] == ["irq"], "format=json returns the structured result", t[:200])
err, t = call("ip_edit", path="IP/rl", ops=[{"op": "update_rule", "id": "irq", "set": {"ev": {"level": "手册确认", "page": 123}}}], mode="write"); err, t = call("ip_simulate", path="IP/rl", scene="s"); check("irq (手册确认 p.123)" in t and "⚠ Rules used here without manual" not in t, "once the rule has 手册确认 + a page the warning goes away and the page is shown", t)
err, t = call("ip_read", path="IP/rl"); check(not err and "rules (behaviour taken from the manual" in t and "irq [level] 中断线 {手册确认 p.123}: when STS.FULL && EN.IE" in t and "then: set STS.IRQ = 1" in t and "else: set STS.IRQ = 0" in t, "ip_read lists the rules with trigger, evidence, condition and actions", t)
err, t = call("ip_list"); check(any(r.get("rules") == 1 for r in json.loads(t)["models"]), "ip_list shows the rule count", t)
for bad_rule, why in (({"id": "x", "when": "STS.NOPE", "then": ["set V = 1"]}, "unknown field"), ({"id": "x", "when": "1", "then": ["set V = V + 1"]}, "level self-reference"), ({"id": "x", "when": "foo(1)", "then": ["set V = 1"]}, "function call"), ({"id": "x", "trigger": "edge", "when": "1", "then": ["set V = 1; set W = 2"]}, "two statements")):
    err, t = call("ip_edit", path="IP/rl", ops=[{"op": "add_rule", "rule": bad_rule}]); check(not err and "REJECTED" in t, "refused with a reason: " + why, t)
err, t = call("ip_edit", path="IP/rl", ops=[{"op": "remove_register", "id": "STS"}], mode="write"); check("REJECTED" in t and "in-use" in t and "irq" in t, "removing a register a rule uses is refused and names the rule", t)
err, t = call("ip_validate", path="IP/rl"); j = json.loads(t); check(j["errors"] == 0, "the model with rules validates", t)
check(tools["ip_simulate"]["annotations"]["readOnlyHint"] and "never invent hardware behaviour" in tools["ip_edit"]["description"].lower() and "NO function calls" in tools["ip_edit"]["description"], "ip_simulate is read-only; ip_edit tells the AI to write rules only from the manual and documents the language")
# timing diagrams through MCP
call("ip_create", path="IP/tm", name="Timing")
err, t = call("ip_edit", path="IP/tm", ops=[{"op": "add_timing", "timing": {"id": "spi", "name": "SPI 读", "hscale": 2, "signals": [{"name": "SCK", "wave": "p......."}, {"name": "MOSI", "wave": "x3.4.5.x", "data": ["CMD", "ADDR", "DAT"]}], "ev": {"level": "手册确认", "page": 312}}}], mode="write"); check(not err and "添加时序图 spi" in t, "ip_edit applies a timing", t)
err, t = call("ip_read", path="IP/tm"); check(not err and "timings (figures from the manual)" in t and 'spi "SPI 读" hscale 2 {手册确认 p.312}' in t and "SCK[p.......]" in t and "MOSI[x3.4.5.x | CMD, ADDR, DAT]" in t, "ip_read lists timings with evidence, waves and labels", t)
err, t = call("ip_list"); check(any(r.get("timings") == 1 for r in json.loads(t)["models"]), "ip_list shows the timing count", t)
err, t = call("ip_edit", path="IP/tm", ops=[{"op": "add_timing", "timing": {"id": "x", "signals": [{"name": "A", "wave": "01q0"}]}}]); check("REJECTED" in t and "bad-wave" in t and "“q”" in t, "a wave with an unsupported character is refused, naming it", t)
err, t = call("ip_validate", path="IP/tm"); check(json.loads(t)["errors"] == 0, "the model with a timing validates", t)
err, t = call("ip_import_atlas", page="CAN-FD/RH850/U2B", path="IP/atlas_full"); check(not err and "2 timing(s)" in t and "3 scene(s)" in t and "CAN0TX" in t and "8 个需要标签的段，数据标签有 9 个" in t, "importing the bundled CAN-FD page brings its 3 scenes and 2 waveforms, and reports the label-count mismatch in the shipped page", t)
check("TIMING diagrams" in tools["ip_edit"]["description"] and "Do not draw a waveform from memory" in tools["ip_edit"]["description"], "ip_edit documents timings and tells the AI not to draw waveforms from memory")
# dry run / read-only / safety
h = sha("IP/can0.cbip"); err, t = call("ip_edit", path="IP/can0", ops=[{"op": "remove_node", "id": "x1"}], mode="write", dry_run=True); check(not err and "DRY RUN" in t and sha("IP/can0.cbip") == h, "dry_run writes nothing and shows the plan", t)
err, t = call("ip_edit", path="IP/can0", ops=[{"op": "remove_node", "id": "x1"}]); check(not err and "PROPOSED" in t, "(setup) a proposal exists for the read-only test"); psha = sha("IP/can0.cbip.proposal.json")
p.stdin.close(); p.wait(timeout=10)
p = start("read"); n = 0; rpc("initialize", {"protocolVersion": "2025-06-18"})
err, t = call("ip_edit", path="IP/can0", ops=BASE); check(err and "read-only" in t, "read-only mode blocks ip_edit", t)
err, t = call("ip_proposal", path="IP/can0", action="discard"); check(err and "read-only" in t and sha("IP/can0.cbip.proposal.json") == psha, "read-only mode blocks discard", t)
err, t = call("ip_read", path="IP/can0"); check(not err, "read-only mode still reads", t)
p.stdin.close(); p.wait(timeout=10)
print("ALL PASS" if not bad else "%d FAILED" % bad); sys.exit(1 if bad else 0)
