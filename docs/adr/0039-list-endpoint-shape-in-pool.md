# ADR 0039: A bare-array endpoint's body is held to its shape in the pool, and the request declares it

**Status:** Accepted
**Date:** 2026-09-22

**related-files**: `source/api/apiResponse.bs`, `source/api/ApiClient.bs`, `components/api/ApiTask.bs`, `source/home/latestRows.bs`, `source/extras/extrasRows.bs`, `components/extras/LoadExtrasRowsTask.bs`, `scripts/generate/api-usage-manifest.js`, `tests/source/unit/api/ApiClient.spec.bs`, `tests/source/unit/api/apiResponseEnforceShape.spec.bs`

A v2.30.0 crash report showed Home's latest-media task dying on `Syntax Error (&h02)` when a
server answered `/Items/Latest` with a `{ Items, TotalRecordCount, StartIndex }` query result
where the endpoint promises a bare array. BrightScript iterates an AA's keys, so the Book filter
read `"StartIndex".Type` and the Task-thread fault ended the app. Stock servers do not send that
wrapper (the spec types the endpoint as an array, checked on 10.8.13 and 10.11.11; local 10.9.11,
10.10.7, 10.11.11 and 12.0.0 servers answer with one), and which server did cannot be recovered
from an anonymous report — nothing below depends on it. The same unchecked read stood wherever
the app consumed a bare-array endpoint.

## Decision

**A builder for an endpoint whose spec 200 response is an array uses `ApiClient.listReq`**, which
marks the request `expect: "list"`. `ApiTask.executeRequest()` runs every pooled response through
`apiResponse.enforceShape()`: a successful list response leaves with `json` an `roArray`, and any other
body leaves as a failure — `ok = false`, `json = invalid`, `error = "unexpectedShape"`, the server's
`statusCode` kept. Callers already treat `ok = false` as no answer, so they need no check of their own
and nothing on screen is cleared as if empty (decision `latest-rows-failure-vs-empty`). The pool
logs one warning per non-array list body. The synchronous `GetPublicUsers()`, which never reaches
the pool, reads through `apiResponse.listFrom()` inside `ApiClient`; extras rows, whose endpoints
mix both shapes, read every response through `listFrom` and treat `invalid` as failed. The "List
requests" group in `ApiClient.spec.bs` pins each builder on V1 and V2.

**A `{ Items: [...] }` wrapper is unwrapped, not rejected.** Its `Items` is the endpoint's list,
so reading it shows the user their content, where rejecting it would leave a Home latest row a
"failed" skeleton that fails again on every retry.

## Ruled out

- **A shape check at each call site** (`apiResponse.listFrom(res.json)` in every caller) — this
  shipped first on the branch and missed two of the seven readers (remote subtitle search, the
  login screen's public users), found by joining the Jellyfin 10.11.11 spec's array-typed 200 responses
  against the app's endpoints. A rule every caller must remember fails one caller at a time.
- **Keeping `ok` true with `json = invalid`** — every caller would again need its own check, and
  `LoadExtrasRowsTask` folded `invalid` into an empty "ok" row, which removes content on screen.
- **Rejecting the wrapper** — see above.

**Constraints:** for a list request, `ok` no longer means only "HTTP success"; `statusCode` still does,
and `error` says why not. A new bare-array builder written with `validatedReq` is not caught
mechanically — the per-builder test covers the builders that exist, and a lint joining the usage
manifest against the spec is a tracked followup. Cost: one string compare per pooled response.
Verified 2026-09-22 on a Roku Ultra: `test:unit` 4146/4146; returning the Cultures builder to
`validatedReq` and removing the wrapper branch turned 3 tests red. Re-evaluate if a server is
found sending a wrapper whose `Items` is not the endpoint's list.

Promotes the `bare-array-bodies-accept-items-wrapper` note, which was written earlier on the same
branch and never reached `main`, when the check lived at each call site.
