/* ChipBench · panels-pro.js — redesigned "学习中心" (Learning Center) and "工程工具" (Engineering Tools) panels.

   Definitions (also in docs/MANUAL.md)
   · 学习中心 — turns a datasheet / manual into KNOWLEDGE YOU HAVE VERIFIED: manual → structure diagram (page-linked, "待核对 → 已确认"),
     study cards with spaced repetition, resource cards, chapter notes, reading progress, image hot-spots, cross-chip comparison.
     AI only drafts; every node must carry a page number and be confirmed by you.
   · 工程工具 — small, note-independent instruments an application engineer reaches for daily: number / bit calculator, baud-rate and
     CAN bit-timing, register bench, firmware / .map / log viewers and diffs, and one-click templates for pin maps, clock trees, structure diagrams.

   The panels re-use the existing click handlers (data-c / data-p / data-k) of 3.0, so behaviour is unchanged — only the surface is new. */
(function (G) {
  'use strict';
  const SL = G.ChipBench; if (!SL || !SL.U) { console.warn('[s31] panels: ChipBench not ready'); return; }
  const U = SL.U, d = document, esc = U.esc || (s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));
  const icon = n => { try { return SL.icon ? SL.icon(n) : ''; } catch (e) { return ''; } };
  const $ = (s, r) => (r || d).querySelector(s);

  const act = o => '<button type="button" class="act ' + (o.cls || '') + '"' + (o.attrs ? ' ' + o.attrs : '') + (o.title ? ' title="' + esc(o.title) + '"' : '') + '><span class="ic">' + icon(o.icon) + '</span><span class="tx"><b>' + o.t + (o.kb ? '<i class="kbd">' + o.kb + '</i>' : '') + '</b><small>' + o.s + '</small></span><span class="go">›</span></button>';

  const TOOLS = [
    { g: '计算与换算', items: [
      { k: 'calc', icon: 'tool', cls: 'k-amber', t: '数值换算器', s: '十六进制 / 二进制 / 十进制、位运算、KiB / MiB，输入即得结果', kb: 'Ctrl+Alt+K', q: 'hex bin dec 进制 位运算 calc' },
      { k: 'timing', icon: 'clock', cls: 'k-teal', t: '波特率 / CAN 位时序', s: '由时钟频率求分频、误差、采样点；给出可行的 Tq 组合', q: 'uart baud can bit timing 波特率 采样点' },
      { k: 'reg', icon: 'chip', cls: '', t: '寄存器工作台', s: '值 ⇄ 位域双向换算，可导入 SVD / 头文件，生成位域图', q: 'register svd 寄存器 位域' }] },
    { g: '固件与构建分析', items: [
      { k: 'openres', icon: 'file', cls: 'k-green', t: '打开资料文件…', s: 'PDF · Excel · Word · PPT · 邮件 · HEX · ELF · MAP · 日志', q: 'open pdf excel hex elf map log 打开' },
      { k: 'fwdiff', icon: 'columns', cls: 'k-violet', t: '固件对比', s: '两个 HEX / S-record / ELF 逐字节对比，列出差异区间', q: 'firmware diff hex elf 固件 对比' },
      { k: 'mapdiff', icon: 'layers', cls: 'k-rose', t: '构建大小对比', s: '两个 .map 的段与目标文件差异，找出“这次多了谁”', q: 'map size diff 构建 大小 对比' }] },
    { g: '车载以太网', items: [
      { k: 'pcap', icon: 'file', cls: 'k-teal', t: '抓包分析', s: '.pcap / .pcapng：协议分布、gPTP 同步、DoIP 会话、SOME/IP-SD、异常定位', q: 'pcap pcapng wireshark ethernet gptp doip someip 以太网 抓包' },
      { k: 'gclblock', icon: 'clock', cls: 'k-violet', local: 'gcl', t: 'TAS 门控列表', s: '802.1Qbv 时间轴；检查周期、Express/Preemptable 映射、保护带', q: 'tas gcl qbv tsn 门控 时间敏感' },
      { k: 'cbs', icon: 'tool', cls: 'k-amber', t: 'CBS 信用整形', s: '802.1Qav：由带宽算 idleSlope / sendSlope / hiCredit / loCredit', q: 'cbs qav credit shaper 整形' },
      { k: 'waveblock', icon: 'columns', cls: '', local: 'wavedrom', t: '时序图', s: 'WaveDrom 语法：SPI / CAN / 时钟波形，写在笔记里', q: 'wavedrom timing waveform 时序 波形' }] },
    { g: 'AI 与技能', items: [
      { k: 'skills', icon: 'ai', cls: 'k-green', t: '技能库', s: '内置 15 个 AE 技能；安装到工作区后 Copilot / Claude / Cursor 可直接使用', kb: 'Ctrl+Alt+S', q: 'skill skills agent ai 技能 mcp' }] },
    { g: '插入图表模板', items: [
      { k: 'pins', icon: 'table', cls: '', t: '引脚图', s: 'QFP / BGA 封装图，按功能（CAN、ADC…）高亮', q: 'pin pinout 引脚' },
      { k: 'clock', icon: 'clock', cls: 'k-teal', t: '时钟树', s: '改分频自动重算、超限标红，附波特率 / CAN / 定时器推算', q: 'clock tree 时钟' },
      { k: 'struct', icon: 'board', cls: 'k-violet', t: '结构图 / 数据流', s: '节点带页码、可核对；支持数据流逐步演示', q: 'structure diagram dataflow 结构 数据流' },
      { k: 'memmap', icon: 'layers', cls: 'k-amber', local: 'memmap', t: '内存占用图', s: 'Flash / RAM 分区占用条，悬停显示段与大小', q: 'memory map flash ram 内存' },
      { k: 'regblock', icon: 'chip', cls: '', local: 'register', t: '寄存器位域块', s: '在笔记中直接画出位域并解析当前值', q: 'register bitfield 寄存器' },
      { k: 'chartblock', icon: 'table', cls: 'k-green', local: 'chart', t: '曲线图', s: '折线 / 柱状图，数据写在代码块里', q: 'chart line bar 曲线' }] }
  ];
  const EKEY = 'tools.recent';
  async function renderTools() {
    const box = $('#pane-tools .side-b'); if (!box) return; const recent = (SL.store && await SL.store.get(EKEY, [])) || [];
    const all = TOOLS.flatMap(g => g.items), rec = recent.map(k => all.find(i => i.k === k)).filter(Boolean).slice(0, 3);
    box.innerHTML = '<div class="et"><div class="et-hero"><h3>工程工具</h3><p>围绕固件、寄存器与时序的随手小工具。不依赖某篇笔记——需要时按 <b>Ctrl+Alt+K</b> 或在这里点开。</p></div>' +
      '<label class="et-search">' + icon('search') + '<input class="input" id="et-q" placeholder="搜索工具：波特率 / hex / map …" autocomplete="off"></label>' +
      (rec.length ? '<div class="sec-h" data-sec="recent">最近使用</div>' + rec.map(i => act({ attrs: 'data-k="' + i.k + '"' + (i.local ? ' data-local="' + i.local + '"' : ''), icon: i.icon, cls: i.cls, t: i.t, s: i.s, kb: i.kb, title: i.t })).join('') : '') +
      TOOLS.map(g => '<div class="sec-h">' + g.g + '</div>' + g.items.map(i => act({ attrs: 'data-k="' + i.k + '" data-q="' + esc((i.t + ' ' + i.s + ' ' + (i.q || '')).toLowerCase()) + '"' + (i.local ? ' data-local="' + i.local + '"' : ''), icon: i.icon, cls: i.cls, t: i.t, s: i.s, kb: i.kb })).join('')).join('') +
      '<div class="et-empty hide" id="et-none">没有匹配的工具</div></div>';
  }
  function wireTools() {
    const pane = $('#pane-tools'); if (!pane || pane.__s31) return; pane.__s31 = true;
    pane.addEventListener('input', e => {
      if (e.target.id !== 'et-q') return; const q = e.target.value.trim().toLowerCase(); let n = 0;
      pane.querySelectorAll('.act[data-q]').forEach(b => { const hit = !q || b.dataset.q.includes(q); b.classList.toggle('hide', !hit); if (hit) n++; });
      pane.querySelectorAll('.sec-h').forEach(h => {
        if (h.dataset.sec === 'recent') { h.classList.toggle('hide', !!q); let x = h.nextElementSibling; while (x && x.classList.contains('act')) { x.classList.toggle('hide', !!q); x = x.nextElementSibling; } return; }
        let x = h.nextElementSibling, any = false; while (x && !x.classList.contains('sec-h')) { if (x.classList.contains('act') && !x.classList.contains('hide')) any = true; x = x.nextElementSibling; } h.classList.toggle('hide', !any);
      });
      const none = $('#et-none', pane); if (none) none.classList.toggle('hide', n > 0);
    });
    pane.addEventListener('click', async e => {
      const b = e.target.closest('[data-k]'); if (!b) return; const k = b.dataset.k;
      if (b.dataset.local) { const S = (SL.E && SL.E.tools && SL.E.tools.SNIP) || {}, sn = S[b.dataset.local]; if (sn && SL.insertIntoNote) SL.insertIntoNote(sn); }
      if (SL.store) { const cur = (await SL.store.get(EKEY, [])) || []; await SL.store.set(EKEY, [k].concat(cur.filter(x => x !== k)).slice(0, 6)); }
    });
  }

  const pad = n => (n < 10 ? '0' : '') + n;
  async function dueCount() {
    try {
      const X = SL.X, td = SL.today ? SL.today() : (() => { const t = new Date(); return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate()); })(); let due = 0, total = 0;
      for (const doc of SL.index.noteDocs()) { const rec = SL.index.search.docs.get(U.pkey(doc.path)), t = rec && rec.text; if (!t || !/(^|\n)(Q|问)[:：]/.test(t)) continue; for (const c of X.parseCards(t)) { total++; if (!c.state || !c.state.due || c.state.due <= td) due++; } }
      return { due, total };
    } catch (e) { return { due: 0, total: 0, err: true }; }
  }
  async function renderLearn() {
    const box = $('#pane-learn .side-b'); if (!box || !SL.learn) return; const rd = (await SL.learn.readingList()).slice(0, 8), cards = (() => { try { return SL.index.noteDocs().filter(x => x.props && x.props.type === 'card').length; } catch (e) { return 0; } })(), dc = await dueCount();
    const reading = rd.map(r => '<div class="rd" data-p="' + esc(r.path) + '" data-pg="' + r.page + '" title="' + esc(r.path) + '"><div class="t"><span class="badge k-pdf">PDF</span><b>' + esc(r.title) + '</b><small>' + r.page + ' / ' + r.N + '</small></div><div class="pg"><i style="width:' + Math.min(100, r.page / Math.max(1, r.N) * 100).toFixed(1) + '%"></i></div></div>').join('');
    box.innerHTML = '<div class="lc"><div class="lc-hero"><h3>学习中心</h3><p>把手册读成<b>可核对的知识</b>：结构图、复习卡片、资料卡片、阅读进度。AI 只负责起草——每个节点都带页码，由你确认。</p></div>' +
      '<div class="lc-stats"><button type="button" class="lc-stat' + (dc.due ? ' hot' : '') + '" data-c="study" title="开始复习"><b>' + dc.due + '</b><span>今日待复习</span></button><button type="button" class="lc-stat" data-c="library" title="打开资料卡片库"><b>' + cards + '</b><span>资料卡片</span></button><button type="button" class="lc-stat" data-c="chapters" title="章节笔记"><b>' + rd.length + '</b><span>阅读中</span></button></div>' +
      '<div class="sec-h">从手册学习</div><div class="flow-steps"><span>① 打开 PDF</span><i>›</i><span>② 选章节</span><i>›</i><span>③ 生成结构图</span><i>›</i><span>④ 核对页码</span></div>' +
      act({ attrs: 'data-c="fromPdf"', icon: 'book', cls: 'big', t: '手册 → 结构图', s: '时钟树、CAN、以太网、芯片框图、软件架构；节点带页码，数值与原文自动比对' }) +
      '<div class="sec-h">复习与整理</div>' +
      act({ attrs: 'data-c="study"', icon: 'cards', cls: 'k-green', t: '复习卡片', s: '间隔复习（SM-2）。在笔记里写 Q: / A: 即成卡片，p.123 可跳回手册' }) +
      act({ attrs: 'data-c="library"', icon: 'layers', cls: 'k-violet', t: '资料卡片库', s: '每份 PDF / 网页 / 表格一张卡片，汇总批注，可用 [[双链]] 引用' }) +
      act({ attrs: 'data-c="chapters"', icon: 'outline', cls: 'k-amber', t: '章节笔记', s: '按 PDF 书签批量创建章节笔记，并记录学习进度' }) +
      '<div class="sec-h">图与对比</div>' +
      act({ attrs: 'data-c="hotspot"', icon: 'image', cls: 'k-teal', t: '原图热区', s: '在手册框图上圈出区域，链接到页码或笔记' }) +
      act({ attrs: 'data-c="cross"', icon: 'chip', cls: 'k-rose', t: '跨芯片对比', s: '两颗芯片的同类结构并排，标出差异' }) +
      act({ attrs: 'data-cmd="learn.initseq"', icon: 'play', t: '初始化顺序清单', s: '由结构图生成：时钟使能 → 复位释放 → 配置 → 启动' }) +
      act({ attrs: 'data-cmd="learn.regtree"', icon: 'chip', cls: 'k-green', t: '模块寄存器树', s: '从 SVD 把结构图节点与寄存器关联' }) +
      '<div class="sec-h">阅读进度</div>' + (reading || '<div class="empty" style="padding:14px 6px">打开 PDF 手册后，这里记录读到哪一页，点击即可继续。</div>') + '</div>';
  }
  let lcBusy = false, lcObs = null;
  const ensureLearn = async () => { const box = $('#pane-learn .side-b'); if (!box || box.querySelector('.lc') || lcBusy) return; lcBusy = true; try { if (lcObs) lcObs.disconnect(); await renderLearn(); } finally { lcBusy = false; if (lcObs && box) lcObs.observe(box, { childList: true }); } };
  function wireLearn() {
    const pane = $('#pane-learn'); if (!pane || pane.__s31) return; pane.__s31 = true;
    pane.addEventListener('click', e => { const c = e.target.closest('[data-cmd]'); if (c && SL.run) SL.run(c.dataset.cmd); });
    const box = $('.side-b', pane); if (box) { lcObs = new MutationObserver(() => { if (!box.querySelector('.lc')) ensureLearn(); }); lcObs.observe(box, { childList: true }); }
    SL.on && SL.on('panel', id => { if (id === 'learn') setTimeout(ensureLearn, 30); });
    ensureLearn();
  }

  const install = () => { try { wireTools(); renderTools(); wireLearn(); } catch (e) { console.warn('[s31] panels install failed', e); } };
  SL.s31 = SL.s31 || {}; SL.s31.panels = { renderTools, renderLearn, ensureLearn, TOOLS };
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', () => setTimeout(install, 0)); else setTimeout(install, 0);
})(window);
