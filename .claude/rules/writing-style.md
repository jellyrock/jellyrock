# Write in the house voice

Every doc you write or edit in this repo follows [`docs/dev/writing-style.md`](../../docs/dev/writing-style.md). That covers READMEs, user and dev guides, architecture docs, ADRs, journal entries, PR text, code comments and the agent files themselves (`CLAUDE.md`, skills, rules).

**Why:** the docs read as machine-written, with em dashes, stacked qualifiers and paragraph-long sentences. People read every one of these files, including the agent files, which they read to improve them or to do a task by hand. One plain voice makes them all quicker to scan.

**The tell:** you are about to type `—`, a word in capitals for stress, `e.g.` or `i.e.`, a `→` outside a bold UI path, or one of the filler words the guide lists. Or your sentence has passed 25 words.

**How to apply:**

- Read the guide's rules before writing a new doc or a long edit. They are short.
- Fix the voice in the lines you are already editing. Rewriting a whole file is a planned change, not a side effect (see [`isolate-the-fix.md`](isolate-the-fix.md)).
- `npm run lint:voice` enforces the mechanical rules in Markdown as a per-file ratchet (`bash .claude/skills/log/voice-check.sh`, baseline `.voice-baseline.tsv`), and `npm run lint:comment-voice` does the same for code comments. A failure means you added a hit: reword, never raise the baseline. When a file improves, lock the gain in with `bash .claude/skills/log/voice-check.sh --lower`, or `node scripts/lint/comment-voice-ratchet.js --lower-voice-baseline` for a code file.
