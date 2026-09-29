/**
 * Help-page bootstrap: wires the EN/VI language toggle and generates the
 * "Analysis functions" catalogue from the same registry that drives the
 * CLI and the HTTP API (`src/analysis/registry.ts`) — one source of
 * truth, no doc drift.
 *
 * Loaded by `help.html` as a module; re-renders the generated section on
 * `langchange`.
 */

import { analyzeFunctions } from './analysis/registry';
import { getLang, initLangSelect, t } from './i18n';

function el(tag: string, className?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className != null) node.className = className;
  return node;
}

/**
 * Render the function catalogue: one subsection per function with its
 * bilingual summary and a parameter table. Rebuilt whenever the language
 * changes.
 */
function renderFunctionCatalogue(): void {
  const host = document.getElementById('analysis-functions');
  if (!host) return;
  host.textContent = '';
  const lang = getLang();

  for (const fn of analyzeFunctions) {
    const section = el('section');
    section.className = 'fn';

    const heading = el('h3');
    const code = el('code');
    code.textContent = fn.id;
    heading.append(code);
    heading.append(` — ${fn.category}`);
    section.append(heading);

    const p = el('p');
    p.textContent = fn.summary[lang];
    section.append(p);

    const table = el('table');
    const headRow = el('tr');
    for (const header of [t('help.functions.param'), t('help.functions.type'), t('help.functions.default'), t('help.functions.description')]) {
      const th = el('th');
      th.textContent = header;
      headRow.append(th);
    }
    table.append(headRow);

    for (const param of fn.params) {
      const row = el('tr');
      for (const value of [`--${param.name}`, param.type, String(param.default), param.desc[lang]]) {
        const td = el('td');
        td.textContent = value;
        row.append(td);
      }
      table.append(row);
    }
    section.append(table);

    if (fn.needsLtf === true) {
      const note = el('p', 'muted');
      note.textContent = t('help.functions.needsLtf');
      section.append(note);
    }
    host.append(section);
  }
}

const langSelect = document.getElementById('lang-select') as HTMLSelectElement | null;
if (langSelect) initLangSelect(langSelect);
renderFunctionCatalogue();
window.addEventListener('langchange', renderFunctionCatalogue);
