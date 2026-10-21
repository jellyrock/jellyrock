# JellyRock agent rules

JellyRock is a Jellyfin client for Roku, written in **BrighterScript** (`.bs`, transpiled to `.brs`) with **Roku SceneGraph** (`.xml`) for the UI. The Jellyfin REST API is wrapped by an in-house client and a persistent Task pool: see [`source/api/CLAUDE.md`](source/api/CLAUDE.md) and [`docs/architecture/api.md`](docs/architecture/api.md).

## ⚠️ Mandatory rules

1. Don't make things up or assume them.
2. Ask a clarifying question when you're not sure.
3. Aim for best practice, industry standards, easy long-term maintenance, no regressions, and excellent UX and DX.
4. Look for the best possible solution to a problem, then give the user their best options.
5. Iterate on a plan with the user until they approve it, and only then start coding.
6. After finishing an approved plan, run the automated tests to verify it. Give a manual test plan only for UI and runtime behavior the tests don't cover, with any debug-log output to expect.

## Agent rules

- **Run tests to verify a fix; don't commit on reasoning alone.** Nothing runs tests automatically, so an agent is expected to run them. BrightScript unit tests on a Roku: `npm run test:tdd` for one spec (fastest), or `npm run test:unit`, `test:integration` or `test:all` for more. A BSC plugin or script change (Vitest, no device): `npm run test:scripts`. RTA functional tests (Vitest driving a real device, for navigation and screen regressions): `npm run test:rta`, or `npm run test:rta:capture` to see the screens while designing UI ([`docs/dev/rta-tests.md`](docs/dev/rta-tests.md)). Setup, credentials and debugger conflicts: [`docs/dev/unit-tests-tdd.md`](docs/dev/unit-tests-tdd.md).
- **Check whether a device is reachable before claiming it isn't: `npm run device:check`.** It probes every device in `.env` over ECP (no authentication, no dev mode needed) and prints the verdict you then report. **A device that answers is a device you can test on: run the tests.** Only when the probe fails do you say no device was reachable, and then say *the probe failed*, not that you lack access. **Saying "I don't have access to a device" without running it is the failure this rule exists to stop:** it reads like a considered result, and it is the cheapest way to satisfy a rule that only asked you to say so. ECP answering doesn't promise an install will succeed (dev mode off, or a `ROKU_PASSWORD` for another device, still fails at deploy); that is a different report, and also a checked one. Never call a fix tested when only the build was checked.
- **A new git worktree has no git hooks until `npm ci` runs in it.** Git reads hooks from each worktree's own gitignored `.husky/_/`, so a bare worktree commits and pushes with no checks and no warning. Put it under `.claude/worktrees/<name>`, never in a Claude Code session scratchpad: that path contains a UUID, npm masks UUIDs in its output, and `npm ci` then fails. Run `npm ci` in the worktree and confirm `.husky/_/pre-push` exists before committing. Don't symlink `node_modules` instead: `.gitignore` doesn't match the link, and the branch would run the main checkout's dependencies. In Claude Code, creating one (`git worktree add`, an `Agent` with `isolation: "worktree"`, `EnterWorktree`) prompts the user through `permissions.ask` in [`.claude/settings.json`](.claude/settings.json), so say why before asking. **A hook in a worktree runs with `GIT_DIR` set**, which git obeys over any `cwd`, so anything the hook starts that runs git elsewhere hits the real repo: a push from a worktree once moved the pushed branch to a test commit and wrote `core.bare=true` into the shared config. `.husky/pre-push` unsets those variables, and the script-test helpers clean their own environment ([`tests/scripts/unit/_helpers/git-env.js`](tests/scripts/unit/_helpers/git-env.js)); keep both if you add a hook step that runs git.
- **Start a branch from local `main`, or pass `--no-track`; never `git switch -c <branch> origin/main`.** A branch started from a remote-tracking ref gets that ref as its upstream, and VS Code's Sync pushes a branch to its upstream without asking here, so one click sends the branch's commits straight to `main` with no PR. It happened on 2026-10-04: a lint fix reached `main` that way two minutes after it was committed.
- **Never modify `CHANGELOG.md`:** CI writes it.
- **Don't re-run lint, build or format by reflex mid-work.** `npm run validate`, `lint:*`, `build:*`, `check-formatting` and `format` already run in the pre-commit and pre-push hooks and in CI on every push, and most editors show BSC diagnostics as you type. So they aren't for routine "did my change compile" checks, but they're fair game when debugging a specific failure, when no hook has run yet, or when your editor shows no diagnostics. **Test scripts are covered only in part:** pre-push runs `npm run test:scripts` (whenever the push range has JS), and so does CI, so running it every turn is the redundancy this rule warns about. No hook runs `test:tdd`, `test:unit` or `test:integration` (they need a device), so running them to finish work that affects the device is the expected workflow, not a redundancy.
- **Record guidance meant for later sessions in a `CLAUDE.md` (the root or a scoped one), not in agent-private memory.** Memory files are per folder (each worktree and each JellyRock checkout gets its own), aren't committed and don't reach other contributors. Project rules belong in `CLAUDE.md`, so everyone benefits. Auto-memory is off for the project (`autoMemoryEnabled: false` in `.claude/settings.json`).
- **Never cite a gitignored path as a source in tracked content:** `tasks/`, `docs/projects/`, `.claude/handoffs/`, `.claude/plans/`. A reviewer can't open them, and a local planning file is archived or deleted once its work finishes, so the citation breaks by design. This covers commit messages, PR bodies, shared docs **and source comments**. Comments are where it keeps slipping, because a `PLAN.md` feels like a real document while you work from it. If a rationale is worth citing from tracked code, move it to a tracked home first ([`/log decision`](.claude/skills/log/SKILL.md), an ADR or the relevant doc) and cite that. Naming such a path as a *destination* is fine: a skill telling an agent where to write a handoff is an instruction, not a citation.
- **A PR's follow-ups go in a journal, not only the PR body.** When a PR defers something ("out of scope", "follow-up"), add an entry to the right journal (see Capture & state discipline below) and link it from the PR. Otherwise the deferral is lost once the PR merges.

## Landing

How far an agent may land a change here without asking. Landing is a push to `main`, a PR merge, a deploy command or a change on a live host; a throwaway test in a scratch copy is not.

- **Level: `ask`.** Nothing reaches `main` without the operator's yes. Never push to `main` directly or force-push (branch protection lets the owner's login bypass it, so this rule is the gate), and never merge a PR without the operator's direct approval, even when every check passed. Opening a PR is fine, through `/pr`.
- **Always ask:** before publishing a release or tag, and before anything posted publicly.
- **When waiting costs something** (harm due before the operator is likely back): get the fix ready short of landing it, try to reach the operator (a push notification, when the session has one), then wait. The report leads with the deadline.

## Repo facts

The facts the shared skills read, one slot each (they link `AGENTS.md#<slot>`).

### Capture types

decision, followup, running (replaces the one-paragraph Currently running note in `docs/progress.md`)

### Public posture

`public`

### Docs check

`npm run lint:docs`

### Verification commands

- `npm run test:scripts`: the Vitest suite (scripts, BSC plugins, lint scripts), no device. Pre-push runs it when the push range has JS, and CI on every PR.
- `npm run validate`: the BrighterScript type check.
- `npm run lint`: the lint chain CI runs; pre-push mirrors it, scoped to the files in the push range.
- On a Roku: `npm run device:check` first, then `npm run test:tdd` (one spec, fastest), `test:unit`, `test:integration` or `test:all`, and `npm run test:rta` for navigation and screen regressions. No hook runs these. A failed probe is reported as the probe failing, and a fix is never called tested when only the build was checked.
- Never bare `bsc`, `vitest`, `markdownlint-cli2` or `spellchecker`: the npm wrappers carry the project files, plugins and config.
- Never `--no-verify`. A new worktree has no hooks until `npm ci` runs in it.

### Plan path

`.claude/plans/` (gitignored)

### Forge

backend: github
prs: always

## Capture & state discipline

The four-pillar journal system ([`docs/architecture/system-shape.md`](docs/architecture/system-shape.md)) treats live project state as something work depends on. These rules govern how agents use the journals:

- **Capture discipline.** When committing a change shaped like a decision (a choice that closes off alternatives, has a reason that isn't obvious, or has a constraint worth checking again later), invoke `/log decision` in the same change set. **Agents don't edit [`docs/decisions.md`](docs/decisions.md) or [`docs/progress.md`](docs/progress.md) by hand:** use `/log` to capture and `/done` to close. A direct `Write` or `Edit` on those files bypasses those skills' validation and correction loop and can silently corrupt project state. *The CI exception:* the post-merge [`.github/workflows/journal-sync.yml`](.github/workflows/journal-sync.yml) workflow is the one writer of `progress.md` that isn't a skill. It does the mechanical close (moves `## Currently running` to `## Recently shipped` and bumps `last-updated:`) through [`scripts/journal-sync.js`](scripts/journal-sync.js). Entries that need judgment (decisions, tech debt, followups) still go through the user-run `/pr` and `/log`.
- **Followup discipline.** When a PR defers work ("out of scope", "follow-up", "TODO later"), pick the right journal:
  - Internal debt with a slug and a severity (a refactor candidate, design intent worth keeping): invoke [`/tech-debt-scan`](.claude/skills/tech-debt-scan/SKILL.md), which writes to [`docs/architecture/tech-debt.md`](docs/architecture/tech-debt.md).
  - Other deferred work: invoke `/log followup "<text>" --area=<name>`, which writes to [`docs/progress.md`](docs/progress.md).
  - Watching something upstream: Jellyfin releases and release candidates and Roku OS releases each open an issue from CI ([`server-upgrade-tracker.yml`](.github/workflows/server-upgrade-tracker.yml), [`roku-hardware-sync.yml`](.github/workflows/roku-hardware-sync.yml)), and closing it is the acknowledgment. Anything else upstream (a dependency fix, an API a library may add) is a followup naming what to check and what to do when it moves.
- **Catchup discipline.** At the start of a genuine new session, and after a gap of several days, run [`/focus`](.claude/skills/focus/SKILL.md) (opus: ranks the actionable work and recommends one next move with one to three alternatives, printing the command to take it) or [`/catchup`](.claude/skills/catchup/SKILL.md) (sonnet: a read-only state briefing). Use `/focus` for help picking which of several next moves to take, and `/catchup` for the state alone. Never work out the journals and GitHub state from scratch: both skills read the shared state reader ([`.claude/skills/catchup/catchup-state.sh`](.claude/skills/catchup/catchup-state.sh): git, the followup journal, projects) and the aggregator [`scripts/catchup-state.js`](scripts/catchup-state.js) (GitHub and its upstream-watch issues, decisions, tech debt). Coming back to one subsystem after more than two weeks, use [`/ramp <area>`](.claude/skills/ramp/SKILL.md) instead.
- **No PR for journals alone.** A change that touches only `docs/progress.md`, `docs/decisions.md` or `docs/architecture/tech-debt.md` rides the next PR that changes code. It doesn't get a PR of its own: a one-line followup edit isn't worth a template, a CI round and a review, and the point of `/pr` is that journal upkeep lands in the same change set as the work. If the work it describes is paused, the finding waits in the project's `PLAN.md` until something ships. The exception is an entry that would be wrong if it waited, such as a correction to an entry another session is about to act on. (Recorded 2026-09-17, after a device finding about `SearchResults` became its own docs PR.)
- **Ship through `/pr`.** Invoking [`/pr`](.claude/skills/pr/SKILL.md) is the moment of shipping. `/pr` runs the three judgment passes (the tech-debt scan, the decision-shape check, followup capture), so journal upkeep lands in the same change set instead of a separate manual step. Don't bypass `/pr` with `gh pr create` or the GitHub UI: those skip the passes and let the journals drift.

Enforcement, from soft to hard:

- **The session-start nudge.** The `SessionStart` hook runs [`scripts/lint/session-start-nudge.cjs`](scripts/lint/session-start-nudge.cjs), which prints one advisory line when local journal and handoff state suggest work to do (pending handoffs, a stale `progress.md`, a journal whose schema is broken). It is silent on a clean state, local only, with no network calls, and it raises the catchup-discipline rule at the moment it applies.
- **Nudges during a session.** The `Stop` hook runs [`scripts/lint/progress-cursor-nudge.cjs`](scripts/lint/progress-cursor-nudge.cjs), which flags a stale `progress.md` and Currently running items that overlap shipped commits.
- **Pre-push nudges.** The same `progress-cursor-nudge`, plus `decision-shape-nudge`, print advice. They never block.
- **The post-merge sync.** [`.github/workflows/journal-sync.yml`](.github/workflows/journal-sync.yml) does the mechanical close after a PR merges (moves `## Currently running` to `## Recently shipped` and bumps `last-updated:`). It skips PRs labeled `dependencies`, `documentation`, `docs-only`, `ci`, `automated` or `chore-only`, and PRs by Renovate, Dependabot or other bots.
- **The weekly tracker.** [`.github/workflows/docs-stale-tracker.yml`](.github/workflows/docs-stale-tracker.yml) runs on Mondays on `main` and keeps one issue labeled `docs:stale` for the freshness of the [`docs/progress.md`](docs/progress.md) cursor: more than 7 days old with commits since that aren't maintenance, as [`progress-cursor-nudge.cjs`](scripts/lint/progress-cursor-nudge.cjs) `--json` computes it. **It never blocks:** how stale `progress.md` is depends on `main`, not on any one PR, so it never fails a contributor's PR. (The former `progress-stale` lint gate did, failing unrelated dependency and docs PRs.) It no longer tracks `last-reviewed` freshness for architecture and dev docs; the contextual prompts below handle that, firing while you're already in the doc's territory. Run `npm run docs:stale` for the full review-cadence list.
- **The CI lint gate.** `npm run lint:docs` fails when [`docs/progress.md`](docs/progress.md) has a missing or malformed `last-updated:` field (the `progress-frontmatter` category, a structural check on each PR). How stale `progress.md` is over time is **not** a CI gate: the weekly tracker above handles it. CI runs the lint on every PR.

## Doc maintenance discipline

When you modify a file listed in any architecture doc's `related-files:` frontmatter, re-read that doc, then either:

- **Update it** if the change altered the subsystem's *shape* or *why*, and bump `last-reviewed` in its frontmatter to today's date; or
- **Confirm in your response that the shape and why didn't change**, and leave the doc alone. Don't bump `last-reviewed`: that date must reflect a real review against current code.

Two layers back this up:

- An **end-of-turn hook** (Claude Code's `Stop`, the Copilot Coding Agent's `sessionEnd` in `.github/hooks/hooks.json`) prints which docs claim the files you touched, **in both `docs/architecture/` and `docs/dev/`**, with dev guides marked informational. It doesn't block. The logic is in [`scripts/lint/check-touched-related-files.cjs`](scripts/lint/check-touched-related-files.cjs).
- A **CI gate** ([`scripts/lint/docs-stale-blocking.cjs`](scripts/lint/docs-stale-blocking.cjs), run by [`.github/workflows/lint-docs.yml`](.github/workflows/lint-docs.yml)) fails the PR if the territory of an architecture doc more than 120 days old was modified without the doc itself being updated.

A soft prompt during work, a hard gate before merge. Both are **contextual:** they fire when you touch a doc's `related-files`, which is when re-reading it is cheap. The soft prompt covers `docs/architecture/` **and** `docs/dev/`; the CI gate stays architecture-only, because a how-to that names a moved path breaks its reader without changing any subsystem's shape, so it must never block a PR. There is **no** calendar-driven backlog of old docs; `npm run docs:stale` reports the review cadence on demand instead.

## The platform cost model that keeps being rediscovered

**Crossing a thread boundary on Roku costs a rendezvous, and the number of crossings matters more than the size of each.** A Task thread writing a field on, or appending a child to, a node the render thread owns parks until that thread reaches a safe point, then marshals the payload. The same operation done on the owning thread is orders of magnitude cheaper.

**Which side you're on is decided by who owns the node, not by how the code looks.** Nodes are owned by the render thread by default, `m.global` and every Task node included, so render-thread code (`init()`, observers, `onKeyEvent`, `callFunc` targets) pays nothing to touch them. Measured on a Stick 4K (2026-08-23): an `m.global` field read takes **2.0 µs from the render thread and 93 µs from a Task thread**, about 46 times as long.

**But staying on the owning thread is not free.** Moving a per-entry walk over Task nodes onto the render thread took it from 132.6 µs to **20.1 µs per entry** (Stick 4K, 2026-08-23): 6.6 times faster, not the 46 times the read costs predict. The rest is plain interpreter work no thread placement can remove, so **budget the loop as well as the crossing**: an O(n) pass over nodes is still expensive on the render thread.

This is the *why* behind several rules that are easy to read as style: keep `m.global.user` in a local rather than reading it per item, prefer `node.setFields({…})` to a run of assignments, use `transformBaseItemArray` over per-item `transformBaseItem`. All of them mean "make fewer crossings".

When designing any handoff from a Task to the UI:

- **Batch.** Delivering per item or per row is the expensive shape. Measured on a Stick 4K (2026-08-08): splitting one grid handoff into 8 per-row handoffs, with *identical data*, took the Task's `emit` from 220 ms to 734 ms and the total Task time from 520 ms to 1403 ms. Batching it back recovered about 235 ms.
- **Send the cheapest representation.** Strings and small AAs marshal far more cheaply than node trees; prefer handing over IDs and titles and letting the render thread build its own nodes (`HomeRows.createSkeletonRows()` is the reference).
- **A busy render thread slows the Task down too:** in that same experiment the pipeline's network wait grew by about 200 ms purely from rendering overlapping the run.

The full cost model, evidence and worked example: [`docs/architecture/async.md`](docs/architecture/async.md#crossing-the-thread-boundary-costs-a-rendezvous--budget-crossings-not-bytes). **Measure a handoff redesign before and after:** this cost is invisible in review and doesn't show in a build.

## Where the rules live

This file holds only rules that apply across the repo. Rules for one area live in scoped `CLAUDE.md` files, which load automatically when an agent reads files in that directory:

| Working in… | Loads |
|---|---|
| `components/` (any subfolder) | [`components/CLAUDE.md`](components/CLAUDE.md) |
| `components/video/` | [`components/video/CLAUDE.md`](components/video/CLAUDE.md) (and `components/CLAUDE.md`) |
| `components/data/` | [`components/data/CLAUDE.md`](components/data/CLAUDE.md) |
| `source/` (any subfolder) | [`source/CLAUDE.md`](source/CLAUDE.md) |
| `source/api/` | [`source/api/CLAUDE.md`](source/api/CLAUDE.md) (and `source/CLAUDE.md`) |
| `source/utils/` | [`source/utils/CLAUDE.md`](source/utils/CLAUDE.md) |
| `tests/` | [`tests/CLAUDE.md`](tests/CLAUDE.md) |
| `tests/rta/` | [`tests/rta/CLAUDE.md`](tests/rta/CLAUDE.md) (and `tests/CLAUDE.md`) |
| `locale/` | [`locale/CLAUDE.md`](locale/CLAUDE.md) |
| `scripts/` (any subfolder) | [`scripts/CLAUDE.md`](scripts/CLAUDE.md) |
| `.claude/skills/` | [`.claude/skills/CLAUDE.md`](.claude/skills/CLAUDE.md) |

**The working principles for any change**, whatever the subsystem, are in [`.claude/rules/`](.claude/rules/): one rule per file, each named for what it covers (`ls .claude/rules` lists them). They load into Claude Code in every session, and they matter: read them before any non-trivial change. An agent or tool that doesn't load `.claude/rules/` should read them from that directory.

For the *why* and *shape* of each subsystem, load its doc from [`docs/architecture/`](docs/architecture/) (start with the topic map in [`docs/architecture/README.md`](docs/architecture/README.md)). For *how to do X* (writing tests, adding settings, migrations), see [`docs/dev/`](docs/dev/).

Quick pointers:

- **Adding a user setting?** [`docs/dev/new-user-setting.md`](docs/dev/new-user-setting.md)
- **Writing tests?** [`docs/dev/unit-tests.md`](docs/dev/unit-tests.md)
- **Running tests?** [`docs/dev/unit-tests-tdd.md`](docs/dev/unit-tests-tdd.md)
- **Registry migrations?** [`docs/dev/registry-migrations.md`](docs/dev/registry-migrations.md)
- **Working in `scripts/` (BSC plugins, doc validators, codegen)?** [`docs/dev/scripts-development.md`](docs/dev/scripts-development.md)
- **Debug flags or toast testing?** [`docs/dev/debug-flags.md`](docs/dev/debug-flags.md)
- **Code style?** [`docs/dev/code-style.md`](docs/dev/code-style.md)
- **Processing the weekly Roku crash CSV?** [`docs/dev/crash-reports.md`](docs/dev/crash-reports.md) (run [`/crash-report`](.claude/skills/crash-report/SKILL.md))

## Workflow

### Looking up Roku platform docs

The source of Roku's developer docs is [`rokudev/dev-doc`](https://gitlab.com/rokudev/dev-doc), on branch `v2.0`. Roku archived the GitHub repo of the same name, which is frozen and still serves, so a read of it succeeds with stale data. Use GitLab. Prefer the markdown source to the rendered site at `developer.roku.com/dev`: the rendered site sometimes blocks fetches and cuts off HTML tables the markdown source keeps.

```bash
# Search: shallow-clone into the session scratchpad (a few seconds), then grep it.
git clone --depth 1 -b v2.0 https://gitlab.com/rokudev/dev-doc.git <scratchpad>/dev-doc

# Read one file:
curl -s https://gitlab.com/rokudev/dev-doc/-/raw/v2.0/<path>
```

The most useful subtrees: `docs/REFERENCES/scenegraph/` (SceneGraph nodes and interface fields), `docs/REFERENCES/brightscript/` (components, events and interfaces such as `roInput`, `roInputEvent` and `roMessagePort`), and `docs/DEVELOPER/` (feature guides: voice transport, deep linking, certification). When the repo and the rendered site disagree, trust the repo: the site is built from it.

### IDE integration

- `brightscript.projects` (in `.vscode/settings.json`) sets which bsconfigs the BrighterScript language server checks live in the editor (diagnostics only; it never builds). Each entry is a full in-memory copy of the app, checked again on every save, so it enables only `bsconfig.json` and `bsconfig-tests.json`. Don't add a config whose files and plugins are a subset of one already loaded.
- JS and JSON are formatted on save with Prettier (`esbenp.prettier-vscode`), the same tool and config the pre-commit hook runs.
- The IDE's BSC plugin watches `en_US.json` and regenerates the `translationKeys` constants live.

### Pre-push hook (husky)

`.husky/pre-push` runs on `git push`. It mirrors CI's lint, scoped to the files in the push range. Its auto-fix steps change files (combined into one `chore: auto-fix via pre-push hook` commit; it never amends), and its check steps stop the push on failure. Never bypass it with `--no-verify` (see Verification commands above). The details are in [`docs/architecture/build-and-tooling.md`](docs/architecture/build-and-tooling.md).

### Commit messages

Conventional Commits style, as in `git log`: `type(scope): summary`. A PR's title becomes the squash commit's first line, and its type decides where the change lands in `CHANGELOG.md`. The types and their sections are defined once in [`scripts/lib/pr-title.js`](scripts/lib/pr-title.js), and CI rejects a PR title without one.

### Pull requests

Use the `/pr` skill. It picks the title's type, labels the PR, builds the body from `.github/pull_request_template.md`, puts reviewer-only detail in a review-notes comment, looks for related issues, and lists the architecture docs whose related files were touched. No `🤖 Generated with Claude Code` footer or any other Claude attribution.
