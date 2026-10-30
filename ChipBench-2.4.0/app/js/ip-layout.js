/* ChipBench 2.2 · ip-layout.js — manual placement on top of an automatic (ELK) layout.  PURE: no DOM, Node-testable.
   Input : the laid-out boxes { 'b:id' | 'g:id': { x, y, w, h } } (absolute), the diagram's blocks / groups, offsets { id: { dx, dy } }.
   Output: the same boxes moved; groups grown to hold what was moved into / out of them; the page shifted so nothing sits left of / above the margin;
           and which edges can keep ELK's route (both ends moved with their container) and which need a new one.
   Rules (each one is tested in tests/ip-layout.test.js):
     · a node's effective offset = its own + the offsets of all its groups (moving a group moves its members)
     · groups never shrink below ELK's frame; they grow (bottom-up) to contain every member
     · an edge keeps ELK's route only when both ends moved exactly as much as the container the route is drawn in
     · otherwise it gets a 3-segment orthogonal route between the two boxes, ports on the facing sides */
(function (G) {
  'use strict';
  const MARGIN = 14, PAD = { l: 14, t: 30, r: 14, b: 14 };
  const num = v => (Number.isFinite(+v) ? +v : 0);
  const own = (offs, id) => { const o = offs && offs[id]; return o ? { dx: num(o.dx), dy: num(o.dy) } : { dx: 0, dy: 0 }; };
  const hasOffsets = (offs, ids) => !!offs && ids.some(id => { const o = offs[id]; return o && (num(o.dx) || num(o.dy)); });
  /* effective offset of every id: own + ancestors' (groups are in `parentOf`, a Map id → parent id) */
  function effective(ids, parentOf, offs) { const memo = new Map(), f = id => { if (memo.has(id)) return memo.get(id); const me = own(offs, id), p = parentOf.get(id), up = p ? f(p) : { dx: 0, dy: 0 }; const r = { dx: me.dx + up.dx, dy: me.dy + up.dy }; memo.set(id, r); return r; }; ids.forEach(f); return f; }
  /* box key → id */
  const idOf = k => String(k).slice(2);
  function apply(boxes, blocks, groups, offs) {
    const ids = blocks.map(b => b.id).concat(groups.map(g => g.id)); if (!hasOffsets(offs, ids)) return { boxes, eff: null, moved: false, shift: { x: 0, y: 0 } };
    const parentOf = new Map(); blocks.forEach(b => { if (b.group) parentOf.set(b.id, b.group); }); groups.forEach(g => { if (g.parent) parentOf.set(g.id, g.parent); });
    const eff = effective(ids, parentOf, offs), out = {};
    Object.keys(boxes).forEach(k => { const b = boxes[k]; if (k === 'root') { out[k] = Object.assign({}, b); return; } const o = eff(idOf(k)); out[k] = { x: b.x + o.dx, y: b.y + o.dy, w: b.w, h: b.h, ox: b.x + o.dx, oy: b.y + o.dy }; });   /* ox / oy: the container ORIGIN edge points are relative to */
    const depth = id => { let d = 0, p = parentOf.get(id); while (p && d < 100) { d++; p = parentOf.get(p); } return d; };
    groups.slice().sort((a, b) => depth(b.id) - depth(a.id)).forEach(g => { const p = out['g:' + g.id]; if (!p) return; let x0 = p.x, y0 = p.y, x1 = p.x + p.w, y1 = p.y + p.h;
      const grow = q => { if (!q) return; x0 = Math.min(x0, q.x - PAD.l); y0 = Math.min(y0, q.y - PAD.t); x1 = Math.max(x1, q.x + q.w + PAD.r); y1 = Math.max(y1, q.y + q.h + PAD.b); };
      blocks.forEach(b => { if (b.group === g.id) grow(out['b:' + b.id]); }); groups.forEach(c => { if (c.parent === g.id) grow(out['g:' + c.id]); });
      p.x = x0; p.y = y0; p.w = x1 - x0; p.h = y1 - y0; });
    let mx = Infinity, my = Infinity; Object.keys(out).forEach(k => { if (k !== 'root') { mx = Math.min(mx, out[k].x); my = Math.min(my, out[k].y); } });
    const sx = mx < MARGIN ? MARGIN - mx : 0, sy = my < MARGIN ? MARGIN - my : 0;
    if (sx || sy) Object.keys(out).forEach(k => { const p = out[k]; p.x += sx; p.y += sy; if (p.ox != null) { p.ox += sx; p.oy += sy; } });
    let X1 = 0, Y1 = 0; Object.keys(out).forEach(k => { if (k !== 'root') { X1 = Math.max(X1, out[k].x + out[k].w); Y1 = Math.max(Y1, out[k].y + out[k].h); } });
    out.root.w = Math.max(out.root.w + sx, X1 + MARGIN); out.root.h = Math.max(out.root.h + sy, Y1 + MARGIN);
    return { boxes: out, eff, moved: true, shift: { x: sx, y: sy } };
  }
  /* does an edge keep ELK's route?  container: 'root' or 'g:id'; ends: 'b:id' / 'g:id' */
  function keepsRoute(eff, container, src, tgt) { if (!eff) return true; const c = container && container !== 'root' ? eff(idOf(container)) : { dx: 0, dy: 0 }, s = eff(idOf(src)), t = eff(idOf(tgt)); return s.dx === c.dx && s.dy === c.dy && t.dx === c.dx && t.dy === c.dy; }
  /* new route between two boxes: [{x,y} × 4], orthogonal, leaving the facing sides */
  function route(a, b) { const mid = (u, v) => Math.round((u + v) / 2);
    if (a.x + a.w + 10 <= b.x) { const sx = a.x + a.w, sy = a.y + a.h / 2, tx = b.x, ty = b.y + b.h / 2, m = mid(sx, tx); return [{ x: sx, y: sy }, { x: m, y: sy }, { x: m, y: ty }, { x: tx, y: ty }]; }
    if (b.x + b.w + 10 <= a.x) { const sx = a.x, sy = a.y + a.h / 2, tx = b.x + b.w, ty = b.y + b.h / 2, m = mid(sx, tx); return [{ x: sx, y: sy }, { x: m, y: sy }, { x: m, y: ty }, { x: tx, y: ty }]; }
    const down = a.y + a.h / 2 < b.y + b.h / 2, sx = a.x + a.w / 2, tx = b.x + b.w / 2, sy = down ? a.y + a.h : a.y, ty = down ? b.y : b.y + b.h, m = mid(sy, ty); return [{ x: sx, y: sy }, { x: sx, y: m }, { x: tx, y: m }, { x: tx, y: ty }]; }
  const API = { apply, keepsRoute, route, effective, hasOffsets, MARGIN };
  G.ChipBenchIPL = API; if (G.ChipBench) G.ChipBench.IPL = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
