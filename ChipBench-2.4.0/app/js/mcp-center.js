/* ChipBench · mcp-center.js — MCP connection center + AI activity (1.7).
   Why: 1.6.1 shipped a bare "copy this JSON" dialog.  AI clients could not start the server (`python` not on PATH / Store alias,
   aenet.py missing from the installer), AI edits were invisible in the app, and nothing could be undone.  Now:
     · 连接   detects Python, runs the server's --selftest, shows data folder / roots / who is connected / what is wrong
     · 配置   writes the client config with the ABSOLUTE interpreter path (Claude Desktop, VS Code, Cursor, this project, Claude Code)
     · 权限   read-only <-> read & write (enforced by the server; AI can also dry_run to preview a diff)
     · 活动   every change an AI made through MCP (diff, backup) — open, view diff, undo; open tabs / tree / index refresh by themselves
   The server writes <data>/mcp-activity.jsonl and <data>/mcp-session.json; the app polls them (2.5 s). */
(function (G) {
  'use strict';
  const SL = G.ChipBench, U = SL.U, fs = SL.fs, esc = U.esc, h = U.h, $ = U.$, A = SL.app;
  const MC = SL.mcp = { entries: [], session: null, unseen: 0, status: null, python: null };
  const OPS = { create: '新建', modify: '修改', mkdir: '新建文件夹' };
  const pad = n => String(n).padStart(2, '0');
  const clock = iso => { const d = new Date(iso); return isNaN(d) ? String(iso) : pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); };
  const sha1 = async u8 => { const d = await crypto.subtle.digest('SHA-1', u8); return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join(''); };
  const jsonOf = async p => { try { const r = await fs.read(p); return JSON.parse(r.text.replace(/^\uFEFF/, '')); } catch (e) { return null; } };
  const exists = async p => (await fs.kind(p)) === 'file';

  /* ---------------------------------------------------------------- environment */
  let dd = null; MC.dataDir = async () => dd || (dd = await SL.invoke('app_dir', {}).catch(() => ''));
  const dfile = async n => (await MC.dataDir()) + '\\' + n;
  MC.script = async () => SL.invoke('mcp_script_path').catch(() => '<安装目录>\\mcp\\chipbench_mcp.py');
  MC.detect = async force => { if (MC.python && !force) return MC.python; MC.python = await SL.invoke('detect_python').catch(() => []); return MC.python; };
  MC.entry = async () => { const py = (await MC.detect())[0], script = await MC.script(); return { command: py ? py.exe : 'python', args: [script], _py: py || null }; };
  MC.selftest = async () => { const py = (await MC.detect())[0]; if (!py) { MC.status = { ok: false, problems: ['没有找到 Python 3.8+'], noPython: true }; return MC.status; } try { MC.status = JSON.parse(await SL.invoke('mcp_selftest', { python: py.exe, script: await MC.script() })); } catch (e) { MC.status = { ok: false, problems: ['自检运行失败：' + String(e && e.message || e).slice(0, 400)] }; } return MC.status; };

  /* ---------------------------------------------------------------- client configs */
  const wrap = (key, e) => { const o = { command: e.command, args: e.args }; if (key === 'servers') o.type = 'stdio'; return o; };
  /* merge {key: {chipbench: ...}} into an existing JSON config; never overwrites a file that cannot be parsed (VS Code allows comments) */
  MC.writeConfig = async (path, key) => {
    const e = await MC.entry(); let obj = {}, had = await exists(path);
    if (had) { const txt = (await fs.read(path)).text.replace(/^\uFEFF/, ''); if (txt.trim()) { try { obj = JSON.parse(txt); } catch (er) { throw new Error('现有配置文件不是标准 JSON（可能含注释），为避免损坏没有改动：' + path); } } }
    if (typeof obj !== 'object' || Array.isArray(obj) || !obj) throw new Error('配置文件格式不对：' + path);
    obj[key] = obj[key] && typeof obj[key] === 'object' ? obj[key] : {}; obj[key].chipbench = wrap(key, e);
    if (had && !(await exists(path + '.chipbench-bak'))) await fs.write(path + '.chipbench-bak', (await fs.read(path)).text);
    await fs.mkdir(U.dir(path)).catch(() => { }); await fs.write(path, JSON.stringify(obj, null, 2) + '\n'); return e;
  };
  MC.isConfigured = async (path, key) => { const o = await jsonOf(path); const c = o && o[key] && o[key].chipbench; if (!c) return null; const e = await MC.entry(); return c.command === e.command && JSON.stringify(c.args) === JSON.stringify(e.args) ? 'ok' : 'stale'; };
  MC.snippet = async key => { const e = await MC.entry(); return JSON.stringify({ [key || 'mcpServers']: { chipbench: wrap(key || 'mcpServers', e) } }, null, 2); };
  MC.claudeCodeCmd = async () => { const e = await MC.entry(); const q = s => /\s/.test(s) ? '"' + s + '"' : s; return 'claude mcp add chipbench -- ' + q(e.command) + ' ' + q(e.args[0]); };

  /* ---------------------------------------------------------------- permission */
  MC.level = async () => { const o = await jsonOf(await dfile('mcp-config.json')); return o && o.level === 'read' ? 'read' : 'write'; };
  MC.setLevel = async lv => { const f = await dfile('mcp-config.json'), o = (await jsonOf(f)) || {}; o.level = lv; await fs.write(f, JSON.stringify(o, null, 2) + '\n'); };

  /* ---------------------------------------------------------------- activity feed */
  let lastSize = -1, baseline = false, seenId = null, undone = new Set(), sessT = 0;
  const parse = txt => txt.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(x => x && x.id);
  MC.poll = async () => {
    if (!SL.native) return;
    try {
      const f = await dfile('mcp-activity.jsonl'); let size = 0; try { size = await fs.size(f); } catch (e) { size = 0; }
      if (!baseline) { seenId = await SL.store.get('mcp.seen', null); undone = new Set(await SL.store.get('mcp.undone', [])); }
      if (size !== lastSize) {
        lastSize = size; const list = size ? parse((await fs.read(f)).text) : [];
        const known = new Set(MC.entries.map(x => x.id)); MC.entries = list;
        const fresh = baseline ? list.filter(x => !known.has(x.id)) : (seenId ? list.filter(x => x.id > seenId) : []);
        if (!baseline && !seenId && list.length) { seenId = list[list.length - 1].id; SL.store.set('mcp.seen', seenId); }
        baseline = true; if (fresh.length) onFresh(fresh);
        paint(); if (open_ && open_.tab === 'act') renderTab();
      }
      baseline = true;
      const sf = await dfile('mcp-session.json'); const m = await fs.mtime(sf).catch(() => 0);
      if (m !== sessT) { sessT = m; MC.session = m ? await jsonOf(sf) : null; paint(); }
    } catch (e) { SL.rt.report(e, 'MCP 活动', { toast: false, level: 'warn' }); }
  };
  const onFresh = list => {
    const files = list.filter(x => x.op !== 'mkdir'), paths = Array.from(new Set(list.map(x => x.path)));
    MC.unseen += list.length;
    const names = Array.from(new Set(files.map(x => U.base(x.path)))); const who = (list[list.length - 1].client || 'AI');
    SL.toast(who + ' 通过 MCP 改动了工作区：' + (names.slice(0, 3).join('、') || (list.length + ' 个文件夹')) + (names.length > 3 ? ' 等 ' + names.length + ' 个文件' : '') + '（状态栏 “AI” 可查看 / 撤销）', 5200);
    if (A && A.externalChanged) A.externalChanged(paths);          // reload open tabs, refresh index + tree even if the OS watcher missed it
    SL.emit('mcp-activity', list);
  };
  const markSeen = () => { const l = MC.entries; if (l.length) { seenId = l[l.length - 1].id; SL.store.set('mcp.seen', seenId); } MC.unseen = 0; paint(); };

  /* ---------------------------------------------------------------- status-bar badge */
  const badge = h('button', { type: 'button', id: 'st-ai', class: 'clk', title: 'MCP / AI 活动' });
  const anchor = $('#st-width') || $('#st-mode'); if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(badge, anchor.nextSibling);
  function paint() {
    const online = MC.session && Date.now() - new Date(MC.session.time).getTime() < 120000;
    badge.classList.toggle('on', !!(online || MC.unseen || MC.entries.length)); badge.classList.toggle('hot', MC.unseen > 0); badge.classList.toggle('live', !!online);
    badge.textContent = MC.unseen ? 'AI · ' + MC.unseen + ' 项改动' : (online ? 'AI ● ' + (MC.session.client || '已连接') : 'AI');
    badge.title = online ? (MC.session.client || 'AI 客户端') + ' 已通过 MCP 连接（' + (MC.session.level === 'read' ? '只读' : '读写') + '）。点击打开 MCP 中心' : 'MCP / AI 活动。点击打开 MCP 中心';
  }
  badge.addEventListener('click', () => MC.open(MC.unseen ? 'act' : 'conn'));

  /* ---------------------------------------------------------------- undo / diff */
  const diffHtml = d => '<pre class="mc-diff">' + String(d || '（没有记录差异）').split('\n').map(l => '<div class="' + (l.startsWith('+') && !l.startsWith('+++') ? 'add' : l.startsWith('-') && !l.startsWith('---') ? 'del' : l.startsWith('@@') ? 'hunk' : '') + '">' + (esc(l) || ' ') + '</div>').join('') + '</pre>';
  MC.showDiff = e => SL.modal({ title: '差异 · ' + (e.rel || U.base(e.path)) + '（' + clock(e.t) + '，' + (e.tool || '') + '）', wide: true, body: h('div', null, '<div class="muted" style="margin-bottom:8px">+' + (e.added || 0) + ' 行 / −' + (e.removed || 0) + ' 行</div>' + diffHtml(e.diff)), buttons: [{ t: '关闭', v: null }] });
  MC.undo = async e => {
    if (e.op === 'mkdir') return SL.toast('文件夹不提供撤销；需要时在项目树中删除');
    if (undone.has(e.id)) return SL.toast('这一条已经撤销过了');
    let now = null; try { now = await sha1(await fs.readBytes(e.path)); } catch (er) { now = null; }
    const changed = now !== e.after_hash;
    if (e.op === 'create') {
      if (now === null) return SL.toast('文件已经不存在');
      if (!(await SL.confirm('撤销新建：删除 “' + (e.rel || U.base(e.path)) + '”。' + (changed ? '\n\n注意：这个文件在 AI 创建之后又被修改过，删除会丢失那些修改（会先备份）。' : ''), '删除'))) return;
      if (changed) await SL.safe.backup(e.path, { force: true });
      await fs.rm(e.path); undone.add(e.id);
    } else {
      if (!e.backup || !(await exists(e.backup))) return SL.toast('找不到这次修改前的备份，无法撤销', 4000, 'bad');
      if (!(await SL.confirm('撤销修改：把 “' + (e.rel || U.base(e.path)) + '” 恢复到 AI 修改之前的内容。' + (changed ? '\n\n注意：文件在那次修改之后又变过，当前内容会先备份，再被覆盖。' : ''), '恢复'))) return;
      if (changed || now === null) await SL.safe.backup(e.path, { force: true });
      await fs.writeBytes(e.path, await fs.readBytes(e.backup)); undone.add(e.id);
    }
    await SL.store.set('mcp.undone', Array.from(undone)); if (A.externalChanged) A.externalChanged([e.path]); SL.toast('已撤销'); if (open_) renderTab();
  };

  /* ---------------------------------------------------------------- dialog */
  let open_ = null;
  const TABS = [['conn', '连接'], ['cfg', '配置'], ['perm', '权限'], ['act', '活动']];
  const row = (k, v) => '<div class="mc-row"><span class="mc-k">' + k + '</span><span class="mc-v">' + v + '</span></div>';
  const ok = t => '<span class="chip ok">✓</span> ' + t, bad = t => '<span class="chip bad">✗</span> ' + t, warn = t => '<span class="chip warn">!</span> ' + t;
  async function tabConn(box) {
    box.innerHTML = '<div class="muted">正在检测…</div>'; const py = await MC.detect(), script = await MC.script(), st = await MC.selftest();
    const L = [];
    L.push(row('Python', py.length ? ok('<span class="mono">' + esc(py[0].exe) + '</span> · ' + esc(py[0].version) + (py.length > 1 ? ' <span class="muted">（另有 ' + (py.length - 1) + ' 个）</span>' : '')) : bad('没有找到 Python 3.8+。请安装 Python 并勾选 “Add python.exe to PATH”，或设置环境变量 CHIPBENCH_PYTHON 后点“重新检测”')));
    L.push(row('MCP 脚本', '<span class="mono">' + esc(script) + '</span>'));
    if (st && st.version) {
      L.push(row('服务器自检', st.ok ? ok('版本 ' + esc(st.version) + ' · ' + st.tools + ' 个工具（' + st.write_tools + ' 个会写入）') : bad('自检未通过')));
      L.push(row('数据目录', '<span class="mono">' + esc(st.data_dir) + '</span>'));
      L.push(row('ChipBench 状态', st.app_running ? ok('正在运行（状态文件 ' + st.state_age_seconds + ' 秒前更新）') : warn(st.state_exists ? 'ChipBench 似乎没有在运行（状态文件 ' + st.state_age_seconds + ' 秒前）' : '还没有状态文件；先保持 ChipBench 运行')));
      L.push(row('工作区根目录', (st.roots || []).map(r => '<div class="mono">' + esc(r) + '</div>').join('') + '<div class="muted">来源：' + esc(st.roots_source) + ' · 随 ChipBench 里打开的项目自动切换，无需重启 AI 客户端</div>'));
      L.push(row('以太网工具', st.ethernet_tools === true ? ok('可用') : bad('缺少 aenet.py：' + esc(String(st.ethernet_tools)))));
      L.push(row('权限', st.level === 'read' ? warn('只读：AI 不能写入') : ok('读写：写入前自动备份，可撤销')));
    } else if (st && st.problems) L.push(row('服务器自检', bad(esc(st.problems.join('；')))));
    const s = MC.session, online = s && Date.now() - new Date(s.time).getTime() < 120000;
    L.push(row('AI 客户端', s ? (online ? ok('<b>' + esc(s.client || '未知客户端') + '</b> 已连接（' + clock(s.time) + '）') : warn('最近一次：' + esc(s.client || '未知客户端') + '，' + clock(s.time) + '，现已断开')) : '<span class="muted">还没有 AI 客户端连接过。到“配置”页写入配置，然后在 AI 客户端里重启 / 刷新 MCP</span>'));
    if (st && st.problems && st.problems.length && st.version) L.push('<div class="mc-prob">' + st.problems.map(p => '<div>' + warn(esc(p)) + '</div>').join('') + '</div>');
    box.innerHTML = L.join('') + '<div class="mc-btns"><button class="btn primary sm" data-a="retest">重新检测并测试</button></div>';
  }
  async function tabCfg(box) {
    box.innerHTML = '<div class="muted">读取中…</div>'; const e = await MC.entry(), cl = await SL.invoke('mcp_clients').catch(() => []), root = SL.ws && SL.ws.cur && SL.ws.cur.roots[0];
    const rows = [];
    for (const c of cl) { const st = await MC.isConfigured(c.path, c.key); rows.push('<div class="mc-cli"><div><b>' + esc(c.name) + '</b><div class="mono muted">' + esc(c.path) + '</div></div><div>' + (st === 'ok' ? '<span class="chip ok">已配置</span> ' : st === 'stale' ? '<span class="chip warn">路径已变</span> ' : '') + '<button class="btn sm" data-a="write" data-id="' + esc(c.id) + '">' + (st ? '更新' : '写入') + '</button></div></div>'); }
    if (root) { const vs = root.path + '\\.vscode\\mcp.json'; const st = await MC.isConfigured(vs, 'servers'); rows.push('<div class="mc-cli"><div><b>当前项目（' + esc(root.name) + '）</b><div class="muted">写入 <span class="mono">.vscode\\mcp.json</span> 和 <span class="mono">.mcp.json</span>：在这个文件夹里打开 VS Code / Claude Code 时自动发现，无需全局配置</div></div><div>' + (st === 'ok' ? '<span class="chip ok">已配置</span> ' : '') + '<button class="btn sm" data-a="write" data-id="project">' + (st ? '更新' : '写入') + '</button></div></div>'); }
    rows.push('<div class="mc-cli"><div><b>Claude Code（命令行）</b><div class="mono muted" style="word-break:break-all">' + esc(await MC.claudeCodeCmd()) + '</div></div><div><button class="btn sm" data-a="copycc">复制命令</button></div></div>');
    box.innerHTML = '<p class="muted" style="margin:0 0 10px;line-height:1.7">配置里写的是 <b>解释器的完整路径</b>（' + (e._py ? '<span class="mono">' + esc(e.command) + '</span>' : '<span style="color:var(--bad)">没有检测到 Python，暂用 python</span>') + '），不依赖 PATH。写入前会把原文件备份为 <span class="mono">.chipbench-bak</span>，并保留你已有的其他 MCP 服务器。写完后请在 AI 客户端里重启或刷新 MCP。</p>' + rows.join('') + '<div class="cap" style="margin:14px 0 6px">通用 JSON（其他客户端）</div><pre class="mc-pre" id="mc-snip">' + esc(await MC.snippet('mcpServers')) + '</pre><div class="mc-btns"><button class="btn sm" data-a="copysnip">复制 JSON</button></div>';
  }
  async function tabPerm(box) {
    const lv = await MC.level();
    box.innerHTML = '<p class="muted" style="margin:0 0 10px;line-height:1.7">由 MCP 服务器强制执行，对所有 AI 客户端生效，下一次调用立即生效。</p>' +
      ['write', 'read'].map(k => '<label class="mc-opt"><input type="radio" name="lv" value="' + k + '"' + (lv === k ? ' checked' : '') + '><div><b>' + (k === 'write' ? '读写（默认）' : '只读') + '</b><div class="muted">' + (k === 'write' ? 'AI 可以新建 / 改写工作区内的文件和文件夹。每次写入前自动备份，所有改动记录在“活动”页，可查看差异并撤销。AI 还可以先用 dry_run 预览差异。' : 'AI 只能搜索、读取、分析；任何写入都会被拒绝并说明原因。适合只想让 AI 查资料的场景。') + '</div></div></label>').join('') +
      '<div class="muted" style="margin-top:10px;line-height:1.7">写入范围始终限定在当前项目的文件夹内。</div>';
  }
  async function tabAct(box) {
    markSeen(); const L = MC.entries.slice().reverse().slice(0, 100);
    if (!L.length) { box.innerHTML = '<div class="muted" style="padding:18px 4px;line-height:1.8">还没有 AI 通过 MCP 改动过工作区。<br>AI 每次新建 / 修改文件都会出现在这里，可以查看差异、一键撤销。</div>'; return; }
    box.innerHTML = '<div class="mc-act">' + L.map((e, i) => '<div class="mc-ev' + (undone.has(e.id) ? ' undone' : '') + '"><span class="mc-t mono">' + esc(clock(e.t)) + '</span><span class="chip ' + (e.op === 'create' ? 'ok' : e.op === 'mkdir' ? '' : 'warn') + '">' + (OPS[e.op] || esc(e.op)) + '</span><span class="mc-p" title="' + esc(e.path) + '">' + esc(e.rel || U.base(e.path)) + '<small class="muted"> · ' + esc(e.client || 'AI') + ' · ' + esc(e.tool || '') + '</small></span><span class="mc-n mono">' + (e.op === 'mkdir' ? '' : '<i class="a">+' + (e.added || 0) + '</i> <i class="d">−' + (e.removed || 0) + '</i>') + '</span><span class="mc-b">' + (e.op !== 'mkdir' ? '<button class="btn ghost sm" data-a="diff" data-i="' + i + '">差异</button>' : '') + (e.op !== 'mkdir' && !undone.has(e.id) ? '<button class="btn ghost sm" data-a="undo" data-i="' + i + '">撤销</button>' : '') + (e.op !== 'mkdir' ? '<button class="btn ghost sm" data-a="open" data-i="' + i + '">打开</button>' : '') + '</span></div>').join('') + '</div>';
    box._list = L;
  }
  async function renderTab() { if (!open_) return; const { box, head } = open_; head.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.t === open_.tab)); try { await ({ conn: tabConn, cfg: tabCfg, perm: tabPerm, act: tabAct })[open_.tab](box); } catch (e) { box.innerHTML = '<div class="mc-prob">' + bad(esc(String(e && e.message || e))) + '</div>'; } }
  MC.open = async tab => {
    const head = h('div', { class: 'mc-tabs' }, TABS.map(([k, t]) => '<button data-t="' + k + '">' + t + (k === 'act' && MC.unseen ? ' <i class="mc-dot">' + MC.unseen + '</i>' : '') + '</button>').join('')), box = h('div', { class: 'mc-box' });
    const root = h('div', { class: 'mc' }, ''); root.appendChild(head); root.appendChild(box); open_ = { tab: tab || 'conn', box, head };
    head.addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (b) { open_.tab = b.dataset.t; renderTab(); } });
    root.addEventListener('change', async e => { if (e.target.name === 'lv') { try { await MC.setLevel(e.target.value); SL.toast(e.target.value === 'read' ? '已切换为只读：AI 不能写入' : '已切换为读写'); } catch (er) { SL.fail('保存', er, { impact: '配置文件没有改动。' }); } } });
    root.addEventListener('click', async e => {
      const b = e.target.closest('[data-a]'); if (!b) return; const a = b.dataset.a;
      try {
        if (a === 'retest') { await MC.detect(true); return renderTab(); }
        if (a === 'copycc') { await navigator.clipboard.writeText(await MC.claudeCodeCmd()); return SL.toast('已复制，在终端里运行即可'); }
        if (a === 'copysnip') { await navigator.clipboard.writeText(await MC.snippet('mcpServers')); return SL.toast('已复制'); }
        if (a === 'write') {
          const id = b.dataset.id;
          if (id === 'project') { const r = SL.ws.cur.roots[0].path; await MC.writeConfig(r + '\\.vscode\\mcp.json', 'servers'); await MC.writeConfig(r + '\\.mcp.json', 'mcpServers'); SL.toast('已写入当前项目：.vscode\\mcp.json、.mcp.json'); }
          else { const c = (await SL.invoke('mcp_clients')).find(x => x.id === id); await MC.writeConfig(c.path, c.key); SL.toast('已写入 ' + c.name + ' 的配置，请重启该客户端或刷新 MCP'); }
          return renderTab();
        }
        const ent = (box._list || [])[+b.dataset.i]; if (!ent) return;
        if (a === 'diff') return MC.showDiff(ent); if (a === 'undo') return MC.undo(ent); if (a === 'open') return SL.openPath(ent.path);
      } catch (er) { SL.toast(String(er && er.message || er), 5000, 'bad'); }
    });
    SL.modal({ title: 'MCP 连接中心 · 让 AI 读写你的工作区', wide: true, body: root, buttons: [{ t: '关闭', v: null }] }).then(() => { open_ = null; });
    renderTab();
  };
  SL.cmd('mcp.info', 'MCP 连接中心（让 Claude / Copilot / Cursor 读写你的工作区）…', () => MC.open('conn'), { group: 'AI', icon: 'ai' });
  SL.cmd('mcp.center', 'MCP 连接中心…', () => MC.open('conn'), { group: 'AI', icon: 'ai' });
  SL.cmd('mcp.activity', 'AI 改动记录（查看差异 / 撤销）…', () => MC.open('act'), { group: 'AI', icon: 'ai' });
  SL.cmd('mcp.perm', 'MCP 权限：只读 / 读写…', () => MC.open('perm'), { group: 'AI' });
  if (SL.native) { setTimeout(MC.poll, 2500); setInterval(MC.poll, 2500); }
})(window);
