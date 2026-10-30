/* motion.js — motion level resolution, frame governor, roving tabindex, tree navigation.  node tests/motion.test.js */
const MO = require('../app/js/motion.js'); let ok = 0, bad = 0;
const t = (n, c, d) => { if (c) ok++; else { bad++; console.log('FAIL', n, d === undefined ? '' : JSON.stringify(d)); } };
/* resolve */
t('auto → full normally', MO.resolve('auto', false) === 'full'); t('auto + OS reduce → calm (fades only)', MO.resolve('auto', true) === 'calm');
t('explicit full is still calm when the OS asks for reduced motion', MO.resolve('full', true) === 'calm'); t('calm stays calm', MO.resolve('calm', false) === 'calm' && MO.resolve('calm', true) === 'calm');
t('off is off, even without the OS flag', MO.resolve('off', false) === 'off' && MO.resolve('off', true) === 'off'); t('garbage → auto', MO.resolve('wat', false) === 'full' && MO.resolve(undefined, true) === 'calm');
t('step: full → calm → off → off', MO.step('full') === 'calm' && MO.step('calm') === 'off' && MO.step('off') === 'off');
/* governor */
{ const g = new MO.Governor({ window: 10, slow: 33, strikes: 2 }); let hit = 0; for (let i = 0; i < 100; i++) if (g.add(16)) hit++; t('governor: 60 fps never degrades', hit === 0);
  g.reset(); hit = 0; for (let i = 0; i < 19; i++) if (g.add(60)) hit++; t('governor: needs two slow windows in a row', hit === 0); t('governor: …and then degrades exactly once', g.add(60) === true);
  g.reset(); let r = []; for (let w = 0; w < 6; w++) for (let i = 0; i < 10; i++) { const x = g.add(w % 2 ? 16 : 60); if (x) r.push(w); } t('governor: a single slow window between good ones is forgiven', r.length === 0, r);
  g.reset(); t('governor: ignores zero / negative / > 1 s frames (hidden tab)', !g.add(0) && !g.add(-5) && !g.add(5000) && g.stats().frames === 0);
  const g2 = new MO.Governor({ window: 5, slow: 33, strikes: 1 }); let d2 = false; for (let i = 0; i < 5; i++) d2 = g2.add(50) || d2; t('governor: strikes=1 degrades after one slow window', d2); }
/* roving */
t('roving: → wraps', MO.roving(4, 3, 'ArrowRight') === 0 && MO.roving(4, 1, 'ArrowRight') === 2); t('roving: ← wraps', MO.roving(4, 0, 'ArrowLeft') === 3 && MO.roving(4, 2, 'ArrowLeft') === 1);
t('roving: Home / End', MO.roving(4, 2, 'Home') === 0 && MO.roving(4, 0, 'End') === 3); t('roving: other keys are not ours', MO.roving(4, 1, 'a') === null && MO.roving(4, 1, 'Enter') === null);
t('roving: no tabs → null', MO.roving(0, 0, 'ArrowRight') === null); t('roving: single tab stays', MO.roving(1, 0, 'ArrowRight') === 0 && MO.roving(1, 0, 'ArrowLeft') === 0); t('roving: rtl swaps the arrows', MO.roving(4, 1, 'ArrowLeft', true) === 2);
/* tree */
const rows = [{ lv: 0, open: true, kids: true }, { lv: 1, open: false, kids: true }, { lv: 1, open: false, kids: false }, { lv: 0, open: false, kids: true }, { lv: 0, open: false, kids: false }];
const nav = (c, k) => MO.treeNav(rows, c, k);
t('tree: ↓ / ↑ move and clamp', nav(0, 'ArrowDown').idx === 1 && nav(4, 'ArrowDown').idx === 4 && nav(1, 'ArrowUp').idx === 0 && nav(0, 'ArrowUp').idx === 0);
t('tree: Home / End', nav(3, 'Home').idx === 0 && nav(0, 'End').idx === 4);
t('tree: → on a closed folder opens it', JSON.stringify(nav(1, 'ArrowRight')) === '{"act":"open","idx":1}'); t('tree: → on an open folder enters its first child', JSON.stringify(nav(0, 'ArrowRight')) === '{"act":"focus","idx":1}');
t('tree: → on a leaf or an empty folder does nothing', nav(2, 'ArrowRight') === null && nav(4, 'ArrowRight') === null);
t('tree: ← on an open folder closes it', JSON.stringify(nav(0, 'ArrowLeft')) === '{"act":"close","idx":0}'); t('tree: ← on a child goes to its parent', JSON.stringify(nav(2, 'ArrowLeft')) === '{"act":"focus","idx":0}' && JSON.stringify(nav(1, 'ArrowLeft')) === '{"act":"focus","idx":0}');
t('tree: ← on a top-level closed row does nothing', nav(3, 'ArrowLeft') === null && nav(4, 'ArrowLeft') === null);
t('tree: nothing focused yet → ↓ focuses the first row, ↑ the last', nav(-1, 'ArrowDown').idx === 0 && nav(-1, 'ArrowUp').idx === 4); t('tree: empty tree → null; unknown key → null', MO.treeNav([], 0, 'ArrowDown') === null && nav(0, 'x') === null);
/* stagger */
t('stagger: grows with the index and is capped', MO.stagger(0, 10) === 0 && MO.stagger(3, 10) === 72 && MO.stagger(100, 10) === 240); t('stagger: long lists are halved so the last row still arrives quickly', MO.stagger(3, 100) === 36 && MO.stagger(100, 100) <= 120);
console.log(ok + ' passed, ' + bad + ' failed'); process.exit(bad ? 1 : 0);
