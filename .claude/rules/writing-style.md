# Write in the house voice

Everything you write in this repo reads in one plain voice that is quick to scan: docs, READMEs, journal entries, commit messages, PR text, code comments and the agent files (`AGENTS.md`, skills, rules). People read the agent files too, to improve them or to do a task by hand.

**Why:** a sentence that makes the reader work costs every reader, every time. Em dashes, stacked qualifiers and paragraph-long sentences are what make text read as machine-written.

**The rules:**

1. **No em dashes.** Use a period, a comma, a colon or parentheses. Two thoughts joined by a dash usually read better as two sentences.
2. **Sentence-case headings:** "Install the plugin", not "Install The Plugin".
3. **Start with the answer.** The conclusion or the action first, then the detail. One idea per sentence; aim for under 25 words.
4. **One reader per doc.** A user doc says what to do and what they will see, never internals. A contributor doc gives steps that work the first time. A maintainer doc says why the code is shaped this way. An agent file gives the rule, the reason and how to tell it applies. A code comment says what the code cannot.
5. **Bold is for UI labels**, and for at most one warning per section. Never write a word in capitals for emphasis (`NOT`, `ONLY`, `MUST`): a word that needs stress means the sentence needs restructuring.
6. **"For example" and "that is"**, not `e.g.` and `i.e.`
7. **You, present tense, active voice:** "Press **Back** to stop the load", not "The load can be stopped by pressing **Back**".
8. **Arrows only in a bold UI path** (**Settings → Playback**). In prose, say what happens.
9. **Cut filler words:** `load-bearing`, `deliberately`, `genuinely`, `crucially`, `simply`, `just`, `note that`.
10. **State the rule and why; keep the proof elsewhere.** Measurements, reproductions and how you found out go in the commit message or a decision record, where `git blame` reaches them (see [`prove-dont-dismiss.md`](prove-dont-dismiss.md) and [`measured-facts-in-prose.md`](measured-facts-in-prose.md)).
11. **American spelling:** behavior, color, organize, labeled, judgment, center, license as a noun. Never rename for spelling an identifier, file name, config key or anything code reads; a quote, a name or an outside API's own term; or translation text.
12. **Cite symbols, not line numbers.** Name the function, class, constant or heading (`parseConfig()`), or quote a short snippet when there is none: a line number goes stale on any edit above it, and nobody can grep for it. Write a clock time or a port in words ("46 minutes past the hour", "port 8102"), so the check never mistakes it for a line number. A count or a measurement follows [`measured-facts-in-prose.md`](measured-facts-in-prose.md).

**The operative test:** before you commit text, ask "could a reader scan this and act on it the first time?" If a sentence makes them reread, rewrite it.

**The tell:** you are about to type `—`, a word in capitals for stress, `e.g.` or `i.e.`, a `→` outside a bold UI path, a filler word, a sentence past 25 words, a colon and a digit after a file name, or a British `-our`, `-ise`, `-yse` or `-lled` spelling in new text.

**How to apply:**

- Fix the voice and spelling in the lines you are already editing. Rewriting a whole file is a planned change, never a side effect (see [`isolate-the-fix.md`](isolate-the-fix.md)).
- Text a tool reads is not prose: a lint marker, a fill-in, a quoted error or command output keeps the form its reader needs.
- The voice check in [this repo's verification commands](../../AGENTS.md#verification-commands) enforces rules 1, 5, 6, 8, 9 and 12 per file against a baseline. A failure means you added a hit: reword, never raise the baseline. When a file improves, lower its baseline so the gain stays.
