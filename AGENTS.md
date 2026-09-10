# JellyRock — Agent Rules

JellyRock is a Jellyfin client for Roku, written in **BrighterScript** (`.bs`, transpiled to `.brs`) with **Roku Scene Graph** (`.xml`) for the UI. The Jellyfin REST API is wrapped by an in-house client + persistent task pool — see [`source/api/CLAUDE.md`](source/api/CLAUDE.md) and [`docs/architecture/api.md`](docs/architecture/api.md)

## ⚠️ Mandatory rules

1. DO NOT make stuff up or make assumptions
2. Ask clarifying questions when you are not sure about something
3. Focus on best practices, industry standards, easy long-term maintenance, no regressions, and world-class UX and DX
4. ALWAYS look for the best possible solution to a problem then provide the user with their best options
5. Iterate on a plan with the user until they approve it, and only then begin coding
6. After finishing a user-approved plan: run automated tests to verify; provide a manual test plan only for UI/runtime behavior tests don't cover, plus any expected debug-log output

## Agent rules

- **Run tests to verify fixes — don't commit based on reasoning alone.** Nothing auto-runs tests, so an agent is expected to run them. BS unit tests on Roku hardware — TDD (single spec, fastest): `npm run test:tdd`; broader: `npm run test:unit | test:integration | test:all`. BSC plugin / scripts changes (Vitest, no hardware needed): `npm run test:scripts`. RTA functional tests (Vitest drives a real device; navigation/screens regressions) — `npm run test:rta` (and `npm run test:rta:capture` to view the GUI while designing UI): [`docs/dev/rta-tests.md`](docs/dev/rta-tests.md). Setup, credentials, debugger contention: [`docs/dev/unit-tests-tdd.md`](docs/dev/unit-tests-tdd.md).
- **CHECK whether hardware is reachable before claiming it isn't — `npm run device:check`.** It probes every device in `.env` over ECP (unauthenticated, no dev mode needed) and prints the verdict you then have to report. **A device that answers is a device you can test on — run the tests.** Only when the probe fails do you say hardware was unreachable, and then say *the probe failed*, not that you lack access. **"I don't have access to a device", asserted without running it, is the failure this rule exists to stop** — it reads exactly like a considered result, and it is the cheapest way to satisfy a rule that only asked you to *say so*. ECP answering does not promise a sideload will succeed (dev mode off, or a `ROKU_PASSWORD` belonging to another device, still fails at deploy) — that is a different report, and also a checked one. Never claim a fix was tested when only the build was verified
- **Cannot modify `CHANGELOG.md`** — CI-controlled
- **Don't compulsively re-run lint / build / format mid-work.** `npm run validate`, `lint:*`, `build:*`, `check-formatting`, and `format` are already run by pre-commit / pre-push hooks and by CI on every push (and most editors surface BSC diagnostics live as you type). So they aren't for routine "did my change compile" checks — but they're fair game when debugging a specific failure, when no hook has fired yet, or when your editor isn't surfacing diagnostics. **Test scripts are only PARTLY covered** — `npm run test:scripts` IS run by pre-push (whenever JS is in the push range) and by CI, so re-running it every turn is the redundancy this rule warns about. `test:tdd` / `test:unit` / `test:integration` are NOT run by any hook (they need a device), so running them as part of finishing hardware-affecting work is the expected workflow, not a redundancy.
- **Capture cross-session agent guidance in `CLAUDE.md` (root or scoped), not in agent-private memory** — memory files are per-folder (worktrees / multiple JellyRock checkouts each get their own), aren't committed, and don't reach other contributors. Project rules belong in `CLAUDE.md` so everyone benefits. Auto-memory is disabled at the project level (`.claude/settings.json` → `autoMemoryEnabled: false`)
- **Never cite a GITIGNORED path as a SOURCE in tracked content** — `tasks/`, `docs/projects/`, `.claude/handoffs/`, `.claude/plans/`. A reviewer cannot open them, and a local planning file is archived or deleted the moment its work finishes, so the citation rots by design. Covers commit messages, PR bodies, shared docs **and source comments** — the last is the one that keeps slipping, because a `PLAN.md` feels like a real document while you are working out of it. If a rationale is worth citing from tracked code, promote it to a tracked home first ([`/log decision`](.claude/skills/log/SKILL.md), an ADR, or the relevant doc) and cite that. Naming such a path as a *destination* is fine — a skill telling an agent where to write a handoff is an instruction, not a citation
- **PR follow-ups land in a journal, not just the PR body** — when a PR explicitly defers something ("out of scope", "follow-up"), add an entry to the right journal (see Capture & state discipline below) and link it from the PR. Otherwise the deferral evaporates the moment the PR merges

## Capture & state discipline

The four-pillar journal system (see [`docs/architecture/system-shape.md`](docs/architecture/system-shape.md)) treats live project state as load-bearing. Three rules govern how agents interact with the journals:

- **Capture-discipline rule** — when committing a decision-shaped change (a choice that closes off alternatives, has a non-obvious rationale, or has a constraint worth re-evaluating), invoke `/log decision` in the same change set. **Raw markdown edits to [`docs/decisions.md`](docs/decisions.md), [`docs/progress.md`](docs/progress.md), or [`docs/signals-backlog.md`](docs/signals-backlog.md) are not the sanctioned path for agents** — use `/log` (capture) and `/done` (close) skills exclusively. Direct `Write` / `Edit` on those three files bypasses those skills' validation + corrective-audit loop and risks silent corruption of project state. *CI exception:* the post-merge [`.github/workflows/journal-sync.yml`](.github/workflows/journal-sync.yml) workflow is the sole non-skill writer to `progress.md`, performing the mechanical close-loop (move `## Currently running` → `## Recently shipped`, bump `last-updated:`) via [`scripts/journal-sync.js`](scripts/journal-sync.js). Judgment-bearing entries (decisions, tech-debt, followups) still flow through the user-driven `/pr` → `/log` path.
- **Followup-discipline rule** — when deferring work in a PR ("out of scope", "follow-up", "TODO later"), pick the right journal:
  - Internal debt with a slug + severity (refactor candidate, design intent worth preserving) → invoke [`/tech-debt-scan`](.claude/skills/tech-debt-scan/SKILL.md) (writes to [`docs/architecture/tech-debt.md`](docs/architecture/tech-debt.md))
  - Generic deferred work without a debt classification → invoke `/log followup "<text>" --area=<name>` (writes to [`docs/progress.md`](docs/progress.md))
  - External upstream watching (Jellyfin / Roku OS / dep version) → invoke `/log signal <slug>` (writes to [`docs/signals-backlog.md`](docs/signals-backlog.md))
- **Catchup-discipline rule** — at the start of any genuine new session and after multi-day gaps, run one of [`/focus`](.claude/skills/focus/SKILL.md) (opus triage + routing — surfaces a 3–5 item menu of next-move candidates with a "Recommended" call, then routes the pick to the right downstream skill) or [`/catchup`](.claude/skills/catchup/SKILL.md) (sonnet, read-only state briefing). Use `/focus` when you want help picking *which* of several plausible next moves to take; use `/catchup` for a pure state load. The four journals plus GitHub state should never be re-derived from scratch — the aggregator at [`scripts/catchup-state.js`](scripts/catchup-state.js) is the canonical state surface and both skills consume it. For area-scoped re-entry (>2 weeks away from a subsystem), use [`/ramp <area>`](.claude/skills/ramp/SKILL.md) instead.
- **Ship-ritual rule** — invoking [`/pr`](.claude/skills/pr/SKILL.md) is the ship moment. `/pr` bundles the three judgment passes (tech-debt scan, decision-shape detect, followup capture) so journal hygiene lands in the same change set instead of a separate manual step. Don't bypass `/pr` with `gh pr create` or the GitHub UI — those skip the passes and leave the journals to drift.

Enforcement layers (soft → hard):

- **Session-start nudge** — `SessionStart` hook runs [`scripts/lint/session-start-nudge.cjs`](scripts/lint/session-start-nudge.cjs); prints one advisory line when local journal/handoff state suggests actionable work (pending handoffs, stale progress.md, schema-broken journals). Silent on clean state. Local-only — no network calls. Surfaces the catchup-discipline rule at the moment it applies.
- **Mid-session nudges** — `Stop` hook runs [`scripts/lint/progress-cursor-nudge.cjs`](scripts/lint/progress-cursor-nudge.cjs); flags stale progress.md and Currently-running cursors that overlap with shipped commits.
- **Pre-push nudges** — same `progress-cursor-nudge` plus the existing `decision-shape-nudge` print advisories. Never block.
- **Post-merge auto-sync** — [`.github/workflows/journal-sync.yml`](.github/workflows/journal-sync.yml) handles the mechanical close-loop after PR merge (move `## Currently running` → `## Recently shipped`, bump `last-updated:`). Skips on `dependencies` / `documentation` / `ci` / `automated` labels and Renovate/Dependabot/bot authors.
- **Weekly journal-cursor tracker** — [`.github/workflows/docs-stale-tracker.yml`](.github/workflows/docs-stale-tracker.yml) runs Mondays on `main` and maintains one `docs:stale`-labeled issue for [`docs/progress.md`](docs/progress.md) cursor freshness (>7 days old with non-maintenance commits since, computed by [`progress-cursor-nudge.cjs`](scripts/lint/progress-cursor-nudge.cjs) `--json`). **Non-blocking** — `progress.md` temporal staleness is a property of `main`, not of any one PR, so it never fails a contributor's PR (previously the `progress-stale` lint gate did, false-failing unrelated dependency/docs PRs). It no longer tracks architecture/dev-doc `last-reviewed` freshness — that is driven by the contextual prompts below, which fire while you are already in the doc's territory. Run `npm run docs:stale` for the full review-cadence list on demand.
- **CI lint gate** — `npm run lint:docs` FAILs when [`docs/progress.md`](docs/progress.md) has a missing/malformed `last-updated:` frontmatter field (`progress-frontmatter` category — a *structural*, per-PR check) or when [`docs/signals-backlog.md`](docs/signals-backlog.md) has a schema-broken row (`signals-schema-invalid` category). Temporal `progress.md` staleness is **not** a CI gate — it's handled by the weekly tracker above. CI runs the lint on every PR.

## Doc maintenance discipline

When you modify a file listed in any architecture doc's `related-files:` frontmatter, you must also re-read that doc and either:

- **Update it** if the change altered the subsystem's *shape* or *why*. Bump `last-reviewed` in the frontmatter to today's date
- **Explicitly confirm no shape/why change occurred** in your response, leaving the doc untouched. Don't bump `last-reviewed` — that signal must reflect actual review against current code

Two enforcement layers back this up:

- An **end-of-turn hook** (Claude Code `Stop`, Copilot Coding Agent `sessionEnd`) prints which docs claim the files you touched — **both `docs/architecture/` and `docs/dev/`**, with dev guides marked informational. Doesn't block. Logic in [`scripts/lint/check-touched-related-files.cjs`](scripts/lint/check-touched-related-files.cjs)
- A **CI gate** ([`scripts/lint/docs-stale-blocking.cjs`](scripts/lint/docs-stale-blocking.cjs), wired to [`.github/workflows/lint-docs.yml`](.github/workflows/lint-docs.yml)) fails the PR if a stale (over 120 days) architecture doc's territory was modified without the doc itself being updated. Hard pressure at PR time

Soft prompt during work, hard gate before merge. Both layers are **contextual** — they fire when you touch a doc's `related-files`, which is when re-reading it is cheap. The soft prompt covers `docs/architecture/` **and** `docs/dev/`; the CI gate stays architecture-only, because a how-to that documents a moved path breaks its reader without changing any subsystem's shape, so it must never block a PR. There is deliberately **no** calendar-driven backlog of "old docs" — `npm run docs:stale` reports the review cadence on demand instead

## Platform cost model — the one that keeps being rediscovered

**Crossing a thread boundary on Roku costs a rendezvous, and the count of crossings dominates the size of each.** A Task thread writing a field on — or appending a child to — a render-thread-owned node parks until that thread reaches a safe point, then marshals the payload. The same operation done thread-locally is orders of magnitude cheaper.

**Which side of that you are on is decided by who OWNS the node, not by how the code looks.** Nodes are render-owned by default — `m.global` and every Task node included — so render-thread code (`init()`, observers, `onKeyEvent`, `callFunc` targets) pays nothing to touch them. Measured on a Stick 4K: an `m.global` field read is **2.0 µs from the render thread and 93 µs from a Task thread — ~46×**.

**But thread-local is not free.** Moving a per-entry walk over Task nodes onto the render thread took it from 132.6 µs to **20.1 µs per entry** — a 6.6× win, not the 46× the read costs predict. The residue is plain interpreter work no thread placement can remove, so **budget the loop as well as the crossing**: an O(n) pass over nodes is still expensive on the render thread.

This is the *why* behind several rules that are otherwise easy to read as style: cache `m.global.user` in a local rather than re-reading per item, prefer `node.setFields({…})` to a run of assignments, use `transformBaseItemArray` over per-item `transformBaseItem`. They are all "make fewer crossings".

When designing any Task → UI handoff:

- **Batch.** Per-item or per-row delivery is the expensive shape. Measured on a Stick 4K: re-shaping one grid handoff into 8 per-row handoffs — *identical data* — took task-thread `emit` from 220 ms to 734 ms and total task time from 520 ms to 1403 ms. Batching it back restored ~235 ms.
- **Send the cheapest representation.** Strings and small AAs marshal far more cheaply than node trees; prefer handing over ids/titles and letting the render thread build its own nodes (`HomeRows.createSkeletonRows()` is the reference).
- **A busy render thread slows the Task down too** — in that same experiment the pipeline's network wait grew ~200 ms purely from rendering overlapping the run.

Full cost model, evidence and worked example: [`docs/architecture/async.md`](docs/architecture/async.md#crossing-the-thread-boundary-costs-a-rendezvous--budget-crossings-not-bytes). **Measure a handoff redesign before and after** — this cost is invisible in review and does not show up in a build.

## Where the rules actually live

This file holds only cross-cutting / repo-wide rules. Per-area rules live in scoped `CLAUDE.md` files that auto-load when an agent reads files in that directory:

| Working in… | Auto-loads |
|---|---|
| `components/` (any subfolder) | [`components/CLAUDE.md`](components/CLAUDE.md) |
| `components/video/` | [`components/video/CLAUDE.md`](components/video/CLAUDE.md) (also `components/CLAUDE.md`) |
| `components/data/` | [`components/data/CLAUDE.md`](components/data/CLAUDE.md) |
| `source/` (any subfolder) | [`source/CLAUDE.md`](source/CLAUDE.md) |
| `source/api/` | [`source/api/CLAUDE.md`](source/api/CLAUDE.md) (also `source/CLAUDE.md`) |
| `source/utils/` | [`source/utils/CLAUDE.md`](source/utils/CLAUDE.md) |
| `tests/` | [`tests/CLAUDE.md`](tests/CLAUDE.md) |
| `locale/` | [`locale/CLAUDE.md`](locale/CLAUDE.md) |
| `scripts/` (any subfolder) | [`scripts/CLAUDE.md`](scripts/CLAUDE.md) |

**Cross-cutting authoring norms** — the working principles that apply to *any* change, regardless of subsystem — live in [`.claude/rules/`](.claude/rules/): `cost-efficiency`, `dogfood-changes`, `intent-based-naming`, `isolate-the-fix`, `iterate-on-evidence`, `prove-dont-dismiss`, `reuse-existing-tooling`, `verify-dont-assume`. They are **load-bearing** and auto-load into Claude Code every session; read them before any non-trivial change. (Agents or tools that don't auto-load `.claude/rules/` should read them from that directory — the filenames say what each covers.)

For the *why* and *shape* of each subsystem, load the relevant doc from [`docs/architecture/`](docs/architecture/) (start with [`docs/architecture/README.md`](docs/architecture/README.md)'s topic map). For *how to do X* (writing tests, adding settings, migrations), see [`docs/dev/`](docs/dev/).

Quick task pointers:

- **Adding a user setting?** → [`docs/dev/new-user-setting.md`](docs/dev/new-user-setting.md)
- **Writing tests?** → [`docs/dev/unit-tests.md`](docs/dev/unit-tests.md)
- **Running tests?** → [`docs/dev/unit-tests-tdd.md`](docs/dev/unit-tests-tdd.md)
- **Registry migrations?** → [`docs/dev/registry-migrations.md`](docs/dev/registry-migrations.md)
- **Working in `scripts/` (BSC plugins, doc validators, codegen)?** → [`docs/dev/scripts-development.md`](docs/dev/scripts-development.md)
- **Debug flags / toast testing?** → [`docs/dev/debug-flags.md`](docs/dev/debug-flags.md)
- **Code style?** → [`docs/dev/code-style.md`](docs/dev/code-style.md)
- **Processing the weekly Roku crash CSV?** → [`docs/dev/crash-reports.md`](docs/dev/crash-reports.md) (run [`/crash-report`](.claude/skills/crash-report/SKILL.md))

## Workflow

### Looking up Roku platform docs

The source-of-truth Roku developer docs live in [`rokudev/dev-doc`](https://github.com/rokudev/dev-doc) on branch `v2.0`. Prefer the GitHub source over the rendered site at `developer.roku.com/dev` — the rendered site sometimes blocks fetches and truncates HTML tables that the markdown source preserves. Fetch via `gh`:

```bash
# Path discovery:
gh api repos/rokudev/dev-doc/git/trees/v2.0?recursive=1 --jq '.tree[].path' | grep <topic>

# Read a file (decode the base64 content field):
gh api repos/rokudev/dev-doc/contents/<path>?ref=v2.0 --jq '.content' | base64 -d
```

Most useful subtrees: `docs/REFERENCES/scenegraph/` (scene graph nodes + interface fields), `docs/REFERENCES/brightscript/` (components / events / interfaces — `roInput`, `roInputEvent`, `roMessagePort`, etc.), `docs/DEVELOPER/` (feature guides — voice transport, deep linking, certification). Trust the repo when it disagrees with the rendered site; the rendered site is built from this source.

### IDE integration

- `brightscript.projects` (in `.vscode/settings.json`) drives auto-build/validate via the BrighterScript extension during dev
- The IDE's BSC plugin watches `en_US.json` and regenerates `translationKeys` constants live

### Pre-push hook (husky)

`.husky/pre-push` runs on `git push`. Mirrors CI lint, scoped to files in the push range. Auto-fix steps mutate files (combined into one `chore: auto-fix via pre-push hook` commit; never amends); check steps abort the push on failure. Bypass with `git push --no-verify` only as last resort. Full details in [`docs/architecture/build-and-tooling.md`](docs/architecture/build-and-tooling.md).

### Commit messages

Conventional Commits style (matches `git log`): `type(scope): summary`. No `Co-Authored-By` footer

### Pull requests

Use the `/pr` skill — it builds the body from `.github/pull_request_template.md`, scans for related issues, and surfaces architecture docs whose related-files were touched. No `🤖 Generated with Claude Code` footer or any other Claude attribution
