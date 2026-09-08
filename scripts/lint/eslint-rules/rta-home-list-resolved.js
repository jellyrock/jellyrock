// scripts/lint/eslint-rules/rta-home-list-resolved.js — Home's row lists may be named by id
// in exactly ONE module, and nowhere else.
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
// back `undefined`, a caller's `|| 0` turns that into "Home has no rows", and the eventual
// failure blames a tile on a Home that is perfectly healthy under a different tab.
//
// WHY AN ALLOWLIST RATHER THAN THE BUDGET TABLE IT REPLACED
// ---------------------------------------------------------
// This rule shipped as a per-file budget freezing 30 sites, because there was no way to
// convert them one at a time behind a plain ban. Those 30 are now zero: every site resolves
// Home's active list (`homeListId`) or asks the focused node its `subtype`
// (`focusIsInHomeContent`) instead of naming an id.
//
// The count cannot reach zero outright, though, and that is not a shortfall — it is the
// shape of the answer. Resolving the active list means reading BOTH candidate ids and taking
// whichever is in the scene, so something has to know them. `getActiveRows()` is not in
// Home's `<interface>` and no node-typed field exposes `m.activeContent`, so there is no
// id-free way to reach the list from RTA. What the conversion can do — and did — is make
// exactly one module know, and this rule is what holds that line.
//
// A ban with one named exemption rather than a budget, because a budget answers the wrong
// question. Its message tells a developer who added a site to "lower the number", which is
// correct only if they converted one and wrong if they added one, and the rule cannot tell
// those apart. It also carries state that can drift from the code, which is why it needed a
// `staleBudget` failure mode at all. An allowlist has neither problem: the message is always
// "use the resolver", and there is nothing to keep in sync.
//
// The exemption is capped, so it stays an exemption. Naming the ids inside `home-list.js` is
// permitted for the ID CONSTANT and nothing else — without the cap, the one allowlisted file
// could accumulate exactly the reads this rule exists to prevent, and a 1600-line module was
// the reason the allowlist was pointed at a small dedicated one in the first place.
//
// WHY IT COUNTS `#favoritesRows` TOO
// ----------------------------------
// The hazard is symmetrical — a site that hardcodes the favorites list breaks the moment the
// Home tab is selected — and because a "conversion" that swapped one hardcoded id for the
// other would otherwise pass this gate while fixing nothing.
//
// WHAT TO DO INSTEAD
// ------------------
// `homeListId()` (`tests/rta/lib/steps.js`) resolves Home's active list: exactly one of the
// two ids answers, so one batched read gets it, and absence becomes a named failure
// (`HOME_LIST_ABSENT`) instead of an `undefined` a caller turns into zero rows. Where the
// question is "is focus inside Home's content", use `focusIsInHomeContent` /
// `waitFocusInHomeContent`, which ask the FOCUSED node its `subtype` — see
// `tests/rta/CLAUDE.md` → "Identify a dynamically-created node by `subtype`".

import path from 'node:path';

const DOC = 'tests/rta/lib/home-list.js';

/** The row-list ids that are a property of the SELECTED TAB rather than of Home. */
const TAB_OWNED_IDS = ['#homeRows', '#favoritesRows'];

/**
 * The one module permitted to name them, and how many times.
 *
 * Two: one per id, in `HOME_ROW_LIST_IDS`. The cap is exact in BOTH directions on purpose.
 * Above it, reads have crept into the exempt module. Below it, the constant no longer lists
 * both ids — and a resolver that probes only one silently reverts to the bug this rule was
 * built for, because the read it drops is the one that does not throw.
 */
const RESOLVER_MODULE = 'tests/rta/lib/home-list.js';
const RESOLVER_SITES = 2;

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
        "Home's row list ids (`#homeRows` / `#favoritesRows`) may be named only in " +
        RESOLVER_MODULE +
        ': only one of the two is in the scene at a time, so a hardcoded id reads a node ' +
        'that is absent under the other tab.',
    },
    schema: [],
    messages: {
      nameTheListElsewhere:
        'RTA Home row list: {{file}} names a tab-owned row list ({{actual}} site(s)). Only ' +
        'one of `#homeRows` / `#favoritesRows` is in the scene at a time, so a hardcoded id ' +
        'reads a node that is absent under the other tab — and a content read then returns ' +
        '`undefined` rather than throwing, which a caller turns into "Home has no rows". ' +
        "Resolve Home's active list with `homeListId()`, or ask the focused node its " +
        'subtype with `focusIsInHomeContent` / `waitFocusInHomeContent`. See ' +
        DOC +
        '.',
      resolverOverAllowance:
        'RTA Home row list: ' +
        RESOLVER_MODULE +
        ' names a tab-owned row list at {{actual}} site(s), but its allowance is ' +
        '{{allowance}} — one per id, in `HOME_ROW_LIST_IDS`. The exemption is for the id ' +
        'CONSTANT, not for reads: build keyPaths with `homeListKeyPaths(suffix)` so they ' +
        'cover both lists. See ' +
        DOC +
        '.',
      resolverUnderAllowance:
        'RTA Home row list: ' +
        RESOLVER_MODULE +
        ' names a tab-owned row list at {{actual}} site(s), but its allowance is ' +
        '{{allowance}} — one per id. `HOME_ROW_LIST_IDS` must list BOTH, or the resolver ' +
        'probes one list and silently reverts to reading a node that is absent under the ' +
        'other tab. If the app genuinely changed which lists exist, change the constant and ' +
        'this allowance together. See ' +
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
      // the resolver module still reports when it has been emptied — otherwise deleting the
      // id constant would pass silently, which is the one change that turns every caller of
      // `homeListId()` into a resolver that cannot resolve.
      'Program:exit'(program) {
        const isResolver = file === RESOLVER_MODULE;
        if (!sites.length && !isResolver) return;

        const data = {
          file,
          actual: String(sites.length),
          allowance: String(RESOLVER_SITES),
        };

        if (!isResolver) {
          context.report({ node: sites[0], messageId: 'nameTheListElsewhere', data });
          return;
        }
        if (sites.length > RESOLVER_SITES) {
          context.report({ node: sites[RESOLVER_SITES], messageId: 'resolverOverAllowance', data });
          return;
        }
        if (sites.length < RESOLVER_SITES) {
          context.report({
            node: sites.length ? sites[0] : program,
            messageId: 'resolverUnderAllowance',
            data,
          });
        }
      },
    };
  },
};
