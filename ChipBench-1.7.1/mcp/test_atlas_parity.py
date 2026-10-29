"""The MCP server (Python) and the app (JS atlas-model.js) both understand an atlas page.  This test makes sure they agree:
same counts, same impact result, same error findings — on the bundled CAN-FD page and on deliberately broken pages.   python mcp/test_atlas_parity.py"""
import json, subprocess, sys, tempfile, pathlib, importlib.util
here = pathlib.Path(__file__).resolve().parent; root = here.parent
spec = importlib.util.spec_from_file_location("srv", here / "chipbench_mcp.py"); srv = importlib.util.module_from_spec(spec); spec.loader.exec_module(srv)
page = lambda body, fm="": "---\ntype: ip-atlas\nip: X\nchip: Y\nsource: m.pdf\n" + fm + "---\n# t\n" + body
PAGES = {
 "bundled": (root / "atlas/CAN-FD/RH850-U2B.md").read_text("utf-8").replace("\r", ""),
 "ports+evidence": page("```ipblock\ntitle: D\nblocks:\n  - {id: pins, label: Pins, page: 12, ev: 手册确认, ports: [{id: tx, dir: out}, {id: rx, dir: in}]}\n  - {id: pc, label: PC, page: \"13-14\", ev: 推导}\n  - {id: lone, label: Lone}\nlinks:\n  - {from: pins.rx, to: pc}\n  - {from: pc, to: pins.tx}\n```\n"),
 "bad registers": page("```register\nname: CTRL\naddress: 0x1000\nwidth: 8\nreset: 0x1FF\nfields:\n  - {name: A, bits: \"7:4\"}\n  - {name: B, bits: \"5\"}\n  - {name: C, bits: \"9\"}\n  - {name: D, bits: \"x\"}\n```\n```register\nname: STS\naddress: 0x1000\nwidth: 12\n```\n"),
 "scene": page("```ipblock\ntitle: D\nblocks:\n  - {id: a, label: A, regs: [R1, R9]}\n  - {id: b, label: B}\nlinks:\n  - {from: a, to: b}\n```\n```register\nname: R1\nwidth: 8\nfields:\n  - {name: LO, bits: \"3:0\"}\n  - {name: HI, bits: \"7:4\"}\n```\n```scene\ntitle: S\ncode: 0\nsteps:\n  - {t: one, hl: [a, zz], regs: [{r: R1, v: 0x1F0}, {r: R1, v: abc}], line: 9, x: hi}\n  - {t: two, regs: [{r: R1, v: 0x21}]}\n```\n```c\nR1 = 0x21;\nint x;\n```\n"),
}
js = r"""
const AM=require(process.argv[1]+'/app/js/atlas-model.js'); const pages=JSON.parse(require('fs').readFileSync(0,'utf8')); const out={};
for (const [k,t] of Object.entries(pages)) { const M=AM.build(t), S=AM.summary(M), V=AM.validate(M), E=AM.evidence(M);
  const regs=[...M.registers.keys()]; const imp=regs.length?AM.impact(M,regs.includes('RFSTS0')?'RFSTS0':regs[0]):null;
  out[k]={blocks:S.blocks,links:S.links,registers:S.registers,fields:S.fields,steps:S.steps,withPage:E.withPage,total:E.total,
    errors:V.filter(x=>x[0]==='err').length, imp: imp?{reg:imp.register,blocks:imp.blocks.length,steps:imp.steps.length,code:imp.code.length,changed:imp.steps.map(s=>s.changed.length)}:null}; }
console.log(JSON.stringify(out));"""
r = subprocess.run(["node", "-e", js, str(root)], input=json.dumps(PAGES), capture_output=True, text=True); assert r.returncode == 0, r.stderr
J = json.loads(r.stdout); bad = 0
def check(c, n, i=""):
    global bad; print(("PASS " if c else "FAIL ") + n + ("" if c else "  " + str(i))); bad += 0 if c else 1
for k, text in PAGES.items():
    m = srv.atlas_parse(text); j = J[k]
    P = dict(blocks=len(m["blocks"]), links=len(m["links"]), registers=len(m["registers"]), fields=sum(len(r["fields"]) for r in m["registers"].values()), steps=sum(len(s["steps"]) for s in m["scenes"]))
    check(all(P[x] == j[x] for x in P), k + ": counts agree", (P, {x: j[x] for x in P}))
    items = [b["pages"] for b in m["blocks"]] + [r["pages"] for r in m["registers"].values()] + [f["pages"] for r in m["registers"].values() for f in r["fields"]] + [st["pages"] for s in m["scenes"] for st in s["steps"]]
    check(len(items) == j["total"] and sum(1 for x in items if x) == j["withPage"], k + ": evidence totals agree", (len(items), j["total"]))
    d = pathlib.Path(tempfile.mkdtemp()); n = srv.Notes([d]); pg = d / "IP图谱" / "X" / "Y.md"; pg.parent.mkdir(parents=True); pg.write_text(text, "utf-8")
    v = n.atlas_validate("X/Y"); perr = sum(1 for l in v.splitlines() if l.startswith("ERR"))
    check(perr == j["errors"], k + ": validation error count agrees (py %d / js %d)" % (perr, j["errors"]), v)
    if j["imp"]:
        ij = json.loads(n.atlas_impact("X/Y", j["imp"]["reg"])); chg = [len(s["changed_fields"]) for s in ij["scene_steps"]]
        check(len(ij["blocks"]) == j["imp"]["blocks"] and len(ij["scene_steps"]) == j["imp"]["steps"] and len(ij["code"]) == j["imp"]["code"] and chg == j["imp"]["changed"], k + ": impact(%s) agrees" % j["imp"]["reg"], (len(ij["blocks"]), len(ij["scene_steps"]), len(ij["code"]), chg, j["imp"]))
    ev = json.loads(n.atlas_evidence("X/Y")); check(ev["total"] == j["total"] and ev["with_page"] == j["withPage"], k + ": atlas_evidence agrees")
print("ALL PASS" if not bad else "%d FAILED" % bad); sys.exit(1 if bad else 0)
