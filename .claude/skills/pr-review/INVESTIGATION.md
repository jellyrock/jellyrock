# Investigation contract — PR review

This is the contract followed in main thread once `/pr-review` has done its prep. The skill ran on opus; the prep packet was written to `.claude/handoffs/pr-review-<N>-<timestamp>.md` and is also in conversation context (until compaction). You're walking each comment one at a time: read the code, validate intent, root-cause, present options, wait for approval, implement only on approval, move to the next.

## Where the prep lives

If conversation context is intact, the prep is right there (`gh api` results, sorted comment list, co-located groups). If the conversation has compacted or you're resuming in a fresh session, `Read .claude/handoffs/pr-review-<N>-<timestamp>.md` for the consolidated packet. The packet has the shape:

```text
PR <N>: <title>
Branch: <head> → <base>

Unresolved comments (ordered by file:line, N total):
  1. <path>:<line> — @<reviewer>: <one-line summary>
  2. <path>:<line> — @<reviewer>: <one-line summary>
  ...

Co-located groups (treat as one investigation):
  Group A: comments #2, #3 (both on <path>:45-50)

Full comment bodies + context: <inline JSON or markdown blocks>
```

Do NOT re-fetch via `gh`. The prep is authoritative. If the packet looks malformed (missing fields, no comments, wrong PR number), surface that and stop — don't paper over it.

## Operating contract

- **One comment at a time.** Walk in the order the skill prepped. Do NOT batch.
- **Co-located groups are one item.** When the skill flagged comments as co-located (literally on the same file+line range), treat them as a single investigation. Otherwise: separate items.
- **Validate before fixing.** Some review comments are wrong, outdated, or premature optimization. Read the actual code; assess against JellyRock conventions; say so honestly when a reviewer misjudged intent.
- **Always wait for explicit approval before editing code.** Even if the fix is obvious, present options first.
- **Reference JellyRock conventions concretely.** When recommending an approach, cite the rule: scoped CLAUDE.md, architecture doc, decisions.md slug, or tech-debt slug. "Per `components/video/CLAUDE.md`'s player-invariant rule" beats "best practice."

## JellyRock-specific lenses

When evaluating a review, hold these in mind:

- **Render thread safety** — all I/O routes through Task Nodes, never direct API calls from component code. See [`source/api/CLAUDE.md`](../../source/api/CLAUDE.md).
- **Component scoping** — XML+BS pairs auto-scope; `source/` files need imports in components.
- **Task Node patterns** — correct field types (`assocarray` / `node` / `nodearray` / `string`); fields-as-vehicle dodge for SceneGraph event coalescing (per `docs/architecture/api.md`).
- **Global state** — `m.global.app` / `m.global.user` / `m.global.device` patterns. Don't proliferate ad-hoc globals.
- **Event handling** — `onKeyEvent` return values control bubble behavior; misuse breaks navigation.
- **Registry migrations** — settings changes need a migration script per [`docs/dev/registry-migrations.md`](../../docs/dev/registry-migrations.md).
- **Tests on hardware** — don't claim a fix was tested when only the build was verified. Hardware tests are `npm run test:tdd`. If hardware isn't reachable, say so explicitly.
- **Logging tier discipline** — surgical logs only; never blanket-add. Invoke the dedicated `log-reviewer` agent if a review touches logging.

## Per-comment workflow

For each comment (or co-located group) in the packet:

1. **Quote the comment in full** with reviewer + file:line context. Number it (e.g., "Investigation 3 of 7").
2. **Read the actual code** at the cited location, plus enough surrounding context to understand intent. For BrighterScript, that means reading the function and any callers; for XML, the component's `<interface>` and the BS file that backs it.
3. **Validate the comment** — is the concern real? If invalid (the reviewer misread the code, or the convention they're citing doesn't apply here), explain why with specific evidence. Don't just defer to the reviewer.
4. **Root-cause analysis** — if valid, what's the underlying issue? Not "missing semicolon" — "this entire pattern is render-thread-unsafe because..." If the same root cause likely exists elsewhere in the codebase (search to confirm), surface that as a separate scope question.
5. **Present 2-3 solution options.** For each: clear description; pros/cons specific to JellyRock conventions; complexity estimate; impact on existing functionality; tests/migrations required. Make a recommendation with reasoning. Cite JellyRock conventions concretely.
6. **Ask explicitly: "Which approach would you like? Or should I investigate further?"** Stop. Wait. Do NOT proceed to the next comment until the user responds.

## Apply (only after approval)

Implement the approved solution. Update or create unit tests as needed (`npm run test:tdd` for hardware, `npm run test:scripts` for Node-side). If hardware isn't reachable, say so before claiming the change is tested. Provide a manual test plan for UI/runtime behavior tests don't cover.

## Move to the next comment

Repeat from Step 1 of the per-comment workflow. Don't summarize the previous comment's investigation in the next — keep momentum.

## Critical constraints

Repo-wide rules in root [`CLAUDE.md`](../../../CLAUDE.md) still apply (CHANGELOG is CI-controlled, no `tasks/` leakage in shared artifacts, hardware-reachable claim discipline, pre-push hook discipline). Flow-specific constraints:

- NEVER modify code without explicit user permission for THIS specific comment.
- ALWAYS wait for response between investigations.
- NEVER suggest solutions that violate render-thread requirements.
- NEVER batch multiple investigations into one response. One at a time.
- NEVER re-fetch via `gh` — the skill's prep is authoritative; if it's wrong, surface that and stop.

## When you're done

After all comments are addressed, summarize: "All N comments addressed. Y fixes applied across Z files. K deferred per user." If anything was deferred, surface it as a tech-debt slug candidate so it doesn't evaporate when the PR merges.

Cleanup: if `.claude/handoffs/pr-review-<N>-*.md` exists, `rm` it now to clear the pending marker (otherwise it'll surface in `/catchup` until the 30-day auto-prune).
