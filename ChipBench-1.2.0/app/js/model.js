/* ChipBench · model.js — workspace data model (pure). A workspace is a project context, not a folder:
   roots        live folders (like VS Code multi-root) — shown as they are on disk
   collections  hand-curated tree of references (like Zotero collections) — one document may be in several
   layout       the session snapshot: open tabs, active tab, view modes, panels
   settings     inbox / journal folders, exclude globs, restore-on-open
   Files never move: only paths are stored. References under a root are stored root-relative, so moving or
   re-pointing a root repairs every reference in it at once. */
(function (G) {
  'use strict';
  const X = (G.ChipBench && G.ChipBench.X) || G.ChipBenchX || (typeof require !== 'undefined' ? require('./logic.js') : {});
  const { uid, base, dir, ext, pkey, join, under, relTo, resolveRel, isAbs } = X;
  const W = {};
  const MD = /^(md|markdown|mdown|mkd|txt)$/;
  const now = () => Date.now();
  const touch = ws => { ws.updated = now(); return ws; };
  W.create = (name) => ({ format: 'chipbench-workspace', version: 1, id: uid(), name: name || '新工作区', color: '', created: now(), updated: now(), roots: [], collections: [], recent: [], layout: { tabs: [], active: null, sidebar: { panel: 'workspace' } }, settings: { restore: true, inbox: '', journal: '', exclude: ['node_modules', '.git', '__pycache__', 'target'] } });
  W.walk = (list, fn, parent, depth) => { for (let i = 0; i < list.length; i++) { const n = list[i]; if (fn(n, parent, i, depth || 0) === false) return false; if (n.type === 'group' && W.walk(n.children, fn, n, (depth || 0) + 1) === false) return false; } };
  W.find = (ws, id) => { let r = null; W.walk(ws.collections, (n, parent, index) => { if (n.id === id) { r = { node: n, parent, index, list: parent ? parent.children : ws.collections }; return false; } }); return r; };
  const listOf = (ws, pid) => { if (!pid) return ws.collections; const f = W.find(ws, pid); if (!f || f.node.type !== 'group') throw new Error('目标分组不存在'); return f.node.children; };
  W.rootOf = (ws, p) => ws.roots.find(r => under(r.path, p) != null) || null;
  W.refPath = (ws, ref) => { if (ref.kind === 'url' || ref.kind === 'search') return null; if (ref.root) { const r = ws.roots.find(x => x.id === ref.root); if (r) return join(r.path, ref.rel.replace(/\//g, r.path.includes('\\') ? '\\' : '/')); } return ref.path; };
  W.addGroup = (ws, name, pid, index) => { const g = { id: uid(), type: 'group', name: name || '新分组', children: [], collapsed: false }; const l = listOf(ws, pid); l.splice(index == null ? l.length : index, 0, g); touch(ws); return g; };
  W.findRef = (ws, path) => { const k = pkey(path); let r = null; W.walk(ws.collections, n => { if (n.type === 'ref' && n.kind === 'file' && pkey(W.refPath(ws, n)) === k) { r = n; return false; } }); return r; };
  /* a document may be referenced from several collections, but only once per collection */
  W.addRef = (ws, spec, o) => {
    o = o || {}; const list = listOf(ws, o.parentId);
    if (spec.kind === 'file') { const dup = list.find(n => n.type === 'ref' && n.kind === 'file' && pkey(W.refPath(ws, n)) === pkey(spec.path)); if (dup) return { node: dup, existed: true }; }
    const n = { id: uid(), type: 'ref', kind: spec.kind || 'file', added: now() };
    if (n.kind === 'file' || n.kind === 'folder') { n.path = spec.path; const r = W.rootOf(ws, spec.path); if (r) { n.root = r.id; n.rel = under(r.path, spec.path); } } else if (n.kind === 'url') { n.url = spec.url; n.title = spec.title || spec.url; } else if (n.kind === 'search') { n.query = spec.query; n.title = spec.title || spec.query; }
    if (o.alias) n.alias = o.alias; if (o.tags && o.tags.length) n.tags = o.tags.slice();
    list.splice(o.index == null ? list.length : o.index, 0, n); touch(ws); return { node: n, existed: false };
  };
  W.addRoot = (ws, path, name) => { const ex = ws.roots.find(r => pkey(r.path) === pkey(path)); if (ex) return { root: ex, existed: true }; if (ws.roots.some(r => under(r.path, path) != null || under(path, r.path) != null)) return { error: '不能添加互相包含的文件夹（' + path + '）' }; const r = { id: uid(), path, name: name || base(path) }; ws.roots.push(r); W.walk(ws.collections, n => { if (n.type === 'ref' && n.kind === 'file' && !n.root) { const rel = under(path, n.path); if (rel != null) { n.root = r.id; n.rel = rel; } } }); touch(ws); return { root: r, existed: false }; };
  W.removeRoot = (ws, id) => { const r = ws.roots.find(x => x.id === id); if (!r) return; W.walk(ws.collections, n => { if (n.root === id) { n.path = W.refPath(ws, n); delete n.root; delete n.rel; } }); ws.roots = ws.roots.filter(x => x.id !== id); touch(ws); };
  W.rebaseRoot = (ws, id, newPath) => { const r = ws.roots.find(x => x.id === id); if (!r) return 0; r.path = newPath; if (!r.name || r.name === base(r.path)) r.name = base(newPath); let n = 0; W.walk(ws.collections, x => { if (x.root === id) { x.path = W.refPath(ws, x); n++; } }); touch(ws); return n; };
  const isAnc = (ws, a, b) => { const f = W.find(ws, a); if (!f || f.node.type !== 'group') return false; let hit = false; W.walk(f.node.children, n => { if (n.id === b) { hit = true; return false; } }); return hit; };
  W.move = (ws, id, tp, index) => { if (id === tp || (tp && isAnc(ws, id, tp))) throw new Error('不能移动到自身内部'); const f = W.find(ws, id); if (!f) throw new Error('项目不存在'); const to = listOf(ws, tp); f.list.splice(f.index, 1); let i = index == null ? to.length : index; if (to === f.list && index != null && f.index < index) i--; to.splice(Math.max(0, Math.min(i, to.length)), 0, f.node); touch(ws); return f.node; };
  W.copy = (ws, id, tp, index) => { const f = W.find(ws, id); if (!f || f.node.type === 'group') throw new Error('只能复制文档引用'); const l = listOf(ws, tp); const c = Object.assign({}, f.node, { id: uid(), added: now() }); l.splice(index == null ? l.length : index, 0, c); touch(ws); return c; };
  W.remove = (ws, id) => { const f = W.find(ws, id); if (!f) return null; f.list.splice(f.index, 1); touch(ws); return f.node; };
  W.label = n => n.type === 'group' ? n.name : n.alias || (n.kind === 'url' || n.kind === 'search' ? n.title : base(n.path));
  W.rename = (ws, id, name) => { const f = W.find(ws, id); if (!f) return; const n = f.node; if (n.type === 'group') n.name = name || n.name; else if (n.kind === 'url' || n.kind === 'search') n.title = name || n.title; else if (name && name !== base(n.path)) n.alias = name; else delete n.alias; touch(ws); };
  W.setTags = (ws, id, tags) => { const f = W.find(ws, id); if (f) { f.node.tags = tags.filter(Boolean); if (!f.node.tags.length) delete f.node.tags; touch(ws); } };
  /* every file the workspace knows about: curated refs + (optionally) a scan of the roots */
  W.files = ws => { const out = [], st = []; W.walk(ws.collections, (n, p, i, d) => { st.length = d; if (n.type === 'group') st[d] = n.name; else if (n.type === 'ref' && n.kind === 'file') out.push({ node: n, path: W.refPath(ws, n), name: W.label(n), group: st.slice(0, d).join(' / ') }); }); return out; };
  W.membership = (ws, path) => { const k = pkey(path), out = []; const st = []; W.walk(ws.collections, (n, p, i, d) => { st.length = d; if (n.type === 'group') st[d] = n.name; else if (n.type === 'ref' && n.kind === 'file' && pkey(W.refPath(ws, n)) === k) out.push(st.slice(0, d).join(' / ') || '（根）'); }); return out; };
  W.byFolder = ws => { const m = new Map(); W.files(ws).forEach(f => { const d = dir(f.path); if (!m.has(pkey(d))) m.set(pkey(d), { dir: d, items: [] }); m.get(pkey(d)).items.push(f); }); return Array.from(m.values()).sort((a, b) => a.dir.localeCompare(b.dir, 'zh-CN', { numeric: true })); };
  W.markOpened = (ws, path) => { const k = pkey(path); ws.recent = [{ path, t: now() }].concat((ws.recent || []).filter(r => pkey(r.path) !== k)).slice(0, 60); ws.updated = now(); };
  W.recent = (ws, n) => (ws.recent || []).slice(0, n || 30);
  W.importTree = (ws, L, pid, o) => { o = o || {}; const filter = o.filter || (p => MD.test(ext(p))); let added = 0, skipped = 0; const rec = (l, p) => { const g = W.addGroup(ws, l.name || base(l.path), p); (l.dirs || []).forEach(d => rec(d, g.id)); (l.files || []).filter(f => filter(f.path)).forEach(f => { const r = W.addRef(ws, { kind: 'file', path: f.path }, { parentId: g.id }); r.existed ? skipped++ : added++; }); if (!g.children.length) W.remove(ws, g.id); return g; }; const g = rec(L, pid); return { group: W.find(ws, g.id) ? g : null, added, skipped }; };
  /* repair missing references: by unique basename among candidates, or by moved folder prefix */
  W.relocate = (ws, missing, candidates) => { const by = new Map(); candidates.forEach(p => { const k = base(p).toLowerCase(); by.set(k, by.has(k) ? null : p); }); const fixed = []; missing.forEach(p => { const c = by.get(base(p).toLowerCase()), k = pkey(p); if (!c) return; let hit = false; W.walk(ws.collections, n => { if (n.type === 'ref' && n.kind === 'file' && pkey(W.refPath(ws, n)) === k) { n.path = c; delete n.root; delete n.rel; const r = W.rootOf(ws, c); if (r) { n.root = r.id; n.rel = under(r.path, c); } hit = true; } }); if (hit) fixed.push({ from: p, to: c }); }); if (fixed.length) touch(ws); return fixed; };
  W.rebasePrefix = (ws, oldDir, newDir) => { let n = 0; W.walk(ws.collections, x => { if (x.type === 'ref' && x.path && under(oldDir, x.path) != null && !x.root) { x.path = join(newDir, under(oldDir, x.path).replace(/\//g, newDir.includes('\\') ? '\\' : '/')); n++; } }); if (n) touch(ws); return n; };
  W.setLayout = (ws, tabs, active, extra) => { ws.layout = Object.assign({}, ws.layout, { tabs: (tabs || []).filter(t => t && t.path), active: active || null, time: now() }, extra || {}); ws.updated = now(); };
  W.validate = obj => {
    if (typeof obj === 'string') obj = JSON.parse(obj);
    if (obj && obj.folders && !obj.format) { const w = W.create(obj.name || 'VS Code 工作区'); (obj.folders || []).forEach(f => { if (f.path) W.addRoot(w, f.path, f.name); }); return w; }
    if (obj && obj.format === 'mdview-workspace') { const w = W.create(obj.name); const conv = (l, pid) => (l || []).forEach(x => { if (x.type === 'group') { const g = W.addGroup(w, x.name, pid); conv(x.children, g.id); } else if (x.type === 'folder') W.addRoot(w, x.path); else if (x.path) W.addRef(w, { kind: 'file', path: x.path }, { parentId: pid, alias: x.alias, tags: x.tags }); }); conv(obj.items); if (obj.session) w.layout.tabs = (obj.session.open || []).map(p => ({ path: p })); return w; }
    if (obj && obj.format === 'silica-workspace') obj.format = 'chipbench-workspace'; // pre-1.0 product name
    if (!obj || obj.format !== 'chipbench-workspace' || !Array.isArray(obj.collections)) throw new Error('不是 ChipBench 工作区文件');
    const w = Object.assign(W.create(obj.name), obj); w.id = obj.id || uid(); w.roots = (obj.roots || []).filter(r => r && r.path).map(r => Object.assign({ id: uid() }, r));
    const fix = l => (l || []).filter(n => n && (n.type === 'group' || (n.type === 'ref' && (n.path || n.url || n.query)))).map(n => { n.id = n.id || uid(); if (n.type === 'group') { n.name = n.name || '分组'; n.children = fix(n.children); } return n; });
    w.collections = fix(obj.collections); w.layout = Object.assign({ tabs: [], active: null }, obj.layout || {}); w.settings = Object.assign(W.create().settings, obj.settings || {}); w.recent = obj.recent || []; return w;
  };
  W.duplicate = (ws, name) => { const c = W.validate(JSON.parse(JSON.stringify(ws))); const map = {}; c.roots.forEach(r => { const o = r.id; r.id = uid(); map[o] = r.id; }); c.id = uid(); c.name = name || ws.name + ' 副本'; c.created = c.updated = now(); W.walk(c.collections, n => { n.id = uid(); if (n.root) n.root = map[n.root]; }); return c; };
  W.filter = (ws, q) => { q = (q || '').trim().toLowerCase(); if (!q) return null; const keep = new Set(); W.walk(ws.collections, n => { if (n.type !== 'group' && (W.label(n) + ' ' + (n.path || n.url || n.query || '') + ' ' + (n.tags || []).join(' ')).toLowerCase().includes(q)) keep.add(n.id); }); return keep; };
  W.stats = ws => { let f = 0, g = 0, o = 0; W.walk(ws.collections, n => { if (n.type === 'group') g++; else if (n.kind === 'file') f++; else o++; }); return { files: f, groups: g, others: o, roots: ws.roots.length }; };
  /* portable project file: paths relative to the file's folder (so the workspace can sit next to the project and be shared) */
  W.toPortable = (ws, fileDir) => { const c = JSON.parse(JSON.stringify(ws)); c.roots.forEach(r => { r.path = isAbs(r.path) ? relTo(fileDir, r.path + '/x').replace(/\/x$/, '') : r.path; r.portable = true; }); W.walk(c.collections, n => { if (n.path && !n.root) n.path = relTo(fileDir, n.path); delete n.opened; }); c.portable = true; c.recent = []; return c; };
  W.fromPortable = (obj, fileDir) => { const w = W.validate(obj); if (!obj.portable) return w; w.roots.forEach(r => { r.path = resolveRel(fileDir, r.path); delete r.portable; }); W.walk(w.collections, n => { if (n.path && !n.root) n.path = resolveRel(fileDir, n.path); }); w.portable = false; return w; };
  G.ChipBenchW = W; if (G.ChipBench) G.ChipBench.W = W;
  if (typeof module !== 'undefined') module.exports = W;
})(typeof window !== 'undefined' ? window : globalThis);
