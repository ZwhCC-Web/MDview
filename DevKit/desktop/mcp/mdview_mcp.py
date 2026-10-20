#!/usr/bin/env python3
"""MDView MCP server — lets AI tools (GitHub Copilot in VS Code, Claude Desktop, Cursor, …) work with a
folder of Markdown notes through the Model Context Protocol (stdio transport, JSON-RPC 2.0).

Only the Python 3.8+ standard library is required.

    python mdview_mcp.py --root D:\\Notes            # serve that folder
    python mdview_mcp.py                              # root = MDVIEW_ROOT, or the folder open in MDView, or cwd

All file access is confined to --root. Every write keeps a backup in <root>/.mdview/backup/.
The MDView desktop app publishes the active document to ~/.mdview/state.json (get_active_document)
and reloads files automatically when they are changed by this server.
"""
import argparse, datetime, json, os, re, shutil, sys, traceback
from pathlib import Path

VERSION = "1.0.0"
PROTOCOL = "2025-06-18"
MD_EXT = {".md", ".markdown", ".mdown", ".mkd", ".txt"}
SKIP_DIRS = {".git", ".mdview", "node_modules", "__pycache__", "target", ".obsidian"}
STATE = Path(os.environ.get("MDVIEW_STATE") or (Path.home() / ".mdview" / "state.json"))
TASK_RE = re.compile(r"^(\s*)(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s+(.*)$")
DUE_RE = re.compile(r"(?:📅\s?|@|due:)(\d{4}-\d{2}-\d{2})")
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
    def __init__(self, root: Path):
        self.root = root.resolve()

    # ---------- paths ----------
    def path(self, rel: str, must_exist=True) -> Path:
        if not rel or not str(rel).strip():
            raise ToolError("path is required")
        rel = str(rel).replace("\\", "/").lstrip("/")
        p = (self.root / rel).resolve()
        if p != self.root and self.root not in p.parents:
            raise ToolError(f"path is outside the notes root: {rel}")
        if must_exist and not p.exists():
            # allow omitting the .md extension
            if not p.suffix and p.with_suffix(".md").exists():
                return p.with_suffix(".md")
            raise ToolError(f"not found: {rel}")
        return p

    def rel(self, p: Path) -> str:
        return p.relative_to(self.root).as_posix()

    def files(self, sub: str = ""):
        base = self.path(sub) if sub else self.root
        for dp, dns, fns in os.walk(base):
            dns[:] = sorted(d for d in dns if d not in SKIP_DIRS and not d.startswith("."))
            for fn in sorted(fns):
                if Path(fn).suffix.lower() in MD_EXT:
                    yield Path(dp) / fn

    def find_note(self, name: str):
        """resolve a note by relative path or by bare name (like [[wiki]] links)"""
        try:
            return self.path(name)
        except ToolError:
            pass
        key = Path(name.replace("\\", "/")).name.lower()
        key = re.sub(r"\.(md|markdown)$", "", key)
        for f in self.files():
            if f.stem.lower() == key:
                return f
        raise ToolError(f"note not found: {name}")

    def backup(self, p: Path):
        if not p.exists():
            return None
        ts = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        dst = self.root / ".mdview" / "backup" / (self.rel(p) + "." + ts + ".bak")
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(p, dst)
        return self.rel(dst)

    def write(self, p: Path, text: str):
        enc = "UTF-8"
        if p.exists():
            _, enc = read_text(p)
        bk = self.backup(p)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_name(p.name + ".mdview-tmp")
        tmp.write_bytes(text.encode("utf-8" if enc == "UTF-8" else enc, "replace"))
        os.replace(tmp, p)
        return bk

    # ---------- tools ----------
    def list_notes(self, folder: str = "", pattern: str = "", limit: int = 300):
        rx = re.compile(pattern, re.I) if pattern else None
        out = []
        for f in self.files(folder):
            r = self.rel(f)
            if rx and not rx.search(r):
                continue
            title = ""
            try:
                with open(f, "rb") as fh:
                    head = fh.read(4096).decode("utf-8", "ignore")
                m = re.search(r"^#\s+(.+)$", head, re.M)
                title = m.group(1).strip() if m else ""
            except OSError:
                pass
            st = f.stat()
            out.append(f"{r}\t{st.st_size} B\t{datetime.datetime.fromtimestamp(st.st_mtime):%Y-%m-%d %H:%M}\t{title}")
            if len(out) >= limit:
                out.append(f"… (limited to {limit})")
                break
        return f"root: {self.root}\n{len(out)} notes (path, size, modified, title):\n" + "\n".join(out)

    def read_note(self, path: str, start_line: int = 0, end_line: int = 0, line_numbers: bool = False):
        p = self.find_note(path)
        text, enc = read_text(p)
        lines = text.split("\n")
        a = max(1, int(start_line or 1)); b = min(len(lines), int(end_line or len(lines)))
        sel = lines[a - 1:b]
        body = "\n".join(f"{a + i:>5}| {l}" for i, l in enumerate(sel)) if line_numbers else "\n".join(sel)
        return f"# file: {self.rel(p)} (lines {a}-{b} of {len(lines)}, {enc})\n{body}"

    def search_notes(self, query: str, regex: bool = False, case_sensitive: bool = False, max_results: int = 100):
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

    def get_outline(self, path: str):
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

    def get_backlinks(self, note: str):
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

    def list_tasks(self, status: str = "open", due_before: str = "", path: str = ""):
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
                if status == "open" and done or status == "done" and not done:
                    continue
                d = DUE_RE.search(m.group(3)); due = d.group(1) if d else ""
                if due_before and (not due or due > due_before):
                    continue
                flag = " [OVERDUE]" if due and due < today and not done else ""
                rows.append((due or "9999", f"[{'x' if done else ' '}] {m.group(3).strip()}  — {self.rel(f)}:{i}{flag}"))
        rows.sort()
        return f"{len(rows)} tasks (status={status}, today={today})\n" + "\n".join(r for _, r in rows)

    def create_note(self, path: str, content: str, overwrite: bool = False):
        p = self.path(path if re.search(r"\.\w+$", path) else path + ".md", must_exist=False)
        if p.exists() and not overwrite:
            raise ToolError(f"already exists: {self.rel(p)} (set overwrite=true to replace)")
        bk = self.write(p, content)
        return f"created {self.rel(p)} ({len(content)} chars)" + (f", backup: {bk}" if bk else "")

    def write_note(self, path: str, content: str):
        p = self.path(path if re.search(r"\.\w+$", path) else path + ".md", must_exist=False)
        bk = self.write(p, content)
        return f"wrote {self.rel(p)} ({len(content)} chars)" + (f", backup: {bk}" if bk else "")

    def append_to_note(self, path: str, content: str, heading: str = ""):
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
            lines[end:end] = ["", *content.rstrip("\n").split("\n")] if lines[end - 1].strip() else content.rstrip("\n").split("\n")
            new = "\n".join(lines)
        else:
            new = text.rstrip("\n") + "\n\n" + content.rstrip("\n") + "\n"
        bk = self.write(p, new)
        return f"appended {len(content)} chars to {self.rel(p)}" + (f" under '{heading}'" if heading else "") + f", backup: {bk}"

    def replace_in_note(self, path: str, find: str, replace: str, all: bool = False, regex: bool = False):
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

    def get_active_document(self, include_content: bool = True):
        if not STATE.exists():
            return "MDView desktop is not running (or has not published its state yet)."
        st = json.loads(STATE.read_text("utf-8"))
        out = {k: st.get(k) for k in ("name", "file", "folder", "dirty", "time", "open_tabs")}
        if st.get("selection"):
            out["selection"] = st["selection"]
        if include_content and st.get("file") and Path(st["file"]).exists():
            text, enc = read_text(Path(st["file"]))
            out["content"] = text if len(text) < 200000 else text[:200000] + "\n…(truncated)"
            out["encoding"] = enc
        if st.get("dirty"):
            out["note"] = "The document has unsaved changes in MDView; content shown is the last saved version."
        return json.dumps(out, ensure_ascii=False, indent=1)


S = lambda **p: {"type": "object", "properties": p, "additionalProperties": False}
STR = lambda d: {"type": "string", "description": d}
INT = lambda d: {"type": "integer", "description": d}
BOOL = lambda d: {"type": "boolean", "description": d}
TOOLS = [
    ("list_notes", "List Markdown notes under the notes root (optionally a sub-folder / regex filter on the path).", S(folder=STR("sub-folder, relative to root"), pattern=STR("regex filter on the relative path"), limit=INT("max entries, default 300")), [], True),
    ("read_note", "Read a note by relative path or by note name (like a [[wiki link]]). Optional line range.", S(path=STR("relative path or note name"), start_line=INT("1-based"), end_line=INT("inclusive"), line_numbers=BOOL("prefix lines with numbers")), ["path"], True),
    ("search_notes", "Full-text search across all notes; returns path:line: text.", S(query=STR("text or regex"), regex=BOOL("treat query as a regular expression"), case_sensitive=BOOL(""), max_results=INT("default 100")), ["query"], True),
    ("get_outline", "Heading outline of a note with line numbers.", S(path=STR("relative path or note name")), ["path"], True),
    ("get_backlinks", "Notes that link to the given note via [[wiki]] or relative .md links.", S(note=STR("relative path or note name")), ["note"], True),
    ("list_tasks", "Collect '- [ ]' tasks (with 📅 YYYY-MM-DD due dates) across notes.", S(status={"type": "string", "enum": ["open", "done", "all"]}, due_before=STR("YYYY-MM-DD"), path=STR("limit to one note")), [], True),
    ("create_note", "Create a new note (fails if it exists unless overwrite=true).", S(path=STR("relative path, .md added if missing"), content=STR("Markdown"), overwrite=BOOL("")), ["path", "content"], False),
    ("write_note", "Replace the whole content of a note (a backup is kept).", S(path=STR("relative path"), content=STR("full Markdown content")), ["path", "content"], False),
    ("append_to_note", "Append Markdown to the end of a note, or to the end of the section under a heading.", S(path=STR("relative path or note name"), content=STR("Markdown to append"), heading=STR("optional heading text")), ["path", "content"], False),
    ("replace_in_note", "Replace text in a note (first occurrence, or all). A backup is kept.", S(path=STR("relative path or note name"), find=STR("text (or regex)"), replace=STR("replacement"), all=BOOL("replace all occurrences"), regex=BOOL("")), ["path", "find", "replace"], False),
    ("get_active_document", "The document currently open in the MDView desktop app: path, selected text and content.", S(include_content=BOOL("default true")), [], True),
]


def tool_list():
    out = []
    for name, desc, schema, req, ro in TOOLS:
        sc = dict(schema)
        if req:
            sc["required"] = req
        out.append({"name": name, "description": desc, "inputSchema": sc, "annotations": {"readOnlyHint": ro, "destructiveHint": False}})
    return out


class Server:
    def __init__(self, notes: Notes):
        self.notes = notes

    def handle(self, msg):
        mid, method, params = msg.get("id"), msg.get("method"), msg.get("params") or {}
        if method is None:
            return None  # a response from the client; ignore
        if mid is None:
            return None  # notification (e.g. notifications/initialized)
        try:
            if method == "initialize":
                res = {"protocolVersion": params.get("protocolVersion") or PROTOCOL,
                       "capabilities": {"tools": {"listChanged": False}, "resources": {"listChanged": False}},
                       "serverInfo": {"name": "mdview", "title": "MDView notes", "version": VERSION},
                       "instructions": f"Markdown notes in {self.notes.root}. Use [[note name]] for links and '- [ ] task 📅 YYYY-MM-DD' for tasks. Prefer append_to_note / replace_in_note over write_note for small edits."}
            elif method == "ping":
                res = {}
            elif method == "tools/list":
                res = {"tools": tool_list()}
            elif method == "tools/call":
                name, args = params.get("name"), params.get("arguments") or {}
                fn = getattr(self.notes, name, None)
                if name not in {t[0] for t in TOOLS} or not fn:
                    return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32602, "message": f"unknown tool: {name}"}}
                try:
                    text = fn(**args)
                    res = {"content": [{"type": "text", "text": text}], "isError": False}
                except ToolError as e:
                    res = {"content": [{"type": "text", "text": "Error: " + str(e)}], "isError": True}
                except TypeError as e:
                    res = {"content": [{"type": "text", "text": "Invalid arguments: " + str(e)}], "isError": True}
            elif method == "resources/list":
                res = {"resources": [{"uri": "mdview:///" + self.notes.rel(f), "name": self.notes.rel(f), "mimeType": "text/markdown"} for f in list(self.notes.files())[:500]]}
            elif method == "resources/read":
                uri = params.get("uri", "")
                rel = uri.split("mdview:///", 1)[-1]
                text, _ = read_text(self.notes.path(rel))
                res = {"contents": [{"uri": uri, "mimeType": "text/markdown", "text": text}]}
            elif method in ("prompts/list",):
                res = {"prompts": []}
            else:
                return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"method not found: {method}"}}
            return {"jsonrpc": "2.0", "id": mid, "result": res}
        except Exception as e:  # never crash the server
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


def default_root():
    if os.environ.get("MDVIEW_ROOT"):
        return Path(os.environ["MDVIEW_ROOT"])
    try:
        st = json.loads(STATE.read_text("utf-8"))
        if st.get("folder") and Path(st["folder"]).is_dir():
            return Path(st["folder"])
    except Exception:
        pass
    return Path.cwd()


def main():
    ap = argparse.ArgumentParser(description="MDView MCP server (stdio)")
    ap.add_argument("--root", help="notes folder (default: MDVIEW_ROOT, the folder open in MDView, or cwd)")
    ap.add_argument("--version", action="version", version=VERSION)
    a = ap.parse_args()
    root = Path(a.root) if a.root else default_root()
    if not root.is_dir():
        sys.stderr.write(f"notes root not found: {root}\n"); sys.exit(2)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8"); sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.write(f"MDView MCP server {VERSION} — root: {root.resolve()}\n")
    Server(Notes(root)).serve()


if __name__ == "__main__":
    main()
