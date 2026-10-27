"""End-to-end test of chipbench_mcp.py over stdio:  python mcp/test_mcp.py"""
import json, os, subprocess, sys, tempfile, pathlib
here = pathlib.Path(__file__).resolve().parent
root = pathlib.Path(tempfile.mkdtemp()); root2 = pathlib.Path(tempfile.mkdtemp())
(root / "sub").mkdir()
(root / "a.md").write_text("# 文档A\n\n## 计划\n\n- [ ] 寄样品 📅 2020-01-01\n- [ ] 写培训稿 ⏳ 2099-01-01\n- [x] 已完成\n\n## 记录\n\n见 [[b]]\n", encoding="utf-8")
(root / "sub" / "b.md").write_text("# 文档B\n\n回到 [A](../a.md)\n\n```\n- [ ] 代码里的不算\n```\n", encoding="utf-8")
(root / "gbk.md").write_bytes("# 中文GBK\n\n内容\n".encode("gb18030"))
(root / "clk.md").write_text("# 时钟\n\n```clocktree\ntitle: 主时钟\nnodes:\n  - {id: osc, freq: 20MHz}\n```\n\n```gcl\ntitle: TAS\ncycle: 500us\n```\n", encoding="utf-8")
import shutil as _sh; _sh.copy(here.parent / "tests/fixtures/ivn_sample.pcap", root / "cap.pcap")
(root / ".agents" / "skills" / "my-skill").mkdir(parents=True); (root / ".agents" / "skills" / "my-skill" / "SKILL.md").write_text("---\nname: my-skill\ndescription: 工作区自定义技能\n---\n# my\n", encoding="utf-8")
(root2 / "other.md").write_text("# 第二个根目录\n", encoding="utf-8")
state = root / "state.json"
state.write_text(json.dumps({"file": str(root / "a.md"), "name": "a.md", "selection": "寄样品", "dirty": False, "workspace": {"name": "T", "roots": [str(root)]}}), encoding="utf-8")
home = pathlib.Path(tempfile.mkdtemp())
(root / "um.pdf").write_bytes(b"%PDF-1.4 fake")
def _fnv(key):
    h = 1469598103934665603
    for b in key.encode("utf-8"): h = ((h ^ b) * 1099511628211) & 0xFFFFFFFFFFFFFFFF
    return "%016x" % h
_st = (root / "um.pdf").stat(); (home / "cache" / "pdf").mkdir(parents=True)
(home / "cache" / "pdf" / (_fnv("%s|%d|%d" % (str((root / "um.pdf").resolve()).lower(), _st.st_mtime_ns // 1000000, _st.st_size)) + ".json")).write_text(json.dumps(["第一页 时钟", "第二页 PLL0 最大 480MHz", "第三页"]), encoding="utf-8")
env = dict(os.environ, CHIPBENCH_STATE=str(state), CHIPBENCH_HOME=str(home), PYTHONIOENCODING="utf-8")
p = subprocess.Popen([sys.executable, str(here / "chipbench_mcp.py"), "--root", str(root), "--root", str(root2)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, text=True, encoding="utf-8")
n = 0
def rpc(method, params=None, notify=False):
    global n
    msg = {"jsonrpc": "2.0", "method": method, "params": params or {}}
    if not notify: n += 1; msg["id"] = n
    p.stdin.write(json.dumps(msg, ensure_ascii=False) + "\n"); p.stdin.flush()
    return None if notify else json.loads(p.stdout.readline())
def call(_tool, **a):
    r = rpc("tools/call", {"name": _tool, "arguments": a})["result"]; return r["isError"], r["content"][0]["text"]
ok = True
def check(c, label):
    global ok; ok &= bool(c); print(("PASS " if c else "FAIL ") + label)
check(rpc("initialize", {"protocolVersion": "2025-06-18"})["result"]["serverInfo"]["name"] == "chipbench", "initialize")
rpc("notifications/initialized", notify=True)
tools = rpc("tools/list")["result"]["tools"]; check(len(tools) == 23 and all("inputSchema" in t for t in tools), f"tools/list ({len(tools)})")
e, t = call("list_notes"); check(not e and "a.md" in t and "other.md" in t and "gbk.md" in t, "list_notes (two roots)")
e, t = call("read_note", path="b"); check(not e and "回到" in t, "read_note by name")
e, t = call("read_note", path="gbk.md"); check("中文GBK" in t, "read_note GBK")
e, t = call("search_notes", query="样品"); check("a.md:5" in t, "search_notes")
e, t = call("get_outline", path="a.md"); check("计划  (line 3)" in t, "get_outline")
e, t = call("get_backlinks", note="a"); check("b.md:3" in t, "get_backlinks")
e, t = call("list_tasks"); check("寄样品" in t and "OVERDUE" in t and "写培训稿" in t and "代码里的不算" not in t, "list_tasks (⏳ + overdue + fenced ignored)")
e, t = call("create_note", path="new/会议", content="# 会议\n"); check(not e and (root / "new" / "会议.md").exists(), "create_note")
e, t = call("create_note", path="new/会议.md", content="x"); check(e and "already exists" in t, "create_note no overwrite")
e, t = call("append_to_note", path="a.md", content="- 新增", heading="计划"); txt = (root / "a.md").read_text("utf-8"); check(not e and txt.index("- 新增") < txt.index("## 记录"), "append under heading")
e, t = call("replace_in_note", path="a.md", find="寄样品", replace="寄送开发板"); check(not e and "寄送开发板" in (root / "a.md").read_text("utf-8"), "replace_in_note")
check(any((root / ".chipbench" / "backup").rglob("a.md.*.bak")), "backup created")
e, t = call("write_note", path="gbk.md", content="# 改写\n"); check((root / "gbk.md").read_bytes().decode("gb18030").startswith("# 改写"), "write_note keeps GBK")
e, t = call("read_note", path="../outside.md"); check(e, "path confinement (relative)")
e, t = call("read_note", path=str(pathlib.Path(tempfile.gettempdir()) / "x_outside.md")); check(e, "path confinement (absolute)")
e, t = call("create_note", path="../escape.md", content="x"); check(e and not (root.parent / "escape.md").exists(), "create outside root rejected")
e, t = call("get_active_document"); check('"selection": "寄样品"' in t and "content" in t, "get_active_document")
e, t = call("list_workspaces"); check(not e and "workspaces" in t, "list_workspaces")
check(any(x["name"].endswith("a.md") for x in rpc("resources/list")["result"]["resources"]), "resources/list")
check("文档A" in rpc("resources/read", {"uri": "chipbench:///" + root.name + "/a.md"})["result"]["contents"][0]["text"], "resources/read")
e, t = call("list_components"); check(not e and "2 components" in t and "clk.md:3\tclocktree\t主时钟" in t, "list_components")
e, t = call("get_component", path="clk.md", line=4); check(not e and "20MHz" in t, "get_component")
e, t = call("update_component", path="clk.md", line=4, content="title: 主时钟\nnodes:\n  - {id: osc, freq: 24MHz}"); txt = (root / "clk.md").read_text("utf-8"); check(not e and "24MHz" in txt and "待确认" in txt and "```gcl" in txt, "update_component (marked 待确认, other block kept)")
e, t = call("list_skills"); check(not e and "my-skill\t[" in t and "pcap-triage" in t and "tas-gcl-designer" in t, "list_skills (bundled + workspace)")
e, t = call("read_skill", name="pcap-triage"); check(not e and "scripts/aenet.py" in t, "read_skill")
e, t = call("read_skill", name="pcap-triage", file="../../mcp/chipbench_mcp.py"); check(e, "read_skill path escape rejected")
e, t = call("analyze_capture", path="cap.pcap", focus="doip"); check(not e and "NRC 0x31" in t and "路由激活响应" in t, "analyze_capture")
e, t = call("check_gcl", gcl=json.dumps({"cycle": "400us", "express": [7], "entries": [{"dur": "100us", "gates": [7]}, {"dur": "200us", "gates": [0, 1]}]})); check(not e and "保护带" in t, "check_gcl")
e, t = call("calc_cbs", link="100Mbps", bandwidth_pct=75); check(not e and '"idleSlope_kbps": 75000' in t, "calc_cbs")
e, t = call("calc_can_timing", clock="80MHz", bitrate="500k"); check(not e and '"sample_point_pct": 80' in t, "calc_can_timing")
e, t = call("read_file", path="clk.md", start_line=1, end_line=2); check(not e and "1: # 时钟" in t, "read_file")
pr = rpc("prompts/list")["result"]["prompts"]; check(len(pr) == 5 and any(x["name"] == "triage-capture" for x in pr), "prompts/list")
g = rpc("prompts/get", {"name": "triage-capture", "arguments": {"path": "cap.pcap"}})["result"]; check("analyze_capture(path='cap.pcap'" in g["messages"][0]["content"]["text"], "prompts/get")
check("error" in rpc("prompts/get", {"name": "triage-capture", "arguments": {}}), "prompts/get missing arg")
check("pcap-triage" in rpc("resources/read", {"uri": "chipbench://skills/pcap-triage"})["result"]["contents"][0]["text"], "skill as resource")
check("error" in rpc("nope"), "unknown method")
e, t = call("read_pdf_pages", path="um.pdf", start=2, end=3); check(not e and "=== p.2 ===" in t and "480MHz" in t and "p.3" in t and "[[um.pdf#p=N]]" in t, "read_pdf_pages from desktop cache")
(root / "clk2.md").write_text("```clocktree\nnodes:\n  - {id: a, freq: 1MHz, status: verified}\n  - {id: b, freq: 2MHz}\n```\n", encoding="utf-8")
e, t = call("update_component", path="clk2.md", line=2, content="nodes:\n  - {id: a, freq: 1MHz, status: verified}\n  - {id: b, freq: 3MHz, status: verified}"); txt = (root / "clk2.md").read_text("utf-8")
check(not e and "{id: a, freq: 1MHz, status: verified}" in txt and "{id: b, freq: 3MHz, status: unverified}" in txt, "AI cannot self-confirm changed nodes")
p.stdin.close(); p.wait(5)
print("ALL PASS" if ok else "SOME FAILED"); sys.exit(0 if ok else 1)
