/* Browser-side mock of the Rust commands in desktop/src-tauri/src/main.rs — used to test the desktop code paths. */
(() => {
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR42mP8z8DwnwEIGBkYGP4DABHbAv8NwtxEAAAAAElFTkSuQmCC';
  const fs = {
    'C:\\docs': { dir: true },
    'C:\\docs\\a.md': { t: '# 文档A\n\n![logo](assets/x.png)\n\n![带空格](<assets/my pic.png>)\n\n![编码](assets/my%20pic.png)\n\n![绝对](C:\\pics\\abs.png)\n\n![uri](file:///C:/pics/abs.png)\n\n![缺失](assets/none.png)\n\n见 [B](sub/b.md) 和 [[C笔记]]\n\n- [ ] 寄样品 📅 2020-01-01\n- [ ] 写周报\n', m: 1000 },
    'C:\\docs\\sub': { dir: true }, 'C:\\docs\\sub\\b.md': { t: '# 文档B\n\n回到 [[文档A|A]] 以及 [[a]]\n\n![上级](../assets/x.png)\n\n- [x] 已完成\n- [ ] B 的待办 📅 2099-01-01\n', m: 1000 },
    'C:\\docs\\C笔记.md': { t: '# C\n\n链接 [A](a.md)\n', m: 1000, enc: 'GBK' },
    'C:\\docs\\templates': { dir: true }, 'C:\\docs\\templates\\客户周会.md': { t: '# {{title}}\n\n日期：{{date}}\n', m: 1 },
    'C:\\docs\\assets': { dir: true }, 'C:\\docs\\assets\\x.png': { b: PNG, m: 1 }, 'C:\\docs\\assets\\my pic.png': { b: PNG, m: 1 },
    'C:\\docs\\assets\\unused.png': { b: PNG, m: 1 },
    'C:\\pics': { dir: true }, 'C:\\pics\\abs.png': { b: PNG, m: 1 }
  };
  window.__fs = fs; window.__calls = []; const listeners = {};
  const kids = p => Object.keys(fs).filter(k => k.slice(0, k.lastIndexOf('\\')) === p);
  const H = {
    read_text: a => { if (!fs[a.path] || fs[a.path].dir) throw 'no file'; return { text: fs[a.path].t ?? '', encoding: fs[a.path].enc || 'UTF-8' }; },
    read_b64: a => { if (!fs[a.path]) throw 'no file ' + a.path; return fs[a.path].b || btoa(unescape(encodeURIComponent(fs[a.path].t || ''))); },
    write_text: a => { fs[a.path] = { t: a.content, m: Date.now(), enc: a.encoding || undefined }; },
    write_b64: a => { fs[a.path] = { b: a.data, m: Date.now() }; },
    list_dir: a => kids(a.path).map(k => ({ name: k.split('\\').pop(), path: k, is_dir: !!fs[k].dir })),
    path_kind: a => !fs[a.path] ? 'none' : fs[a.path].dir ? 'dir' : 'file',
    make_dir: a => { fs[a.path] = { dir: true }; }, remove_path: a => { delete fs[a.path]; },
    rename_path: a => { fs[a.to] = fs[a.from]; delete fs[a.from]; }, file_mtime: a => fs[a.path].m,
    launch_args: () => ['C:\\docs\\a.md'], pick_files: () => ['C:\\docs\\sub\\b.md'], pick_folder: () => 'C:\\docs', save_dialog: a => 'C:\\docs\\' + a.name,
    open_url: () => { }, reveal: a => { window.__revealed = a.path; }, open_path: a => { window.__opened = a.path; },
    write_temp: a => { const p = 'C:\\Temp\\' + a.name; fs[p] = { b: a.data, m: Date.now() }; return p; },
    set_state: a => { window.__state = JSON.parse(a.json); }, mcp_script_path: () => 'C:\\Program Files\\MDView\\mcp\\mdview_mcp.py',
    watch_set: a => { window.__watch = a; },
    search_dir: a => { const out = []; const re = new RegExp(a.isRegex ? a.pattern : a.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); for (const k in fs) if (fs[k].t != null && /\.md$/.test(k)) fs[k].t.split('\n').forEach((l, i) => { if (re.test(l)) out.push({ path: k, line: i, text: l }); }); return out; },
    scan_links: a => { const out = []; for (const k in fs) if (fs[k].t != null && /\.md$/.test(k)) { const links = []; fs[k].t.split('\n').forEach((l, i) => { let m; const r1 = /\[\[([^\[\]\n|#]+)/g; while ((m = r1.exec(l))) links.push({ kind: 'w', target: m[1].trim(), line: i, text: l }); const r2 = /\]\(([^)\s]+?\.md)\)/g; while ((m = r2.exec(l))) links.push({ kind: 'm', target: m[1], line: i, text: l }); }); out.push({ path: k, links }); } return out; }
  };
  window.__TAURI__ = {
    core: { invoke: async (c, a) => { __calls.push(c); if (!H[c]) throw 'unknown ' + c; return H[c](a || {}); } },
    event: { listen: async (n, f) => { listeners[n] = f; return () => { }; }, __emit: (n, p) => listeners[n] && listeners[n]({ payload: p }) },
    window: { getCurrentWindow: () => ({ setTitle: async t => { window.__title = t; }, onCloseRequested: async f => { window.__close = f; }, isFullscreen: async () => false, setFullscreen: async () => { } }) }
  };
})();
