"""ChipBench IP behaviour engine — Python mirror of app/js/ip-sim.js (same semantics, same limits, same texts).  PURE.
Replays a scene against the model's rules.  It knows nothing about any chip: it executes only the rules written into the model, and labels every result 推导."""
import ip_expr as IPE
import ip_model as IP

MAX_PASSES, MAX_BITS = 32, 1024
LIMIT = 1 << MAX_BITS
STRONG = ("手册确认", "实测")


def _bits(b):
    import re
    s = ("" if b is None else str(b)).strip()
    m = re.fullmatch(r"(\d+)\s*:\s*(\d+)", s)
    if m:
        hi, lo = int(m.group(1)), int(m.group(2))
        return (hi, lo) if hi >= lo else None
    m = re.fullmatch(r"(\d+)", s)
    return (int(m.group(1)), int(m.group(1))) if m else None


def _plain(v):
    return v if -9007199254740991 <= v <= 9007199254740991 else str(v)


def simulate(model, scene_id):
    m = IP.normalize(model)
    sc = next((x for x in m["scenes"] if x["id"] == scene_id), None)
    if sc is None:
        return {"ok": False, "error": "场景不存在：" + str(scene_id)}
    regs, vars_, active, widths, fields, errs = {}, {}, {}, {}, {}, []
    for rid, R in m["registers"].items():
        w = R.get("width")
        if not isinstance(w, int) or isinstance(w, bool) or w < 1 or w > MAX_BITS:
            errs.append("寄存器 %s 的位宽 %s 不在 1–%d 之间，不做推演" % (rid, IP._s(w), MAX_BITS))
            continue
        widths[rid] = w
        regs[rid] = (int(R["reset"]) if R.get("reset") is not None else 0) & ((1 << w) - 1)
        fields[rid] = {}
        for f in R.get("fields") or []:
            b = _bits(f.get("bits"))
            if b and b[0] < w:
                fields[rid][f["name"]] = {"lo": b[1], "mask": (1 << (b[0] - b[1] + 1)) - 1}
    rules = m["rules"][:200]
    compiled = []
    for r in rules:
        w = IPE.parse(r["when"])
        th = [IPE.parse_action(a) for a in r["then"]]
        el = [IPE.parse_action(a) for a in r["else"]]
        compiled.append({"r": r, "w": w, "th": th, "el": el, "ok": w["ok"] and all(a["ok"] for a in th) and all(a["ok"] for a in el)})
    for c in compiled:
        if not c["ok"]:
            errs.append("规则 %s 无法解析，已跳过（先运行校验）" % c["r"]["id"])

    def getv(name, field):
        if field is not None:
            f = fields.get(name, {}).get(field)
            if not f:
                raise IPE.ExprError("没有位域 %s.%s" % (name, field))
            return (regs[name] >> f["lo"]) & f["mask"]
        if name in widths:
            return regs[name]
        return vars_.get(name, 0)

    st = {"log": []}

    def set_target(t, val):
        if val >= LIMIT or val <= -LIMIT:
            raise IPE.ExprError("数值超过 %d 位，已停止（规则里有失控的增长？）" % MAX_BITS)
        by = st["by"]
        if t["field"] is not None:
            f = fields.get(t["name"], {}).get(t["field"])
            if not f:
                raise IPE.ExprError("没有位域 %s.%s" % (t["name"], t["field"]))
            old = regs[t["name"]]
            nv = (old & ~(f["mask"] << f["lo"])) | ((val & f["mask"]) << f["lo"])
            if nv != old:
                regs[t["name"]] = nv
                st["log"].append({"reg": t["name"], "bits": old ^ nv, "by": by})
            return nv != old
        if t["name"] in widths:
            nv = val & ((1 << widths[t["name"]]) - 1)
            if nv != regs[t["name"]]:
                st["log"].append({"reg": t["name"], "bits": regs[t["name"]] ^ nv, "by": by})
                regs[t["name"]] = nv
                return True
            return False
        old = vars_.get(t["name"], 0)
        if old != val:
            vars_[t["name"]] = val
            st["log"].append({"v": t["name"], "by": by})
            return True
        return False

    class Fired(list):   # insertion-ordered set (the JS version uses Set)
        def add(self, x):
            if x not in self:
                self.append(x)

    def run_actions(acts, by, events):
        changed = False
        st["by"] = by
        for a in acts:
            if a["kind"] == "emit":
                events.append({"text": a["text"], "node": a["node"], "rule": by})
                continue
            if set_target(a["target"], IPE.evaluate(a["expr"], getv)):
                changed = True
        return changed

    def settle(events, fired, step_errs):
        passes, changed, err_seen = 0, True, set()
        while changed and passes < MAX_PASSES:
            changed = False
            passes += 1
            for c in compiled:
                if not c["ok"]:
                    continue
                r = c["r"]
                try:
                    cond = IPE.evaluate(c["w"]["ast"], getv) != 0
                except IPE.ExprError as e:
                    if r["id"] not in err_seen:
                        err_seen.add(r["id"])
                        step_errs.append("规则 %s 的条件：%s" % (r["id"], e.msg))
                    cond = False
                try:
                    if r["trigger"] == "level":
                        if run_actions(c["th"] if cond else c["el"], r["id"], events):
                            changed = True
                            fired.add(r["id"])
                    else:
                        was = bool(active.get(r["id"]))
                        active[r["id"]] = cond
                        if cond and not was:
                            fired.add(r["id"])
                            if run_actions(c["th"], r["id"], events):
                                changed = True
                except IPE.ExprError as e:
                    if r["id"] + "#a" not in err_seen:
                        err_seen.add(r["id"] + "#a")
                        step_errs.append("规则 %s 的动作：%s" % (r["id"], e.msg))
                    return {"passes": passes, "settled": False, "aborted": True}
        return {"passes": passes, "settled": not changed, "aborted": False}

    def snap():
        return {"regs": dict(regs), "vars": dict(vars_)}

    def diff(a, b, by):
        out = []

        def cause_of(reg, mask, v=None):
            c = []
            for x in by:
                hit = (x.get("v") == v) if v is not None else (x.get("reg") == reg and (x["bits"] & mask) != 0)
                if hit and x["by"] not in c:
                    c.append(x["by"])
            return c
        for rid in b["regs"]:
            if a["regs"][rid] == b["regs"][rid]:
                continue
            fl = list(fields.get(rid, {}).items())
            covered = 0
            for name, f in fl:
                covered |= f["mask"] << f["lo"]
                x, y = (a["regs"][rid] >> f["lo"]) & f["mask"], (b["regs"][rid] >> f["lo"]) & f["mask"]
                if x != y:
                    out.append({"target": rid + "." + name, "from": x, "to": y, "by": cause_of(rid, f["mask"] << f["lo"])})
            if not fl or ((a["regs"][rid] ^ b["regs"][rid]) & ~covered) != 0:
                cv = covered if fl else 0
                out.append({"target": rid + ("（其它位）" if fl else ""), "from": a["regs"][rid] & ~cv, "to": b["regs"][rid] & ~cv, "by": cause_of(rid, ~covered), "whole": True})
        for k in b["vars"]:
            x = a["vars"].get(k, 0)
            if x != b["vars"][k]:
                out.append({"target": k, "from": x, "to": b["vars"][k], "by": cause_of(None, 0, k), "isVar": True})
        return out

    for c in compiled:
        if c["ok"] and c["r"]["trigger"] == "edge":
            try:
                active[c["r"]["id"]] = IPE.evaluate(c["w"]["ast"], getv) != 0
            except IPE.ExprError:
                active[c["r"]["id"]] = False
    st["log"] = []
    e0, f0, s0, before0 = [], Fired(), [], snap()
    st0 = settle(e0, f0, s0)
    init = {"state": snap(), "changes": diff(before0, snap(), st["log"]), "settled": st0["settled"], "errors": s0}
    steps, fatal = [], False
    for i, stp in enumerate(sc["steps"]):
        if fatal:
            break
        st["log"] = []
        events, fired, step_errs, before, writes = [], Fired(), [], snap(), []
        for w in stp.get("writes") or []:
            if w["reg"] not in widths:
                step_errs.append("写入的寄存器 %s 不存在或位宽不支持" % w["reg"])
                continue
            raw = int(w["value"])
            nv = raw & ((1 << widths[w["reg"]]) - 1)
            if nv != raw:
                step_errs.append("写入 %s 的值 0x%X 超出 %d 位，已截断" % (w["reg"], raw, widths[w["reg"]]))
            if regs[w["reg"]] != nv:
                st["log"].append({"reg": w["reg"], "bits": regs[w["reg"]] ^ nv, "by": "写入"})
                regs[w["reg"]] = nv
            writes.append({"reg": w["reg"], "value": nv})
        after_writes = snap()
        r = settle(events, fired, step_errs)
        if r["aborted"]:
            fatal = True
        if not r["settled"] and not r["aborted"]:
            step_errs.append("规则在 %d 轮内没有稳定下来（可能互相推翻）；以下是第 %d 轮的状态" % (MAX_PASSES, MAX_PASSES))
        after = snap()
        steps.append({"index": i, "title": stp["title"], "writes": writes, "changes": diff(before, after, st["log"]), "fired": list(fired), "events": events, "passes": r["passes"], "settled": r["settled"], "errors": step_errs, "state": after, "viaRules": len(diff(after_writes, after, st["log"]))})
    used = []
    for s in steps:
        for x in s["fired"]:
            if x not in used:
                used.append(x)
    return {"ok": True, "scene": sc["id"], "name": sc["name"], "confidence": "推导", "init": init, "steps": steps,
            "rules": [{"id": r["id"], "name": r["name"], "trigger": r["trigger"], "ev": r["ev"]} for r in rules], "firedRules": used,
            "unverified": [x for x in used if not (next(r for r in rules if r["id"] == x)["ev"].get("level") in STRONG)], "errors": errs, "limits": {"passes": MAX_PASSES, "bits": MAX_BITS}}


def plain(r):
    """ints beyond 2^53 become decimal strings — the same shape as the JS plain()"""
    if not r.get("ok"):
        return r

    def st(s):
        return {"regs": {k: _plain(v) for k, v in s["regs"].items()}, "vars": {k: _plain(v) for k, v in s["vars"].items()}}

    def ch(L):
        return [dict(x, **{"from": _plain(x["from"]), "to": _plain(x["to"])}) for x in L]
    out = dict(r)
    out["init"] = dict(r["init"], state=st(r["init"]["state"]), changes=ch(r["init"]["changes"]))
    out["steps"] = [dict(s, writes=[{"reg": w["reg"], "value": _plain(w["value"])} for w in s["writes"]], changes=ch(s["changes"]), state=st(s["state"])) for s in r["steps"]]
    return out
