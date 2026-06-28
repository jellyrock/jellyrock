---
name: dep-major
description: Walk a MAJOR dependency-version bump (a Renovate major PR — possibly a GROUPED one carrying several deps — or a package you name) through JellyRock's major-bump SOP so the judgment steps run the same way every time. Resolves each package + from→to version range, fetches the upstream changelog/migration guide for that range, classifies the breaking changes, greps the codebase for the call sites those breaks actually hit, runs the mechanical gate that fits the dependency's TYPE (runtime BrightScript lib → validate/build/lint:bs + on-device test:unit/test:rta; JS/Node tooling → test:scripts + run the affected script; GitHub Actions → the PR's own CI plus a trace of the conditional paths CI doesn't exercise), and returns a go/no-go with any required migration surfaced (and applied on request). Majors never automerge (Renovate org policy), so this is the human-review path. Use when a Renovate major PR appears, or before bumping a dependency's major version by hand. NOT for patch/minor bumps (those automerge after soak) or for Jellyfin SERVER releases (use /server-upgrade).
model: opus
user-invocable: true
allowed-tools: Bash(gh pr view:*), Bash(gh pr diff:*), Bash(gh pr checks:*), Bash(gh run view:*), Bash(gh api:*), Bash(gh release view:*), Bash(gh release list:*), Bash(git checkout:*), Bash(git switch:*), Bash(git log:*), Bash(git diff:*), Bash(git status:*), Bash(git rev-parse:*), Bash(npm run validate:*), Bash(npm run build:*), Bash(npm run lint:bs:*), Bash(npm run test:unit:*), Bash(npm run test:rta:*), Bash(npm run test:scripts:*), Bash(npm install:*), Bash(npm view:*), Bash(node:*), Bash(curl:*), Bash(date:*), Bash(ls:*), Read, Grep, Glob, WebFetch, Edit
---

# /dep-major `<PR# | package>` — walk a major dependency bump through the SOP

Majors never automerge under the org Renovate policy (see `renovate/README.md` in
`jellyrock/.github`) — a major is always human-reviewed because a breaking change
can pass a green build and still break at runtime. This skill makes that review
**consistent**: the model does the judgment (read the changelog, decide which
breaks hit us, propose the migration); the mechanical gate is the existing npm
scripts, not re-implemented here.

Scope: one major-bump PR. That's usually one dependency, but a Renovate **grouped** PR can carry several at once (e.g. the `GitHub Actions` or `brighterscript` groups — checkout v7 + cache v6 landed in a single PR). Treat each dependency in the group as its own review (Steps 2–3 per dep), then run the gate (Step 4) once over the combined branch. NOT patch/minor (those automerge after soak), NOT Jellyfin server releases (that's [`/server-upgrade`](../server-upgrade/SKILL.md)).

## Step 1 — Resolve the bump (package + from→to)

From `$ARGUMENTS`:

- **A PR number** (Renovate major PR): `gh pr view <N> --json title,headRefName,body,url`. Parse the package name and the from→to versions from the title (Renovate titles read like `Update dependency X to vN` or `chore(deps): update X to N.0.0`) and/or `gh pr diff <N> -- package.json` to read the exact `"x": "A" → "B"` line. Capture the branch name (`headRefName`) — Step 4 checks it out.
- **A package name** (manual bump): read the current pinned version from [`package.json`](../../../package.json); resolve the latest with `npm view <pkg> version`. The from→to is current→latest. There is no Renovate branch in this path — Step 4 applies the bump locally instead.

Confirm it's actually a MAJOR bump (first semver segment increases, or for `0.x` the second segment — those are breaking-by-convention). If it's only patch/minor, stop and say so: those ride the automerge policy; this skill is for majors. Record `pkg`, `fromVer`, `toVer`, and (if any) `branch`.

## Step 2 — Fetch the upstream changelog / migration guide for the range

Find the changelog for the `fromVer..toVer` range. In order of preference:

1. The PR body — Renovate embeds a "Release Notes" section with per-version notes; read it first (`gh pr view <N> --json body`).
2. The upstream repo's `CHANGELOG.md` (most rokucommunity / npm packages keep one). Resolve the repo from `npm view <pkg> repository.url`, then `gh api repos/<owner>/<repo>/contents/CHANGELOG.md --jq .content | base64 -d` and read the entries between `fromVer` and `toVer`.
3. GitHub Releases: `gh release list --repo <owner>/<repo>` + `gh release view <tag> --repo <owner>/<repo>` for each major tag in range.
4. Fallback: `WebFetch` the package's npm page or docs site.

Summarize the **breaking changes** in the range only (ignore features/fixes unless they change behavior we rely on). For each breaking change capture: the symbol/API affected, what changed, and the migration the upstream prescribes.

## Step 3 — Map the breaks to OUR call sites

For each breaking change, grep the codebase for where we actually use the affected API:

- For BrightScript libs (ropm-vendored, e.g. `sgRouter`, `promises`, `roku-log`): grep `source/` and `components/` for the namespace/component (`sgrouter.`, `sgrouter_`, `promises.`, etc.).
- For dev tooling (e.g. `brighterscript`, `vitest`, `rooibos`, `roku-deploy`): grep `scripts/`, `bsconfig*.json`, `*.config.js`, `tests/`, and `package.json` script invocations.

Produce a concrete list: **break → our affected files (file:line) → required change** — or "not used here" when a flagged break doesn't touch our code. This is the core judgment output; be specific, cite lines.

## Step 4 — Run the mechanical gate that fits the dependency's TYPE

There is no single gate. The BrightScript build (`validate`/`build`/`lint:bs`) only exercises a dep that the app actually compiles or bundles — for a GitHub Action or a Node-only script dep it runs green while touching nothing the bump changed, which is worse than no gate because it *looks* like coverage. **Pick the gate by what actually executes the dependency.** Reuse the existing npm scripts; do NOT re-implement them.

Get the new version into the tree first:

- **PR path**: `git switch <branch>` (the Renovate branch already bumped `package.json` + lockfile). Run `npm install` so `roku_modules` regenerates for vendored libs. (GitHub Actions live in `.github/workflows/*.yml`, not `package.json` — there's nothing to install; the bump is the SHA edit already on the branch.)
- **Manual path**: bump the version in `package.json` to `toVer` and `npm install`.

Then run the matching gate:

- **Runtime BrightScript lib** (ropm-vendored, bundled into the `.zip` — `@rokucommunity/bslib`, `roku-log`, `roku-requests`, …): `npm run validate` (bsc --noEmit, catches removed/renamed symbols), then `npm run build`, then `npm run lint:bs`. Then **if a Roku is reachable** (ROKU_IP in `.env`; probe `curl -s -m4 http://$ROKU_IP:8060/query/device-info`): `npm run test:unit` + `npm run test:rta` — for a bundled runtime lib the device run is the real signal, a clean build is not enough. **If no device is reachable, say so explicitly** — do not imply the runtime gate passed.
- **BrightScript build/lint tooling** (`brighterscript`, `brighterscript-formatter`, `@rokucommunity/bslint`, `ropm`, `roku-deploy`, `rooibos-roku`): `npm run validate` + `npm run build` + `npm run lint:bs` + `npm run check-formatting:bs` — these ARE the dependency under test, so the build gate is the right one. A formatter/linter major commonly reformats or re-flags the tree (expected); apply `npm run format` and review the diff.
- **JS/Node script tooling** (`vitest`, `js-yaml`, `ajv`, `eslint`, `prettier`, `sharp`, `fast-glob`, …, used by `scripts/`): `npm run test:scripts` (vitest — the scripts' own suite), and then **actually run the affected script(s)** against real inputs (the call sites Step 3 found). The BrightScript build never imports these, so `validate`/`build` prove nothing here.
- **GitHub Actions** (`actions/*` in workflow YAML): there is no local npm gate — the action only runs inside CI. The gate is **the PR's own CI run** (`gh pr checks <N>`), PLUS Step 4b below, because a workflow's green CI often does NOT exercise the path the bump changed.

### Step 4b — Did the gate actually exercise the change? (latent-break check)

A green gate only counts if it ran the code the bump touched. Before declaring GO, name at least one path the bump changes and confirm the gate hit it — major bumps habitually change a **conditional** path that the PR's own CI never runs:

- **fork-PR-only / `pull_request_target` / `workflow_run`** steps (a Renovate branch is same-repo, so its CI never takes the fork path — e.g. checkout v7's fork-PR-checkout block fired only for outside contributors, invisible on the bump's own green run).
- **scheduled-only / release-only / device-only** jobs that don't run on a PR.
- **empty / missing / edge inputs** (e.g. js-yaml v5 throws on empty input where v4 returned `undefined` — a `?? {}` site won't catch it; the happy-path test never feeds empty).

If such a path exists and the gate didn't cover it, treat the change as **unverified** (latent break) — reason it through from the changelog and call it out, don't let the green tick stand in for coverage it doesn't have.

Report each step's result. A red gate — or an unverified latent path — is a no-go until the migration in Step 5 resolves it.

## Step 5 — Verdict + migration

Emit a **go / no-go** with the SOP checklist ticked:

- [ ] Changelog read for the full `fromVer..toVer` range (every dep, if the PR is grouped)
- [ ] Breaking changes mapped to our call sites (or confirmed not-used)
- [ ] The type-appropriate gate (Step 4) ran green — and Step 4b confirms it actually exercised the change (no uncovered latent path), or the latent path is reasoned through and flagged
- [ ] device test:unit + test:rta green where applicable (or explicitly N/A — no device / not a runtime BS lib)
- [ ] required migration applied in the branch (if any)

If a migration is needed and the user approves, apply it with `Edit` on the affected files (cite the changelog rationale), then re-run the relevant gate step to confirm green. Leave the merge itself to the user — this skill reviews and prepares; it does not merge.

If anything was deferred (e.g. device run couldn't happen), capture it via [`/log followup`](../log/SKILL.md) so it isn't lost.

## When NOT to use

- Patch/minor bumps → they automerge after soak; no skill needed.
- Jellyfin server releases → [`/server-upgrade`](../server-upgrade/SKILL.md).
- A brand-new dependency (not a version bump) → add it deliberately; this skill assumes an existing dep moving major.
