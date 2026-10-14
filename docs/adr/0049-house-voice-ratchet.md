# ADR 0049: Every doc is held to one house voice by a per-file ratchet

**Status:** Accepted
**Date:** 2026-10-07

**related-files**: `docs/dev/writing-style.md`, `.claude/rules/writing-style.md`, `scripts/lint/doc-citation-ratchet.js`, `.doc-voice-baseline.json`, `scripts/docs-fact-report.js`, `.husky/pre-push`, `.github/workflows/_lint-docs.yml`

The docs read as machine-written: em dashes, stacked qualifiers and sentences past 35 words, in user guides and agent files alike. [`writing-style.md`](../dev/writing-style.md) sets one voice for every doc, and the agent files follow it too, because people read them to improve them or to do a task by hand. Its mechanical rules (em dashes, filler words, capitals for emphasis, arrows outside a bold UI path, `e.g.` and `i.e.`) are enforced by a second per-file ratchet in `doc-citation-ratchet.js`, run by pre-push and CI. Each file is held at its count in `.doc-voice-baseline.json` and may only improve; a new file starts at zero. The scope is every tracked markdown file, ADRs and journals included, because a ratchet forces no rewrite: old entries keep their allowance and new ones start clean. `CHANGELOG.md` (written by CI), `locale/` and `components/vendor/` are exempt. The rules a script cannot judge (sentence length, one reader per doc, active voice) stay with review, and `npm run docs:fact-report` makes reviewing a rewrite a check of the numbers, symbols and links it removed or added. The first baseline, measured 2026-10-07, was 7,408 hits.

**Ruled out:**

- **A second tool such as Vale.** It needs its own config and install and a second walk over the docs, while the existing ratchet already has the per-file shape, the hook and the CI wiring.
- **A convention with no gate.** That is how the docs reached their current state.
- **Rewriting only when a file is touched.** A rarely edited doc would stay verbose for years; the docs are being rewritten in planned phases instead.
- **Exempting ADRs and journals.** Their past entries are dated records and are not rewritten, but nothing about a new entry needs the old voice.
- **A separate script.** It would copy the shared walk; the cost is a name that now undersells the script (tech-debt `doc-citation-ratchet-name-covers-voice`).

**Revisit if:** the gate's word lists start flagging text that reads fine (a false-positive pattern in review), or a third ratchet makes the script's name the deciding problem.
