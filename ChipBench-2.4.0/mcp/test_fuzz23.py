"""Randomised JS <-> Python parity (2.4):  python mcp/test_fuzz23.py [seeds=150] [batches=40]
The JS side generates adaptive random operation batches (valid, invalid, wrongly typed) and applies them; the Python mirror replays the SAME batches and must give the same
accept / refuse decision, the same error codes and messages, the same final model, validation findings, summary, rendering input and scene simulations.
It also demands that Python NEVER raises an unexpected exception: an AI can send any JSON, and the server has to answer with a structured refusal."""
import json, re, subprocess, sys, pathlib, traceback
here = pathlib.Path(__file__).resolve().parent; root = here.parent; sys.path.insert(0, str(here))
import ip_model as PM, ip_sim as PS
SEEDS = int(sys.argv[1]) if len(sys.argv) > 1 else 150; LEN = int(sys.argv[2]) if len(sys.argv) > 2 else 40
r = subprocess.run(["node", str(root / "tests" / "fuzz-record.js"), str(SEEDS), str(LEN)], capture_output=True, text=True, encoding="utf-8"); assert r.returncode == 0, r.stderr[:800]
J = json.loads(r.stdout)
norm = lambda x: json.loads(json.dumps(x, sort_keys=True, ensure_ascii=False))
bad, first = 0, {}
def fail(k, seed, detail):
    global bad
    bad += 1
    if k not in first:
        first[k] = (seed, str(detail)[:600]); print("FAIL", k, "seed", seed, str(detail)[:600])
stats = {"batches": 0, "accepted": 0, "sims": 0, "crashes": 0, "cosmetic": 0}
# JSON has no `undefined`: when an argument is missing entirely, JS prints "undefined" where Python prints "null".  Same decision, same code — only the word differs.  Counted, not hidden.
def cosm(errs): return json.loads(json.dumps(errs, ensure_ascii=False).replace("undefined", "null"))
for rec in J:
    seed = rec["seed"]; m = PM.create(dict(id="f%d" % seed, name="F"))
    for i, (b, jr) in enumerate(zip(rec["batches"], rec["res"])):
        stats["batches"] += 1
        try:
            pr = PM.apply(m, b)
        except Exception as e:   # noqa: BLE001
            stats["crashes"] += 1; fail("python raised on a batch", seed, {"batch": b, "exc": "".join(traceback.format_exception_only(type(e), e)).strip()}); break
        pd, jd = [PM.describe_op(o) for o in b], [d.replace("undefined", "null") if "undefined" in d else d for d in jr["desc"]]
        if pd != jd:
            k = next(x for x in range(len(pd)) if pd[x] != jd[x]); fail("describe_op text differs", seed, {"op": b[k], "py": pd[k], "js": jd[k]}); break
        py_err = [[e["index"], e["op"], e["code"], e["msg"]] for e in pr["errors"]]
        if norm(py_err) != norm(jr["errors"]) and norm(py_err) == norm(cosm(jr["errors"])): stats["cosmetic"] += 1; jr = dict(jr, errors=cosm(jr["errors"]))
        if pr["ok"] != jr["ok"] or norm(py_err) != norm(jr["errors"]):
            fail("decision / error text differs", seed, {"i": i, "batch": b, "py": [pr["ok"], py_err[:2]], "js": [jr["ok"], jr["errors"][:2]]}); break
        if pr["ok"]:
            stats["accepted"] += 1; m = pr["model"]
    else:
        if norm(m) != norm(rec["model"]): fail("final model differs", seed, "")
        if sorted(["%s:%s:%s" % (v["level"], v["code"], v["msg"]) for v in PM.validate(m)]) != sorted(rec["validate"]): fail("validation findings differ", seed, [x for x in sorted(["%s:%s:%s" % (v["level"], v["code"], v["msg"]) for v in PM.validate(m)]) if x not in rec["validate"]][:2])
        if norm(PM.summary(m)) != norm(rec["summary"]): fail("summary differs", seed, "")
        if norm(PM.to_ipblock(m)) != norm(rec["ipblock"]): fail("rendering input (to_ipblock) differs", seed, "")
        if PM.diff(m, m)["empty"] != rec["diffEmpty"]: fail("diff(m, m) differs", seed, "")
        for sc, js in zip(m["scenes"], rec["sims"]):
            stats["sims"] += 1
            try:
                py = PS.plain(PS.simulate(m, sc["id"]))
            except Exception as e:   # noqa: BLE001
                stats["crashes"] += 1; fail("python simulation raised", seed, {"scene": sc["id"], "exc": repr(e)[:200]}); continue
            if norm(py) != norm(js): fail("simulation differs", seed, {"scene": sc["id"]})
print("seeds %d | batches %d (accepted %d) | scenes simulated %d | python crashes %d | wording-only differences (undefined/null/True/None) %d" % (SEEDS, stats["batches"], stats["accepted"], stats["sims"], stats["crashes"], stats["cosmetic"]))
print("ALL PASS" if not bad else "%d kinds of failure" % len(first)); sys.exit(1 if bad else 0)
