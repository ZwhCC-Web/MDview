"""End-to-end test of mdview_mcp.py over stdio:  python test_mcp.py"""
import json, os, subprocess, sys, tempfile, pathlib, datetime
here = pathlib.Path(__file__).resolve().parent
root = pathlib.Path(tempfile.mkdtemp())
(root / "sub").mkdir()
(root / "a.md").write_text("# 文档A\n\n## 计划\n\n- [ ] 寄样品 📅 2020-01-01\n- [x] 已完成\n\n## 记录\n\n见 [[b]]\n", encoding="utf-8")
(root / "sub" / "b.md").write_text("# 文档B\n\n回到 [A](../a.md)\n\n```\n- [ ] 代码里的不算\n```\n", encoding="utf-8")
(root / "gbk.md").write_bytes("# 中文GBK\n\n内容\n".encode("gb18030"))
state = root / "state.json"
state.write_text(json.dumps({"file": str(root / "a.md"), "folder": str(root), "name": "a.md", "selection": "寄样品", "dirty": False}), encoding="utf-8")
env = dict(os.environ, MDVIEW_STATE=str(state), PYTHONIOENCODING="utf-8")
p = subprocess.Popen([sys.executable, str(here / "mdview_mcp.py"), "--root", str(root)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, text=True, encoding="utf-8")
n = 0
def rpc(method, params=None, notify=False):
    global n
    msg = {"jsonrpc": "2.0", "method": method, "params": params or {}}
    if not notify: n += 1; msg["id"] = n
    p.stdin.write(json.dumps(msg, ensure_ascii=False) + "\n"); p.stdin.flush()
    if notify: return None
    return json.loads(p.stdout.readline())
def call(name, **args):
    r = rpc("tools/call", {"name": name, "arguments": args})["result"]
    return r["isError"], r["content"][0]["text"]
ok = True
def check(cond, label):
    global ok; ok &= bool(cond); print(("PASS " if cond else "FAIL ") + label)
r = rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}})
check(r["result"]["serverInfo"]["name"] == "mdview", "initialize")
rpc("notifications/initialized", notify=True)
tools = rpc("tools/list")["result"]["tools"]; check(len(tools) == 11 and all("inputSchema" in t for t in tools), f"tools/list ({len(tools)})")
e, t = call("list_notes"); check(not e and "a.md" in t and "sub/b.md" in t and "gbk.md" in t, "list_notes")
e, t = call("read_note", path="b"); check(not e and "回到" in t, "read_note by name")
e, t = call("read_note", path="gbk.md"); check("中文GBK" in t, "read_note GBK")
e, t = call("read_note", path="a.md", start_line=3, end_line=3, line_numbers=True); check("    3| ## 计划" in t, "read_note range")
e, t = call("search_notes", query="样品"); check("a.md:5" in t, "search_notes")
e, t = call("get_outline", path="a.md"); check("计划  (line 3)" in t, "get_outline")
e, t = call("get_backlinks", note="a"); check("sub/b.md:3" in t, "get_backlinks md link")
e, t = call("get_backlinks", note="sub/b.md"); check("a.md:" in t, "get_backlinks wiki")
e, t = call("list_tasks"); check("寄样品" in t and "OVERDUE" in t and "代码里的不算" not in t, "list_tasks")
e, t = call("create_note", path="new/会议", content="# 会议\n"); check(not e and (root / "new" / "会议.md").exists(), "create_note")
e, t = call("create_note", path="new/会议.md", content="x"); check(e and "already exists" in t, "create_note no overwrite")
e, t = call("append_to_note", path="a.md", content="- 新增记录", heading="计划"); txt = (root / "a.md").read_text("utf-8")
check(not e and txt.index("- 新增记录") < txt.index("## 记录"), "append_to_note under heading")
e, t = call("replace_in_note", path="a.md", find="寄样品", replace="寄送开发板"); check(not e and "寄送开发板" in (root / "a.md").read_text("utf-8"), "replace_in_note")
check(any((root / ".mdview" / "backup").rglob("a.md.*.bak")), "backup created")
e, t = call("write_note", path="gbk.md", content="# 改写\n"); check((root / "gbk.md").read_bytes().decode("gb18030").startswith("# 改写"), "write_note keeps encoding")
e, t = call("read_note", path="../outside.md"); check(e and "outside" in t, "path confinement")
e, t = call("get_active_document"); check('"selection": "寄样品"' in t and "content" in t, "get_active_document")
res = rpc("resources/list")["result"]["resources"]; check(any(x["name"] == "a.md" for x in res), "resources/list")
rr = rpc("resources/read", {"uri": "mdview:///a.md"})["result"]; check("文档A" in rr["contents"][0]["text"], "resources/read")
check("error" in rpc("nope"), "unknown method")
p.stdin.close(); p.wait(5)
print("ALL PASS" if ok else "SOME FAILED"); sys.exit(0 if ok else 1)
