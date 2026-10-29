/* ChipBench · cmd-needs.js — preconditions for commands registered by other modules (1.7.1).
   The 1.7.0 command audit (every command × welcome screen / Markdown / PDF) found commands that either did nothing or threw a raw
   "Cannot read properties of null" when pressed without a suitable document.  `needs` ('tab' | 'file' | 'md') is enforced centrally by SL.run /
   the palette (see core.js); this table assigns it to commands whose registering module does not declare it itself. */
(function (G) {
  'use strict';
  const SL = G.ChipBench;
  const NEEDS = {
    tab: ['more'],
    md: ['table.format', 'doc.check', 'doc.utf8', 'present', 'export.print', 'export.html', 'export.copy', 'export.eml', 'export.docx', 'export.pptx', 'export.pdf'],
    file: ['history.open', 'compare', 'copypath', 'file.backups'],
  };
  SL.cmdNeeds = NEEDS;
  Object.keys(NEEDS).forEach(k => NEEDS[k].forEach(id => { const c = SL.commands.get(id); if (c && !c.needs) c.needs = k; }));
  /* a command that has `needs` but is missing from the registry is a typo here — surface it in the console, not in front of the user */
  Object.keys(NEEDS).forEach(k => NEEDS[k].forEach(id => { if (!SL.commands.has(id) && G.console) console.debug('[cmd-needs] unknown command', id); }));
})(window);
