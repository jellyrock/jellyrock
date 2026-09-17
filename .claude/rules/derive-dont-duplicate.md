# Don't write down what the code can answer

Prose must not store a fact the repository already derives. Three forms, in
descending order of how fast they rot:

1. **Line numbers.** Never cite `ItemDetails.bs:NNN`. Cite the **symbol** —
   `` `ItemDetails.launchQueueItemToPlay()` ``.
2. **Derived quantities as live claims.** No whole-file line counts ("3,600+
   lines"), no "16 sites still to migrate" written as current fact.
3. **A number that genuinely IS the point** — then *date it as a measurement*:
   "measured 2026-09-17 on a Stick 4K: 93 µs". A dated measurement is a
   historical fact and cannot rot.

**Why:** a line number decays on *any* edit above it, not just an edit to the
thing described — so it rots faster than any review or freshness gate can catch.
Measured 2026-09-17 on a 14-reference sample, three were already broken:

```text
IconButton.bs:36      -> past end-of-file
ItemDetails.bs:4271   -> past end-of-file
ItemDetails.bs:206    -> cited as the quickPlayNode self-observer;
                         the line actually reads `m.trailerCheckSeq = 0`
```

That last doc's `last-reviewed` was the same day. This is the blind spot in
contextual doc freshness ([ADR
0033](../../docs/adr/0033-contextual-doc-freshness.md)): a human re-reading the
prose has no way to notice a number drifted underneath it, so the gate passes a
doc that is already lying.

Citing the symbol is **strictly better, not merely more durable.** A reader — or
an agent — can `grep` a symbol; nobody can grep a line number. It survives every
edit above it, and it says *what* to look for instead of *where it used to be*.
The same argument retires the stored count: `wc -l` answers it for free, on
demand, and correctly, so storing it buys nothing and costs a refresh on every
touch. Two tech-debt entries proved the cost — `itemdetails-size` claimed 3,600+
lines against an actual 5,355 — and a stale figure is what makes an entry stop
being believed.

**The tell:** you are about to type a colon followed by a digit after a filename,
or to copy a number out of `wc -l` / a grep count into a sentence. Also: you
catch yourself *refreshing* such a number. Refreshing is the trap — it feels like
maintenance and it re-arms the same decay. Delete it or date it.

**How to apply:**

- **Locations → symbols.** Function, method, class, constant, or a heading
  anchor. A range of lines is usually a function: name the function. If a symbol
  genuinely does not exist (a config block, a literal), quote a short distinctive
  snippet instead — that is greppable too.
- **Quantities → derive or date.** If a reader needs the size, say what shape
  makes it big ("16 per-type renderers, the `TrackDropdown` cluster embedded"),
  which is the actionable part anyway. If the number is evidence, date it and
  name the hardware or the commit it was taken at.
- **Populations that must be tracked → a committed baseline, not prose.** A count
  that has to be enforced belongs in a file a script reads
  (`.doc-citation-baseline.json`, `.promise-ratchet-baseline`), where it is
  checked rather than remembered.

**Counterweight:** this is not a ban on numbers. Dated measurements are the
backbone of `async.md` and `threading.md` and must stay. Tool output quoted inside
a fenced code block is a transcript, not a citation — rewriting it would falsify
the example, so the gate skips fenced blocks. Append-only dated records (a
skill's `AUDIT-LOG.md`) are likewise exempt: they say what a run saw on a date.

**Enforced by** [`scripts/lint/doc-citation-ratchet.js`](../../scripts/lint/doc-citation-ratchet.js)
(`npm run lint:doc-citations`), a per-file ratchet over tracked markdown: a file
may only ever improve, and a file absent from the baseline is allowed zero. Draining the
grandfathered baseline is tracked in issue #959. It
does **not** gate clauses 2 and 3 — judging whether a number is a live claim or a
dated measurement needs reading, so those stay convention.

This is the documentation sibling of [`cost-efficiency.md`](cost-efficiency.md)'s
core lever — deterministic facts belong to something that computes them, not to a
model or a human re-typing them — and of
[`verify-dont-assume.md`](verify-dont-assume.md): a stored line number is an
assumption about the code's current shape, asserted without checking.
