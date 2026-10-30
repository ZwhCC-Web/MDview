#!/usr/bin/env python3
"""Time ELK layouts of generated models with different option sets, in the real Chromium worker the app uses.
   python tools/elk-bench.py [N ...]      (CAP=ms per layout, default 30000)"""
import asyncio, json, os, subprocess, sys, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent; sys.path.insert(0, str(ROOT / 'tests'))
from util import *; from base_fs import *
CAP = int(os.environ.get('CAP', '30000'))
VARIANTS = {
 'current (ORTHOGONAL, INCLUDE_CHILDREN, thr 7)': {},
 'POLYLINE': {'elk.edgeRouting': 'POLYLINE'},
 'thr 1': {'elk.layered.thoroughness': '1'},
 'POLYLINE + thr 1': {'elk.edgeRouting': 'POLYLINE', 'elk.layered.thoroughness': '1'},
 'POLYLINE + thr 1 + SEPARATE_CHILDREN': {'elk.edgeRouting': 'POLYLINE', 'elk.layered.thoroughness': '1', 'elk.hierarchyHandling': 'SEPARATE_CHILDREN'},
 'ORTHO + thr 1 + SEPARATE_CHILDREN': {'elk.layered.thoroughness': '1', 'elk.hierarchyHandling': 'SEPARATE_CHILDREN'},
 'ORTHO + thr 1 + SEPARATE + GREEDY cycles + LONGEST_PATH': {'elk.layered.thoroughness': '1', 'elk.hierarchyHandling': 'SEPARATE_CHILDREN', 'elk.layered.cycleBreaking.strategy': 'GREEDY', 'elk.layered.layering.strategy': 'LONGEST_PATH'},
}
async def main():
    sizes = [int(x) for x in sys.argv[1:]] or [100, 300]
    with Server() as srv:
        async with async_playwright() as p:
            b, ctx, pg, errs = await launch(p, srv, base_fs()); ev = pg.evaluate; await pg.wait_for_timeout(500)
            for N in sizes:
                model = subprocess.run(['node', str(ROOT / 'tools/gen-large-ip.js'), str(N), '/tmp/_eb.cbip'], capture_output=True, text=True, check=True) and json.loads(pathlib.Path('/tmp/_eb.cbip').read_text('utf-8'))
                nb = await ev("(m)=>{const SL=ChipBench; const M=SL.ipblock.normalize(SL.IPM.toIpblock(m)); return [M.blocks.length, M.groups.length, M.links.length];}", model); print('\n== %d blocks, %d groups, %d links' % tuple(nb))
                for name, o in VARIANTS.items():
                    r = await ev("""async ([m,o,cap])=>{const SL=ChipBench; const M=SL.ipblock.normalize(SL.IPM.toIpblock(m)); const g=SL.ipblock.toElk(M); Object.assign(g.layoutOptions,o); const call=await SL.elk.worker(); const t=performance.now();
                        try{ const r=await Promise.race([call('layout',{graph:g,layoutOptions:{},options:{}}), new Promise((_,rej)=>setTimeout(()=>rej(new Error('cap')),cap))]); return {ms:Math.round(performance.now()-t), w:Math.round(r.width), h:Math.round(r.height)}; }catch(e){ return {err:String(e.message)}; }}""", [model, o, CAP])
                    print((('%7d ms  %5d x %-5d' % (r['ms'], r['w'], r['h'])) if 'ms' in r else '   >%s ms (gave up: %s)' % (CAP, r['err'])).ljust(34) + name)
                    if 'err' in r: break
            await b.close()
asyncio.run(main())
