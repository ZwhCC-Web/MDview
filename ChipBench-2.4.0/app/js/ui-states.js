/* ChipBench · ui-states.js — one look for "loading / error / empty" (1.7).  1.6.1 showed a bare "正在打开…" and a dead-end "无法打开 + raw message".
   SL.ui.loading(t, el)      spinner + file name; after 6 s "仍在加载（大文件或网络盘）" with 关闭标签
   SL.ui.error(t, el, err)   plain-language title, what to try, actions: 重试 · 在文件夹中显示 · 用系统程序打开 · 复制错误信息 · 关闭标签
   SL.ui.empty(el, o)        icon + title + hint + buttons (o.actions: [{t, fn, primary}])
   SL.ui.friendly(err, path) → { title, hint, raw }  (pure, unit-tested) */
(function (G) {
  'use strict';
  const SL = G.ChipBench, U = SL.U, h = U.h, esc = U.esc, A = SL.app;
  const UI = SL.ui = SL.ui || {};
  const RULES = [
    [/not found|no such file|os error 2\b|os error 3\b|找不到|不存在|cannot find/i, '文件不存在或已被移动', '检查文件是否被重命名、移动或删除；项目里的引用可用“重新定位…”，也可以点“在文件夹中显示”看看目录。', '这个标签没有内容可显示；文件本身没有被改动。'],
    [/denied|拒绝访问|os error 5\b|permission|not permitted/i, '没有权限读取这个文件', '换一个有权限的账号，或把文件复制到自己的文件夹再打开。', '读不到内容；文件本身没有被改动。'],
    [/os error 32\b|used by another|being used|占用|sharing violation|locked/i, '文件正被其他程序占用', '关闭占用它的程序（Office、同步客户端等）后重试。', '暂时读不到最新内容；文件本身没有被改动。'],
    [/too large|out of memory|memory|太大|allocation/i, '文件太大，无法完整加载', '大文本 / 日志请用日志查看器打开；大表格可以先在原程序里拆分。', '为避免界面卡住，没有加载内容；文件本身没有被改动。'],
    [/password|encrypted|加密|口令/i, '文件已加密', '先在原程序里去掉密码，再用 ChipBench 打开。', '读不到内容；文件本身没有被改动。'],
    [/not a valid|invalid|corrupt|damaged|unexpected|malformed|bad zip|解析|损坏|不是有效/i, '文件格式有问题或已损坏', '换一份副本试试；如果是 Office 文件，可用原程序另存一份再打开。', '这个文件无法显示；ChipBench 不会修改它。'],
    [/network|timeout|timed out|unreachable|网络/i, '读取超时（网络盘或云同步文件夹）', '等同步完成，或把文件复制到本机后再打开。', '没有读到内容；文件本身没有被改动。'],
  ];
  /* every failure says: what happened (title) · what it means for you (impact) · what to do next (hint) */
  UI.friendly = (err, path) => { const raw = String(err && (err.message || err) || '未知错误'); const r = RULES.find(x => x[0].test(raw)); return r ? { title: r[1], hint: r[2], impact: r[3], raw } : { title: '无法打开这个文件', hint: '可以先重试；如果一直失败，复制下面的错误信息反馈给开发者。', impact: '这个标签暂时无法显示内容；文件本身没有被改动。', raw }; };
  const actions = list => '<div class="st-b">' + list.map((a, i) => '<button class="btn sm' + (a.primary ? ' primary' : '') + '" data-i="' + i + '">' + esc(a.t) + '</button>').join('') + '</div>';
  const bind = (el, list) => { const box = el.querySelector('.state'); if (!box) return; box.addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (b) { const a = list[+b.dataset.i]; if (a && a.fn) a.fn(); } }); };
  UI.empty = (el, o) => { o = o || {}; el.innerHTML = '<div class="state empty-s"><div class="st-ic">' + SL.icon(o.icon || 'file') + '</div><div class="st-t">' + esc(o.title || '这里还没有内容') + '</div>' + (o.msg ? '<div class="st-s muted">' + esc(o.msg) + '</div>' : '') + (o.actions && o.actions.length ? actions(o.actions) : '') + '</div>'; bind(el, o.actions || []); };
  UI.emptyHtml = SL.emptyHtml;   /* defined in core.js so that modules loaded before this one (the project tree) can use it */
  UI.loading = (t, el) => {
    el.innerHTML = '<div class="state loading"><div class="spin" aria-hidden="true"></div><div class="st-t">正在打开 ' + esc(t.name || '') + '…</div><div class="st-s muted"></div></div>';
    const box = el.querySelector('.state'), sub = el.querySelector('.st-s'); const timer = setTimeout(() => { if (!box.isConnected) return; sub.textContent = '仍在加载（大文件、网络盘或云同步文件夹会慢一些）。'; sub.insertAdjacentHTML('afterend', actions([{ t: '关闭标签' }])); box.querySelector('[data-i]').onclick = () => { const i = A.tabs.indexOf(t); if (i >= 0) A.close(i, true); }; }, 6000);
    return () => clearTimeout(timer);
  };
  UI.error = (t, el, err) => {
    const f = UI.friendly(err, t.path), idx = () => A.tabs.indexOf(t);
    const list = [
      { t: '重试', primary: true, fn: () => { if (SL.viewers && SL.viewers.dispose) SL.viewers.dispose(t); else { if (t.viewer && t.viewer.destroy) { try { t.viewer.destroy(); } catch (e) { } } t.viewer = null; } if (t.el) { t.el.remove(); t.el = null; } A.activate(idx(), true); } },
      t.path && SL.native ? { t: '在文件夹中显示', fn: () => SL.fs.reveal(t.path) } : null,
      t.path && SL.native ? { t: '用系统程序打开', fn: () => SL.invoke('open_path', { path: t.path }).catch(() => SL.toast('无法用系统程序打开', 3000, 'bad')) } : null,
      { t: '复制错误信息', fn: () => { navigator.clipboard.writeText((t.path || t.name || '') + '\n' + f.raw); SL.toast('已复制'); } },
      { t: '关闭标签', fn: () => { if (idx() >= 0) A.close(idx(), true); } },
    ].filter(Boolean);
    el.innerHTML = '<div class="state error-s"><div class="st-ic bad">' + SL.icon('x') + '</div><div class="st-t">' + esc(f.title) + '</div><div class="st-s muted">' + esc(t.name || '') + '</div><dl class="st-w"><dt>影响</dt><dd>' + esc(f.impact) + '</dd><dt>下一步</dt><dd>' + esc(f.hint) + '</dd></dl>' + actions(list) + '<details class="st-d"><summary>错误详情</summary><pre>' + esc(f.raw) + '</pre></details></div>';
    bind(el, list);
  };
})(window);
