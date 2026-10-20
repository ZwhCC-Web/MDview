  /* ================= part 2: live block editing (CodeMirror per block), autocomplete, tables, paste ================= */
  const PREVIEW_TYPES = ['math', 'table', 'list', 'quote', 'html', 'code'];
  const srcLines = () => S.src.split('\n');
  const blkEl = i => write.querySelector('.grp > .blk[data-i="' + i + '"]');
  const composing = e => e.isComposing || e.keyCode === 229;
  const later = f => Promise.resolve().then(f);

  function startEdit(i, caret) {
    const b = S.result.blocks[i]; if (!b) return;
    openEditor({ start: b.start, end: b.end, insert: false, type: b.type }, b.src, caret, blkEl(i));
  }
  function startInsert(atLine, afterEl, text) {
    const hint = write.querySelector('.empty-hint'); if (hint) hint.remove();
    if (!fnHost.isConnected) write.replaceChildren(fnHost, addZone);
    const holder = document.createElement('div'); holder.className = 'blk editing';
    if (afterEl && afterEl.classList && afterEl.classList.contains('blk') && afterEl.parentNode && afterEl.isConnected) afterEl.parentNode.insertBefore(holder, afterEl.nextSibling);
    else { const gs = write.querySelectorAll(':scope > .grp'); const g = gs.length ? gs[gs.length - 1] : newGroup(); g.appendChild(holder); }
    openEditor({ start: atLine, end: atLine, insert: true, type: 'para' }, text || '', 'end', holder);
  }
  function editAtLine(line, caret) {
    const bl = S.result.blocks;
    let idx = bl.findIndex(b => line >= b.start && line < b.end);
    if (idx < 0) idx = bl.findIndex(b => b.start >= line);
    if (idx < 0) idx = bl.length - 1;
    if (idx >= 0) startEdit(idx, caret);
  }
  function dropEditing() { const E = S.editing; S.editing = null; if (E && E.ta && E.ta.cm) { try { E.ta.destroy(); } catch (e) { } } }
  function openEditor(info, text, caret, el) {
    if (!el) return;
    S.editing = info;
    S.htmlOf.delete(el);
    el.classList.add('editing'); el.innerHTML = '';
    const bar = document.createElement('div'); bar.className = 'tbl-bar'; bar.style.display = 'none';
    bar.innerHTML = '<button data-t="row-above">↥ 上方插行</button><button data-t="row-below">↧ 下方插行</button><button data-t="col-left">↤ 左侧插列</button><button data-t="col-right">↦ 右侧插列</button><span class="sp"></span><button data-t="del-row">删除行</button><button data-t="del-col">删除列</button><span class="sp"></span><button data-t="al-left">左对齐</button><button data-t="al-center">居中</button><button data-t="al-right">右对齐</button><span class="sp"></span><button data-t="sort">排序</button><button data-t="tsv" title="复制为制表符分隔，可直接粘贴到 Excel">复制到 Excel</button><span class="info"></span>';
    const wrap = document.createElement('div'); wrap.className = 'blk-edit';
    const live = document.createElement('div'); live.className = 'blk-live md' + (prefs.codeLines ? ' code-lines' : '');
    el.appendChild(bar); el.appendChild(wrap); el.appendChild(live);
    let ed, lastPrev = null;
    const upd = changed => {
      const v = ed.value;
      const t = MD.splitBlocks(v).blocks[0];
      const type = t ? t.type : 'para';
      styleEditor(wrap, type, v);
      if (!ed.cm) autosize(ed);
      bar.style.display = type === 'table' ? 'flex' : 'none';
      if (type === 'table') later(() => tableInfo(ed, bar));
      const wantPrev = PREVIEW_TYPES.includes(type) && !(type === 'code' && !/mermaid|wavedrom|math|latex|katex/i.test(v.split('\n')[0]));
      if (wantPrev) { if (v !== lastPrev) { lastPrev = v; live.innerHTML = MD.render(v).html; enhance(live); } }
      else if (live.innerHTML) { live.innerHTML = ''; lastPrev = null; }
      if (changed) { if (!S.dirty) markDirty(true); later(() => acCheck(ed)); }
      if (S.typewriter) later(() => centerEl(ed));
      later(liveStatus);
    };
    const blurCheck = () => {
      if (S.editing && S.editing.ta === ed && !edFocused(ed) && !$('#find').contains(document.activeElement) && !el.contains(document.activeElement) && !$('#modal').classList.contains('show') && !$('#ai-panel').contains(document.activeElement)) commit();
      if (!edFocused(ed)) { if (fmtTarget === ed) hideFmtBar(); if (AC.ta === ed) acClose(); }
    };
    if (CMK.ok) {
      ed = CMK.api.create({
        kind: 'block', parent: wrap, doc: text, spell: prefs.spell,
        onChange: () => upd(true), onSelect: () => later(() => { liveStatus(); fmtBarCheck(ed); if (bar.style.display !== 'none') tableInfo(ed, bar); if (AC.open) acCheck(ed); }),
        onKey: e => blockKeys(e, ed), onPaste: e => onPaste(e, ed), onBlur: () => setTimeout(blurCheck, 120), onMouseUp: () => { fmtBarCheck(ed); acClose(); }
      });
    } else {
      ed = document.createElement('textarea');
      ed.className = 'blk-src' + (FIELD_SIZING ? ' fs' : ''); ed.spellcheck = prefs.spell; ed.value = text;
      wrap.appendChild(ed);
      ed.addEventListener('input', () => upd(true));
      ed.addEventListener('blur', () => setTimeout(blurCheck, 120));
      ed.addEventListener('keydown', e => blockKeys(e, ed));
      ed.addEventListener('paste', e => onPaste(e, ed));
      ed.addEventListener('keyup', e => { liveStatus(); if (bar.style.display !== 'none') tableInfo(ed, bar); fmtBarCheck(ed); if (/^Arrow|^Home|^End/.test(e.key)) acCheck(ed); });
      ed.addEventListener('mouseup', () => setTimeout(() => { fmtBarCheck(ed); liveStatus(); }, 0));
      ed.addEventListener('click', () => { liveStatus(); acClose(); if (bar.style.display !== 'none') tableInfo(ed, bar); });
    }
    Object.assign(S.editing, { ta: ed, el, live, wrap, bar });
    bar.addEventListener('mousedown', e => e.preventDefault());
    bar.addEventListener('click', e => { const b = e.target.closest('button'); if (b) tableOp(ed, b.dataset.t); });
    upd(false); ed.focus({ preventScroll: true });
    const pos = caret === 'start' ? 0 : (typeof caret === 'number' ? Math.min(caret, edLen(ed)) : edLen(ed));
    ed.setSelectionRange(pos, pos);
    requestAnimationFrame(() => {
      const r = el.getBoundingClientRect(), sr = writeScroll.getBoundingClientRect();
      if (S.typewriter) centerEl(ed); else if (r.top < sr.top || r.bottom > sr.bottom) el.scrollIntoView({ block: 'nearest' });
    });
  }
  function styleEditor(wrap, type, text) {
    wrap.classList.toggle('h-src', type === 'heading');
    wrap.classList.toggle('p-src', type === 'para' || type === 'setext');
    if (type === 'heading') { const lv = (text.match(/^\s*(#+)/) || ['', '#'])[1].length; wrap.style.fontSize = [1.95, 1.5, 1.25, 1.1, 1, .95][lv - 1] + 'em'; }
    else wrap.style.fontSize = '';
  }
  const FIELD_SIZING = window.CSS && CSS.supports && CSS.supports('field-sizing', 'content');
  function autosize(ta) { if (FIELD_SIZING) return; ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight + 2) + 'px'; }
  function centerEl(ed) {
    const r = caretRect(ed, ed.selectionStart), sr = writeScroll.getBoundingClientRect();
    writeScroll.scrollTop += r.top - (sr.top + sr.height / 2);
  }
  function commit(opts) {
    const E = S.editing; if (!E) return;
    S.editing = null; hideFmtBar(); acClose();
    let text = E.ta.value.replace(/\s+$/, '');
    if (E.ta.cm) { try { E.ta.destroy(); } catch (e) { } }
    const bs = MD.splitBlocks(text).blocks;
    if (prefs.tableFmt && bs.length === 1 && bs[0].type === 'table') text = formatTable(text);
    const lines = srcLines();
    const orig = lines.slice(E.start, E.end).join('\n');
    let changed = false;
    if (E.insert) {
      if (text.trim()) {
        if (S.src === '') lines.length = 0;
        const ins = text.split('\n');
        const before = E.start > 0 && lines[E.start - 1] !== undefined && lines[E.start - 1].trim() !== '' ? [''] : [];
        const after = lines[E.start] !== undefined && lines[E.start].trim() !== '' ? [''] : [];
        lines.splice(E.start, 0, ...before, ...ins, ...after);
        E.newStart = E.start + before.length; changed = true;
      }
    } else if (text !== orig.replace(/\s+$/, '')) {
      if (!text.trim()) {
        let s = E.start, n = E.end - E.start;
        if (lines[E.end] !== undefined && lines[E.end].trim() === '') n++;
        else if (s > 0 && lines[s - 1].trim() === '') { s--; n++; }
        lines.splice(s, n);
      } else lines.splice(E.start, E.end - E.start, ...text.split('\n'));
      changed = true;
    }
    E.finalText = text;
    if (changed) setSrc(lines.join('\n'), { noRender: true });
    if (!(opts && opts.silent)) renderLive();
    updateStatus();
    return E;
  }
  function committedRange(d) {
    const txt = (d.finalText != null ? d.finalText : '').replace(/\s+$/, '');
    const st = d.insert ? (d.newStart ?? d.start) : d.start;
    return { start: st, end: txt.trim() ? st + txt.split('\n').length : st, oldEnd: d.end };
  }
  function findLastIdx(arr, fn) { for (let k = arr.length - 1; k >= 0; k--) if (fn(arr[k])) return k; return -1; }
  function newBlockAfter() {
    const rg = committedRange(commit());
    const bi = findLastIdx(S.result.blocks, b => b.end <= rg.end);
    startInsert(Math.min(rg.end, srcLines().length), bi >= 0 ? blkEl(bi) : null);
  }
  function insertAt(ed, text, caretOffset) {
    insText(ed, text);
    if (caretOffset) { const q = ed.selectionStart + caretOffset; ed.setSelectionRange(q, q); }
  }
  function replaceAllText(ed, text, caret) { edReplace(ed, 0, edLen(ed), text, caret); }

  const PAIRS = { '(': ')', '[': ']', '{': '}', '（': '）', '【': '】', '《': '》', '「': '」', '“': '”' };
  const CLOSERS = new Set(Object.values(PAIRS));
  function autoPair(e, ed) {
    if (!prefs.autoPair || e.ctrlKey || e.metaKey || e.altKey || composing(e)) return false;
    const s = ed.selectionStart, en = ed.selectionEnd;
    if (PAIRS[e.key]) {
      e.preventDefault();
      const sel = edSlice(ed, s, en);
      edReplace(ed, s, en, e.key + sel + PAIRS[e.key], s + 1, s + 1 + sel.length); return true;
    }
    if (CLOSERS.has(e.key) && s === en && edSlice(ed, s, s + 1) === e.key) { e.preventDefault(); ed.setSelectionRange(s + 1, s + 1); return true; }
    if (e.key === 'Backspace' && s === en && s > 0) {
      const a = edSlice(ed, s - 1, s);
      if (PAIRS[a] && edSlice(ed, s, s + 1) === PAIRS[a]) { e.preventDefault(); edReplace(ed, s - 1, s + 1, '', s - 1); return true; }
    }
    return false;
  }

  /* Typora-like keys inside an edited block */
  function blockKeys(e, ed) {
    if (acKey(e)) return;
    const v = ed.value, p = ed.selectionStart, pe = ed.selectionEnd;
    const E = S.editing;
    if (editorShortcuts(e, ed)) return;
    if (e.key === 'Escape') { e.preventDefault(); commit(); return; }
    if (e.key === 'ArrowUp' && p === 0 && pe === 0 && !e.shiftKey) {
      e.preventDefault(); const rg = committedRange(commit());
      const prev = findLastIdx(S.result.blocks, b => b.end <= rg.start);
      if (prev >= 0) startEdit(prev, 'end'); return;
    }
    if (e.key === 'ArrowDown' && p === v.length && pe === v.length && !e.shiftKey) {
      e.preventDefault();
      if (E.insert && !v.trim() && !S.result.blocks.some(b => b.start >= E.start)) return;
      const rg = committedRange(commit());
      const idx = S.result.blocks.findIndex(b => b.start >= rg.end);
      if (idx >= 0) startEdit(idx, 'start');
      else if (rg.end > rg.start) { const bi = findLastIdx(S.result.blocks, b => b.end <= rg.end); startInsert(srcLines().length, bi >= 0 ? blkEl(bi) : null); }
      return;
    }
    if (e.key === 'Backspace' && v === '') {
      e.preventDefault(); const rg = committedRange(commit());
      const prev = findLastIdx(S.result.blocks, b => b.end <= rg.start);
      if (prev >= 0) startEdit(prev, 'end'); return;
    }
    const blkType = (MD.splitBlocks(v).blocks[0] || { type: 'para' }).type;
    if (blkType !== 'code' && blkType !== 'math' && autoPair(e, ed)) return;
    if (e.key === 'Enter' && !composing(e) && !e.ctrlKey && !e.altKey && !e.metaKey) {
      const lineStart = v.lastIndexOf('\n', p - 1) + 1;
      let lineEnd = v.indexOf('\n', p); if (lineEnd < 0) lineEnd = v.length;
      const cur = v.slice(lineStart, lineEnd);
      const before = v.slice(0, p);
      const fm = cur.match(/^(\s*)(`{3,}|~{3,})([\w+#.-]*)\s*$/);
      if (fm && lineStart === 0 && v.trim() === cur.trim() && p === lineEnd) { e.preventDefault(); insertAt(ed, '\n\n' + fm[1] + fm[2], -(fm[1].length + fm[2].length + 1)); return; }
      if (/^\s*\$\$\s*$/.test(cur) && lineStart === 0 && v.trim() === '$$') { e.preventDefault(); insertAt(ed, '\n\n$$', -3); return; }
      if (blkType === 'code' || blkType === 'math' || blkType === 'html' || blkType === 'frontmatter') {
        if (p === v.length && pe === p && /^(\s*)(`{3,}|~{3,}|\$\$)\s*$/.test(cur) && v.split('\n').length > 1 && !e.shiftKey) { e.preventDefault(); newBlockAfter(); return; }
        e.preventDefault(); insertAt(ed, '\n' + cur.match(/^\s*/)[0]); return;
      }
      if (e.shiftKey) { e.preventDefault(); insertAt(ed, '\n'); return; }
      const lm = cur.match(/^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?(.*)$/);
      if (lm && p >= lineStart + lm[1].length + lm[2].length) {
        e.preventDefault();
        if (!lm[5].trim() && p === lineEnd) {
          if (lm[1].length) {
            const nIndent = lm[1].slice(Math.min(lm[1].length, 2));
            edReplace(ed, lineStart, lineEnd, nIndent + lm[2] + lm[3] + (lm[4] ? '[ ] ' : ''));
          } else { ed.value = v.slice(0, Math.max(0, lineStart - 1)) + v.slice(lineEnd); newBlockAfter(); }
          return;
        }
        let mk = lm[2]; if (/\d/.test(mk)) mk = (parseInt(mk, 10) + 1) + mk.slice(-1);
        insertAt(ed, '\n' + lm[1] + mk + lm[3] + (lm[4] ? '[ ] ' : '')); return;
      }
      const qm = cur.match(/^(\s*>+\s?)(.*)$/);
      if (qm) {
        e.preventDefault();
        if (!qm[2].trim() && p === lineEnd) { ed.value = v.slice(0, Math.max(0, lineStart - 1)) + v.slice(lineEnd); newBlockAfter(); return; }
        insertAt(ed, '\n' + qm[1]); return;
      }
      if (blkType === 'table') {
        e.preventDefault();
        const cols = Math.max(1, MD.splitRow(v.split('\n')[0]).length);
        if (p === v.length && /^\|(\s*\|)+\s*$/.test(cur)) { ed.value = v.slice(0, Math.max(0, lineStart - 1)); newBlockAfter(); return; }
        edReplace(ed, lineEnd, lineEnd, '\n|' + '  |'.repeat(cols), lineEnd + 3);
        return;
      }
      e.preventDefault();
      const after = v.slice(pe).replace(/^\s+/, '');
      if (!after) { ed.value = before.replace(/\s+$/, ''); newBlockAfter(); }
      else {
        const beforeTxt = before.replace(/\s+$/, '');
        ed.value = beforeTxt + '\n\n' + after;
        const rg = committedRange(commit());
        editAtLine(rg.start + beforeTxt.split('\n').length + 1, 'start');
      }
      return;
    }
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      if (blkType === 'table') { tableTab(ed, e.shiftKey); return; }
      indentKey(ed, e.shiftKey);
    }
  }
  function indentKey(ed, back) {
    const c = lineCtx(ed), p = ed.selectionStart;
    if (back) { const m = c.line.match(/^ {1,4}|^\t/); if (m) edReplace(ed, c.ls, c.ls + m[0].length, '', Math.max(c.ls, p - m[0].length)); }
    else if (/^\s*([-*+]|\d+[.)])\s/.test(c.line)) edReplace(ed, c.ls, c.ls, '  ', p + 2);
    else insText(ed, '    ');
  }

  function wrapSel(ed, a, b) {
    const s = ed.selectionStart, en = ed.selectionEnd, sel = edSlice(ed, s, en);
    if (sel.startsWith(a) && sel.endsWith(b) && sel.length >= a.length + b.length) { const inner = sel.slice(a.length, sel.length - b.length); edReplace(ed, s, en, inner, s, s + inner.length); }
    else if (edSlice(ed, s - a.length, s) === a && edSlice(ed, en, en + b.length) === b) edReplace(ed, s - a.length, en + b.length, sel, s - a.length, en - a.length);
    else edReplace(ed, s, en, a + sel + b, s + a.length, s + a.length + sel.length);
  }
  function insertLink(ed) {
    const s = ed.selectionStart, en = ed.selectionEnd, sel = edSlice(ed, s, en); const url = /^https?:/.test(sel) ? sel : '';
    const t = '[' + (url ? '' : sel) + '](' + url + ')';
    const q = url ? s + 1 : s + sel.length + 3;
    edReplace(ed, s, en, t, q);
  }
  function linePrefix(ed, pre) {
    const c = lineCtx(ed);
    const line = c.line.replace(/^#{1,6}\s+/, '').replace(/^>\s?/, '');
    edReplace(ed, c.ls, c.le, pre + line, c.ls + pre.length + line.length);
  }
  function editorShortcuts(e, ed) {
    const mod = e.ctrlKey || e.metaKey; if (!mod) return false;
    const k = e.key.toLowerCase();
    const go = fn => { e.preventDefault(); fn(); return true; };
    if (!e.shiftKey && !e.altKey) {
      if (k === 'b') return go(() => wrapSel(ed, '**', '**'));
      if (k === 'i') return go(() => wrapSel(ed, '*', '*'));
      if (k === 'u') return go(() => wrapSel(ed, '<u>', '</u>'));
      if (k === 'e') return go(() => wrapSel(ed, '`', '`'));
      if (k === 'k') return go(() => insertLink(ed));
      if (/^[0-6]$/.test(k)) return go(() => linePrefix(ed, k === '0' ? '' : '#'.repeat(+k) + ' '));
    }
    if (e.shiftKey && !e.altKey) {
      if (e.code === 'Backquote') return go(() => wrapSel(ed, '`', '`'));
      if (k === 'k') return go(() => insertAt(ed, '\n```\n\n```\n', -5));
      if (k === 'm') return go(() => insertAt(ed, '\n$$\n\n$$\n', -4));
      if (k === 'q') return go(() => linePrefix(ed, '> '));
      if (e.code === 'Digit5') return go(() => wrapSel(ed, '~~', '~~'));
      if (k === 'h') return go(() => wrapSel(ed, '==', '=='));
      if (k === 'i') return go(() => insertAt(ed, '![]()', -1));
    }
    if (e.altKey && !e.shiftKey && k === 't') return go(() => insertAt(ed, '\n| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n|  |  |  |\n'));
    return false;
  }

  /* ================= floating format toolbar ================= */
  const fmtBar = $('#fmt-bar'); let fmtTarget = null;
  function fmtBarCheck(ed) {
    if (!ed || ed.selectionStart === ed.selectionEnd || !edFocused(ed)) { if (fmtTarget === ed) hideFmtBar(); return; }
    if (ed !== srcEd) { const blk = (MD.splitBlocks(ed.value).blocks[0] || {}).type; if (blk === 'code' || blk === 'math') return hideFmtBar(); }
    else if (edInFence(ed, ed.selectionStart)) return hideFmtBar();
    fmtTarget = ed;
    const c = caretRect(ed, ed.selectionStart);
    fmtBar.classList.add('show');
    const w = fmtBar.offsetWidth;
    let x = c.left - 12, y = c.top - 44;
    if (y < 48) y = c.bottom + 8;
    x = Math.max(8, Math.min(window.innerWidth - w - 8, x));
    fmtBar.style.left = x + 'px'; fmtBar.style.top = y + 'px';
  }
  function hideFmtBar() { fmtBar.classList.remove('show'); }
  fmtBar.addEventListener('mousedown', e => e.preventDefault());
  fmtBar.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || !fmtTarget) return;
    const ed = fmtTarget, a = b.dataset.f;
    const map = { b: ['**', '**'], i: ['*', '*'], s: ['~~', '~~'], c: ['`', '`'], h: ['==', '=='], u: ['<u>', '</u>'] };
    if (a === 'ai') { hideFmtBar(); aiMenuAt(ed); return; }
    if (map[a]) wrapSel(ed, ...map[a]); else if (a === 'k') insertLink(ed); else if (a === 'h2') linePrefix(ed, '## '); else if (a === 'q') linePrefix(ed, '> ');
    setTimeout(() => fmtBarCheck(ed), 0);
  });
  let scrollFix = 0;
  const reposPopups = () => { cancelAnimationFrame(scrollFix); scrollFix = requestAnimationFrame(() => { if (AC.open && AC.ta && edFocused(AC.ta)) acCheck(AC.ta); else acClose(); if (fmtTarget && fmtBar.classList.contains('show')) fmtBarCheck(fmtTarget); }); };
  writeScroll.addEventListener('scroll', reposPopups);

  /* ================= autocomplete: "/" commands, [[wiki]], :emoji ================= */
  const MERMAID_SNIP = '```mermaid\ngraph LR\n  A[开始] --> B{判断}\n  B -->|是| C[执行]\n  B -->|否| D[结束]\n```';
  const WAVE_SNIP = '```wavedrom\n{ signal: [\n  { name: "clk",  wave: "p......" },\n  { name: "cs",   wave: "10....1" },\n  { name: "data", wave: "x.3456x", data: ["A0","A1","D0","D1"] }\n]}\n```';
  const REG_SNIP = '```wavedrom\n{ reg: [\n  { bits: 8,  name: "DATA",  attr: "RW" },\n  { bits: 4,  name: "MODE",  attr: "RW" },\n  { bits: 3,  name: "rsv" },\n  { bits: 1,  name: "EN",    attr: "RW" }\n]}\n```';
  const SLASH = [
    { ic: 'H1', t: '一级标题', k: 'h1 heading title biaoti bt', x: '# ' },
    { ic: 'H2', t: '二级标题', k: 'h2 heading title biaoti bt', x: '## ' },
    { ic: 'H3', t: '三级标题', k: 'h3 heading title biaoti bt', x: '### ' },
    { ic: '•', t: '无序列表', k: 'ul list bullet liebiao lb', x: '- ' },
    { ic: '1.', t: '有序列表', k: 'ol list number liebiao lb', x: '1. ' },
    { ic: '☐', t: '待办（今天截止）', k: 'task todo checkbox renwu daiban rw db', x: () => '- [ ]  📅 ' + today(), c: 6 },
    { ic: '❝', t: '引用', k: 'quote blockquote yinyong yy', x: '> ' },
    { ic: '▦', t: '表格', k: 'table biaoge bg', x: '| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n|  |  |  |', c: 2, s: 2 },
    { ic: '{}', t: '代码块', k: 'code fence daima dm', x: '```\n\n```', c: 3 },
    { ic: '∑', t: '公式块', k: 'math latex katex gongshi gs', x: '$$\n\n$$', c: 3 },
    { ic: '◇', t: '流程图 Mermaid', k: 'mermaid flow chart diagram liuchengtu lct tubiao', x: MERMAID_SNIP },
    { ic: '⏱', t: '时序图 WaveDrom', k: 'wavedrom timing wave shixu sx boxing', x: WAVE_SNIP },
    { ic: '▤', t: '寄存器位域 WaveDrom', k: 'register reg bitfield jicunqi jcq weiyu', x: REG_SNIP },
    { ic: 'ℹ', t: '提示框 Note', k: 'note alert tip tishi ts', x: '> [!NOTE]\n> ' },
    { ic: '⚠', t: '警告框 Warning', k: 'warning alert caution jinggao jg', x: '> [!WARNING]\n> ' },
    { ic: '▸', t: '折叠块', k: 'details collapse zhedie zd', x: '<details>\n<summary>点击展开</summary>\n\n内容\n\n</details>' },
    { ic: '🖼', t: '图片', k: 'image img picture tupian tp', x: '![]()', c: 4 },
    { ic: '🔗', t: '链接', k: 'link url lianjie lj', x: '[]()', c: 1 },
    { ic: '⟦', t: '双链 [[笔记]]', k: 'wiki link shuanglian sl backlink', x: '[[', c: 2 },
    { ic: '¹', t: '脚注', k: 'footnote jiaozhu jz', x: '[^1]\n\n[^1]: ' },
    { ic: '—', t: '分隔线 / 幻灯片分页', k: 'hr divider line fengexian fgx slide', x: '---' },
    { ic: '☰', t: '目录 TOC', k: 'toc contents mulu ml', x: '[TOC]' },
    { ic: '🕒', t: '当前日期时间', k: 'date time riqi rq now', x: () => today() + ' ' + new Date().toTimeString().slice(0, 5) },
    { ic: '✨', t: 'AI 写作…', k: 'ai gpt write xiezuo zhineng', x: '', ai: true }
  ];
  const acEl = $('#ac');
  const AC = { open: false, list: [], sel: 0, ta: null, from: 0, to: 0, kind: '' };
  function acCheck(ed) {
    if (!prefs.slash || !ed || !edFocused(ed) || ed.selectionStart !== ed.selectionEnd) return acClose();
    const c = lineCtx(ed), p = c.p, before = c.before;
    if (before.length > 80 || !/[\/\[:]/.test(before)) return acClose();
    const blk = ed === srcEd ? (edInFence(ed, p) ? 'code' : '') : (MD.splitBlocks(ed.value).blocks[0] || {}).type;
    if (blk === 'code' || blk === 'math') return acClose();
    let m;
    if ((m = before.match(/^\/([^\s\/]{0,12})$/))) {
      const q = m[1].toLowerCase();
      const list = SLASH.filter(s => !q || s.k.includes(q) || s.t.toLowerCase().includes(q) || s.ic.toLowerCase().includes(q));
      return acOpen(ed, 'slash', c.ls, p, list.map(s => ({ ic: s.ic, label: s.t, hint: s.k.split(' ')[0], val: s })));
    }
    if ((m = before.match(/\[\[([^\[\]|\n]{0,40})$/))) {
      const q = m[1].toLowerCase();
      const list = wikiCandidates().map(n => { const f = fuzzy(q, n.name); return f ? Object.assign({}, n, f) : null; }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 15);
      if (!list.length && q) list.push({ name: m[1], sub: '新建链接', score: 0 });
      return acOpen(ed, 'wiki', p - m[1].length, p, list.map(n => ({ ic: '⟦', label: n.name, hint: n.sub || '', val: n.name })));
    }
    if ((m = before.match(/(?:^|[\s(（，。,：:])(:([a-z0-9_+\-]{1,20}))$/)) && !/`[^`]*$/.test(before)) {
      const q = m[2]; const keys = Object.keys(MD.EMOJI);
      const list = keys.filter(k => k.startsWith(q)).concat(keys.filter(k => !k.startsWith(q) && k.includes(q))).slice(0, 12);
      return acOpen(ed, 'emoji', p - m[1].length, p, list.map(k => ({ ic: MD.EMOJI[k], label: ':' + k + ':', hint: '', val: MD.EMOJI[k] })));
    }
    acClose();
  }
  function acOpen(ed, kind, from, to, list) {
    if (!list.length) return acClose();
    Object.assign(AC, { open: true, list, sel: 0, ta: ed, from, to, kind });
    acDraw();
    const c = caretRect(ed, from);
    acEl.classList.add('show');
    const h = acEl.offsetHeight, w = acEl.offsetWidth;
    let x = c.left, y = c.bottom + 4;
    if (y + h > innerHeight - 8) y = c.top - h - 4;
    acEl.style.left = Math.max(8, Math.min(innerWidth - w - 8, x)) + 'px'; acEl.style.top = Math.max(8, y) + 'px';
  }
  function acDraw() {
    const head = { slash: '插入 · ↑↓ 选择 · Enter 确认 · Esc 取消', emoji: 'Emoji', wiki: '链接到笔记' }[AC.kind];
    acEl.innerHTML = '<div class="ac-head">' + head + '</div>' +
      AC.list.map((it, i) => '<div class="ac-it' + (i === AC.sel ? ' sel' : '') + '" data-i="' + i + '"><span class="ic">' + esc(it.ic) + '</span><span>' + esc(it.label) + '</span>' + (it.hint ? '<small>' + esc(it.hint) + '</small>' : '') + '</div>').join('');
    const s = acEl.querySelector('.sel'); if (s) s.scrollIntoView({ block: 'nearest' });
  }
  function acClose() { if (!AC.open) return; AC.open = false; acEl.classList.remove('show'); }
  function acApply(i) {
    const it = AC.list[i]; if (!it) return;
    const { ta: ed, from, to, kind } = AC; acClose();
    ed.focus();
    if (kind === 'emoji') edReplace(ed, from, to, it.val, from + it.val.length);
    else if (kind === 'wiki') { const close = edSlice(ed, to, to + 2) === ']]' ? '' : ']]'; edReplace(ed, from, to, it.val + close, from + it.val.length + 2); }
    else {
      const s = it.val;
      if (s.ai) { edReplace(ed, from, to, '', from); aiOpenPanel(true); return; }
      const x = typeof s.x === 'function' ? s.x() : s.x;
      const c = from + (s.c != null ? s.c : x.length);
      edReplace(ed, from, to, x, c, c + (s.s || 0));
    }
  }
  function acKey(e) {
    if (!AC.open) return false;
    if (e.key === 'ArrowDown') { e.preventDefault(); AC.sel = (AC.sel + 1) % AC.list.length; acDraw(); return true; }
    if (e.key === 'ArrowUp') { e.preventDefault(); AC.sel = (AC.sel - 1 + AC.list.length) % AC.list.length; acDraw(); return true; }
    if ((e.key === 'Enter' || e.key === 'Tab') && !composing(e)) { e.preventDefault(); acApply(AC.sel); return true; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); acClose(); return true; }
    return false;
  }
  acEl.addEventListener('mousedown', e => { e.preventDefault(); const it = e.target.closest('[data-i]'); if (it) acApply(+it.dataset.i); });

  /* ================= table tools ================= */
  function parseTable(text) {
    const lines = text.split('\n').filter(l => l.trim());
    const rows = lines.map(l => MD.splitRow(l));
    const aligns = (rows[1] || []).map(c => /^:-+:$/.test(c) ? 'c' : /-+:$/.test(c) ? 'r' : /^:-+/.test(c) ? 'l' : '');
    const body = [rows[0]].concat(rows.slice(2));
    const n = Math.max(...body.map(r => r.length), aligns.length, 1);
    body.forEach(r => { while (r.length < n) r.push(''); });
    while (aligns.length < n) aligns.push('');
    return { rows: body, aligns, n };
  }
  function buildTable(t) {
    const w = Array.from({ length: t.n }, (_, i) => Math.max(3, ...t.rows.map(r => dispW(r[i] || ''))));
    const pad = (s, i) => { const d = w[i] - dispW(s); const a = t.aligns[i]; if (a === 'r') return ' '.repeat(d) + s; if (a === 'c') return ' '.repeat(d >> 1) + s + ' '.repeat(d - (d >> 1)); return s + ' '.repeat(d); };
    const line = r => '| ' + r.map((c, i) => pad(c, i)).join(' | ') + ' |';
    const sep = '| ' + w.map((x, i) => { const a = t.aligns[i]; return a === 'c' ? ':' + '-'.repeat(x - 2) + ':' : a === 'r' ? '-'.repeat(x - 1) + ':' : a === 'l' ? ':' + '-'.repeat(x - 1) : '-'.repeat(x); }).join(' | ') + ' |';
    return [line(t.rows[0]), sep].concat(t.rows.slice(1).map(line)).join('\n');
  }
  const formatTable = text => { try { return buildTable(parseTable(text)); } catch (e) { return text; } };
  function tablePos(text, p) {
    const lines = text.slice(0, p).split('\n'); const li = lines.length - 1;
    const before = lines[li].replace(/\\\|/g, '__');
    const col = Math.max(0, (before.match(/\|/g) || []).length - (/^\s*\|/.test(before) ? 1 : 0));
    const nonEmpty = text.split('\n').slice(0, li).filter(l => l.trim()).length;
    const row = nonEmpty === 0 ? 0 : nonEmpty === 1 ? -1 : nonEmpty - 1;
    return { row, col };
  }
  function tableInfo(ed, bar) { const v = ed.value; const t = parseTable(v), p = tablePos(v, ed.selectionStart); bar.querySelector('.info').textContent = (t.rows.length - 1) + ' 行 × ' + t.n + ' 列' + (p.row >= 0 ? ' · 第 ' + (p.row + 1) + ' 行 第 ' + (Math.min(p.col, t.n - 1) + 1) + ' 列' : ''); }
  function caretToCell(text, row, col) {
    const lines = text.split('\n'); const li = Math.min(row === 0 ? 0 : row + 1, lines.length - 1);
    let off = 0; for (let k = 0; k < li; k++) off += lines[k].length + 1;
    const l = lines[li] || ''; let cnt = 0, k = 0;
    for (; k < l.length; k++) { if (l[k] === '|' && l[k - 1] !== '\\') { if (cnt === col) break; cnt++; } }
    return off + Math.min(l.length, k + 2);
  }
  function tableOp(ed, op) {
    const v = ed.value; const t = parseTable(v); let { row, col } = tablePos(v, ed.selectionStart); if (row < 0) row = 0; col = Math.min(col, t.n - 1);
    const blank = () => Array(t.n).fill('');
    switch (op) {
      case 'row-above': row = Math.max(1, row); t.rows.splice(row, 0, blank()); break;
      case 'row-below': t.rows.splice(row + 1, 0, blank()); row = row + 1; break;
      case 'col-left': t.rows.forEach(r => r.splice(col, 0, '')); t.aligns.splice(col, 0, ''); t.n++; break;
      case 'col-right': t.rows.forEach(r => r.splice(col + 1, 0, '')); t.aligns.splice(col + 1, 0, ''); t.n++; col++; break;
      case 'del-row': if (row === 0) return toast('表头行不能删除'); if (t.rows.length <= 2) return toast('至少保留一行数据'); t.rows.splice(row, 1); row = Math.min(row, t.rows.length - 1); break;
      case 'del-col': if (t.n <= 1) return toast('至少保留一列'); t.rows.forEach(r => r.splice(col, 1)); t.aligns.splice(col, 1); t.n--; col = Math.min(col, t.n - 1); break;
      case 'al-left': t.aligns[col] = 'l'; break; case 'al-center': t.aligns[col] = 'c'; break; case 'al-right': t.aligns[col] = 'r'; break;
      case 'sort': {
        const body = t.rows.slice(1); const num = body.every(r => !r[col] || !isNaN(parseFloat(r[col].replace(/[, ]/g, ''))));
        const asc = !(t.lastSort === col); body.sort((a, b) => { const x = a[col] || '', y = b[col] || ''; const r = num ? parseFloat(x.replace(/[, ]/g, '') || 0) - parseFloat(y.replace(/[, ]/g, '') || 0) : x.localeCompare(y, 'zh-CN', { numeric: true }); return r; });
        t.rows = [t.rows[0]].concat(body); toast('已按第 ' + (col + 1) + ' 列排序'); break;
      }
      case 'tsv': {
        const tsv = t.rows.map(r => r.map(c => c.replace(/\\\|/g, '|').replace(/\t/g, ' ')).join('\t')).join('\r\n');
        navigator.clipboard.writeText(tsv).then(() => toast('已复制，可直接粘贴到 Excel')); return;
      }
      case 'format': break;
    }
    const out = buildTable(t);
    replaceAllText(ed, out, caretToCell(out, row, col));
  }
  function tableTab(ed, back) {
    const v = ed.value; const t = parseTable(v); let { row, col } = tablePos(v, ed.selectionStart); if (row < 0) row = 0;
    col += back ? -1 : 1;
    if (col >= t.n) { col = 0; row++; } if (col < 0) { col = t.n - 1; row--; }
    if (row < 0) row = 0;
    if (row >= t.rows.length) t.rows.push(Array(t.n).fill(''));
    const out = buildTable(t);
    const c = caretToCell(out, row, col), cell = (t.rows[row][col] || '').trim();
    edReplace(ed, 0, edLen(ed), out, c, c + (cell ? dispLen(out, c) : 0));
  }
  /* length (in chars) of the cell text starting at position c (up to the padding before the next |) */
  function dispLen(text, c) { const e = text.indexOf('|', c); const seg = text.slice(c, e < 0 ? text.length : e); return seg.replace(/\s+$/, '').length; }

  /* ================= rich paste: HTML → Markdown ================= */
  function html2md(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('style,script,meta,title,link,head,xml').forEach(n => n.remove());
    doc.querySelectorAll('[style*="mso-list:Ignore"],[style*="mso-list: Ignore"]').forEach(n => n.remove());
    const cellText = n => conv(n, { inTable: true }).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
    function kids(n, c) { let s = ''; n.childNodes.forEach(ch => s += conv(ch, c)); return s; }
    function conv(n, c) {
      c = c || {};
      if (n.nodeType === 3) { let t = n.nodeValue; if (c.pre) return t; t = t.replace(/[\s\u00a0]+/g, ' '); return t.replace(/([*_`\\])/g, '\\$1'); }
      if (n.nodeType !== 1) return '';
      const tag = n.tagName.toLowerCase(); const st = (n.getAttribute('style') || '').toLowerCase();
      const wrapI = (m, x) => x.trim() ? (x.match(/^\s*/)[0] + m + x.trim() + m + x.match(/\s*$/)[0]) : x;
      switch (tag) {
        case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': return '\n\n' + '#'.repeat(+tag[1]) + ' ' + kids(n, c).replace(/\s+/g, ' ').trim() + '\n\n';
        case 'br': return c.inTable ? ' ' : '  \n';
        case 'hr': return '\n\n---\n\n';
        case 'strong': case 'b': return wrapI('**', kids(n, c));
        case 'em': case 'i': return wrapI('*', kids(n, c));
        case 'u': case 'ins': { const x = kids(n, c); return x.trim() ? '<u>' + x + '</u>' : x; }
        case 's': case 'del': case 'strike': return wrapI('~~', kids(n, c));
        case 'mark': return wrapI('==', kids(n, c));
        case 'sub': return '<sub>' + kids(n, c) + '</sub>';
        case 'sup': return '<sup>' + kids(n, c) + '</sup>';
        case 'code': return c.pre ? n.textContent : '`' + n.textContent + '`';
        case 'pre': { const lang = ((n.querySelector('code') || n).className.match(/language-(\S+)/) || [])[1] || ''; return '\n\n```' + lang + '\n' + n.textContent.replace(/\n$/, '') + '\n```\n\n'; }
        case 'a': { const href = n.getAttribute('href') || ''; const t = kids(n, c).trim(); if (!href || /^javascript:/i.test(href) || href.startsWith('#')) return t; return t === href ? '<' + href + '>' : '[' + (t || href) + '](' + href + ')'; }
        case 'img': { const s = n.getAttribute('src') || ''; if (!s || /^file:/i.test(s)) return ''; return '![' + (n.getAttribute('alt') || '') + '](' + s + ')'; }
        case 'ul': case 'ol': {
          const d = c.depth || 0; let i = parseInt(n.getAttribute('start') || '1', 10);
          const items = Array.from(n.children).filter(x => x.tagName === 'LI').map(li => {
            const cb = li.querySelector(':scope > input[type=checkbox]');
            const body = kids(li, Object.assign({}, c, { depth: d + 1 })).replace(/^\s+|\s+$/g, '').replace(/\n{2,}/g, '\n');
            const mk = tag === 'ol' ? (i++) + '. ' : '- ';
            const lines = body.split('\n');
            return '  '.repeat(d) + mk + (cb ? (cb.checked ? '[x] ' : '[ ] ') : '') + lines[0].trim() + (lines.length > 1 ? '\n' + lines.slice(1).join('\n') : '');
          });
          return (d ? '\n' : '\n\n') + items.join('\n') + (d ? '\n' : '\n\n');
        }
        case 'blockquote': return '\n\n' + kids(n, c).trim().split('\n').map(l => '> ' + l).join('\n') + '\n\n';
        case 'table': {
          const rows = Array.from(n.querySelectorAll('tr')).map(tr => Array.from(tr.children).filter(x => /^T[DH]$/.test(x.tagName)).map(cellText));
          if (!rows.length) return '';
          const w = Math.max(...rows.map(r => r.length));
          rows.forEach(r => { while (r.length < w) r.push(''); });
          const md = ['| ' + rows[0].join(' | ') + ' |', '|' + ' --- |'.repeat(w)].concat(rows.slice(1).map(r => '| ' + r.join(' | ') + ' |')).join('\n');
          return '\n\n' + formatTable(md) + '\n\n';
        }
        case 'p': case 'div': case 'section': case 'article': case 'header': case 'footer': case 'dd': case 'dt': case 'figure': case 'figcaption': {
          if (c.inTable) return kids(n, c) + ' ';
          if (tag === 'p' && /MsoListParagraph/i.test(n.className || '')) return '\n- ' + kids(n, c).trim() + '\n';
          return '\n\n' + kids(n, c) + '\n\n';
        }
        case 'span': case 'font': {
          const x = kids(n, c);
          if (/font-weight\s*:\s*(bold|[6-9]00)/.test(st)) return wrapI('**', x);
          if (/font-style\s*:\s*italic/.test(st)) return wrapI('*', x);
          return x;
        }
        default: return kids(n, c);
      }
    }
    let md = conv(doc.body, {});
    md = md.split('\n').map(l => / {2}$/.test(l) && l.trim() ? l.replace(/\s+$/, '  ') : l.replace(/\s+$/, '')).join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, '');
    return md;
  }
  let plainPaste = false;
  document.addEventListener('keydown', e => { plainPaste = (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v'; }, true);

  async function assetsDir() {
    if (S.dirHandle && S.filePath) { let h = S.dirHandle; for (const p of S.filePath.slice(0, -1)) h = await h.getDirectoryHandle(p); return h.getDirectoryHandle('assets', { create: true }); }
    if (NATIVE && S.fileHandle && S.fileHandle.__path) return new NDir(dirName(S.fileHandle.__path)).getDirectoryHandle('assets', { create: true });
    return null;
  }
  async function shrinkImage(file) {
    if (!prefs.imgMax || !/^image\/(png|jpeg|webp)$/.test(file.type) || !window.createImageBitmap) return file;
    try {
      const bmp = await createImageBitmap(file);
      if (bmp.width <= prefs.imgMax) { bmp.close && bmp.close(); return file; }
      const k = prefs.imgMax / bmp.width, c = document.createElement('canvas');
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise(r => c.toBlob(r, file.type, 0.9));
      if (blob && blob.size < file.size) { toast('图片已缩放到 ' + c.width + 'px 宽'); return new File([blob], file.name || 'image', { type: file.type }); }
    } catch (e) { }
    return file;
  }
  async function onPaste(e, ed) {
    const cd = e.clipboardData; if (!cd) return;
    const items = Array.from(cd.items || []);
    const img = items.find(i => i.type && i.type.startsWith('image/'));
    const html = cd.getData ? cd.getData('text/html') : '';
    if (img && !(html && /<table/i.test(html))) {
      e.preventDefault();
      const file = await shrinkImage(img.getAsFile()); const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
      const name = 'image-' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + Math.random().toString(36).slice(2, 5) + '.' + ext;
      const alive = () => !ed.cm || ed.view.dom.isConnected;
      try {
        const ad = await assetsDir();
        if (ad) {
          const fh = await ad.getFileHandle(name, { create: true }); const w = await fh.createWritable(); await w.write(file); await w.close();
          if (!alive()) return toast('图片已保存到 assets/' + name + '（编辑框已关闭，未插入）');
          ed.focus(); insertAt(ed, '![' + name.replace(/\.\w+$/, '') + '](assets/' + name + ')'); toast('图片已保存到 assets/' + name); return;
        }
      } catch (err) { toast('无法写入 assets 目录，改为内嵌图片'); }
      const rd = new FileReader();
      rd.onload = () => { if (!alive()) return; ed.focus(); insertAt(ed, '![' + name.replace(/\.\w+$/, '') + '](' + rd.result + ')'); toast(NATIVE ? '新文档尚未保存，图片暂以 Base64 内嵌；保存后再粘贴会存入 assets/' : '图片已内嵌。打开文档所在文件夹后，粘贴的图片会自动保存到 assets/', 3500); };
      rd.readAsDataURL(file); return;
    }
    if (!html || !prefs.richPaste || plainPaste) return;
    if (ed !== srcEd) { const blk = (MD.splitBlocks(ed.value).blocks[0] || {}).type; if (blk === 'code' || blk === 'math') return; }
    else if (edInFence(ed, ed.selectionStart)) return;
    if (!/<(table|h[1-6]|ul|ol|li|strong|b|em|i|a\s|img|pre|blockquote|code|del|s|u)\b/i.test(html)) return;
    const md = html2md(html); if (!md) return;
    e.preventDefault();
    insertAt(ed, md);
    toast('已将富文本转换为 Markdown（Ctrl+Shift+V 粘贴纯文本）', 2200);
  }

  /* ================= live view clicks ================= */
  write.addEventListener('mousedown', e => { if (e.target.classList.contains('task-cb')) e.preventDefault(); });
  write.addEventListener('click', e => {
    const t = e.target;
    if (t.closest('.blk.editing') || t.closest('.img-banner')) return;
    if (t.classList.contains('copy-btn')) {
      const code = t.closest('.code-wrap').querySelector('code').innerText;
      navigator.clipboard.writeText(code).then(() => { t.textContent = '已复制'; setTimeout(() => t.textContent = '复制', 1200); }); return;
    }
    if (t.classList.contains('task-cb')) { toggleTask(t); return; }
    const a = t.closest('a');
    if (a) {
      e.preventDefault();
      if (a.classList.contains('wikilink')) { openWiki(a.dataset.wiki); return; }
      const href = a.getAttribute('href') || '';
      if (href.startsWith('#')) { scrollToId(decodeURIComponent(href.slice(1))); return; }
      if (e.ctrlKey || e.metaKey) { openLink(href); return; }
    }
    if (!window.getSelection().isCollapsed) return;
    if (t.closest('.add-zone') || t.closest('.empty-hint')) {
      if (S.editing) commit();
      const lines = srcLines(); let at = lines.length; while (at > 0 && lines[at - 1].trim() === '') at--;
      if (!S.src.trim()) at = 0;
      const blks = allBlks();
      startInsert(at, blks[blks.length - 1]); return;
    }
    if (t.closest('.footnotes') || t.closest('summary')) return;
    const blk = t.closest('.blk');
    if (blk && blk.dataset.i !== undefined) {
      const startLine = S.result.blocks[+blk.dataset.i].start;
      const caret = caretFromClick(blk, e); let line = startLine;
      if (S.editing) { const n0 = srcLines().length; const rg = committedRange(commit()); if (startLine >= rg.oldEnd) line += srcLines().length - n0; }
      editAtLine(line, caret);
    }
  });
  function caretFromClick(blk, e) {
    try {
      const rng = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
      if (!rng || rng.startContainer.nodeType !== 3) return 'end';
      const txt = rng.startContainer.textContent; const off = rng.startOffset;
      const src = S.result.blocks[+blk.dataset.i].src;
      const needle = txt.slice(Math.max(0, off - 12), off);
      if (needle.length >= 2) { const k = src.indexOf(needle); if (k >= 0) return k + needle.length; }
      const after = txt.slice(off, off + 12);
      if (after.length >= 2) { const k = src.indexOf(after); if (k >= 0) return k; }
    } catch (err) { }
    return 'end';
  }
  function toggleTask(cb) {
    const blk = cb.closest('.blk'); if (!blk) return;
    const b = S.result.blocks[+blk.dataset.i];
    const n = Array.from(blk.querySelectorAll('.task-cb')).indexOf(cb);
    const lines = srcLines(); let c = -1;
    for (let k = b.start; k < b.end; k++) {
      const m = lines[k].match(/^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/);
      if (m && ++c === n) { lines[k] = m[1] + '[' + (m[2] === ' ' ? 'x' : ' ') + ']' + lines[k].slice(m[0].length); break; }
    }
    setSrc(lines.join('\n'));
  }
  async function openLink(href) {
    if (/^(https?:|mailto:)/i.test(href)) { openExternal(href); return; }
    if (/\.(md|markdown|txt)(#.*)?$/i.test(href) && canResolveRel()) {
      try { const fh = await relFileHandle(href.split('#')[0]); openHandle(fh, fh._path || (S.dirHandle && S.dirHandle.resolve ? await S.dirHandle.resolve(fh) : null)); } catch (e) { toast('无法打开: ' + href); }
      return;
    }
    openExternal(href);
  }

  /* image right-click: Typora-style zoom */
  write.addEventListener('contextmenu', e => {
    const img = e.target.closest('img'); if (!img || img.closest('.blk.editing')) return;
    const blk = img.closest('.blk'); if (!blk || blk.dataset.i == null) return;
    e.preventDefault();
    showCtx(e.clientX, e.clientY, [['z25', '缩放 25%'], ['z50', '缩放 50%'], ['z75', '缩放 75%'], ['z100', '原始大小'], ['-'], ['view', '全屏查看'], ['copy', '复制图片地址']].concat(NATIVE ? [['reveal', '在资源管理器中显示']] : []), act => imgAction(act, img, +blk.dataset.i));
  });
  async function imgAction(act, img, i) {
    const src = img.getAttribute('data-src') || img.getAttribute('src') || '';
    if (act === 'view') return openLightbox(img);
    if (act === 'copy') return navigator.clipboard.writeText(src).then(() => toast('已复制图片地址'));
    if (act === 'reveal') { try { const fh = await relFileHandle(src); inv('reveal', { path: fh.__path }); } catch (e) { toast('找不到图片文件'); } return; }
    const b = S.result.blocks[i]; const lines = srcLines(); let text = lines.slice(b.start, b.end).join('\n');
    const es = reEsc(src);
    const zoom = +act.slice(1);
    const mdRe = new RegExp('!\\[([^\\]]*)\\]\\(\\s*<?' + es + '>?(?:\\s+["\'][^"\']*["\'])?\\s*\\)');
    const tagRe = new RegExp('<img\\b[^>]*\\ssrc\\s*=\\s*["\']?' + es + '["\']?[^>]*>', 'i');
    let alt = '', m;
    if ((m = text.match(mdRe))) alt = m[1];
    else if ((m = text.match(tagRe))) { const a = m[0].match(/\salt\s*=\s*["']([^"']*)["']/i); alt = a ? a[1] : ''; }
    else return toast('未找到图片源码');
    const s2 = /\s/.test(src) ? '<' + src + '>' : src;
    const rep = zoom === 100 ? '![' + alt + '](' + s2 + ')' : '<img src="' + src + '" alt="' + alt.replace(/"/g, '&quot;') + '" style="zoom:' + zoom + '%">';
    text = text.replace(m[0], () => rep);
    lines.splice(b.start, b.end - b.start, ...text.split('\n')); setSrc(lines.join('\n'));
    toast(zoom === 100 ? '已恢复原始大小' : '图片已缩放到 ' + zoom + '%');
  }

  /* ================= lightbox ================= */
  const zoomBtn = $('#zoom-btn'); let zoomTarget = null;
  function zoomHover(e) {
    if (e.target.closest && e.target.closest('#zoom-btn')) return;
    const t = e.target.closest && (e.target.closest('img') || e.target.closest('.mermaid[data-processed]') || e.target.closest('.wavedrom[data-processed]'));
    if (t && !t.closest('.blk.editing') && (t.tagName !== 'IMG' || (t.naturalWidth > 1 && !t.classList.contains('img-pending')))) {
      zoomTarget = t; const r = t.getBoundingClientRect();
      zoomBtn.style.left = (r.right - 34) + 'px'; zoomBtn.style.top = (r.top + 6) + 'px'; zoomBtn.style.display = 'block';
    } else zoomBtn.style.display = 'none';
  }
  [write, preview].forEach(x => x.addEventListener('mouseover', zoomHover));
  [writeScroll, previewScroll].forEach(x => x.addEventListener('scroll', () => zoomBtn.style.display = 'none'));
  zoomBtn.addEventListener('click', () => { if (zoomTarget) openLightbox(zoomTarget); zoomBtn.style.display = 'none'; });
  const LB = { s: 1, x: 0, y: 0 };
  function openLightbox(t) {
    const lb = $('#lightbox'), st = lb.querySelector('.lb-stage');
    let node;
    if (t.tagName === 'IMG') { node = new Image(); node.src = t.src; }
    else { const svg = t.querySelector('svg'); if (!svg) return; node = svg.cloneNode(true); const bb = svg.getBoundingClientRect(); node.removeAttribute('style'); node.setAttribute('width', bb.width); node.setAttribute('height', bb.height); }
    st.replaceChildren(node); lb.classList.add('show');
    const fit = () => { const w = node.naturalWidth || +node.getAttribute('width') || 600, h = node.naturalHeight || +node.getAttribute('height') || 400; LB.s = Math.min(1.6, (innerWidth * .9) / w, (innerHeight * .85) / h); LB.x = -w * LB.s / 2; LB.y = -h * LB.s / 2; applyLB(); };
    if (node.tagName === 'IMG' && !node.complete) node.onload = fit; else fit();
    LB.fit = fit;
  }
  function applyLB() { $('#lightbox .lb-stage').style.transform = 'translate(' + LB.x + 'px,' + LB.y + 'px) scale(' + LB.s + ')'; }
  (() => {
    const lb = $('#lightbox'); let drag = null;
    lb.addEventListener('wheel', e => { e.preventDefault(); const f = e.deltaY < 0 ? 1.15 : 1 / 1.15; const cx = e.clientX - innerWidth / 2, cy = e.clientY - innerHeight / 2; LB.x = cx - (cx - LB.x) * f; LB.y = cy - (cy - LB.y) * f; LB.s *= f; applyLB(); }, { passive: false });
    lb.addEventListener('mousedown', e => { if (e.target.classList.contains('lb-close')) return; drag = { x: e.clientX - LB.x, y: e.clientY - LB.y, moved: false }; lb.style.cursor = 'grabbing'; });
    window.addEventListener('mousemove', e => { if (!drag) return; drag.moved = true; LB.x = e.clientX - drag.x; LB.y = e.clientY - drag.y; applyLB(); });
    window.addEventListener('mouseup', e => { if (drag && !drag.moved && e.target === lb) lb.classList.remove('show'); drag = null; lb.style.cursor = ''; });
    lb.addEventListener('dblclick', () => LB.fit && LB.fit());
    lb.querySelector('.lb-close').onclick = () => lb.classList.remove('show');
  })();
