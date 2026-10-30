"""1.7 MCP: roots follow the app, permission level, dry_run, activity log, selftest, data-dir pointer.   python mcp/test_mcp17.py"""
import json, os, subprocess, sys, tempfile, pathlib, time
here = pathlib.Path(__file__).resolve().parent
T = lambda: pathlib.Path(tempfile.mkdtemp())
wsA, wsB, data, fakehome = T(), T(), T(), T()
(wsA / "a.md").write_text("# A\n\n原文\n", encoding="utf-8"); (wsB / "b.md").write_text("# B\n", encoding="utf-8")
state = data / "state.json"
def publish(root, bump=0):
    state.write_text(json.dumps({"workspace": {"name": "W", "roots": [str(root)]}}), encoding="utf-8"); t = time.time() + bump; os.utime(state, (t, t))
publish(wsA)
env = dict(os.environ, CHIPBENCH_HOME=str(data), CHIPBENCH_STATE=str(state), PYTHONIOENCODING="utf-8", HOME=str(fakehome), USERPROFILE=str(fakehome))
env.pop("CHIPBENCH_MCP_LEVEL", None); env.pop("CHIPBENCH_ROOT", None)
p = subprocess.Popen([sys.executable, str(here / "chipbench_mcp.py")], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, text=True, encoding="utf-8")
n = 0; bad = 0
def rpc(method, params=None):
    global n
    n += 1; p.stdin.write(json.dumps({"jsonrpc": "2.0", "id": n, "method": method, "params": params or {}}) + "\n"); p.stdin.flush(); return json.loads(p.stdout.readline())
def call(tool, **a):
    r = rpc("tools/call", {"name": tool, "arguments": a})["result"]; return r["isError"], r["content"][0]["text"]
def check(c, name, info=""):
    global bad
    print(("PASS " if c else "FAIL ") + name + ("" if c else "  " + str(info))); bad += 0 if c else 1
def activity():
    f = data / "mcp-activity.jsonl"; return [json.loads(l) for l in f.read_text("utf-8").splitlines()] if f.exists() else []
rpc("initialize", {"protocolVersion": "2025-06-18", "clientInfo": {"name": "claude-ai", "title": "Claude Desktop"}})
e, t = call("list_notes"); check(not e and "a.md" in t and "b.md" not in t, "roots = workspace A", t)
publish(wsB, 2); e, t = call("list_notes"); check(not e and "b.md" in t and "a.md" not in t, "after switching workspace in the app the next call sees workspace B (1.6.1: stale roots)", t)
e, t = call("create_file", path="from_ai.md", content="# hi\n"); check(not e and (wsB / "from_ai.md").exists() and not (wsA / "from_ai.md").exists(), "writes land in the CURRENT workspace", t)
publish(wsA, 4)
act = activity(); c = [x for x in act if x["op"] == "create"]
check(len(c) == 1 and c[0]["tool"] == "create_file" and c[0]["client"] == "Claude Desktop" and c[0]["path"].endswith("from_ai.md") and c[0]["after_hash"], "create is logged", act)
e, t = call("replace_in_note", path="a.md", find="原文", replace="改写后"); m = [x for x in activity() if x["op"] == "modify"]
check(not e and len(m) == 1 and m[0]["added"] == 1 and m[0]["removed"] == 1 and "-原文" in m[0]["diff"] and "+改写后" in m[0]["diff"] and m[0]["backup"] and pathlib.Path(m[0]["backup"]).exists(), "modify logged with diff + backup", m)
e, t = call("create_folder", path="新目录/子"); check(not e and (wsA / "新目录" / "子").is_dir() and any(x["op"] == "mkdir" for x in activity()), "mkdir logged")
b4 = len(activity()); call("write_file", path="a.md", content=(wsA / "a.md").read_text("utf-8")); check(len(activity()) == b4, "identical rewrite is not logged")
txt0 = (wsA / "a.md").read_text("utf-8"); n0 = len(activity())
e, t = call("replace_in_note", path="a.md", find="改写后", replace="预览", dry_run=True)
check(not e and "DRY RUN" in t and "+预览" in t and "-改写后" in t, "dry_run returns the diff", t)
check((wsA / "a.md").read_text("utf-8") == txt0 and len(activity()) == n0, "dry_run writes and logs nothing")
e, t = call("create_tree", entries=[{"path": "dry/x/y.md", "content": "z"}], dry_run=True); check(not e and "DRY RUN" in t and not (wsA / "dry").exists(), "dry_run create_tree creates no folders", t)
tl = rpc("tools/list")["result"]["tools"]; w = [x for x in tl if not x["annotations"]["readOnlyHint"]]
check(w and all("dry_run" in x["inputSchema"]["properties"] for x in w) and not any("dry_run" in x["inputSchema"]["properties"] for x in tl if x["annotations"]["readOnlyHint"]), "dry_run advertised on write tools only")
e, t = call("read_note", path="a.md", dry_run=True); check(e and "unknown argument" in t, "dry_run rejected on read tools")
(data / "mcp-config.json").write_text(json.dumps({"level": "read"}), encoding="utf-8")
e, t = call("write_note", path="blocked.md", content="x"); check(e and "read-only" in t and not (wsA / "blocked.md").exists(), "read-only: write refused with explanation", t)
e, t = call("read_note", path="a.md"); check(not e and "改写后" in t, "read-only: reads still work")
(data / "mcp-config.json").write_text(json.dumps({"level": "write"}), encoding="utf-8")
e, t = call("write_note", path="ok.md", content="x"); check(not e and (wsA / "ok.md").exists(), "back to read & write")
e, t = call("get_workspace_info"); i = json.loads(t); check(i["roots_follow_app"] is True and i["permission_level"] == "write" and i["data_dir"] == str(data), "get_workspace_info", i)
s = json.loads((data / "mcp-session.json").read_text("utf-8")); check(s["client"] == "Claude Desktop" and s["level"] == "write", "mcp-session.json", s)
p.stdin.close(); p.wait(timeout=5)
r = subprocess.run([sys.executable, str(here / "chipbench_mcp.py"), "--selftest"], env=env, capture_output=True, text=True, encoding="utf-8", timeout=30)
rep = json.loads(r.stdout); check(rep["ok"] and rep["tools"] >= 40 and rep["write_tools"] >= 10 and rep["ethernet_tools"] is True and rep["roots"] == [str(wsA.resolve())], "--selftest report", rep)
state.unlink(); r = subprocess.run([sys.executable, str(here / "chipbench_mcp.py"), "--selftest", "--root", str(wsA)], env=env, capture_output=True, text=True, encoding="utf-8", timeout=30)
check(any("state.json not found" in x for x in json.loads(r.stdout)["problems"]), "--selftest explains a missing state.json")
env2 = dict(env); env2.pop("CHIPBENCH_HOME"); env2.pop("CHIPBENCH_STATE")
(fakehome / ".chipbench-active.json").write_text(json.dumps({"data_dir": str(data)}), encoding="utf-8")
r = subprocess.run([sys.executable, str(here / "chipbench_mcp.py"), "--selftest", "--root", str(wsA)], env=env2, capture_output=True, text=True, encoding="utf-8", timeout=30)
check(json.loads(r.stdout)["data_dir"] == str(data), "pointer file decides the data folder")
(fakehome / ".chipbench-active.json").write_text(json.dumps({"data_dir": str(data / "gone")}), encoding="utf-8")
r = subprocess.run([sys.executable, str(here / "chipbench_mcp.py"), "--selftest", "--root", str(wsA)], env=env2, capture_output=True, text=True, encoding="utf-8", timeout=30)
check(json.loads(r.stdout)["data_dir"] != str(data / "gone"), "a stale pointer is ignored")
print("ALL PASS" if not bad else "%d FAILED" % bad); sys.exit(1 if bad else 0)
