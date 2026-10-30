/* ChipBench · diagnostics.js — timing probes + "诊断与性能报告" (1.7).
   The review asked for repeatable numbers (P95 input latency, peak memory, long tasks, switch times).  tests/t_perf17.py produces them in CI;
   this module produces the SAME numbers on the user's real machine: probes time the operations that matter, and the command exports a JSON
   report (errors, task table, cache sizes, module status, perf percentiles).  Nothing is sent anywhere. */
(function (G) {
  'use strict';
  const SL = G.ChipBench, RT = SL.rt, U = SL.U, A = SL.app, P = RT.perf;
  const wrap = (obj, key, name) => { if (obj && typeof obj[key] === 'function' && !obj[key].__probe) { const f = P.wrap(name, obj[key]); f.__probe = true; obj[key] = f; } };
  wrap(SL, 'openPath', 'open-file'); wrap(SL.ws, 'switchTo', 'ws-switch'); wrap(A, 'activate', 'tab-switch'); wrap(A, 'save', 'save'); wrap(SL.index, 'build', 'index-build'); wrap(A, 'setMode', 'mode-switch');
  RT.report_export = async () => {
    const d = RT.diagnostics(); d.env = { screen: screen.width + 'x' + screen.height, dpr: G.devicePixelRatio, cores: navigator.hardwareConcurrency, memGB: navigator.deviceMemory || null, native: !!SL.native };
    d.session = { tabs: A.tabs.length, workspace: SL.ws && SL.ws.cur ? { name: SL.ws.cur.name, roots: SL.ws.cur.roots.length } : null, indexDocs: SL.index && SL.index.docs ? SL.index.docs.size : null };
    const text = JSON.stringify(d, null, 2), stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    if (SL.native) { try { const dir = await SL.invoke('app_dir', { sub: 'diagnostics' }); await SL.fs.mkdir(dir).catch(() => { }); const f = dir + '\\chipbench-diagnostics-' + stamp + '.json'; await SL.fs.write(f, text); return { path: f, report: d }; } catch (e) { RT.report(e, '诊断报告', { toast: false }); } }
    return { path: null, text, report: d };
  };
  const line = (k, s) => s ? k + ' ' + s.n + ' 次 · 平均 ' + s.avg + ' · P95 ' + s.p95 + ' ms' : '';
  SL.cmd('app.diagnostics', '诊断与性能报告（导出 JSON：错误、耗时 P95、缓存、内存）…', async () => {
    const r = await RT.report_export(), rep = r.report.perf, sp = rep.spans;
    const body = U.h('div', null, '<div style="line-height:1.9"><div class="cap">本次运行（' + rep.uptimeSec + ' 秒）</div>' +
      ['open-file', 'ws-switch', 'tab-switch', 'save', 'mode-switch', 'index-build'].filter(k => sp[k]).map(k => '<div class="mono" style="font-size:12.5px">' + line(({ 'open-file': '打开文件', 'ws-switch': '切换项目', 'tab-switch': '切换标签', save: '保存', 'mode-switch': '切换模式', 'index-build': '建立索引' })[k], sp[k]) + '</div>').join('') +
      '<div class="mono" style="font-size:12.5px">输入延迟 P95 ' + rep.inputLatencyMs.p95 + ' ms（' + rep.inputLatencyMs.n + ' 次）· 长任务 ' + rep.longTasks.count + ' 个（最长 ' + rep.longTasks.maxMs + ' ms）' + (rep.memory ? ' · JS 堆 ' + rep.memory.usedMB + ' MB' : '') + '</div>' +
      '<div class="cap" style="margin-top:10px">已记录的错误：' + r.report.errors.length + ' 条 · 缓存：' + r.report.caches.length + ' 个 · 后台任务：' + r.report.tasks.length + ' 个</div>' +
      (r.path ? '<div class="muted" style="margin-top:8px;word-break:break-all">报告已保存：<span class="mono">' + U.esc(r.path) + '</span></div>' : '') + '</div>');
    SL.modal({ title: '诊断与性能报告', body, buttons: [r.path ? { t: '在文件夹中显示', fn: () => { SL.fs.reveal(r.path); return false; } } : { t: '复制报告', fn: () => { navigator.clipboard.writeText(r.text); SL.toast('已复制'); return false; } }, { t: '关闭', primary: true, v: null }] });
  }, { group: '应用' });
})(window);
