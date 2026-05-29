---
topic: api-usage-manifest
related-files:
  - scripts/generate/api-usage-manifest.js
  - docs/architecture/api-usage-manifest.json
  - source/api/ApiClient.bs
  - source/api/sdk.bs
  - source/data/JellyfinDataTransformer.bs
last-reviewed: 2026-05-29
---

# API Usage Manifest

A generated, deterministic record of the **Jellyfin REST API surface JellyRock
actually depends on** — every endpoint it calls, every request-body field it
sends, and every response field it reads. The machine-readable artifact lives at
[`api-usage-manifest.json`](api-usage-manifest.json); this page explains what it
is, why it exists, and how it is maintained.

## Why this exists

JellyRock's API client is **hand-written** — there is no codegen from the
Jellyfin OpenAPI spec (see [`api.md`](api.md)). That keeps the client small and
Roku-appropriate, but it means nothing in the repo mechanically *knows* which
endpoints and fields the app uses. So when a new Jellyfin server version ships,
assessing impact is entirely manual: download the spec, eyeball the diff, guess
whether anything we touch changed.

This manifest is the **"demand" side** of fixing that. It is the foundation a
later spec-diff tool joins against:

- `changed upstream ∩ used by app` → a breaking change we must act on.
- `added upstream ∩ our domain` → an opportunity worth an issue.
- `changed upstream ∩ **not** used by app` → ignore (e.g. a security hotfix that
  touches endpoints we never call). This is the join that keeps maintainers from
  burning time on irrelevant churn.

It is also independently useful on its own: an always-current map of the app's
real API footprint that shows up in code review. If a PR adds or drops an
endpoint, the manifest diff shows it.

## What it contains

| Section | Meaning |
|---|---|
| `endpoints` | Each `{ path, normalized, methods, minApiVersion, maxApiVersion, sourceFiles }`. `path` is the template as written (e.g. `/Items/{0}`); `normalized` collapses every placeholder to `{}` and case-folds (`/items/{}`) for matching against an OpenAPI spec. `methods` is inferred from the call site. `minApiVersion`/`maxApiVersion` (max `null` → unbounded) record the `apiVersion` tier range the endpoint serves — see below. |
| `requestFields` | PascalCase request-body field names the app sends (e.g. `DeviceProfile`, `SubtitleStreamIndex`). |
| `responseFields` | PascalCase DTO fields the app reads, each with `readVia` (the variable it was read through, e.g. `apiData`, `userData`, `firstSource`). |
| `coverage` | The scope each section was extracted from, counts, `unresolvedEndpointSinks` (dynamic paths we refused to guess), and `knownGaps`. |

## How it's generated

[`scripts/generate/api-usage-manifest.js`](../../scripts/generate/api-usage-manifest.js)
parses the relevant BrighterScript sources with the **brighterscript AST** (the
same parser the BSC plugins use — robust to formatting, unlike grep) and extracts:

- **Endpoints** from the first argument of `buildURL()` / `APIRequest()` calls —
  a string literal or a `Substitute("/path/{0}", …)` template. The HTTP method
  is inferred from the enclosing builder function (`validatedReq("GET", …)`,
  an inline `{ method: "POST" }` AA, or `getJson`/`postJson`).
- **Response fields** from PascalCase field reads in the data transformers. This
  works because Jellyfin DTO fields are PascalCase (`apiData.RunTimeTicks`) while
  JellyRock's own ContentNode writes are camelCase (`item.runTimeTicks`).
- **Request fields** from PascalCase AA keys and `body.X =` assignments in the
  API layer.

### Version tiers (`V1`, `V2`, …)

JellyRock dispatches endpoints by server-API tier with `if m.getApiVersion() >= N`
(`V1` = server 10.7–10.8, `V2` = 10.9+, and a future `V3` nests the same way).
Each endpoint records the tier range it serves as `minApiVersion`/`maxApiVersion`
(`max: null` → unbounded), derived from the dispatch guards — the then/else
branches **and** the early-return fall-through (`if >=N { return … } end if;
return …`, where the trailing statement is the implicit `< N` case). The
version-named SDK shim files (`sdkV1.bs`/`sdkV2.bs`) pin the range when the
`V1`/`V2` choice is made one layer up in `ApiClient`.

This is the load-bearing field for the spec-diff tool: a change in a spec at a
given tier is a breaking candidate **only** for endpoints whose range includes
that tier. Endpoints pinned to a **frozen** older tier (`V1` targets server
10.7–10.8, which will never get another release) are therefore excluded
automatically — permanently, and with no allowlist to maintain. JellyRock
supports the oldest servers indefinitely, so `V1` usage is intentional and may
even grow with new features; the range annotation keeps it from ever becoming
noise.

It does **not** capture finer per-endpoint floors enforced at the call site
(e.g. `MediaSegments` is 10.10+ via `supportsMediaSegments()`, but its builder
has no `getApiVersion` branch, so it tags `[1, ∞)`).

### Scope and the inclusive bias

Coverage is deliberately scoped (see `coverage.scope` in the JSON), and the bits
not yet covered are recorded in `coverage.knownGaps` rather than silently
dropped. The heuristics lean **inclusive on purpose**: over-capture is
self-correcting — a name that isn't a real Jellyfin schema field simply won't
match anything when the spec-diff tool joins against it. **Under**-capture (a
missed dependency) is the dangerous direction, because it would let a real
breaking change slip through, so we prefer a little noise over a silent miss.

Endpoint paths built by non-literal string concatenation (e.g. a server-provided
`stream.DeliveryUrl`) are listed under `coverage.unresolvedEndpointSinks`, not
guessed.

## Regenerating

```bash
npm run docs:api-manifest          # regenerate (write)
npm run docs:api-manifest:check    # fail if the committed manifest is stale (CI / pre-push)
node scripts/generate/api-usage-manifest.js --verbose   # line-level provenance to stderr
```

The manifest is a **generated file — never hand-edit it.** Drift is caught by
`docs:api-manifest:check` (run in CI and by the pre-push hook), the same
write-vs-check pattern used by the `dev-index` and icon generators.
