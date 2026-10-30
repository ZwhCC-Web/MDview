/* manual placement geometry (2.2):  node tests/ip-layout.test.js */
const L = require('../app/js/ip-layout.js'); let ok = 0, bad = 0;
const t = (n, c, d) => { if (c) ok++; else { bad++; console.log('FAIL', n, d === undefined ? '' : JSON.stringify(d)); } };
const blocks = [{ id: 'cpu' }, { id: 'a', group: 'g' }, { id: 'b', group: 'g' }, { id: 'c', group: 'h' }, { id: 'out' }], groups = [{ id: 'g' }, { id: 'h', parent: 'g' }];
const base = () => ({ root: { x: 0, y: 0, w: 900, h: 400 }, 'b:cpu': { x: 14, y: 14, w: 96, h: 50 }, 'g:g': { x: 200, y: 20, w: 400, h: 300 }, 'b:a': { x: 220, y: 60, w: 96, h: 50 }, 'b:b': { x: 360, y: 60, w: 96, h: 50 }, 'g:h': { x: 220, y: 160, w: 200, h: 120 }, 'b:c': { x: 240, y: 190, w: 96, h: 50 }, 'b:out': { x: 760, y: 150, w: 96, h: 50 } });
t('no offsets → nothing changes (the same boxes object comes back)', (() => { const b = base(); const r = L.apply(b, blocks, groups, {}); return r.boxes === b && !r.moved && r.eff === null; })());
t('zero / junk offsets count as none', (() => { const r = L.apply(base(), blocks, groups, { a: { dx: 0, dy: 0 }, b: { dx: 'x', dy: null } }); return !r.moved; })());
{ const r = L.apply(base(), blocks, groups, { a: { dx: 100, dy: 40 } }), B = r.boxes;
  t('a moved node: its box moves by its offset, others stay', B['b:a'].x === 320 && B['b:a'].y === 100 && B['b:b'].x === 360 && B['b:cpu'].x === 14);
  t('the effective offset of a node is its own', r.eff('a').dx === 100 && r.eff('b').dx === 0);
  t('the page is not shifted when nothing leaves the margin', r.shift.x === 0 && r.shift.y === 0); }
{ const r = L.apply(base(), blocks, groups, { g: { dx: 50, dy: 10 } }), B = r.boxes;
  t('moving a group moves all its members (nodes AND the nested group)', B['b:a'].x === 270 && B['b:b'].x === 410 && B['g:h'].x === 270 && B['b:c'].x === 290 && B['b:c'].y === 200);
  t('…but not nodes outside it', B['b:cpu'].x === 14 && B['b:out'].x === 760);
  t('the group frame itself moves by the same amount', B['g:g'].x === 250 && B['g:g'].y === 30 && B['g:g'].w === 400); }
{ const r = L.apply(base(), blocks, groups, { g: { dx: 50, dy: 0 }, a: { dx: 10, dy: 5 } }), B = r.boxes; t('offsets add up: a node inside a moved group, moved again', B['b:a'].x === 220 + 50 + 10 && B['b:a'].y === 65); t('effective() sums the chain (c is in h is in g)', L.apply(base(), blocks, groups, { g: { dx: 5, dy: 0 }, h: { dx: 7, dy: 0 }, c: { dx: 11, dy: 0 } }).eff('c').dx === 23); }
{ const r = L.apply(base(), blocks, groups, { a: { dx: 500, dy: 0 } }), B = r.boxes; t('a node dragged out of its group: the group GROWS to contain it', B['g:g'].x + B['g:g'].w >= B['b:a'].x + B['b:a'].w + 14 && B['g:g'].x <= 200, B['g:g']);
  t('growing never shrinks below ELK’s frame', B['g:g'].x === 200 && B['g:g'].y === 20 && B['g:g'].h >= 300);
  t('the page gets wider to hold it', r.boxes.root.w >= B['g:g'].x + B['g:g'].w + 14); }
{ const r = L.apply(base(), blocks, groups, { a: { dx: 0, dy: -200 } }), B = r.boxes; t('a node dragged above the top is kept on the page (shift down)', r.shift.y > 0 && Math.min(...Object.keys(B).filter(k => k !== 'root').map(k => B[k].y)) >= L.MARGIN);
  t('the shift is applied to everything and to the container origins', B['b:cpu'].y === 14 + r.shift.y && B['b:cpu'].oy === B['b:cpu'].y); }
{ const r = L.apply(base(), blocks, groups, { out: { dx: -900, dy: 0 } }), B = r.boxes; t('dragged far left: shift right, relative positions of the others are preserved', r.shift.x > 0 && B['b:b'].x - B['b:a'].x === 140); }
{ const r = L.apply(base(), blocks, groups, { c: { dx: 0, dy: 200 } }), B = r.boxes; t('nested growth is bottom-up: moving c far down grows h, and then g which contains h', B['g:h'].y + B['g:h'].h >= B['b:c'].y + B['b:c'].h + 14 && B['g:g'].y + B['g:g'].h >= B['g:h'].y + B['g:h'].h + 14, [B['g:h'], B['g:g']]); }
t('input boxes are not mutated', (() => { const b = base(), s = JSON.stringify(b); L.apply(b, blocks, groups, { a: { dx: 99, dy: 99 }, g: { dx: 1, dy: 1 } }); return JSON.stringify(b) === s; })());
t('offsets for ids that do not exist are ignored', !L.apply(base(), blocks, groups, { ghost: { dx: 50, dy: 50 } }).moved);
/* edges */
{ const r = L.apply(base(), blocks, groups, { g: { dx: 50, dy: 0 } });
  t('edge inside the moved group, both ends moved with it: keeps ELK’s route', L.keepsRoute(r.eff, 'g:g', 'b:a', 'b:b'));
  t('edge from outside to a moved group member (drawn in root): needs a new route', !L.keepsRoute(r.eff, 'root', 'b:cpu', 'b:a'));
  t('edge between two unmoved nodes in root: keeps its route', L.keepsRoute(r.eff, 'root', 'b:cpu', 'b:out')); }
{ const r = L.apply(base(), blocks, groups, { a: { dx: 10, dy: 0 } }); t('only ONE end of an in-group edge moved → new route', !L.keepsRoute(r.eff, 'g:g', 'b:a', 'b:b')); }
t('no offsets at all → every edge keeps its route', L.keepsRoute(null, 'root', 'b:x', 'b:y'));
/* route */
{ const A = { x: 0, y: 0, w: 100, h: 50 }, Bx = { x: 300, y: 100, w: 100, h: 50 }, r = L.route(A, Bx);
  t('route: B to the right → leaves A’s right side, enters B’s left side, 3 segments (4 points), orthogonal', r.length === 4 && r[0].x === 100 && r[0].y === 25 && r[3].x === 300 && r[3].y === 125 && r.every((p, i) => !i || p.x === r[i - 1].x || p.y === r[i - 1].y), r);
  const l = L.route(Bx, A); t('route: B to the left of A → leaves A’s left side', l[0].x === 300 && l[3].x === 100);
  const v = L.route({ x: 0, y: 0, w: 100, h: 50 }, { x: 20, y: 200, w: 100, h: 50 }); t('route: overlapping in x, B below → leaves the bottom, enters the top', v[0].y === 50 && v[3].y === 200 && v.every((p, i) => !i || p.x === v[i - 1].x || p.y === v[i - 1].y), v);
  const u = L.route({ x: 0, y: 300, w: 100, h: 50 }, { x: 20, y: 0, w: 100, h: 50 }); t('route: B above → leaves the top, enters the bottom', u[0].y === 300 && u[3].y === 50); }
console.log(ok + ' passed, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
