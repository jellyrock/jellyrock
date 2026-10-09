# Write in the house voice

Every doc you write or edit in this repo follows [`docs/dev/writing-style.md`](../../docs/dev/writing-style.md): READMEs, user and dev guides, architecture docs, ADRs, journal entries, PR text, the agent files themselves (`CLAUDE.md`, skills, rules), and code comments.

**Why:** the docs read as machine-written, with em dashes, stacked qualifiers and paragraph-long sentences. People read every one of these files, including the agent files, which they read to improve them or to do a task by hand. One plain voice makes them all quicker to scan.

**The tell:** you are about to type `—`, a word in capitals for stress, `e.g.`, a `→` outside a bold UI path, or one of the filler words the guide lists. Or your sentence has passed 25 words.

**How to apply:**

- Read the guide's rules before writing a new doc or a long edit. They are short.
- Fix the voice in the lines you are already editing. Rewriting a whole file is a planned change, not a side effect (see [`isolate-the-fix.md`](isolate-the-fix.md)).
- `npm run lint:doc-citations` enforces the mechanical rules as a per-file ratchet. A failure means you added one; reword, never raise the baseline.
