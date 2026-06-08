# Decisions log

Append-only log of non-obvious design and process decisions made on JellyRock. The intent is **lightweight ADRs without the ceremony** — capture the *why* once, so future-you (and future agents) don't have to re-derive it from the code.

## When to add an entry

Add an entry when you make a decision that:

- **Has a non-obvious rationale** that wouldn't be apparent from the code alone (e.g. "we use task pool children-as-vehicles instead of fields because SceneGraph coalesces field events").
- **Closes off alternatives** that someone else might reasonably re-propose (e.g. "we use a custom translation system, not Roku's `tr()`, because…").
- **Has a constraint or trade-off behind it** that might be worth re-evaluating later (e.g. "we hardcode `30s` API timeout; per-call timeouts are nice-to-have but the cost vs. complexity didn't justify").

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

Each entry is its own `H2` section. Required fields:

- **id**: a stable kebab-case slug (used to cross-reference from commits / PRs / other entries)
- **date**: when the decision was made (YYYY-MM-DD)
- **status**: `accepted`, `superseded`, or `withdrawn`

Optional:

- **supersedes** / **superseded-by**: cross-reference if applicable
- **related-files**: paths whose existence depends on this decision

Then the body: why, what we considered, what we chose, what we ruled out, and any constraints behind the choice. Keep it short — one or two paragraphs. If it grows long, the entry probably should be a real architecture doc.

---

## decision-id: triage-opus-inline-investigation

**date**: 2026-05-06
**status**: accepted
**related-files**: .claude/skills/issue-triage/SKILL.md, .claude/skills/issue-triage/INVESTIGATION.md, .claude/skills/pr-review/SKILL.md, .claude/skills/pr-review/INVESTIGATION.md, .claude/skills/runtime-triage/SKILL.md, .claude/skills/runtime-triage/INVESTIGATION.md, .claude/skills/ci-triage/SKILL.md, .claude/skills/ci-triage/INVESTIGATION.md

The four triage skills (`/issue-triage`, `/pr-review`, `/runtime-triage`, `/ci-triage`) were redesigned from a "sonnet skill + Task-delegated opus agent" pair to a single opus skill that continues in-thread into a sibling `INVESTIGATION.md` contract. Two discovered constraints forced the change: the VSCode extension does not auto-revert the session model after a skill exits (the session stays on the skill's model), making the intended sonnet→opus handoff unreliable; and Task delegation is one-shot and isolated, preventing mid-investigation scope adjustment and breaking the human-in-the-loop workflow.

Alternatives considered: keep sonnet + Task-only (loses interactive investigation, back to the original friction); keep sonnet + document `/model opus` as a manual step (unreliable in this environment, GUI never reflects the switch). The chosen shape runs full-opus throughout, writes a structured YAML frontmatter handoff file (fields: created, target, branch, sha, cited-files) to `.claude/handoffs/` (gitignored) for compaction recovery, cross-session resume, and `/catchup` discovery, and adds a dedup check (Step 0) that short-circuits to the existing handoff when the target and cited files are unchanged since the prior triage. The four original investigator agent files (`*-investigator.md` under `.claude/agents/`) were deleted; their investigation contracts live as sibling `INVESTIGATION.md` files co-located with each skill, structurally preventing Task delegation from re-emerging.

## decision-id: four-pillar-journal-reshape

**date**: 2026-05-06
**status**: accepted
**related-files**: docs/progress.md, docs/signals-backlog.md, docs/architecture/system-shape.md, scripts/catchup-state.js, scripts/lint/decision-shape-nudge.cjs, .claude/skills/log/SKILL.md, .claude/skills/done/SKILL.md, .claude/skills/catchup/SKILL.md, .claude/skills/ramp/SKILL.md, scripts/lint/docs-check.cjs, scripts/lib/frontmatter.cjs, CLAUDE.md, .claude/skills/CLAUDE.md

Adopted the four-pillar journal pattern from a sister project, tuned for JellyRock conventions. Before this change, JellyRock had strong slow-decay journals ([`docs/decisions.md`](decisions.md), [`docs/architecture/tech-debt.md`](architecture/tech-debt.md)) and strong enforcement (husky + CI lint), but no fast-decay state cursor and no unified capture/completion ritual. Captures were ad-hoc edits or just `/add-decision`; there was no central "where did I leave off / what's open" surface. The reshape adds [`docs/progress.md`](progress.md) (live state cursor — currently running, recently shipped, open followups grouped by area, ~14d rolling), [`docs/signals-backlog.md`](signals-backlog.md) (external upstream watching with schema-validated rows), a Node aggregator at [`scripts/catchup-state.js`](../scripts/catchup-state.js) returning one JSON document for `/catchup` and `/ramp` (replaces ~13 parallel-bash calls; deterministic banner detection), and the unified `/log <type>` + `/done <slug>` skills replacing `/add-decision`. Enforcement: new `progress-stale` and `signals-schema-invalid` lint categories in `docs-check.cjs`; advisory pre-push decision-shape nudge at `decision-shape-nudge.cjs`; root [`CLAUDE.md`](../CLAUDE.md) "Capture & state discipline" subsection making `/log` the only sanctioned write path for the three new-or-touched journals.

Alternatives considered and ruled out: a strict Diátaxis tutorial bucket (existing [`DEVGUIDE.md`](dev/DEVGUIDE.md) covers that role; splitting `docs/dev/` would force users to know a Diátaxis category before they can navigate); a second backlog file for research questions (followups in `progress.md` handle that until volume justifies splitting); a backlog-row-per-dependency-bump auto-detector (low signal-to-noise; manual capture only). What stays unchanged: GitHub issues remain primary backlog for issue-shaped work; [`tech-debt.md`](architecture/tech-debt.md) keeps its slug-based slow-decay role via [`/tech-debt-scan`](../.claude/skills/tech-debt-scan/SKILL.md) (no overlap with `progress.md` followups). The four-pillar shape is documented in [`system-shape.md`](architecture/system-shape.md) — see that doc for principles, lineage citations (Nygard ADR + Procida Diátaxis + GTD + agent-collaborative project memory), and audience tuning (solo + AI + OSS-eventual). Constraint behind the choice: deferring enforcement is the same anti-pattern that creates drift, so `progress-stale` + `signals-schema-invalid` lint gates land in the same change set as the journal files themselves rather than as a "we'll add it later" followup.

## decision-id: signals-backlog-scope

**date**: 2026-05-08
**status**: accepted
**related-files**: docs/signals-backlog.md, scripts/catchup-state.js, scripts/lib/signals-fetch.cjs

`docs/signals-backlog.md` tracks external platform and upstream version signals (Jellyfin server, Roku OS) but explicitly excludes npm package dependencies. The exclusion holds because Renovate already tracks and proposes bumps for npm packages (`brighterscript`, `rooibos`, `roku-log` and the rest) — two systems tracking the same thing produces noise, not signal. The signal rows that were deleted (`brighterscript`, `rooibos`, `roku-log`) were manual-update-only and always stale; Renovate PRs surface the same information more reliably and sooner.

The auto-maintained design (aggregator fetches `latest_upstream` each `/catchup` run) required a second user-controlled field, `latest_acknowledged`, to separate "what's out there" from "what a human reviewed". A row is stale (banner-worthy) only when `latest_upstream != latest_acknowledged` and `status == watching` — this lets the aggregator update freely without triggering false-positive banners on rows the user already reviewed. The `--no-network` flag makes the aggregator testable offline. Considered: manual-only `last_checked` staleness (the prior approach — worked for Renovate-covered deps but failed for platform signals because no Renovate bot tracks Roku OS or Jellyfin server major bumps).

## decision-id: icons-material-rounded-house-style

**date**: 2026-05-09
**status**: accepted
**related-files**: resources/icons/README.md, scripts/generate/icons-build.js, scripts/generate/icons-add.js, manifest

JellyRock standardizes all in-app icons on Material Symbols — Rounded variant, weight 500, `24px` optical size. These coordinates are locked in `npm run icons:add` (the fetch URL encodes all of them), so contributors can't drift per-icon. Rounded was chosen over Outlined and Sharp because it antialiases cleanest under 720p OS framebuffer downsample (the core concern of issue #419), matches the soft rounded aesthetic of the Jellyfin brand, and is the industry convention for media-streaming TV apps (YouTube TV, Google TV, Plex). Weight 500 gives better stroke contrast than Material's default 400 at 10-foot viewing distance. `24px` optical size pairs with the build-script's trim-and-pad pipeline so the rendered glyph fills the canvas at JellyRock's per-icon density instead of Material's ~25% built-in design-grid padding. Fill 0 (outlined) is now the default per `icons-outlined-by-default`; fill 1 is the documented exception for 7 specific categories (see `resources/icons/README.md#fill-convention`).

Non-Material exceptions are committed directly to `resources/icons/` and documented in the provenance table in `resources/icons/README.md`. Two current exceptions: `tomato-fresh.svg` and `tomato-rotten.svg` (Rotten Tomatoes tomatometer icons, PD-textlogo from Wikimedia Commons, used nominatively to attribute critic scores). Constraints worth re-evaluating: if Roku adds a `4K` UI resolution, if Material introduces a TV-specific variant axis, or if Jellyfin's brand direction changes.

## decision-id: jrplaceholder-themed-composition

**date**: 2026-05-09
**status**: accepted
**related-files**: `components/ui/placeholder/JRPlaceholder.xml`, `components/ui/placeholder/JRPlaceholder.bs`, `source/utils/placeholderImage.bs`, `resources/placeholders/placeholders.json`, `components/ui/rowitem/JRRowItem.xml`

Placeholder images needed visual weight ("glyph on a styled card") at poster-tile size. Baking the card background into the PNG at build time was rejected because JellyRock supports 8 built-in themes plus user-customizable brand colors — per-theme PNG variants would multiply asset count by theme × placeholder × resolution, and a hardcoded background defeats custom-color theming entirely. The build pipeline cannot know the runtime theme.

Instead: the card is a runtime SceneGraph composition. `JRPlaceholder` wraps a `RectangleBackgroundSecondary` (themed to `colorBackgroundSecondary`) behind a `Poster` glyph (white-fill PNG tinted via `blendColor=colorBackgroundPrimary`). This generalizes the inline backdrop + `blendColor` pattern `JRRowItem` already used, extracted as a reusable component. Placeholder PNGs remain transparent-canvas white-fill — identical contract to the icon set — so the same `icons-build.js` pipeline produces both icon and placeholder assets with no new rendering mode.

## decision-id: icons-outlined-by-default

**date**: 2026-05-09
**status**: accepted
**supersedes**: icons-material-rounded-house-style (fill axis only)
**related-files**: resources/icons/README.md, scripts/generate/icons-add.js

PR #560 defaulted `icons:add` to `fill=1`. Visual audit during placeholder integration confirmed that `fill=0` (outlined) reads more clearly at 10-foot TV distance — the silhouette is recognizable regardless of fill state — and matches the Material 3 / Apple HIG / IBM Carbon defaults for medium-size action icons. The URL pattern for the fill=0 variant was also wrong in the script (`fill=0` uses `<name>_wght500_<size>.svg`, not the nonexistent `<name>_wght500fill0_<size>.svg`), so some of the "fill=0" icons committed in PR #560 were actually the Material CDN default (coincidentally fill=0 for the specific symbols chosen).

The convention was revised to `fill=0` as the default with 7 documented exception categories: pure-shape primitives, small-canvas size (under 32 pixels), subject/identity content (avatars + content-type representations like `album` / `missingArtist` / `musicFolder` / `musicNote`), placeholder context, rating glyphs, playback-action buttons composing `play`, and toggle on-states. See the decision tree in `resources/icons/README.md#fill-convention`. The `icons:add` script gained a `--filled` flag to opt into fill=1 for the exception cases.

## decision-id: per-issue-crash-enrichment

**date**: 2026-05-20
**status**: accepted
**related-files**: scripts/crash-report.js, .claude/skills/crash-backtrace/SKILL.md, .claude/skills/crash-report/SKILL.md, .claude/skills/README.md, docs/dev/crash-reports.md, .crash-report/known-noise.yml, tests/scripts/unit/crash-report.test.js

Split the Roku crash-handling workflow into two slash commands — [`/crash-report`](../.claude/skills/crash-report/SKILL.md) files issues from the weekly aggregate CSV; [`/crash-backtrace <N>`](../.claude/skills/crash-backtrace/SKILL.md) enriches one already-filed issue with the multi-frame backtrace + locals snapshot from Roku's analytics dashboard. The architectural commitment is **per-issue, not bulk**: Roku's dashboard exposes backtraces only one click at a time (no bulk TSV export), so a single `/crash-report --dashboard-csv` invocation can never enrich a real weekly batch. Enrichment has to be a follow-up the user runs per issue after `/crash-report` files them, with the backtrace text passed via `@file` reference or inline paste in the same prompt. The `--dashboard-csv` flag stays in the helper as a forward-compatible bulk path if Roku ever ships an export, but isn't the daily workflow.

Pre-enrichment classification flags known-noise patterns before paying the `~30-90s` worktree build cost. Three classifications live in `classifyBacktraceForEnrichment` ([`scripts/crash-report.js`](../scripts/crash-report.js)) — hardcoded, not YAML: `timeout-one-off` (`Execution timeout` `&h23` with exactly 1 occurrence — recommended action close-as-not-actionable, since one-offs are usually transient server/network/device-stall blips), `timeout-recurring` (same error class but ≥2 occurrences — enrich + escalate to `/issue-triage`), and `global-constants-init-race-suspect` (`init()` + `&hec` Dot-operator error — belt-and-suspenders behind `/crash-report`'s YAML filter for #103, catches variants the YAML pattern missed). The user always has the final say via `AskUserQuestion` — the classifier surfaces the recommendation, not an auto-skip. Hardcoded over YAML because two patterns isn't enough config surface to justify a layer; promote to an `enrichment_noise:` section of [`.crash-report/known-noise.yml`](../.crash-report/known-noise.yml) when the count hits ~5.

Alternatives considered and ruled out: a single `/crash-report` skill that loops through filing + enrichment (rejected — the dashboard click-through breaks the loop, and the user wants enrichment as a separate decision per issue); auto-skip on classifier match without user confirmation (rejected — false-positive risk on `init()` variants that happen to share the `&hec` error code; one-off timeouts COULD be a real bug if the call site is suspicious); putting classification rules in `.crash-report/known-noise.yml` from day one (rejected — the YAML schema is shaped for filing-time matching against email CSV fields + source snippets, not against backtrace `errorCode` + occurrence count; forcing them into one schema would muddy both). Constraint behind the choice: enrichment is wall-clock expensive (`~30-90s` worktree build + `npm ci` + `bsc` per call), so the worktree cache (`1h` TTL at `/tmp/jellyrock-crash-wt-cache-<tag>`) is load-bearing — first call per version pays the cost, subsequent same-version calls cost `~1s`. Tag immutability makes the cache safe; manual eviction via `node scripts/crash-report.js clean-cache`.

## decision-id: placeholder-logo-tint

**date**: 2026-05-15
**status**: accepted
**related-files**: components/ItemDetails.bs

`ItemDetails` surfaces placeholder PNGs in the logo slot (via `getPlaceholderImagePath`) when no server image resolves. Unlike real server images — which render in their native colors and should stay white-blend — placeholder glyphs at logo size compete visually with the nearby title text when left at full-white. `onLogoLoadStatusChanged` tints any logo whose URI starts with `pkg:/images/placeholders/` to `colorBackgroundSecondary`, making it recede like a watermark rather than dominate the composition.

Detection via `Left(uri, 24)` prefix was chosen over a `m.isPlaceholder` flag because the flag would need to be cleared and reset at each `setItemLogo` call site (8+ branches) and could fall out of sync if the logo URI is reassigned without going through `setItemLogo`. The prefix is an invariant of the asset layout — every placeholder PNG lives under `pkg:/images/placeholders/` by build-pipeline convention — so the check is always accurate without coordination. Constraint worth re-evaluating if the placeholder asset directory is ever reorganized.

## decision-id: server-upgrade-anchor-strategy

**date**: 2026-05-29
**status**: accepted
**related-files**: scripts/generate/findings-candidates.js, scripts/generate/spec-fingerprint.js, scripts/generate/spec-diff.js, docs/architecture/spec-fingerprints/, docs/architecture/server-upgrade-automation.md

The server-upgrade-automation join step (`findings-candidates.js`, Phase 2) computes its forward delta from **committed spec fingerprints** read off disk, not from a spec fetched live at run time. "Fetch latest + commit its fingerprint" stays a separate, explicit step (`spec-fingerprint.js <version>`) that the release trigger runs once; the join itself never touches the network. We considered fetch-latest-on-demand (the join fetches the newest spec and diffs against it in one shot) and ruled it out: it would make the deterministic core network-dependent and non-reproducible — two runs against the same `<from>`/`<to>` could disagree if the upstream spec were re-published — which is at odds with the pipeline's stated deterministic/cacheable/offline principle and would make the whole join impossible to fixture-test.

The cost of the chosen path is that acting on a brand-new release is a two-step trigger (`spec-fingerprint.js <latest>` then `api-watch:findings <ack> <latest>`) rather than one. That's acceptable because committing the latest fingerprint is a natural, reviewable part of acknowledging a release anyway, and the fingerprints are small reduced-surface JSON (descriptions/examples stripped), so they're diffable in review without the ~2 MB raw-spec bloat. Pairs with the committed-fingerprints-over-raw-specs artifact decision recorded in the design doc's Decisions section.

## decision-id: server-upgrade-issue-filing

**date**: 2026-05-29
**status**: accepted
**related-files**: scripts/server-upgrade.js, .claude/skills/server-upgrade/SKILL.md, tests/scripts/unit/server-upgrade.test.js, docs/architecture/server-upgrade-automation.md

Phase 3's filer (`scripts/server-upgrade.js`) locks three choices for turning agent verdicts into GitHub issues. **(a) Version-independent dedup key** — a finding's identity is `kind + locator` (normalized path+method, or `Schema.field`, or enum schema), never the release version, so a concern that recurs across releases comments/reopens the one live issue instead of re-filing. This is load-bearing for the recompute-every-run classes: every `coverage-gap` and symmetry advisory is derived from manifest×floor and reappears on *every* run until the code is fixed, so a version-scoped key would spam an identical issue each release and erode the small team's trust in the automation. Rejected version-scoped keys (noisy) and opaque content hashes (unreadable titles, can't eyeball a match). **(b) The script owns the verdict template** — the script derives `findingKey` and enumerates every investigation candidate (`scaffold`), the agent fills judgment fields in place, and `plan` flags any candidate left without a verdict as `missing-verdict`. This closes both silent failure modes of a free-form hand-off (the agent inventing a mismatched key; the agent forgetting a candidate) for the price of one small pure command. **(c) All finding-classes human-gated** — running `execute` is the per-release batch approval (the "graduated trust ratchet"); `AUTO_FILE_CLASSES` is empty and each action carries `autoFileEligible: false` so Phase 5 can graduate a proven-low-false-positive class by config rather than a rewrite. Nothing auto-files now; coverage-gap is explicitly the worst auto-file candidate because the manifest's capability-guard coarseness (an endpoint tagged `[1, ∞)` only because it's guarded by a runtime capability check, e.g. `/audio/{}/lyrics`) is a known structural false-positive source the agent dispositions by reading the guard.

## decision-id: server-upgrade-proactive-ci

**date**: 2026-05-30
**status**: accepted
**related-files**: scripts/server-upgrade-tracker.js, .github/workflows/server-upgrade-tracker.yml, scripts/generate/findings-candidates.js, docs/signals-backlog.md, docs/architecture/server-upgrade-automation.md

Phase 4's proactive-CI tracker (`server-upgrade-tracker.js` + `server-upgrade-tracker.yml`) is the pipeline's one fully-autonomous surface: a daily workflow that maintains ONE tracker issue nudging a human to run `/server-upgrade`. It never files per-finding issues (that stays human-gated behind `/server-upgrade execute`) and never writes the repo or the journals. Three choices lock its shape. **(a) Counts from an ephemeral in-CI fingerprint, never committed** — the tracker's candidate counts need the `<to>` (latest) fingerprint, normally a committed, drift-gated, *reviewed* anchor. Rather than auto-commit it, the workflow builds it in memory from the fetched spec and runs the Phase-2 `buildReport` against the committed `from`/`floor` fingerprints. Auto-commit was rejected because committing a fingerprint for a version nobody has triaged decouples the "committed fingerprint = reviewed anchor" invariant (the drift gate exists precisely so a committed fingerprint means a human reviewed it) and would need push/token/concurrency plumbing for zero gain — the human commits the fingerprint anyway when they run `/server-upgrade` (its documented prerequisite). Counts are a transient nudge, not a durable artifact, so they need no stored reproducibility; anyone can rebuild them from the immutable archive spec. Announce-only-without-counts was rejected as the *primary* path (it nearly duplicates the existing `/catchup` signals banner) but kept as the graceful-degradation fallback when the spec fetch or a baseline fingerprint is unavailable, so the tracker still nudges rather than hard-failing.

**(b) Dedicated label + self-closing lifecycle** — the tracker issue carries `server-upgrade:tracker`, deliberately distinct from the `server-upgrade` label the Phase-3 filer puts on per-finding issues (reusing it would make the tracker's `gh issue list` collide with real findings). One persistent issue is found by label and edited in place each run, mirroring `docs-stale-tracker.yml`; the scheduled run itself closes it when `latest_stable == latest_acknowledged` — i.e. after a human runs `/done jellyfin-server-stable` post-triage. **(c) Stable-only, daily, read-only** — detection fetches the live latest *stable* (RCs excluded by `fetchJellyfinVersions`; they're tracked by the separate `jellyfin-server-rc` signal and never generate issues) and compares against `latest_acknowledged` read from the file, robust whether or not `/catchup` has refreshed `latest_upstream`. A daily scheduled run (not weekly: Jellyfin can ship more than one hotfix in a week) bounds detection latency to ≤1 day and is cheap because a caught-up run short-circuits to a version-compare before any fetch; the workflow is `issues: write` only and never touches the journals (`latest_upstream`/`last_checked` stay `/catchup`'s job). Builds on the `server-upgrade-anchor-strategy` decision (committed fingerprints as the deterministic anchor) and reuses `findings-candidates.js`'s exported committed-input readers so CI counts can't drift from a local `api-watch:findings` run.

## decision-id: server-upgrade-phase5-maturation

**date**: 2026-05-30
**status**: accepted
**related-files**: scripts/generate/findings-candidates.js, scripts/server-upgrade.js, scripts/server-upgrade-tracker.js, .claude/skills/server-upgrade/SKILL.md, docs/architecture/server-upgrade-automation.md

Phase 5 (maturation) lands two independent decisions. **(1) Coverage-symmetry advisory is a script-side check, defined as the exact complement of the backward floor-coverage check.** `symmetryFindings` in `findings-candidates.js` flags MODERN-ONLY endpoints (tier range excludes the floor, `minApiVersion > 1`) whose operation IS present in the floor spec — the mirror of `coverage-gap`, which flags floor-INCLUDED endpoints (`minApiVersion == 1`) ABSENT from the floor. The two branch on the same predicate (`rangeIncludes(min, max, floorTier)`), so they partition the manifest and can never double-report; a genuinely modern-only endpoint (absent from the floor — a real 10.9+ feature) is flagged by neither, which is how the check "accounts for intentionally-modern-only guarded features" mechanically. The candidate carries `change.kind: coverage-symmetry`, `type: symmetry-advisory`, `relevance: floor-symmetry`, `severityGuess: low`, joining by path+method+tier like `coverage-gap`. On the real committed manifest it fires on exactly one candidate — `GET /items`, served on the floor but gated to V2+ because the V1 dispatch branch uses the `/Users/{}/Items` sibling — the expected coarseness false-positive the agent dispositions via the unlinked sibling, exactly mirroring how it dispositions capability-guarded coverage-gaps. Rejected agent-only (edge case #7) because it gives no deterministic, fixture-testable seed; rejected path-level presence (broader, noisier) in favor of path+method precision.

**(2) Auto-file graduation: graduate nothing in Phase 5; lock what graduation MEANS.** No finding-class has an *observed* false-positive rate yet — the pipeline has filed zero issues — so graduating any class would be on faith, which the `server-upgrade-issue-filing` ratchet decision forbids. The mechanism was already wired in Phase 3 (`AUTO_FILE_CLASSES`, `isAutoFileEligible`, `autoFileEligible` per action), so graduation is a one-line config change, not a rewrite. Graduation MEANS relaxing the per-class batch-approval gate inside a human-run `/server-upgrade execute` (that class's `create` actions skip the Step-4 confirmation); it does NOT add an autonomous auto-file path to the Phase-4 CI tracker, which stays announce-only — the one fully-autonomous surface. Auto-filing a mechanically-derived candidate in CI *without* the agent's per-finding disposition would file precisely the false-positives the disposition exists to catch (coverage-gap's capability-guard coarseness, symmetry's unlinked sibling coarseness). The evidence bar (suggested ≥~8 filed in a class across ≥3 releases, FP rate <~10%) and the FP rate query — `gh issue list` keying on closed-as-`not_planned` per class — are documented in the design doc's "Graduation procedure" for a future maintainer; no measurement command was built because it would query an issue corpus that doesn't exist yet and couldn't be validated. `opportunity` is the natural first graduation candidate (an over-filed enhancement is low-harm); `coverage-gap` the worst; `symmetry-advisory` brand-new with no track record. None graduate today.

## decision-id: server-upgrade-phase6

**date**: 2026-05-30
**status**: accepted
**related-files**: scripts/server-upgrade.js, scripts/server-upgrade-tracker.js, .github/workflows/server-upgrade-tracker.yml, .claude/skills/server-upgrade/SKILL.md, docs/dev/jellyfin-endpoint-availability.yml, scripts/lib/endpoint-availability.cjs, scripts/lint/endpoint-availability-check.cjs, scripts/generate/findings-candidates.js, docs/architecture/server-upgrade-automation.md

Phase 6 lands two coupled decisions and **supersedes the per-finding-default part of `server-upgrade-issue-filing`** (its version-independent `findingKey` dedup, script-owned verdict template, and all-human-gated trust ratchet remain in force — only the "N per-finding issues per release" *default output* is replaced). **(1) Per-version release-triage digest, not a per-finding burst or a single rolling tracker.** CI auto-opens ONE digest issue per server version (`[server-upgrade] Jellyfin <v> — release triage`, label `server-upgrade:tracker`, matched by exact title); `/server-upgrade` edits it with the verdict checklist and files `file` verdicts as native GitHub **sub-issues** (the existing `findingKey` dedup; promotions are now opt-in, for work worth standalone tracking), inline-noting skip/monitor. Lifecycle (confirmed this session, load-bearing): `clean` (0 candidates touch us — judgment-free) → CI opens-then-closes the digest as a **persistent audit record** (the ONLY CI close; chosen over staying-silent because these records outlive GitHub Actions' 90-day logs); `triage` (≥1 candidate) → CI opens/refreshes until first triage (detected by the `server-upgrade:triaging` label the skill adds) then HANDS OFF; a candidate-bearing digest is closed only by a human/the skill — **Phase 4's close-on-caught-up is removed** because acknowledging a version ≠ doing the work. Digests stack per version as an audit trail; the close-plus-`/done` ritual prevents pile-up. Rejected stacking where each digest is a genuine superset of the prior with no floor split (the recurring floor findings would re-list on every digest) and predecessor-anchoring (doesn't help the anchor-independent floor findings; decouples the reviewed `acknowledged` baseline; touches Phase 1/2). Sub-issues over task-list cross-links because only native sub-issues give the auto-updating progress bar (cost: a `gh api .../sub_issues` call resolving the child db id; mocks cleanly in tests).

**(2) Endpoint-availability registry — a validated disposition ledger that resolves the recurring floor findings at the source.** An audit found the backward + symmetry checks fire on 5 standing floor findings every run (`MediaSegments` at 10.10, Lyrics at 10.9, `QuickConnect` probe + initiate at 10.8, the `GET /items` symmetry) — none are bugs (all version-guarded or graceful-404), yet they recur forever because the `V1`/`V2` two-tier model can't express sub-tier introduction versions and the AST tags each `[1, ∞)` (the decisive proof: `MediaSegments` has a real `supportsMediaSegments()` guard and *still* flagged, because the guard is in Layer 2, not an `ApiClient` version branch). The committed [`jellyfin-endpoint-availability.yml`](dev/jellyfin-endpoint-availability.yml) records each post-floor endpoint's old-server `handling`; `applyFloorAvailability` marks a registered finding `floor-known` / `needsInvestigation:false` (stays in the report as audit trail, distinct from suppression). Rejected blunt `suppressions.yml` muting because it would HIDE a regression (a deleted guard → a real 404) — instead `endpoint-availability-check.cjs` (npm `lint:endpoint-availability`, in the main lint chain) validates each entry's CODE claim (guard symbol exists in source; dispatch-sibling is a floor-tier manifest endpoint; no dead entries), so a removed guard FAILS CI and resurfaces the finding. The spec-derived floor check stays the comprehensive ENUMERATOR — an unregistered post-floor endpoint keeps flagging `needsInvestigation`, so the docs need not be comprehensive and a new one can't hide. Reconciles with `apiVersion tiers inferred, not hand-listed`: the manifest stays purely inferred from the AST; the ledger is a separate, hand-maintained-but-CI-validated input to the floor check, never written into the manifest. Rejected finer manifest tiers / adding app-code guards to the 3 graceful endpoints (would change `QuickConnect`'s deliberate fail-open + need hardware testing — out of scope for a tooling-only PR; a followup tracks a proactive PR-time floor lint).

## decision-id: multichannel-audio-fallback-codec

**date**: 2026-06-03
**status**: accepted
**related-files**: source/api/items.bs, source/utils/deviceCapabilities.bs

When `optimizeAudioCodecListForSource` would strip every codec from a video transcoding profile's `AudioCodec` list for a multichannel (>2ch) source, it leads the list with the user's `playbackPreferredMultichannelCodec` (default `eac3`) rather than falling back to stereo `aac` (PR #574's first approach, for issue #573). The empty-list condition only ever fires on a passthrough device playing surround content, so `aac` — a stereo-output codec the optimizer exists to strip — merely avoids the crash while abandoning the bitstream surround path the hardware was set up for; a surround codec preserves it. The same logic also rescues the `truehd,opus` mp4 shape, which the server otherwise resolves to `opus` (an on-device-decode path, not bitstream surround).

The fallback is clamped to `{eac3, ac3}`. `dts` is excluded even though the setting offers it: the Jellyfin server emits no audio stream for a `dts` transcode target (its ffmpeg encoder is experimental — verified via `/Items/{id}/PlaybackInfo` probes against 10.11), so a `dts` fallback would itself re-trigger the empty-`AudioCodec` → `m3u8` server fallback that is issue #573. Both `eac3` and `ac3` are valid HLS audio targets in every video transcoding container (ts and mp4), so no per-container clamp is needed. Ruled out: the `aac` fallback (preserves no surround); honoring `dts` literally (unencodeable, re-triggers the bug).

## decision-id: non-pool-http-stays-task-blocking

**date**: 2026-06-06
**status**: accepted
**related-files**: components/tasks/FontDownloadTask.bs, components/captionTask.bs, components/config/ServerDiscoveryTask.bs, source/api/apiPromise.bs

Resolves item **(c)** of the `two-async-model-split` tech-debt slug (the closed #551 promises umbrella): the three non-pool HTTP consumers — `FontDownloadTask` (fallback-font download), `captionTask` (VTT fetch), `ServerDiscoveryTask` (SSDP/client-discovery) — **stay as blocking Tasks**; JellyRock will **not** build a generic `roUrlTransfer`→promise wrapper distinct from the Jellyfin-pool `fetchAsync`. This is decided **now and independently** of the async/await trigger that governs the rest of the slug: items (a)/(b) are about render-thread/Task convergence over the pool, but these three are Task-thread datagram/binary/time-budgeted flows that `await fetchAsync` over the pool never touches, so they don't ride that re-open.

Three reasons the wrapper has no payload. **(1) Wrong layer.** All three run on Task threads; `fetchAsync` is render-thread-only by design (its named-function `observeField` bridge only dispatches on the render thread), and Option A (`promise-native-interface-fetchres-exception`) deliberately keeps Task threads on blocking I/O. A wrapper would be a *second* async vocabulary — the rarely-needed `setMessagePort`/`wait2` dialect — exactly the fragmentation #551 set out to remove. **(2) Regression risk.** `captionTask` deliberately uses raw `roUrlTransfer` + `port.WaitMessage()` *specifically to avoid touching the shared `m` AA (unsynchronized across threads)* — `rr_Requests`' busy-poll raced the render thread's 100 ms caption timer and caused the `&hf3` crash. A promise wrapper reintroduces the registry-on-`m` + observer machinery that fix removed. **(3) Nothing to share.** The shapes don't rhyme: fonts = linear blocking probes + a binary `GetToFile` to disk the pool can't model; captions = single fetch + ContentNode bridge delivery; SSDP = `roDatagramSocket` multicast + a time-budgeted parallel `roUrlTransfer` fan-out. And none fit the auto-abandon plugin, which keys off `fetchAsync` in render-thread `onDestroy`. A wrapper would be either too thin to matter or a forced mold over three dissimilar flows, shipping a second async surface with no cancellation story for zero DX gain. Ruled out: a shared wrapper (above); per-consumer wrappers (strictly worse — three new surfaces, same crash risk, max vocabulary sprawl).

## decision-id: promise-native-interface-fetchres-exception

**date**: 2026-06-05
**status**: accepted
**related-files**: source/api/apiPool.bs, source/api/ApiClient.bs, source/main.bs, components/tasks/QuickPlayTask.bs

For the `@rokucommunity/promises` adoption (issue #551), a `Promise` becomes the universal async **return type / interface** across the app, layered over the *existing* task-pool engine — the pool, `ApiQueueTask` coordinator, children-as-vehicles coalescing dodge, and ready-cascade are kept unchanged; only the calling convention is replaced. Blocking `fetchRes` is deliberately **retained** as a documented exception for (a) the bootstrap path (login / server-discovery, before the pool is up) and (b) linear/branching task-internal control-flow sequences; `promises.all()` is used when parallelism actually helps. This is **Option A**, chosen over full "promises everywhere / single-model" (Option B). Rationale: branching task orchestrators read *worse* flattened onto `.then` chains — the decisive evidence is `QuickPlayTask.doSeries`, a 3-branch resume→next-up→shuffle tree that a flat chain can only express by threading `context.satisfied` guard flags through every stage; and rewriting hot, working orchestrators (`QuickPlayTask` ~32 fetch calls, `LoadItemsTask` ~22, `items.bs`) into `wait2` promise-loops is pure regression risk on the app's hottest paths for *negative* readability. Task threads can block safely (unlike the render thread), so blocking is Roku-idiomatic there. The render-thread god-loop (`main.bs` observer spaghetti) and the bespoke-Task-per-fetch boilerplate — the *actual* DX problems — are fixed identically under both options, so Option A concedes nothing that matters.

**Re-evaluation trigger / long-term north star:** full promises-everywhere single-model convergence becomes the right call once BrighterScript **async/await** (which `@rokucommunity/promises` underpins, per its README) is production-ready — `await fetchAsync(...)` restores native linear/branching readability *with* the promise model, at which point the one dimension Option A wins on disappears and the two-model split is no longer justified. Re-open this decision when BS async/await lands. The deliberate two-model split should also be filed as a `tech-debt.md` entry (with real code anchors) when the foundation PR ships, carrying this same re-open trigger.

## decision-id: auto-abandon-promises-bsc-plugin

**date**: 2026-06-05
**status**: accepted
**related-files**: scripts/bsc-plugins/auto-abandon-promises.cjs, source/api/apiPromise.bs, components/JRScreen.bs, components/JRGroup.bs, bsconfig.json, bsconfig-prod.json, bsconfig-analysis.json

Implements the **cancellation half of decision #6** in `promise-native-interface-fetchres-exception` (a pending `fetchAsync` promise must never fire a callback into a destroyed node). The original adoption plan assumed cancellation could ride a base-class `onDestroy` hook inherited via `super`. That premise is **false in this codebase**: SceneGraph component `onDestroy` does NOT chain to a base — `SceneManager` tears down via `group.callFunc("onDestroy")`, which dispatches to the most-derived `onDestroy`, and a grep confirms *zero* subclasses call `super.onDestroy()`. A base-class-only abandon hook is therefore dead code for every screen that overrides `onDestroy` (essentially all of them). The established, plugin-enforced convention here is explicit per-component teardown, not inheritance.

Chosen mechanism: a BSC plugin (`auto-abandon-promises.cjs`, modeled on `roku-log.cjs`'s transpile-time injection) that **injects** `abandonApiPromises()` as the first statement of `onDestroy()` in any codebehind that calls `fetchAsync` (idempotent), and **errors** at build time (severity 1, `bsc-disable-file` escape hatch) when a *component* codebehind calls `fetchAsync` but declares no `onDestroy` to inject into. This makes abandon impossible to forget (mechanical, not opt-in) and impossible to ship broken (the leak is a hard build error). Wired into `bsconfig`/`-prod`/`-analysis` only (same configs as `roku-log`; test configs deliberately exclude transforming plugins). A readable floor in base `JRScreen.bs`/`JRGroup.bs onDestroy` covers the rare non-overriding components. Ruled out: (a) per-`onDestroy` manual call — relies on dev discipline, the exact thing the plugin removes; (b) centralized `SceneManager` sweep — misses `JRGroup` panels/dialogs torn down by their parent rather than `SceneManager`, and adds a new coordination mechanism. Trade-off accepted: the injected call is invisible in source (same property as `roku-log`), mitigated by the Vitest suite `tests/scripts/unit/bsc-plugins/auto-abandon-promises.test.js`.

## decision-id: server-upgrade-anchor-vs-resolved-decoupling

**date**: 2026-06-07
**status**: accepted
**related-files**: scripts/server-upgrade.js, scripts/server-upgrade-tracker.js, scripts/catchup-state.js, scripts/lib/signal-staleness.cjs, .github/workflows/server-upgrade-tracker.yml, docs/architecture/server-upgrade-automation.md, docs/signals-backlog.md

The `jellyfin-server-stable` row's `latest_acknowledged` was conflating two roles that diverge once releases auto-resolve clean ([#632](https://github.com/jellyrock/jellyrock/issues/632)): the **diff anchor** (`from` version `computeReport` diffs against — must have a committed fingerprint, and is *safer* the wider it is since the diff is point-to-point) and the **review cursor** that drives the `/catchup` "needs attention" nag. A mechanically-clean release auto-closes its per-version digest **without** bumping `latest_acknowledged` (CI never writes the journals — `journal-sync.yml` is the sole automated journal writer), so the anchor legitimately trails the newest release; the digest then mislabeled itself as a stale "Acknowledged baseline" and `/catchup` false-nagged forever after every clean release.

Chosen: keep the anchor **frozen** at the last *deep* review (a real `/server-upgrade` triage, which commits a fresh fingerprint + bumps the row) and **derive** "resolved-through" from the digest issues instead of persisting it — the tracker renders a `Mechanically cleared through <X>` line (`clearedThroughFrom()` over the digest list passed via `--tracker-issues`; the header row was renamed `Diff baseline (last full review)`), and `/catchup` staleness for this one row becomes "is there an OPEN `server-upgrade:tracker` digest?" (`signalStaleness()` in `scripts/lib/signal-staleness.cjs`, fed by a one-shot `gh` query; offline → string-compare fallback). Ruled out: **full auto-acknowledge** (CI commits the machine-built fingerprint + bumps the row) — it introduces a silent, self-perpetuating baseline-corruption path (a transient/partial spec fetch → false "clean" → bad fingerprint baked in as the trusted anchor → a real future break compared against bad data), crosses the "CI never writes journals" and "committed fingerprint = a human reviewed it" invariants, and buys only a cosmetically-tidier file value. The derived model can only render the wrong banner (visible, self-correcting); it can never cause a missed break.

## decision-id: global-signin-language

**date**: 2026-06-07
**status**: accepted
**related-files**: source/utils/translateLocale.bs, settings/settings.json, components/data/jellyfin/JellyfinUserSettings.xml, components/settings/settings.bs

The per-user `translationLocale` override is only read post-login, so the pre-login server-select / user-select screens always fell back to the Roku device locale — a French-preferring user on an English Roku saw English sign-in screens, then a French app. Fix: a **separate** device-wide global setting `globalTranslationLocale` ("Sign-in Screen Language"), not a promotion of `translationLocale` to global nor an invisible mirror of it. It auto-routes to the `JellyRock` registry section via the existing `global*`-prefix observer and is read at bootstrap via `getSetting` (works with no signed-in user). Separate-over-promote because a bilingual household keeps the shared sign-in screens in one language while each user still picks their own post-login language.

Precedence in `resolveTranslationLocale()`: pre-login = `globalTranslationLocale` → device locale → `en_US`; post-login is **unchanged from before this setting** — per-user `translationLocale` → server `CustomPrefs.language` → device locale → `en_US` (the global tier is **skipped** post-login). The global setting is strictly a pre-login lever: a signed-in user's session must never inherit the device-wide sign-in default. (An early build let the global tier fall through post-login, so a user whose own setting was Automatic saw their home screen follow the global sign-in language — wrong; fixed to pre-login-only.) The Settings picker deliberately does **not** live-reload the current session when the global setting changes (that would re-theme the home screen the user is on); instead the pre-login locale is re-resolved at the `appStart` login-flow entry, so the change applies on the next Sign Out / Change User **without a full app restart**. Ruled out: (a) promote `translationLocale` to global — simpler but drops the per-user override and needs a registry migration; (b) single picker + invisible global mirror — fewer controls but couples the sign-in default to last-user-pick and needs a dual-write the observer doesn't do today.

## decision-id: rta-functional-tests-vitest

**date**: 2026-06-08
**status**: accepted
**related-files**: tests/rta/screens.js, tests/rta/lib/nav.js, tests/rta/specs/screens.spec.js, vitest.rta.config.js, scripts/capture-screenshots.js, docs/dev/rta-tests.md

RTA functional tests live in a Node/Vitest layer (`tests/rta/`) that drives a real device from outside via `roku-test-automation` (ECP key presses + ODC Scene Graph queries), **not** Rooibos. Rooibos is BrightScript compiled into the app and asserts in-process — right for unit/integration, but end-to-end screen navigation + screenshots must drive the real app externally, which is the RTA model. So `tests/rta/` is Node/ESM (outside `tests/source/**`, which is compiled into the app) under a dedicated `vitest.rta.config.js` (serial single-fork, long timeouts, a `globalSetup` that deploys the `ENABLE_RTA` build once). Chose **Vitest** (already powers `tests/scripts/`; free reporting/watch/filtering/CI) over a custom Node runner (reinvents all of that) and over the RTA `Suitest` wrapper (extra abstraction, weaker Vitest/CI integration).

A single screen registry (`tests/rta/screens.js`) is the source of truth for both the functional tests and the store-screenshot generator: each screen declares how to reach it and how to assert it loaded; the navigation steps' `waitFor` gates double as the assertions. Screenshots are a thin layer on top — `RTA_CAPTURE=1` dumps raw UI for GUI viewing, and `scripts/capture-screenshots.js` adds the locale matrix + the ffmpeg OSD backdrop + the manifest. Store screenshots use the **prod** build (release branding); the RTA deploy-time `ENABLE_RTA` manifest flip is build-flavor-agnostic (verified prod keeps the `#if` passthrough), so prod works with RTA. Closed off: Rooibos for end-to-end, a custom runner, `Suitest`, and the empty `tests/source/e2e/` placeholder (removed; its `e2e-folder-empty` tech-debt resolved).
