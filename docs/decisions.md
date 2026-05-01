# Decisions log

Append-only log of non-obvious design and process decisions made on JellyRock. The intent is **lightweight ADRs without the ceremony** — capture the *why* once, so future-you (and future agents) don't have to re-derive it from the code.

## When to add an entry

Add an entry when you make a decision that:

- **Has a non-obvious rationale** that wouldn't be apparent from the code alone (e.g. "we use task pool children-as-vehicles instead of fields because SceneGraph coalesces field events").
- **Closes off alternatives** that someone else might reasonably re-propose (e.g. "we use a custom translation system, not Roku's `tr()`, because…").
- **Has a constraint or trade-off behind it** that might be worth re-evaluating later (e.g. "we hardcode 30s API timeout; per-call timeouts are nice-to-have but the cost vs. complexity didn't justify").

Don't add an entry for:

- Routine bug fixes (the commit message + the code is enough).
- Obvious decisions ("we used a `for each` loop here" — no).
- Time-bound state ("Charlie is on vacation" — that's a project memory, not a decision).

## When *not* to update an entry

**Entries are append-only.** If a decision is superseded, write a new entry that references the old one — never mutate the old one. The old entry is the historical record of what we believed when we made it.

```markdown
## decision-id: switched-from-foo-to-bar

**date**: 2026-09-01
**supersedes**: original-foo-decision

[explanation]
```

## Format

Each entry is its own H2 section. Required fields:

- **id**: a stable kebab-case slug (used to cross-reference from commits / PRs / other entries)
- **date**: when the decision was made (YYYY-MM-DD)
- **status**: `accepted`, `superseded`, or `withdrawn`

Optional:

- **supersedes** / **superseded-by**: cross-reference if applicable
- **related-files**: paths whose existence depends on this decision

Then the body: why, what we considered, what we chose, what we ruled out, and any constraints behind the choice. Keep it short — one or two paragraphs. If it grows long, the entry probably should be a real architecture doc.

---

<!-- DELETE THIS BLOCK (everything from "## Example entries" through the
end of the example below) when adding the first real decision. The
example exists only to show the format; once real entries replace it,
the example becomes confusing. -->

## Example entries (template — replace or remove these)

### `decision-id: example-format`

- **date**: 2026-05-01
- **status**: accepted

This is what an entry looks like. Replace this section with real entries as decisions get made.

Why we picked this format: full ADR templates were too heavyweight for solo-ish development; one-paragraph notes in a single file are low-friction enough to actually get written. The trade-off is no per-decision review process — but for a project this size, the cost of the process exceeds the benefit.
