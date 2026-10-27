/* Tests only: an in-memory desktop. window.__FS = { "C:\\path": {t:"text"} | {b:"base64"} | {dir:1} } */
(function () {
  const FS = window.__FS = window.__FS || {}; const calls = window.__calls = [];
  const norm = p => String(p).replace(/\//g, '\\').replace(/\\+$/, ''); const key = p => norm(p).toLowerCase();
  const find = p => { const k = key(p); for (const n in FS) if (key(n) === k) return n; return null; };
  const get = p => { const n = find(p); return n ? FS[n] : null; };
  const put = (p, v) => { const n = find(p) || norm(p); FS[n] = v; let d = n; while ((d = d.replace(/\\[^\\]*$/, '')) && d.includes('\\')) if (!find(d)) FS[d] = { dir: 1 }; if (!/\\/.test(n.slice(0, 3)) ) { } };
  const kids = p => { const k = key(p) + '\\'; return Object.keys(FS).filter(n => key(n).startsWith(k) && !key(n).slice(k.length).includes('\\')); };
  const enc = new TextEncoder(), b64 = u => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const bytes = f => f.b ? Uint8Array.from(atob(f.b), c => c.charCodeAt(0)) : enc.encode(f.t || '');
  const stat = n => { const f = FS[n]; return { name: n.split('\\').pop(), path: n, is_dir: !!f.dir, size: f.dir ? 0 : (f.b ? f.b.length * 3 / 4 | 0 : (f.t || '').length), mtime: f.m || 1 }; };
  let clock = 1000; const touch = f => { f.m = ++clock; return f; };
  const kv = window.__KV = window.__KV || {};
  const git = window.__GIT = { repo: false, commits: [], files: {} };
  const H = {
    read_text: a => { const f = get(a.path); if (!f || f.dir) throw 'not found: ' + a.path; return { text: f.t != null ? f.t : new TextDecoder().decode(bytes(f)), encoding: 'UTF-8' }; },
    read_b64: a => { const f = get(a.path); if (!f || f.dir) throw 'not found: ' + a.path; return f.b || b64(enc.encode(f.t || '')); },
    write_text: a => { const f = get(a.path); if (f && f.dir) throw 'is dir'; put(a.path, touch({ t: a.content })); },
    write_b64: a => { put(a.path, touch({ b: a.data })); },
    list_dir: a => kids(a.path).map(stat), path_kind: a => { const f = get(a.path); return !f ? 'none' : f.dir ? 'dir' : 'file'; },
    make_dir: a => { if (!get(a.path)) put(a.path, { dir: 1 }); }, remove_path: a => { const n = find(a.path); if (!n) throw 'none'; const k = key(n) + '\\'; Object.keys(FS).forEach(x => { if (x === n || key(x).startsWith(k)) delete FS[x]; }); },
    rename_path: a => { const n = find(a.from); if (!n) throw 'none'; if (find(a.to)) throw 'exists'; const k = key(n) + '\\'; Object.keys(FS).forEach(x => { if (x === n) { FS[norm(a.to)] = FS[x]; delete FS[x]; } else if (key(x).startsWith(k)) { FS[norm(a.to) + x.slice(n.length)] = FS[x]; delete FS[x]; } }); },
    file_mtime: a => (get(a.path) || {}).m || 1, file_size: a => stat(find(a.path)).size, launch_args: () => window.__ARGS || [],
    app_dir: a => 'C:\\Users\\me\\.chipbench' + (a.sub ? '\\' + a.sub.replace(/\//g, '\\') : ''), kv_get: a => (a.key in kv ? kv[a.key] : null), kv_set: a => { kv[a.key] = a.value; }, secret_set: a => { window.__secrets = window.__secrets || {}; if (a.secret) window.__secrets[a.account] = a.secret; else delete window.__secrets[a.account]; }, secret_get: a => ((window.__secrets || {})[a.account] || null),
    write_temp: a => { const p = 'C:\\Temp\\' + a.name; put(p, { b: a.data }); window.__opened = p; return p; }, open_path: a => { window.__opened = a.path; }, open_url: a => { window.__url = a.url; }, reveal: a => { window.__revealed = a.path; }, open_web: a => { window.__web = a.url; },
    pick_files: () => window.__pickFiles || [], pick_any: () => window.__pickAny || window.__pickFiles || [], pick_folder: () => window.__pickFolder || null, save_dialog: a => (window.__saveTo ? window.__saveTo + '\\' + a.name : null),
    watch_set: () => { },
    scan_dir: a => { const out = [], root = key(a.root) + '\\', ex = (a.exclude || []); Object.keys(FS).forEach(n => { if (FS[n].dir || !key(n).startsWith(root)) return; const rel = n.slice(a.root.length + 1).split('\\'); if (rel.slice(0, -1).some(x => x.startsWith('.') || ex.includes(x))) return; const ext = (n.match(/\.([^.\\]+)$/) || [, ''])[1].toLowerCase(); if (a.exts.includes(ext)) out.push({ path: n, size: stat(n).size, mtime: FS[n].m || 1 }); }); return out; },
    read_many: a => a.paths.map(p => { const f = get(p); return f && !f.dir ? { path: p, text: f.t != null ? f.t : '' } : null; }).filter(Boolean),
    search_dir: a => { const re = new RegExp(a.isRegex ? a.pattern : a.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), a.caseSensitive ? '' : 'i'), out = []; a.roots.forEach(r => Object.keys(FS).forEach(n => { const f = FS[n]; if (f.dir || f.t == null || !key(n).startsWith(key(r) + '\\')) return; f.t.split('\n').forEach((l, i) => { if (re.test(l) && out.length < a.max) out.push({ path: n, line: i, text: l }); }); })); return out; },
    pdf_text: a => { const t = (window.__PDFTEXT || {})[key(a.path)]; if (!t) throw 'no text'; const out = {}; for (let p = a.from; p <= Math.min(a.to, Object.keys(t).length); p++) out[p] = t[p]; return out; }, pdf_page_count: a => Object.keys((window.__PDFTEXT || {})[key(a.path)] || {}).length,
    log_index: a => { const t = get(a.path).t || ''; return { bytes: t.length, lines: t.split('\n').length }; }, log_lines: a => (get(a.path).t || '').split('\n').slice(a.start, a.start + Math.min(a.count, 2000)),
    log_grep: a => { const re = new RegExp(a.pattern, 'i'), out = []; (get(a.path).t || '').split('\n').forEach((l, i) => { if (re.test(l) && out.length < a.max) out.push({ line: i, text: l }); }); return out; },
    office_to_pdf: a => { const p = 'C:\\Users\\me\\.chipbench\\cache\\office\\' + a.path.split('\\').pop() + '.pdf'; if (!get(p)) throw '需要本机安装 Microsoft Office 或 LibreOffice'; return p; },
    git_cmd: a => { if (a.op === 'init') { git.repo = true; return ''; } if (!git.repo) throw 'fatal: not a git repository'; if (a.op === 'root') return window.__gitRoot || a.dir; if (a.op === 'status') return git.dirty ? ' M ' + git.dirty.join('\n M ') + '\n' : ''; if (a.op === 'commit') { git.commits.unshift({ rev: 'a' + (git.commits.length + 1) + 'b2c3d', date: '2026-10-21 10:00', msg: a.arg }); git.dirty = null; return 'ok'; } if (a.op === 'log') return git.commits.map(c => [c.rev, c.date, c.msg].join('\x1f')).join('\n'); if (a.op === 'show') return git.show || ''; return ''; },
    set_state: a => { window.__state = JSON.parse(a.json); }, mcp_script_path: () => 'C:\\Program Files\\ChipBench\\mcp\\chipbench_mcp.py'
  };
  window.__TAURI__ = { core: { invoke: async (c, a) => { calls.push(c); if (!H[c]) throw 'unknown command ' + c; const r = H[c](a || {}); return r; } }, event: { listen: async (n, f) => { (window.__listeners = window.__listeners || {})[n] = f; return () => { }; } }, http: { fetch: (u, o) => (window.__fetch ? window.__fetch(u, o) : fetch(u, o)) }, window: { getCurrentWindow: () => ({ setFullscreen: async () => { }, isFullscreen: async () => false }) } };
  window.__put = (p, t) => put(p, touch({ t })); window.__putB = (p, b) => put(p, touch({ b }));
})();
