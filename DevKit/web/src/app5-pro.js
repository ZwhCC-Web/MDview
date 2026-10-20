  /* ================= part 5: tasks, templates, AI assistant, MCP, Word / PowerPoint / Outlook export ================= */

  /* ---------------- tasks (aggregated "- [ ]" items with 📅 due dates) ---------------- */
  const TASK_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+\[([ xX])\]\s+(.*)$/;
  function parseTasks(text, file) {
    const out = []; const lines = text.split('\n'); let fence = false;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (/^\s*(```|~~~)/.test(l)) { fence = !fence; continue; }
      if (fence) continue;
      const m = l.match(TASK_RE); if (!m) continue;
      let t = m[3];
      const dm = t.match(/(?:📅\s?|@|due:)(\d{4}-\d{2}-\d{2})/);
      const pri = /(🔺|⏫|!!|#紧急|#urgent)/i.test(t);
      t = t.replace(/(?:📅\s?|@|due:)\d{4}-\d{2}-\d{2}/g, '').replace(/(🔺|⏫|!!)/g, '').trim();
      out.push({ file, line: i, raw: l, text: t, done: m[2] !== ' ', due: dm ? dm[1] : '', pri });
    }
    return out;
  }
  const TK = { items: [], busy: false };
  async function refreshTasks() {
    if (TK.busy) return; TK.busy = true;
    try {
      const items = [];
      const openText = key => { const ti = S.tabs.findIndex((t, i) => { const p = i === S.cur ? S.filePath : t.path; return p && p.join('/') === key; }); return ti < 0 ? null : (ti === S.cur ? S.src : S.tabs[ti].src); };
      if (S.dirHandle && S.treeFiles.length) {
        for (const f of S.treeFiles) {
          const key = f.path.join('/'); let text = openText(key);
          if (text == null) { try { const file = await f.handle.getFile(); if (file.size > 3e6) continue; text = (await readFileText(file)).text; } catch (e) { continue; } }
          if (text.indexOf('[') < 0) continue;
          items.push(...parseTasks(text, { name: f.name, path: f.path, handle: f.handle, key }));
        }
      } else items.push(...parseTasks(S.src, { name: S.fileName, cur: true }));
      TK.items = items; renderTasks();
    } finally { TK.busy = false; }
  }
  const tasksTouch = debounce(() => { if ($('#pane-tasks').classList.contains('active')) refreshTasks(); }, 1500);
  function renderTasks() {
    const box = $('#tk-list'); const q = $('#tk-filter').value.trim().toLowerCase(); const showDone = $('#tk-done').checked;
    const td = today(), wk = today(new Date(Date.now() + 7 * 864e5));
    const list = TK.items.filter(t => (showDone || !t.done) && (!q || (t.text + ' ' + t.file.name).toLowerCase().includes(q)));
    if (!TK.items.length) { box.innerHTML = '<div class="side-empty">没有待办。<br>在任意文档中写 <code>- [ ] 事项 📅 ' + td + '</code> 即可在这里汇总' + (S.dirHandle ? '' : '（打开文件夹后汇总整个文件夹）') + '。<br>行首输入 <code>/db</code> 可快速插入。</div>'; return; }
    const groups = [['over', '已逾期'], ['today', '今天'], ['week', '7 天内'], ['later', '以后'], ['none', '无日期'], ['done', '已完成']];
    const gOf = t => t.done ? 'done' : !t.due ? 'none' : t.due < td ? 'over' : t.due === td ? 'today' : t.due <= wk ? 'week' : 'later';
    const by = {}; list.forEach(t => (by[gOf(t)] = by[gOf(t)] || []).push(t));
    TK.view = []; let h = '';
    for (const [g, name] of groups) {
      const arr = by[g]; if (!arr || !arr.length) continue;
      arr.sort((a, b) => (b.pri - a.pri) || (a.due || '9').localeCompare(b.due || '9'));
      h += '<div class="tk-grp ' + g + '"><span>' + name + '</span><span>' + arr.length + '</span></div>';
      for (const t of arr) {
        const k = TK.view.push(t) - 1;
        const dcls = t.done ? '' : t.due < td ? ' over' : t.due === td ? ' today' : '';
        h += '<div class="tk-it' + (t.done ? ' done' : '') + '" data-k="' + k + '"><input type="checkbox"' + (t.done ? ' checked' : '') + '><span class="tx">' + (t.pri ? '<span class="pri">!</span>' : '') + MD.inline(t.text || '（空）').replace(/<a\b[^>]*>|<\/a>/g, '') + '<span class="meta">' + esc(t.file.name.replace(/\.md$/i, '')) + ' · 行 ' + (t.line + 1) + (t.due ? ' · <span class="dd' + dcls + '">' + t.due + '</span>' : '') + '</span></span></div>';
      }
    }
    box.innerHTML = h || '<div class="sr-sum">没有匹配的待办</div>';
  }
  $('#tk-filter').addEventListener('input', renderTasks);
  $('#tk-done').addEventListener('change', renderTasks);
  $('#tk-refresh').addEventListener('click', refreshTasks);
  $('#tk-list').addEventListener('click', async e => {
    const it = e.target.closest('.tk-it'); if (!it) return; const t = TK.view[+it.dataset.k]; if (!t) return;
    if (e.target.tagName === 'INPUT') { e.preventDefault(); await toggleTaskAt(t); return; }
    if (t.file.cur) jumpToLine(t.line); else openHandle(t.file.handle, t.file.path, t.line);
  });
  async function toggleTaskAt(t) {
    const flip = l => l.replace(/\[([ xX])\]/, (m, c) => c === ' ' ? '[x]' : '[ ]');
    const fix = text => { const ls = text.split('\n'); let i = ls[t.line] === t.raw ? t.line : ls.indexOf(t.raw); if (i < 0) return null; ls[i] = flip(ls[i]); return ls.join('\n'); };
    const isCur = t.file.cur || (S.filePath && t.file.key === S.filePath.join('/'));
    if (isCur) { if (S.editing) commit(); const n = fix(S.src); if (n == null) return toast('该行已变化，请刷新'); setSrc(n); }
    else {
      const ti = S.tabs.findIndex(x => x.path && x.path.join('/') === t.file.key);
      if (ti >= 0) { const n = fix(S.tabs[ti].src); if (n == null) return toast('该行已变化，请刷新'); S.tabs[ti].src = n; S.tabs[ti].dirty = true; renderTabs(); }
      else { const f = await t.file.handle.getFile(); const r = await readFileText(f); const n = fix(r.text); if (n == null) return toast('该行已变化，请刷新'); const w = await t.file.handle.createWritable(NATIVE && r.encoding !== 'UTF-8' ? { encoding: r.encoding } : undefined); await w.write(n); await w.close(); }
    }
    toast(t.done ? '已标记为未完成' : '已完成 ✓'); refreshTasks();
  }

  /* ---------------- templates & daily note ---------------- */
  const isoWeek = d => { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil(((t - y) / 864e5 + 1) / 7); };
  function fillTpl(s, title) {
    const d = new Date(); const W = ['日', '一', '二', '三', '四', '五', '六'];
    return s.replace(/\{\{\s*(date|time|title|week|weekday|year|date\+(\d+))\s*\}\}/g, (m, k, n) => k === 'date' ? today(d) : k === 'time' ? d.toTimeString().slice(0, 5) : k === 'title' ? title : k === 'week' ? String(isoWeek(d)) : k === 'weekday' ? '星期' + W[d.getDay()] : k === 'year' ? String(d.getFullYear()) : today(new Date(Date.now() + n * 864e5)));
  }
  const TEMPLATES = [
    { id: 'minutes', name: '会议纪要', desc: '议题 · 要点 · 决议 · 带截止日期的行动项', title: '{{date}} 会议纪要', body: '# {{title}}\n\n| 项目 | 内容 |\n| --- | --- |\n| 时间 | {{date}} {{time}} |\n| 方式 | Teams / 会议室 |\n| 参会人 |  |\n| 记录人 |  |\n\n## 议题\n\n1. \n\n## 讨论要点\n\n- \n\n## 决议\n\n- \n\n## 行动项\n\n- [ ] 事项 @负责人 📅 {{date+7}}\n' },
    { id: 'weekly', name: '周报', desc: '本周完成 · 进行中 · 风险 · 下周计划', title: '{{year}}-W{{week}} 周报', body: '# {{title}}\n\n> 汇报周期：{{year}} 年第 {{week}} 周（截至 {{date}}）\n\n## 本周完成\n\n- \n\n## 进行中\n\n| 事项 | 进度 | 预计完成 | 备注 |\n| --- | :-: | --- | --- |\n|  | 50% |  |  |\n\n## 风险与需要的支持\n\n> [!WARNING]\n> \n\n## 下周计划\n\n- [ ] \n' },
    { id: 'issue', name: '客户问题跟踪（FAE）', desc: '现象 · 复现条件 · 分析 · 根因 · 对策 · 时间线', title: '客户问题-{{date}}', body: '# {{title}}\n\n| 字段 | 内容 |\n| --- | --- |\n| 客户 / 项目 |  |\n| 芯片型号 / 版本 |  |\n| 开发板 / 软件版本 |  |\n| 优先级 | 高 / 中 / 低 |\n| 状态 | 调查中 |\n| 提出日期 | {{date}} |\n\n## 现象\n\n\n\n## 复现条件\n\n1. \n\n## 分析过程\n\n```c\n// 关键寄存器 / 日志\n```\n\n## 根因\n\n\n\n## 对策与验证\n\n- [ ] 临时对策 📅 {{date+3}}\n- [ ] 根本对策 📅 {{date+14}}\n\n## 时间线\n\n- {{date}}：收到问题\n' },
    { id: 'sample', name: '样品申请 / 物流跟踪', desc: '料号 · 版本 · 封装 · 数量 · PO/FOC · 寄送进度', title: '样品申请-{{date}}', body: '# {{title}}\n\n## 申请明细\n\n| 料号 (OPN) | 版本 | 封装 | 数量 | 用途 | 付费方式 | 状态 |\n| --- | :-: | :-: | --: | --- | :-: | :-: |\n|  | CS | LQFP |  | 开发板 | PO / FOC | 申请中 |\n\n## 进度\n\n- [ ] 填写申请表并提交 📅 {{date+1}}\n- [ ] 主管审批 📅 {{date+3}}\n- [ ] 确认交期 / 出货\n- [ ] 寄件（运单号：）\n- [ ] 客户签收\n\n## 收件信息\n\n| 项目 | 内容 |\n| --- | --- |\n| 收件人 |  |\n| 公司 / 地址 |  |\n| 电话 |  |\n\n## 备注\n\n'},
    { id: 'eval', name: '芯片评估笔记', desc: '基本信息 · 检查清单 · 测试记录 · 结论', title: '芯片评估-{{date}}', body: '# {{title}}\n\n| 项目 | 内容 |\n| --- | --- |\n| 型号 |  |\n| 版本 (ES/CS) |  |\n| 封装 |  |\n| 工具链 / IDE |  |\n\n## 检查清单\n\n- [ ] 电源 / 复位\n- [ ] 时钟配置\n- [ ] 调试连接（E2 / J-Link）\n- [ ] 关键外设（ADC / PWM / CAN / Ethernet）\n- [ ] 功耗\n\n## 测试记录\n\n| 测试项 | 条件 | 结果 | 结论 |\n| --- | --- | --- | :-: |\n|  |  |  | ✅ |\n\n## 时序\n\n```wavedrom\n{ signal: [ { name: "clk", wave: "p....." }, { name: "data", wave: "x.34.x", data: ["A","B"] } ] }\n```\n\n## 结论\n\n' },
    { id: 'talk', name: '培训讲稿（幻灯片）', desc: '--- 分页，可演示、导出 PPTX，注释写演讲者备注', title: '技术培训', body: '# {{title}}\n\n{{date}} · 讲师：\n\n<!-- notes: 开场，介绍背景与目标 -->\n\n---\n\n## 背景\n\n- 要点一\n- 要点二\n- 要点三\n\n<!-- notes: 这一页的讲稿写在这里 -->\n\n---\n\n## 方案\n\n| 项目 | 方案 A | 方案 B |\n| --- | --- | --- |\n| 性能 |  |  |\n| 成本 |  |  |\n\n---\n\n## 总结\n\n- \n' },
    { id: 'mail', name: '邮件草稿', desc: '写完用「导出 → Outlook 邮件草稿」直接打开', title: '邮件草稿', body: '# 主题：\n\nXX 様 / 您好，\n\n感谢您的支持。\n\n## 事项\n\n1. \n\n## 需要确认\n\n- \n\n以上，请确认。\n\n---\n\n此致\n' },
    { id: 'review', name: '技术方案评审', desc: '背景 · 需求 · 方案对比 · 风险 · 结论', title: '方案评审-{{date}}', body: '# {{title}}\n\n## 背景与目标\n\n\n\n## 需求\n\n| 编号 | 需求 | 优先级 |\n| --- | --- | :-: |\n| R1 |  | 高 |\n\n## 方案对比\n\n| 维度 | 方案 A | 方案 B |\n| --- | --- | --- |\n| 实现难度 |  |  |\n| 性能 |  |  |\n| 成本 |  |  |\n\n```mermaid\ngraph LR\n  A[需求] --> B{方案选择}\n  B --> C[方案 A]\n  B --> D[方案 B]\n```\n\n## 风险\n\n> [!CAUTION]\n> \n\n## 结论与行动项\n\n- [ ] 📅 {{date+7}}\n' },
    { id: 'blank', name: '空白文档', desc: '只有一个标题', title: '新建文档', body: '# {{title}}\n\n' }
  ];
  const DAILY_TPL = '# {{date}} 工作日志（{{weekday}}）\n\n## 今日重点\n\n- [ ] 📅 {{date}}\n\n## 记录\n\n- \n\n## 明日计划\n\n- [ ] 📅 {{date+1}}\n';
  async function userTemplates() {
    if (!S.dirHandle) return [];
    const out = [];
    for (const dn of ['templates', '模板', 'Templates']) {
      try {
        const d = await S.dirHandle.getDirectoryHandle(dn);
        for await (const [name, h] of d.entries()) if (h.kind === 'file' && MD_EXT.test(name)) { const r = await readFileText(await h.getFile()); out.push({ id: 'u:' + name, name: name.replace(MD_EXT, ''), desc: dn + '/' + name, title: name.replace(MD_EXT, '') + '-{{date}}', body: r.text, user: true }); }
      } catch (e) { }
    }
    return out;
  }
  async function showTemplates(where) {
    const list = TEMPLATES.concat(await userTemplates());
    modal('<h3>从模板新建</h3><div class="tpl-grid">' + list.map((t, i) => '<div class="tpl" data-i="' + i + '"><b>' + esc(t.name) + '</b><small>' + esc(t.desc) + '</small></div>').join('') + '</div><p class="hint" style="margin-bottom:0">在已打开文件夹的 <code>templates/</code> 或 <code>模板/</code> 子目录中放入 .md 文件即可作为自定义模板；支持变量 <code>{{date}}</code> <code>{{time}}</code> <code>{{title}}</code> <code>{{week}}</code> <code>{{weekday}}</code> <code>{{date+7}}</code>。</p>', true);
    $('#modal-body').style.height = 'auto';
    $$('.tpl').forEach(el => el.onclick = async () => {
      const t = list[+el.dataset.i]; $('#modal').classList.remove('show');
      const title = prompt('文档标题 / 文件名：', fillTpl(t.title, '')); if (title == null) return;
      const body = fillTpl(t.body, title);
      const dir = where && where.dir ? where : S.dirHandle ? await curDirOf() : null;
      if (dir) await createFileIn(dir.dir, dir.path, title.replace(/[\\/:*?"<>|]/g, '_'), body);
      else newTab(body, title + '.md');
    });
  }
  async function curDirOf() {
    if (!S.dirHandle) return null;
    let h = S.dirHandle, p = [];
    if (S.filePath && S.filePath.length > 1) { try { for (const x of S.filePath.slice(0, -1)) h = await h.getDirectoryHandle(x); p = S.filePath.slice(0, -1); } catch (e) { h = S.dirHandle; p = []; } }
    return { dir: h, path: p };
  }
  async function dailyNote() {
    const name = today() + '.md';
    let tpl = DAILY_TPL;
    const ut = (await userTemplates()).find(t => /日志|daily|journal/i.test(t.name)); if (ut) tpl = ut.body;
    if (!S.dirHandle) { newTab(fillTpl(tpl, today()), name); toast('未打开文件夹：日志已在新标签中创建（保存时选择位置）'); return; }
    try {
      const dir = await S.dirHandle.getDirectoryHandle('日志', { create: true });
      try { const fh = await dir.getFileHandle(name); return openHandle(fh, ['日志', name]); } catch (e) { }
      await createFileIn(dir, ['日志'], name, fillTpl(tpl, today()));
    } catch (e) { toast('创建日志失败：' + (e.message || e)); }
  }

  /* ---------------- AI assistant (OpenAI-compatible / Azure OpenAI / Ollama) ---------------- */
  const AI_DEF = { provider: 'openai', base: 'https://api.openai.com/v1', key: '', model: 'gpt-4o-mini', deployment: '', apiVersion: '2024-06-01', temperature: 0.4, maxChars: 60000, system: '' };
  const aiCfg = () => Object.assign({}, AI_DEF, JSON.parse(localStorage.getItem(LS + 'ai') || '{}'));
  const aiReady = () => { const c = aiCfg(); return c.provider === 'ollama' ? !!c.base : c.provider === 'azure' ? !!(c.base && c.key && c.deployment) : !!(c.base && (c.key || /localhost|127\.0\.0\.1/.test(c.base))); };
  const AI = { msgs: [], busy: null, target: null };
  const SYS = '你是 MDView（Markdown 编辑器）内置的写作助手。用户主要是半导体 / 嵌入式领域的应用工程师（FAE），常写技术文档、邮件、会议纪要和培训材料。\n规则：1) 输出使用 Markdown；2) 需要改写或生成内容时，只输出结果本身，不要额外解释或寒暄；3) 保留专业术语、型号、数字、代码与链接原样；4) 除非要求翻译，否则使用与原文相同的语言。';
  const QUICK = {
    polish: { label: '润色', scope: 'sel', p: '请润色下面的文字，使表达更专业、清晰、通顺，保持原意、术语和 Markdown 格式：' },
    shorten: { label: '精简', scope: 'sel', p: '请在不丢失关键信息的前提下精简下面的文字，保持 Markdown 格式：' },
    continue: { label: '续写', scope: 'sel', p: '请根据下面的内容自然地续写下一段（约 150 字），风格保持一致，只输出续写部分：' },
    en: { label: '译为英文', scope: 'sel', p: 'Translate the following into professional English. Keep Markdown formatting, technical terms, part numbers and code unchanged:' },
    zh: { label: '译为中文', scope: 'sel', p: '请把下面的内容翻译成专业、自然的简体中文，保留 Markdown 格式、术语、型号与代码：' },
    ja: { label: '译为日文', scope: 'sel', p: '以下の内容を、ビジネスに適した自然な日本語に翻訳してください。Markdown の書式、専門用語、型番、コードはそのまま残してください：' },
    summary: { label: '总结要点', scope: 'doc', p: '请用 3–7 条要点总结下面的文档，最后给出一句话结论：' },
    minutes: { label: '会议纪要', scope: 'doc', p: '请把下面的记录整理成会议纪要，包含：议题、讨论要点、决议、行动项。行动项使用待办格式“- [ ] 事项 @负责人 📅 YYYY-MM-DD”（日期不确定时留空）：' },
    email: { label: '起草邮件', scope: 'doc', p: '请根据下面的内容起草一封专业的商务邮件：第一行用“# 主题：…”，然后是称呼、正文（要点清晰，必要时用列表或表格）、结尾敬语。语言与原文一致：' },
    slides: { label: '幻灯片大纲', scope: 'doc', p: '请根据下面的内容生成培训/汇报用的幻灯片 Markdown：第一页为标题页（# 标题 + 一行副标题）；之后每页用单独一行 --- 分隔（--- 前后各空一行），每页一个 ## 标题和 3–5 条精炼要点；每页末尾用 <!-- notes: 讲稿 --> 写 2–3 句演讲者备注：' },
    explain: { label: '解释代码', scope: 'sel', p: '请解释下面的代码或寄存器配置的作用，指出潜在问题，并给出改进建议：' },
    table: { label: '整理成表格', scope: 'sel', p: '请把下面的内容整理成 Markdown 表格（选择合适的列），只输出表格：' }
  };
  function aiInit() {
    $('#ai-chips').innerHTML = ['polish', 'shorten', 'en', 'zh', 'ja', 'summary', 'minutes', 'email', 'slides', 'table', 'explain'].map(k => '<button class="ai-chip" data-q="' + k + '">' + QUICK[k].label + '</button>').join('');
    $('#ai-chips').onclick = e => { const b = e.target.closest('[data-q]'); if (b) aiQuick(b.dataset.q); };
    $('#ai-send').onclick = () => AI.busy ? AI.busy.abort() : aiSend();
    $('#ai-q').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !composing(e)) { e.preventDefault(); aiSend(); } });
    $('#ai-clear').onclick = () => { AI.msgs = []; aiDraw(); };
    $('#ai-msgs').addEventListener('click', aiAct);
    aiDraw();
  }
  function aiOpenPanel(focus) {
    const open = !app.classList.contains('ai-open') || focus;
    app.classList.toggle('ai-open', open); $('#btn-ai').classList.toggle('on', open);
    if (open) { captureAiTarget(); aiDraw(); setTimeout(() => $('#ai-q').focus(), 30); }
  }
  /* what the AI should work on: selection → current block / source paragraph → nothing */
  function captureAiTarget() {
    let t = null;
    const ed = S.editing ? S.editing.ta : (S.mode !== 'live' && srcEd && edFocused(srcEd) ? srcEd : null);
    if (ed && ed.selectionEnd > ed.selectionStart) t = { kind: 'ed', ed, from: ed.selectionStart, to: ed.selectionEnd, text: edSlice(ed, ed.selectionStart, ed.selectionEnd), label: '选中的文字' };
    else if (S.editing) { const v = S.editing.ta.value; if (v.trim()) t = { kind: 'ed', ed: S.editing.ta, from: 0, to: v.length, text: v, label: '当前段落' }; }
    else if (S.mode !== 'live' && srcEd) {
      const p = srcEd.selectionStart, bl = (S.result || MD.render(S.src)).blocks; const n = lineCtx(srcEd).n; const b = bl.find(x => n >= x.start && n < x.end);
      if (b) { const a = edLineN(srcEd, b.start).from, z = edLineN(srcEd, b.end - 1).to; t = { kind: 'ed', ed: srcEd, from: a, to: z, text: edSlice(srcEd, a, z), label: '光标所在段落' }; }
    } else {
      const sel = window.getSelection(); const node = sel && sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
      const blk = node && node.closest && node.closest('#write .blk');
      if (blk && S.result) { const b = S.result.blocks[+blk.dataset.i]; if (b) t = { kind: 'blk', start: b.start, end: b.end, text: b.src, label: '选中文字所在段落' }; }
    }
    AI.target = t; aiCtxInfo();
    return t;
  }
  function aiCtxInfo() { const t = AI.target, mode = $('#ai-ctx').value; $('#ai-ctxinfo').textContent = mode === 'doc' ? '· ' + S.fileName : mode === 'none' ? '' : t ? '· ' + t.label + '（' + t.text.length + ' 字符）' : '· 未选中内容'; }
  $('#ai-ctx').addEventListener('change', aiCtxInfo);
  function aiDraw() {
    const c = aiCfg(); $('#ai-model').textContent = aiReady() ? (c.provider === 'azure' ? c.deployment : c.model) : '未配置';
    const box = $('#ai-msgs');
    if (!AI.msgs.length) { box.innerHTML = '<div class="ai-empty">' + (aiReady() ? '选中一段文字后点上方的快捷操作，或直接输入要求，例如：<br>· 把这段改成给日本客户的邮件<br>· 根据这篇文档生成 10 页培训幻灯片<br>· 把测试记录整理成表格并给出结论' : '尚未配置 AI 服务。支持 OpenAI 兼容接口（OpenAI、DeepSeek、通义、Kimi 等）、Azure OpenAI 与本地 Ollama。<br><button class="btn primary sm" data-act="aiprefs" style="margin-top:8px">配置 AI 服务</button>') + '</div>'; return; }
    box.innerHTML = AI.msgs.map((m, i) => m.role === 'user'
      ? '<div class="ai-msg user"><div class="who">你' + (m.ctxLabel ? ' · 附带' + esc(m.ctxLabel) : '') + '</div><div class="bubble">' + esc(m.show || m.content).replace(/\n/g, '<br>') + '</div></div>'
      : '<div class="ai-msg' + (m.err ? ' err' : '') + '" data-i="' + i + '"><div class="who">' + IC('ai') + 'AI</div><div class="bubble md' + (m.pending ? ' ai-typing' : '') + '">' + (m.err ? esc(m.content) : MD.render(m.content || '').html) + '</div>' + (!m.pending && !m.err && m.content ? '<div class="acts">' + (m.target ? '<button class="btn sm primary" data-a="replace">替换原文</button>' : '') + '<button class="btn sm" data-a="insert">插入到光标处</button><button class="btn sm" data-a="copy">复制</button><button class="btn sm" data-a="newdoc">新建文档</button>' + (m.target ? '<button class="btn sm" data-a="diff">对比</button>' : '') + '</div>' : '') + '</div>').join('');
    box.scrollTop = box.scrollHeight;
  }
  async function aiQuick(k) {
    const q = QUICK[k]; if (!q) return;
    if (!app.classList.contains('ai-open')) aiOpenPanel(true); else captureAiTarget();
    if (q.scope === 'doc') { $('#ai-ctx').value = 'doc'; aiCtxInfo(); return aiSend(q.p, q.label, true); }
    if (!AI.target) { toast('请先选中要处理的文字，或把光标放在段落中'); return; }
    $('#ai-ctx').value = 'auto'; aiCtxInfo();
    return aiSend(q.p, q.label);
  }
  function aiMenuAt(ed) {
    captureAiTarget(); const c = caretRect(ed, ed.selectionEnd);
    showCtx(c.left, c.bottom + 6, ['polish', 'shorten', 'continue', 'en', 'zh', 'ja', 'table', 'explain'].map(k => [k, QUICK[k].label]).concat([['-'], ['ask', '自定义要求…']]), k => { if (k === 'ask') aiOpenPanel(true); else aiQuick(k); });
  }
  async function aiSend(preset, label, docScope) {
    if (AI.busy) return;
    if (!aiReady()) { showAiPrefs(); return; }
    const typed = $('#ai-q').value.trim();
    const instr = preset ? preset + (typed ? '\n补充要求：' + typed : '') : typed;
    if (!instr) return;
    const mode = docScope ? 'doc' : $('#ai-ctx').value;
    const c = aiCfg();
    let ctx = '', ctxLabel = '', target = null;
    if (mode === 'doc') { if (S.editing) commit(); const s = S.src; ctx = s.length > c.maxChars ? s.slice(0, c.maxChars) + '\n…（文档过长，已截断）' : s; ctxLabel = '整篇文档'; }
    else if (mode === 'auto') { const t = AI.target || captureAiTarget(); if (t) { ctx = t.text; ctxLabel = t.label; target = t; } }
    const content = ctx ? instr + '\n\n"""\n' + ctx + '\n"""' : instr;
    AI.msgs.push({ role: 'user', content, show: label || typed, ctxLabel });
    const msg = { role: 'assistant', content: '', pending: true, target: preset && !docScope ? target : (target && /改|润色|翻译|精简|rewrite|translate/i.test(instr) ? target : null) };
    AI.msgs.push(msg); $('#ai-q').value = ''; aiDraw();
    const ctrl = new AbortController(); AI.busy = ctrl; $('#ai-send').innerHTML = IC('stop') + '停止';
    const history = AI.msgs.filter(m => !m.err && !m.pending).slice(-8).map(m => ({ role: m.role, content: m.content }));
    let last = 0;
    try {
      await aiChat([{ role: 'system', content: (c.system || SYS) + '\n今天是 ' + today() + '。' }].concat(history), d => { msg.content += d; const now = Date.now(); if (now - last > 60) { last = now; aiDraw(); } }, ctrl.signal);
    } catch (e) { if (e.name !== 'AbortError') { msg.err = true; msg.content = 'AI 请求失败：' + (e.message || e) + (/Failed to fetch|NetworkError|CORS/i.test(String(e.message || e)) ? '\n（网页版可能被跨域策略阻止：请使用桌面版，或使用支持 CORS 的服务 / Ollama 设置 OLLAMA_ORIGINS=*）' : ''); } }
    msg.pending = false; AI.busy = null; $('#ai-send').innerHTML = IC('send') + '发送'; aiDraw();
  }
  async function aiChat(messages, onDelta, signal) {
    const c = aiCfg(); const headers = { 'Content-Type': 'application/json' };
    const body = { messages, stream: true, temperature: +c.temperature };
    let url;
    if (c.provider === 'azure') { url = c.base.replace(/\/+$/, '') + '/openai/deployments/' + encodeURIComponent(c.deployment) + '/chat/completions?api-version=' + encodeURIComponent(c.apiVersion || '2024-06-01'); headers['api-key'] = c.key; }
    else { url = c.base.replace(/\/+$/, '') + '/chat/completions'; if (c.key) headers.Authorization = 'Bearer ' + c.key; body.model = c.model; }
    const f = (NATIVE && T.http && T.http.fetch) ? T.http.fetch : fetch;
    const r = await f(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
    if (!r.ok) { let t = ''; try { t = await r.text(); } catch (e) { } throw new Error('HTTP ' + r.status + ' ' + t.slice(0, 300)); }
    const ct = r.headers.get('content-type') || '';
    if (!/event-stream/.test(ct) || !r.body || !r.body.getReader) { const j = await r.json(); const m = j.choices && j.choices[0] && (j.choices[0].message || j.choices[0].delta); onDelta((m && m.content) || ''); return; }
    const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { value, done } = await rd.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const d = line.slice(5).trim(); if (d === '[DONE]') return;
        try { const j = JSON.parse(d); const ch = j.choices && j.choices[0]; const t = ch && ((ch.delta && ch.delta.content) || (ch.message && ch.message.content)); if (t) onDelta(t); } catch (e) { }
      }
    }
  }
  function aiApplyReplace(m) {
    const t = m.target, out = m.content.replace(/^```(?:markdown|md)?\n([\s\S]*?)\n```\s*$/, '$1').trim();
    if (t.kind === 'ed') {
      const ed = t.ed; const alive = ed.cm ? ed.view.dom.isConnected : ed.isConnected;
      if (alive && edSlice(ed, t.from, t.to) === t.text) { ed.focus(); edReplace(ed, t.from, t.to, out, t.from, t.from + out.length); t.to = t.from + out.length; t.text = out; toast('已替换（Ctrl+Z 可撤销）'); return; }
    } else if (t.kind === 'blk') {
      const ls = srcLines(); if (ls.slice(t.start, t.end).join('\n') === t.text) { ls.splice(t.start, t.end - t.start, ...out.split('\n')); setSrc(ls.join('\n')); toast('已替换（可撤销）'); t.text = out; t.end = t.start + out.split('\n').length; return; }
    }
    const i = S.src.indexOf(t.text);
    if (i >= 0) { setSrc(S.src.slice(0, i) + out + S.src.slice(i + t.text.length)); toast('已替换（可撤销）'); t.text = out; return; }
    navigator.clipboard.writeText(out); toast('原文已变化，无法定位；结果已复制到剪贴板', 3500);
  }
  function aiAct(e) {
    const b = e.target.closest('[data-a]'); if (!b) return; const m = AI.msgs[+b.closest('.ai-msg').dataset.i]; if (!m) return;
    const txt = m.content.replace(/^```(?:markdown|md)?\n([\s\S]*?)\n```\s*$/, '$1').trim();
    const a = b.dataset.a;
    if (a === 'copy') navigator.clipboard.writeText(txt).then(() => toast('已复制'));
    else if (a === 'insert') insertAtCursor(txt);
    else if (a === 'newdoc') newTab(txt, 'AI 生成.md');
    else if (a === 'replace') aiApplyReplace(m);
    else if (a === 'diff') { const d = diffHtml(lineDiff(m.target.text, txt)); modal('<h3>对比：原文 → AI 结果（+' + d.adds + ' / −' + d.dels + ' 行）</h3><div class="diff" style="max-height:60vh">' + d.html + '</div><p style="text-align:right;margin-bottom:0"><button class="btn primary" id="ai-dr">替换原文</button></p>'); $('#ai-dr').onclick = () => { $('#modal').classList.remove('show'); aiApplyReplace(m); }; }
  }
  function showAiPrefs() {
    const c = aiCfg();
    modal('<h3>AI 服务设置</h3>' +
      '<label class="pref">服务类型<select id="ai-pv"><option value="openai">OpenAI 兼容接口（OpenAI / DeepSeek / 通义 / Kimi / 企业网关…）</option><option value="azure">Azure OpenAI</option><option value="ollama">Ollama（本地模型，数据不出电脑）</option></select></label>' +
      '<label class="pref"><span id="ai-base-l">Base URL</span><input type="text" id="ai-base" value="' + esc(c.base) + '"></label>' +
      '<label class="pref">API Key<input type="password" id="ai-key" value="' + esc(c.key) + '" placeholder="sk-…"></label>' +
      '<label class="pref" id="ai-model-row">模型<input type="text" id="ai-mdl" value="' + esc(c.model) + '"></label>' +
      '<label class="pref" id="ai-dep-row">部署名称（Deployment）<input type="text" id="ai-dep" value="' + esc(c.deployment) + '"></label>' +
      '<label class="pref" id="ai-ver-row">API 版本<input type="text" id="ai-ver" value="' + esc(c.apiVersion) + '"></label>' +
      '<label class="pref">温度（0–1，越低越稳定）<input type="number" id="ai-tmp" min="0" max="1.5" step="0.1" value="' + c.temperature + '"></label>' +
      '<label class="pref">整篇文档最多发送字符数<input type="number" id="ai-max" min="2000" step="1000" value="' + c.maxChars + '"></label>' +
      '<h4>系统提示词（可选，留空使用默认）</h4><textarea id="ai-sys" rows="4" placeholder="' + esc(SYS) + '">' + esc(c.system) + '</textarea>' +
      '<p class="hint">⚠ 使用 AI 时，所选内容会发送到上面配置的服务。处理公司内部资料前，请确认符合所在单位的信息安全规定；如需数据不出本机，可选择 Ollama 本地模型。API Key 只保存在本机。</p>' +
      '<p style="display:flex;gap:8px;justify-content:flex-end;margin-bottom:0"><span id="ai-test-r" class="hint" style="margin-right:auto"></span><button class="btn" id="ai-test">测试连接</button><button class="btn primary" id="ai-save">保存</button></p>');
    const pv = $('#ai-pv'); pv.value = c.provider;
    const sync = () => { const p = pv.value; $('#ai-model-row').style.display = p === 'azure' ? 'none' : ''; $('#ai-dep-row').style.display = $('#ai-ver-row').style.display = p === 'azure' ? '' : 'none'; $('#ai-base-l').textContent = p === 'azure' ? 'Endpoint（https://xxx.openai.azure.com）' : 'Base URL'; };
    pv.onchange = () => { const p = pv.value; if (p === 'ollama') { $('#ai-base').value = 'http://localhost:11434/v1'; $('#ai-mdl').value = 'qwen2.5:7b'; } else if (p === 'openai' && /11434|azure/.test($('#ai-base').value)) { $('#ai-base').value = 'https://api.openai.com/v1'; $('#ai-mdl').value = 'gpt-4o-mini'; } else if (p === 'azure') $('#ai-base').value = ''; sync(); };
    sync();
    const read = () => ({ provider: pv.value, base: $('#ai-base').value.trim(), key: $('#ai-key').value.trim(), model: $('#ai-mdl').value.trim(), deployment: $('#ai-dep').value.trim(), apiVersion: $('#ai-ver').value.trim(), temperature: +$('#ai-tmp').value || 0.4, maxChars: +$('#ai-max').value || 60000, system: $('#ai-sys').value.trim() });
    $('#ai-save').onclick = () => { localStorage.setItem(LS + 'ai', JSON.stringify(read())); $('#modal').classList.remove('show'); aiDraw(); toast('AI 设置已保存'); };
    $('#ai-test').onclick = async () => {
      const old = localStorage.getItem(LS + 'ai'); localStorage.setItem(LS + 'ai', JSON.stringify(read()));
      $('#ai-test-r').textContent = '测试中…'; let out = '';
      try { await aiChat([{ role: 'user', content: '只回复两个字：成功' }], d => out += d, AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined); $('#ai-test-r').textContent = '✓ 连接成功：' + out.slice(0, 40); }
      catch (e) { $('#ai-test-r').textContent = '✗ ' + (e.message || e).slice(0, 160); }
      if (old == null) localStorage.removeItem(LS + 'ai'); else localStorage.setItem(LS + 'ai', old);
    };
  }

  /* ---------------- MCP (Model Context Protocol) ---------------- */
  async function showMcp() {
    let script = '<MDView 目录>\\mcp\\mdview_mcp.py';
    if (NATIVE) { try { script = await inv('mcp_script_path'); } catch (e) { } }
    const root = S.dirHandle && S.dirHandle.__path ? S.dirHandle.__path : (NATIVE ? 'D:\\Notes' : 'D:\\Notes（换成你的笔记文件夹）');
    const args = [script, '--root', root];
    const vs = JSON.stringify({ servers: { mdview: { type: 'stdio', command: 'python', args } } }, null, 2);
    const cl = JSON.stringify({ mcpServers: { mdview: { command: 'python', args } } }, null, 2);
    modal('<h3>MCP 接入：让 Copilot / Claude / Cursor 读写你的笔记</h3>' +
      '<p class="hint">MDView 附带一个 MCP 服务（<code>mdview_mcp.py</code>，只依赖 Python 3.8+ 标准库）。AI 工具接入后可以：列出 / 搜索 / 阅读笔记、查看大纲与反向链接、汇总待办、新建或修改笔记（写入前自动备份到 <code>.mdview/backup</code>），' + (NATIVE ? '以及读取 MDView 当前打开的文档和选中的文字（get_active_document）。' : '在桌面版中还能读取当前打开的文档与选中文字。') + ' 文件被 AI 修改后，MDView 会自动重新载入。</p>' +
      '<h4>VS Code（GitHub Copilot Agent 模式）· 工作区 .vscode/mcp.json</h4><pre class="cfg" id="mcp-vs">' + esc(vs) + '</pre><button class="btn sm" data-copy="mcp-vs">复制</button>' +
      '<h4>Claude Desktop（claude_desktop_config.json）/ Cursor（~/.cursor/mcp.json）</h4><pre class="cfg" id="mcp-cl">' + esc(cl) + '</pre><button class="btn sm" data-copy="mcp-cl">复制</button>' +
      '<h4>提供的工具</h4><p class="hint">list_notes · read_note · search_notes · get_outline · get_backlinks · list_tasks · create_note · write_note · append_to_note · replace_in_note · get_active_document</p>' +
      '<p class="hint">如果 Python 不在 PATH 中，请把 <code>python</code> 换成完整路径（如 <code>C:\\\\Python312\\\\python.exe</code>）。--root 指定允许访问的笔记根目录，服务不会读写该目录以外的文件。</p>');
    $$('#modal-body [data-copy]').forEach(b => b.onclick = () => navigator.clipboard.writeText($('#' + b.dataset.copy).textContent).then(() => toast('已复制配置')));
  }

  /* ---------------- shared export helpers ---------------- */
  const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u) { let c = 0xFFFFFFFF; for (let i = 0; i < u.length; i++) c = CRC_T[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  /* minimal ZIP writer (stored entries, UTF-8 names) */
  function zipFiles(files, mime) {
    const enc = new TextEncoder(), parts = [], central = []; let off = 0;
    const d = new Date(), dt = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(), tm = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    for (const f of files) {
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, name = enc.encode(f.name), crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true); lh.setUint16(10, tm, true); lh.setUint16(12, dt, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, tm, true); ch.setUint16(14, dt, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
      central.push(new Uint8Array(ch.buffer), name);
      off += 30 + name.length + data.length;
    }
    const csize = central.reduce((a, b) => a + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, csize, true); end.setUint32(16, off, true);
    return new Blob(parts.concat(central, [new Uint8Array(end.buffer)]), { type: mime || 'application/zip' });
  }
  const xe = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  /* load an image (any source) as PNG/JPEG/GIF bytes plus pixel size; SVG/WebP/BMP are rasterised to PNG */
  async function loadImageData(src, svgEl) {
    let b = null;
    if (svgEl) { const s = new XMLSerializer().serializeToString(svgEl); b = { mime: 'image/svg+xml', bytes: new TextEncoder().encode(s) }; }
    else b = await imageBytes(src);
    if (!b) return null;
    const mime = (b.mime || '').split(';')[0].toLowerCase();
    const url = URL.createObjectURL(new Blob([b.bytes], { type: mime || 'image/png' }));
    try {
      const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      let w = im.naturalWidth || 400, h = im.naturalHeight || 300;
      if (svgEl) { const r = svgEl.getBoundingClientRect(); if (r.width) { w = r.width; h = r.height; } const vb = svgEl.viewBox && svgEl.viewBox.baseVal; if ((!w || w < 2) && vb) { w = vb.width; h = vb.height; } }
      if (/png|jpeg|jpg|gif/.test(mime)) return { bytes: b.bytes, ext: mime.includes('png') ? 'png' : mime.includes('gif') ? 'gif' : 'jpeg', w, h };
      const k = svgEl ? 2 : 1, c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
      const g = c.getContext('2d'); if (svgEl) { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); } g.drawImage(im, 0, 0, c.width, c.height);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: 'png', w, h };
    } catch (e) { return null; } finally { URL.revokeObjectURL(url); }
  }
  const texOf = el => { const a = el.querySelector && el.querySelector('annotation'); return a ? a.textContent : (el.dataset && el.dataset.tex) || el.textContent; };
  function docTitle() { const m = S.src.match(/^#\s+(.+)$/m); return (m ? m[1].replace(/^主题[：:]\s*/, '') : baseOut()).replace(/[*_`~=]/g, '').trim(); }

  /* ---------------- Outlook: inline-styled HTML, copy as mail, .eml draft ---------------- */
  const MAIL_FONT = '"Microsoft YaHei UI","Microsoft YaHei","Segoe UI",Meiryo,Calibri,Arial,sans-serif';
  const MAIL_ST = {
    h1: 'font-size:18pt;font-weight:bold;margin:14pt 0 8pt;color:#1f2328', h2: 'font-size:15pt;font-weight:bold;margin:14pt 0 6pt;color:#1f2328;border-bottom:1px solid #e1e4e8;padding-bottom:3pt', h3: 'font-size:12.5pt;font-weight:bold;margin:12pt 0 4pt;color:#1f2328', h4: 'font-size:11pt;font-weight:bold;margin:10pt 0 4pt', h5: 'font-size:10.5pt;font-weight:bold;margin:8pt 0 4pt', h6: 'font-size:10.5pt;font-weight:bold;color:#57606a;margin:8pt 0 4pt',
    p: 'margin:0 0 8pt', ul: 'margin:0 0 8pt;padding-left:22pt', ol: 'margin:0 0 8pt;padding-left:22pt', li: 'margin:0 0 3pt',
    table: 'border-collapse:collapse;margin:6pt 0 10pt;font-size:10pt', th: 'border:1px solid #c9ced6;padding:5pt 9pt;background:#f1f3f6;font-weight:bold;text-align:left', td: 'border:1px solid #c9ced6;padding:5pt 9pt;vertical-align:top',
    pre: 'font-family:Consolas,"Courier New",monospace;font-size:9.5pt;background:#f6f8fa;border:1px solid #e1e4e8;border-radius:4px;padding:8pt 10pt;white-space:pre-wrap;margin:6pt 0 10pt', code: 'font-family:Consolas,"Courier New",monospace;font-size:90%;background:#f3f4f6;padding:1px 4px;border-radius:3px',
    blockquote: 'margin:6pt 0 10pt;padding:2pt 12pt;border-left:3px solid #c9ced6;color:#57606a', a: 'color:#1f5fbf;text-decoration:underline', mark: 'background:#fff1a8', hr: 'border:none;border-top:1px solid #d0d7de;margin:12pt 0', img: 'max-width:640px;height:auto', del: 'color:#8c959f'
  };
  const TOK = { comment: '#6a737d', prolog: '#6a737d', string: '#0a7d3e', char: '#0a7d3e', keyword: '#8250df', number: '#c2410c', boolean: '#c2410c', function: '#1f5fbf', 'class-name': '#b45309', property: '#c2185b', tag: '#c2185b', 'attr-name': '#6f42c1', operator: '#57606a', directive: '#8250df', macro: '#8250df' };
  async function mailHtml(forEml) {
    if (S.editing) commit();
    const div = await renderedDom({ inline: !forEml, keepData: true });
    const imgs = [];
    for (const el of div.querySelectorAll('.mermaid,.wavedrom')) { const svg = el.querySelector('svg'); if (svg) { const d = await loadImageData(null, svg); if (d) { const im = document.createElement('img'); im.dataset.raw = '1'; im._d = d; im.width = Math.min(640, d.w); el.replaceWith(im); } } }
    for (const el of div.querySelectorAll('.katex-display,.katex,.math-fallback')) { const t = document.createElement(el.closest('.math-block') ? 'div' : 'span'); t.textContent = texOf(el); t.style.cssText = 'font-family:Cambria Math,serif;font-style:italic'; (el.closest('.math-block') || el).replaceWith(t); }
    div.querySelectorAll('.code-head').forEach(e => e.remove());
    div.querySelectorAll('.code-wrap').forEach(e => e.replaceWith(...e.childNodes));
    div.querySelectorAll('.table-wrap').forEach(e => e.replaceWith(...e.childNodes));
    div.querySelectorAll('input.task-cb').forEach(e => e.replaceWith(document.createTextNode(e.checked ? '☑' : '☐')));
    div.querySelectorAll('.md-toc').forEach(e => e.remove());
    div.querySelectorAll('.alert-title .ai').forEach(e => e.remove());
    for (const el of div.querySelectorAll('*')) {
      const tag = el.tagName.toLowerCase(); let st = MAIL_ST[tag] || '';
      if (tag === 'span' && el.classList.contains('token')) { const c = Array.from(el.classList).find(x => TOK[x]); if (c) st = 'color:' + TOK[c]; }
      if (tag === 'code' && el.parentElement && el.parentElement.tagName === 'PRE') st = 'font-family:inherit;background:none;padding:0';
      if ((tag === 'th' || tag === 'td') && el.style.textAlign) st += ';text-align:' + el.style.textAlign;
      if (tag === 'blockquote' && el.classList.contains('alert')) st += ';background:#f6f8fa;color:#1f2328';
      if (tag === 'p' && el.classList.contains('img-only')) st += ';text-align:center';
      if (tag === 'img') { const z = (el.getAttribute('style') || '').match(/zoom:\s*(\d+)%/); if (z) el.width = Math.round((el.naturalWidth || 600) * z[1] / 100); }
      if (st) el.setAttribute('style', st); else el.removeAttribute('style');
      el.removeAttribute('class'); el.removeAttribute('id'); if (tag !== 'img') { for (const a of Array.from(el.attributes)) if (a.name.startsWith('data-')) el.removeAttribute(a.name); }
    }
    for (const im of div.querySelectorAll('img')) {
      let d = im._d;
      if (!d && forEml) d = await loadImageData(im.dataset.src || im.getAttribute('src'));
      if (forEml && d) { const id = 'img' + (imgs.length + 1) + '@mdview'; imgs.push({ id, d }); im.src = 'cid:' + id; }
      else if (d) im.src = 'data:image/' + d.ext + ';base64,' + bytesToB64(d.bytes);
      if (!im.width && d && d.w > 640) im.width = 640;
      for (const a of Array.from(im.attributes)) if (a.name.startsWith('data-')) im.removeAttribute(a.name);
    }
    const html = '<div style="font-family:' + MAIL_FONT.replace(/"/g, "'") + ';font-size:10.5pt;line-height:1.6;color:#1f2328">' + div.innerHTML + '</div>';
    return { html, imgs };
  }
  async function copyMail() {
    toast('正在生成邮件格式…', 1200);
    const { html } = await mailHtml(false);
    try { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([S.src], { type: 'text/plain' }) })]); toast('已复制为邮件格式，可直接粘贴到 Outlook / Teams / Word'); }
    catch (e) { toast('复制失败：' + e.message); }
  }
  function b64Lines(u8) { return bytesToB64(u8).replace(/.{76}/g, '$&\r\n'); }
  async function exportEml() {
    toast('正在生成邮件草稿…', 1500);
    const { html, imgs } = await mailHtml(true);
    let subject = docTitle();
    const body = html.replace(/<h1[^>]*>\s*主题[：:][\s\S]*?<\/h1>/, '');
    const B = '----=_MDView_' + Date.now().toString(36);
    const enc = new TextEncoder();
    let eml = 'X-Unsent: 1\r\nMIME-Version: 1.0\r\nSubject: =?UTF-8?B?' + bytesToB64(enc.encode(subject)) + '?=\r\nX-Mailer: MDView ' + VERSION + '\r\nContent-Type: multipart/related; boundary="' + B + '"; type="text/html"\r\n\r\n';
    eml += '--' + B + '\r\nContent-Type: text/html; charset="utf-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n' + b64Lines(enc.encode('<html><head><meta charset="utf-8"></head><body>' + body + '</body></html>')) + '\r\n';
    for (const im of imgs) eml += '--' + B + '\r\nContent-Type: image/' + im.d.ext + '; name="' + im.id.split('@')[0] + '.' + im.d.ext + '"\r\nContent-Transfer-Encoding: base64\r\nContent-ID: <' + im.id + '>\r\nContent-Disposition: inline; filename="' + im.id.split('@')[0] + '.' + im.d.ext + '"\r\n\r\n' + b64Lines(im.d.bytes) + '\r\n';
    eml += '--' + B + '--\r\n';
    const name = subject.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) + '.eml';
    if (NATIVE) { try { const p = await inv('write_temp', { name, data: bytesToB64(enc.encode(eml)) }); await inv('open_path', { path: p }); toast('已用默认邮件程序打开草稿'); return; } catch (e) { toast('无法直接打开，改为保存文件'); } }
    await saveOut(name, new Blob([eml], { type: 'message/rfc822' }), 'eml', '邮件', 'message/rfc822');
    if (!NATIVE) toast('已下载 ' + name + '：双击即可在 Outlook 中作为新邮件打开', 4500);
  }

  /* ---------------- Word (.docx) ---------------- */
  async function exportDocx() {
    if (S.editing) commit();
    toast('正在生成 Word 文档…', 2000);
    const div = await renderedDom({ keepData: true });
    const rels = [], media = []; let nid = 1, docPr = 1; const numDefs = [];
    const rel = (type, target, ext) => { const id = 'rId' + (10 + rels.length); rels.push({ id, type, target, ext }); return id; };
    const H = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
    async function imgRun(src, svg, zoom) {
      const d = await loadImageData(src, svg); if (!d) return run('[图片：' + (src || '') + ']', { i: true });
      const id = rel(H + 'image', 'media/image' + (media.length + 1) + '.' + d.ext); media.push({ name: 'word/media/image' + (media.length + 1) + '.' + d.ext, data: d.bytes });
      let w = d.w * (zoom || 1), h = d.h * (zoom || 1); const max = 600; if (w > max) { h = h * max / w; w = max; }
      const cx = Math.round(w * 9525), cy = Math.round(h * 9525), n = docPr++;
      return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:docPr id="' + n + '" name="Picture ' + n + '"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="' + n + '" name="image' + n + '"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="' + id + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
    }
    function rpr(f) {
      let s = '';
      if (f.rstyle) s += '<w:rStyle w:val="' + f.rstyle + '"/>';
      if (f.code) s += '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="Microsoft YaHei" w:cs="Consolas"/>';
      else if (f.math) s += '<w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/>';
      if (f.b) s += '<w:b/>'; if (f.i) s += '<w:i/>'; if (f.s) s += '<w:strike/>';
      if (f.color) s += '<w:color w:val="' + f.color + '"/>';
      if (f.code) s += '<w:sz w:val="19"/>';
      if (f.mark) s += '<w:highlight w:val="yellow"/>';
      if (f.u) s += '<w:u w:val="single"/>';
      if (f.code && !f.block) s += '<w:shd w:val="clear" w:color="auto" w:fill="F1F3F5"/>';
      if (f.sup) s += '<w:vertAlign w:val="superscript"/>'; else if (f.sub) s += '<w:vertAlign w:val="subscript"/>';
      return s ? '<w:rPr>' + s + '</w:rPr>' : '';
    }
    function run(text, f) {
      f = f || {};
      return text.split('\n').map((seg, i) => (i ? '<w:r>' + rpr(f) + '<w:br/></w:r>' : '') + (seg ? seg.split('\t').map((t, j) => (j ? '<w:r>' + rpr(f) + '<w:tab/></w:r>' : '') + (t ? '<w:r>' + rpr(f) + '<w:t xml:space="preserve">' + xe(t) + '</w:t></w:r>' : '')).join('') : '')).join('');
    }
    async function inl(node, f, pre) {
      let out = '';
      for (const n of node.childNodes) {
        if (n.nodeType === 3) { let t = n.nodeValue; if (!pre) t = t.replace(/[ \t\r\n]+/g, ' '); out += run(t, f); continue; }
        if (n.nodeType !== 1) continue;
        const tag = n.tagName.toLowerCase(), c = n.classList;
        if (c.contains('katex') || c.contains('math-fallback')) { out += run(texOf(n), Object.assign({}, f, { i: true, math: true })); continue; }
        if (tag === 'br') { out += '<w:r><w:br/></w:r>'; continue; }
        if (tag === 'img') { const z = (n.getAttribute('style') || '').match(/zoom:\s*(\d+)%/); out += await imgRun(n.dataset.src || n.getAttribute('src'), null, z ? z[1] / 100 : 1); continue; }
        if (tag === 'input') { out += run(n.checked ? '☑' : '☐', f); continue; }
        if (tag === 'svg') continue;
        const g = Object.assign({}, f);
        if (tag === 'strong' || tag === 'b') g.b = true; else if (tag === 'em' || tag === 'i') g.i = true; else if (tag === 'del' || tag === 's') g.s = true;
        else if (tag === 'u' || tag === 'ins') g.u = true; else if (tag === 'mark') g.mark = true; else if (tag === 'code' || tag === 'kbd') g.code = true;
        else if (tag === 'sup') g.sup = true; else if (tag === 'sub') g.sub = true;
        if (tag === 'a') {
          const href = n.getAttribute('href') || '';
          if (/^(https?:|mailto:)/i.test(href)) { const id = rel(H + 'hyperlink', href, true); out += '<w:hyperlink r:id="' + id + '">' + await inl(n, Object.assign(g, { rstyle: 'Hyperlink' })) + '</w:hyperlink>'; continue; }
        }
        if (tag === 'span' && c.contains('token')) { const k = Array.from(c).find(x => TOK[x]); if (k) g.color = TOK[k].slice(1); }
        out += await inl(n, g, pre);
      }
      return out;
    }
    const P = (inner, ppr) => '<w:p>' + (ppr ? '<w:pPr>' + ppr + '</w:pPr>' : '') + inner + '</w:p>';
    async function list(el, depth, out) {
      const ordered = el.tagName === 'OL'; let numId = 1;
      if (ordered) { numDefs.push(+el.getAttribute('start') || 1); numId = 1 + numDefs.length; }
      for (const li of el.children) {
        if (li.tagName !== 'LI') continue;
        const inlineParts = document.createElement('span'); const blocks = [];
        for (const ch of Array.from(li.childNodes)) { if (ch.nodeType === 1 && /^(UL|OL|PRE|TABLE|BLOCKQUOTE|DIV)$/.test(ch.tagName)) blocks.push(ch); else if (ch.nodeType === 1 && ch.tagName === 'P') { if (!inlineParts.childNodes.length) inlineParts.append(...ch.childNodes); else blocks.push(ch); } else inlineParts.appendChild(ch.cloneNode(true)); }
        out.push(P(await inl(inlineParts, {}), '<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="' + Math.min(depth, 8) + '"/><w:numId w:val="' + numId + '"/></w:numPr>'));
        for (const b of blocks) { if (b.tagName === 'UL' || b.tagName === 'OL') await list(b, depth + 1, out); else await block(b, out, depth + 1); }
      }
    }
    async function block(el, out, indent) {
      const tag = el.tagName.toLowerCase(), c = el.classList;
      const ind = indent ? '<w:ind w:left="' + (indent * 420) + '"/>' : '';
      if (/^h[1-6]$/.test(tag)) { out.push(P(await inl(el, {}), '<w:pStyle w:val="Heading' + tag[1] + '"/>')); return; }
      if (tag === 'p') { out.push(P(await inl(el, {}), (c.contains('alert-title') ? '<w:pStyle w:val="Quote"/>' : '') + ind + (c.contains('img-only') ? '<w:jc w:val="center"/>' : ''))); return; }
      if (tag === 'ul' || tag === 'ol') { await list(el, indent || 0, out); return; }
      if (tag === 'hr') { out.push(P('', '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="D0D7DE"/></w:pBdr>')); return; }
      if (c.contains('code-wrap') || tag === 'pre') {
        const pre = tag === 'pre' ? el : el.querySelector('pre'); if (!pre) return;
        const code = pre.querySelector('code') || pre;
        const lines = []; let curr = document.createElement('span'); lines.push(curr);
        const walk = (n, parentClone) => { for (const ch of Array.from(n.childNodes)) { if (ch.nodeType === 3) { const parts = ch.nodeValue.split('\n'); parts.forEach((p, i) => { if (i) { curr = document.createElement('span'); lines.push(curr); parentClone = null; } if (p) { const t = document.createTextNode(p); if (ch.parentElement !== code && ch.parentElement.className) { const s = document.createElement('span'); s.className = ch.parentElement.className; s.appendChild(t); curr.appendChild(s); } else curr.appendChild(t); } }); } else if (ch.nodeType === 1) walk(ch); } };
        walk(code);
        for (const l of lines) out.push(P((await inl(l, { code: true, block: true }, true)) || '', '<w:pStyle w:val="CodeBlock"/>' + ind));
        return;
      }
      if (c.contains('table-wrap') || tag === 'table') {
        const tbl = tag === 'table' ? el : el.querySelector('table'); if (!tbl) return;
        const rows = Array.from(tbl.querySelectorAll('tr')); const n = Math.max(...rows.map(r => r.children.length)); const W = Math.floor(9000 / n);
        let x = '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(s => '<w:' + s + ' w:val="single" w:sz="4" w:space="0" w:color="C9CED6"/>').join('') + '</w:tblBorders><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>' + ('<w:gridCol w:w="' + W + '"/>').repeat(n) + '</w:tblGrid>';
        for (const r of rows) {
          const head = r.parentElement.tagName === 'THEAD';
          x += '<w:tr>' + (head ? '<w:trPr><w:tblHeader/></w:trPr>' : '');
          for (let i = 0; i < n; i++) {
            const cell = r.children[i]; const al = cell && cell.style.textAlign; const jc = al === 'center' ? 'center' : al === 'right' ? 'right' : '';
            x += '<w:tc><w:tcPr><w:tcW w:w="' + W + '" w:type="dxa"/>' + (head ? '<w:shd w:val="clear" w:color="auto" w:fill="F1F3F6"/>' : '') + '</w:tcPr>' + P(cell ? await inl(cell, head ? { b: true } : {}) : '', '<w:spacing w:before="0" w:after="0"/>' + (jc ? '<w:jc w:val="' + jc + '"/>' : '')) + '</w:tc>';
          }
          x += '</w:tr>';
        }
        out.push(x + '</w:tbl>'); out.push(P('', '<w:spacing w:before="0" w:after="0"/>'));
        return;
      }
      if (tag === 'blockquote') {
        const sub = []; for (const ch of el.children) await block(ch, sub, indent);
        out.push(...sub.map(p => p.startsWith('<w:tbl>') ? p : p.startsWith('<w:p><w:pPr>') ? (p.includes('<w:pStyle ') ? p : p.replace('<w:p><w:pPr>', '<w:p><w:pPr><w:pStyle w:val="Quote"/>')) : p.replace(/^<w:p>/, '<w:p><w:pPr><w:pStyle w:val="Quote"/></w:pPr>')));
        return;
      }
      if (c.contains('math-block')) { const k = el.querySelector('.katex') || el.querySelector('.math-fallback') || el; out.push(P(run(texOf(k), { i: true, math: true }), '<w:jc w:val="center"/>')); return; }
      if (c.contains('mermaid-wrap') || c.contains('wavedrom-wrap')) { const svg = el.querySelector('svg'); if (svg) out.push(P(await imgRun(null, svg), '<w:jc w:val="center"/>')); else out.push(P(run(el.textContent, { code: true }), '<w:pStyle w:val="CodeBlock"/>')); return; }
      if (c.contains('md-toc')) { out.push('<w:p><w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>（目录：在 Word 中右键 → 更新域）</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'); return; }
      if (tag === 'details') { for (const ch of el.childNodes) { if (ch.nodeType === 1) { if (ch.tagName === 'SUMMARY') out.push(P(await inl(ch, { b: true }))); else await block(ch, out, indent); } else if (ch.nodeValue.trim()) out.push(P(run(ch.nodeValue.trim()))); } return; }
      if (tag === 'section' && c.contains('footnotes')) { out.push(P(run('脚注', { b: true }))); for (const li of el.querySelectorAll('li')) { li.querySelectorAll('.fn-back').forEach(b => b.remove()); out.push(P(await inl(li, {}), '<w:pStyle w:val="FootnoteText"/>')); } return; }
      if (tag === 'div' || tag === 'section' || tag === 'figure') { for (const ch of el.childNodes) { if (ch.nodeType === 1) await block(ch, out, indent); else if (ch.nodeValue.trim()) out.push(P(run(ch.nodeValue.trim()))); } return; }
      const t = await inl(el, {}); if (t) out.push(P(t, ind));
    }
    const body = [];
    for (const el of div.children) await block(el, body, 0);
    const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
    const document_xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ' + NS + '><w:body>' + body.join('') + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1304" w:right="1247" w:bottom="1304" w:left="1247" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>';
    const hs = [[36, '1F2328', 360], [30, '1F2328', 320], [26, '1F2328', 280], [23, '1F2328', 240], [21, '1F2328', 200], [21, '57606A', 200]];
    const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft YaHei" w:cs="Calibri"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
      hs.map((h, i) => '<w:style w:type="paragraph" w:styleId="Heading' + (i + 1) + '"><w:name w:val="heading ' + (i + 1) + '"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/>' + (i < 2 ? '<w:pBdr><w:bottom w:val="single" w:sz="4" w:space="2" w:color="E1E4E8"/></w:pBdr>' : '') + '<w:spacing w:before="' + h[2] + '" w:after="120"/><w:outlineLvl w:val="' + i + '"/></w:pPr><w:rPr><w:b/><w:color w:val="' + h[1] + '"/><w:sz w:val="' + h[0] + '"/><w:szCs w:val="' + h[0] + '"/></w:rPr></w:style>').join('') +
      '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/><w:contextualSpacing/></w:pPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="C9CED6"/></w:pBdr><w:ind w:left="240"/></w:pPr><w:rPr><w:color w:val="57606A"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="CodeBlock"><w:name w:val="Code Block"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F6F8FA"/><w:spacing w:before="0" w:after="0" w:line="260" w:lineRule="auto"/><w:ind w:left="120" w:right="120"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="Microsoft YaHei" w:cs="Consolas"/><w:sz w:val="19"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="18"/><w:color w:val="57606A"/></w:rPr></w:style>' +
      '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="1F5FBF"/><w:u w:val="single"/></w:rPr></w:style></w:styles>';
    const lvl = (i, fmt, text, ind) => '<w:lvl w:ilvl="' + i + '"><w:start w:val="1"/><w:numFmt w:val="' + fmt + '"/><w:lvlText w:val="' + text + '"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="' + ind + '" w:hanging="360"/></w:pPr>' + (fmt === 'bullet' ? '<w:rPr><w:rFonts w:ascii="Segoe UI Symbol" w:hAnsi="Segoe UI Symbol"/></w:rPr>' : '') + '</w:lvl>';
    const BUL = ['•', '◦', '▪'], ONUM = ['decimal', 'lowerLetter', 'lowerRoman'];
    const numbering = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>' + Array.from({ length: 9 }, (_, i) => lvl(i, 'bullet', BUL[i % 3], 420 * (i + 1))).join('') + '</w:abstractNum>' +
      '<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>' + Array.from({ length: 9 }, (_, i) => lvl(i, ONUM[i % 3], '%' + (i + 1) + '.', 420 * (i + 1))).join('') + '</w:abstractNum>' +
      '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' + numDefs.map((st, i) => '<w:num w:numId="' + (i + 2) + '"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="' + st + '"/></w:lvlOverride></w:num>').join('') + '</w:numbering>';
    const settings = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' + (div.querySelector('.md-toc') ? '<w:updateFields w:val="true"/>' : '') + '<w:defaultTabStop w:val="420"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>';
    const docRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + H + 'styles" Target="styles.xml"/><Relationship Id="rId2" Type="' + H + 'numbering" Target="numbering.xml"/><Relationship Id="rId3" Type="' + H + 'settings" Target="settings.xml"/>' + rels.map(r => '<Relationship Id="' + r.id + '" Type="' + r.type + '" Target="' + xe(r.target) + '"' + (r.ext ? ' TargetMode="External"' : '') + '/>').join('') + '</Relationships>';
    const ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>';
    const core = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>' + xe(docTitle()) + '</dc:title><dc:creator>MDView</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">' + new Date().toISOString().slice(0, 19) + 'Z</dcterms:created></cp:coreProperties>';
    const pkg = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + H + 'officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>';
    const blob = zipFiles([{ name: '[Content_Types].xml', data: ct }, { name: '_rels/.rels', data: pkg }, { name: 'word/document.xml', data: document_xml }, { name: 'word/styles.xml', data: styles }, { name: 'word/numbering.xml', data: numbering }, { name: 'word/settings.xml', data: settings }, { name: 'word/_rels/document.xml.rels', data: docRels }, { name: 'docProps/core.xml', data: core }].concat(media), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    window.__lastDocx = blob;
    await saveOut(baseOut() + '.docx', blob, 'docx', 'Word 文档', blob.type);
  }

  /* ---------------- PowerPoint (.pptx) from slides ("---" pages, <!-- notes: --> speaker notes) ---------------- */
  async function exportPptx() {
    if (S.editing) commit();
    const slides = splitSlides(S.src); if (!slides.length) return toast('文档为空');
    toast('正在生成 PowerPoint…', 2000);
    const EMU = 12700, SW = 12192000, SH = 6858000;
    const files = [], media = [];
    const accent = '2F6FDB', dark = '1F2328', gray = '57606A';
    const tx = (t, o) => { o = o || {}; return '<a:r><a:rPr lang="zh-CN" altLang="en-US" sz="' + (o.sz || 1800) + '"' + (o.b ? ' b="1"' : '') + (o.i ? ' i="1"' : '') + (o.u ? ' u="sng"' : '') + (o.strike ? ' strike="sngStrike"' : '') + ' dirty="0">' + (o.color ? '<a:solidFill><a:srgbClr val="' + o.color + '"/></a:solidFill>' : '') + (o.hl ? '<a:highlight><a:srgbClr val="FFF1A8"/></a:highlight>' : '') + (o.code ? '<a:latin typeface="Consolas"/><a:ea typeface="Microsoft YaHei"/>' : '<a:latin typeface="Segoe UI"/><a:ea typeface="Microsoft YaHei"/>') + '</a:rPr><a:t>' + xe(t) + '</a:t></a:r>'; };
    function runsOf(node, o) {
      let out = '';
      for (const n of node.childNodes) {
        if (n.nodeType === 3) { const t = n.nodeValue.replace(/\s+/g, ' '); if (t) out += tx(t, o); continue; }
        if (n.nodeType !== 1) continue;
        const tag = n.tagName.toLowerCase(), g = Object.assign({}, o);
        if (n.classList.contains('katex') || n.classList.contains('math-fallback')) { out += tx(texOf(n), Object.assign(g, { i: true })); continue; }
        if (tag === 'img' || tag === 'svg') continue;
        if (tag === 'input') { out += tx(n.checked ? '☑ ' : '☐ ', g); continue; }
        if (tag === 'strong' || tag === 'b') g.b = true; else if (tag === 'em' || tag === 'i') g.i = true; else if (tag === 'code') { g.code = true; g.color = 'B42359'; } else if (tag === 'a') { g.color = accent; g.u = true; } else if (tag === 'mark') g.hl = true; else if (tag === 'del') g.strike = true;
        out += runsOf(n, g);
      }
      return out;
    }
    const para = (runs, o) => { o = o || {}; const lvl = o.lvl || 0; const bu = o.bullet === 'num' ? '<a:buFont typeface="+mj-lt"/><a:buAutoNum type="arabicPeriod"/>' : o.bullet ? '<a:buFont typeface="Arial"/><a:buChar char="' + ['•', '–', '▪'][lvl % 3] + '"/>' : '<a:buNone/>'; const ind = o.bullet ? ' marL="' + (342900 + lvl * 342900) + '" indent="-285750"' : ''; return '<a:p><a:pPr' + ind + (lvl ? ' lvl="' + lvl + '"' : '') + (o.algn ? ' algn="' + o.algn + '"' : '') + '><a:spcBef><a:spcPts val="' + (o.spc == null ? 600 : o.spc) + '"/></a:spcBef>' + bu + '</a:pPr>' + (runs || '<a:endParaRPr lang="zh-CN" sz="' + (o.sz || 1800) + '"/>') + '</a:p>'; };
    let shapeId = 2;
    const textBox = (x, y, w, h, paras, o) => { o = o || {}; const id = shapeId++; return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="' + (o.name || 'Text ' + id) + '"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="' + Math.round(x) + '" y="' + Math.round(y) + '"/><a:ext cx="' + Math.round(w) + '" cy="' + Math.round(h) + '"/></a:xfrm><a:prstGeom prst="' + (o.round ? 'roundRect' : 'rect') + '"><a:avLst/></a:prstGeom>' + (o.fill ? '<a:solidFill><a:srgbClr val="' + o.fill + '"/></a:solidFill>' : '<a:noFill/>') + (o.line ? '<a:ln w="9525"><a:solidFill><a:srgbClr val="' + o.line + '"/></a:solidFill></a:ln>' : '') + '</p:spPr><p:txBody><a:bodyPr wrap="square" lIns="' + (o.pad || 91440) + '" tIns="' + (o.pad || 45720) + '" rIns="' + (o.pad || 91440) + '" bIns="' + (o.pad || 45720) + '" anchor="' + (o.anchor || 't') + '"><a:normAutofit/></a:bodyPr><a:lstStyle/>' + paras.join('') + '</p:txBody></p:sp>'; };
    const rect = (x, y, w, h, fill) => { const id = shapeId++; return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="Bar ' + id + '"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="' + x + '" y="' + y + '"/><a:ext cx="' + w + '" cy="' + h + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="' + fill + '"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>'; };
    for (let si = 0; si < slides.length; si++) {
      shapeId = 2;
      let md = slides[si]; const notes = [];
      md = md.replace(/<!--\s*(?:notes?|备注)\s*[:：]?([\s\S]*?)-->/gi, (m, t) => { notes.push(t.trim()); return ''; });
      const div = document.createElement('div'); div.innerHTML = MD.render(md).html;
      const titleEl = div.querySelector('h1,h2,h3'); const title = titleEl ? titleEl.textContent.trim() : '';
      const isTitle = si === 0 && titleEl && titleEl.tagName === 'H1' || (titleEl && titleEl.tagName === 'H1' && div.children.length <= 3);
      if (titleEl) titleEl.remove();
      const rels = ['<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>'];
      let shapes = '';
      if (isTitle) {
        shapes += rect(0, 0, SW, SH, 'F7F9FC') + rect(0, 0, 228600, SH, accent);
        shapes += textBox(914400, 2057400, SW - 1828800, 1371600, [para(tx(title, { sz: 4000, b: true, color: dark }), { spc: 0 })], { anchor: 'b', name: 'Title' });
        const sub = Array.from(div.querySelectorAll('p')).map(p => para(runsOf(p, { sz: 2000, color: gray }), { spc: 400 }));
        shapes += textBox(914400, 3543300, SW - 1828800, 1600200, sub.length ? sub : [para('')], { name: 'Subtitle' });
      } else {
        shapes += rect(0, 0, SW, 76200, accent);
        if (title) shapes += textBox(609600, 304800, SW - 1219200, 838200, [para(tx(title, { sz: 2800, b: true, color: dark }), { spc: 0 })], { anchor: 'ctr', name: 'Title' });
        shapes += rect(609600, 1143000, 914400, 38100, accent);
        const imgs = Array.from(div.querySelectorAll('img')), tables = Array.from(div.querySelectorAll('table')), codes = Array.from(div.querySelectorAll('pre')), diags = Array.from(div.querySelectorAll('.mermaid,.wavedrom'));
        const paras = []; let textChars = 0;
        const addText = (el, lvl) => {
          const tag = el.tagName;
          if (tag === 'UL' || tag === 'OL') { for (const li of el.children) { const inner = document.createElement('span'); const subs = []; for (const ch of Array.from(li.childNodes)) { if (ch.nodeType === 1 && (ch.tagName === 'UL' || ch.tagName === 'OL')) subs.push(ch); else if (ch.nodeType === 1 && ch.tagName === 'P') inner.append(...ch.cloneNode(true).childNodes); else inner.appendChild(ch.cloneNode(true)); } textChars += inner.textContent.length + 10; paras.push(para(runsOf(inner, { sz: lvl ? 1600 : 1800, color: dark }), { bullet: tag === 'OL' ? 'num' : true, lvl })); subs.forEach(s => addText(s, lvl + 1)); } }
          else if (tag === 'P' || /^H[3-6]$/.test(tag)) { if (!el.textContent.trim()) return; textChars += el.textContent.length + 10; paras.push(para(runsOf(el, { sz: /^H/.test(tag) ? 2000 : 1800, b: /^H/.test(tag), color: /^H/.test(tag) ? accent : dark }))); }
          else if (tag === 'BLOCKQUOTE') { for (const ch of el.children) { textChars += ch.textContent.length; paras.push(para(runsOf(ch, { sz: 1600, i: true, color: gray }))); } }
          else if (tag === 'DIV' && !el.querySelector('table,pre,.mermaid,.wavedrom')) { for (const ch of el.children) addText(ch, lvl); }
        };
        for (const el of div.children) if (!el.querySelector('table') && !el.matches('.code-wrap,.table-wrap,.mermaid-wrap,.wavedrom-wrap,.math-block')) addText(el, 0);
        for (const m of div.querySelectorAll('.math-block')) paras.push(para(tx(texOf(m.querySelector('.katex,.math-fallback') || m), { sz: 2000, i: true }), { algn: 'ctr' }));
        const visuals = imgs.length + diags.length;
        const top = 1371600, bottom = SH - 457200, left = 609600, full = SW - 1219200;
        let y = top; const textW = visuals ? full * 0.52 : full;
        if (paras.length) { const lines = Math.max(paras.length, Math.ceil(textChars / (visuals ? 30 : 58))); const h = Math.min(bottom - y, Math.max(600000, lines * 480000)); shapes += textBox(left, y, textW, (tables.length || codes.length) ? h : bottom - y, paras, { name: 'Content' }); if (!visuals) y += h + 152400; }
        for (const pre of codes) {
          const lines = (pre.querySelector('code') || pre).textContent.replace(/\n$/, '').split('\n'); const sz = lines.length > 14 ? 1100 : 1300; const h = Math.min(bottom - y, lines.length * sz * 1.35 * EMU / 100 + 182880);
          shapes += textBox(visuals ? left : left, y, visuals ? textW : full, h, lines.map(l => para(tx(l || ' ', { sz, code: true, color: dark }), { spc: 0 })), { fill: 'F6F8FA', line: 'E1E4E8', round: true, name: 'Code' }); y += h + 152400;
        }
        for (const tb of tables) {
          const rows = Array.from(tb.querySelectorAll('tr')); const n = Math.max(...rows.map(r => r.children.length)); const rh = 370840; const w = visuals ? textW : full; const cw = Math.floor(w / n);
          let g = '<a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>' + ('<a:gridCol w="' + cw + '"/>').repeat(n) + '</a:tblGrid>';
          rows.forEach((r, ri) => {
            g += '<a:tr h="' + rh + '">';
            for (let i = 0; i < n; i++) { const c = r.children[i]; const head = ri === 0; const al = c && c.style.textAlign; g += '<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>' + para(c ? runsOf(c, { sz: rows.length > 8 ? 1200 : 1400, b: head, color: head ? 'FFFFFF' : dark }) : '', { spc: 0, algn: al === 'center' ? 'ctr' : al === 'right' ? 'r' : undefined }) + '</a:txBody><a:tcPr marL="91440" marR="91440" marT="45720" marB="45720" anchor="ctr">' + ['L', 'R', 'T', 'B'].map(s => '<a:ln' + s + ' w="9525"><a:solidFill><a:srgbClr val="D0D7DE"/></a:solidFill></a:ln' + s + '>').join('') + '<a:solidFill><a:srgbClr val="' + (head ? accent : ri % 2 ? 'FFFFFF' : 'F6F8FA') + '"/></a:solidFill></a:tcPr></a:tc>'; }
            g += '</a:tr>';
          });
          g += '</a:tbl>';
          const h = Math.min(bottom - y, rh * rows.length); const id = shapeId++;
          shapes += '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="' + id + '" name="Table ' + id + '"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="' + left + '" y="' + Math.round(y) + '"/><a:ext cx="' + (cw * n) + '" cy="' + Math.round(h) + '"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">' + g + '</a:graphicData></a:graphic></p:graphicFrame>';
          y += h + 152400;
        }
        if (visuals) {
          const pics = []; for (const im of imgs) pics.push(await loadImageData(im.dataset.src || im.getAttribute('src'))); for (const d of diags) { const live = S.mermaidCache.get((isDark() ? 'd' : 'l') + d.dataset.code) || S.mermaidCache.get('w' + d.dataset.code); if (live) { const t = document.createElement('div'); t.innerHTML = live; document.body.appendChild(t); const svg = t.querySelector('svg'); pics.push(svg ? await loadImageData(null, svg) : null); t.remove(); } }
          const ok = pics.filter(Boolean); const areaX = paras.length || tables.length || codes.length ? left + textW + 228600 : left, areaW = (paras.length || tables.length || codes.length ? full - textW - 228600 : full), areaH = bottom - top;
          ok.forEach((d, k) => {
            const slotH = areaH / ok.length; let w = d.w * 9525, h = d.h * 9525; const s = Math.min(areaW / w, (slotH - 76200) / h, 1.6); w *= s; h *= s;
            const x = areaX + (areaW - w) / 2, yy = top + k * slotH + (slotH - h) / 2;
            const name = 'image' + (media.length + 1) + '.' + d.ext; media.push({ name: 'ppt/media/' + name, data: d.bytes });
            const rid = 'rId' + (rels.length + 1); rels.push('<Relationship Id="' + rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/' + name + '"/>');
            const id = shapeId++;
            shapes += '<p:pic><p:nvPicPr><p:cNvPr id="' + id + '" name="Picture ' + id + '"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="' + Math.round(x) + '" y="' + Math.round(yy) + '"/><a:ext cx="' + Math.round(w) + '" cy="' + Math.round(h) + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>';
          });
        }
        shapes += textBox(SW - 1371600, SH - 411480, 914400, 320040, [para(tx(String(si + 1), { sz: 1100, color: '8C959F' }), { algn: 'r', spc: 0 })], { name: 'Slide Number' });
      }
      const n = si + 1;
      if (notes.length) rels.push('<Relationship Id="rId' + (rels.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide' + n + '.xml"/>');
      files.push({ name: 'ppt/slides/slide' + n + '.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' + shapes + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>' });
      files.push({ name: 'ppt/slides/_rels/slide' + n + '.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels.join('') + '</Relationships>' });
      if (notes.length) {
        files.push({ name: 'ppt/notesSlides/notesSlide' + n + '.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>' + notes.join('\n').split('\n').map(l => '<a:p><a:r><a:rPr lang="zh-CN" altLang="en-US" dirty="0"/><a:t>' + xe(l) + '</a:t></a:r></a:p>').join('') + '</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>' });
        files.push({ name: 'ppt/notesSlides/_rels/notesSlide' + n + '.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="../notesMasters/notesMaster1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="../slides/slide' + n + '.xml"/></Relationships>' });
      }
    }
    const hasNotes = files.some(f => f.name.startsWith('ppt/notesSlides/notesSlide'));
    const theme = (name) => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="' + name + '"><a:themeElements><a:clrScheme name="MDView"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2328"/></a:dk2><a:lt2><a:srgbClr val="F6F8FA"/></a:lt2><a:accent1><a:srgbClr val="2F6FDB"/></a:accent1><a:accent2><a:srgbClr val="1A7F37"/></a:accent2><a:accent3><a:srgbClr val="BF8700"/></a:accent3><a:accent4><a:srgbClr val="8250DF"/></a:accent4><a:accent5><a:srgbClr val="CF222E"/></a:accent5><a:accent6><a:srgbClr val="0A7D8C"/></a:accent6><a:hlink><a:srgbClr val="2F6FDB"/></a:hlink><a:folHlink><a:srgbClr val="8250DF"/></a:folHlink></a:clrScheme><a:fontScheme name="MDView"><a:majorFont><a:latin typeface="Segoe UI"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Segoe UI"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="MDView"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>';
    const NSP = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
    const emptyTree = '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree>';
    const clrMap = '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>';
    const R = t => 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/' + t;
    const relsXml = arr => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + arr.map(([id, t, tg]) => '<Relationship Id="' + id + '" Type="' + R(t) + '" Target="' + tg + '"/>').join('') + '</Relationships>';
    const presRels = [['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'], ['rId2', 'theme', 'theme/theme1.xml'], ['rId3', 'presProps', 'presProps.xml'], ['rId4', 'viewProps', 'viewProps.xml'], ['rId5', 'tableStyles', 'tableStyles.xml']].concat(slides.map((_, i) => ['rId' + (10 + i), 'slide', 'slides/slide' + (i + 1) + '.xml']));
    if (hasNotes) presRels.push(['rId6', 'notesMaster', 'notesMasters/notesMaster1.xml']);
    const pres = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:presentation ' + NSP + ' saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' + (hasNotes ? '<p:notesMasterIdLst><p:notesMasterId r:id="rId6"/></p:notesMasterIdLst>' : '') + '<p:sldIdLst>' + slides.map((_, i) => '<p:sldId id="' + (256 + i) + '" r:id="rId' + (10 + i) + '"/>').join('') + '</p:sldIdLst><p:sldSz cx="' + SW + '" cy="' + SH + '"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:defPPr><a:defRPr lang="zh-CN"/></a:defPPr></p:defaultTextStyle></p:presentation>';
    const master = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sldMaster ' + NSP + '><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>' + emptyTree + '</p:cSld>' + clrMap + '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="3200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/></a:defRPr></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/></a:defRPr></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>';
    const layout = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:sldLayout ' + NSP + ' type="blank" preserve="1"><p:cSld name="Blank">' + emptyTree + '</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';
    const notesMaster = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:notesMaster ' + NSP + '><p:cSld>' + emptyTree + '</p:cSld>' + clrMap + '</p:notesMaster>';
    const ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/><Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/><Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' + (hasNotes ? '<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/><Override PartName="/ppt/theme/theme2.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' : '') + slides.map((_, i) => '<Override PartName="/ppt/slides/slide' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>').join('') + files.filter(f => /notesSlide\d+\.xml$/.test(f.name)).map(f => '<Override PartName="/' + f.name + '" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>').join('') + '</Types>';
    const core = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>' + xe(docTitle()) + '</dc:title><dc:creator>MDView</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">' + new Date().toISOString().slice(0, 19) + 'Z</dcterms:created></cp:coreProperties>';
    const all = [
      { name: '[Content_Types].xml', data: ct },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + R('officeDocument') + '" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>' },
      { name: 'docProps/core.xml', data: core },
      { name: 'ppt/presentation.xml', data: pres }, { name: 'ppt/_rels/presentation.xml.rels', data: relsXml(presRels) },
      { name: 'ppt/presProps.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:presentationPr ' + NSP + '/>' },
      { name: 'ppt/viewProps.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<p:viewPr ' + NSP + '><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>' },
      { name: 'ppt/tableStyles.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>' },
      { name: 'ppt/slideMasters/slideMaster1.xml', data: master }, { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: relsXml([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml']]) },
      { name: 'ppt/slideLayouts/slideLayout1.xml', data: layout }, { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: relsXml([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]) },
      { name: 'ppt/theme/theme1.xml', data: theme('MDView') }
    ];
    if (hasNotes) all.push({ name: 'ppt/notesMasters/notesMaster1.xml', data: notesMaster }, { name: 'ppt/notesMasters/_rels/notesMaster1.xml.rels', data: relsXml([['rId1', 'theme', '../theme/theme2.xml']]) }, { name: 'ppt/theme/theme2.xml', data: theme('MDView Notes') });
    const blob = zipFiles(all.concat(files, media), 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    window.__lastPptx = blob;
    await saveOut(baseOut() + '.pptx', blob, 'pptx', 'PowerPoint 演示文稿', blob.type);
  }

  init();
  window.MDView = { S, setMode, openDoc, commit, html2md, formatTable, switchTab, closeTab, newTab, NATIVE, openPaths, lineDiff, splitSlides, extractLinks, LX, VERSION, startEdit, renderLive, CMK, loadCM, get srcEd() { return srcEd; }, calc, parseTasks, refreshTasks, aiChat, exportDocx, exportPptx, exportEml, mailHtml, zipFiles, crc32, fillTpl, TEMPLATES, showTemplates, dailyNote, insertAtCursor, topLine };
})();
