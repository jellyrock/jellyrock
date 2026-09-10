// Tests for scripts/lint/eslint-rules/rta-wait-justified.js.
//
// The rule's whole value is that it accepts the four justified wait shapes and rejects
// everything else, so these cases are the categories themselves — one valid case per
// category, plus the shapes that must NOT be waved through. A rule that over-accepts is
// worse than no rule: it reads as a gate while gating nothing.

import { describe, it } from 'vitest';
import { RuleTester } from 'eslint';
import rule from '../../../../scripts/lint/eslint-rules/rta-wait-justified.js';

// RuleTester drives its own describe/it; hand it Vitest's so failures land in the normal
// reporter. This must run at module scope — `ruleTester.run()` registers its cases while
// the describe callback below is being evaluated, which is before any hook would fire.
RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
});

describe('rta-wait-justified', () => {
  ruleTester.run('wait-justified', rule, {
    valid: [
      // FN — a function keyPath. ODC observes a field; a function call is not one.
      { code: `waitFor('#homeRows.content.getChildCount()', hasChildren)` },
      { code: `waitFor('subtype()', (v) => v === 'Home')` },

      // ABS — the node is gone, so there is no field left to observe.
      { code: `waitFor('#jrDialog.id', (v) => v === undefined, { timeout: 10000 })` },
      { code: `waitFor('#anything.at.all', (v) => v === null)` },

      // ACT — the per-tick re-press is the mechanism. Justified whatever the keyPath is,
      // which is why it is checked before the keyPath is even read.
      {
        code: `waitFor('#never.verified.field', (v) => v === 1, { action: resendIfSwallowed('back', '#x') })`,
      },

      // SETTLE — a keyPath verified non-pulsing. The allowlist is what makes this pass.
      { code: `waitFor('#osd.visible', (v) => v === true, { timeout: 8000 })` },
      { code: `waitFor('loadState', (v) => v === 'loaded')` },

      // A no-interpolation template literal is still a static string.
      { code: 'waitFor(`#osd.visible`, (v) => v === false)' },

      // Not our call.
      { code: `somethingElse('#unverified.field', (v) => v === 1)` },
      // A member call still counts as ours, and this one is justified.
      { code: `ctx.waitFor('#osd.visible', (v) => v === true)` },
    ],

    invalid: [
      // The case the rule exists for: a plain field settle on a keyPath nobody verified.
      {
        code: `waitFor('#newScreen.someField', (v) => v === 'ready', { timeout: 5000 })`,
        errors: [{ messageId: 'unverifiedField' }],
      },
      // A member call must not slip the gate.
      {
        code: `ctx.waitFor('#newScreen.someField', (v) => v === 'ready')`,
        errors: [{ messageId: 'unverifiedField' }],
      },
      // A runtime keyPath cannot be classified; it needs a documented disable.
      {
        code: `waitFor(keyPath, (v) => typeof v === 'number')`,
        errors: [{ messageId: 'dynamicKeyPath' }],
      },
      // An INTERPOLATED template is a runtime value, not a static string.
      {
        code: 'waitFor(`#${id}.field`, (v) => v === 1)',
        errors: [{ messageId: 'dynamicKeyPath' }],
      },
      // `action` must be a real option, not any nested property that happens to be named
      // one — otherwise a predicate mentioning `action` would wave the wait through.
      {
        code: `waitFor('#newScreen.someField', (v) => v.action === 1, { timeout: 5000 })`,
        errors: [{ messageId: 'unverifiedField' }],
      },
      // An `undefined` comparison OUTSIDE the predicate must not count as an absence test.
      {
        code: `waitFor('#newScreen.someField', (v) => v === 1, { label: x === undefined ? 'a' : 'b' })`,
        errors: [{ messageId: 'unverifiedField' }],
      },
      // A near-miss on an allowlisted keyPath is a different node and needs its own check.
      {
        code: `waitFor('#osd.visibleThing', (v) => v === true)`,
        errors: [{ messageId: 'unverifiedField' }],
      },
    ],
  });
});
