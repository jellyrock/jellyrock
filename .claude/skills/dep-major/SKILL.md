---
name: dep-major
description: Walk a major dependency-version bump (a Renovate major PR, possibly a grouped one carrying several deps, or a package you name) through JellyRock's major-bump SOP so the judgment steps run the same way every time. Resolves each package and its from and to versions, fetches the upstream changelog/migration guide for that range, classifies the breaking changes, greps the codebase for the call sites those breaks actually hit, runs the mechanical gate that fits the dependency's type (a runtime BrightScript lib: validate, build, lint:bs, then test:unit and test:rta on a device; JS or Node tooling: test:scripts, then run the affected script; GitHub Actions: the PR's own CI plus a trace of the conditional paths CI doesn't exercise), and returns a go/no-go with any required migration surfaced (and applied on request). Majors never automerge (the org Renovate config), so this is the human-review path. Use when a Renovate major PR appears, or before bumping a dependency's major version by hand. Not for patch or minor bumps (those automerge after a soak) or for Jellyfin server releases (use /server-upgrade).
model: opus
user-invocable: true
allowed-tools: Bash(gh pr view:*), Bash(gh pr diff:*), Bash(gh pr checks:*), Bash(gh run view:*), Bash(gh api:*), Bash(gh release view:*), Bash(gh release list:*), Bash(git checkout:*), Bash(git switch:*), Bash(git log:*), Bash(git diff:*), Bash(git status:*), Bash(git rev-parse:*), Bash(npm run validate:*), Bash(npm run build:*), Bash(npm run lint:bs:*), Bash(npm run test:unit:*), Bash(npm run test:rta:*), Bash(npm run test:scripts:*), Bash(npm install:*), Bash(npm view:*), Bash(node:*), Bash(curl:*), Bash(date:*), Bash(ls:*), Read, Grep, Glob, WebFetch, Edit
---

# `/dep-major <PR# | package>`: walk a major dependency bump through the SOP

Majors never merge automatically under the org Renovate config (`renovate/default.json` in `jellyrock/.github`, which this repo's `renovate.json` extends): a major is always reviewed by a person, because a breaking change can pass a green build and still break at runtime. This skill makes that review **consistent**: the model does the judgment (read the changelog, decide which breaks hit us, propose the migration), and the mechanical gate is the existing npm scripts, not a copy of them.

Scope: one major-bump PR. That is usually one dependency, but a Renovate **grouped** PR can carry several: the groups in this repo's `renovate.json` (`brighterscript`, `roku runtime`, `roku deploy & test`, `docs lint`, `git hooks`) group majors too. A GitHub Actions major always gets its own PR (the org config). Review each dependency in a group on its own (Steps 2 and 3 per dependency), then run the gate (Steps 4 and 5) once over the combined branch. Not patch or minor bumps (those merge automatically after a soak), and not Jellyfin server releases (that is [`/server-upgrade`](../server-upgrade/SKILL.md)).

## Step 1: Resolve the bump (the package, and its from and to versions)

From the arguments:

- **A PR number** (Renovate major PR): `gh pr view <N> --json title,headRefName,body,url`. Read the package name and the from and to versions from the title (Renovate titles read like `Update dependency X to vN` or `chore(deps): update X to N.0.0`); a grouped or GitHub Actions PR lists them only in the table in its body. `gh pr diff <N>` shows the exact lines (it takes no path filter; `--name-only` lists the files). Note the branch name (`headRefName`): Step 4 checks it out.
- **A package name** (manual bump): read the current pinned version from [`package.json`](../../../package.json); find the latest with `npm view <pkg> version`. Use the real package name: the runtime libraries are aliases (`log` is `roku-log`, `rr` is `roku-requests`, `promises` is `@rokucommunity/promises`, `sgRouter` is `@rokucommunity/sgrouter`), and `npm view log` finds an unrelated package. The bump runs from the current version to the latest. This path has no Renovate branch: Step 4 applies the bump locally instead.

Confirm it is a major bump, and that it has soaked: the org config holds a major 7 days, shown by the `renovate/stability-days` status on Renovate's commit (`gh api repos/{owner}/{repo}/commits/<sha>/status`). It is a major when the first version segment increases, or for `0.x` the second, which is breaking by convention. If it is only a patch or minor, stop and say so: those follow the automatic-merge policy, and this skill is for majors. Record `pkg`, `fromVer`, `toVer`, and (if any) `branch`.

## Step 2: Fetch the upstream changelog or migration guide for the range

Find the changelog for the `fromVer..toVer` range. In order of preference:

1. The PR body: Renovate embeds a "Release Notes" section with per-version notes; read it first (`gh pr view <N> --json body`).
2. The upstream repo's `CHANGELOG.md` (most rokucommunity and npm packages keep one). Resolve the repo from `npm view <real-name> repository.url` (for an action, the `uses:` owner and name), then `gh api repos/<owner>/<repo>/contents/CHANGELOG.md --jq .content | base64 -d` and read the entries between `fromVer` and `toVer`.
3. GitHub Releases: `gh release list --repo <owner>/<repo>` and `gh release view <tag> --repo <owner>/<repo>` for each major tag in range.
4. Fallback: `WebFetch` the package's npm page or docs site.

Summarize only the **breaking changes** in the range (ignore features and fixes unless they change behavior we rely on). For each one, note the symbol or API affected, what changed, and the migration upstream prescribes.

## Step 3: Map the breaks to our call sites

For each breaking change, grep the codebase for where we actually use the affected API:

- For BrightScript libraries (vendored by ropm: `sgRouter`, `promises`, `roku-log` and the others): search `source/` and `components/` for the namespace/component (`sgrouter.`, `sgrouter_`, `promises.`, etc.).
- For a GitHub Action: the workflow steps that `uses:` it, and each of those workflows' triggers (`on:`).
- For dev tooling (`brighterscript`, `vitest`, `rooibos`, `roku-deploy` and the like): search `scripts/`, `bsconfig*.json`, `*.config.js`, `tests/`, and `package.json` script invocations.

Produce a concrete list: **each break, the files and functions it hits, and the change each needs**, or "not used here" when a break doesn't touch our code. This is the core judgment output: be specific, and cite the code.

## Step 4: Run the mechanical gate that fits the dependency's type

There is no single gate. The BrightScript build (`validate`, `build`, `lint:bs`) exercises only a dependency the app compiles or bundles. For a GitHub Action or a dependency only Node scripts use, it runs green while touching nothing the bump changed, which is worse than no gate because it *looks* like coverage. **Pick the gate by what executes the dependency.** Reuse the existing npm scripts; don't copy them.

Get the new version into the tree first:

- **PR path:** `git switch <branch>` (the Renovate branch already bumped `package.json` and the lockfile). Run `npm ci`, which installs the branch's lockfile and regenerates `roku_modules` for the vendored libraries. (GitHub Actions live in `.github/workflows/*.yml`, not `package.json`, so there is nothing to install: the bump is the SHA edit already on the branch.)
- **Manual path:** bump the version in `package.json` to `toVer` and run `npm install`.

Then run the matching gate:

- **Runtime BrightScript lib** (the `dependencies` in `package.json`, vendored by ropm and bundled into the `.zip`: `@rokucommunity/bslib`, `log` (roku-log), `promises`, `rr` (roku-requests), `sgRouter`): `npm run validate` (catches removed or renamed symbols), then `npm run build`, then `npm run lint:bs`. Then run `npm run device:check`, and when a device answers, `npm run test:unit` and `npm run test:rta`: for a bundled runtime lib the device run is the real signal, and a clean build is not enough. **If the probe fails, say the probe failed:** never imply the runtime gate passed.
- **BrightScript build and lint tooling** (`brighterscript`, `brighterscript-formatter`, `brighterscript-xml-plugin`, `@rokucommunity/bslint`, `ropm`, `roku-deploy`, `rooibos-roku`): `npm run validate`, `npm run build`, `npm run lint:bs` and `npm run check-formatting:bs`. These are the dependency under test, so the build gate is the right one. A formatter or linter major often changes the formatting of the tree or flags it again, which is expected: apply `npm run format` and review the diff.
- **`roku-test-automation`:** `npm run test:rta` on a device, after `npm run device:check`.
- **Lint tools** (`eslint`, `prettier`, `jshint`, `markdownlint-cli2`, `spellchecker-cli`): their own npm lint script, run over the whole repo.
- **JS and Node tooling** (`vitest`, `js-yaml`, `ajv`, `sharp`, `fast-glob` and the others `scripts/` uses): `npm run test:scripts` (the scripts' own Vitest suite), then **run the affected scripts** on real inputs (the call sites Step 3 found). The BrightScript build never imports these, so `validate` and `build` prove nothing here.
- **GitHub Actions** (`actions/*` in the workflow YAML): there is no local gate, since an action runs only inside CI. The gate is **the PR's own CI run** (`gh pr checks <N>`), plus Step 5, because a workflow's green CI often doesn't exercise the path the bump changed. `gh pr checks` lists only the workflows that ran: compare it with the workflow files the diff changes. The job step names (`gh api repos/{owner}/{repo}/actions/runs/<id>/jobs`) show which action SHA each step ran, and they outlive the logs.

## Step 5: Did the gate exercise the change? (the latent-break check)

A green gate counts only if it ran the code the bump touched. Before calling it a go, name at least one path the bump changes and confirm the gate hit it. A major bump often changes a **conditional** path the PR's own CI never runs:

- **Workflows on `pull_request_target` or `workflow_run`, and steps that run only for a fork PR.** A `pull_request_target` workflow runs `main`'s copy of the file, so the PR's own run uses the old action. And a Renovate branch is in the same repo, so its CI never takes the fork path: the fork-PR checkout block in version 7 of `actions/checkout` (#675) fired only for outside contributors, invisible on the bump's own green run.
- **Jobs that run only on a schedule, at release or on a device**, which don't run on a PR.
- **Empty, missing or edge inputs.** `js-yaml` version 5 throws on empty input where version 4 returned `undefined` (#672), so a `?? {}` site won't catch it, and the happy-path test never feeds it an empty file.

If such a path exists and the gate didn't cover it, treat the change as **unverified** (a latent break): reason it through from the changelog and call it out. Don't let the green tick stand in for coverage it doesn't have.

Report each step's result. A red gate, or an unverified latent path, is a no-go until the migration in Step 6 resolves it.

## Step 6: The verdict and the migration

Emit a **go / no-go** with the SOP checklist ticked:

- [ ] Changelog read for the full `fromVer..toVer` range (every dep, if the PR is grouped)
- [ ] Breaking changes mapped to our call sites (or confirmed not-used)
- [ ] The gate for this type (Step 4) ran green, and Step 5 confirms it exercised the change (no uncovered latent path), or the latent path is reasoned through and flagged
- [ ] `test:unit` and `test:rta` green on a device where they apply (or marked N/A: the probe failed, or not a runtime BrightScript lib)
- [ ] required migration applied in the branch (if any)

If a migration is needed and the user approves, apply it with `Edit` on the affected files (cite the changelog rationale), then re-run the relevant gate step to confirm green. Leave the merge to the user: this skill reviews and prepares; it never merges.

If anything was deferred (a device run that couldn't happen, for example), record it with [`/log followup`](../log/SKILL.md) so it isn't lost.

## When not to use

- A patch or minor bump: it merges automatically after a soak, so no skill is needed.
- A Jellyfin server release: use [`/server-upgrade`](../server-upgrade/SKILL.md).
- A new dependency, not a version bump: add it on purpose; this skill assumes an existing dependency moving a major version.
