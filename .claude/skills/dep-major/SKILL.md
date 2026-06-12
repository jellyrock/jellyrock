---
name: dep-major
description: Walk a MAJOR dependency-version bump (a Renovate major PR, or a package you name) through JellyRock's major-bump SOP so the judgment steps run the same way every time. Resolves the package + from→to version range, fetches the upstream changelog/migration guide for that range, classifies the breaking changes, greps the codebase for the call sites those breaks actually hit, runs the existing mechanical gate (validate + build + lint:bs, and on-device test:unit + test:rta when a Roku is reachable), and returns a go/no-go with any required migration surfaced (and applied on request). Majors never automerge (Renovate org policy), so this is the human-review path. Use when a Renovate major PR appears, or before bumping a dependency's major version by hand. NOT for patch/minor bumps (those automerge after soak) or for Jellyfin SERVER releases (use /server-upgrade).
model: opus
user-invocable: true
allowed-tools: Bash(gh pr view:*), Bash(gh pr diff:*), Bash(gh api:*), Bash(gh release view:*), Bash(gh release list:*), Bash(git checkout:*), Bash(git switch:*), Bash(git log:*), Bash(git diff:*), Bash(git status:*), Bash(git rev-parse:*), Bash(npm run validate:*), Bash(npm run build:*), Bash(npm run lint:bs:*), Bash(npm run test:unit:*), Bash(npm run test:rta:*), Bash(npm install:*), Bash(npm view:*), Bash(node:*), Bash(curl:*), Bash(date:*), Bash(ls:*), Read, Grep, Glob, WebFetch, Edit
---

# /dep-major `<PR# | package>` — walk a major dependency bump through the SOP

Majors never automerge under the org Renovate policy (see `renovate/README.md` in
`jellyrock/.github`) — a major is always human-reviewed because a breaking change
can pass a green build and still break at runtime. This skill makes that review
**consistent**: the model does the judgment (read the changelog, decide which
breaks hit us, propose the migration); the mechanical gate is the existing npm
scripts, not re-implemented here.

Scope: a single major bump of ONE dependency. NOT patch/minor (those automerge
after soak), NOT Jellyfin server releases (that's [`/server-upgrade`](../server-upgrade/SKILL.md)).

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

## Step 4 — Run the mechanical gate

Get the new version into the tree, then run the existing gate (do NOT re-implement it):

- **PR path**: `git switch <branch>` (the Renovate branch already bumped `package.json` + lockfile). Run `npm install` so `roku_modules` regenerates for vendored libs.
- **Manual path**: bump the version in `package.json` to `toVer` and `npm install`.

Then, in order, reusing the npm scripts:

1. `npm run validate` (bsc --noEmit) — catches removed/renamed symbols at compile time.
2. `npm run build` — full transpile.
3. `npm run lint:bs`.
4. **If a Roku device is reachable** (ROKU_IP in `.env`; probe `curl -s -m4 http://$ROKU_IP:8060/query/device-info`): `npm run test:unit` and `npm run test:rta`. For a runtime BS lib bundled into the app (the riskiest majors), the device run is the real signal — a clean build is not enough. **If no device is reachable, say so explicitly** — do not imply the runtime gate passed.

Report each step's result. A red gate = no-go until the migration in Step 5 makes it green.

## Step 5 — Verdict + migration

Emit a **go / no-go** with the SOP checklist ticked:

- [ ] Changelog read for the full `fromVer..toVer` range
- [ ] Breaking changes mapped to our call sites (or confirmed not-used)
- [ ] validate + build + lint green
- [ ] device test:unit + test:rta green (or explicitly N/A — no device)
- [ ] required migration applied in the branch (if any)

If a migration is needed and the user approves, apply it with `Edit` on the affected files (cite the changelog rationale), then re-run the relevant gate step to confirm green. Leave the merge itself to the user — this skill reviews and prepares; it does not merge.

If anything was deferred (e.g. device run couldn't happen), capture it via [`/log followup`](../log/SKILL.md) so it isn't lost.

## When NOT to use

- Patch/minor bumps → they automerge after soak; no skill needed.
- Jellyfin server releases → [`/server-upgrade`](../server-upgrade/SKILL.md).
- A brand-new dependency (not a version bump) → add it deliberately; this skill assumes an existing dep moving major.
