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

Phase 4's proactive-CI tracker (`server-upgrade-tracker.js` + `server-upgrade-tracker.yml`) is the pipeline's one fully-autonomous surface: a weekly workflow that maintains ONE tracker issue nudging a human to run `/server-upgrade`. It never files per-finding issues (that stays human-gated behind `/server-upgrade execute`) and never writes the repo or the journals. Three choices lock its shape. **(a) Counts from an ephemeral in-CI fingerprint, never committed** — the tracker's candidate counts need the `<to>` (latest) fingerprint, normally a committed, drift-gated, *reviewed* anchor. Rather than auto-commit it, the workflow builds it in memory from the fetched spec and runs the Phase-2 `buildReport` against the committed `from`/`floor` fingerprints. Auto-commit was rejected because committing a fingerprint for a version nobody has triaged decouples the "committed fingerprint = reviewed anchor" invariant (the drift gate exists precisely so a committed fingerprint means a human reviewed it) and would need push/token/concurrency plumbing for zero gain — the human commits the fingerprint anyway when they run `/server-upgrade` (its documented prerequisite). Counts are a transient nudge, not a durable artifact, so they need no stored reproducibility; anyone can rebuild them from the immutable archive spec. Announce-only-without-counts was rejected as the *primary* path (it nearly duplicates the existing `/catchup` signals banner) but kept as the graceful-degradation fallback when the spec fetch or a baseline fingerprint is unavailable, so the tracker still nudges rather than hard-failing.

**(b) Dedicated label + self-closing lifecycle** — the tracker issue carries `server-upgrade:tracker`, deliberately distinct from the `server-upgrade` label the Phase-3 filer puts on per-finding issues (reusing it would make the tracker's `gh issue list` collide with real findings). One persistent issue is found by label and edited in place each run, mirroring `docs-stale-tracker.yml`; the scheduled run itself closes it when `latest_stable == latest_acknowledged` — i.e. after a human runs `/done jellyfin-server-stable` post-triage. **(c) Stable-only, weekly, read-only** — detection fetches the live latest *stable* (RCs excluded by `fetchJellyfinVersions`; they're tracked by the separate `jellyfin-server-rc` signal and never generate issues) and compares against `latest_acknowledged` read from the file, robust whether or not `/catchup` has refreshed `latest_upstream`. A weekly scheduled run bounds detection latency to ≤7 days for a ~monthly upstream; the workflow is `issues: write` only and never touches the journals (`latest_upstream`/`last_checked` stay `/catchup`'s job). Builds on the `server-upgrade-anchor-strategy` decision (committed fingerprints as the deterministic anchor) and reuses `findings-candidates.js`'s exported committed-input readers so CI counts can't drift from a local `api-watch:findings` run.

## decision-id: server-upgrade-phase5-maturation

**date**: 2026-05-30
**status**: accepted
**related-files**: scripts/generate/findings-candidates.js, scripts/server-upgrade.js, scripts/server-upgrade-tracker.js, .claude/skills/server-upgrade/SKILL.md, docs/architecture/server-upgrade-automation.md

Phase 5 (maturation) lands two independent decisions. **(1) Coverage-symmetry advisory is a script-side check, defined as the exact complement of the backward floor-coverage check.** `symmetryFindings` in `findings-candidates.js` flags MODERN-ONLY endpoints (tier range excludes the floor, `minApiVersion > 1`) whose operation IS present in the floor spec — the mirror of `coverage-gap`, which flags floor-INCLUDED endpoints (`minApiVersion == 1`) ABSENT from the floor. The two branch on the same predicate (`rangeIncludes(min, max, floorTier)`), so they partition the manifest and can never double-report; a genuinely modern-only endpoint (absent from the floor — a real 10.9+ feature) is flagged by neither, which is how the check "accounts for intentionally-modern-only guarded features" mechanically. The candidate carries `change.kind: coverage-symmetry`, `type: symmetry-advisory`, `relevance: floor-symmetry`, `severityGuess: low`, joining by path+method+tier like `coverage-gap`. On the real committed manifest it fires on exactly one candidate — `GET /items`, served on the floor but gated to V2+ because the V1 dispatch branch uses the `/Users/{}/Items` sibling — the expected coarseness false-positive the agent dispositions via the unlinked sibling, exactly mirroring how it dispositions capability-guarded coverage-gaps. Rejected agent-only (edge case #7) because it gives no deterministic, fixture-testable seed; rejected path-level presence (broader, noisier) in favor of path+method precision.

**(2) Auto-file graduation: graduate nothing in Phase 5; lock what graduation MEANS.** No finding-class has an *observed* false-positive rate yet — the pipeline has filed zero issues — so graduating any class would be on faith, which the `server-upgrade-issue-filing` ratchet decision forbids. The mechanism was already wired in Phase 3 (`AUTO_FILE_CLASSES`, `isAutoFileEligible`, `autoFileEligible` per action), so graduation is a one-line config change, not a rewrite. Graduation MEANS relaxing the per-class batch-approval gate inside a human-run `/server-upgrade execute` (that class's `create` actions skip the Step-4 confirmation); it does NOT add an autonomous auto-file path to the Phase-4 CI tracker, which stays announce-only — the one fully-autonomous surface. Auto-filing a mechanically-derived candidate in CI *without* the agent's per-finding disposition would file precisely the false-positives the disposition exists to catch (coverage-gap's capability-guard coarseness, symmetry's unlinked sibling coarseness). The evidence bar (suggested ≥~8 filed in a class across ≥3 releases, FP rate <~10%) and the FP rate query — `gh issue list` keying on closed-as-`not_planned` per class — are documented in the design doc's "Graduation procedure" for a future maintainer; no measurement command was built because it would query an issue corpus that doesn't exist yet and couldn't be validated. `opportunity` is the natural first graduation candidate (an over-filed enhancement is low-harm); `coverage-gap` the worst; `symmetry-advisory` brand-new with no track record. None graduate today.
