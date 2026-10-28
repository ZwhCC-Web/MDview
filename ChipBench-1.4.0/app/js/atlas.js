/* ChipBench 1.4 · atlas.js — IP 图谱
   One Markdown page per (IP × chip):  <atlas root>/<IP>/<chip>.md, front matter `type: ip-atlas`.
   Sections (## 概览 / 结构 / 场景 / 寄存器 / 时序 / 代码 / 要点与坑) become tabs; any other ## heading becomes an extra tab.
   New component ```scene: step-by-step walkthrough on top of the page's ```ipblock — highlighted modules and links,
   moving packet, narration, register changes decoded with the page's ```register blocks, highlighted code line, manual page.
   Sources: bundled pages (<install>/atlas, read-only) + workspace pages (any note with type: ip-atlas, found by the index).
   MCP mirrors this: atlas_list / atlas_read / atlas_create_page / atlas_write_section / atlas_add_scene / atlas_validate / atlas_compare. */
(function (G) {
  'use strict';
  const SL = G.ChipBench; if (!SL || !SL.app) return;
  const U = SL.U, X = SL.X, fs = SL.fs, $ = U.$, $$ = U.$$, esc = U.esc, h = U.h, A = SL.app;
  const AT = SL.atlas = { pages: [], cur: null };
  const SECTIONS = ['概览', '结构', '场景', '寄存器', '时序', '代码', '要点与坑'];
  const IPS = ['CAN-FD', 'Ethernet', 'DMA', '时钟', '中断', 'ADC', '定时器', 'SPI', 'I2C', 'UART', '电源 / 复位', '其他'];
  const join = (d, n) => X.join(d, n);
  const fenceRe = /```([\w-]+)[^\n]*\n([\s\S]*?)\n```/g;
  const num = v => { if (typeof v === 'number') return v >>> 0; const t = String(v == null ? '' : v).trim().replace(/_/g, ''); return (/^0x/i.test(t) ? parseInt(t, 16) : /^0b/i.test(t) ? parseInt(t.slice(2), 2) : parseInt(t, 10)) >>> 0 || 0; };
  const hex = (v, w) => '0x' + (v >>> 0).toString(16).toUpperCase().padStart(w || 8, '0');

  /* ---------------- page parsing ---------------- */
  AT.parse = text => {
    const fm = X.frontMatter(text || ''), body = fm.body, secs = [];
    const re = /^##\s+(.+?)\s*$/gm; let m, last = null, intro = '';
    while ((m = re.exec(body))) { if (last) last.text = body.slice(last.at, m.index); else intro = body.slice(0, m.index); last = { title: m[1].trim(), at: m.index + m[0].length }; secs.push(last); }
    if (last) last.text = body.slice(last.at); else intro = body;
    const blocks = []; let b; fenceRe.lastIndex = 0; while ((b = fenceRe.exec(text))) blocks.push({ lang: b[1].toLowerCase(), src: b[2], at: b.index });
    return { props: fm.props || {}, intro, secs, blocks, text };
  };
  AT.blocksOf = (P, lang) => P.blocks.filter(b => b.lang === lang);
  AT.regMap = P => { const out = {}; AT.blocksOf(P, 'register').forEach(b => { try { const y = X.yaml(b.src) || {}; if (y.name) out[String(y.name).toUpperCase()] = y; } catch (e) { } }); return out; };
  AT.findReg = (map, name) => { const n = String(name || '').toUpperCase(); if (map[n]) return map[n]; const k = Object.keys(map).find(x => x.endsWith(n) || n.endsWith(x)); return k ? map[k] : null; };

  /* ---------------- discovery ---------------- */
  AT.bundledDir = async () => { try { const p = await SL.invoke('mcp_script_path', {}); return p.replace(/[\\/]mcp[\\/][^\\/]+$/, '') + (p.includes('/') && !p.includes('\\') ? '/' : '\\') + 'atlas'; } catch (e) { return null; } };
  const metaOf = (path, text, bundled) => { const fm = X.frontMatter(text || ''); const p = fm.props || {}; if (String(p.type || '').toLowerCase() !== 'ip-atlas') return null; return { path, ip: String(p.ip || '其他'), chip: String(p.chip || U.base(path).replace(/\.md$/i, '')), family: p.family ? String(p.family) : '', status: String(p.status || '待核对'), source: p.source || '', bundled: !!bundled, steps: (text.match(/```scene/g) || []).length }; };
  AT.scan = async () => {
    const out = [];
    const bd = await AT.bundledDir();
    if (bd && (await fs.kind(bd)) === 'dir') { for (const d of await fs.list(bd)) { if (!d.is_dir) continue; for (const f of await fs.list(d.path)) { if (f.is_dir || !/\.md$/i.test(f.name)) continue; try { const mt = metaOf(f.path, (await fs.read(f.path)).text, true); if (mt) out.push(mt); } catch (e) { } } } }
    if (SL.index && SL.index.search) for (const [, r] of SL.index.search.docs) { if (!r || r.kind !== 'md' || !r.text || !/^---[\s\S]{0,400}type:\s*ip-atlas/i.test(r.text)) continue; const mt = metaOf(r.path, r.text, false); if (mt) out.push(mt); }
    // a workspace copy of a bundled page hides the bundled one
    const seen = new Set(out.filter(p => !p.bundled).map(p => (p.ip + '|' + p.chip).toLowerCase()));
    AT.pages = out.filter(p => !p.bundled || !seen.has((p.ip + '|' + p.chip).toLowerCase())).sort((a, b) => a.ip.localeCompare(b.ip) || a.chip.localeCompare(b.chip));
    SL.emit('atlas', AT.pages); return AT.pages;
  };
  AT.home = () => { const d = SL.wsHome && SL.wsHome.dirs && SL.wsHome.dirs(); const r = d ? d.home : (SL.ws && SL.ws.cur && SL.ws.cur.roots[0] && SL.ws.cur.roots[0].path); return r ? join(r, 'IP图谱') : null; };
  const safe = s => String(s || '').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();

  /* ---------------- side panel ---------------- */
  const SC = { 待核对: '', 已核对: 'ok', 草稿: 'warn', 有疑问: 'bad' };
  SL.registerPanel('atlas', 'IP 图谱', 'chip', { key: 'Ctrl+Shift+I', actions: '<button class="btn ghost icon sm" data-a="new" title="新建页面">' + SL.icon('plus') + '</button><button class="btn ghost icon sm" data-a="refresh" title="刷新">' + SL.icon('refresh') + '</button>', show: () => drawPanel(true) });
  let q = '', collapsed = new Set();
  async function drawPanel(rescan) {
    const pane = $('#pane-atlas'); if (!pane) return; const box = pane.querySelector('.side-b'); if (!box) return;
    if (rescan) await AT.scan();
    const ql = q.toLowerCase(), list = AT.pages.filter(p => !ql || (p.ip + ' ' + p.chip + ' ' + p.family).toLowerCase().includes(ql));
    const byIp = {}; list.forEach(p => (byIp[p.ip] = byIp[p.ip] || []).push(p));
    box.innerHTML = '<div class="at-search"><input class="input" placeholder="筛选 IP / 芯片…" value="' + esc(q) + '"></div>' +
      (Object.keys(byIp).length ? Object.keys(byIp).map(ip => '<div class="at-ip' + (collapsed.has(ip) ? ' col' : '') + '" data-ip="' + esc(ip) + '"><span class="chev">›</span><b>' + esc(ip) + '</b><span class="n">' + byIp[ip].length + '</span></div>' + (collapsed.has(ip) ? '' : byIp[ip].map(p => '<div class="at-row' + (AT.cur && AT.cur.path === p.path ? ' on' : '') + '" data-p="' + esc(p.path) + '" title="' + esc(p.path) + '"><span class="tx">' + esc(p.chip) + '</span>' + (p.bundled ? '<span class="chip">示例</span>' : '') + '<span class="chip ' + (SC[p.status] || '') + '">' + esc(p.status) + '</span></div>').join(''))).join('')
        : '<div class="empty">还没有 IP 图谱页面。<br>点右上角 ＋ 新建，或安装内置示例。</div>') +
      '<div class="at-foot muted">每页 = 一个 IP × 一颗芯片：结构、场景动画、寄存器、时序、代码。<br>页面是普通 Markdown，AI 可通过 MCP 读写。</div>';
    const inp = box.querySelector('.at-search input'); inp.oninput = () => { q = inp.value; const pos = inp.selectionStart; drawPanel(false).then(() => { const i = box.querySelector('.at-search input'); i.focus(); i.setSelectionRange(pos, pos); }); };
    box.querySelectorAll('.at-ip').forEach(e => e.onclick = () => { const ip = e.dataset.ip; collapsed.has(ip) ? collapsed.delete(ip) : collapsed.add(ip); drawPanel(false); });
    box.querySelectorAll('.at-row').forEach(e => e.onclick = () => AT.open(e.dataset.p));
  }
  document.addEventListener('click', e => { const b = e.target.closest('#pane-atlas [data-a]'); if (!b) return; if (b.dataset.a === 'new') AT.newPage(); if (b.dataset.a === 'refresh') drawPanel(true); });
  SL.on('index', U.debounce(() => { if ($('#pane-atlas.on')) drawPanel(true); }, 600));
  { const rb = $('#rail [data-p="atlas"]'), after = $('#rail [data-p="tools"]'); if (rb && after) after.after(rb); }

  /* ---------------- atlas page view ---------------- */
  const TABDEF = [['概览', '概览'], ['结构', '结构'], ['场景', '场景动画'], ['寄存器', '寄存器'], ['时序', '时序'], ['代码', '代码'], ['要点与坑', '要点与坑']];
  AT.open = async (path, tab) => {
    let text; try { text = (await fs.read(path)).text.replace(/\r\n?/g, '\n'); } catch (e) { return SL.toast('打不开：' + path, 3000, 'bad'); }
    const P = AT.parse(text), meta = AT.pages.find(p => p.path === path) || metaOf(path, text, false) || { ip: P.props.ip, chip: P.props.chip, status: P.props.status };
    AT.cur = { path, P, meta, tab: tab || (AT.cur && AT.cur.path === path ? AT.cur.tab : '概览') };
    const extra = P.secs.map(s => s.title).filter(t => !SECTIONS.includes(t));
    const tabs = TABDEF.filter(([k]) => k === '概览' || P.secs.some(s => s.title === k)).concat(extra.map(t => [t, t])).concat([['对比', '芯片对比']]);
    if (P.props.lab) tabs.push(['实验台', '交互实验台']);
    const head = h('div', { class: 'at-head' }, '<span class="chip">' + esc(meta.ip) + '</span><b class="at-chip">' + esc(meta.chip) + '</b><span class="chip at-st ' + (SC[meta.status] || '') + '">' + esc(meta.status || '待核对') + '</span><span class="sp"></span>' + (meta.bundled ? '<button class="btn sm" data-x="copy" title="复制到工作区后即可编辑">复制到工作区</button>' : '<button class="btn sm" data-x="edit">编辑源文件</button>') + '<button class="btn sm ghost" data-x="validate">检查</button>');
    SL.openFull('IP 图谱', (body) => {
      body.classList.add('at-body');
      const tb = h('div', { class: 'at-tabs', role: 'tablist' }, tabs.map(([k, t]) => '<button role="tab" data-t="' + esc(k) + '" class="' + (k === AT.cur.tab ? 'on' : '') + '">' + esc(t) + '</button>').join(''));
      const view = h('div', { class: 'at-view' });
      body.append(tb, view);
      tb.onclick = e => { const b = e.target.closest('[data-t]'); if (!b) return; AT.cur.tab = b.dataset.t; tb.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); renderTab(view); };
      renderTab(view);
    }, head);
    head.onclick = async e => { const b = e.target.closest('[data-x]'); if (!b) return; const a = b.dataset.x;
      if (a === 'edit') { SL.closeFull(); SL.openPath(path); }
      if (a === 'copy') AT.copyToWorkspace(path);
      if (a === 'validate') { const r = AT.validate(P); SL.modal({ title: '检查 · ' + meta.ip + ' / ' + meta.chip, body: h('div', { class: 'at-val' }, r.length ? '<ul>' + r.map(x => '<li class="' + x[0] + '"><span class="chip ' + (x[0] === 'err' ? 'bad' : x[0] === 'warn' ? 'warn' : 'ok') + '">' + ({ err: '错误', warn: '提醒', ok: '通过' }[x[0]]) + '</span> ' + esc(x[1]) + '</li>').join('') + '</ul>' : '<p>没有发现问题。</p>'), buttons: [{ t: '关闭', primary: true, v: 1 }] }); }
    };
    drawPanel(false);
  };
  function mdInto(el, text, P) { const r = SL.md.render(text || ''); el.innerHTML = '<div class="md at-md">' + r.blocks.map(b => b.html).join('') + '</div>'; return SL.enhance(el, { text: P.text, atlasFile: AT.cur && !AT.cur.meta.bundled ? AT.cur.path : null }); }
  function renderTab(view) {
    const { P, meta, tab } = AT.cur, sec = t => (P.secs.find(s => s.title === t) || {}).text || '';
    view.innerHTML = ''; view.scrollTop = 0;
    if (tab === '概览') {
      const f = P.props.facts && typeof P.props.facts === 'object' ? P.props.facts : {};
      const ov = h('div', { class: 'at-ov' }, '<div class="at-card at-facts"><div class="cap">关键参数</div>' + (Object.keys(f).length ? '<table class="tbl"><tbody>' + Object.keys(f).map(k => '<tr><th>' + esc(k) + '</th><td>' + esc(f[k]) + '</td></tr>').join('') + '</tbody></table>' : '<div class="muted">在 front matter 的 facts 里填写（用于芯片对比）</div>') + '<div class="at-src muted">' + [P.props.chapter, P.props.source].filter(Boolean).map(esc).join(' · ') + '</div></div><div class="at-ovtext"></div>');
      view.appendChild(ov); mdInto(ov.querySelector('.at-ovtext'), sec('概览') || P.intro, P);
      const nav = h('div', { class: 'at-card at-nav' }, '<div class="cap">本页内容</div>' + TABDEF.slice(1).map(([k, t]) => { const n = k === '场景' ? AT.blocksOf(P, 'scene').length : k === '寄存器' ? AT.blocksOf(P, 'register').length : null; return '<button class="act" data-go="' + k + '"' + (P.secs.some(s => s.title === k) ? '' : ' disabled') + '><span class="tx"><b>' + t + '</b>' + (n != null ? '<small>' + n + (k === '场景' ? ' 个场景' : ' 个寄存器') + '</small>' : '') + '</span></button>'; }).join(''));
      ov.appendChild(nav); nav.onclick = e => { const b = e.target.closest('[data-go]'); if (b && !b.disabled) document.querySelector('.at-tabs [data-t="' + b.dataset.go + '"]').click(); };
      return;
    }
    if (tab === '对比') return renderCompare(view, meta);
    if (tab === '实验台') { const lab = join(U.dir(AT.cur.path), P.props.lab); view.innerHTML = '<div class="at-card at-lab"><b>' + esc(P.props.lab) + '</b><p class="muted">完整的交互实验（帧结构与仲裁、位时序 / TDC、错误限制、IP 拆解、模式与初始化、寄存器浏览器、接收存储、发送路径、总线 Trace）。在新标签页中打开。</p><button class="btn primary" data-lab>打开实验台</button></div>'; view.querySelector('[data-lab]').onclick = () => { SL.closeFull(); SL.openPath(lab); }; return; }
    if (tab === '寄存器') return renderRegs(view, sec('寄存器'), P);
    const box = h('div', { class: 'at-sec' }); view.appendChild(box); mdInto(box, sec(tab), P);
  }
  function renderRegs(view, text, P) {
    const map = AT.regMap(P), names = Object.keys(map);
    const bar = h('div', { class: 'at-rbar' }, '<input class="input" placeholder="搜索寄存器或字段，如 RFSTS、TEC、BRS"><span class="muted">' + names.length + ' 个寄存器</span>');
    const box = h('div', { class: 'at-sec' }); view.append(bar, box); mdInto(box, text, P);
    bar.querySelector('input').oninput = e => { const v = e.target.value.trim().toUpperCase(); box.querySelectorAll('.widget[data-w="register"]').forEach(w => { const s = (w.dataset.src || '').toUpperCase(); const hit = !v || s.includes(v); w.style.display = hit ? '' : 'none'; const pv = w.previousElementSibling; if (pv && pv.tagName === 'P') pv.style.display = hit ? '' : 'none'; }); box.querySelectorAll('h3').forEach(h3 => h3.style.display = v ? 'none' : ''); };
  }
  async function renderCompare(view, meta) {
    if (!AT.pages.length) await AT.scan();
    const same = AT.pages.filter(p => p.ip === meta.ip); const rows = new Set(), data = [];
    for (const p of same) { let t = ''; try { t = (await fs.read(p.path)).text; } catch (e) { } const P = AT.parse(t), f = P.props.facts && typeof P.props.facts === 'object' ? P.props.facts : {}; Object.keys(f).forEach(k => rows.add(k)); data.push({ p, f, regs: Object.keys(AT.regMap(P)), scenes: AT.blocksOf(P, 'scene').length }); }
    const R = [...rows], allRegs = [...new Set(data.flatMap(d => d.regs))].sort();
    view.innerHTML = '<div class="at-card"><div class="cap">' + esc(meta.ip) + ' · ' + same.length + ' 颗芯片</div><div class="at-scroll"><table class="tbl at-cmp"><thead><tr><th>参数</th>' + data.map(d => '<th>' + esc(d.p.chip) + (d.p.path === AT.cur.path ? ' ●' : '') + '</th>').join('') + '</tr></thead><tbody>' +
      R.map(k => { const vals = data.map(d => d.f[k] == null ? '' : String(d.f[k])); const diff = new Set(vals.filter(Boolean)).size > 1; return '<tr' + (diff ? ' class="diff"' : '') + '><th>' + esc(k) + '</th>' + vals.map(v => '<td>' + (v ? esc(v) : '<span class="muted">—</span>') + '</td>').join('') + '</tr>'; }).join('') +
      '<tr><th>场景数</th>' + data.map(d => '<td>' + d.scenes + '</td>').join('') + '</tr><tr><th>寄存器数</th>' + data.map(d => '<td>' + d.regs.length + '</td>').join('') + '</tr></tbody></table></div>' +
      (same.length < 2 ? '<p class="muted">同一 IP 只有这一颗芯片。新建同 IP 的其他芯片页面（facts 用相同的参数名），这里会自动并排对比，不同之处高亮。</p>' : '') + '</div>' +
      (same.length > 1 ? '<div class="at-card"><div class="cap">寄存器对照（● 有 / — 无）</div><div class="at-scroll"><table class="tbl at-cmp"><thead><tr><th>寄存器</th>' + data.map(d => '<th>' + esc(d.p.chip) + '</th>').join('') + '</tr></thead><tbody>' + allRegs.map(r => { const has = data.map(d => d.regs.includes(r)); return '<tr' + (has.some(x => !x) ? ' class="diff"' : '') + '><th class="mono">' + esc(r) + '</th>' + has.map(x => '<td>' + (x ? '●' : '<span class="muted">—</span>') + '</td>').join('') + '</tr>'; }).join('') + '</tbody></table></div></div>' : '');
  }

  /* ---------------- validation (same rules as MCP atlas_validate) ---------------- */
  AT.validate = P => {
    const out = [], p = P.props;
    ['ip', 'chip'].forEach(k => { if (!p[k]) out.push(['err', 'front matter 缺少 ' + k]); });
    if (!p.source) out.push(['warn', '没有 source（手册文件名），页码链接无法跳转']);
    const ipbs = AT.blocksOf(P, 'ipblock').map(b => { try { return X.yaml(b.src) || {}; } catch (e) { out.push(['err', 'ipblock YAML 解析失败']); return {}; } });
    if (!ipbs.length) out.push(['warn', '没有 ```ipblock 结构图']);
    const regs = AT.regMap(P);
    ipbs.forEach(y => { const ids = new Set([].concat(y.blocks || [], y.groups || []).map(b => String(b.id))); (y.links || []).forEach(l => { if (!ids.has(String(l.from)) || !ids.has(String(l.to))) out.push(['err', '结构图 “' + (y.title || '') + '” 连线 ' + l.from + ' → ' + l.to + ' 引用了不存在的模块']); }); (y.blocks || []).forEach(b => [].concat(b.regs || []).forEach(r => { if (Object.keys(regs).length && !AT.findReg(regs, r)) out.push(['warn', '模块 ' + b.id + ' 引用的寄存器 ' + r + ' 在“寄存器”中没有定义']); })); });
    const codes = AT.blocksOf(P, 'c').concat(AT.blocksOf(P, 'cpp'));
    AT.blocksOf(P, 'scene').forEach((b, si) => { let y; try { y = X.yaml(b.src) || {}; } catch (e) { return out.push(['err', '场景 ' + (si + 1) + ' YAML 解析失败']); }
      const dg = ipbs.find(x => !y.diagram || String(x.title) === String(y.diagram)); if (!dg) return out.push(['err', '场景 “' + (y.title || si + 1) + '” 的 diagram “' + y.diagram + '” 找不到对应的结构图']);
      const ids = new Set([].concat(dg.blocks || [], dg.groups || []).map(x => String(x.id))), lk = new Set((dg.links || []).map(l => l.from + '>' + l.to));
      (y.steps || []).forEach((s, i) => { const tag = '场景 “' + (y.title || si + 1) + '” 第 ' + (i + 1) + ' 步';
        [].concat(s.hl || []).forEach(id => { if (!ids.has(String(id))) out.push(['err', tag + '：高亮的模块 ' + id + ' 不存在']); });
        [].concat(s.links || []).forEach(l => { const [a, c] = String(l).split('>'); if (!lk.has(a + '>' + c) && !lk.has(c + '>' + a)) out.push(['warn', tag + '：连线 ' + l + ' 在结构图中不存在']); });
        [].concat(s.regs || []).forEach(r => { if (!AT.findReg(regs, r.r)) out.push(['warn', tag + '：寄存器 ' + r.r + ' 在“寄存器”中没有定义（无法按位域解码）']); });
        if (s.line != null) { const cb = codes[y.code != null ? +y.code : 0]; if (!cb) out.push(['warn', tag + '：引用了代码行，但没有对应的 ```c 代码块']); else if (+s.line < 1 || +s.line > cb.src.split('\n').length) out.push(['warn', tag + '：代码行 ' + s.line + ' 超出范围']); }
        if (!s.x) out.push(['warn', tag + '：缺少讲解文字 x']); });
      if (!(y.steps || []).length) out.push(['warn', '场景 “' + (y.title || si + 1) + '” 没有步骤']); });
    const nopage = ipbs.flatMap(y => (y.blocks || []).filter(b => b.page == null)).length; if (p.source && nopage) out.push(['warn', nopage + ' 个模块没有手册页码']);
    if (!out.some(x => x[0] !== 'ok')) out.push(['ok', '结构、场景、寄存器、代码引用一致']);
    return out;
  };

  /* ---------------- new page / copy ---------------- */
  AT.template = (ip, chip, source) => '---\ntype: ip-atlas\nip: ' + ip + '\nchip: ' + chip + '\nsource: ' + (source || '') + '\nchapter: \nstatus: 草稿\nfacts: {}\n---\n# ' + ip + ' · ' + chip + '\n\n## 概览\n\n（这个 IP 做什么、主要组成、收发 / 处理主线。）\n\n## 结构\n\n```ipblock\ntitle: ' + ip + ' 结构\nsource: ' + (source || '') + '\ngroups:\n  - {id: ip, label: ' + ip + '}\nblocks:\n  - {id: cpu, label: CPU, kind: cpu}\n  - {id: reg, label: 寄存器接口, kind: bus, group: ip}\n  - {id: core, label: 核心逻辑, kind: logic, group: ip}\n  - {id: irq, label: 中断, kind: irq, group: ip}\nlinks:\n  - {from: cpu, to: reg, kind: bus}\n  - {from: reg, to: core, kind: ctrl}\n  - {from: core, to: irq, kind: irq}\n```\n\n## 场景\n\n```scene\ntitle: 基本流程\ndiagram: ' + ip + ' 结构\nsteps:\n  - {t: CPU 配置, hl: [cpu, reg], links: [cpu>reg], x: 说明这一步做了什么。}\n  - {t: 处理, hl: [reg, core], links: [reg>core], x: 说明这一步做了什么。}\n  - {t: 中断, hl: [core, irq], links: [core>irq], x: 说明这一步做了什么。}\n```\n\n## 寄存器\n\n```register\nname: CTRL\naddress: 0x00000000\nwidth: 32\nfields:\n  - {name: EN, bits: "0", desc: 使能}\n```\n\n## 时序\n\n## 代码\n\n```c\n/* 初始化与使用示例 */\n```\n\n## 要点与坑\n\n- \n';
  AT.newPage = async () => {
    const root = AT.home(); if (!root) return SL.toast('请先在工作区添加文件夹或设置主文件夹', 3500, 'warn');
    const body = h('div', { class: 'wsn' }, '<label class="pref"><span>IP</span><input class="input" id="atn-ip" list="atn-ips" value="CAN-FD" style="width:240px"><datalist id="atn-ips">' + IPS.map(x => '<option value="' + esc(x) + '">').join('') + '</datalist></label><label class="pref"><span>芯片<small>例如 RH850/U2A、RA8M1</small></span><input class="input" id="atn-chip" style="width:240px"></label><label class="pref"><span>手册文件名<small>可选，用于页码跳转</small></span><input class="input" id="atn-src" style="width:240px"></label><div class="muted" id="atn-hint" style="font-size:var(--fs-sm)">保存到：' + esc(root) + '\\&lt;IP&gt;\\&lt;芯片&gt;.md</div>');
    const r = await SL.modal({ title: '新建 IP 图谱页面', body, buttons: [{ t: '取消', v: null }, { t: '创建', primary: true, v: 'ok', fn: () => { if (!$('#atn-chip', body).value.trim()) { $('#atn-hint', body).textContent = '请填写芯片'; return false; } } }] });
    if (r !== 'ok') return; const ip = $('#atn-ip', body).value.trim() || '其他', chip = $('#atn-chip', body).value.trim(), src = $('#atn-src', body).value.trim();
    const dir = join(root, safe(ip)); await fs.mkdir(root).catch(() => { }); await fs.mkdir(dir).catch(() => { });
    const p = join(dir, safe(chip).replace(/\//g, '-') + '.md'); if ((await fs.kind(p)) !== 'none') return SL.toast('已存在：' + p, 3500, 'warn');
    await fs.write(p, AT.template(ip, chip, src)); if (SL.index && SL.index.refreshFile) await SL.index.refreshFile(p); await AT.scan(); AT.open(p); SL.toast('已创建 ' + U.base(p));
  };
  AT.copyToWorkspace = async path => {
    const root = AT.home(); if (!root) return SL.toast('请先在工作区添加文件夹或设置主文件夹', 3500, 'warn');
    const ip = U.base(U.dir(path)), dir = join(root, ip); await fs.mkdir(root).catch(() => { }); await fs.mkdir(dir).catch(() => { });
    const dst = join(dir, U.base(path)); if ((await fs.kind(dst)) !== 'none' && !(await SL.confirm('工作区里已有 ' + U.base(path) + '，覆盖？'))) return;
    const t = (await fs.read(path)).text; await fs.write(dst, t);
    const lab = (X.frontMatter(t).props || {}).lab; if (lab) { try { await fs.writeBytes(join(dir, lab), await fs.readBytes(join(U.dir(path), lab))); } catch (e) { } }
    if (SL.index && SL.index.refreshFile) await SL.index.refreshFile(dst); await AT.scan(); SL.toast('已复制到 ' + dir); AT.open(dst);
  };
  SL.cmd('atlas.open', 'IP 图谱', () => SL.panel('atlas'), { group: '工程', key: 'Ctrl+Shift+I' });
  SL.cmd('atlas.new', '新建 IP 图谱页面…', () => AT.newPage(), { group: '工程' });

  /* ---------------- ```scene widget ---------------- */
  const pageText = ctx => (ctx && ctx.text) || (ctx && ctx.view && ctx.view.state.doc.toString()) || (A.current() && A.current().kind === 'md' ? A.textOf(A.current()) : '');
  const fval = (v, hi, lo) => Number((BigInt(v >>> 0) >> BigInt(lo)) & ((1n << BigInt(hi - lo + 1)) - 1n));
  const bitsOf = s => { const [a, b] = String(s).split(':'); const hi = +a, lo = b == null ? hi : +b; return [Math.max(hi, lo), Math.min(hi, lo)]; };
  function regCard(def, name, v, prev, note) {
    const w = (def && +def.width) || 32, fsx = (def && def.fields) || [];
    const cells = fsx.map(f => { const [hi, lo] = bitsOf(f.bits), x = fval(v, hi, lo), px = prev == null ? x : fval(prev, hi, lo), ww = hi - lo + 1; const vals = f.values || {}; const mean = vals[x] != null ? vals[x] : ''; return '<div class="sc-f' + (x !== px ? ' ch' : '') + (x ? ' nz' : '') + '" style="flex:' + Math.max(1.4, Math.min(ww, 8) * .5) + '" title="' + esc(f.name + ' [' + f.bits + '] = ' + x + (f.desc ? '\n' + f.desc : '')) + '"><span class="n">' + esc(f.name) + '</span><span class="v">' + (ww === 1 ? x : '0x' + x.toString(16).toUpperCase()) + '</span>' + (mean ? '<span class="m">' + esc(mean) + '</span>' : '') + '</div>'; }).join('');
    return '<div class="sc-reg' + (prev != null && prev !== v ? ' chg' : '') + '"><div class="sc-rh"><b class="mono">' + esc(name) + '</b>' + (def && def.address != null ? '<span class="muted mono">@ ' + esc(typeof def.address === 'number' ? hex(def.address) : def.address) + '</span>' : '') + '<span class="sp"></span><span class="mono">' + (prev != null && prev !== v ? '<span class="muted">' + hex(prev, w / 4) + ' → </span>' : '') + '<b>' + hex(v, w / 4) + '</b></span></div>' + (cells ? '<div class="sc-fs">' + cells + '</div>' : '<div class="muted sc-nodef">未在“寄存器”中定义，无法按位域解码</div>') + (note ? '<div class="sc-note">' + esc(note) + '</div>' : '') + '</div>';
  }
  async function scene(src, ctx) {
    const y = X.yaml(src) || {}, steps = [].concat(y.steps || []).filter(Boolean), text = pageText(ctx), P = AT.parse(text), regs = AT.regMap(P);
    const ipb = AT.blocksOf(P, 'ipblock').find(b => { try { const t = (X.yaml(b.src) || {}).title; return !y.diagram || String(t) === String(y.diagram); } catch (e) { return false; } });
    const codes = AT.blocksOf(P, 'c').concat(AT.blocksOf(P, 'cpp')).sort((a, b) => a.at - b.at), code = codes[y.code != null ? +y.code : 0];
    const root = h('div', { class: 'sc', tabindex: '0' });
    root.innerHTML = '<div class="dg-bar sc-bar"><span class="t">' + esc(y.title || '场景') + '</span><span class="chip">' + steps.length + ' 步</span><span class="sp"></span><button class="btn sm ghost" data-a="first" title="回到第 1 步">⟲</button><button class="btn sm ghost" data-a="prev" title="上一步 (←)">◀</button><button class="btn sm primary" data-a="play">▶ 播放</button><button class="btn sm ghost" data-a="next" title="下一步 (→)">▶</button><label class="tog sc-cam" title="镜头跟随当前步骤的模块"><input type="checkbox" data-a="cam" checked>镜头跟随</label><select class="select sm" data-a="speed" title="播放速度"><option value="4500">慢</option><option value="2800" selected>中</option><option value="1600">快</option></select></div>' +
      '<div class="sc-body"><div class="sc-dg"><div class="empty">' + (ipb ? '加载结构图…' : '本页没有 ```ipblock 结构图' + (y.diagram ? '（diagram: ' + esc(y.diagram) + '）' : '')) + '</div></div><div class="sc-nar"></div></div><div class="sc-steps"></div>';
    const dg = root.querySelector('.sc-dg'), nar = root.querySelector('.sc-nar'), pills = root.querySelector('.sc-steps');
    let i = 0, timer = null, svg = null;
    if (!steps.length) { nar.innerHTML = '<div class="empty">steps 为空</div>'; return root; }
    pills.innerHTML = steps.map((s, k) => '<button data-k="' + k + '" title="' + esc(s.t || '') + '"><i>' + (k + 1) + '</i><span>' + esc(s.t || '步骤 ' + (k + 1)) + '</span></button>').join('');
    const state = k => { const st = {}; for (let j = 0; j < k; j++) [].concat(steps[j].regs || []).forEach(r => { st[String(r.r).toUpperCase()] = num(r.v); }); return st; };
    const go = k => {
      i = Math.max(0, Math.min(steps.length - 1, k)); const s = steps[i], prev = state(i);
      pills.querySelectorAll('button').forEach((b, j) => { b.classList.toggle('on', j === i); b.classList.toggle('done', j < i); });
      const on = pills.querySelector('.on'); if (on && pills.scrollWidth > pills.clientWidth) pills.scrollLeft = on.offsetLeft - pills.clientWidth / 2 + on.offsetWidth / 2;
      if (svg) {
        const hl = new Set([].concat(s.hl || []).map(String)), lk = new Set([].concat(s.links || []).map(String));
        svg.classList.toggle('sc-focus', hl.size > 0);
        svg.querySelectorAll('.ipb-node').forEach(n => { n.classList.toggle('lit', hl.has(n.dataset.id)); });
        svg.querySelectorAll('.ipb-group').forEach(g => g.classList.toggle('lit', hl.has(g.dataset.id)));
        cam(hl);
        svg.querySelectorAll('.sc-pk').forEach(p => p.remove());
        svg.querySelectorAll('.ipb-edge').forEach(e => { const f = e.dataset.from, t = e.dataset.to, hit = lk.has(f + '>' + t) || lk.has(t + '>' + f); e.classList.toggle('lit', hit);
          if (hit) { const path = e.querySelector('path'), d = path && path.getAttribute('d'); if (d) { const rev = lk.has(t + '>' + f) && !lk.has(f + '>' + t); const NS = 'http://www.w3.org/2000/svg', g = document.createElementNS(NS, 'circle'); g.setAttribute('r', '5.5'); g.setAttribute('class', 'sc-pk'); const am = document.createElementNS(NS, 'animateMotion'); am.setAttribute('dur', '1.4s'); am.setAttribute('repeatCount', 'indefinite'); am.setAttribute('path', d); if (rev) { am.setAttribute('keyPoints', '1;0'); am.setAttribute('keyTimes', '0;1'); am.setAttribute('calcMode', 'linear'); } g.appendChild(am); e.appendChild(g); } } });
      }
      const rs = [].concat(s.regs || []);
      let codeHtml = '';
      if (code && s.line != null) { const L = code.src.split('\n'), ln = +s.line, a = Math.max(0, ln - 4), b = Math.min(L.length, ln + 3); codeHtml = '<div class="sc-sec">代码</div><pre class="sc-code">' + L.slice(a, b).map((l, j) => '<span class="' + (a + j + 1 === ln ? 'on' : '') + '"><i>' + (a + j + 1) + '</i>' + esc(l) + '</span>').join('\n') + '</pre>'; }
      nar.innerHTML = '<div class="sc-tag">STEP ' + (i + 1) + ' / ' + steps.length + '</div><h4>' + esc(s.t || '') + '</h4><div class="sc-x md">' + (s.x ? SL.md.inline ? SL.md.inline(String(s.x)) : esc(s.x) : '') + '</div>' +
        (s.page != null ? '<a href="#" class="sc-page" data-page="' + esc(s.page) + '">手册 p.' + esc(s.page) + '</a>' : '') +
        (rs.length ? '<div class="sc-sec">寄存器变化</div>' + rs.map(r => { const n = String(r.r), v = num(r.v), pv = prev[n.toUpperCase()]; return regCard(AT.findReg(regs, n), n, v, pv, r.n); }).join('') : '') + codeHtml;
      const pg = nar.querySelector('[data-page]'); if (pg) pg.onclick = e => { e.preventDefault(); SL.gotoPage && SL.gotoPage(P.props.source || (X.yaml(ipb ? ipb.src : '') || {}).source, +s.page); };
    };
    let vb0 = null, vbAnim = 0;
    const setVB = v => svg.setAttribute('viewBox', v.map(x => x.toFixed(1)).join(' '));
    const cam = hl => {
      if (!svg) return; if (!vb0) vb0 = (svg.getAttribute('viewBox') || '0 0 100 100').split(/\s+/).map(Number);
      let to = vb0;
      if (root.querySelector('[data-a=cam]').checked && hl.size) {
        let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
        svg.querySelectorAll('.ipb-node').forEach(n => { if (!hl.has(n.dataset.id)) return; const b = n.querySelector('.ipb-box').getBBox(); x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y); x2 = Math.max(x2, b.x + b.width); y2 = Math.max(y2, b.y + b.height); });
        if (x2 > x1) { const box = dg.getBoundingClientRect(), ar = (box.width || 800) / Math.max(320, Math.min(540, box.height || 460)); let w = x2 - x1 + 140, hh = y2 - y1 + 120; w = Math.max(w, vb0[2] * .32); hh = Math.max(hh, vb0[3] * .32); if (w / hh < ar) w = hh * ar; else hh = w / ar; w = Math.min(w, vb0[2]); hh = Math.min(hh, Math.max(vb0[3], w / ar)); to = [(x1 + x2) / 2 - w / 2, (y1 + y2) / 2 - hh / 2, w, hh]; }
      }
      const from = (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number), t0 = performance.now(); cancelAnimationFrame(vbAnim);
      const f = t => { const k = Math.min(1, (t - t0) / 520), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; setVB(from.map((a, j) => a + (to[j] - a) * e)); if (k < 1) vbAnim = requestAnimationFrame(f); };
      if (from.length === 4 && from.every(isFinite)) vbAnim = requestAnimationFrame(f); else setVB(to);
    };
    const stop = () => { clearInterval(timer); timer = null; root.querySelector('[data-a=play]').textContent = '▶ 播放'; };
    const play = () => { if (timer) return stop(); if (i >= steps.length - 1) go(0); timer = setInterval(() => { if (!root.isConnected) return stop(); if (i >= steps.length - 1) return stop(); go(i + 1); }, +root.querySelector('[data-a=speed]').value); root.querySelector('[data-a=play]').textContent = '❚❚ 暂停'; };
    root.querySelector('.sc-bar').addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT') return; const a = b.dataset.a; if (a === 'play') return play(); stop(); if (a === 'first') go(0); if (a === 'prev') go(i - 1); if (a === 'next') go(i + 1); });
    root.querySelector('[data-a=speed]').onchange = () => { if (timer) { stop(); play(); } };
    root.querySelector('[data-a=cam]').onchange = () => go(i);
    pills.onclick = e => { const b = e.target.closest('[data-k]'); if (b) { stop(); go(+b.dataset.k); } };
    root.addEventListener('keydown', e => { if (e.key === 'ArrowRight') { stop(); go(i + 1); e.preventDefault(); } if (e.key === 'ArrowLeft') { stop(); go(i - 1); e.preventDefault(); } if (e.key === ' ') { play(); e.preventDefault(); } });
    go(0);
    if (ipb) (async () => { try { const el = await SL.ipblock.render(ipb.src, {}); dg.innerHTML = ''; const bar = el.querySelector('.dg-bar'); if (bar) bar.remove(); el.classList.add('sc-ipb'); dg.appendChild(el); const wait = () => new Promise(r => { const t0 = Date.now(), f = () => { svg = el.querySelector('.ipb-svg'); if (svg || Date.now() - t0 > 20000) r(); else setTimeout(f, 60); }; f(); }); await wait(); go(i); } catch (e) { dg.innerHTML = '<div class="dg-issues"><span class="chip bad">结构图渲染失败：' + esc(e.message || e) + '</span></div>'; } })();
    return root;
  }
  const hook = () => { const Pz = SL.widgets && SL.widgets.PARSE; if (!Pz) return false; Pz.scene = (s, c) => scene(s, c); if (SL.md && SL.md.WIDGETS) SL.md.WIDGETS.add('scene'); const S = SL.E && SL.E.tools && SL.E.tools.SNIP; if (S) S.scene = SNIP; return true; };
  const SNIP = '```scene\ntitle: 场景名称\ndiagram: （本页 ipblock 的 title）\nsteps:\n  - {t: 第一步, hl: [cpu], links: [], regs: [{r: CTRL, v: 0x1, n: EN = 1}], x: 这一步发生了什么。}\n  - {t: 第二步, hl: [core], x: 说明。}\n```';
  AT.SNIP = SNIP; hook(); SL.on('ready', hook);
  SL.cmd('insert.scene', '插入场景动画（scene）', () => SL.insertIntoNote(SNIP), { group: '插入', icon: 'board' });

  /* atlas pages opened in the full view are not in the editor: status buttons write straight to the file */
  const rw0 = SL.widgets && SL.widgets.rewrite;
  if (rw0) SL.widgets.rewrite = async (ctx, el, fn) => {
    if (!(ctx && ctx.atlasFile)) { if (ctx && !ctx.view && AT.cur && AT.cur.meta && AT.cur.meta.bundled && el.closest('.fp')) return SL.toast('这是内置示例页：先“复制到工作区”再修改', 3500, 'warn'); return rw0(ctx, el, fn); }
    const w = el.closest('.widget'), src = w && w.dataset.src; if (!src) return;
    const t = (await fs.read(ctx.atlasFile)).text.replace(/\r\n?/g, '\n'), i = t.indexOf(src); if (i < 0) return SL.toast('源文件已变化，请重新打开', 3000, 'warn');
    let m; try { m = X.yaml(src); } catch (e) { return; } fn(m); const ny = X.toYaml(m).replace(/\n$/, '');
    await fs.write(ctx.atlasFile, t.slice(0, i) + ny + t.slice(i + src.length)); if (SL.index && SL.index.refreshFile) SL.index.refreshFile(ctx.atlasFile);
    AT.open(ctx.atlasFile, AT.cur && AT.cur.tab);
  };
})(window);
