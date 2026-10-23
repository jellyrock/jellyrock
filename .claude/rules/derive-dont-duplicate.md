# Don't write down what the code can answer

Prose must not store a fact the repository already derives. There are three forms, from fastest to slowest to rot:

1. **Line numbers.** Never cite `ItemDetails.bs:NNN`. Cite the **symbol**: `` `ItemDetails.launchQueueItemToPlay()` ``.
2. **Derived quantities as live claims.** No whole-file line counts ("3,600+ lines"), no "16 sites still to migrate" written as current fact.
3. **A number that is the point.** Date it as a measurement: "measured 2026-09-17 on a Stick 4K: 93 µs". A dated measurement is a historical fact and cannot rot.

**Why:** a line number decays on *any* edit above it, not only an edit to the thing described, so it rots faster than any review or freshness gate can catch. A doc once cited a line of `ItemDetails.bs` as an observer when that line read `m.trailerCheckSeq = 0`, on the day its `last-reviewed` was bumped. This is the blind spot in contextual doc freshness ([ADR 0033](../../docs/adr/0033-contextual-doc-freshness.md)): a person rereading the prose can't see a number drift underneath it, so the gate passes a doc that is already wrong. The sample that showed it is in decision `doc-citations-cite-symbols` (`docs/decisions.md`).

Citing the symbol is **better, not only more durable.** A reader or an agent can `grep` a symbol; nobody can grep a line number. A symbol survives every edit above it, and it says *what* to look for instead of *where it used to be*. The same argument retires the stored count: `wc -l` answers it on demand and correctly, so storing it buys nothing and costs a refresh on every touch. A stale figure is also what makes a doc stop being believed.

**The tell:** you are about to type a colon followed by a digit after a file name (or a bare `:NNN` leaning on a file named nearby), or to copy a number out of `wc -l` or a grep count into a sentence. Or you catch yourself *refreshing* such a number. Refreshing is the trap: it feels like maintenance and it re-arms the same decay. Delete the number or date it.

**How to apply:**

- **Locations become symbols.** A function, method, class, constant or heading anchor. A range of lines is usually a function: name the function. Where no symbol exists (a config block, a literal), quote a short distinctive snippet instead, which can be grepped too.
- **Quantities are derived or dated.** If a reader needs the size, say what shape makes it big ("16 per-type renderers, the `TrackDropdown` cluster embedded"), which is the part they can act on anyway. If the number is evidence, date it and name the hardware or the commit it was taken at.
- **A count that must be tracked goes in a committed baseline, not prose.** A count that has to be enforced belongs in a file a script reads (`.voice-baseline.tsv`, `.promise-ratchet-baseline`), where it is checked rather than remembered.
- **Clock minutes and ports are written in words.** Write "46 minutes past the hour", "the top of the hour" or "port 8102", not a lone colon-minute or colon-port (`:MM`, `:PORT`). Nothing in the text tells a minute from a line number, so the gate counts every lone colon-number; written in words, there is nothing to guess.

**Counterweight:** this is not a ban on numbers. Dated measurements are the core of `async.md` and `threading.md` and stay. Tool output quoted inside a fenced code block is a transcript, not a citation: rewriting it would falsify the example, so the gate skips fenced blocks. Append-only dated records (a skill's `AUDIT-LOG.md`) are exempt too: they say what a run saw on a date.

**Enforced by** [`.claude/skills/log/voice-check.sh`](../skills/log/voice-check.sh) (`npm run lint:voice`), a per-file ratchet over tracked markdown. A file may only improve, and a file absent from the baseline is allowed zero. It counts the full `file.ext:NNN` form and the lone `:NNN` shorthand, in `.voice-baseline.tsv` beside the other house-voice categories. It does not gate forms 2 and 3: judging whether a number is a live claim or a dated measurement needs reading, so those stay convention.

This is the documentation sibling of [`cost-efficiency.md`](cost-efficiency.md)'s core lever (deterministic facts belong to something that computes them, not to a model or a person retyping them) and of [`verify-dont-assume.md`](verify-dont-assume.md): a stored line number is an assumption about the code's current shape, asserted without checking.
