// scripts/lint/eslint-rules/rta-home-rows-budgeted.js — naming Home's row list by id is a
// closed, shrinking inventory, and this rule keeps it shrinking.
//
// WHY THIS EXISTS
// ---------------
// Home's active row list is `m.activeContent` (`components/home/Home.bs`), which is
// `HomeRows` or `FavoritesRows` depending on the selected tab — and only ONE of them is in
// the scene at a time. `onTabChanged` calls `destroyActiveContent()`, which does
// `m.top.removeChild(...)`, BEFORE it builds the new tab's list. So a site that names
// `#homeRows` is not reading a list that merely lost focus; while another tab is selected
// it is reading a node that is not in the tree.
//
// Measured on `.177` 2026-09-07 with the Favorites tab selected (Up, Right, OK from Home):
//
//   waitFocusInside('#homeRows')            THREW after 4064 ms — last=FavoritesRows@…
//   #homeRows.content.getChildCount()       RESOLVED in 8 ms — value `undefined`
//   waitFor('#homeRows.rowItemFocused')     THREW after 4343 ms — last=undefined
//
// The middle one is why this is a gate rather than a comment. It does not throw. It hands
// back `undefined`, `scanHomeLibraryTiles` turns that into `|| 0` rows, and the eventual
// failure is `home library tile not found` — which blames the tile, on a Home that is
// perfectly healthy under a different tab.
//
// WHY A BUDGET RATHER THAN A BAN
// ------------------------------
// There are 30 sites across five files and no way to convert them one at a time behind a
// plain ban. A budget freezes the inventory at today's count immediately, at no risk to a
// suite that is the only per-PR feedback nav changes get, and then ratchets DOWN as the
// conversion lands: the match is EXACT, so converting a site fails this rule until its
// number is lowered. The table is an INVENTORY, not a ceiling — a stale-high number would
// silently re-permit a site someone had already done the work to remove.
//
// The conversion itself is tracked as a phase of the RTA harness-reliability project, not
// as an open-ended followup. When every number here reaches zero, delete the rule with the
// `rta-home-active-list-hardcoded` entry it guards.
//
// WHY IT COUNTS `#favoritesRows` TOO
// ----------------------------------
// Zero sites name it today. It is counted because the hazard is symmetrical — a site that
// hardcodes the favorites list breaks the moment the Home tab is selected — and because a
// conversion that swapped one hardcoded id for the other would otherwise pass this gate
// while fixing nothing.
//
// WHAT TO DO INSTEAD
// ------------------
// Resolve Home's active list rather than naming one: exactly one of the two ids resolves,
// so a single batched read answers it. Where the question is "is focus inside Home's
// content", ask the FOCUSED node's `subtype` against `HOME_ROW_LIST_SUBTYPES`, the way
// `overhangWalkKey` and `walkHomeToFirstRow` already do — `tests/rta/CLAUDE.md` →
// "Identify a dynamically-created node by `subtype`".

import path from 'node:path';

const DOC = 'docs/architecture/tech-debt.md → `rta-home-active-list-hardcoded`';

/** The row-list ids that are a property of the SELECTED TAB rather than of Home. */
const TAB_OWNED_IDS = ['#homeRows', '#favoritesRows'];

/**
 * Sites naming a Home row list by id, per file, inventoried from the AST on 2026-09-07.
 *
 * A file absent from this table has a budget of ZERO. These numbers only go DOWN.
 */
const BUDGETS = new Map([
  // The whole of the open half of the debt entry: the focus walks and the by-name content
  // reads, across `scanHomeLibraryTiles`, `findHomeLibraryTile`, `walkHomeRowsTo`,
  // `pressProbe`, `selectionProbe`, `openLibraryByType`, `backToHome` and
  // `navCellSweepHome`. 21 when the entry was written; it grew to 26 while nobody was
  // looking at it, which is the argument for a gate rather than a note.
  ['tests/rta/lib/nav.js', 26],

  // `waitHome()`'s second gate. One site, and the one that matters most: it runs first on
  // ~30 navs a suite, so under another tab nothing downstream is ever reached.
  ['tests/rta/lib/steps.js', 1],

  // The failure dump's `homeRowCount`. An instrument rather than a gate — a wrong reading
  // here misinforms a diagnosis instead of failing a run — but it is the same hazard and
  // is counted so the inventory is the whole of it.
  ['tests/rta/lib/diagnostics.js', 1],

  // Spec-level assertions on Home's content. Reachable only from the Home tab today, which
  // is exactly the assumption this rule exists to stop spreading.
  ['tests/rta/specs/deeplink.spec.js', 1],
  ['tests/rta/specs/focus.spec.js', 1],
]);

/** The repo-relative, POSIX-separated path ESLint is currently linting. */
function relativeFilename(context) {
  const filename = context.filename ?? context.getFilename();
  return path
    .relative(context.cwd ?? process.cwd(), filename)
    .split(path.sep)
    .join('/');
}

const namesATabOwnedList = (text) => TAB_OWNED_IDS.some((id) => text.includes(id));

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        "Naming Home's row list by id (`#homeRows` / `#favoritesRows`) is a shrinking " +
        'per-file inventory: only one of the two is in the scene at a time, so a hardcoded ' +
        'id reads a node that is absent under the other tab.',
    },
    schema: [],
    messages: {
      overBudget:
        'RTA Home row list: {{file}} now names a tab-owned row list at {{actual}} site(s) ' +
        'against a budget of {{budget}}. Only one of `#homeRows` / `#favoritesRows` is in ' +
        'the scene at a time, so a hardcoded id reads a node that is absent under the other ' +
        "tab — a content read then returns `undefined` rather than throwing. Resolve Home's " +
        'active list instead, or ask the focused node its `subtype`. See ' +
        DOC +
        '.',
      unbudgetedFile:
        'RTA Home row list: {{file}} is not in the inventory, so its budget is zero, but it ' +
        "names a tab-owned row list at {{actual}} site(s). Resolve Home's active list rather " +
        'than naming one — exactly one of the two ids resolves. See ' +
        DOC +
        '.',
      staleBudget:
        'RTA Home row list: {{file}} names a tab-owned row list at {{actual}} site(s) but ' +
        'its budget is {{budget}}. Lower it to {{actual}} in ' +
        'scripts/lint/eslint-rules/rta-home-rows-budgeted.js. These numbers only go DOWN: ' +
        'leaving one high silently re-permits a site someone already converted. See ' +
        DOC +
        '.',
    },
  },

  create(context) {
    const file = relativeFilename(context);
    const sites = [];

    return {
      // Comments are not visited, which is deliberate: this file's own prose names
      // `#homeRows` many times, and so do the docblocks explaining why the sites exist.
      Literal(node) {
        if (typeof node.value === 'string' && namesATabOwnedList(node.value)) sites.push(node);
      },

      // A template literal counts ONCE however many interpolations it carries: the site is
      // the keyPath, not the number of holes in it. `#homeRows.content.${r}.${c}.id` is one
      // place naming one list.
      TemplateLiteral(node) {
        if (node.quasis.some((q) => namesATabOwnedList(q.value.raw))) sites.push(node);
      },

      // Reported at the end so the count is the FILE's rather than a running total, and so
      // an emptied budgeted file still reports — otherwise converting the LAST site in a
      // file would pass silently while converting the second-to-last failed, and the table
      // would rot in exactly the case someone did the most work to earn.
      'Program:exit'(program) {
        const budget = BUDGETS.get(file);
        if (sites.length === 0 && budget === undefined) return;

        const data = { file, actual: String(sites.length), budget: String(budget ?? 0) };

        if (sites.length === 0) {
          context.report({ node: program, messageId: 'staleBudget', data });
          return;
        }
        if (budget === undefined) {
          context.report({ node: sites[0], messageId: 'unbudgetedFile', data });
          return;
        }
        if (sites.length > budget) {
          context.report({ node: sites[budget], messageId: 'overBudget', data });
          return;
        }
        if (sites.length < budget) {
          context.report({ node: sites[0], messageId: 'staleBudget', data });
        }
      },
    };
  },
};
