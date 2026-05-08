# pr — audit log

Per-skill audit log per the convention in [`.claude/skills/audit-skill/SKILL.md`](../audit-skill/SKILL.md). Captures both `/audit-skill pr` runs (mechanical friction findings + applied fixes) and user-driven enhancements that surface a real gap and warrant capture so the rationale isn't lost. Architectural-grade decisions also surface in [`docs/decisions.md`](../../../docs/decisions.md).

## 2026-05-08 — existing-PR detection + update path (user-driven)

**Source:** user-driven — not from a `/audit-skill` run. The user noticed the skill had no existing-PR detection: `gh pr create` would fail with a generic error if a PR already existed for the branch, but only AFTER the four-pillar judgment passes had already run. That meant wasted work (potentially duplicate tech-debt / decision / followup entries) plus a confusing failure mode at the end of the flow.

**Gap surfaced:**

- No `gh pr view` step before `gh pr create`. The skill assumed the create path was always correct.
- No marker in rendered bodies → no way for a future invocation to know "this body was rendered by /pr at SHA X," so judgment passes on a re-run would re-walk the entire branch and re-ask candidates the user already considered.
- No handling for merged / closed / different-author PRs. A user re-running /pr against a merged-but-not-switched-off branch would get the create-call failure noise.

**Model fit:** unchanged — `model: sonnet`. The new logic is mechanical (state-machine routing, regex marker parse, three-tier fallback chain, byte-for-byte body comparison). No new judgment seams beyond what the existing four-pillar passes already handle. Sonnet remains the right fit; if the diff-and-ask UX in the update path proves to need richer judgment in practice, re-evaluate via `/audit-skill pr`.

**Fixes applied:**

- Frontmatter: title + description updated to "Create OR Update a Pull Request"; `allowed-tools` extended with two read-only shapes — `Bash(gh api user --jq .login)` and `Bash(git merge-base --is-ancestor:*)`. Tightened to specific args (not `:*`) at user request.
- Pre-flight: detached-HEAD check added (`git rev-parse --abbrev-ref HEAD` must not be `HEAD` either).
- New section **"Detect existing PR"** — `gh pr view --json number,url,state,isDraft,author,body,headRefOid` runs before judgment passes; routes:
  - `MERGED` → abort with `git switch main && git pull` hint
  - `CLOSED` (not merged) → abort with `gh pr reopen <N>` hint
  - `OPEN` → update path (capture `<N>`, `<url>`, `<author.login>`, `<body>`, `<headRefOid>`)
  - No PR → create path (today's flow)
- New subsection **"Update-path setup"**:
  - Best-effort author-mismatch warn via `gh api user --jq .login`. Silent skip on API failure — informational only.
  - Three-tier lower-bound SHA resolution: marker (regex `<!-- /pr render: sha=([a-f0-9]{40}) ts=(\S+) -->`, last match wins) → PR's first commit (`gh pr view --json commits --jq '.commits[0].oid'`) → `main` ultimate fallback. Each tier verified reachable from HEAD via `git merge-base --is-ancestor`. Surface a one-line note when degrading to ultimate fallback so the user knows narrow scope was lost (rebase / force-push edge case).
- Four-pillar passes 1+2 thread the resolved `<lower>` SHA — pass 1 (`/tech-debt-scan` sub-agent) gets `git diff <lower>..HEAD --name-only` as scoped changed-files set; pass 2 (`decision-shape-nudge.cjs`) gets `--range=<lower>..HEAD`. On the create path `<lower>` is `main` (today's behavior); on the update path it's the prior render's SHA, so the user isn't re-asked about candidates already accepted/skipped on a previous /pr invocation. Pass 3 is body-content-driven and naturally orthogonal — unchanged.
- "Create the PR" → "Create or update the PR":
  - **Marker line (both paths)**: every render appends `<!-- /pr render: sha=<full-40-char-HEAD-sha> ts=<ISO-8601-UTC> -->` as the last body line, separated by a blank line. Resolves via `git rev-parse HEAD` + `date -u +%Y-%m-%dT%H:%M:%SZ`.
  - **Create path**: unchanged, except the rendered body ends with the marker.
  - **Update path**: render → byte-for-byte compare (modulo marker timestamp) → if unchanged, print `PR #<N> already up to date` and stop silently (no permission prompts, no backup); otherwise show section-by-section diff highlighting auto-rendered vs human-curated sections → ask `apply / skip / edit-then-apply` → on apply: backup prior body to `.claude/handoffs/pr-<N>-pre-render-<ts>.md` (via `Write`, prompts intentionally) → `gh pr edit <N> [--title ...] --body <heredoc>` (prompts intentionally). Pass `--title` only if it actually changed.
  - **Failure recovery**: if `gh pr edit` fails, the backup is on disk — surface the path + the recovery command (`gh pr edit <N> --body-file <backup-path>`) and abort.
- "After creating" → "After creating or updating": journal-sync mention only on create path (user already saw it on initial /pr); skip on update path; skip both when the change is trivial.
- `.claude/settings.json`: added `Bash(git merge-base --is-ancestor:*)` and `Bash(gh api user --jq .login)`. Specifically NOT added: `Bash(gh pr edit:*)` and `Write` — those are the user-approval gates for body overwrite + local backup, intentionally left to prompt.
- `.claude/skills/README.md`: at-a-glance row updated to reflect create-or-update routing and the marker-based since-last-render scoping.

**Decision points (user-driven, captured here so the rationale isn't lost):**

1. **Existing-PR default → "show diff, then ask"** (not auto-update or auto-skip). Diff-and-ask is the safest default; manual edits to Overview / Changes / Follow-ups stay visible and the user can decline mid-flow. Auto-update was rejected as too risky once review has started; auto-skip was rejected as losing the auto-render benefit on the most common update case (new commits since initial /pr).
2. **Judgment-pass scoping → "since last /pr render" with auto-fallback to "since PR opened"** (not "since PR opened" alone, not "re-run all," not "skip on update," not "ask each time"). The marker-based narrow scope is strictly incremental — each /pr update only sees commits it hasn't walked before. Fallback chain handles all degradation cases (missing marker, rebase, force-push) without leaving the user worse off than the simpler alternatives.
3. **No pre-flight commit-set confirm prompt.** Earlier consideration was a "show commits + diff, ask 'proceed?'" gate before judgment passes to catch wrong-branch-commits. Rejected — `gh pr create` and `gh pr edit` already prompt at apply time, and that IS the user gate. An additional verbal confirm would be redundant friction.
4. **PR state edge cases → refuse merged, refuse closed, warn on different author, do NOT warn on draft.** Drafts are normal during iteration. Merged + closed cases were both selected as abort paths because silently opening a duplicate or "updating" a merged PR are both bad outcomes.
5. **Backup prior body to `.claude/handoffs/`** — risk/reward analysis: `.claude/handoffs/` is gitignored ([`.gitignore:20`](../../../.gitignore#L20)), auto-pruned by `/catchup` after 30 days ([`scripts/catchup-state.js:280`](../../../scripts/catchup-state.js#L280)), surfaces accumulation when ≥10 pending. PR bodies <10KB. Cleanup is already wired; net cost is essentially zero against the upside of full undo on a bad overwrite.
6. **`gh pr edit` and `Write` deliberately NOT allowlisted in `settings.json` or skill frontmatter.** User explicitly vetoed default-allow. The mid-flow permission prompts ARE the body-overwrite + local-backup-write gates and are not redundant friction — they're the whole point.
7. **Read-only allowlist tightened.** `git merge-base --is-ancestor:*` (not `git merge-base:*`) and `gh api user --jq .login` (exact, not `gh api user:*`). User preference for narrow scoping over prefix wildcards on new entries.

**Deferred / dropped:**

- **Stacked-PR support** (PR base branch other than `main`). Current skill hardcodes `main..HEAD` for body-rendering context and the create-path lower bound. Not introduced by this change but noted as a real existing limitation. JellyRock is single-base-branch in practice; no `tech-debt.md` entry filed unless this becomes a real friction point.
- **Auto-detection of branch-name issue-number / commit-message-keyword mismatch** (heuristic warning only). Considered as a wrong-branch-commit nudge; rejected per decision #3.
- **`AUDIT-LOG.md` as audit-only convention.** This entry establishes that user-driven enhancements that surface a real skill gap also belong here — capture-discipline applies to skill design, not just /audit-skill output. The file's intro paragraph was widened accordingly.

**No source transcript** — user-driven enhancement, not a /audit-skill mechanical analysis.

**Related architectural decision:** candidate slug `pr-skill-update-path`. The change adds new branching logic, a new marker convention, a new backup convention, and two new bash shapes in `settings.json` — architectural-grade per the skills CLAUDE.md rule. `/log decision` invocation is the user's call.
