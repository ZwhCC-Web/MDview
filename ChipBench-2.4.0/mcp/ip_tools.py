"""ChipBench 1.8 — MCP tools for IP models (.cbip).  Mixed into chipbench_mcp.Notes.

Design rules (docs/IP-STUDIO.md):
  · A model changes ONLY through ops (ip_model.apply) — atomic, validated, the same code path as the app's editor.
  · AI edits are PROPOSALS by default: ip_edit stores them next to the model (<name>.cbip.proposal.json); the user accepts them in the
    app (or you pass mode="write" after the user explicitly asked for a direct change).  The layout sidecar (<name>.cbip.layout.json) is user-owned and never touched.
  · Templates describe structure only; hardware facts (parameters, addresses, reset values) must come from the manual, with a page.
"""
import datetime
import json
import os
import re
from pathlib import Path

import ip_model as IP
import ip_sim as SIM
import xml.etree.ElementTree as ET

EXT = ".cbip"
PROP = ".proposal.json"
LAYOUT = ".layout.json"


class IpTools:
    # ------------------------------------------------------------ helpers
    def _ip_files(self, folder=""):
        for f in self.files_ext(folder, (EXT,)):
            yield f

    def files_ext(self, sub, exts):
        for base in self.roots:
            b = base / sub if sub else base
            if not b.exists():
                continue
            for dp, dns, fns in os.walk(b):
                dns[:] = sorted(d for d in dns if d not in {".git", ".chipbench", "node_modules", "__pycache__", "target", ".obsidian"} and not d.startswith("."))
                for fn in sorted(fns):
                    if fn.lower().endswith(exts):
                        yield Path(dp) / fn

    def _ip_path(self, path, must_exist=True):
        s = str(path or "").strip()
        if not s:
            raise self._te("path is required")
        if not s.lower().endswith(EXT):
            s += EXT
        if must_exist:
            return self.path(s)
        p, _ = self._new_path(s)
        return p

    _g = {}   # chipbench_mcp's globals, set by chipbench_mcp (works whether it runs as __main__ or is loaded by path)

    def _te(self, msg):
        return self._g["ToolError"](msg)

    def _ip_load(self, p):
        text, _ = self._g["read_text"](p)
        try:
            raw = json.loads(text)
        except ValueError as e:
            raise self._te("%s is not valid JSON: %s" % (self.rel(p), e))
        if not isinstance(raw, dict) or not str(raw.get("schema", "")).startswith("chipbench.ip/"):
            raise self._te("%s is not a ChipBench IP model (schema should be %s)" % (self.rel(p), IP.SCHEMA))
        return IP.normalize(raw)

    @staticmethod
    def _ip_dump(m):
        return json.dumps(m, ensure_ascii=False, indent=2, sort_keys=False) + "\n"

    def _prop_path(self, p):
        return p.with_name(p.name + PROP)

    def _prop_load(self, p):
        f = self._prop_path(p)
        if not f.exists():
            return None
        try:
            d = json.loads(f.read_text("utf-8-sig"))
            return d if isinstance(d, dict) and isinstance(d.get("ops"), list) else None
        except (OSError, ValueError):
            return None

    @staticmethod
    def _findings(m, limit=40):
        v = IP.validate(m)
        order = {"err": 0, "warn": 1, "info": 2}
        v.sort(key=lambda x: order[x["level"]])
        return [{"level": x["level"], "code": x["code"], "msg": x["msg"]} for x in v[:limit]], {k: sum(1 for x in v if x["level"] == k) for k in ("err", "warn", "info")}

    def _ip_text(self, m):
        """compact outline an AI can read at a glance"""
        L = ["%s  (id %s · %s · rev %d%s)" % (m["name"], m["id"], m["kind"], m["rev"], " · chip " + m["chip"] if m["chip"] else "")]
        if m["source"]:
            L.append("source: %s%s" % (m["source"], " rev " + m["docrev"] if m["docrev"] else ""))
        kids = {}
        for n in m["nodes"]:
            kids.setdefault(n.get("parent"), []).append(n)

        def walk(pid, d):
            for n in kids.get(pid, []):
                e = n.get("ev") or {}
                pg = (" p." + str(e["page"])) if e.get("page") not in (None, "") else ""
                L.append("%s- %s [%s] %s  {%s%s}%s" % ("  " * d, n["id"], n["kind"], n["name"], e.get("level", "待核对"), pg,
                                                       ("  ports: " + ", ".join("%s:%s/%s" % (p["id"], p["type"], p["dir"]) for p in n["ports"])) if n["ports"] else ""))
                if n.get("params"):
                    L.append("%s    params: %s" % ("  " * d, json.dumps(n["params"], ensure_ascii=False)))
                if n["registers"]:
                    L.append("%s    registers: %s" % ("  " * d, ", ".join(n["registers"])))
                walk(n["id"], d + 1)
        walk(None, 0)
        if m["edges"]:
            L.append("edges:")
            for e in m["edges"]:
                L.append("  %s: %s -> %s (%s)%s" % (e["id"], e["source"], e["target"], e["type"], " " + e["name"] if e.get("name") else ""))
        if m["registers"]:
            L.append("registers:")
            for r in m["registers"].values():
                L.append("  %s  %s  %d-bit%s%s  fields: %s" % (r["id"], r["name"], r["width"], "  @0x%X" % r["address"] if r.get("address") is not None else "", "  reset 0x%X" % r["reset"] if r.get("reset") is not None else "",
                                                           ", ".join("%s[%s]" % (f["name"], f["bits"]) for f in r["fields"]) or "-"))
        if m["scenes"]:
            L.append("scenes:")
            for sc in m["scenes"]:
                e = sc.get("ev") or {}
                L.append("  %s  %s  (%d steps) {%s%s}" % (sc["id"], sc["name"], len(sc["steps"]), e.get("level", "待核对"), " p." + str(e["page"]) if e.get("page") not in (None, "") else ""))
                for i, st in enumerate(sc["steps"], 1):
                    pg = (st.get("ev") or {}).get("page")
                    W = ", ".join("%s=0x%X%s" % (w["reg"], w["value"], " (%s)" % w["note"] if w.get("note") else "") for w in st["writes"])
                    L.append("    %d. %s — nodes: %s%s%s%s" % (i, st["title"], ", ".join(st["nodes"]) or "-", " | edges: " + ", ".join(st["edges"]) if st["edges"] else "", " | writes: " + W if W else "", " | p." + str(pg) if pg not in (None, "") else ""))
        if m["rules"]:
            L.append("rules (behaviour taken from the manual; the simulation is only as true as these):")
            for r in m["rules"]:
                e = r.get("ev") or {}
                L.append("  %s [%s] %s {%s%s}: when %s" % (r["id"], r["trigger"], r["name"], e.get("level", "待核对"), " p." + str(e["page"]) if e.get("page") not in (None, "") else "", r["when"]))
                if r["then"]:
                    L.append("      then: " + " | ".join(r["then"]))
                if r["else"]:
                    L.append("      else: " + " | ".join(r["else"]))
        if m["timings"]:
            L.append("timings (figures from the manual):")
            for x in m["timings"]:
                e = x.get("ev") or {}
                L.append("  %s \"%s\" hscale %d {%s%s}: %s" % (x["id"], x["name"], x["hscale"], e.get("level", "待核对"), " p." + str(e["page"]) if e.get("page") not in (None, "") else "",
                                                           "  ".join("%s[%s%s]" % (g["name"], g["wave"], " | " + ", ".join(g["data"]) if g["data"] else "") for g in x["signals"])))
        return "\n".join(L)


    # ------------------------------------------------------------ built-in templates (templates/*.cbip, exported from app/js/ip-templates.js)
    @staticmethod
    def _tpl_dir():
        return Path(__file__).resolve().parent.parent / "templates"

    def _tpl_keys(self):
        d = self._tpl_dir()
        return sorted(f.stem for f in d.glob("*.cbip")) if d.is_dir() else []

    def _tpl_load(self, key):
        key = re.sub(r"^builtin:", "", str(key or "").strip())
        f = self._tpl_dir() / (key + ".cbip")
        if not re.fullmatch(r"[A-Za-z0-9_\-]+", key) or not f.is_file():
            raise self._te("no built-in template %r (available: %s)" % (key, ", ".join(self._tpl_keys()) or "none installed"))
        return IP.normalize(json.loads(f.read_text("utf-8")))

    def ip_templates(self):
        rows = []
        for k in self._tpl_keys():
            t = self._tpl_load(k)
            top = next((n for n in t["nodes"] if not n.get("parent")), {"ports": []})
            rows.append({"key": k, "id": t["id"], "name": t["name"], "nodes": len(t["nodes"]), "edges": len(t["edges"]), "top_ports": [p["id"] + ":" + p["type"] + "/" + p["dir"] for p in top["ports"]], "note": t["description"]})
        if not rows:
            return "No built-in templates installed (templates/ folder missing)."
        return json.dumps({"count": len(rows), "templates": rows, "use": "ip_create(path, template=<key>) starts a model from one; ip_instantiate(path, template=\"builtin:<key>\", prefix=...) adds one into an existing model. Everything arrives as 待核对 — templates are sketches, not facts."}, ensure_ascii=False, indent=1)

    # ------------------------------------------------------------ read tools
    def ip_list(self, folder=""):
        rows = []
        for f in self._ip_files(folder):
            try:
                m = self._ip_load(f)
            except Exception as e:  # noqa: BLE001
                rows.append({"path": self.rel(f), "error": str(e)})
                continue
            s = IP.summary(m)
            rows.append({"path": self.rel(f), "name": s["name"], "id": s["id"], "kind": s["kind"], "chip": m["chip"], "rev": s["rev"], "nodes": s["nodes"], "edges": s["edges"], "registers": s["registers"], "scenes": s["scenes"], "rules": s["rules"], "timings": s["timings"],
                         "errors": s["errors"], "warnings": s["warnings"], "pending_proposal": self._prop_path(f).exists()})
        if not rows:
            return "No IP models (*.cbip). Create one with ip_create, or convert an atlas page with ip_import_atlas."
        return json.dumps({"count": len(rows), "models": rows}, ensure_ascii=False, indent=1)

    def ip_read(self, path, node="", depth=1, format="text"):
        p = self._ip_path(path)
        m = self._ip_load(p)
        sub = IP.subgraph(m, node or None, int(depth if depth is not None else 1)) if node else m
        pend = self._prop_load(p)
        head = "" if not pend else "NOTE: a proposal with %d op(s) is waiting for the user's decision (ip_proposal shows it). The model below does not include it.\n" % len(pend["ops"])
        if format == "json":
            return head + json.dumps(sub, ensure_ascii=False, indent=1)
        if format == "summary":
            return head + json.dumps(IP.summary(m), ensure_ascii=False, indent=1)
        return head + self._ip_text(sub) + ("\n(sub-graph around %s, depth %s)" % (node, depth) if node else "")

    def ip_validate(self, path):
        p = self._ip_path(path)
        m = self._ip_load(p)
        f, cnt = self._findings(m, 200)
        return json.dumps({"path": self.rel(p), "errors": cnt["err"], "warnings": cnt["warn"], "info": cnt["info"], "findings": f}, ensure_ascii=False, indent=1)

    def ip_references(self, path):
        p = self._ip_path(path)
        m = self._ip_load(p)
        keys = {p.name.lower(), p.stem.lower(), m["id"].lower()}
        hits, ext = [], []
        for f in self.files():
            try:
                t = f.read_text("utf-8-sig", errors="ignore")
            except OSError:
                continue
            low = t.lower()
            if any(k in low for k in (p.name.lower(), "[[" + p.stem.lower())):
                hits.append(self.rel(f))
        for o in self._ip_files():
            if o == p:
                continue
            try:
                om = self._ip_load(o)
            except Exception:  # noqa: BLE001
                continue
            if om["extends"] and om["extends"].lower() in keys:
                ext.append(self.rel(o))
            if any(r.get("path") and Path(str(r["path"]).replace("\\", "/")).name.lower() == p.name.lower() for r in om["refs"]):
                ext.append(self.rel(o))
        return json.dumps({"model": self.rel(p), "referenced_by_notes": hits[:200], "extended_or_linked_by_models": sorted(set(ext)),
                           "note": "Workspace collections (项目 / 集合) that reference this file are shown in the app: IP 图谱 → 被引用."}, ensure_ascii=False, indent=1)

    # ------------------------------------------------------------ write tools
    def ip_create(self, path, name="", chip="", kind="instance", source="", docrev="", description="", extends="", template=""):
        p = self._ip_path(path, must_exist=False)
        if p.exists():
            raise self._te("already exists: %s (use ip_edit to change a model)" % self.rel(p))
        if kind not in IP.MODEL_KINDS:
            raise self._te("kind must be one of %s" % ", ".join(IP.MODEL_KINDS))
        mid = re.sub(r"[^A-Za-z0-9_\-]", "_", p.stem)
        mid = mid if re.match(r"^[A-Za-z_]", mid) else "_" + mid
        if template:
            if kind != "instance":
                raise self._te("template= creates an instance; leave kind at its default")
            m = IP.from_template(self._tpl_load(template), mid, name or p.stem, chip, source, docrev, description)
            return self._put_file(self.rel(p), self._ip_dump(m), "create") + "\nStarted from built-in template %s: %d node(s), %d edge(s), all 待核对. Fill in what the manual says with ip_edit (parameters, registers, pages)." % (template, len(m["nodes"]), len(m["edges"]))
        m = IP.create({"id": mid, "name": name or p.stem, "chip": chip, "kind": kind, "source": source, "docrev": docrev, "description": description, "extends": extends})
        return self._put_file(self.rel(p), self._ip_dump(m), "create") + "\nAdd structure with ip_edit (ops: %s)." % ", ".join(IP.OP_NAMES)

    def _ip_run(self, p, m, ops, mode, title, note, what):
        """shared tail of ip_edit / ip_instantiate: validate → propose or write"""
        pend = self._prop_load(p)
        stacked = IP.apply(m, pend["ops"])["model"] if pend and pend.get("ops") and IP.apply(m, pend["ops"])["ok"] else m
        if mode == "write":
            res = IP.apply(m, ops)
        else:
            res = IP.apply(stacked, ops)
        if not res["ok"]:
            lines = ["REJECTED — nothing was changed (the whole batch is atomic). %d problem(s):" % len(res["errors"])]
            for e in res["errors"]:
                lines.append("  op #%d (%s): [%s] %s" % (e["index"], e["op"], e["code"], e["msg"]))
            lines.append("Fix the op(s) and send the batch again.")
            return "\n".join(lines)
        before = IP.validate(m if mode == "write" else stacked)
        after = IP.validate(res["model"])
        key = lambda v: (v["level"], v["code"], v["msg"])
        seen = {key(v) for v in before}
        fresh = [v for v in after if key(v) not in seen and v["level"] in ("err", "warn")]
        report = ""
        if fresh:
            report = "\nNew findings after this change:\n" + "\n".join("  [%s] %s" % (v["level"], v["msg"]) for v in fresh[:15])
        desc = [IP.describe_op(o) for o in ops]
        if mode == "write":
            out = self._put_file(self.rel(p), self._ip_dump(res["model"]), "write")
            return "%s\n%d op(s) applied (rev %d → %d):\n  %s%s" % (out, len(ops), m["rev"], res["model"]["rev"], "\n  ".join(desc), report)
        prop = {"schema": IP.PROPOSAL_SCHEMA, "base_rev": m["rev"], "created": datetime.datetime.now().isoformat(timespec="seconds"), "client": getattr(self, "client", ""),
                "title": title or (pend or {}).get("title") or what, "note": note or (pend or {}).get("note") or "", "ops": (pend["ops"] if pend else []) + ops,
                "described": ((pend or {}).get("described") or []) + desc}
        self._put_file(self.rel(self._prop_path(p)), self._ip_dump(prop), "write")
        return ("PROPOSED (not applied yet) — %d op(s) waiting for the user's decision in ChipBench (IP 图谱 → 待确认的修改); %d in total for this model:\n  %s%s\n"
                "Tell the user to review and accept. Use mode=\"write\" only when the user explicitly asked for a direct change.") % (len(ops), len(prop["ops"]), "\n  ".join(desc), report)

    def ip_edit(self, path, ops, mode="propose", title="", note=""):
        p = self._ip_path(path)
        m = self._ip_load(p)
        if isinstance(ops, str):
            try:
                ops = json.loads(ops)
            except ValueError:
                raise self._te("ops must be a list of operation objects")
        if isinstance(ops, dict):
            ops = [ops]
        if not isinstance(ops, list) or not ops:
            raise self._te("ops must be a non-empty list. Available ops: %s" % ", ".join(IP.OP_NAMES))
        if len(ops) > 400:
            raise self._te("at most 400 ops per call")
        if mode not in ("propose", "write"):
            raise self._te('mode must be "propose" (default, the user confirms in the app) or "write"')
        return self._ip_run(p, m, ops, mode, title, note, "AI 修改（%d 项）" % len(ops))

    def ip_instantiate(self, path, template, prefix, parent="", name="", mode="propose"):
        p = self._ip_path(path)
        m = self._ip_load(p)
        tpl = self._tpl_load(template) if str(template).startswith("builtin:") else self._ip_load(self._ip_path(template))
        try:
            ops = IP.instantiate(tpl, prefix, parent or None, name or None)
        except IP.IpErr as e:
            raise self._te(e.msg)
        return self._ip_run(p, m, ops, mode, "从模板 %s 添加 %s" % (tpl["name"], prefix), "", "从模板添加 " + prefix)

    def ip_simulate(self, path, scene, step=0, format="text"):
        """Replay a scene against the model's rules (read-only).  Every result is 推导 and names the rules behind it."""
        p = self._ip_path(path)
        m = self._ip_load(p)
        if not any(x["id"] == scene for x in m["scenes"]):
            raise self._te("scene %r not in the model (available: %s)" % (scene, ", ".join(x["id"] for x in m["scenes"]) or "none"))
        r = SIM.plain(SIM.simulate(m, scene))
        if format == "json":
            return json.dumps(r, ensure_ascii=False, indent=1)
        L = ["Simulation of scene %s \"%s\" — %d rule(s) in the model.  Confidence: 推导 (derived from the rules below; NOT a statement of the manual)." % (r["scene"], r["name"], len(r["rules"]))]
        if not r["rules"]:
            L.append("This model has NO rules, so nothing is derived: the replay below only applies the scene's own register writes. Add rules with ip_edit (add_rule) ONLY where the manual states the behaviour, with its page.")
        else:
            L.append("Rules: " + ", ".join("%s (%s%s)" % (x["id"], (x["ev"] or {}).get("level", "待核对"), " p." + str(x["ev"]["page"]) if (x["ev"] or {}).get("page") not in (None, "") else "") for x in r["rules"]))
        if r["unverified"]:
            L.append("⚠ Rules used here without manual / measured evidence: %s — treat the derived changes below as hypotheses." % ", ".join(r["unverified"]))
        for e in r["errors"]:
            L.append("⚠ " + e)
        if r["init"]["changes"] or r["init"]["errors"]:
            L.append("Power-on: " + ("; ".join("%s %s→%s [%s]" % (c["target"], c["from"], c["to"], ", ".join(c["by"])) for c in r["init"]["changes"]) or "no changes") + "".join("  ⚠ " + e for e in r["init"]["errors"]))
        shown = [x for x in r["steps"] if not step or x["index"] + 1 == int(step)]
        if step and not shown:
            raise self._te("step %s does not exist (the scene has %d step(s))" % (step, len(r["steps"])))
        for x in shown:
            L.append("Step %d: %s" % (x["index"] + 1, x["title"]))
            L.append("  writes: " + (", ".join("%s=0x%X" % (w["reg"], w["value"]) if isinstance(w["value"], int) else "%s=%s" % (w["reg"], w["value"]) for w in x["writes"]) or "-"))
            L.append("  changes: " + ("; ".join("%s %s→%s [%s]" % (c["target"], c["from"], c["to"], ", ".join(c["by"])) for c in x["changes"]) or "none"))
            if x["fired"]:
                L.append("  rules that acted: " + ", ".join(x["fired"]) + ("   (settled in %d pass(es))" % x["passes"] if x["passes"] > 1 else ""))
            for ev in x["events"]:
                L.append("  event: %s%s  [rule %s]" % (ev["text"], " @" + ev["node"] if ev["node"] else "", ev["rule"]))
            for e in x["errors"]:
                L.append("  ⚠ " + e)
            if not x["settled"]:
                L.append("  ⚠ the rules did NOT settle")
        return "\n".join(L)

    def ip_proposal(self, path, action="show"):
        p = self._ip_path(path)
        m = self._ip_load(p)
        pend = self._prop_load(p)
        if not pend:
            return "No pending proposal for %s." % self.rel(p)
        if action == "discard":
            f = self._prop_path(p)
            if self.dry:
                self.plan.append({"op": "delete", "path": str(f), "rel": self.rel(f), "added": 0, "removed": len(pend["ops"]), "diff": ""})
                return "would discard the proposal"
            bk = self.backup(f)
            f.unlink()
            root = next((r for r in self.roots if r in f.parents), self.roots[0])
            self._log({"op": "delete", "path": str(f), "root": str(root), "rel": self.rel(f), "backup": str(root / bk) if bk else None, "after_hash": None, "added": 0, "removed": len(pend["ops"]), "diff": ""})
            return "discarded the proposal for %s (%d op(s))" % (self.rel(p), len(pend["ops"]))
        if action != "show":
            raise self._te('action must be "show" or "discard"')
        res = IP.apply(m, pend["ops"])
        out = {"title": pend.get("title"), "created": pend.get("created"), "client": pend.get("client"), "stale": pend.get("base_rev") != m["rev"],
               "ops": len(pend["ops"]), "changes": pend.get("described") or [IP.describe_op(o) for o in pend["ops"]], "applies_cleanly": res["ok"]}
        if not res["ok"]:
            out["problems"] = res["errors"][:10]
        else:
            out["diff"] = IP.diff(m, res["model"])
            out["findings_after"] = self._findings(res["model"], 15)[0]
        return json.dumps(out, ensure_ascii=False, indent=1)

    def ip_diff(self, path, against=""):
        p = self._ip_path(path)
        m = self._ip_load(p)
        if against and against != "proposal":
            other = self._ip_load(self._ip_path(against))
            return json.dumps({"a": self.rel(p), "b": against, "diff": IP.diff(m, other)}, ensure_ascii=False, indent=1)
        pend = self._prop_load(p)
        if not pend:
            return "No pending proposal for %s — pass `against` with another .cbip path to compare two models." % self.rel(p)
        res = IP.apply(m, pend["ops"])
        if not res["ok"]:
            return "The proposal no longer applies cleanly: " + "; ".join(e["msg"] for e in res["errors"][:5])
        return json.dumps({"model": self.rel(p), "diff_if_accepted": IP.diff(m, res["model"])}, ensure_ascii=False, indent=1)

    def ip_import_atlas(self, page, path=""):
        """Convert a Markdown IP-atlas page into a .cbip model (the page is left unchanged)."""
        pg = self._atlas_find(page)
        src = Path(pg["_p"])
        text = self._g["read_text"](src)[0]
        if path:
            dst = path
        elif pg.get("bundled"):
            dst = "IP图谱/%s/%s" % (re.sub(r"[^\w\-]+", "_", pg["ip"]), re.sub(r"[^\w\-]+", "_", pg["chip"]))
        else:
            dst = src.with_suffix("").as_posix()
        dp = self._ip_path(str(dst), must_exist=False)
        if dp.exists():
            raise self._te("already exists: %s (choose another path)" % self.rel(dp))
        r = IP.from_atlas(text, self._g["mini_yaml"], {"path": src.name if not pg.get("bundled") else ""})
        out = self._put_file(self.rel(dp), self._ip_dump(r["model"]), "create")
        f, cnt = self._findings(r["model"], 12)
        return out + "\nMigrated %d node(s), %d edge(s), %d register(s), %d scene(s), %d timing(s). %s\nFindings: %d error(s), %d warning(s)%s" % (
            len(r["model"]["nodes"]), len(r["model"]["edges"]), len(r["model"]["registers"]), len(r["model"]["scenes"]), len(r["model"]["timings"]),
            ("Skipped: " + "; ".join(r["warnings"])) if r["warnings"] else "Nothing skipped.", cnt["err"], cnt["warn"],
            "".join("\n  [%s] %s" % (x["level"], x["msg"]) for x in f if x["level"] != "info"))

    @staticmethod
    def parse_svd(xml):
        """CMSIS-SVD -> [{name: 'PER.REG', address, width, reset, desc, fields:[{name,bits,access,desc,values}]}] (same shape as the app's X.parseSVD)"""
        root = ET.fromstring(xml)
        tx = lambda el, t: (el.find(t).text or "").strip() if el is not None and el.find(t) is not None and el.find(t).text is not None else None

        def num(v, d=0):
            try:
                return int(str(v).strip(), 0) if v not in (None, "") else d
            except ValueError:
                return d
        out = []
        for per in root.iter("peripheral"):
            pn, bs = tx(per, "name"), num(tx(per, "baseAddress"))
            for r in per.findall("registers/register"):
                fields = []
                for f in r.findall("fields/field"):
                    lo, w, rg, lsb, msb = tx(f, "bitOffset"), tx(f, "bitWidth"), tx(f, "bitRange"), tx(f, "lsb"), tx(f, "msb")
                    m = re.search(r"\[(\d+):(\d+)\]", rg or "")
                    bits = "%s:%s" % (m.group(1), m.group(2)) if rg and m else ("%s:%s" % (msb, lsb) if lsb is not None else "%d:%d" % (num(lo) + num(w, 1) - 1, num(lo)))
                    vals = {}
                    for ev in f.iter("enumeratedValue"):
                        v = tx(ev, "value")
                        if v is not None:
                            vals[num(v)] = (tx(ev, "name") or "") + (" — " + tx(ev, "description") if tx(ev, "description") else "")
                    fields.append({"name": tx(f, "name"), "bits": bits, "access": tx(f, "access") or "", "desc": tx(f, "description") or "", "values": vals or None})
                out.append({"name": "%s.%s" % (pn, tx(r, "name")), "address": bs + num(tx(r, "addressOffset")), "width": num(tx(r, "size"), 32), "reset": num(tx(r, "resetValue")), "desc": tx(r, "description") or "", "fields": fields})
        return out

    def ip_import_svd(self, path, svd, peripheral="", node="", mode="propose", title=""):
        p = self._ip_path(path)
        m = self._ip_load(p)
        sp = self.path(svd)
        try:
            regs = self.parse_svd(self._g["read_text"](sp)[0])
        except ET.ParseError as e:
            raise self._te("not a valid SVD file: %s" % e)
        pers = sorted({r["name"].split(".")[0] for r in regs})
        if not regs:
            raise self._te("no registers in %s" % self.rel(sp))
        if not peripheral:
            if len(pers) == 1:
                peripheral = pers[0]
            else:
                raise self._te("the SVD has %d peripherals; pass `peripheral` — one of: %s" % (len(pers), ", ".join(pers[:60])))
        if peripheral not in pers:
            raise self._te("peripheral %r not in the SVD (available: %s)" % (peripheral, ", ".join(pers[:60])))
        if node and not any(n["id"] == node for n in m["nodes"]):
            raise self._te("node %r not in the model" % node)
        ops = IP.svd_ops(regs, peripheral, node or None, list(m["registers"]))
        return self._ip_run(p, m, ops, mode, title or "导入 SVD %s" % peripheral, "来自 %s；SVD 不是手册，依据均为待核对" % self.rel(sp), "导入 SVD " + peripheral)
