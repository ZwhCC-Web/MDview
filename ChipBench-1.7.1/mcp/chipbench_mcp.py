#!/usr/bin/env python3
"""ChipBench MCP server — lets AI tools (GitHub Copilot in VS Code, Claude Desktop, Cursor …) read and write your
workspace notes through the Model Context Protocol (stdio, JSON-RPC 2.0). Python 3.8+ standard library only.

    python chipbench_mcp.py                  # roots = folders of the workspace currently open in ChipBench
    python chipbench_mcp.py --root D:\\Notes  # one or more explicit roots (repeatable)

File access is confined to the roots. Every write keeps a backup in <root>/.chipbench/backup/.
The ChipBench desktop app publishes the active document / selection to ~/.chipbench/state.json (get_active_document)
and reloads files changed by this server automatically (file watcher).
"""
import argparse, datetime, difflib, hashlib, json, os, re, shutil, sys, time, traceback
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # aenet.py lives next to this file
from pathlib import Path

VERSION = "1.7.1"
PROTOCOL = "2025-06-18"
MD_EXT = {".md", ".markdown", ".mdown", ".mkd", ".txt"}
SKIP_DIRS = {".git", ".chipbench", "node_modules", "__pycache__", "target", ".obsidian"}
def data_root():
    """Where the desktop app keeps its data (state.json, workspaces ...). Order:
    CHIPBENCH_HOME -> ~/.chipbench-active.json (written by the running app: right for portable / custom / default installs alike) ->
    portable <install>/data -> ~/.chipbench-location -> ~/.chipbench"""
    if os.environ.get("CHIPBENCH_HOME"):
        return Path(os.environ["CHIPBENCH_HOME"])
    try:
        ptr = json.loads((Path.home() / ".chipbench-active.json").read_text("utf-8-sig"))
        d = Path(str(ptr.get("data_dir") or ""))
        if str(d) and d.is_dir():
            return d
    except (OSError, ValueError):
        pass
    portable = Path(__file__).resolve().parent.parent / "data"
    if portable.is_dir():
        return portable
    try:
        t = (Path.home() / ".chipbench-location").read_text("utf-8").strip().lstrip("\ufeff")
        if t:
            return Path(t)
    except OSError:
        pass
    return Path.home() / ".chipbench"


STATE = Path(os.environ.get("CHIPBENCH_STATE") or (data_root() / "state.json"))
def _state_age():
    """Seconds since the desktop app last published its state (every ~15 s while running); None if never."""
    try:
        return max(0.0, time.time() - STATE.stat().st_mtime)
    except OSError:
        return None


def _sha1(b):
    return hashlib.sha1(b).hexdigest()


def _json_file(p):
    try:
        return json.loads(Path(p).read_text("utf-8-sig"))
    except (OSError, ValueError):
        return {}


def _ep(v, ids):
    """link end 'block.port' -> 'block' (1.7 port syntax)"""
    v = str(v)
    return v.rsplit(".", 1)[0] if v not in ids and "." in v and v.rsplit(".", 1)[0] in ids else v


EV_LEVELS = ("手册确认", "实测", "推导", "示意", "待核对")
EV_ALIAS = {"confirmed": "手册确认", "manual": "手册确认", "measured": "实测", "derived": "推导", "schematic": "示意", "todo": "待核对", "unverified": "待核对", "已确认": "手册确认", "已核对": "手册确认"}


def _num(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return int(v)
    t = str(v if v is not None else "").strip()
    if re.fullmatch(r"0[xX][0-9a-fA-F_]+", t):
        return int(t.replace("_", ""), 16)
    return int(t) if re.fullmatch(r"-?\d+", t) else None


def _bits(b):
    t = str(b if b is not None else "").strip()
    m = re.fullmatch(r"(\d+)\s*:\s*(\d+)", t)
    if m:
        hi, lo = int(m.group(1)), int(m.group(2))
        return (hi, lo) if hi >= lo else None
    m = re.fullmatch(r"(\d+)", t)
    return (int(m.group(1)), int(m.group(1))) if m else None


def _pages(v):
    """123 | "12-14" | [3, 1] -> sorted ints; [] when absent; None when malformed (same rules as atlas-model.js)"""
    if v is None or v == "":
        return []
    out = []
    for part in [x for x in re.split(r"[,;，、\s]+", ",".join(str(i) for i in (v if isinstance(v, list) else [v]))) if x]:
        m = re.fullmatch(r"(\d+)(?:-(\d+))?", part)
        if not m:
            return None
        a, b = int(m.group(1)), int(m.group(2) or m.group(1))
        if b < a or b - a > 200:
            return None
        out += list(range(a, b + 1))
    return sorted(set(out))


def _ev_level(v):
    t = str(v if v is not None else "").strip()
    if t in EV_LEVELS:
        return t
    return EV_ALIAS.get(t.lower()) or (None if t else "待核对")


def atlas_parse(text):
    """One IP-atlas page -> the unified model (mirror of app/js/atlas-model.js; mcp/test_atlas_parity.py keeps them in step)."""
    m = {"blocks": [], "groups": [], "links": [], "registers": {}, "scenes": [], "code": [], "errors": []}
    for lang, body in re.findall(r"```([\w-]+)[^\n]*\n(.*?)\n```", text, re.S):
        lang = lang.lower()
        try:
            y = mini_yaml(body) if lang in ("ipblock", "register", "scene") else None
        except Exception as e:  # noqa: BLE001
            m["errors"].append("%s YAML: %s" % (lang, e)); continue
        if lang == "ipblock" and isinstance(y, dict):
            title = str(y.get("title") or "")
            for g in y.get("groups") or []:
                if isinstance(g, dict) and g.get("id") is not None:
                    m["groups"].append({"id": str(g["id"]), "diagram": title})
            ids = {x["id"] for x in m["groups"] if x["diagram"] == title}
            for b in y.get("blocks") or y.get("nodes") or []:
                if isinstance(b, dict) and b.get("id") is not None:
                    ids.add(str(b["id"]))
                    m["blocks"].append({"id": str(b["id"]), "diagram": title, "regs": [str(r) for r in (b.get("regs") if isinstance(b.get("regs"), list) else [])],
                                        "pages": _pages(b.get("page")), "level": _ev_level(b.get("ev")), "label": b.get("label") or str(b["id"]),
                                        "ports": [str(p.get("id")) for p in (b.get("ports") or []) if isinstance(p, dict) and p.get("id") is not None]})
            for l in y.get("links") or y.get("edges") or []:
                if isinstance(l, dict):
                    ends = []
                    for k in ("from", "to"):
                        v = str(l.get(k)); port = None
                        if v not in ids and "." in v and v.rsplit(".", 1)[0] in ids:
                            v, port = v.rsplit(".", 1)
                        ends.append((v, port))
                    m["links"].append({"from": ends[0][0], "fromPort": ends[0][1], "to": ends[1][0], "toPort": ends[1][1], "diagram": title})
        elif lang == "register" and isinstance(y, dict) and y.get("name"):
            name = str(y["name"]).upper()
            reg = {"name": name, "width": int(y.get("width") or 32), "address": _num(y.get("address")), "reset": _num(y.get("reset")), "desc": y.get("desc") or "",
                   "pages": _pages(y.get("page")), "level": _ev_level(y.get("ev")), "fields": []}
            for f in y.get("fields") or []:
                if isinstance(f, dict) and f.get("name") is not None:
                    reg["fields"].append({"name": str(f["name"]), "bitsRaw": str(f.get("bits")), "bits": _bits(f.get("bits")), "desc": f.get("desc") or "", "pages": _pages(f.get("page")), "level": _ev_level(f.get("ev"))})
            if name in m["registers"]:
                m["errors"].append("register %s defined twice" % name)
            else:
                m["registers"][name] = reg
        elif lang == "scene" and isinstance(y, dict):
            sc = {"title": str(y.get("title") or "#%d" % (len(m["scenes"]) + 1)), "diagram": str(y.get("diagram") or ""), "code": int(y.get("code") or 0), "steps": []}
            for i, st in enumerate(y.get("steps") if isinstance(y.get("steps"), list) else [], 1):
                if isinstance(st, dict):
                    sc["steps"].append({"n": i, "t": st.get("t") or "", "hl": [str(x) for x in st.get("hl") or []], "line": st.get("line"), "x": st.get("x") or "", "pages": _pages(st.get("page")), "level": _ev_level(st.get("ev")),
                                        "regs": [{"r": str(r.get("r")), "v": _num(r.get("v")), "raw": r.get("v")} for r in st.get("regs") or [] if isinstance(r, dict)]})
            m["scenes"].append(sc)
        elif lang in ("c", "cpp", "asm"):
            m["code"].append({"lang": lang, "lines": body.split("\n")})
    return m


def atlas_find_reg(m, name):
    n = str(name or "").upper()
    if n in m["registers"]:
        return m["registers"][n]
    return next((v for k, v in m["registers"].items() if k.endswith(n) or n.endswith(k)), None)


def atlas_decode(reg, v):
    return [{"name": f["name"], "bits": f["bitsRaw"], "value": (v >> f["bits"][1]) & ((1 << (f["bits"][0] - f["bits"][1] + 1)) - 1)} for f in reg["fields"] if f["bits"]]


def read_front(p):
    m = re.match(r"^---\n(.*?)\n---", read_text(p)[0].replace("\r\n", "\n"), re.S)
    return mini_yaml(m.group(1)) if m else {}


TASK_RE = re.compile(r"^(\s*)(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s+(.*)$")
DUE_RE = re.compile(r"(?:📅\s?|due:)(\d{4}-\d{2}-\d{2})")
PLAN_RE = re.compile(r"⏳\s?(\d{4}-\d{2}-\d{2})")
WIKI_RE = re.compile(r"\[\[([^\[\]\n|#]+)(?:#[^\[\]\n|]*)?(?:\|[^\[\]\n]*)?\]\]")
MDLINK_RE = re.compile(r"\]\(\s*<?([^)>]+?\.(?:md|markdown))(?:#[^)\s]*)?>?(?:\s+[\"'][^\"']*[\"'])?\s*\)", re.I)


class ToolError(Exception):
    pass


def read_text(p: Path):
    data = p.read_bytes()
    for enc in ("utf-8-sig", "gb18030", "shift_jis", "big5"):
        try:
            return data.decode(enc), ("UTF-8" if enc == "utf-8-sig" else enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", "replace"), "UTF-8"


class Notes:
    ACTIVITY_MAX = 1_500_000      # bytes; cut to the newest 400 lines beyond this
    DIFF_MAX = 6000               # characters of diff kept per entry

    def __init__(self, roots, dynamic=False):
        self._roots = [Path(r).resolve() for r in roots]
        self.dynamic = dynamic            # True: roots follow the workspace open in ChipBench
        self._sig = None
        self.client = ""
        self.tool = ""
        self.dry = False
        self.plan = []
        self._sess_t = 0.0

    @property
    def roots(self):
        if self.dynamic:
            self._refresh_roots()
        return self._roots

    def _refresh_roots(self):
        """Re-read state.json when it changed: switching workspace in ChipBench is picked up by the NEXT call (1.6.1 kept the start-up roots)."""
        try:
            sig = STATE.stat().st_mtime_ns
        except OSError:
            return
        if sig == self._sig:
            return
        self._sig = sig
        rs = [Path(r).resolve() for r in ((_json_file(STATE).get("workspace") or {}).get("roots") or []) if Path(r).is_dir()]
        if rs and rs != self._roots:
            sys.stderr.write("roots changed -> %s\n" % ", ".join(str(r) for r in rs))
            self._roots = rs

    @property
    def root(self):
        return self.roots[0]

    def level(self):
        v = (os.environ.get("CHIPBENCH_MCP_LEVEL") or _json_file(data_root() / "mcp-config.json").get("level") or "write").strip().lower()
        return v if v in ("read", "write") else "write"

    def begin(self, tool, client="", dry=False):
        self.tool, self.client, self.dry, self.plan = tool, client, bool(dry), []

    def end(self):
        plan, self.plan, self.dry = self.plan, [], False
        return plan

    def _log(self, entry):
        try:
            d = data_root()
            d.mkdir(parents=True, exist_ok=True)
            f = d / "mcp-activity.jsonl"
            entry = dict(entry, id=format(int(time.time() * 1000), "x") + format(os.getpid() & 0xFFF, "03x"),
                         t=datetime.datetime.now().isoformat(timespec="seconds"), tool=self.tool, client=self.client)
            with open(f, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
            if f.stat().st_size > self.ACTIVITY_MAX:
                lines = f.read_text("utf-8").splitlines()[-400:]
                f.write_text("\n".join(lines) + "\n", "utf-8")
        except OSError as e:
            sys.stderr.write("activity log failed: %s\n" % e)

    def touch_session(self, force=False):
        """<data>/mcp-session.json lets the app show 'AI connected'."""
        if not force and time.time() - self._sess_t < 5:
            return
        self._sess_t = time.time()
        try:
            d = data_root()
            d.mkdir(parents=True, exist_ok=True)
            (d / "mcp-session.json").write_text(json.dumps({"pid": os.getpid(), "client": self.client, "version": VERSION, "level": self.level(), "roots": [str(r) for r in self._roots],
                                                            "time": datetime.datetime.now().isoformat(timespec="seconds"), "last_tool": self.tool}, ensure_ascii=False), "utf-8")
        except OSError:
            pass

    def _mkdir(self, d, log=True):
        d = Path(d)
        if d.exists():
            return
        if self.dry:
            self.plan.append({"op": "mkdir", "path": str(d)})
            return
        d.mkdir(parents=True, exist_ok=True)
        if log:
            self._log({"op": "mkdir", "path": str(d), "root": str(next((r for r in self._roots if r in d.parents or r == d), "")), "added": 0, "removed": 0, "diff": ""})

    def path(self, rel, must_exist=True):
        if not rel or not str(rel).strip():
            raise ToolError("path is required")
        s = str(rel).replace("\\", "/")
        cands = []
        p0 = Path(s)
        if p0.is_absolute() or re.match(r"^[A-Za-z]:/", s):
            cands = [Path(s)]
        else:
            cands = [r / s.lstrip("/") for r in self.roots]
            head, _, tail = s.lstrip("/").partition("/")
            cands += [r / tail for r in self.roots if r.name == head and tail]   # "<rootname>/sub/x.md" (multi-root listing)
        for c in cands:
            c = c.resolve()
            if not any(c == r or r in c.parents for r in self.roots):
                continue
            if c.exists() or (not must_exist):
                return c
            if not c.suffix and c.with_suffix(".md").exists():
                return c.with_suffix(".md")
        if any(not (c.resolve() == r or r in c.resolve().parents) for c in cands for r in self.roots[:1]) and must_exist is False:
            raise ToolError(f"path is outside the workspace roots: {rel}")
        raise ToolError(f"not found (or outside the workspace roots): {rel}")

    def rel(self, p):
        for r in self.roots:
            if p == r or r in p.parents:
                return (r.name + "/" if len(self.roots) > 1 else "") + p.relative_to(r).as_posix()
        return p.as_posix()

    def files(self, sub=""):
        bases = [self.path(sub)] if sub else self.roots
        for base in bases:
            for dp, dns, fns in os.walk(base):
                dns[:] = sorted(d for d in dns if d not in SKIP_DIRS and not d.startswith("."))
                for fn in sorted(fns):
                    if Path(fn).suffix.lower() in MD_EXT:
                        yield Path(dp) / fn

    def find_note(self, name):
        try:
            return self.path(name)
        except ToolError:
            pass
        key = re.sub(r"\.(md|markdown)$", "", Path(str(name).replace("\\", "/")).name.lower())
        for f in self.files():
            if f.stem.lower() == key:
                return f
        raise ToolError(f"note not found: {name}")

    def backup(self, p):
        if not p.exists():
            return None
        root = next((r for r in self.roots if r in p.parents), self.roots[0])
        ts = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        dst = root / ".chipbench" / "backup" / (p.relative_to(root).as_posix() + "." + ts + ".bak")
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(p, dst)
        return dst.relative_to(root).as_posix()

    def write(self, p, text):
        enc, before, existed = "UTF-8", None, p.exists()
        if existed:
            before, enc = read_text(p)
        data = text.encode("utf-8" if enc == "UTF-8" else enc, "replace")
        root = next((r for r in self.roots if r in p.parents), self.roots[0])
        ud = list(difflib.unified_diff((before or "").splitlines(), text.splitlines(), "before", "after", lineterm="", n=2))
        added = sum(1 for l in ud if l.startswith("+") and not l.startswith("+++"))
        removed = sum(1 for l in ud if l.startswith("-") and not l.startswith("---"))
        diff = "\n".join(ud)[: self.DIFF_MAX]
        if self.dry:
            self.plan.append({"op": "modify" if existed else "create", "path": str(p), "rel": self.rel(p), "added": added, "removed": removed, "diff": diff})
            return None
        if existed and before == text:
            return None                       # nothing to write, nothing to log
        bk = self.backup(p)
        self._mkdir(p.parent, log=False)
        tmp = p.with_name(p.name + ".chipbench-tmp")
        tmp.write_bytes(data)
        os.replace(tmp, p)
        self._log({"op": "modify" if existed else "create", "path": str(p), "root": str(root), "rel": self.rel(p), "backup": str(root / bk) if bk else None,
                   "after_hash": _sha1(data), "added": added, "removed": removed, "diff": diff})
        return bk

    # ---------------- tools ----------------
    def list_notes(self, folder="", pattern="", limit=300):
        rx = re.compile(pattern, re.I) if pattern else None
        out = []
        for f in self.files(folder):
            r = self.rel(f)
            if rx and not rx.search(r):
                continue
            title = ""
            try:
                with open(f, "rb") as fh:
                    m = re.search(r"^#\s+(.+)$", fh.read(4096).decode("utf-8", "ignore"), re.M)
                title = m.group(1).strip() if m else ""
            except OSError:
                pass
            st = f.stat()
            out.append(f"{r}\t{st.st_size} B\t{datetime.datetime.fromtimestamp(st.st_mtime):%Y-%m-%d %H:%M}\t{title}")
            if len(out) >= limit:
                out.append(f"… (limited to {limit})")
                break
        return "roots: " + ", ".join(str(r) for r in self.roots) + f"\n{len(out)} notes (path, size, modified, title):\n" + "\n".join(out)

    def read_note(self, path, start_line=0, end_line=0, line_numbers=False):
        p = self.find_note(path)
        text, enc = read_text(p)
        lines = text.split("\n")
        a = max(1, int(start_line or 1)); b = min(len(lines), int(end_line or len(lines)))
        body = "\n".join((f"{a + i:>5}| {l}" if line_numbers else l) for i, l in enumerate(lines[a - 1:b]))
        return f"# file: {self.rel(p)} (lines {a}-{b} of {len(lines)}, {enc})\n{body}"

    def search_notes(self, query, regex=False, case_sensitive=False, max_results=100):
        if not query:
            raise ToolError("query is required")
        rx = re.compile(query if regex else re.escape(query), 0 if case_sensitive else re.I)
        hits, files = [], 0
        for f in self.files():
            try:
                text, _ = read_text(f)
            except OSError:
                continue
            if not rx.search(text) and not rx.search(f.name):
                continue
            files += 1
            for i, l in enumerate(text.split("\n"), 1):
                if rx.search(l):
                    hits.append(f"{self.rel(f)}:{i}: {l.strip()[:240]}")
                    if len(hits) >= max_results:
                        break
            if len(hits) >= max_results:
                break
        return f"{len(hits)} matches in {files} files\n" + "\n".join(hits)

    def get_outline(self, path):
        p = self.find_note(path)
        text, _ = read_text(p)
        out, fence = [], False
        for i, l in enumerate(text.split("\n"), 1):
            if re.match(r"^\s*(```|~~~)", l):
                fence = not fence
                continue
            m = None if fence else re.match(r"^(#{1,6})\s+(.*?)\s*#*\s*$", l)
            if m:
                out.append(f"{'  ' * (len(m.group(1)) - 1)}- {m.group(2)}  (line {i})")
        return f"outline of {self.rel(p)}:\n" + ("\n".join(out) or "(no headings)")

    def get_backlinks(self, note):
        target = self.find_note(note)
        stem = target.stem.lower()
        out = []
        for f in self.files():
            if f == target:
                continue
            try:
                text, _ = read_text(f)
            except OSError:
                continue
            for i, l in enumerate(text.split("\n"), 1):
                hit = any(re.sub(r"\.md$", "", Path(m.strip()).name.lower()) == stem for m in WIKI_RE.findall(l))
                if not hit:
                    for m in MDLINK_RE.findall(l):
                        try:
                            if (f.parent / m.replace("%20", " ")).resolve() == target:
                                hit = True
                        except OSError:
                            pass
                if hit:
                    out.append(f"{self.rel(f)}:{i}: {l.strip()[:200]}")
        return f"{len(out)} backlinks to {self.rel(target)}\n" + "\n".join(out)

    def list_tasks(self, status="open", due_before="", path=""):
        today = datetime.date.today().isoformat()
        files = [self.find_note(path)] if path else list(self.files())
        rows = []
        for f in files:
            try:
                text, _ = read_text(f)
            except OSError:
                continue
            fence = False
            for i, l in enumerate(text.split("\n"), 1):
                if re.match(r"^\s*(```|~~~)", l):
                    fence = not fence
                    continue
                m = None if fence else TASK_RE.match(l)
                if not m:
                    continue
                done = m.group(2) != " "
                if (status == "open" and done) or (status == "done" and not done):
                    continue
                d = DUE_RE.search(m.group(3)); pl = PLAN_RE.search(m.group(3))
                due = d.group(1) if d else ""; plan = pl.group(1) if pl else ""
                if due_before and (not due or due > due_before):
                    continue
                flag = " [OVERDUE]" if due and due < today and not done else ""
                rows.append((due or plan or "9999", f"[{'x' if done else ' '}] {m.group(3).strip()}  — {self.rel(f)}:{i}{flag}"))
        rows.sort()
        return f"{len(rows)} tasks (status={status}, today={today})\n" + "\n".join(r for _, r in rows)

    def create_note(self, path, content, overwrite=False):
        p = self.path(path if re.search(r"\.\w+$", path) else path + ".md", must_exist=False)
        if p.exists() and not overwrite:
            raise ToolError(f"already exists: {self.rel(p)} (set overwrite=true to replace)")
        bk = self.write(p, content)
        return f"created {self.rel(p)} ({len(content)} chars)" + (f", backup: {bk}" if bk else "")

    def write_note(self, path, content):
        p = self.path(path if re.search(r"\.\w+$", path) else path + ".md", must_exist=False)
        bk = self.write(p, content)
        return f"wrote {self.rel(p)} ({len(content)} chars)" + (f", backup: {bk}" if bk else "")

    def append_to_note(self, path, content, heading=""):
        p = self.find_note(path)
        text, _ = read_text(p)
        lines = text.split("\n")
        if heading:
            h = heading.lstrip("#").strip().lower()
            idx = next((i for i, l in enumerate(lines) if re.match(r"^#{1,6}\s+", l) and l.lstrip("#").strip().lower() == h), None)
            if idx is None:
                raise ToolError(f"heading not found: {heading}")
            lvl = len(re.match(r"^(#+)", lines[idx]).group(1))
            end = next((j for j in range(idx + 1, len(lines)) if re.match(r"^(#{1,%d})\s" % lvl, lines[j])), len(lines))
            while end > idx + 1 and not lines[end - 1].strip():
                end -= 1
            lines[end:end] = ["", *content.rstrip("\n").split("\n")]
            new = "\n".join(lines)
        else:
            new = text.rstrip("\n") + "\n\n" + content.rstrip("\n") + "\n"
        bk = self.write(p, new)
        return f"appended {len(content)} chars to {self.rel(p)}" + (f" under '{heading}'" if heading else "") + f", backup: {bk}"

    def replace_in_note(self, path, find, replace, all=False, regex=False):
        p = self.find_note(path)
        text, _ = read_text(p)
        if regex:
            new, n = re.subn(find, replace, text, count=0 if all else 1)
        else:
            n = text.count(find) if all else min(1, text.count(find))
            new = text.replace(find, replace) if all else text.replace(find, replace, 1)
        if not n:
            raise ToolError("text to replace was not found (nothing changed)")
        bk = self.write(p, new)
        return f"replaced {n} occurrence(s) in {self.rel(p)}, backup: {bk}"

    def list_workspaces(self):
        d = data_root() / "workspaces"
        out = []
        for f in sorted(d.glob("*.cbws")) if d.exists() else []:
            try:
                w = json.loads(f.read_text("utf-8"))
                out.append(f"{w.get('name')}\t{len(w.get('roots', []))} roots\t" + "; ".join(r.get("path", "") for r in w.get("roots", [])))
            except Exception:
                pass
        return f"{len(out)} workspaces\n" + "\n".join(out)

    def get_active_document(self, include_content=True):
        if not STATE.exists():
            return "ChipBench desktop is not running (or has not published its state yet)."
        st = json.loads(STATE.read_text("utf-8"))
        out = {k: st.get(k) for k in ("name", "file", "workspace", "dirty", "time", "open_tabs")}
        if st.get("selection"):
            out["selection"] = st["selection"]
        if include_content and st.get("file") and Path(st["file"]).exists() and Path(st["file"]).suffix.lower() in MD_EXT:
            text, enc = read_text(Path(st["file"]))
            out["content"] = text if len(text) < 200000 else text[:200000] + "\n…(truncated)"
            out["encoding"] = enc
        if st.get("dirty"):
            out["note"] = "The document has unsaved changes in ChipBench; content shown is the last saved version."
        return json.dumps(out, ensure_ascii=False, indent=1)


    # ------------------------------------------------------------ 1.0: files, components, skills, Ethernet
    def read_file(self, path, start_line=0, end_line=0, max_bytes=400000):
        p = self.path(path)
        if p.stat().st_size > 50 * 1024 * 1024:
            raise ToolError("file too large (> 50 MB); use start_line / end_line on a smaller file or the desktop log viewer")
        text, enc = read_text(p)
        lines = text.split("\n")
        if start_line or end_line:
            a = max(1, int(start_line or 1)); b = int(end_line or len(lines))
            body = "\n".join("%d: %s" % (i, lines[i - 1]) for i in range(a, min(b, len(lines)) + 1))
        else:
            body = text if len(text) <= max_bytes else text[:max_bytes] + "\n…(truncated, %d lines total; use start_line/end_line)" % len(lines)
        return "%s  (%s, %d lines)\n%s" % (self.rel(p), enc, len(lines), body)

    COMP_RE = re.compile(r"^```(clocktree|clock-tree|structure|ipblock|register|memmap|pinout|gcl|wavedrom|flow|chart)\s*$")

    def _components(self, p):
        text, _ = read_text(p)
        lines, out, i = text.split("\n"), [], 0
        while i < len(lines):
            m = self.COMP_RE.match(lines[i].strip())
            if m:
                j = i + 1
                while j < len(lines) and lines[j].strip() != "```":
                    j += 1
                body = "\n".join(lines[i + 1:j])
                t = re.search(r"^(?:title|name|package):\s*(.+)$", body, re.M)
                out.append({"type": m.group(1), "start_line": i + 1, "end_line": j + 1, "title": t.group(1).strip() if t else "", "source": body})
                i = j
            i += 1
        return out

    def list_components(self, path="", type=""):
        files = [self.path(path)] if path else [f for f in self.files() if f.suffix.lower() in MD_EXT]
        rows = []
        for f in files:
            try:
                for c in self._components(f):
                    if not type or c["type"] == type:
                        rows.append("%s:%d\t%s\t%s" % (self.rel(f), c["start_line"], c["type"], c["title"]))
            except Exception:
                continue
        return "%d components\n" % len(rows) + "\n".join(rows)

    def get_component(self, path, line):
        for c in self._components(self.path(path)):
            if c["start_line"] <= int(line) <= c["end_line"]:
                return json.dumps({k: c[k] for k in ("type", "start_line", "end_line", "title", "source")}, ensure_ascii=False, indent=1)
        raise ToolError("no component block at %s:%s (use list_components)" % (path, line))

    def _pdf_cache(self, p):
        st = p.stat()
        key = "%s|%d|%d" % (str(p).lower(), st.st_mtime_ns // 1000000, st.st_size)
        h = 1469598103934665603
        for b in key.encode("utf-8"):
            h = ((h ^ b) * 1099511628211) & 0xFFFFFFFFFFFFFFFF
        return data_root() / "cache" / "pdf" / ("%016x.json" % h)

    def read_pdf_pages(self, path, start=1, end=0):
        """Text of PDF pages from ChipBench's page cache (<data dir>/cache/pdf)."""
        p = self.path(path)
        cache = self._pdf_cache(p)
        if not cache.exists():
            raise ToolError("no text cache for this PDF yet — open it once in ChipBench (or let the workspace index it), then retry")
        pages = json.loads(cache.read_text(encoding="utf-8"))
        a = max(1, int(start or 1)); b = min(len(pages), int(end or a), a + 19)
        if a > len(pages):
            raise ToolError("page out of range (%d pages)" % len(pages))
        return "\n\n".join("=== p.%d ===\n%s" % (i, pages[i - 1]) for i in range(a, b + 1)) + "\n\n(%s · %d pages · cite as [[%s#p=N]])" % (p.name, len(pages), p.name)

    def update_component(self, path, line, content):
        p = self.path(path)
        for c in self._components(p):
            if c["start_line"] <= int(line) <= c["end_line"]:
                text, _ = read_text(p)
                lines = text.split("\n")
                body = content.strip("\n")
                if body.startswith("```"):
                    raise ToolError("pass only the block body (YAML / CSV / JSON), without the ``` fences")
                old_lines = set(lines[c["start_line"]:c["end_line"] - 1])
                # 1.1: AI may never confirm a node itself — any newly written "status: verified" becomes unverified
                body = "\n".join(l if l in old_lines else re.sub(r"status:\s*verified\b", "status: unverified", l) for l in body.split("\n"))
                if "（待确认）" not in body and "status:" not in body:
                    body += "\nstatus: 待确认  # written by AI via MCP — confirm in ChipBench"
                lines[c["start_line"]:c["end_line"] - 1] = body.split("\n")
                self.write(p, "\n".join(lines))
                return "updated %s block at %s:%d (backup kept; marked 待确认)" % (c["type"], self.rel(p), c["start_line"])
        raise ToolError("no component block at %s:%s" % (path, line))

    # ------------------------------------------------------------ 1.3: workspace, files, PDF search, tasks, components
    TEXT_EXT = {".md", ".markdown", ".txt", ".c", ".h", ".cpp", ".hpp", ".cc", ".s", ".asm", ".inc", ".ld", ".lsl", ".icf", ".map", ".log",
                ".csv", ".tsv", ".json", ".yaml", ".yml", ".xml", ".arxml", ".dbc", ".ldf", ".a2l", ".svd", ".py", ".js", ".ts", ".bat", ".ps1",
                ".sh", ".mk", ".cmake", ".ini", ".cfg", ".toml", ".rdl", ".v", ".sv", ".vhd", ".dts", ".dtsi", ".html", ".htm", ".rst"}

    def _walk(self, sub=""):
        bases = [self.path(sub)] if sub else self.roots
        for base in bases:
            if base.is_file():
                yield base
                continue
            for dp, dns, fns in os.walk(base):
                dns[:] = sorted(d for d in dns if d not in SKIP_DIRS and not d.startswith("."))
                for fn in sorted(fns):
                    yield Path(dp) / fn

    def _state(self):
        try:
            return json.loads(STATE.read_text("utf-8"))
        except Exception:
            return {}

    def get_workspace_info(self):
        ws = (self._state().get("workspace") or {})
        info = {"name": ws.get("name"), "home": ws.get("home"), "notes_dir": ws.get("notes"), "inbox_dir": ws.get("inbox"), "journal_dir": ws.get("journal"),
                "roots": [str(r) for r in self.roots], "roots_follow_app": self.dynamic, "data_dir": str(data_root()), "server_version": VERSION,
                "permission_level": self.level(), "app_running": _state_age() is not None and _state_age() < 60, "state_age_seconds": None if _state_age() is None else round(_state_age())}
        if not ws:
            info["note"] = "ChipBench desktop has not published its state; roots come from --root / CHIPBENCH_ROOT."
        return json.dumps(info, ensure_ascii=False, indent=1)

    def list_dir(self, path="", depth=1):
        depth = max(1, min(int(depth or 1), 4))
        bases = [self.path(path)] if path else self.roots
        out = []
        def walk(d, lv):
            try:
                ents = sorted(d.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower()))
            except OSError as e:
                out.append("  " * (lv + 1) + "(unreadable: %s)" % e); return
            for e in ents:
                if e.name.startswith(".") or e.name in SKIP_DIRS:
                    continue
                if e.is_dir():
                    out.append("  " * (lv + 1) + e.name + "/")
                    if lv + 1 < depth:
                        walk(e, lv + 1)
                else:
                    out.append("  " * (lv + 1) + "%s  (%s)" % (e.name, _size(e.stat().st_size)))
                if len(out) > 1500:
                    return
        for b in bases:
            if not b.is_dir():
                raise ToolError("not a folder: %s" % path)
            out.append(self.rel(b) + "/" if path else str(b) + "/")
            walk(b, 0)
        return "\n".join(out[:1500]) + ("\n…(truncated)" if len(out) > 1500 else "")

    # ---------------- 1.6.2: create sub-folders and files inside the workspace ----------------
    BLOCKED_EXT = {".exe", ".dll", ".com", ".scr", ".msi", ".bat", ".cmd", ".ps1", ".vbs", ".vbe", ".lnk", ".reg", ".sys", ".cpl", ".hta"}
    WIN_RESERVED = {"con", "prn", "aux", "nul"} | {"com%d" % i for i in range(1, 10)} | {"lpt%d" % i for i in range(1, 10)}
    MAX_WRITE = 5 * 1024 * 1024
    MAX_TREE = 200

    def _new_path(self, path):
        """Resolve a path that may not exist yet. Returns (Path, root). Relative paths start at the first root;
        with several roots the first segment may be a root's folder name (as shown by list_dir). Never leaves the roots."""
        if path is None or not str(path).strip():
            raise ToolError("path is required")
        s = str(path).strip().replace("\\", "/")
        if re.match(r"^[A-Za-z]:/", s) or s.startswith("//") or Path(s).is_absolute():
            c = Path(s).resolve()
            root = next((r for r in self.roots if c == r or r in c.parents), None)
            if root is None:
                raise ToolError("path is outside the workspace roots: %s" % path)
        else:
            s = s.lstrip("/")
            root, rest = self.roots[0], s
            head, _, tail = s.partition("/")
            if len(self.roots) > 1 and head:
                hit = next((r for r in self.roots if r.name == head), None)
                if hit is not None and not (hit is self.roots[0] and (self.roots[0] / head).exists()):
                    root, rest = hit, tail
            c = (root / rest).resolve()
            if not (c == root or root in c.parents):
                raise ToolError("path is outside the workspace roots: %s" % path)
        for part in c.relative_to(root).parts:
            low = part.lower()
            if len(part) > 150 or re.search(r'[<>:"|?*\x00-\x1f]', part) or part != part.rstrip(" .") or low.split(".")[0] in self.WIN_RESERVED:
                raise ToolError("invalid name for Windows: %r (no < > : \" | ? *, no trailing space or dot, not CON / NUL / COM1 …)" % part)
            if low in (".chipbench", ".git"):
                raise ToolError("%s is managed by ChipBench / git and cannot be written through MCP" % part)
        if len(str(c)) > 240:
            raise ToolError("path too long (> 240 characters)")
        return c, root

    def _check_text_target(self, p, content):
        if p.suffix.lower() in self.BLOCKED_EXT:
            raise ToolError("refusing to write an executable / script type (%s); the workspace is for notes, code and data files" % p.suffix)
        if len(content.encode("utf-8", "replace")) > self.MAX_WRITE:
            raise ToolError("content larger than 5 MB; split it into several files")
        if p.exists():
            if p.is_dir():
                raise ToolError("%s is a folder" % self.rel(p))
            with open(p, "rb") as fh:
                if b"\x00" in fh.read(8192):
                    raise ToolError("%s looks like a binary file; MCP only writes text files" % self.rel(p))

    def _missing_parents(self, p, root):
        out, d = [], p.parent
        while d != root and root in d.parents and not d.exists():
            out.append(d)
            d = d.parent
        return list(reversed(out))

    def create_folder(self, path):
        p, root = self._new_path(path)
        if p == root:
            return "%s is a workspace root (already exists)" % str(root)
        if p.exists():
            if p.is_dir():
                return "already exists: %s/" % self.rel(p)
            raise ToolError("%s exists and is a file" % self.rel(p))
        made = self._missing_parents(p / "x", root)
        self._mkdir(p)
        return ("would create" if self.dry else "created") + " folder %s/%s" % (self.rel(p), "" if len(made) <= 1 else "  (+%d parent folder(s))" % (len(made) - 1))

    def _put_file(self, path, content, mode):
        """mode: create (fail if exists) | overwrite | write (create or replace)"""
        if str(path).strip().replace("\\", "/").endswith("/"):
            raise ToolError("%r looks like a folder; use create_folder" % path)
        content = "" if content is None else str(content)
        p, root = self._new_path(path)
        if p == root:
            raise ToolError("path must name a file")
        existed = p.exists()
        if existed and mode == "create":
            raise ToolError("already exists: %s (use write_file or overwrite=true to replace; backup is kept)" % self.rel(p))
        self._check_text_target(p, content)
        made = self._missing_parents(p, root)
        bk = self.write(p, content)
        n = content.count("\n") + (1 if content and not content.endswith("\n") else 0)
        return "%s %s (%d chars, %d lines)%s%s" % ("replaced" if existed else "created", self.rel(p), len(content), n,
                                                    ", backup: " + bk if bk else "", "; created folder(s): " + ", ".join(self.rel(d) + "/" for d in made) if made else "")

    def create_file(self, path, content="", overwrite=False):
        return self._put_file(path, content, "overwrite" if overwrite else "create")

    def write_file(self, path, content):
        return self._put_file(path, content, "write")

    def append_file(self, path, content, newline=True):
        p, root = self._new_path(path)
        if p == root or str(path).strip().replace("\\", "/").endswith("/"):
            raise ToolError("path must name a file")
        content = "" if content is None else str(content)
        if not p.exists():
            return self._put_file(path, content, "create")
        self._check_text_target(p, content)
        old, _ = read_text(p)
        sep = "\n" if newline and old and not old.endswith("\n") and content and not content.startswith(("\n", "\r")) else ""
        bk = self.write(p, old + sep + content)
        return "appended %d chars to %s%s" % (len(content), self.rel(p), ", backup: " + bk if bk else "")

    def create_tree(self, entries, overwrite=False):
        """Create many folders / files in one call. entry.path ending with '/' (or without content) …"""
        if not isinstance(entries, list) or not entries:
            raise ToolError("entries must be a non-empty list of {path, content?}")
        if len(entries) > self.MAX_TREE:
            raise ToolError("at most %d entries per call" % self.MAX_TREE)
        plan, seen = [], set()
        for i, e in enumerate(entries):
            if not isinstance(e, dict) or not str(e.get("path") or "").strip():
                raise ToolError("entries[%d]: path is required" % i)
            raw = str(e["path"]).strip()
            is_dir = raw.replace("\\", "/").endswith("/") and e.get("content") in (None, "")
            p, root = self._new_path(raw)
            if p == root:
                continue
            if p in seen:
                raise ToolError("entries[%d]: duplicate path %s" % (i, raw))
            seen.add(p)
            content = "" if e.get("content") is None else str(e["content"])
            if not is_dir:
                if raw.replace("\\", "/").endswith("/"):
                    raise ToolError("entries[%d]: %r is a folder path but has content" % (i, raw))
                self._check_text_target(p, content) if (overwrite or not p.exists()) else None
            elif p.exists() and not p.is_dir():
                raise ToolError("entries[%d]: %s exists and is a file" % (i, raw))
            plan.append((p, root, is_dir, content))
        total = sum(len(c.encode("utf-8", "replace")) for _, _, d, c in plan if not d)
        if total > 4 * self.MAX_WRITE:
            raise ToolError("total content larger than 20 MB")
        out, nf, nd, ns = [], 0, 0, 0
        for p, root, is_dir, content in plan:
            if is_dir:
                if p.is_dir():
                    out.append("= folder  %s/ (exists)" % self.rel(p)); ns += 1
                else:
                    self._mkdir(p); out.append("+ folder  %s/" % self.rel(p)); nd += 1
            elif p.exists() and not overwrite:
                out.append("= file    %s (exists, skipped)" % self.rel(p)); ns += 1
            else:
                existed = p.exists()
                self.write(p, content); out.append("%s file    %s (%d chars)" % ("~" if existed else "+", self.rel(p), len(content))); nf += 1
        return "%d folder(s) and %d file(s) written, %d skipped\n%s" % (nd, nf, ns, "\n".join(out))

    def find_files(self, pattern="", ext="", limit=200):
        import fnmatch
        pat = (pattern or "*").lower()
        if not any(c in pat for c in "*?["):
            pat = "*" + pat + "*"
        exts = {("." + e.strip().lstrip(".").lower()) for e in str(ext or "").replace(",", " ").split() if e.strip()}
        rows = []
        for f in self._walk():
            if exts and f.suffix.lower() not in exts:
                continue
            if fnmatch.fnmatch(f.name.lower(), pat):
                rows.append("%s\t%s" % (self.rel(f), _size(f.stat().st_size)))
                if len(rows) >= int(limit or 200):
                    break
        return "%d files\n" % len(rows) + "\n".join(rows)

    def grep_files(self, query, glob="", regex=False, case_sensitive=False, max_results=200, path=""):
        import fnmatch
        try:
            rx = re.compile(query if regex else re.escape(query), 0 if case_sensitive else re.I)
        except re.error as e:
            raise ToolError("bad regex: %s" % e)
        globs = [g.strip().lower() for g in str(glob or "").replace(",", " ").split() if g.strip()]
        hits, nfiles = [], 0
        for f in self._walk(path):
            if globs and not any(fnmatch.fnmatch(f.name.lower(), g) for g in globs):
                continue
            if not globs and f.suffix.lower() not in self.TEXT_EXT:
                continue
            try:
                if f.stat().st_size > 20 * 1024 * 1024:
                    continue
                text, _ = read_text(f)
            except Exception:
                continue
            nfiles += 1
            for i, line in enumerate(text.split("\n"), 1):
                if rx.search(line):
                    hits.append("%s:%d: %s" % (self.rel(f), i, line.strip()[:220]))
                    if len(hits) >= int(max_results or 200):
                        return "%d hits (stopped at max_results) in %d files\n" % (len(hits), nfiles) + "\n".join(hits)
        return "%d hits in %d files searched\n" % (len(hits), nfiles) + "\n".join(hits)

    def search_pdf(self, query, path="", max_results=60):
        q = str(query or "").strip()
        if not q:
            raise ToolError("query is required")
        rx = re.compile(re.escape(q).replace(r"\ ", r"\s+"), re.I)
        pdfs = [self.path(path)] if path else [f for f in self._walk() if f.suffix.lower() == ".pdf"]
        hits, missing = [], []
        for f in pdfs:
            c = self._pdf_cache(f)
            if not c.exists():
                missing.append(self.rel(f)); continue
            try:
                pages = json.loads(c.read_text("utf-8"))
            except Exception:
                continue
            for n, t in enumerate(pages, 1):
                for m in rx.finditer(t or ""):
                    a, b = max(0, m.start() - 80), min(len(t), m.end() + 80)
                    hits.append("[[%s#p=%d]] …%s…" % (f.name, n, re.sub(r"\s+", " ", t[a:b]).strip()))
                    if len(hits) >= int(max_results or 60):
                        break
                if len(hits) >= int(max_results or 60):
                    break
        out = "%d hits for %r in %d PDFs\n" % (len(hits), q, len(pdfs) - len(missing)) + "\n".join(hits)
        if missing:
            out += "\n\nNot searchable yet (open once in ChipBench to build the text cache): " + ", ".join(missing[:20])
        return out

    def _journal_path(self, date=""):
        ws = (self._state().get("workspace") or {})
        d = date or datetime.date.today().isoformat()
        base = Path(ws["journal"]) if ws.get("journal") else self.root / "日志"
        p = (base / (d + ".md")).resolve()
        if not any(p == r or r in p.parents for r in self.roots):
            p = (self.root / "日志" / (d + ".md")).resolve()
        return p

    def append_journal(self, content, date=""):
        p = self._journal_path(date)
        self._mkdir(p.parent, log=False)
        old = read_text(p)[0] if p.exists() else "# %s\n" % (date or datetime.date.today().isoformat())
        self.write(p, old.rstrip("\n") + "\n\n" + content.strip("\n") + "\n")
        return "appended to %s" % self.rel(p)

    def add_task(self, text, plan="", due="", estimate="", path=""):
        t = re.sub(r"\s+", " ", str(text or "")).strip()
        if not t:
            raise ToolError("text is required")
        for k, v in (("plan", plan), ("due", due)):
            if v and not re.match(r"^\d{4}-\d{2}-\d{2}$", v):
                raise ToolError("%s must be YYYY-MM-DD" % k)
        line = "- [ ] " + t + (" ⏳ " + plan if plan else "") + (" \U0001F4C5 " + due if due else "") + (" ~" + estimate if estimate else "")
        if path:
            p = self.find_note(path) if Path(str(path)).suffix else self.path(str(path) + ".md", must_exist=False)
        else:
            p = self._journal_path()
        self._mkdir(p.parent, log=False)
        old = read_text(p)[0] if p.exists() else "# %s\n" % p.stem
        self.write(p, old.rstrip("\n") + "\n" + line + "\n")
        return "added to %s: %s" % (self.rel(p), line)

    def set_task_done(self, path, line, done=True):
        p = self.find_note(path)
        text, _ = read_text(p)
        lines = text.split("\n")
        i = int(line) - 1
        if not (0 <= i < len(lines)) or not TASK_RE.match(lines[i]):
            raise ToolError("line %s is not a task ('- [ ] …')" % line)
        l = lines[i]
        if done:
            l = re.sub(r"\[[ ]\]", "[x]", l, count=1)
            if "✅" not in l:
                l = l.rstrip() + " ✅ " + datetime.date.today().isoformat()
        else:
            l = re.sub(r"\[[xX]\]", "[ ]", l, count=1)
            l = re.sub(r"\s*✅\s?\d{4}-\d{2}-\d{2}", "", l)
        lines[i] = l
        self.write(p, "\n".join(lines))
        return "%s:%d → %s" % (self.rel(p), i + 1, l.strip())

    def _component_at(self, path, line):
        p = self.path(path)
        for c in self._components(p):
            if c["start_line"] <= int(line) <= c["end_line"]:
                return c
        raise ToolError("no component block at %s:%s" % (path, line))

    def evaluate_clocktree(self, path, line):
        c = self._component_at(path, line)
        if c["type"] not in ("clocktree", "clock-tree"):
            raise ToolError("block at that line is %s, not clocktree" % c["type"])
        m = mini_yaml(c["source"])
        nodes = {str(n.get("id")): n for n in (m.get("nodes") or []) if isinstance(n, dict) and n.get("id") is not None}
        memo, rows, bad = {}, [], []
        def f(nid, seen=()):
            if nid in memo:
                return memo[nid]
            n = nodes.get(nid)
            if n is None or nid in seen:
                return None
            kind = str(n.get("kind", "")).lower()
            src = n.get("in")
            if isinstance(src, list):
                sel = n.get("sel", 0)
                src = src[int(sel)] if str(sel).isdigit() and int(sel) < len(src) else (src[0] if src else None)
            fin = f(str(src), seen + (nid,)) if src is not None else None
            if kind == "source" or (fin is None and n.get("freq") is not None):
                v = parse_freq(n.get("freq"))
            elif fin is None:
                v = None
            else:
                v = fin * float(n.get("mul", 1) or 1) / float(n.get("div", 1) or 1)
            memo[nid] = v
            return v
        for nid, n in nodes.items():
            v = f(nid)
            mx = parse_freq(n.get("max")) if n.get("max") is not None else None
            over = v is not None and mx is not None and v > mx * (1 + 1e-9)
            if over:
                bad.append(nid)
            rows.append("| %s | %s | %s | %s | %s | %s |" % (nid, n.get("label", ""), n.get("kind", ""), fmt_freq(v), fmt_freq(mx) if mx else "", "**超限**" if over else ("p.%s" % n["page"] if n.get("page") is not None else "")))
        head = "%s (%s:%d)\n\n| id | 名称 | 类型 | 频率 | 上限 | 备注 |\n|---|---|---|---:|---:|---|\n" % (m.get("title") or "clocktree", self.rel(self.path(path)), c["start_line"])
        return head + "\n".join(rows) + ("\n\n超出上限：" + ", ".join(bad) if bad else "\n\n所有节点都在上限以内。")

    def decode_register(self, path, line, value):
        c = self._component_at(path, line)
        if c["type"] != "register":
            raise ToolError("block at that line is %s, not register" % c["type"])
        m = mini_yaml(c["source"])
        v = int(str(value).replace("_", ""), 0)
        w = int(m.get("width", 32) or 32)
        rows = []
        for fd in m.get("fields") or []:
            if not isinstance(fd, dict):
                continue
            bits = str(fd.get("bits", ""))
            hi, _, lo = bits.partition(":")
            hi = int(hi); lo = int(lo) if lo else hi
            fv = (v >> lo) & ((1 << (hi - lo + 1)) - 1)
            vals = fd.get("values") or {}
            meaning = vals.get(fv, vals.get(str(fv), "")) if isinstance(vals, dict) else ""
            rows.append("| %s | %s | 0x%X (%d) | %s | %s |" % (fd.get("name", ""), bits, fv, fv, meaning, fd.get("desc", "")))
        return "%s = 0x%0*X (%d-bit)\n\n| 字段 | 位 | 值 | 含义 | 说明 |\n|---|---|---|---|---|\n" % (m.get("name", "register"), (w + 3) // 4, v, w) + "\n".join(rows)

    def describe_ipblock(self, path, line):
        c = self._component_at(path, line)
        if c["type"] != "ipblock":
            raise ToolError("block at that line is %s, not ipblock" % c["type"])
        m = mini_yaml(c["source"])
        blocks = [b for b in (m.get("blocks") or []) if isinstance(b, dict)]
        links = [l for l in (m.get("links") or []) if isinstance(l, dict)]
        ids = {str(b.get("id")) for b in blocks} | {str(g.get("id")) for g in (m.get("groups") or []) if isinstance(g, dict)}
        out = ["%s (%s:%d)%s" % (m.get("title") or "ipblock", self.rel(self.path(path)), c["start_line"], ("  source: %s" % m["source"]) if m.get("source") else ""), ""]
        out.append("| 模块 | 名称 | 分组 | 类型 | 页码 | 寄存器 | 状态 |\n|---|---|---|---|---|---|---|")
        for b in blocks:
            regs = b.get("regs"); regs = ", ".join(map(str, regs)) if isinstance(regs, list) else (regs or "")
            out.append("| %s | %s | %s | %s | %s | %s | %s |" % (b.get("id"), b.get("label", ""), b.get("group", ""), b.get("kind", ""), b.get("page", ""), regs, b.get("status", "unverified")))
        out.append("\n| 从 | 到 | 类型 | 说明 |\n|---|---|---|---|")
        bad = []
        for l in links:
            f, t = str(l.get("from")), str(l.get("to"))
            if f not in ids or t not in ids:
                bad.append("%s → %s" % (f, t))
            out.append("| %s | %s | %s | %s |" % (f, t, l.get("kind", "data"), l.get("label", "")))
        nopage = [str(b.get("id")) for b in blocks if b.get("page") is None]
        if bad:
            out.append("\n连线引用了不存在的模块：" + "; ".join(bad))
        if nopage and m.get("source"):
            out.append("\n没有页码的模块：" + ", ".join(nopage))
        return "\n".join(out)

    # ------------------------------------------------------------ 1.4: IP 图谱 (IP atlas)
    ATLAS_SECTIONS = ["概览", "结构", "场景", "寄存器", "时序", "代码", "要点与坑"]

    def _atlas_meta(self, p, text, bundled):
        m = re.match(r"^---\n(.*?)\n(?:---|\.\.\.)", text, re.S)
        if not m or not re.search(r"^type:\s*ip-atlas\s*$", m.group(1), re.M | re.I):
            return None
        fm = mini_yaml(m.group(1))
        return {"path": str(p) if bundled else self.rel(p), "ip": str(fm.get("ip") or "其他"), "chip": str(fm.get("chip") or p.stem),
                "status": str(fm.get("status") or "待核对"), "source": str(fm.get("source") or ""), "bundled": bundled,
                "scenes": text.count("```scene"), "registers": text.count("```register"), "facts": fm.get("facts") if isinstance(fm.get("facts"), dict) else {}}

    def _atlas_pages(self):
        out = []
        b = Path(__file__).resolve().parent.parent / "atlas"
        if b.is_dir():
            for f in sorted(b.glob("*/*.md")):
                try:
                    mt = self._atlas_meta(f, read_text(f)[0], True)
                except Exception:
                    mt = None
                if mt:
                    mt["_p"] = f; out.append(mt)
        for f in self._walk():
            if f.suffix.lower() != ".md":
                continue
            try:
                t = read_text(f)[0]
            except Exception:
                continue
            if "ip-atlas" not in t[:600]:
                continue
            mt = self._atlas_meta(f, t, False)
            if mt:
                mt["_p"] = f; out.append(mt)
        ws = {(p["ip"].lower(), p["chip"].lower()) for p in out if not p["bundled"]}
        return [p for p in out if not p["bundled"] or (p["ip"].lower(), p["chip"].lower()) not in ws]

    def _atlas_find(self, page):
        s = str(page or "").strip()
        pages = self._atlas_pages()
        for p in pages:
            if s in (p["path"], str(p["_p"])) or s.replace("\\", "/").lower() == ("%s/%s" % (p["ip"], p["chip"])).lower():
                return p
        hits = [p for p in pages if s.lower() and (s.lower() in p["chip"].lower() or s.lower() in p["path"].lower())]
        if len(hits) == 1:
            return hits[0]
        raise ToolError("atlas page not found: %r (use atlas_list; give the path or 'IP/chip', e.g. 'CAN-FD/RH850/U2B')" % s)

    @staticmethod
    def _atlas_sections(text):
        body = re.sub(r"^---\n.*?\n(?:---|\.\.\.)[ \t]*\n", "", text, count=1, flags=re.S)
        parts = re.split(r"^##\s+(.+?)\s*$", body, flags=re.M)
        secs = {"_intro": parts[0]}
        for i in range(1, len(parts), 2):
            secs[parts[i].strip()] = parts[i + 1]
        return secs

    def atlas_list(self, ip=""):
        rows = [p for p in self._atlas_pages() if not ip or ip.lower() in p["ip"].lower()]
        if not rows:
            return "No IP atlas pages%s. Create one with atlas_create_page." % (" for %s" % ip if ip else "")
        out = ["| IP | 芯片 | 状态 | 场景 | 寄存器 | 来源 | 路径 |", "|---|---|---|---:|---:|---|---|"]
        for p in rows:
            out.append("| %s | %s | %s | %d | %d | %s | %s |" % (p["ip"], p["chip"], p["status"], p["scenes"], p["registers"], "内置示例（只读）" if p["bundled"] else "工作区", p["path"]))
        return "\n".join(out)

    def atlas_read(self, page, section=""):
        p = self._atlas_find(page)
        text = read_text(p["_p"])[0]
        if not section:
            secs = self._atlas_sections(text)
            head = "%s · %s  (%s)\nsections: %s\nfacts: %s\n\n" % (p["ip"], p["chip"], p["path"], ", ".join(k for k in secs if k != "_intro"), json.dumps(p["facts"], ensure_ascii=False))
            return head + (text if len(text) < 60000 else text[:60000] + "\n…(truncated; read one section at a time)")
        secs = self._atlas_sections(text)
        if section not in secs:
            raise ToolError("no section '%s'; available: %s" % (section, ", ".join(k for k in secs if k != "_intro")))
        return "## %s\n%s" % (section, secs[section])

    def atlas_create_page(self, ip, chip, source="", chapter="", facts=None):
        ip, chip = str(ip).strip(), str(chip).strip()
        if not ip or not chip:
            raise ToolError("ip and chip are required")
        ws = (self._state().get("workspace") or {})
        base = Path(ws["home"]) if ws.get("home") else self.root
        safe = lambda s: re.sub(r'[\\/:*?"<>|]', "-", s).strip()
        p = (base / "IP图谱" / safe(ip) / (safe(chip) + ".md")).resolve()
        if not any(p == r or r in p.parents for r in self.roots):
            p = (self.root / "IP图谱" / safe(ip) / (safe(chip) + ".md")).resolve()
        if p.exists():
            raise ToolError("page already exists: %s" % self.rel(p))
        fx = facts if isinstance(facts, dict) else {}
        fl = "{" + ", ".join("%s: %s" % (k, json.dumps(str(v), ensure_ascii=False)) for k, v in fx.items()) + "}"
        text = ("---\ntype: ip-atlas\nip: %s\nchip: %s\nsource: %s\nchapter: %s\nstatus: 草稿\nfacts: %s\n---\n# %s · %s\n\n"
                % (ip, chip, source, chapter, fl, ip, chip)) + "".join("## %s\n\n（待填写）\n\n" % s for s in self.ATLAS_SECTIONS)
        self._mkdir(p.parent, log=False)
        self.write(p, text)
        return "created %s — fill sections with atlas_write_section, add walkthroughs with atlas_add_scene, then run atlas_validate" % self.rel(p)

    def _atlas_writable(self, page):
        p = self._atlas_find(page)
        if p["bundled"]:
            raise ToolError("'%s' is a bundled example (read-only). Copy it into the workspace in ChipBench (复制到工作区) or create a new page." % p["path"])
        return p

    def _atlas_mark(self, text):
        return re.sub(r"^(status:\s*).*$", r"\g<1>待核对", text, count=1, flags=re.M)

    def atlas_write_section(self, page, section, content):
        p = self._atlas_writable(page)
        text = read_text(p["_p"])[0]
        content = str(content).strip("\n")
        pat = re.compile(r"(^##\s+%s\s*$\n)(.*?)(?=^##\s|\Z)" % re.escape(section), re.M | re.S)
        if pat.search(text):
            text = pat.sub(lambda m: m.group(1) + "\n" + content + "\n\n", text, count=1)
        else:
            text = text.rstrip("\n") + "\n\n## %s\n\n%s\n" % (section, content)
        self.write(p["_p"], self._atlas_mark(text))
        return "wrote section '%s' of %s (status → 待核对; a human must confirm in ChipBench)" % (section, p["path"])

    def atlas_add_scene(self, page, scene_yaml):
        p = self._atlas_writable(page)
        body = str(scene_yaml).strip("\n")
        if body.startswith("```"):
            body = re.sub(r"^```\w*\n|\n```$", "", body)
        y = mini_yaml(body)
        if not isinstance(y.get("steps"), list) or not y.get("steps"):
            raise ToolError("scene needs title and steps: - {t: ..., hl: [ids], links: [a>b], regs: [{r: NAME, v: 0x.., n: note}], line: N, page: N, x: narration}")
        text = read_text(p["_p"])[0]
        block = "```scene\n%s\n```\n" % body
        pat = re.compile(r"(^##\s+场景\s*$\n)(.*?)(?=^##\s|\Z)", re.M | re.S)
        m = pat.search(text)
        text = text[:m.end()].rstrip("\n") + "\n\n" + block + "\n" + text[m.end():] if m else text.rstrip("\n") + "\n\n## 场景\n\n" + block
        self.write(p["_p"], self._atlas_mark(text))
        issues = self.atlas_validate(p["path"])
        return "added scene '%s' (%d steps) to %s\n\nvalidation:\n%s" % (y.get("title", ""), len(y["steps"]), p["path"], issues)

    def atlas_validate(self, page):
        p = self._atlas_find(page)
        text = read_text(p["_p"])[0]
        out = []
        blocks = re.findall(r"```([\w-]+)[^\n]*\n(.*?)\n```", text, re.S)
        ipbs = [mini_yaml(b) for l, b in blocks if l.lower() == "ipblock"]
        regs = {str(mini_yaml(b).get("name", "")).upper() for l, b in blocks if l.lower() == "register"}
        codes = [b for l, b in blocks if l.lower() in ("c", "cpp")]
        reg_ok = lambda n: not regs or str(n).upper() in regs or any(r.endswith(str(n).upper()) or str(n).upper().endswith(r) for r in regs if r)
        if not ipbs:
            out.append("WARN no ```ipblock structure diagram")
        if not p["source"]:
            out.append("WARN no source manual in front matter")
        for y in ipbs:
            ids = {str(b.get("id")) for b in (y.get("blocks") or []) + (y.get("groups") or []) if isinstance(b, dict)}
            for l in y.get("links") or []:
                if isinstance(l, dict) and (_ep(l.get("from"), ids) not in ids or _ep(l.get("to"), ids) not in ids):
                    out.append("ERR  diagram '%s': link %s → %s references a missing block" % (y.get("title", ""), l.get("from"), l.get("to")))
            for b in y.get("blocks") or []:
                if isinstance(b, dict):
                    for r in (b.get("regs") or []) if isinstance(b.get("regs"), list) else []:
                        if not reg_ok(r):
                            out.append("WARN block %s: register %s not defined in 寄存器" % (b.get("id"), r))
        for si, (l, b) in enumerate([x for x in blocks if x[0].lower() == "scene"]):
            y = mini_yaml(b)
            name = y.get("title") or "#%d" % (si + 1)
            dg = next((d for d in ipbs if not y.get("diagram") or str(d.get("title")) == str(y.get("diagram"))), None)
            if not dg:
                out.append("ERR  scene '%s': diagram '%s' not found" % (name, y.get("diagram"))); continue
            ids = {str(x.get("id")) for x in (dg.get("blocks") or []) + (dg.get("groups") or []) if isinstance(x, dict)}
            lk = {"%s>%s" % (_ep(x.get("from"), ids), _ep(x.get("to"), ids)) for x in dg.get("links") or [] if isinstance(x, dict)}
            steps = y.get("steps")
            if steps is not None and not isinstance(steps, list):
                out.append("ERR  scene '%s': steps must be a list of {t: …} maps" % name); continue
            steps = steps or []
            if not steps:
                out.append("WARN scene '%s': no steps" % name)
            for i, s in enumerate(steps, 1):
                if not isinstance(s, dict):
                    out.append("ERR  scene '%s' step %d is not a {…} map" % (name, i)); continue
                for h in s.get("hl") or []:
                    if str(h) not in ids:
                        out.append("ERR  scene '%s' step %d: highlighted block %s does not exist" % (name, i, h))
                for k in s.get("links") or []:
                    a, _, c = str(k).partition(">")
                    if "%s>%s" % (a, c) not in lk and "%s>%s" % (c, a) not in lk:
                        out.append("WARN scene '%s' step %d: link %s not in diagram" % (name, i, k))
                for r in s.get("regs") or []:
                    if isinstance(r, dict) and not reg_ok(r.get("r")):
                        out.append("WARN scene '%s' step %d: register %s not defined in 寄存器" % (name, i, r.get("r")))
                if s.get("line") is not None:
                    cb = codes[int(y.get("code") or 0)] if len(codes) > int(y.get("code") or 0) else None
                    if cb is None or not (1 <= int(s["line"]) <= len(cb.split("\n"))):
                        out.append("WARN scene '%s' step %d: code line %s out of range" % (name, i, s["line"]))
                if not s.get("x"):
                    out.append("WARN scene '%s' step %d: missing narration x" % (name, i))
        am = atlas_parse(text)
        for l in am["links"]:
            for bid, port in ((l["from"], l["fromPort"]), (l["to"], l["toPort"])):
                bl = next((b for b in am["blocks"] if b["id"] == bid and b["diagram"] == l["diagram"]), None)
                if bl and port and bl["ports"] and port not in bl["ports"]:
                    out.append("ERR  link port %s.%s is not declared in the block's ports" % (bid, port))
        seen_addr = {}
        for r in am["registers"].values():
            if r["width"] not in (8, 16, 32, 64):
                out.append("WARN register %s: width %d is not 8/16/32/64" % (r["name"], r["width"]))
            if r["address"] is not None:
                if r["address"] in seen_addr:
                    out.append("WARN register %s has the same address as %s (0x%X)" % (r["name"], seen_addr[r["address"]], r["address"]))
                else:
                    seen_addr[r["address"]] = r["name"]
            if r["reset"] is not None and r["reset"] >= (1 << r["width"]):
                out.append("ERR  register %s: reset value exceeds %d bits" % (r["name"], r["width"]))
            taken = []
            for f in r["fields"]:
                if not f["bits"]:
                    out.append("ERR  register %s field %s: bits %r malformed (use 7 or 15:8)" % (r["name"], f["name"], f["bitsRaw"])); continue
                if f["bits"][0] >= r["width"]:
                    out.append("ERR  register %s field %s: bit %d beyond width %d" % (r["name"], f["name"], f["bits"][0], r["width"]))
                hit = next((t for t in taken if not (f["bits"][0] < t["bits"][1] or f["bits"][1] > t["bits"][0])), None)
                if hit:
                    out.append("WARN register %s field %s overlaps %s" % (r["name"], f["name"], hit["name"]))
                taken.append(f)
        for sc in am["scenes"]:
            for st in sc["steps"]:
                for r in st["regs"]:
                    R = atlas_find_reg(am, r["r"])
                    if R and r["v"] is None and r["raw"] is not None:
                        out.append("ERR  scene '%s' step %d: register %s value %r is not a number" % (sc["title"], st["n"], r["r"], r["raw"]))
                    elif R and r["v"] is not None and (r["v"] < 0 or r["v"] >= (1 << R["width"])):
                        out.append("ERR  scene '%s' step %d: register %s value 0x%X exceeds %d bits" % (sc["title"], st["n"], r["r"], r["v"], R["width"]))
        nopage = sum(1 for y in ipbs for b in (y.get("blocks") or []) if isinstance(b, dict) and b.get("page") is None)
        if p["source"] and nopage:
            out.append("WARN %d blocks have no manual page" % nopage)
        if not any(x.startswith("ERR") for x in out):
            out.insert(0, "OK — no errors" + (" (%d warnings)" % len(out) if out else "; diagram, scenes, registers and code references are consistent"))
        return "\n".join(out)

    def atlas_compare(self, ip):
        rows = [p for p in self._atlas_pages() if p["ip"].lower() == str(ip).lower()]
        if not rows:
            raise ToolError("no atlas pages for IP %s" % ip)
        keys = []
        for p in rows:
            keys += [k for k in p["facts"] if k not in keys]
        out = ["| 参数 | " + " | ".join(p["chip"] for p in rows) + " |", "|---|" + "---|" * len(rows)]
        for k in keys:
            vals = [str(p["facts"].get(k, "—")) for p in rows]
            out.append("| %s%s | %s |" % (k, " ⚠" if len(set(v for v in vals if v != "—")) > 1 else "", " | ".join(vals)))
        out.append("| 场景数 | " + " | ".join(str(p["scenes"]) for p in rows) + " |")
        out.append("| 寄存器数 | " + " | ".join(str(p["registers"]) for p in rows) + " |")
        return "\n".join(out) + ("\n\n⚠ = values differ between chips" if len(rows) > 1 else "\n\nOnly one chip for this IP so far.")

    # ------------------------------------------------------------ 1.7: atlas evidence + impact (mirrors the app's 依据与一致性 tab)
    def atlas_evidence(self, page):
        p = self._atlas_find(page)
        m = atlas_parse(read_text(p["_p"])[0])
        items = {"block": [(b["id"], b["pages"], b["level"]) for b in m["blocks"]], "register": [], "field": [], "step": []}
        for r in m["registers"].values():
            items["register"].append((r["name"], r["pages"], r["level"]))
            items["field"] += [(r["name"] + "." + f["name"], f["pages"], f["level"]) for f in r["fields"]]
        for sc in m["scenes"]:
            items["step"] += [("%s#%d" % (sc["title"], st["n"]), st["pages"], st["level"]) for st in sc["steps"]]
        out = {"page": p["path"], "source": p["source"], "docrev": str(read_front(p["_p"]).get("docrev") or ""), "kinds": {}}
        tot = wp = conf = 0
        for k, L in items.items():
            lv = {l: 0 for l in EV_LEVELS}
            for _, pg, level in L:
                lv[level or "待核对"] = lv.get(level or "待核对", 0) + 1
            out["kinds"][k] = {"total": len(L), "with_page": sum(1 for _, pg, _l in L if pg), "bad_page": sum(1 for _, pg, _l in L if pg is None), "by_level": lv}
            tot += len(L); wp += out["kinds"][k]["with_page"]; conf += lv["手册确认"]
        out["total"], out["with_page"], out["confirmed"] = tot, wp, conf
        out["page_coverage"] = round(wp / tot, 3) if tot else 1
        out["missing_page"] = [i for k in ("block", "register") for i, pg, _ in items[k] if not pg][:80]
        out["how_to_add"] = "Add `page: 123`, `ev: 手册确认|实测|推导|示意|待核对`, `sec: \"24.4.2\"`, `cond: ...` to blocks / registers / fields / scene steps; add `docrev:` to the front matter. Only record what the manual actually says."
        return json.dumps(out, ensure_ascii=False, indent=1)

    def atlas_impact(self, page, register):
        p = self._atlas_find(page)
        m = atlas_parse(read_text(p["_p"])[0])
        R = atlas_find_reg(m, register)
        if not R:
            raise ToolError("register %s is not defined on this page (defined: %s)" % (register, ", ".join(sorted(m["registers"])[:40])))
        blocks = [{"id": b["id"], "label": b["label"], "diagram": b["diagram"]} for b in m["blocks"] if any(r.upper() == R["name"] or R["name"].endswith(r.upper()) or r.upper().endswith(R["name"]) for r in b["regs"])]
        steps = []
        for sc in m["scenes"]:
            prev = None
            for st in sc["steps"]:
                for r in st["regs"]:
                    rr = atlas_find_reg(m, r["r"])
                    if rr and rr["name"] == R["name"]:
                        now = atlas_decode(R, r["v"]) if r["v"] is not None else None
                        changed = ([f["name"] for f, q in zip(now, prev) if f["value"] != q["value"]] if now and prev else ([f["name"] for f in now if f["value"]] if now else []))
                        steps.append({"scene": sc["title"], "step": st["n"], "title": st["t"], "value": r["v"] if r["v"] is None else "0x%X" % r["v"], "changed_fields": changed, "highlight": st["hl"], "code_line": st["line"]})
                        if now:
                            prev = now
        rx = re.compile(r"\b" + re.escape(R["name"]) + r"\w*", re.I)
        code = [{"block": ci + 1, "line": li + 1, "text": ln.strip()[:160]} for ci, c in enumerate(m["code"]) for li, ln in enumerate(c["lines"]) if rx.search(ln)]
        return json.dumps({"register": R["name"], "address": None if R["address"] is None else "0x%08X" % R["address"], "width": R["width"], "reset": None if R["reset"] is None else "0x%X" % R["reset"], "desc": R["desc"],
                           "evidence": {"pages": R["pages"], "level": R["level"]}, "fields": [{"name": f["name"], "bits": f["bitsRaw"], "desc": f["desc"]} for f in R["fields"]],
                           "blocks": blocks, "scene_steps": steps, "code": code}, ensure_ascii=False, indent=1)

    def _skill_dirs(self):
        ds = [(Path(__file__).resolve().parent.parent / "skills", "bundled")]
        ds += [(r / ".agents" / "skills", r.name) for r in self.roots]
        return [(d, src) for d, src in ds if d.is_dir()]

    def _skills(self):
        out = {}
        for d, src in self._skill_dirs():
            for f in sorted(d.glob("*/SKILL.md")):
                text, _ = read_text(f)
                m = re.match(r"^---\s*\n(.*?)\n---", text, re.S)
                meta = dict(re.findall(r"^(\w[\w-]*):\s*(.+)$", m.group(1), re.M)) if m else {}
                name = meta.get("name", f.parent.name).strip()
                out[name] = {"name": name, "description": meta.get("description", "").strip(), "dir": f.parent, "source": src}
        return out

    def list_skills(self):
        sk = self._skills()
        return "%d skills (load one with read_skill)\n" % len(sk) + "\n".join("%s\t[%s]\t%s" % (k, v["source"], v["description"]) for k, v in sorted(sk.items()))

    def read_skill(self, name, file="SKILL.md"):
        sk = self._skills().get(name)
        if not sk:
            raise ToolError("unknown skill: %s (use list_skills)" % name)
        p = (sk["dir"] / file).resolve()
        if sk["dir"].resolve() not in p.parents and p != sk["dir"].resolve():
            raise ToolError("file outside the skill folder")
        if not p.is_file():
            files = [str(x.relative_to(sk["dir"])).replace("\\", "/") for x in sk["dir"].rglob("*") if x.is_file()]
            raise ToolError("not found: %s; files: %s" % (file, ", ".join(files)))
        text, _ = read_text(p)
        files = [str(x.relative_to(sk["dir"])).replace("\\", "/") for x in sk["dir"].rglob("*") if x.is_file()]
        return "skill folder: %s\nfiles: %s\n\n%s" % (sk["dir"], ", ".join(files), text)

    def analyze_capture(self, path, focus=""):
        import aenet
        s = aenet.summarize_file(str(self.path(path)), focus or None)
        return s["report"]

    def check_gcl(self, gcl):
        import aenet
        m = gcl if isinstance(gcl, dict) else json.loads(gcl)
        return json.dumps(aenet.gcl_check(m), ensure_ascii=False, indent=1)

    def calc_cbs(self, link="1Gbps", bandwidth_pct=0, max_frame=1522, max_interference_frame=1522):
        import aenet
        return json.dumps(aenet.cbs(link, bandwidth_pct, None, int(max_frame), int(max_interference_frame)), ensure_ascii=False, indent=1)

    def calc_can_timing(self, clock="80MHz", bitrate="500k", sample_point=80):
        import aenet
        return json.dumps(aenet.can_timing(clock, bitrate, sample_point), ensure_ascii=False, indent=1)


def _size(n):
    return "%d B" % n if n < 1024 else "%.1f KB" % (n / 1024) if n < 1048576 else "%.1f MB" % (n / 1048576)


FREQ_UNITS = {"hz": 1, "khz": 1e3, "mhz": 1e6, "ghz": 1e9, "k": 1e3, "m": 1e6, "g": 1e9}


def parse_freq(s):
    if s is None or s == "":
        return None
    if isinstance(s, (int, float)):
        return float(s)
    m = re.match(r"^\s*([\d.]+)\s*([kKmMgG]?[hH]?[zZ]?)\s*$", str(s))
    if not m:
        return None
    return float(m.group(1)) * FREQ_UNITS.get(m.group(2).lower(), 1)


def fmt_freq(v):
    if v is None:
        return "?"
    for u, k in (("GHz", 1e9), ("MHz", 1e6), ("kHz", 1e3)):
        if v >= k:
            return ("%.6g" % (v / k)) + " " + u
    return "%.6g Hz" % v


def _scalar(t):
    t = t.strip()
    if len(t) >= 2 and t[0] == t[-1] and t[0] in "\"'":
        return t[1:-1]
    if re.match(r"^-?\d+$", t):
        return int(t)
    if re.match(r"^0[xX][0-9a-fA-F]+$", t):
        return int(t, 16)
    if re.match(r"^-?\d*\.\d+$", t):
        return float(t)
    return {"true": True, "false": False, "null": None, "~": None}.get(t, t)


def _flow(t):
    t = t.strip()
    if not t or t[0] not in "{[":
        return _scalar(t)
    items, depth, cur, q = [], 0, "", None
    for ch in t[1:-1]:
        if q:
            cur += ch
            if ch == q:
                q = None
            continue
        if ch in "\"'":
            q = ch; cur += ch; continue
        if ch in "{[":
            depth += 1
        elif ch in "}]":
            depth -= 1
        if ch == "," and depth == 0:
            items.append(cur); cur = ""
        else:
            cur += ch
    if cur.strip():
        items.append(cur)
    if t[0] == "[":
        return [_flow(x) for x in items]
    out = {}
    for it in items:
        k, _, v = it.partition(":")
        out[_scalar(k)] = _flow(v)
    return out


def mini_yaml(text):
    """Enough YAML for ChipBench component blocks: top-level scalars, flow maps / lists, and '- item' lists."""
    out, key = {}, None
    for raw in text.split("\n"):
        line = raw.rstrip()
        if " #" in line and not re.search(r"[\"'][^\"']* #", line):
            line = line.split(" #")[0].rstrip()
        if not line.strip() or line.strip().startswith("#") or line.strip() == "---":
            continue
        m = re.match(r"^\s*-\s+(.*)$", line)
        if m and key is not None:
            if not isinstance(out.get(key), list):
                out[key] = []
            out[key].append(_flow(m.group(1)))
            continue
        m = re.match(r"^([A-Za-z_][\w-]*)\s*:\s*(.*)$", line)
        if m:
            key = m.group(1)
            out[key] = _flow(m.group(2)) if m.group(2).strip() else []
    return out


S = lambda **p: {"type": "object", "properties": p, "additionalProperties": False}
STR = lambda d: {"type": "string", "description": d}
INT = lambda d: {"type": "integer", "description": d}
BOOL = lambda d: {"type": "boolean", "description": d}
TOOLS = [
    ("list_notes", "List Markdown notes in the workspace roots (optionally a sub-folder / regex filter).", S(folder=STR("sub-folder"), pattern=STR("regex on the path"), limit=INT("default 300")), [], True),
    ("read_note", "Read a note by path or by note name (like a [[wiki link]]). Optional line range.", S(path=STR("path or note name"), start_line=INT("1-based"), end_line=INT("inclusive"), line_numbers=BOOL("")), ["path"], True),
    ("search_notes", "Full-text search across all notes; returns path:line: text.", S(query=STR("text or regex"), regex=BOOL(""), case_sensitive=BOOL(""), max_results=INT("default 100")), ["query"], True),
    ("get_outline", "Heading outline of a note with line numbers.", S(path=STR("path or note name")), ["path"], True),
    ("get_backlinks", "Notes that link to the given note.", S(note=STR("path or note name")), ["note"], True),
    ("list_tasks", "Collect '- [ ]' tasks (📅 due, ⏳ planned) across notes; overdue ones are flagged.", S(status={"type": "string", "enum": ["open", "done", "all"]}, due_before=STR("YYYY-MM-DD"), path=STR("limit to one note")), [], True),
    ("create_note", "Create a note (fails if it exists unless overwrite=true).", S(path=STR("path; .md added if missing"), content=STR("Markdown"), overwrite=BOOL("")), ["path", "content"], False),
    ("write_note", "Replace the whole content of a note (backup kept).", S(path=STR("path"), content=STR("full Markdown")), ["path", "content"], False),
    ("append_to_note", "Append Markdown to a note or to the end of a heading's section.", S(path=STR("path or note name"), content=STR("Markdown"), heading=STR("optional heading")), ["path", "content"], False),
    ("replace_in_note", "Replace text in a note (backup kept).", S(path=STR("path or note name"), find=STR("text or regex"), replace=STR("replacement"), all=BOOL(""), regex=BOOL("")), ["path", "find", "replace"], False),
    ("list_workspaces", "List the ChipBench workspaces saved on this machine.", S(), [], True),
    ("get_active_document", "The document currently open in ChipBench: path, selection and content.", S(include_content=BOOL("default true")), [], True),
    ("read_file", "Read any text file in the workspace roots (source code, .map, logs, CSV, headers…) with optional line range.", S(path=STR("path"), start_line=INT("1-based"), end_line=INT("inclusive")), ["path"], True),
    ("list_components", "List engineering component blocks in notes: clocktree / structure / register / memmap / pinout / gcl / wavedrom.", S(path=STR("limit to one note"), type=STR("block type")), [], True),
    ("get_component", "Get the source (YAML / CSV / JSON) of the component block at path:line.", S(path=STR("note path"), line=INT("any line inside the block")), ["path", "line"], True),
    ("update_component", "Replace the body of the component block at path:line (backup kept; block marked 待确认 until a human confirms).", S(path=STR("note path"), line=INT("line inside the block"), content=STR("new block body without fences")), ["path", "line", "content"], False),
    ("list_skills", "List Agent Skills (SKILL.md folders): bundled with ChipBench + <root>/.agents/skills.", S(), [], True),
    ("read_skill", "Load a skill's instructions (SKILL.md) or one of its files (scripts, references, templates).", S(name=STR("skill name"), file=STR("relative file, default SKILL.md")), ["name"], True),
    ("analyze_capture", "Analyze a .pcap / .pcapng: protocol mix, gPTP sync, DoIP session (UDS NRC), SOME/IP-SD, TCP RST / retransmission. Returns a Markdown report.", S(path=STR("capture path"), focus={"type": "string", "enum": ["", "gptp", "doip", "someip"]}), ["path"], True),
    ("check_gcl", "Check a TAS (802.1Qbv) gate control list: cycle sum, Express/Preemptable mapping, guard band, per-queue open time and worst wait.", S(gcl=STR('JSON: {"link":"1Gbps","cycle":"500us","express":[7,6],"preemptable":[0,1],"entries":[{"dur":"100us","gates":"11000000"}]}')), ["gcl"], True),
    ("read_pdf_pages", "Read the text of PDF pages (manuals, datasheets) — at most 20 pages per call. Cite as [[file.pdf#p=N]].", S(path=STR("PDF path"), start=INT("first page, 1-based"), end=INT("last page")), ["path", "start"], True),
    ("calc_cbs", "CBS (802.1Qav) parameters: idleSlope, sendSlope, hiCredit, loCredit.", S(link=STR("e.g. 100Mbps"), bandwidth_pct={"type": "number"}, max_frame=INT("bytes"), max_interference_frame=INT("bytes")), ["bandwidth_pct"], True),
    ("calc_can_timing", "CAN / CAN FD bit timing candidates (BRP, TSEG1, TSEG2, SJW, sample point) for a clock and bitrate.", S(clock=STR("e.g. 80MHz"), bitrate=STR("e.g. 500k / 2M"), sample_point={"type": "number"}), [], True),
    ("get_workspace_info", "Current ChipBench workspace: name, home folder, notes / inbox / journal folders, roots, data directory.", S(), [], True),
    ("list_dir", "List a folder inside the workspace (all file types, with sizes). depth 1–4.", S(path=STR("folder; empty = all roots"), depth=INT("default 1")), [], True),
    ("find_files", "Find files by name pattern across the workspace (manuals, code, .map, .pcap …). Wildcards * ? allowed.", S(pattern=STR("e.g. *U2B*.pdf or rscan"), ext=STR("comma list, e.g. pdf,h,c"), limit=INT("default 200")), [], True),
    ("grep_files", "Search text in code / text files (C, headers, linker scripts, .map, logs, ARXML, DBC, SVD, notes …).", S(query=STR("text or regex"), glob=STR("e.g. *.c *.h"), regex=BOOL(""), case_sensitive=BOOL(""), max_results=INT("default 200"), path=STR("limit to sub-folder")), ["query"], True),
    ("search_pdf", "Full-text search in PDF manuals (uses ChipBench's text cache). Returns [[file.pdf#p=N]] hits with context.", S(query=STR("words, e.g. RSCFD bit timing"), path=STR("one PDF; empty = all"), max_results=INT("default 60")), ["query"], True),
    ("add_task", "Add a task '- [ ] … ⏳ plan 📅 due ~est' to today's journal (or to the given note).", S(text=STR("task"), plan=STR("YYYY-MM-DD"), due=STR("YYYY-MM-DD"), estimate=STR("e.g. 30m / 2h"), path=STR("note; default today's journal")), ["text"], False),
    ("set_task_done", "Mark a task line done / not done (adds or removes ✅ date).", S(path=STR("note"), line=INT("1-based line of the task"), done=BOOL("default true")), ["path", "line"], False),
    ("append_journal", "Append Markdown to today's (or a given date's) journal note in the workspace journal folder.", S(content=STR("Markdown"), date=STR("YYYY-MM-DD, default today")), ["content"], False),
    ("evaluate_clocktree", "Compute every node frequency of a clocktree block and flag nodes above their max.", S(path=STR("note"), line=INT("any line inside the block")), ["path", "line"], True),
    ("decode_register", "Decode a register value into its fields using a register block (bits, enumerated meanings).", S(path=STR("note"), line=INT("any line inside the block"), value=STR("e.g. 0x3F00")), ["path", "line", "value"], True),
    ("describe_ipblock", "Summarise an ipblock (IP structure diagram) block as tables: modules, groups, pages, registers, links; flags broken links and missing pages.", S(path=STR("note"), line=INT("any line inside the block")), ["path", "line"], True),
    ("create_folder", "Create a sub-folder (and any missing parents) inside the workspace. Relative paths start at the first workspace root; with several roots start with the root folder name as shown by list_dir. Returns 'already exists' if it is there.", S(path=STR("folder path, e.g. U2BX/CAN-IP/figures")), ["path"], False),
    ("create_file", "Create a text file of any type (md, c, h, csv, json, yaml, txt …) in the workspace; missing parent folders are created. Fails if it exists unless overwrite=true (backup kept). Executables / scripts (.exe .bat .ps1 …) are refused.", S(path=STR("file path incl. extension, e.g. U2BX/CAN-IP/overview.md"), content=STR("file content; empty = empty file"), overwrite=BOOL("replace an existing file (backup kept)")), ["path"], False),
    ("write_file", "Create or fully replace a text file of any type (backup of the old version kept, original encoding preserved). For Markdown notes write_note works the same; use this for code / data files.", S(path=STR("file path incl. extension"), content=STR("complete new content")), ["path", "content"], False),
    ("append_file", "Append text to the end of any text file (created if missing; adds a line break when needed).", S(path=STR("file path"), content=STR("text to append"), newline=BOOL("insert a line break first if the file does not end with one; default true")), ["path", "content"], False),
    ("create_tree", "Create several folders and files in one call, e.g. a project skeleton: entries [{path: 'U2BX/CAN-IP/'}, {path: 'U2BX/CAN-IP/README.md', content: '# CAN IP'}]. A path ending with '/' is a folder. Existing files are skipped unless overwrite=true. All entries are validated before anything is written; max 200 entries.", S(entries={"type": "array", "description": "list of {path, content?}", "items": {"type": "object", "properties": {"path": STR("path; end with / for a folder"), "content": STR("file content")}, "required": ["path"]}}, overwrite=BOOL("replace existing files (backup kept)")), ["entries"], False),
    ("atlas_list", "List IP atlas pages (IP 图谱: one page per IP × chip with structure diagram, scene walkthroughs, registers, timing, code). Bundled examples are read-only.", S(ip=STR("filter, e.g. CAN-FD")), [], True),
    ("atlas_read", "Read an IP atlas page or one of its sections (概览 / 结构 / 场景 / 寄存器 / 时序 / 代码 / 要点与坑).", S(page=STR("path or 'IP/chip', e.g. CAN-FD/RH850/U2B"), section=STR("section title; empty = whole page")), ["page"], True),
    ("atlas_create_page", "Create a new IP atlas page in the workspace (IP图谱/<IP>/<chip>.md) with all standard sections.", S(ip=STR("e.g. CAN-FD, Ethernet, DMA"), chip=STR("e.g. RH850/U2A"), source=STR("manual PDF file name"), chapter=STR("e.g. Section 24 RS-CANFD"), facts={"type": "object", "description": "key parameters, e.g. {\"通道数\": \"8\"}; use the same keys across chips for comparison"}), ["ip", "chip"], False),
    ("atlas_write_section", "Replace one section of an atlas page (Markdown incl. ```ipblock / ```register / ```wavedrom / ```c blocks). Page status becomes 待核对.", S(page=STR("path or IP/chip"), section=STR("section title"), content=STR("Markdown body of the section, without the ## heading")), ["page", "section", "content"], False),
    ("atlas_add_scene", "Append a ```scene walkthrough to the 场景 section and validate it. YAML: title, diagram (ipblock title), code (index of ```c block), steps: - {t, x, hl: [block ids], links: [a>b], regs: [{r, v, n}], line, page}.", S(page=STR("path or IP/chip"), scene_yaml=STR("scene YAML (without fences)")), ["page", "scene_yaml"], False),
    ("atlas_validate", "Check an atlas page: diagram links, scene block / link / register / code-line references, missing pages and sources.", S(page=STR("path or IP/chip")), ["page"], True),
    ("atlas_evidence", "How well an IP atlas page is backed by the manual: pages / evidence level (手册确认 实测 推导 示意 待核对) per block, register, field and scene step; lists what has no page yet. Use it before trusting or extending a page.", S(page=STR("path or 'IP/chip'")), ["page"], True),
    ("atlas_impact", "What does a register touch on an atlas page: the blocks that list it, the scene steps that set it (with the bit-fields that change), and the code lines that mention it. Only reports what the page itself says.", S(page=STR("path or 'IP/chip'"), register=STR("register name, e.g. RFSTS0")), ["page", "register"], True),
    ("atlas_compare", "Compare all chips of one IP side by side using their facts, scene and register counts.", S(ip=STR("IP name, e.g. CAN-FD")), ["ip"], True),
]

PROMPTS = {
    "build-ip-atlas": ("从手册建立 IP 图谱页面", [("ip", "IP，如 CAN-FD / Ethernet / DMA", True), ("chip", "芯片，如 RH850/U2A", True), ("manual", "手册 PDF 文件名", False)],
        "Use the skill 'ip-atlas-author' (read_skill). Build the IP atlas page for {ip} on {chip} from the manual {manual}: atlas_create_page, then search_pdf / read_pdf_pages for the chapter, write 概览 / 结构 (```ipblock) / 寄存器 (```register) / 时序 / 代码 with atlas_write_section, add 2-3 walkthroughs with atlas_add_scene, run atlas_validate until clean. Cite manual pages (page: N) everywhere; never invent register values — mark unknowns as 待确认."),
    "read-manual-section": ("从手册章节整理有出处的笔记", [("section", "章节名或页码范围，如 Section 28 ETN / p.3290-3320", True)],
        "请阅读手册 {section}。先用 search_notes / read_file 找到相关资料，再整理成笔记：每条结论后面写出处（文件名 + 页码），不确定的写“待确认”。如果涉及时钟、寄存器、引脚或结构，请生成对应的 ChipBench 组件块（clocktree / register / pinout / structure），并用 list_skills 查找合适的技能。"),
    "weekly-report": ("生成英文周报草稿", [("week", "例如 2026-W44，默认本周", False)],
        "Use the skill 'weekly-report' (read_skill). Collect tasks with list_tasks and recent notes for week {week}, then draft a concise English weekly report: Done / In progress / Blocked / Next week. Keep facts traceable to notes."),
    "triage-capture": ("分析以太网抓包并写结论", [("path", "抓包文件路径", True), ("focus", "gptp / doip / someip，可留空", False)],
        "Call analyze_capture(path='{path}', focus='{focus}'). Explain the root-cause candidates in Chinese, ordered by likelihood, with the packet numbers as evidence, and propose the next measurement. Then append the report to a note named '抓包分析' with append_to_note."),
    "design-tas": ("设计并检查 TAS 门控列表", [("requirement", "周期、各流量类、带宽与时延要求", True)],
        "Use the skill 'tas-gcl-designer'. Requirement: {requirement}. Propose a gate control list, run check_gcl until it passes, then write it as a ```gcl block into the active note (get_active_document → append_to_note)."),
    "review-component": ("复核组件块与手册是否一致", [("path", "笔记路径", True)],
        "List the component blocks in {path} (list_components). For each block, verify values against the referenced manual pages, list mismatches as a table (block, field, note value, manual value, page). Do not modify anything unless asked."),
}


def prompt_list():
    return [{"name": k, "description": v[0], "arguments": [{"name": a, "description": d, "required": r} for a, d, r in v[1]]} for k, v in PROMPTS.items()]


def prompt_get(name, args):
    if name not in PROMPTS:
        raise ToolError("unknown prompt: " + name)
    d, params, tpl = PROMPTS[name]
    vals = {a: (args or {}).get(a, "") for a, _, _ in params}
    for a, _, req in params:
        if req and not vals[a]:
            raise ToolError("missing argument: " + a)
    return {"description": d, "messages": [{"role": "user", "content": {"type": "text", "text": tpl.format(**vals)}}]}


def tool_list():
    out = []
    for name, desc, schema, req, ro in TOOLS:
        sc = dict(schema)
        if not ro:
            sc["properties"] = dict(sc.get("properties", {}), dry_run={"type": "boolean", "description": "true = do not write; return the planned change and diff"})
        if req:
            sc["required"] = req
        out.append({"name": name, "description": desc, "inputSchema": sc, "annotations": {"readOnlyHint": ro, "destructiveHint": False}})
    return out


class Server:
    def __init__(self, notes):
        self.notes = notes

    def handle(self, msg):
        mid, method, params = msg.get("id"), msg.get("method"), msg.get("params") or {}
        if method is None or mid is None:
            return None
        try:
            if method == "initialize":
                ci = params.get("clientInfo") or {}
                self.notes.client = str(ci.get("title") or ci.get("name") or "")
                self.notes.touch_session(force=True)
                res = {"protocolVersion": params.get("protocolVersion") or PROTOCOL, "capabilities": {"tools": {"listChanged": False}, "resources": {"listChanged": False}, "prompts": {"listChanged": False}},
                       "serverInfo": {"name": "chipbench", "title": "ChipBench workspace", "version": VERSION},
                       "instructions": "Markdown notes in: " + ", ".join(str(r) for r in self.notes.roots) + ". To organise files use create_folder / create_file / create_tree (sub-folders and any text file type; paths are relative to the workspace root, backups are kept). Use [[note name]] for links and '- [ ] task ⏳ plan 📅 due' for tasks. Prefer append_to_note / replace_in_note over write_note for small edits. Every write tool accepts dry_run=true to preview the diff first; every change is shown to the user in ChipBench and can be undone there. Engineering blocks (clocktree, register, pinout, gcl …) are edited with get_component / update_component; AI edits are marked 待确认. Check list_skills before a multi-step AE task (manual extraction, Ethernet / TSN, CAN timing, reports)."}
            elif method == "ping":
                res = {}
            elif method == "tools/list":
                res = {"tools": tool_list()}
            elif method == "tools/call":
                name, args = params.get("name"), params.get("arguments") or {}
                if name not in {t[0] for t in TOOLS}:
                    return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32602, "message": f"unknown tool: {name}"}}
                spec = next(t for t in TOOLS if t[0] == name)
                args = dict(args)
                dry = bool(args.pop("dry_run", False)) if not spec[4] else False
                miss = [k for k in spec[3] if args.get(k) in (None, "")]
                extra = [k for k in args if k not in spec[2].get("properties", {})]
                if miss or extra:
                    msg = ("missing required argument(s): " + ", ".join(miss) if miss else "") + ("; " if miss and extra else "") + ("unknown argument(s): " + ", ".join(extra) if extra else "")
                    return {"jsonrpc": "2.0", "id": mid, "result": {"content": [{"type": "text", "text": "Invalid arguments — " + msg + ". Expected: " + ", ".join(spec[2].get("properties", {}))}], "isError": True}}
                if not spec[4] and self.notes.level() == "read":
                    return {"jsonrpc": "2.0", "id": mid, "result": {"content": [{"type": "text", "text": "Error: ChipBench MCP is in read-only mode, so %s was not run. Ask the user to switch to read & write in ChipBench > MCP 连接中心 > 权限. (dry_run is also blocked in read-only mode.)" % name}], "isError": True}}
                self.notes.begin(name, self.notes.client, dry)
                try:
                    out = getattr(self.notes, name)(**args)
                    if dry:
                        plan = self.notes.plan
                        lines = ["DRY RUN — nothing was written. %d planned change(s):" % len(plan)]
                        for c in plan:
                            lines.append("%s %s" % ({"create": "+ create", "modify": "~ modify", "mkdir": "+ folder"}.get(c["op"], c["op"]), c.get("rel") or c["path"]) + ("  (+%d -%d lines)" % (c["added"], c["removed"]) if c["op"] != "mkdir" else ""))
                            if c.get("diff"):
                                lines.append(c["diff"])
                        if not plan:
                            lines.append("(this call would not change anything)")
                        out = "\n".join(lines)
                    res = {"content": [{"type": "text", "text": out}], "isError": False}
                except ToolError as e:
                    res = {"content": [{"type": "text", "text": "Error: " + str(e)}], "isError": True}
                except (TypeError, ValueError, re.error) as e:
                    res = {"content": [{"type": "text", "text": "Invalid argument value: " + str(e)}], "isError": True}
                except OSError as e:
                    res = {"content": [{"type": "text", "text": "File error: " + (e.strerror or str(e)) + (" — " + str(e.filename) if getattr(e, "filename", None) else "")}], "isError": True}
                finally:
                    self.notes.end()
                    self.notes.touch_session()
            elif method == "resources/list":
                sk = [{"uri": "chipbench://skills/" + k, "name": "skill: " + k, "description": v["description"], "mimeType": "text/markdown"} for k, v in sorted(self.notes._skills().items())]
                res = {"resources": sk + [{"uri": "chipbench:///" + self.notes.rel(f), "name": self.notes.rel(f), "mimeType": "text/markdown"} for f in list(self.notes.files())[:500]]}
            elif method == "resources/read":
                if params.get("uri", "").startswith("chipbench://skills/"):
                    nm = params["uri"].split("chipbench://skills/", 1)[1]
                    return {"jsonrpc": "2.0", "id": mid, "result": {"contents": [{"uri": params["uri"], "mimeType": "text/markdown", "text": self.notes.read_skill(nm)}]}}
                rel = params.get("uri", "").split("chipbench:///", 1)[-1]
                text, _ = read_text(self.notes.path(rel))
                res = {"contents": [{"uri": params.get("uri", ""), "mimeType": "text/markdown", "text": text}]}
            elif method == "prompts/list":
                res = {"prompts": prompt_list()}
            elif method == "prompts/get":
                try:
                    res = prompt_get(params.get("name"), params.get("arguments"))
                except ToolError as e:
                    return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32602, "message": str(e)}}
            else:
                return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"method not found: {method}"}}
            return {"jsonrpc": "2.0", "id": mid, "result": res}
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32603, "message": str(e)}}

    def serve(self, inp=sys.stdin, out=sys.stdout):
        for line in inp:
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                out.write(json.dumps({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "parse error"}}) + "\n"); out.flush()
                continue
            batch = msg if isinstance(msg, list) else [msg]
            resps = [r for r in (self.handle(m) for m in batch) if r is not None]
            if resps:
                out.write(json.dumps(resps if isinstance(msg, list) else resps[0], ensure_ascii=False) + "\n"); out.flush()


def default_roots():
    if os.environ.get("CHIPBENCH_ROOT"):
        return [Path(x) for x in os.environ["CHIPBENCH_ROOT"].split(os.pathsep) if x]
    try:
        st = json.loads(STATE.read_text("utf-8"))
        rs = [Path(r) for r in ((st.get("workspace") or {}).get("roots") or []) if Path(r).is_dir()]
        if rs:
            return rs
    except Exception:
        pass
    return [Path.cwd()]


def selftest(roots, dynamic, explicit):
    """Connection report for ChipBench > MCP 连接中心 (no stdin needed)."""
    notes = Notes(roots, dynamic)
    srv = Server(notes)
    init = srv.handle({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": PROTOCOL, "clientInfo": {"name": "selftest"}}})
    tools = (srv.handle({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}) or {}).get("result", {}).get("tools", [])
    age = _state_age()
    try:
        import aenet  # noqa: F401  (the Ethernet tools need it; the 1.6.1 installer forgot to ship it)
        eth = True
    except Exception as e:  # pragma: no cover
        eth = str(e)
    rep = {"ok": bool(init and "result" in init and tools), "version": VERSION, "python": sys.version.split()[0], "executable": sys.executable, "script": str(Path(__file__).resolve()),
           "data_dir": str(data_root()), "state_file": str(STATE), "state_exists": STATE.exists(), "state_age_seconds": None if age is None else round(age), "app_running": age is not None and age < 60,
           "roots": [str(r) for r in notes.roots], "roots_source": "command line / CHIPBENCH_ROOT" if explicit else ("workspace open in ChipBench" if STATE.exists() else "current folder (ChipBench has not published its state)"),
           "tools": len(tools), "write_tools": sum(1 for t in tools if not t["annotations"]["readOnlyHint"]), "level": notes.level(), "ethernet_tools": eth, "activity_log": str(data_root() / "mcp-activity.jsonl")}
    problems = []
    if not STATE.exists():
        problems.append("state.json not found — start ChipBench once (or the data folder differs: %s)" % data_root())
    elif not rep["app_running"]:
        problems.append("ChipBench does not seem to be running (state.json is %s s old); AI can still read / write files in the roots" % rep["state_age_seconds"])
    if eth is not True:
        problems.append("aenet.py missing (%s) — Ethernet tools will fail" % eth)
    if not rep["roots"] or not all(Path(r).is_dir() for r in rep["roots"]):
        problems.append("workspace roots are missing")
    rep["problems"] = problems
    return rep


def main():
    ap = argparse.ArgumentParser(description="ChipBench MCP server (stdio)")
    ap.add_argument("--root", action="append", help="notes folder (repeatable). Default: roots of the workspace open in ChipBench (followed live)")
    ap.add_argument("--selftest", action="store_true", help="print a JSON connection report and exit")
    ap.add_argument("--version", action="version", version=VERSION)
    a = ap.parse_args()
    explicit = bool(a.root) or bool(os.environ.get("CHIPBENCH_ROOT"))
    roots = [Path(r) for r in a.root] if a.root else default_roots()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8"); sys.stdout.reconfigure(encoding="utf-8")
    if a.selftest:
        print(json.dumps(selftest(roots, not explicit, explicit), ensure_ascii=False))
        return
    bad = [r for r in roots if not r.is_dir()]
    if bad:
        sys.stderr.write(f"notes root not found: {bad[0]}\n"); sys.exit(2)
    sys.stderr.write(f"ChipBench MCP server {VERSION} — roots: {', '.join(str(r.resolve()) for r in roots)}{'' if explicit else ' (follows the workspace open in ChipBench)'}; data: {data_root()}\n")
    Server(Notes(roots, dynamic=not explicit)).serve()


if __name__ == "__main__":
    main()
