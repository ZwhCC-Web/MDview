/* ChipBench · skills.js — Agent Skills library (SKILL.md folders, the open format read by GitHub Copilot, Claude, Cursor, Codex …)
   Sources:  ① bundled skills shipped with ChipBench (<install>/skills)   ② <each workspace root>/.agents/skills/*
   Actions:  open SKILL.md · install a bundled skill into the workspace · create a new skill from a template.
   The MCP server (mcp/chipbench_mcp.py) exposes the same skills to external AI tools (list_skills / read_skill). */
(function (G) {
  'use strict';
  const SL = G.ChipBench; if (!SL) return;
  const U = SL.U, $ = U.$, esc = U.esc, h = U.h, fs = SL.fs, X = SL.X;
  const SK = SL.skills = {};
  const join = (d, n) => X.join ? X.join(d, n) : String(d).replace(/[\\/]+$/, '') + '\\' + n;
  SK.parse = text => { const m = String(text || '').match(/^---\s*\n([\s\S]*?)\n---/); const meta = m ? (X.yaml ? X.yaml(m[1]) : {}) : {}; return { name: meta.name || '', description: meta.description || '', meta, body: m ? text.slice(m[0].length) : text }; };
  SK.bundledDir = async () => { try { const p = await SL.invoke('mcp_script_path', {}); return p.replace(/[\\/]mcp[\\/][^\\/]+$/, '') + (p.includes('/') && !p.includes('\\') ? '/' : '\\') + 'skills'; } catch (e) { return null; } };
  const scan = async (dir, source) => { const out = []; if (!dir || (await fs.kind(dir)) !== 'dir') return out; for (const e of await fs.list(dir)) { if (!e.is_dir) continue; const f = join(e.path, 'SKILL.md'); if ((await fs.kind(f)) !== 'file') continue; try { const s = SK.parse((await fs.read(f)).text); out.push({ name: s.name || e.name, description: s.description, dir: e.path, file: f, source, folder: e.name }); } catch (er) { } } return out.sort((a, b) => a.name.localeCompare(b.name)); };
  SK.list = async () => { const all = []; const b = await SK.bundledDir(); all.push(...await scan(b, 'bundled')); const roots = (SL.ws && SL.ws.cur && SL.ws.cur.roots) || []; for (const r of roots) all.push(...(await scan(join(join(r.path, '.agents'), 'skills'), r.name || U.base(r.path))).map(x => Object.assign(x, { root: r.path }))); return all; };
  const copyDir = async (from, to) => { await fs.mkdir(to); for (const e of await fs.list(from)) { const d = join(to, e.name); if (e.is_dir) await copyDir(e.path, d); else await fs.writeBytes(d, await fs.readBytes(e.path)); } };
  SK.install = async (skill, rootPath) => { const dest = join(join(join(rootPath, '.agents'), 'skills'), skill.folder); if (await fs.exists(dest)) { SL.toast('工作区里已有同名技能：' + skill.folder); return dest; } await fs.mkdir(join(join(rootPath, '.agents'), 'skills')).catch(() => { }); await copyDir(skill.dir, dest); SL.toast('已安装到 ' + dest); return dest; };
  const TEMPLATE = n => '---\nname: ' + n + '\ndescription: 用一句话说明这个技能做什么、什么时候该用（AI 靠这句话决定是否加载）。\n---\n\n# ' + n + '\n\n## 什么时候用\n\n- \n\n## 输入\n\n- \n\n## 步骤\n\n1. \n2. \n3. \n\n## 输出格式\n\n- 结论必须附出处（文件 + 页码 / 行号）。\n- AI 生成的内容标记为“待确认”。\n';
  SK.create = async (rootPath, name) => { const n = String(name || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, ''); if (!n) return; const dir = join(join(join(rootPath, '.agents'), 'skills'), n); if (await fs.exists(dir)) { SL.toast('已存在：' + n); return; } await fs.mkdir(dir); const f = join(dir, 'SKILL.md'); await fs.write(f, TEMPLATE(n)); SL.openPath(f); };

  async function open() {
    const roots = (SL.ws && SL.ws.cur && SL.ws.cur.roots) || [], body = h('div', { class: 'skl' });
    body.innerHTML = '<div class="row" style="gap:8px;margin-bottom:10px"><input class="input" id="sk-q" placeholder="搜索技能：以太网 / CAN / 周报 / 手册…" style="flex:1"><button class="btn sm" data-a="new">新建技能</button></div><div id="sk-list"><div class="empty">正在扫描…</div></div><p class="muted" style="margin-top:10px">技能是一个包含 SKILL.md 的文件夹，放在工作区根目录的 <code>.agents/skills/</code> 下。GitHub Copilot、Claude、Cursor 等 AI 工具可以直接读取；ChipBench 的 MCP 服务也会通过 list_skills / read_skill 提供给 AI。</p>';
    let all = [], loaded = false; const draw = () => { if (!loaded) return; const q = ($('#sk-q', body).value || '').toLowerCase(); const list = all.filter(s => !q || (s.name + ' ' + s.description).toLowerCase().includes(q)); $('#sk-list', body).innerHTML = list.length ? list.map((s, i) => '<div class="skl-i"><div class="skl-h"><b class="mono">' + esc(s.name) + '</b><span class="chip ' + (s.source === 'bundled' ? '' : 'ok') + '">' + (s.source === 'bundled' ? '内置' : '工作区 · ' + esc(s.source)) + '</span><span class="sp"></span><button class="btn sm ghost" data-o="' + all.indexOf(s) + '">打开</button>' + (s.source === 'bundled' && roots.length ? '<button class="btn sm" data-i="' + all.indexOf(s) + '">安装到工作区</button>' : '') + '</div><div class="skl-d">' + esc(s.description) + '</div></div>').join('') : '<div class="empty">没有找到技能' + (roots.length ? '' : '（当前工作区没有根目录）') + '</div>'; };
    body.addEventListener('input', draw);
    body.addEventListener('click', async e => {
      const o = e.target.closest('[data-o]'); if (o) { SL.openPath(all[+o.dataset.o].file); return; }
      const i = e.target.closest('[data-i]'); if (i) { const r = roots.length > 1 ? await pickRoot(roots) : roots[0]; if (r) { await SK.install(all[+i.dataset.i], r.path); all = await SK.list(); draw(); } return; }
      if (e.target.closest('[data-a="new"]')) { if (!roots.length) { SL.toast('请先给工作区添加一个文件夹'); return; } const r = roots.length > 1 ? await pickRoot(roots) : roots[0]; if (!r) return; const n = await (SL.prompt ? SL.prompt('技能名称（小写字母、数字、连字符）', 'my-skill') : Promise.resolve(prompt('技能名称', 'my-skill'))); if (n) await SK.create(r.path, n); }
    });
    SL.modal({ title: '技能库', body, wide: true });
    all = await SK.list(); loaded = true; draw();
  }
  const pickRoot = roots => new Promise(res => { const b = h('div', null, roots.map((r, i) => '<div class="tool-i" data-r="' + i + '"><b>' + esc(r.name || U.base(r.path)) + '</b><small>' + esc(r.path) + '</small></div>').join('')); b.addEventListener('click', e => { const x = e.target.closest('[data-r]'); if (x) { res(roots[+x.dataset.r]); const bg = b.closest('.modal-bg'); if (bg) bg.remove(); } }); SL.modal({ title: '选择工作区根目录', body: b }).then(() => res(null)); });
  SK.open = open;
  SL.cmd('skills.open', '技能库（Agent Skills）', open, { group: 'AI', icon: 'ai', key: 'Ctrl+Alt+L' });
})(window);
