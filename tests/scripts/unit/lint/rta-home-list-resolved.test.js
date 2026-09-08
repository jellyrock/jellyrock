// Tests for scripts/lint/eslint-rules/rta-home-list-resolved.js.
//
// The rule is a BAN with one named exemption: Home's row list ids may be spelled only in
// `tests/rta/lib/home-list.js`, and there only twice — one per id, in `HOME_ROW_LIST_IDS`.
// The cases are therefore what it counts, what it must NOT count, and each of the three ways
// a file can disagree with that contract, including BOTH directions of the resolver's cap.
//
// It replaced a per-file budget table that froze 30 sites during the conversion. Those sites
// are now zero, and the cases that used to prove the ratchet (`overBudget` / `staleBudget`)
// are gone with it: there is no table left to drift, which was the point of the change.
//
// The filenames are REAL repo paths, deliberately: the rule keys off the resolver's path, so
// a test on a fictional path would exercise the counting and never the exemption.

import path from 'node:path';
import { describe, it } from 'vitest';
import { RuleTester } from 'eslint';
import rule from '../../../../scripts/lint/eslint-rules/rta-home-list-resolved.js';

// RuleTester drives its own describe/it; hand it Vitest's so failures land in the normal
// reporter. Must run at module scope — `ruleTester.run()` registers its cases while the
// describe callback below is being evaluated.
RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
});

/** An absolute path, since the rule relativises against cwd to find the resolver. */
const at = (relativePath) => path.join(process.cwd(), relativePath);

/** The one module allowed to name the ids, at a fixed cap of two. */
const RESOLVER = at('tests/rta/lib/home-list.js');
/** Everything else. These two carried 26 and 1 sites before the conversion. */
const NAV = at('tests/rta/lib/nav.js');
const OTHER = at('tests/rta/screens.js');

describe('rta-home-list-resolved', () => {
  ruleTester.run('home-list-resolved', rule, {
    valid: [
      // The overwhelmingly common case: a file that names no row list at all.
      { filename: OTHER, code: `await waitFocusInside('#itemGrid');` },

      // A COMMENT naming the list is free, in any file. The rule module, this file and
      // several docblocks name `#homeRows` many times while explaining the hazard —
      // counting prose would punish documenting it.
      {
        filename: OTHER,
        code: `// focus must land in #homeRows, not #favoritesRows\nconst x = 1;`,
      },
      {
        filename: NAV,
        code: `/** Reads #homeRows.content.getChildCount() when Home is up. */\nconst x = 1;`,
      },

      // The resolver at exactly its allowance: one per id, which is what
      // `HOME_ROW_LIST_IDS` is.
      {
        filename: RESOLVER,
        code: `export const HOME_ROW_LIST_IDS = Object.freeze(['#homeRows', '#favoritesRows']);`,
      },

      // A RESOLVED list is the shape the conversion moved to — no id spelled, so nothing
      // to count. This is what every one of the 30 converted sites now looks like.
      {
        filename: NAV,
        code: `const list = await homeListId();\nawait waitFor(\`\${list}.content.getChildCount()\`, has);`,
      },

      // Asking the FOCUSED node its subtype is the other sanctioned shape, and it names the
      // SUBTYPE rather than an id — `HomeRows` is not `#homeRows`.
      {
        filename: NAV,
        code: `function key(f) { if (HOME_ROW_LIST_SUBTYPES.includes(f?.node?.subtype)) return ecp.Key.Up; }`,
      },
    ],

    invalid: [
      // The whole point: naming an id outside the resolver, in a file that used to hold 26
      // such sites. There is no budget to lower — the fix is always to resolve.
      {
        filename: NAV,
        code: `await waitFocusInside('#homeRows');`,
        errors: [{ messageId: 'nameTheListElsewhere' }],
      },

      // A file that never held a site cannot quietly acquire one either. This is the growth
      // the rule exists to stop: `nav.js` went 21 -> 26 without one.
      {
        filename: OTHER,
        code: `const v = await getVal('#homeRows.content.getChildCount()');`,
        errors: [{ messageId: 'nameTheListElsewhere' }],
      },

      // A TEMPLATE literal is a site. The interpolated keyPaths were the majority of
      // `nav.js`'s count, so missing these would leave the rule describing a third of the
      // real surface.
      {
        filename: NAV,
        code: 'const v = await getVal(`#homeRows.content.${r}.${c}.id`);',
        errors: [{ messageId: 'nameTheListElsewhere' }],
      },

      // The SYMMETRY check. A "conversion" that swapped one hardcoded id for the other
      // would otherwise pass while fixing nothing — the favorites list is equally absent
      // under the Home tab.
      {
        filename: OTHER,
        code: `await waitFocusInside('#favoritesRows');`,
        errors: [{ messageId: 'nameTheListElsewhere' }],
      },

      // The exemption is for the id CONSTANT, not for reads. A read that crept into the one
      // allowlisted module is the way this rule would otherwise be defeated by relocation.
      {
        filename: RESOLVER,
        code:
          `export const HOME_ROW_LIST_IDS = Object.freeze(['#homeRows', '#favoritesRows']);\n` +
          `const rows = await getVal('#homeRows.content.getChildCount()');`,
        errors: [{ messageId: 'resolverOverAllowance' }],
      },

      // ...and a template counts ONCE however many holes it carries, so this is 3 sites and
      // not 4. Without that, a legitimate two-id constant plus one interpolated keyPath
      // would report the wrong number.
      {
        filename: RESOLVER,
        code:
          `export const HOME_ROW_LIST_IDS = Object.freeze(['#homeRows', '#favoritesRows']);\n` +
          'const v = await getVal(`#homeRows.content.${r}.${c}.id`);',
        errors: [{ messageId: 'resolverOverAllowance' }],
      },

      // UNDER the cap is a failure too, and this is the direction a plain ban would miss.
      // A constant listing only one id makes `homeListId` probe one list — which silently
      // reinstates the original bug, because the read it drops is the one that resolves to
      // `undefined` instead of throwing.
      {
        filename: RESOLVER,
        code: `export const HOME_ROW_LIST_IDS = Object.freeze(['#homeRows']);`,
        errors: [{ messageId: 'resolverUnderAllowance' }],
      },

      // Emptying the resolver must still report. There is no literal left to hang the
      // message on, so it lands on Program — without that, deleting the id constant would
      // pass silently, and that is the one edit that turns every `homeListId()` caller into
      // a resolver that cannot resolve.
      {
        filename: RESOLVER,
        code: `const x = 1;`,
        errors: [{ messageId: 'resolverUnderAllowance' }],
      },
    ],
  });
});
