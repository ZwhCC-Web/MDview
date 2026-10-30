/* ChipBench · filesafe.js — safe writes for documents the user edits (1.7).
   The shell already replaces files atomically (temp file + rename).  This layer adds:
     · conflict detection — a save never silently overwrites a file another program changed after we read it
       (mtime moved but the CONTENT is what we read — cloud-sync clients and antivirus "touch" files — is not a conflict)
     · rolling backups    — the previous content is copied to <data>/backups/<file>/ before it is overwritten
                            (at most one per file per 5 minutes, newest 12 kept) → "恢复历史备份…"   */
(function (G) {
  'use strict';
  const SL = G.ChipBench, U = SL.U, fs = SL.fs, esc = U.esc;
  const KEEP = 12, GAP = 5 * 60 * 1000;
  const S = SL.safe = { KEEP, GAP, _: {} };
  const pad = n => String(n).padStart(2, '0');
  const stamp = d => { d = d || new Date(); return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()); };
  const prune = (names, keep) => names.slice().sort().reverse().slice(keep);                 // names to delete so that `keep` newest remain
  const decide = (expect, actual, force) => (force || !expect || actual <= expect + 1) ? 'write' : 'conflict';
  const norm = t => String(t).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  S._ = { stamp, prune, decide, norm };
  let root = null; const rootDir = async () => root || (root = SL.native ? (await SL.invoke('app_dir', { sub: 'backups' })) : '');
  const dirFor = async p => (await rootDir()) + '\\' + U.hash(U.pkey(p)) + '-' + U.base(p).replace(/[^\w.\-\u4e00-\u9fa5]/g, '_').slice(0, 40);
  const lastBackup = new Map();
  S.backup = async (path, o) => {                                                          // best effort — a failing backup never blocks the save
    if (!SL.native) return null; const k = U.pkey(path); o = o || {};
    try {
      if (!o.force && Date.now() - (lastBackup.get(k) || 0) < GAP) return null;
      if ((await fs.kind(path)) !== 'file') return null;
      const d = await dirFor(path); await fs.mkdir(d);
      const bytes = await fs.readBytes(path); if (bytes.length > 30 * 1048576) return null;
      const dst = d + '\\' + stamp() + '-' + U.base(path); await fs.writeBytes(dst, bytes); lastBackup.set(k, Date.now());
      const names = (await fs.list(d)).filter(e => !e.is_dir).map(e => e.name); for (const n of prune(names, KEEP)) { try { await fs.rm(d + '\\' + n); } catch (e) { } }
      return dst;
    } catch (e) { if (SL.rt) SL.rt.report(e, '备份', { toast: false, level: 'warn' }); return null; }
  };
  S.list = async path => { if (!SL.native) return []; try { const d = await dirFor(path); if ((await fs.kind(d)) !== 'dir') return []; return (await fs.list(d)).filter(e => !e.is_dir).map(e => ({ name: e.name, path: e.path, size: e.size, mtime: e.mtime })).sort((a, b) => b.name.localeCompare(a.name)); } catch (e) { return []; } };
  const sameAsBase = async (path, base) => { if (base == null) return false; try { return norm((await fs.read(path)).text) === norm(base); } catch (e) { return false; } };
  /* opts: { expect: mtime we last saw, baseText: the text we last read / wrote, force, backup:false }.  Throws Error{code:'CONFLICT'} */
  S.write = async (path, text, enc, opts) => {
    opts = opts || {};
    if (SL.native && !opts.force && opts.expect) {
      let actual = 0; try { actual = await fs.mtime(path); } catch (e) { actual = 0; }
      if (decide(opts.expect, actual, false) === 'conflict' && !(await sameAsBase(path, opts.baseText))) { const e = new Error('文件在你打开后被其他程序修改过'); e.code = 'CONFLICT'; e.mtime = actual; throw e; }
    }
    if (opts.backup !== false) await S.backup(path);
    await fs.write(path, text, enc);
    return SL.native ? fs.mtime(path).catch(() => 0) : 0;
  };
  S.restoreDialog = async path => {
    path = path || (SL.app.current() && SL.app.current().path); if (!path) return SL.toast('先打开一个文件');
    const L = await S.list(path); if (!L.length) return SL.toast('这个文件还没有历史备份（保存时自动创建，5 分钟一份，保留最近 ' + KEEP + ' 份）');
    const fmt = n => { const m = n.match(/^(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)(\d\d)/); return m ? m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5] + ':' + m[6] : n; };
    const body = '<div class="bk-list">' + L.map((b, i) => '<div class="bk-row"><span class="mono">' + esc(fmt(b.name)) + '</span><span class="muted">' + Math.max(1, Math.round(b.size / 1024)) + ' KB</span><button class="btn sm" data-i="' + i + '">恢复为新文档</button></div>').join('') + '</div>';
    const m = SL.modal({ title: '历史备份 · ' + U.base(path), body, buttons: [{ t: '关闭', v: null }] });
    setTimeout(() => { const box = document.querySelector('.modal .bk-list'); if (box) box.addEventListener('click', async e => { const b = e.target.closest('button[data-i]'); if (!b) return; const it = L[+b.dataset.i]; try { const r = await fs.read(it.path); SL.newDoc(r.text, U.base(path).replace(/(\.\w+)?$/, '') + '（备份 ' + fmt(it.name).slice(5, 16) + '）.md'); SL.toast('已在新标签中打开备份；确认后另存为即可'); } catch (er) { SL.toast('读取备份失败：' + (er.message || er), 3500, 'bad'); } }); }, 30);
    return m;
  };
  SL.cmd('file.backups', '恢复历史备份…', () => S.restoreDialog(), { group: '文件' });
  /* ---------------------------------------------------------------- 1.8: recycle bin + file-operation log
     Deleting from the project tree no longer means "gone": the file (or folder) is first copied to <data>/trash/<id>/ and can be restored from
     "回收站…".  A folder delete asks twice, tells how many files it holds, and anything that is too big to keep (> 300 MB or > 4000 files)
     says so before it is permanently deleted.  Every delete / rename / restore done from the UI is appended to <data>/fileops.jsonl.
     This is also the single place where a path-authorisation check will be attached by the security release. */
  const TR = S.trash = { MAX_BYTES: 300 * 1048576, MAX_FILES: 4000, KEEP: 60, DAYS: 30 };
  let trashDir = null; const trashRoot = async () => trashDir || (trashDir = SL.native ? await SL.invoke('app_dir', { sub: 'trash' }) : '');
  const join = (a, b) => a.replace(/[\\/]+$/, '') + '\\' + b;
  const tid = () => stamp() + '-' + Math.random().toString(36).slice(2, 7);
  const OPLOG_MAX = 600;
  S.log = async (op, info) => {                                                           // best effort
    if (!SL.native) return; try {
      const f = join(await SL.invoke('app_dir', { sub: '' }), 'fileops.jsonl'); let old = ''; try { old = (await fs.read(f)).text; } catch (e) { }
      let lines = old ? old.split('\n').filter(Boolean) : []; lines.push(JSON.stringify(Object.assign({ t: new Date().toISOString(), op }, info))); if (lines.length > OPLOG_MAX) lines = lines.slice(-OPLOG_MAX / 2);
      await fs.write(f, lines.join('\n') + '\n');
    } catch (e) { }
  };
  S.opLog = async () => { if (!SL.native) return []; try { const f = join(await SL.invoke('app_dir', { sub: '' }), 'fileops.jsonl'); return (await fs.read(f)).text.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean); } catch (e) { return []; } };
  /* every file below a folder: [{ rel, path, size }] — or null when it is too big to keep */
  TR.collect = async root => {
    const out = []; let bytes = 0;
    const walk = async (dir, rel) => { for (const e of await fs.list(dir)) { const r = rel ? rel + '\\' + e.name : e.name; if (e.is_dir) { out.push({ rel: r, path: e.path, dir: true, size: 0 }); if (!(await walk(e.path, r))) return false; } else { bytes += e.size || 0; out.push({ rel: r, path: e.path, size: e.size || 0 }); if (bytes > TR.MAX_BYTES || out.length > TR.MAX_FILES) return false; } } return true; };
    return (await walk(root, '')) ? { items: out, bytes, files: out.filter(x => !x.dir).length } : null;
  };
  TR.put = async (path, isDir) => {
    if (!SL.native) return null; const root = await trashRoot(), id = tid(), dir = join(root, id), name = U.base(path); await fs.mkdir(dir);
    let files = 1, bytes = 0;
    if (isDir) { const c = await TR.collect(path); if (!c) { try { await fs.rm(dir, true); } catch (e) { } return null; } files = c.files; bytes = c.bytes; const base = join(dir, name); await fs.mkdir(base); for (const it of c.items) { const d = base + '\\' + it.rel; if (it.dir) await fs.mkdir(d); else await fs.writeBytes(d, await fs.readBytes(it.path)); } }
    else { const sz = await fs.size(path).catch(() => 0); if (sz > TR.MAX_BYTES) { try { await fs.rm(dir, true); } catch (e) { } return null; } bytes = sz; await fs.writeBytes(join(dir, name), await fs.readBytes(path)); }
    await fs.write(join(dir, 'meta.json'), JSON.stringify({ id, name, path, isDir: !!isDir, t: Date.now(), files, bytes }, null, 1)); TR.prune().catch(() => { }); return id;
  };
  TR.list = async () => {
    if (!SL.native) return []; const root = await trashRoot(), out = [];
    try { for (const e of await fs.list(root)) { if (!e.is_dir) continue; try { out.push(JSON.parse((await fs.read(join(e.path, 'meta.json'))).text)); } catch (er) { } } } catch (e) { }
    return out.sort((a, b) => b.t - a.t);
  };
  TR.prune = async () => { const L = await TR.list(), cut = Date.now() - TR.DAYS * 864e5, root = await trashRoot(); let n = 0; for (let i = 0; i < L.length; i++) if (i >= TR.KEEP || L[i].t < cut) { try { await fs.rm(join(root, L[i].id), true); n++; } catch (e) { } } return n; };
  TR.restore = async id => {
    const root = await trashRoot(), dir = join(root, id); const m = JSON.parse((await fs.read(join(dir, 'meta.json'))).text); let dst = m.path;
    if ((await fs.kind(dst)) !== 'none') { const ext = U.ext(dst), stem = U.base(dst).replace(/\.[^.\\/]+$/, ''); dst = join(U.dir(dst), stem + '（已恢复）' + (m.isDir || !ext ? '' : '.' + ext)); let k = 2; while ((await fs.kind(dst)) !== 'none') dst = join(U.dir(m.path), stem + '（已恢复 ' + (k++) + '）' + (m.isDir || !ext ? '' : '.' + ext)); }
    try { await fs.mkdir(U.dir(dst)); } catch (e) { }
    const src = join(dir, m.name);
    if (m.isDir) { const c = await TR.collect(src); await fs.mkdir(dst); for (const it of (c ? c.items : [])) { const d = dst + '\\' + it.rel; if (it.dir) await fs.mkdir(d); else await fs.writeBytes(d, await fs.readBytes(it.path)); } }
    else await fs.writeBytes(dst, await fs.readBytes(src));
    await fs.rm(dir, true); S.log('restore', { path: dst, from: m.path, trash: id }); return dst;
  };
  TR.purge = async id => { const root = await trashRoot(); await fs.rm(join(root, id), true); S.log('purge', { trash: id }); };
  const mb = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  /* the one door for deleting from the UI.  opts: { dir } → { ok, trash } */
  S.remove = async (path, opts) => {
    opts = opts || {}; const kind = await fs.kind(path); if (kind === 'none') { SL.toast('文件已经不存在'); return { ok: false }; } const isDir = kind === 'dir', name = U.base(path); let info = null;
    if (isDir) {
      try { info = await TR.collect(path); } catch (e) { info = null; }
      const hold = info ? '含 ' + info.files + ' 个文件（' + mb(info.bytes) + '）' : '内容很多或很大';
      if (!(await SL.confirm('删除文件夹 “' + name + '”？\n' + hold + '。' + (info ? '会先放进应用回收站，可以在“回收站…”里恢复。' : '太大，不能放进回收站，删除后无法恢复。'), '删除', true))) return { ok: false };
      if (!info || info.files > 0) { if (!(await SL.confirm('再确认一次：连同文件夹里的全部内容一起删除“' + name + '”？', '确认删除', true))) return { ok: false }; }
    } else if (!(await SL.confirm('删除 “' + name + '”？\n会先放进应用回收站，可以在“回收站…”里恢复。', '删除', true))) return { ok: false };
    let id = null; try { id = await TR.put(path, isDir); } catch (e) { id = null; if (SL.rt) SL.rt.report(e, '放入回收站', { toast: false, level: 'warn' }); }
    if (!id && SL.native && !isDir) { if (!(await SL.confirm('“' + name + '”无法放进回收站（太大或复制失败）。\n继续将永久删除，且无法恢复。', '永久删除', true))) return { ok: false }; }
    try { await fs.rm(path, isDir); } catch (e) { SL.fail('删除', e, { impact: '文件没有被删除。' }); if (id) TR.purge(id).catch(() => { }); return { ok: false }; }
    S.log('delete', { path, dir: isDir, trash: id, files: info ? info.files : undefined }); return { ok: true, trash: id };
  };
  S.trashDialog = async () => {
    const L = await TR.list(); const row = m => '<div class="bk-row" data-id="' + esc(m.id) + '"><span><b>' + esc(m.name) + '</b>' + (m.isDir ? ' <span class="chip">文件夹 · ' + m.files + ' 个文件</span>' : '') + '<br><span class="muted mono" style="font-size:var(--fs-xs)">' + esc(m.path) + '</span></span><span class="muted">' + new Date(m.t).toLocaleString() + ' · ' + mb(m.bytes) + '</span><button class="btn sm" data-a="restore">恢复</button><button class="btn sm" data-a="purge">彻底删除</button></div>';
    const body = '<div class="bk-list tr-list">' + (L.length ? L.map(row).join('') : '<div class="muted" style="padding:12px">回收站是空的。删除的文件会在这里保留 ' + TR.DAYS + ' 天（最多 ' + TR.KEEP + ' 项）。</div>') + '</div>';
    SL.modal({ title: '回收站', wide: true, body, buttons: [{ t: '关闭', v: null }] });
    setTimeout(() => { const box = document.querySelector('.modal .tr-list'); if (!box) return; box.addEventListener('click', async e => { const b = e.target.closest('button[data-a]'); if (!b) return; const r = b.closest('[data-id]'), id = r.dataset.id; try { if (b.dataset.a === 'restore') { const dst = await TR.restore(id); r.remove(); SL.toast('已恢复到 ' + dst, 4000); if (SL.app && SL.app.externalChanged) SL.app.externalChanged([dst]); if (SL.ws && SL.ws.draw) { SL.ws.dirCache && SL.ws.dirCache.clear(); SL.ws.draw(); } } else if (await SL.confirm('彻底删除“' + r.querySelector('b').textContent + '”？无法再恢复。', '彻底删除', true)) { await TR.purge(id); r.remove(); } } catch (er) { SL.toast('操作失败：' + (er.message || er), 4000, 'bad'); } }); }, 40);
  };
  SL.cmd('file.trash', '回收站…', () => S.trashDialog(), { group: '文件' });
})(window);
