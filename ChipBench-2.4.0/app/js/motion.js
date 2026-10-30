/* ChipBench 2.1 · motion.js — pure logic behind the motion system and keyboard navigation (no DOM; Node-testable).
   · resolve()   motion level: full | calm | off  (user preference × OS "reduce motion")
   · Governor    frame-time watchdog: if animations make the UI drop frames, step the level down automatically
   · roving()    arrow-key index for tab lists (roving tabindex)
   · treeNav()   arrow-key behaviour for the project tree (up / down / expand / collapse / parent / first / last)
   · stagger()   capped entrance delay so long lists never wait more than a fraction of a second */
(function (G) {
  'use strict';
  const MO = {};
  MO.LEVELS = ['full', 'calm', 'off'];
  /* pref: 'auto' | 'full' | 'calm' | 'off'.  auto → follow the OS: reduce-motion → calm (fades only, no movement), otherwise full.
     An explicit 'full' still yields 'calm' when the OS asks for reduced motion — the OS setting is an accessibility need, not a taste. */
  MO.resolve = (pref, reduced) => { const p = MO.LEVELS.includes(pref) ? pref : 'auto'; if (p === 'off') return 'off'; if (reduced) return 'calm'; return p === 'calm' ? 'calm' : 'full'; };
  MO.step = lvl => (lvl === 'full' ? 'calm' : 'off');

  /* Governor: feed it frame durations (ms) measured while something animates.  Every `window` frames it looks at the average; `strikes`
     slow windows in a row (average above `slow` ms ≈ below ~30 fps) → degrade() says true once, then waits for the level to change. */
  MO.Governor = function (o) {
    o = o || {}; const win = o.window || 24, slow = o.slow || 33, strikes = o.strikes || 2; let n = 0, sum = 0, bad = 0, worst = 0;
    this.reset = () => { n = 0; sum = 0; bad = 0; worst = 0; };
    this.add = ms => { if (!(ms > 0) || ms > 1000) return false; n++; sum += ms; if (ms > worst) worst = ms;      // > 1 s = tab was in the background, not a slow frame
      if (n < win) return false; const avg = sum / n; n = 0; sum = 0; if (avg > slow) bad++; else bad = Math.max(0, bad - 1); if (bad >= strikes) { bad = 0; return true; } return false; };
    this.stats = () => ({ frames: n, worst });
  };

  /* roving tabindex: key → new index (or null when the key is not ours) */
  MO.roving = (count, cur, key, rtl) => {
    if (!(count > 0)) return null; const last = count - 1, next = rtl ? 'ArrowLeft' : 'ArrowRight', prev = rtl ? 'ArrowRight' : 'ArrowLeft';
    if (key === next) return cur >= last ? 0 : cur + 1; if (key === prev) return cur <= 0 ? last : cur - 1; if (key === 'Home') return 0; if (key === 'End') return last; return null;
  };

  /* project tree.  rows: [{ lv, open, kids }] in display order; cur: focused index (-1 = none).
     → { act: 'focus' | 'open' | 'close', idx } or null.  ArrowRight on a closed folder opens it, on an open one moves into its first child;
     ArrowLeft on an open folder closes it, otherwise moves to the parent row. */
  MO.treeNav = (rows, cur, key) => {
    const n = rows.length; if (!n) return null; if (cur < 0 || cur >= n) return ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key) ? { act: 'focus', idx: key === 'ArrowUp' || key === 'End' ? n - 1 : 0 } : null;
    const r = rows[cur];
    if (key === 'ArrowDown') return { act: 'focus', idx: Math.min(n - 1, cur + 1) }; if (key === 'ArrowUp') return { act: 'focus', idx: Math.max(0, cur - 1) };
    if (key === 'Home') return { act: 'focus', idx: 0 }; if (key === 'End') return { act: 'focus', idx: n - 1 };
    if (key === 'ArrowRight') { if (r.kids && !r.open) return { act: 'open', idx: cur }; if (r.kids && r.open && cur + 1 < n && rows[cur + 1].lv > r.lv) return { act: 'focus', idx: cur + 1 }; return null; }
    if (key === 'ArrowLeft') { if (r.kids && r.open) return { act: 'close', idx: cur }; for (let i = cur - 1; i >= 0; i--) if (rows[i].lv < r.lv) return { act: 'focus', idx: i }; return null; }
    return null;
  };

  MO.stagger = (i, n, step, cap) => Math.round(Math.min(cap == null ? 240 : cap, i * (step == null ? 24 : step)) * (n > 40 ? 0.5 : 1));

  G.ChipBenchMO = MO; if (G.ChipBench) G.ChipBench.MO = MO;
  if (typeof module !== 'undefined' && module.exports) module.exports = MO;
})(typeof window !== 'undefined' ? window : globalThis);
