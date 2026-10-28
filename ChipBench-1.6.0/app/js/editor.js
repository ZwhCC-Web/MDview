/* ChipBench · editor.js — CodeMirror 6 kernel: source mode + Obsidian-style live preview.
   CM6 already gives P7/P8: the document is a rope (line-indexed B-tree) and only the viewport is rendered;
   live-preview decorations are computed for visible ranges only; block widgets for top-level blocks only. */
(function (G) {
  'use strict';
  const SL = G.ChipBench, U = SL.U, E = SL.E = {};
  const WIDGETS = new Set(['mermaid', 'clocktree', 'clock-tree', 'structure', 'register', 'memmap', 'pinout', 'query', 'partdecode', 'board', 'chart', 'flow', 'hotspot', 'gcl', 'wavedrom', 'ipblock', 'scene']);
  const MATHLANG = /^(math|katex|latex|tex)$/i;
  const url = p => new URL(p, document.baseURI).href;
  E.load = () => SL.lib('cm', async () => {
    const meta = await (await fetch(url('lib/cm/meta.json'))).json();
    const cm = await import(url('lib/cm/index.js')), core = await import(url('lib/cm/' + meta.core)), mdm = await import(url('lib/cm/' + meta.md));
    let tags = null; for (const k in core) { const v = core[k]; if (v && typeof v === 'object' && v.heading && v.strong && v.emphasis && v.monospace) { tags = v; break; } }
    if (!tags || !mdm.markdown) throw new Error('CodeMirror bundle mismatch');
    E.cm = build(cm, tags, mdm, meta); SL.emit('cm-ready'); return E.cm;
  });
  function build(cm, t, mdm, meta) {
    const { EditorView, EditorState, Decoration, WidgetType, ViewPlugin, StateField, StateEffect, Compartment, syntaxTree, keymap, Prec, RangeSetBuilder } = cm;
    const avail = new Set(meta.langs.map(x => x.toLowerCase()));
    const ALIAS = { js: 'javascript', ts: 'typescript', py: 'python', sh: 'shell', bash: 'shell', h: 'c', hpp: 'c++', cpp: 'c++', cs: 'c#', yml: 'yaml', md: 'markdown', ps1: 'powershell', rs: 'rust', golang: 'go', v: 'verilog', sv: 'verilog', vhd: 'vhdl', m: 'octave', tex: 'latex' };
    const codeLanguages = info => { const n = ALIAS[(info || '').toLowerCase()] || (info || '').toLowerCase(), d = cm.LanguageDescription.matchLanguageName(cm.languages, n, true); return d && avail.has(d.name.toLowerCase()) ? d : null; };
    const mdSupport = mdm.markdown({ base: mdm.markdownLanguage, codeLanguages, addKeymap: true });
    const hl = cm.HighlightStyle.define([
      { tag: t.heading, fontWeight: '700', color: 'var(--brand)' }, { tag: t.emphasis, fontStyle: 'italic' }, { tag: t.strong, fontWeight: '700' }, { tag: t.strikethrough, textDecoration: 'line-through' },
      { tag: t.link, color: 'var(--tk-fn)' }, { tag: t.url, color: 'var(--tk-fn)', textDecoration: 'underline' }, { tag: t.monospace, color: 'var(--tk-tag)' }, { tag: t.quote, color: 'var(--t3)' },
      { tag: [t.processingInstruction, t.contentSeparator, t.labelName, t.meta], color: 'var(--t4)' },
      { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.modifier], color: 'var(--tk-kw)' }, { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--tk-str)' }, { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--tk-num)' },
      { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--tk-com)', fontStyle: 'italic' }, { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--tk-fn)' }, { tag: [t.typeName, t.className, t.namespace], color: 'var(--tk-type)' }, { tag: [t.operator, t.punctuation, t.bracket], color: 'var(--tk-op)' }, { tag: t.tagName, color: 'var(--tk-tag)' }, { tag: [t.attributeName, t.propertyName], color: 'var(--tk-kw)' }
    ]);
    /* ---------- live preview ---------- */
    const refresh = StateEffect.define(), hits = StateEffect.define();
    class W extends WidgetType {
      constructor(kind, src, from, to, extra) { super(); this.kind = kind; this.src = src; this.from = from; this.to = to; this.extra = extra || ''; }
      eq(o) { return o.kind === this.kind && o.src === this.src && o.extra === this.extra; }
      get estimatedHeight() { return this.kind === 'table' ? 28 * ((this.src.match(/\n/g) || []).length) : 120; }
      toDOM(view) {
        const d = document.createElement(this.kind === 'inline' ? 'span' : 'div'); d.className = 'lv-w md' + (this.kind === 'inline' ? ' lv-inline' : '');
        const self = this; d.innerHTML = this.kind === 'hr' ? '<hr>' : (this.kind === 'img' || this.kind === 'inline') ? SL.md.inline(this.src) : this.kind === 'fm' ? SL.md.render(this.src).blocks.map(b => b.html).join('') : SL.md.render(this.src, {}).blocks.map(b => b.html).join('');
        if (SL.enhance) SL.enhance(d, { view, from: this.from });
        d.addEventListener('mousedown', e => { if (e.target.closest('.widget,a,button,input,.task-cb,.mermaid-box,select,textarea')) { e.stopPropagation(); return; } e.preventDefault(); view.dispatch({ selection: { anchor: Math.min(self.from + (self.kind === 'fm' ? 4 : 0), view.state.doc.length) }, scrollIntoView: true }); view.focus(); });
        d.addEventListener('click', e => { const a = e.target.closest('a'); if (a) { e.preventDefault(); e.stopPropagation(); SL.followLink && SL.followLink(a); } if (e.target.classList.contains('task-cb')) { e.stopPropagation(); } });
        return d;
      }
      ignoreEvent() { return true; }
    }
    class TkIcon extends WidgetType { constructor(k) { super(); this.k = k; } toDOM() { const s = document.createElement('i'); s.className = 'tki tki-' + this.k; return s; } eq(o) { return o.k === this.k; } }
    class Bullet extends WidgetType { toDOM() { const s = document.createElement('span'); s.className = 'lv-bullet'; s.textContent = '•'; return s; } eq() { return true; } ignoreEvent() { return false; } }
    class Check extends WidgetType {
      constructor(on, pos) { super(); this.on = on; this.pos = pos; } eq(o) { return o.on === this.on && o.pos === this.pos; }
      toDOM(view) { const c = document.createElement('input'); c.type = 'checkbox'; c.className = 'lv-cb'; c.checked = this.on; const pos = this.pos; c.addEventListener('mousedown', e => { e.preventDefault(); const cur = view.state.sliceDoc(pos, pos + 3); const ch = /\[[xX]\]/.test(cur); view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: ch ? ' ' : 'x' } }); }); return c; }
      ignoreEvent() { return true; }
    }
    const hide = Decoration.replace({}), dim = Decoration.mark({ class: 'lv-dim' });
    const lineD = c => Decoration.line({ class: c }), mk = (c, a) => Decoration.mark({ class: c, attributes: a });
    const BLOCKISH = new Set(['FencedCode', 'CodeBlock', 'Table', 'HTMLBlock', 'CommentBlock']);
    const touchSel = (sel, a, b) => sel.some(r => r.from <= b && r.to >= a);
    function inCode(tree, pos) { const n = tree.resolveInner(pos, 1); for (let x = n; x; x = x.parent) if (x.name === 'InlineCode' || x.name === 'FencedCode' || x.name === 'CodeBlock' || x.name === 'CodeText') return true; return false; }
    const PERF = E.perf = { inline: 0, inlineN: 0, block: 0, blockN: 0 };
    function inlineDecos(view) { const t0 = performance.now(); const r = inlineDecos0(view); PERF.inline += performance.now() - t0; PERF.inlineN++; return r; }
    function inlineDecos0(view) {
      const st = view.state, doc = st.doc, sel = st.selection.ranges, tree = syntaxTree(st), out = [], atomic = [];
      const add = (from, to, d, atom) => { if (to < from) return; out.push(d.range(from, to)); if (atom) atomic.push(d.range(from, to)); };
      const hideR = (a, b) => { if (b > a) add(a, b, hide, true); };
      /* 1.2: YAML front matter (--- … --- at the very top) is metadata, not Markdown: without this the closing --- turns the
         last property into a setext heading and the whole block renders as big blue headings */
      let fmEnd = -1; if (doc.lines > 1 && /^---\s*$/.test(doc.line(1).text)) { for (let i = 2, n = Math.min(doc.lines, 300); i <= n; i++) { if (/^(---|\.\.\.)\s*$/.test(doc.line(i).text)) { fmEnd = doc.line(i).to; break; } } }
      if (fmEnd > 0) { const fmL = doc.lineAt(fmEnd).number; for (let i = 1; i <= fmL; i++) { const l = doc.line(i); add(l.from, l.from, lineD('lv-fm' + (i === 1 ? ' lv-fm-first' : i === fmL ? ' lv-fm-last' : ''))); } }
      for (const { from, to } of view.visibleRanges) {
        tree.iterate({ from, to, enter(n) {
          const nm = n.name, a = n.from, b = n.to;
          if (a <= fmEnd) return nm === 'Document' ? undefined : false;
          if (/^ATXHeading[1-6]$/.test(nm)) { add(doc.lineAt(a).from, doc.lineAt(a).from, lineD('lv-h' + nm.slice(-1))); return; }
          if (nm === 'SetextHeading1' || nm === 'SetextHeading2') { for (let p = a; p <= b;) { const l = doc.lineAt(p); add(l.from, l.from, lineD('lv-h' + nm.slice(-1))); p = l.to + 1; } return; }
          if (nm === 'HeaderMark') { const par = n.node.parent, tc = touchSel(sel, par.from, par.to); if (!tc && par.name.startsWith('ATX')) hideR(a, Math.min(b + 1, doc.lineAt(a).to)); else add(a, b, dim); return; }
          if (nm === 'StrongEmphasis') { add(a, b, mk('lv-strong')); return; } if (nm === 'Emphasis') { add(a, b, mk('lv-em')); return; } if (nm === 'Strikethrough') { add(a, b, mk('lv-del')); return; }
          if (nm === 'EmphasisMark' || nm === 'StrikethroughMark') { const par = n.node.parent; if (!touchSel(sel, par.from, par.to)) hideR(a, b); else add(a, b, dim); return; }
          if (nm === 'InlineCode') { add(a, b, mk('lv-icode')); return; }
          if (nm === 'CodeMark' && n.node.parent && n.node.parent.name === 'InlineCode') { if (!touchSel(sel, n.node.parent.from, n.node.parent.to)) hideR(a, b); else add(a, b, dim); return; }
          if (nm === 'Link') { if (doc.sliceString(a, a + 2) === '[[') return false; if (!touchSel(sel, a, b)) { add(a, b, mk('lv-link')); } return; }
          if (nm === 'LinkMark' || nm === 'URL' || nm === 'LinkTitle') { const par = n.node.parent; if (par && doc.sliceString(par.from, par.from + 2) === '[[') return; if (par && (par.name === 'Link' || par.name === 'Image')) { if (par.name === 'Link' && !touchSel(sel, par.from, par.to)) hideR(a, b); else if (par.name === 'Link') add(a, b, dim); } return; }
          if (nm === 'Image') { if (!touchSel(sel, a, b)) { add(a, b, Decoration.replace({ widget: new W('img', doc.sliceString(a, b), a, b, hash(doc.sliceString(a, b))) }), true); return false; } return; }
          if (nm === 'Blockquote') { for (let p = Math.max(a, from); p <= Math.min(b, to);) { const l = doc.lineAt(p); add(l.from, l.from, lineD('lv-quote')); p = l.to + 1; } return; }
          if (nm === 'QuoteMark') { const l = doc.lineAt(a); if (!touchSel(sel, l.from, l.to)) hideR(a, Math.min(b + 1, l.to)); else add(a, b, dim); return; }
          if (nm === 'ListMark') { const l = doc.lineAt(a), par = n.node.parent && n.node.parent.parent; const bullet = par && par.name === 'BulletList'; if (bullet && !touchSel(sel, l.from, l.to)) add(a, b, Decoration.replace({ widget: new Bullet() }), true); else add(a, b, dim); return; }
          if (nm === 'TaskMarker') { const txt = doc.sliceString(a, b); add(a, b, Decoration.replace({ widget: new Check(/x/i.test(txt), a) }), true); return; }
          if (nm === 'HorizontalRule') { const l = doc.lineAt(a); add(l.from, l.from, lineD('lv-hr')); if (!touchSel(sel, l.from, l.to)) add(a, b, Decoration.mark({ attributes: { style: 'color:transparent;font-size:2px' } })); return; }
          if (nm === 'FencedCode') {
            const f = doc.lineAt(a), l = doc.lineAt(b), lang = (doc.sliceString(a, f.to).replace(/^[\s`~]+/, '').split(/\s/)[0] || '').toLowerCase(); const widgetBlock = (WIDGETS.has(lang) || MATHLANG.test(lang)) && !touchSel(sel, a, b);
            if (!widgetBlock) for (let p = Math.max(a, from); p <= Math.min(b, to);) { const ln = doc.lineAt(p); add(ln.from, ln.from, lineD('lv-fence ' + (ln.number === f.number ? 'lv-fence-open' : ln.number === l.number && /^\s*(```|~~~)/.test(ln.text) ? 'lv-fence-close' : 'lv-fence-body'))); p = ln.to + 1; }
            return;
          }
          if (nm === 'Table') { if (touchSel(sel, a, b)) for (let p = Math.max(a, from); p <= Math.min(b, to);) { const ln = doc.lineAt(p); add(ln.from, ln.from, lineD('lv-tbl')); p = ln.to + 1; } return; }
        } });
        /* regex extras on visible lines: [[wiki]], ==mark==, $math$ */
        const text = doc.sliceString(from, to); let m;
        const wre = /\[\[([^\[\]\n|]+?)(?:\|([^\[\]\n]+))?\]\]/g; while ((m = wre.exec(text))) { const a = from + m.index, b = a + m[0].length; if (inCode(tree, a)) continue; const tc = touchSel(sel, a, b); if (tc) add(a, b, mk('lv-wiki lv-wiki-edit', { 'data-wiki': m[1].trim() })); else { const ta = a + 2, tb = m[2] != null ? a + 2 + m[1].length + 1 : a + 2; hideR(a, tb); add(tb, b - 2, mk('lv-wiki', { 'data-wiki': m[1].trim() })); hideR(b - 2, b); } }
        const mre = /==(?=\S)([^=\n]+?)==/g; while ((m = mre.exec(text))) { const a = from + m.index, b = a + m[0].length; if (inCode(tree, a)) continue; if (touchSel(sel, a, b)) add(a, b, mk('lv-mark')); else { hideR(a, a + 2); add(a + 2, b - 2, mk('lv-mark')); hideR(b - 2, b); } }
        const tre = /(⏳|\uD83D\uDCC5|✅)\s?\d{4}-\d{2}-\d{2}|(⏰)\s?\d{1,2}:\d{2}/g; while ((m = tre.exec(text))) { const a = from + m.index, ic = m[1] || m[2], b = a + m[0].length; if (!touchSel(sel, a, b)) { const k = ic === '⏳' ? 'plan' : ic === '✅' ? 'done' : ic === '⏰' ? 'time' : 'due', il = ic.length + (text[m.index + ic.length] === ' ' ? 1 : 0); add(a, b, mk('lv-due')); add(a, a + il, Decoration.replace({ widget: new TkIcon(k) }), true); } else add(a, b, mk('lv-due')); }
        const ere = /(?<=\s)~\d+(?:\.\d+)?\s?(?:m|min|h|hr|d)\b/g; while ((m = ere.exec(text))) { const a = from + m.index; add(a, a + m[0].length, mk('lv-est')); }
        const dre = /(?<![\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g; while ((m = dre.exec(text))) { const a = from + m.index, b = a + m[0].length; if (inCode(tree, a)) continue; if (touchSel(sel, a, b)) add(a, b, mk('lv-math')); else add(a, b, Decoration.replace({ widget: new W('inline', m[0], a, b) }), true); }
      }
      return { deco: Decoration.set(out, true), atomic: Decoration.set(atomic, true) };
    }
    const hash = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return String(h); };
    const livePlugin = ViewPlugin.fromClass(class {
      constructor(v) { const r = inlineDecos(v); this.decorations = r.deco; this.atomic = r.atomic; this.tree = syntaxTree(v.state); }
      update(u) { const tr = syntaxTree(u.state), hard = u.docChanged || u.selectionSet || u.viewportChanged || u.transactions.some(x => x.effects.some(e => e.is(refresh))); if (hard) { clearTimeout(this.lz); const r = inlineDecos(u.view); this.decorations = r.deco; this.atomic = r.atomic; } else if (tr !== this.tree && tr.length >= u.state.doc.length && (!this.tree || this.tree.length < u.view.viewport.to)) { /* 1.1: parse finished in the background — one coalesced refresh (while still parsing, the timer below already handles it) */ clearTimeout(this.lz); this.lz = setTimeout(() => { try { u.view.dispatch({ effects: refresh.of(null) }); } catch (e) { } }, 24); } if (tr !== this.tree) { const before = this.tree ? this.tree.length : 0, vto = u.view.viewport.to; this.tree = tr; /* 1.6: refresh only while the parse is still catching up with the visible lines */ if (!hard && before < vto && tr.length < u.state.doc.length) { clearTimeout(this.t); this.t = setTimeout(() => { try { u.view.dispatch({ effects: refresh.of(null) }); } catch (e) { } }, 60); } } }
      destroy() { clearTimeout(this.t); }
    }, { decorations: p => p.decorations, provide: p => EditorView.atomicRanges.of(v => { const x = v.plugin(p); return x ? x.atomic : Decoration.none; }) });
    /* huge documents: block widgets only inside a window around the viewport (keeps the decoration set small → O(viewport) per keystroke) */
    const setWin = StateEffect.define(), BIG_LINES = 4000;
    const winField = StateField.define({ create: () => null, update(v, tr) { for (const e of tr.effects) if (e.is(setWin)) return e.value; return v && tr.docChanged ? { from: tr.changes.mapPos(v.from), to: tr.changes.mapPos(v.to) } : v; } });
    const winPlugin = ViewPlugin.fromClass(class {
      constructor(v) { this.check(v); } update(u) { if (u.viewportChanged || u.docChanged) this.check(u.view); }
      check(v) { if (v.state.doc.lines < BIG_LINES) { if (v.state.field(winField)) setTimeout(() => v.dispatch({ effects: setWin.of(null) }), 0); return; } const w = v.state.field(winField), vp = v.viewport, d = v.state.doc, a = d.lineAt(vp.from).number, b = d.lineAt(vp.to).number; if (w) { const wa = d.lineAt(Math.min(w.from, d.length)).number, wb = d.lineAt(Math.min(w.to, d.length)).number; if (a - wa > 60 && wb - b > 60) return; } clearTimeout(this.t); this.t = setTimeout(() => { try { const x = v.viewport; v.dispatch({ effects: setWin.of({ from: d.line(Math.max(1, d.lineAt(x.from).number - 220)).from, to: d.line(Math.min(d.lines, d.lineAt(x.to).number + 220)).to }) }); } catch (e) { } }, 30); }
      destroy() { clearTimeout(this.t); }
    });
    function blockDecos(state) { const t0 = performance.now(); const r = blockDecos0(state); PERF.block += performance.now() - t0; PERF.blockN++; return r; }
    function blockDecos0(state) {
      const doc = state.doc, sel = state.selection.ranges, tree = syntaxTree(state), out = [], win = doc.lines >= BIG_LINES ? (state.field(winField) || { from: 0, to: 0 }) : null;
      if (doc.lines > 2 && doc.line(1).text === '---') { for (let i = 2; i <= Math.min(doc.lines, 80); i++) { if (/^(---|\.\.\.)\s*$/.test(doc.line(i).text)) { const a = 0, b = doc.line(i).to; if (!touchSel(sel, a, b)) out.push(Decoration.replace({ block: true, widget: new W('fm', doc.sliceString(a, b), a, b) }).range(a, b)); break; } } }
      const top = tree.topNode, kids = [];
      /* 1.6: big documents only walk the top-level blocks inside the window */
      if (win) tree.iterate({ from: Math.max(0, win.from), to: Math.min(doc.length, win.to), enter(n) { if (n.type === top.type) return; kids.push(n.node); return false; } }); else for (let n = top.firstChild; n; n = n.nextSibling) kids.push(n);
      blockCover.cov = tree.length;
      for (const n of kids) {
        const a = n.from, b = n.to, nm = n.name; if (touchSel(sel, a, b)) continue;
        if (nm === 'Table') out.push(Decoration.replace({ block: true, widget: new W('table', doc.sliceString(a, b), a, b) }).range(a, b));
        else if (nm === 'FencedCode') { const first = doc.lineAt(a).text, lang = (first.replace(/^[\s`~]+/, '').split(/\s/)[0] || '').toLowerCase(); if (WIDGETS.has(lang) || MATHLANG.test(lang)) { const closed = /^\s*(```|~~~)\s*$/.test(doc.lineAt(b).text) && doc.lineAt(b).number > doc.lineAt(a).number; if (closed) out.push(Decoration.replace({ block: true, widget: new W('code', doc.sliceString(a, b), a, b) }).range(a, b)); } }
        else if (nm === 'Paragraph') { const s2 = doc.sliceString(a, Math.min(b, a + 2)); if (s2 === '$$' && /\$\$\s*$/.test(doc.sliceString(Math.max(a, b - 3), b)) && b - a > 4) out.push(Decoration.replace({ block: true, widget: new W('math', doc.sliceString(a, b), a, b) }).range(a, b)); }
        else if (nm === 'HTMLBlock' && /^<(details|table|div|img|figure|video|iframe)\b/i.test(doc.sliceString(a, Math.min(b, a + 12)))) out.push(Decoration.replace({ block: true, widget: new W('html', doc.sliceString(a, b), a, b) }).range(a, b));
      }
      return Decoration.set(out, true);
    }
    const blockCover = { cov: 0 };
    const BLKN = new Set(['Table', 'FencedCode', 'HTMLBlock']);
    const inBlock = (state, pos) => { pos = Math.min(pos, state.doc.length); for (let n = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) if (BLKN.has(n.name)) return true; const ln = state.doc.lineAt(pos); return /^\s*\$\$/.test(ln.text) || (ln.number <= 80 && state.doc.line(1).text === '---'); };
    /* P2/P8: the block-widget set is recomputed only when it can change (structure-affecting edits, cursor entering / leaving a block); ordinary typing just maps it */
    const blockField = StateField.define({ create: s => blockDecos(s), update(v, tr) {
      /* 1.6: parse progress / refresh only recompute while the parsed range still grows into the part that matters */
      const need0 = st => { const w = st.doc.lines >= BIG_LINES ? st.field(winField) : null; return w ? Math.min(w.to, st.doc.length) : st.doc.length; };
      if (tr.effects.some(e => e.is(setWin))) return blockDecos(tr.state);
      if (!tr.docChanged && !tr.selection) { const t2 = syntaxTree(tr.state); if (t2 === syntaxTree(tr.startState) && !tr.effects.some(e => e.is(refresh))) return v; return blockCover.cov < need0(tr.state) && t2.length > blockCover.cov ? blockDecos(tr.state) : v; }
      let need = false;
      if (tr.docChanged) tr.changes.iterChangedRanges((fa, fb, ta, tb) => { if (need) return; const ins = tr.state.sliceDoc(ta, tb), del = tr.startState.sliceDoc(fa, fb); if (ins.length > 60 || del.length > 60 || /[|`$\n<]/.test(ins + del)) need = true; else v.between(Math.max(0, fa - 1), fb + 1, () => { need = true; return false; }); });
      if (!need && (!tr.state.selection.main.empty || !tr.startState.selection.main.empty || tr.state.selection.ranges.length > 1)) need = true;
      if (!need && (inBlock(tr.startState, tr.startState.selection.main.head) || inBlock(tr.state, tr.state.selection.main.head))) need = true;
      if (need) return blockDecos(tr.state);
      return tr.docChanged ? v.map(tr.changes) : v;
    }, provide: f => EditorView.decorations.from(f) });
    const liveExt = [winField, blockField, winPlugin, livePlugin, EditorView.editorAttributes.of({ class: 'cm-live' })];
    const srcExt = [cm.highlightActiveLine(), EditorView.editorAttributes.of({ class: 'cm-src' })];
    const hitField = StateField.define({ create: () => Decoration.none, update(v, tr) { v = v.map(tr.changes); for (const e of tr.effects) if (e.is(hits)) v = e.value; return v; }, provide: f => EditorView.decorations.from(f) });
    const modeC = new Compartment(), lnC = new Compartment(), spC = new Compartment();
    const modeExt = m => m === 'source' ? srcExt : liveExt, spellExt = on => EditorView.contentAttributes.of({ spellcheck: on ? 'true' : 'false', autocorrect: 'off', autocapitalize: 'off' });
    const hooks = { keymaps: [], handlers: {} };
    function baseExts(o) {
      return [mdSupport, cm.syntaxHighlighting(hl), cm.syntaxHighlighting(cm.defaultHighlightStyle, { fallback: true }), hitField, modeC.of(modeExt(o.mode || 'live')), lnC.of(o.lineNumbers ? [cm.lineNumbers(), cm.highlightActiveLineGutter()] : []), spC.of(spellExt(o.spell)),
        cm.history(), cm.drawSelection(), cm.dropCursor(), EditorState.allowMultipleSelections.of(true), cm.rectangularSelection(), cm.crosshairCursor(), cm.indentOnInput(), cm.bracketMatching(), cm.highlightSpecialChars(), EditorView.lineWrapping, cm.indentUnit.of('    '),
        Prec.highest(EditorView.domEventHandlers({ keydown: (e, v) => { if (o.onKey) o.onKey(e, v); return e.defaultPrevented; }, paste: (e, v) => { if (o.onPaste) o.onPaste(e, v); return e.defaultPrevented; }, drop: (e, v) => { if (o.onDrop) o.onDrop(e, v); return e.defaultPrevented; }, blur: () => { if (o.onBlur) o.onBlur(); return false; }, focus: () => { if (o.onFocus) o.onFocus(); return false; }, mouseup: () => { if (o.onMouseUp) setTimeout(o.onMouseUp, 0); return false; },
          mousedown: (e, v) => { const w = e.target.closest && e.target.closest('.lv-wiki'); if (w && w.dataset.wiki && (e.ctrlKey || e.metaKey || !w.classList.contains('lv-wiki-edit'))) { e.preventDefault(); SL.openWiki && SL.openWiki(w.dataset.wiki); return true; } return false; } })),
        Prec.highest(keymap.of(o.keymap || [])), keymap.of([{ key: 'Mod-z', run: cm.undo, preventDefault: true }, { key: 'Mod-y', run: cm.redo, preventDefault: true }, { key: 'Mod-Shift-z', run: cm.redo, preventDefault: true }, ...cm.historyKeymap, ...cm.defaultKeymap.filter(k => !['Mod-Enter', 'Mod-/', 'Mod-[', 'Mod-]', 'Mod-i', 'Alt-A', 'Shift-Alt-a', 'Mod-l'].includes(k.key))]),
        EditorView.updateListener.of(u => { if (u.docChanged && o.onChange) o.onChange(u); if ((u.selectionSet || u.docChanged) && o.onSelect) o.onSelect(u); if (u.viewportChanged && o.onScroll) o.onScroll(u); }), ...(o.extensions || [])];
    }
    /* ---------- facade ---------- */
    class Ed {
      constructor(o) { this.o = o; this.exts = baseExts(o); this.view = new EditorView({ state: EditorState.create({ doc: o.doc || '', extensions: this.exts }), parent: o.parent }); this.mode = o.mode || 'live'; this.cm = cm; }
      get state() { return this.view.state; } get doc() { return this.view.state.doc; } get length() { return this.doc.length; }
      get value() { return this.doc.toString(); } set value(v) { this.view.dispatch({ changes: { from: 0, to: this.length, insert: v } }); }
      get from() { return this.state.selection.main.from; } get to() { return this.state.selection.main.to; } get head() { return this.state.selection.main.head; }
      slice(a, b) { return this.doc.sliceString(Math.max(0, a), Math.min(this.length, b == null ? this.length : b)); }
      select(a, b, center) { const L = this.length; a = Math.max(0, Math.min(a, L)); b = b == null ? a : Math.max(0, Math.min(b, L)); this.view.dispatch({ selection: { anchor: a, head: b }, effects: EditorView.scrollIntoView(b, { y: center ? 'center' : 'nearest', yMargin: 50 }) }); }
      replace(a, b, text, selA, selB) { this.view.dispatch({ changes: { from: a, to: b, insert: text }, selection: selA != null ? { anchor: selA, head: selB == null ? selA : selB } : undefined, scrollIntoView: true, userEvent: 'input' }); }
      insert(text) { this.view.dispatch(this.state.replaceSelection(text), { userEvent: 'input.type', scrollIntoView: true }); }
      focus() { this.view.focus(); } get hasFocus() { return this.view.hasFocus; }
      line(n) { const d = this.doc, l = d.line(Math.max(1, Math.min(d.lines, n + 1))); return { from: l.from, to: l.to, text: l.text, n: l.number - 1 }; }
      lineAt(pos) { const l = this.doc.lineAt(pos); return { from: l.from, to: l.to, text: l.text, n: l.number - 1 }; } get lines() { return this.doc.lines; }
      scrollToLine(n, center) { const l = this.line(n); this.view.dispatch({ effects: EditorView.scrollIntoView(l.from, { y: center ? 'center' : 'start', yMargin: 20 }) }); }
      topLine() { const v = this.view; return v.state.doc.lineAt(v.lineBlockAtHeight(v.scrollDOM.scrollTop - v.documentPadding.top + 4).from).number - 1; }
      toTopLine(n) { const v = this.view, l = this.line(n); v.requestMeasure({ read: () => v.lineBlockAt(l.from).top, write: top => { v.scrollDOM.scrollTop = top + v.documentPadding.top - 4; } }); }
      setMode(m) { this.mode = m; this.view.dispatch({ effects: modeC.reconfigure(modeExt(m)) }); }
      setLineNumbers(on) { this.view.dispatch({ effects: lnC.reconfigure(on ? [cm.lineNumbers(), cm.highlightActiveLineGutter()] : []) }); }
      setSpell(on) { this.view.dispatch({ effects: spC.reconfigure(spellExt(on)) }); }
      newState(doc) { return EditorState.create({ doc, extensions: this.exts }); } setState(st) { this.view.setState(st); this.view.dispatch({ effects: [modeC.reconfigure(modeExt(this.mode)), lnC.reconfigure(this.o.lineNumbers ? [cm.lineNumbers(), cm.highlightActiveLineGutter()] : [])] }); }
      setHits(r, cur) { const b = new RangeSetBuilder(); r.slice(0, 20000).forEach(([a, z], i) => { if (z > a) b.add(a, z, Decoration.mark({ class: 'cm-searchhit' + (i === cur ? ' cur' : '') })); }); this.view.dispatch({ effects: hits.of(b.finish()) }); }
      refresh() { this.view.dispatch({ effects: refresh.of(null) }); }
      /* heading outline from the syntax tree (P1: no re-parse of the whole text) */
      headings() { const st = this.state, out = []; syntaxTree(st).iterate({ enter: n => { const m = n.name.match(/^ATXHeading([1-6])$/); if (m) { const l = st.doc.lineAt(n.from); out.push({ level: +m[1], text: l.text.replace(/^#+\s*/, '').replace(/\s*#+\s*$/, '').replace(/[*_`~=]/g, ''), line: l.number - 1 }); return false; } if (n.name === 'FencedCode' || n.name === 'Paragraph' || n.name === 'Table') return false; } }); return out; }
      treeNodeAt(pos) { return syntaxTree(this.state).resolveInner(pos, -1); }
      destroy() { this.view.destroy(); }
    }
    E.Ed = Ed; E.create = o => new Ed(o); E.hooks = hooks; E.refreshEffect = refresh; E.MATHLANG = MATHLANG; E.WIDGETS = WIDGETS;
    return { cm, EditorView, EditorState, Decoration, keymap, Prec, syntaxTree };
  }
})(window);
