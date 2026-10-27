#!/usr/bin/env python3
"""ChipBench MCP server — lets AI tools (GitHub Copilot in VS Code, Claude Desktop, Cursor …) read and write your
workspace notes through the Model Context Protocol (stdio, JSON-RPC 2.0). Python 3.8+ standard library only.

    python chipbench_mcp.py                  # roots = folders of the workspace currently open in ChipBench
    python chipbench_mcp.py --root D:\\Notes  # one or more explicit roots (repeatable)

File access is confined to the roots. Every write keeps a backup in <root>/.chipbench/backup/.
The ChipBench desktop app publishes the active document / selection to ~/.chipbench/state.json (get_active_document)
and reloads files changed by this server automatically (file watcher).
"""
import argparse, datetime, json, os, re, shutil, sys, traceback
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # aenet.py lives next to this file
from pathlib import Path

VERSION = "1.2.0"
PROTOCOL = "2025-06-18"
MD_EXT = {".md", ".markdown", ".mdown", ".mkd", ".txt"}
SKIP_DIRS = {".git", ".chipbench", "node_modules", "__pycache__", "target", ".obsidian"}
STATE = Path(os.environ.get("CHIPBENCH_STATE") or (Path.home() / ".chipbench" / "state.json"))
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
    def __init__(self, roots):
        self.roots = [Path(r).resolve() for r in roots]

    @property
    def root(self):
        return self.roots[0]

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
        enc = "UTF-8"
        if p.exists():
            _, enc = read_text(p)
        bk = self.backup(p)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_name(p.name + ".chipbench-tmp")
        tmp.write_bytes(text.encode("utf-8" if enc == "UTF-8" else enc, "replace"))
        os.replace(tmp, p)
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
        d = Path.home() / ".chipbench" / "workspaces"
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

    COMP_RE = re.compile(r"^```(clocktree|clock-tree|structure|register|memmap|pinout|gcl|wavedrom|flow|chart)\s*$")

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

    def read_pdf_pages(self, path, start=1, end=0):
        """Text of PDF pages from ChipBench's page cache (%USERPROFILE%/.chipbench/cache/pdf). The desktop app builds the
        cache the first time it opens / indexes a PDF; Python has no PDF parser in the standard library."""
        p = self.path(path)
        st = p.stat()
        key = "%s|%d|%d" % (str(p).lower() if os.name == "nt" else str(p).lower(), st.st_mtime_ns // 1000000, st.st_size)
        h = 1469598103934665603
        for b in key.encode("utf-8"):
            h = ((h ^ b) * 1099511628211) & 0xFFFFFFFFFFFFFFFF
        cache = Path(os.environ.get("CHIPBENCH_HOME") or (Path.home() / ".chipbench")) / "cache" / "pdf" / ("%016x.json" % h)
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
]

PROMPTS = {
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
                res = {"protocolVersion": params.get("protocolVersion") or PROTOCOL, "capabilities": {"tools": {"listChanged": False}, "resources": {"listChanged": False}, "prompts": {"listChanged": False}},
                       "serverInfo": {"name": "chipbench", "title": "ChipBench workspace", "version": VERSION},
                       "instructions": "Markdown notes in: " + ", ".join(str(r) for r in self.notes.roots) + ". Use [[note name]] for links and '- [ ] task ⏳ plan 📅 due' for tasks. Prefer append_to_note / replace_in_note over write_note for small edits. Engineering blocks (clocktree, register, pinout, gcl …) are edited with get_component / update_component; AI edits are marked 待确认. Check list_skills before a multi-step AE task (manual extraction, Ethernet / TSN, CAN timing, reports)."}
            elif method == "ping":
                res = {}
            elif method == "tools/list":
                res = {"tools": tool_list()}
            elif method == "tools/call":
                name, args = params.get("name"), params.get("arguments") or {}
                if name not in {t[0] for t in TOOLS}:
                    return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32602, "message": f"unknown tool: {name}"}}
                try:
                    res = {"content": [{"type": "text", "text": getattr(self.notes, name)(**args)}], "isError": False}
                except ToolError as e:
                    res = {"content": [{"type": "text", "text": "Error: " + str(e)}], "isError": True}
                except TypeError as e:
                    res = {"content": [{"type": "text", "text": "Invalid arguments: " + str(e)}], "isError": True}
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


def main():
    ap = argparse.ArgumentParser(description="ChipBench MCP server (stdio)")
    ap.add_argument("--root", action="append", help="notes folder (repeatable). Default: roots of the workspace open in ChipBench")
    ap.add_argument("--version", action="version", version=VERSION)
    a = ap.parse_args()
    roots = [Path(r) for r in a.root] if a.root else default_roots()
    bad = [r for r in roots if not r.is_dir()]
    if bad:
        sys.stderr.write(f"notes root not found: {bad[0]}\n"); sys.exit(2)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8"); sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.write(f"ChipBench MCP server {VERSION} — roots: {', '.join(str(r.resolve()) for r in roots)}\n")
    Server(Notes(roots)).serve()


if __name__ == "__main__":
    main()
