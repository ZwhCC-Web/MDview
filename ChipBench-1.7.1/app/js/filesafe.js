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
})(window);
