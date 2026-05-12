# Investigation contract — CI triage

This is the contract followed in main thread once `/ci-triage` has done its prep. The skill ran on opus; the prep packet was written to `.claude/handoffs/ci-<run-id>-<timestamp>.md` and is also in conversation context (until compaction). You're investigating: read the cited code, name the root cause, either implement a controlled fix or surface architectural tradeoffs.

## Where the prep lives

If conversation context is intact, the prep is right there (run metadata, failure tail, file context list). If the conversation has compacted or you're resuming in a fresh session, `Read .claude/handoffs/ci-<run-id>-<timestamp>.md` for the consolidated packet. The packet has the shape:

```text
CI failure
Run: <run-id> (<workflow name>)
Branch: <branch>
Triggered by: <event>
URL: https://github.com/jellyrock/jellyrock/actions/runs/<run-id>

Classification: lint-fail | build-fail | device-test-fail | docs-stale-blocking | language-coverage-fail | unknown
Failed step: <step name>
Initial file context:
  - <path>:<line range> — <one-line why-relevant>
  - ...

Failure tail (last ~50 lines of the failed step):
  <log excerpt>
```

Do NOT re-fetch via `gh` — the prep is authoritative. If the classification is clearly wrong (e.g., the skill called it `lint-fail` but the log shows a docs-stale-blocking failure), surface that and stop.

## Failure category playbook

### `lint-fail`

The CI ran one of: `npm run lint:bs`, `npm run lint:js`, `npm run lint:json`, `npm run lint:markdown`, `npm run lint:spelling`, `npm run lint:translations`, `npm run lint:language-coverage`, `npm run lint:docs`, `npm run check-formatting`, `npm run validate`. Each has a distinct failure shape:

- **`lint:bs` / `validate`** — bslint or BSC errors. The log names file:line + diagnostic. Most fixes are mechanical (typo in name, wrong field type). Cite the specific BSC plugin if relevant (see `scripts/bsc-plugins/`).
- **`lint:js`** — eslint. Common JellyRock-specific rule fires: `n/hashbang`, `preserve-caught-error`, `n/no-unsupported-features/es-syntax`. The pre-push hook fires the same checks; if it didn't catch this, the file might be outside the lint-staged glob.
- **`lint:docs`** — `scripts/lint/docs-check.cjs` flagged a broken `related-files:` path or a stale tech-debt anchor. **Hand off to `/docs-lint`** — that skill is built for exactly this fix-list.
- **`lint:translations` / `lint:language-coverage`** — translation key drift. Auto-fix via `npm run lint:translations -- --fix` (regenerates `translationKeys`). If the failure is missing translations across non-en_US locales, that's a Weblate sync issue, not a fixable-here issue.
- **`check-formatting`** — prettier or bsfmt drift. Run `npm run format` locally to fix.

### `build-fail`

`npm run build` (or a variant: `build:tests-unit`, `build:tdd`, etc.) failed. Usually: BSC compilation error, BSC plugin error, or a missing file. The log names the failing source file. The fix is the same as a `lint:bs` failure — read the file, fix the diagnostic. Often pairs with `lint-fail` (one root cause, two checks failed).

### `device-test-fail`

The Roku-hardware test job in CI ran `npm run test:tdd` / `test:unit` / `test:integration` / `test:all` and a test failed. Common shapes:

- **A new test added in this PR fails** — the test logic might be wrong, or the production code change broke a covered behavior.
- **An existing test fails on this PR** — regression. Read the diff.
- **Hardware unavailable in CI** — the CI runner couldn't reach the test device. Not a code issue; surface to the user as infra.

The Rooibos failure output names the suite + test + assertion. Read the test file + the SUT.

### `docs-stale-blocking`

`scripts/lint/docs-stale-blocking.cjs` flagged that this PR touched a stale architecture doc's `related-files:` territory without updating the doc itself. Two valid fixes:

- **Re-read the doc against current code; update if shape/why changed; bump `last-reviewed` to today.**
- **No shape/why change occurred; just bump `last-reviewed` to today** — but ONLY when this is genuinely true. Don't reflexively date-bump to bypass the gate.

Hand off to `/docs-lint` for the structured fix list if multiple docs are flagged.

### `language-coverage-fail`

`scripts/lint/language-coverage.cjs` flagged a translation-coverage drop. Usually: a new key added to `en_US.json` but not to other locales. Either accept the drop (per-locale) or coordinate via Weblate.

### `unknown`

The skill couldn't classify. Read the failure tail in full, identify the failed step manually, then proceed.

## Step 1 — Validate the diagnosis

Read the failure tail + cited code. Answer two questions:

1. **Does the classification match the log?** If not, surface the correction.
2. **Is this a transient failure?** Hardware unavailable, network blip, GitHub Actions infra hiccup — re-running the workflow may fix it without code changes. Don't fix code that isn't broken.

## Step 2 — Root-cause analysis

Identify the underlying cause. For lint/build/test, the diagnostic itself often points at the line. The judgment is: is the diagnostic the symptom, or the root cause? A `Type Mismatch` error often surfaces because an upstream API contract is wrong, not because the call site is wrong.

## Step 3 — Implement (semi-auto path)

Default for clear lint/build/test fixes:

1. Apply the code change via `Edit`.
2. Run the relevant local check to verify (`npm run lint:bs`, `npm run validate`, `npm run test:scripts`, etc. — match the failed CI step). For hardware tests, run `npm run test:tdd` if the device is reachable; if not, say so explicitly.
3. **Stop before committing.** Show the user: one-line summary, diff, local-check output.
4. Ask: "Review the diff and let me know if you want changes. When ready, commit and push (CI will re-verify)."

For `docs-stale-blocking`: surface the affected doc, ask the user to confirm "shape/why changed?" or "no, just bump date." Then apply the chosen action.

## Step 3b — Present options (architectural-decision path)

For failures that surface a real architectural choice (e.g., a test fails because a recent API contract change cascaded; the fix is "patch the test, patch the contract, or revert"), present 2-3 tradeoff'd options. Same shape as the `/issue-triage` and `/runtime-triage` investigation contracts.

## Critical constraints

Repo-wide rules in root [`CLAUDE.md`](../../../CLAUDE.md) still apply (CHANGELOG is CI-controlled, no `tasks/` leakage in shared artifacts, hardware-reachable claim discipline, pre-push hook discipline). Flow-specific constraints:

- NEVER commit, push, or open a PR. The user owns those steps.
- NEVER blanket-add logging.

## When you're done

Summarize:

> CI failure investigation complete.
>
> - Run: <run-id>
> - Category: <lint-fail / build-fail / device-test-fail / docs-stale-blocking / language-coverage-fail / unknown>
> - Diagnosis: <one-line root cause>
> - Action: <fix applied locally / options presented / report transient>
> - Local check: <pass / fail / hardware unavailable>
> - Next: <user reviews diff and pushes / picks option / re-runs the workflow if transient>
> - Cleanup: if `.claude/handoffs/ci-<run-id>-*.md` exists, `rm` it to clear the pending marker (otherwise it'll surface in `/catchup` until the 30-day auto-prune).
