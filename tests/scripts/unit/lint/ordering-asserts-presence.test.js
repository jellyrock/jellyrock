// Tests for scripts/lint/eslint-rules/ordering-asserts-presence.js.
//
// The rule's whole claim is that `-1` satisfies an ordering assertion, so the cases are
// organised around what does and does not PROVE an operand was found. The invalid cases
// are the four shapes the 2026-09-07 audit actually found in this repo; the valid ones are
// each way a site can legitimately have already proved presence, because a rule with no
// escape hatch is only reasonable if it recognises every reasonable guard.
//
// Two properties are gated deliberately, both of which a naive implementation gets wrong:
//   - scope: a presence assertion in a SIBLING test must not excuse this one;
//   - substring: `toContain('a longer line with beta crash in it')` DOES prove
//     `indexOf('beta crash')`, and demanding a second assertion next to a sound one is how
//     a gate teaches people to route around it.

import { describe, it } from 'vitest';
import { RuleTester } from 'eslint';
import rule from '../../../../scripts/lint/eslint-rules/ordering-asserts-presence.js';

// RuleTester drives its own describe/it; hand it Vitest's so failures land in the normal
// reporter. Must run at module scope — `ruleTester.run()` registers its cases while the
// describe callback below is being evaluated.
RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
});

/** Wrap a body in an `it()` so the rule's enclosing-test-body scope is exercised. */
const inTest = (body) => `it('x', () => {\n${body}\n});`;

describe('ordering-asserts-presence', () => {
  ruleTester.run('ordering-asserts-presence', rule, {
    valid: [
      // The idiomatic guard, and the one the rule's message recommends.
      inTest(`
        expect(code).toContain('guard');
        expect(code).toContain('read');
        expect(code.indexOf('guard')).toBeLessThan(code.indexOf('read'));
      `),

      // A proof in the `it()` body governs an assert inside a nested callback. Scoping to
      // the NEAREST function would miss it and report a sound test — and this rule has no
      // escape hatch, so a false positive can only be answered by disabling it.
      inTest(`
        expect(code).toContain('guard');
        expect(code).toContain('read');
        ['a', 'b'].forEach((_) => {
          expect(code.indexOf('guard')).toBeLessThan(code.indexOf('read'));
        });
      `),
      inTest(`
        expect(code).toContain('guard');
        for (const _ of xs) {
          expect(code.indexOf('guard')).toBeGreaterThan(-1);
        }
      `),
      // The numeric guard, which is the only option for a `findIndex` over a predicate.
      inTest(`
        const a = lines.findIndex((l) => l.includes('a'));
        const b = lines.findIndex((l) => l.includes('b'));
        expect(a).toBeGreaterThan(-1);
        expect(b).toBeGreaterThan(-1);
        expect(a).toBeLessThan(b);
      `),
      // `toBeGreaterThan(0)` is STRICTER than "found", so it proves presence too. The
      // audit's first pass flagged this shape and was wrong to.
      inTest(`
        const a = lines.findIndex((l) => l.includes('a'));
        expect(a).toBeGreaterThan(0);
        expect(a).toBeLessThan(9);
      `),
      inTest(`
        const a = s.indexOf('a');
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThan(9);
      `),
      inTest(`
        const a = s.indexOf('a');
        expect(a).not.toBe(-1);
        expect(a).toBeLessThan(9);
      `),
      // Presence of a longer literal entails presence of any substring of it.
      inTest(`
        expect(c).toContain('- 2026-05-10 — fix: beta crash');
        expect(c).toContain('- 2026-05-10 — feat: alpha widget');
        expect(c.indexOf('beta crash')).toBeLessThan(c.indexOf('alpha widget'));
      `),
      // An ordering assertion can be its own presence proof.
      inTest(`
        expect(s.indexOf('a')).toBeGreaterThan(-1);
      `),
      // Nothing sentinel-shaped: ordinary numbers are none of this rule's business.
      inTest(`
        expect(items.length).toBeLessThan(other.length);
      `),
      // Equality is not an ordering assertion — `toBe(-1)` is a legitimate absence check.
      inTest(`
        expect(s.indexOf('gone')).toBe(-1);
      `),
      // SCOPE: `idx` is a sentinel in the first test and an ordinary number in the second.
      // A file-wide name table would report the second one; scope resolution must not.
      // This is the false positive the rule cannot afford, since its only escape is a
      // blanket disable.
      `
        it('a', () => {
          const idx = s.indexOf('x');
          expect(idx).toBeGreaterThan(-1);
          expect(idx).toBeLessThan(9);
        });
        it('b', () => {
          const idx = 5;
          expect(idx).toBeLessThan(9);
        });
      `,
    ],

    invalid: [
      // The shape found in auto-destroyed-guard.test.js: a plugin's emitted guard asserted
      // to precede the risky read, passing when the plugin emits nothing at all.
      {
        code: inTest(`expect(code.indexOf('guard')).toBeLessThan(code.indexOf('read'));`),
        errors: [
          {
            messageId: 'vacuous',
            data: { operand: "code.indexOf('guard')", fix: "expect(code).toContain('guard')" },
          },
          {
            messageId: 'vacuous',
            data: { operand: "code.indexOf('read')", fix: "expect(code).toContain('read')" },
          },
        ],
      },
      // The shape found in dev-index.test.js: sentinel values bound to identifiers first.
      {
        code: inTest(`
          const a = readme.indexOf('alpha.md');
          const b = readme.indexOf('mid.md');
          expect(a).toBeLessThan(b);
        `),
        errors: [
          { messageId: 'vacuous', data: { operand: 'a', fix: 'expect(a).toBeGreaterThan(-1)' } },
          { messageId: 'vacuous', data: { operand: 'b', fix: 'expect(b).toBeGreaterThan(-1)' } },
        ],
      },
      // The shape found in journal-sync.test.js: ONE operand guarded, the other not. The
      // rule must report only the unguarded half — over-reporting here is what would push
      // someone to blanket-disable it.
      {
        code: inTest(`
          const a = c.indexOf('a');
          const b = c.indexOf('b');
          expect(a).toBeGreaterThan(0);
          expect(b).toBeGreaterThan(a);
        `),
        errors: [
          { messageId: 'vacuous', data: { operand: 'b', fix: 'expect(b).toBeGreaterThan(-1)' } },
        ],
      },
      // Scope: a presence assertion in a SIBLING test proves nothing about this one. A
      // file-wide search would call this valid, which is the false negative that matters
      // most — it is the shape a large test file drifts into.
      {
        code: `
          it('a', () => {
            expect(s).toContain('x');
            expect(s.indexOf('x')).toBeLessThan(s.indexOf('y'));
          });
          it('b', () => {
            expect(s.indexOf('x')).toBeLessThan(9);
          });
        `,
        errors: [
          {
            messageId: 'vacuous',
            data: { operand: "s.indexOf('y')", fix: "expect(s).toContain('y')" },
          },
          {
            messageId: 'vacuous',
            data: { operand: "s.indexOf('x')", fix: "expect(s).toContain('x')" },
          },
        ],
      },
      // `toContain` proves `indexOf`/`lastIndexOf` of the SAME needle only — a different
      // needle on the same haystack is still unproven.
      {
        code: inTest(`
          expect(c).toContain('a');
          expect(c.indexOf('a')).toBeLessThan(c.indexOf('b'));
        `),
        errors: [
          {
            messageId: 'vacuous',
            data: { operand: "c.indexOf('b')", fix: "expect(c).toContain('b')" },
          },
        ],
      },
      // `toContain` says nothing about `findIndex`, which searches by PREDICATE rather
      // than by the value asserted present.
      {
        code: inTest(`
          expect(lines).toContain('a');
          expect(lines.findIndex((l) => l.includes('a'))).toBeLessThan(9);
        `),
        errors: [{ messageId: 'vacuous' }],
      },
      // A NEGATED lower bound asserts the value was NOT found, so it must not be read as
      // a presence proof. This is the one shape that states the opposite of presence and
      // would still have satisfied the matcher-name check — the rule failing in exactly
      // the direction it exists to prevent.
      {
        code: inTest(`
          expect(s.indexOf('x')).not.toBeGreaterThan(-1);
          expect(s.indexOf('x')).toBeLessThan(s.indexOf('y'));
        `),
        errors: [{ messageId: 'vacuous' }, { messageId: 'vacuous' }],
      },
      {
        code: inTest(`
          expect(s.indexOf('x')).not.toBeGreaterThanOrEqual(0);
          expect(s.indexOf('x')).toBeLessThan(9);
        `),
        errors: [{ messageId: 'vacuous' }],
      },
    ],
  });
});
