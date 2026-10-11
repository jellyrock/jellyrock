---
topic: api-usage-manifest
related-files:
  - scripts/generate/api-usage-manifest.js
  - docs/architecture/api-usage-manifest.json
  - source/api/ApiClient.bs
  - source/api/sdk.bs
  - source/data/JellyfinDataTransformer.bs
  - source/utils/people.bs
last-reviewed: 2026-10-09
---

# API usage manifest

A generated record of the Jellyfin REST API that JellyRock depends on: every endpoint it calls, every request field it sends and every response field it reads. The file is [`api-usage-manifest.json`](api-usage-manifest.json). This page says what is in it, why it exists and how it stays current.

## Why it exists

JellyRock's API client is written by hand, not generated from Jellyfin's OpenAPI spec (see [`api.md`](api.md)). That keeps the client small, but nothing in the code says which endpoints and fields the app uses. Without a record, judging a new Jellyfin release means reading its whole spec diff and guessing what matters.

The manifest is the app's half of that comparison. The server-upgrade pipeline ([`server-upgrade-automation.md`](server-upgrade-automation.md)) joins a spec diff against it (`npm run api-watch:findings`):

- **Changed upstream and used by the app:** a breaking candidate to investigate.
- **Added upstream in an area the app covers:** an opportunity worth an issue.
- **Changed upstream and not used by the app:** ignored. This is the join that saves the most time, since most of a release touches endpoints the app never calls.

The floor checks (`lint:floor-coverage`, `lint:endpoint-availability`) read it too. On its own, it shows the app's API footprint in review: a PR that adds or drops an endpoint changes the manifest.

## What it contains

| Section | Meaning |
|---|---|
| `endpoints` | One entry per path: `path` (the template as written, such as `/Items/{0}`), `normalized` (every placeholder as `{}`, lowercased, to match the spec), `methods`, `minApiVersion` and `maxApiVersion` (see [Version tiers](#version-tiers)), and `sourceFiles`. |
| `requestFields` | The PascalCase field names the app sends, such as `DeviceProfile`, each with `sourceFiles`. |
| `responseFields` | The PascalCase fields the app reads, each with `readVia` (the variable it was read through, such as `apiData` or `policyData`) and `sourceFiles`. |
| `coverage` | The files each section was read from (`scope`), counts, `unresolvedEndpointSinks` (paths the generator would not guess) and `knownGaps`. |

## How it is generated

[`scripts/generate/api-usage-manifest.js`](../../scripts/generate/api-usage-manifest.js) parses the BrighterScript sources with the BrighterScript parser, the one the BSC plugins use, so formatting does not change the result. It reads:

- **Endpoints** from the first argument of every `buildURL()` and `APIRequest()` call in `source/`: a string literal, or a `Substitute("/path/{0}", …)` template. The method comes from the builder around the call: the first argument of `validatedReq()` or `listReq()`, a returned `{ method: "POST", … }`, or `getJson()` and `postJson()`.
- **Request fields** from PascalCase keys and `body.X =` assignments in `source/api/`.
- **Response fields** from PascalCase reads in the files listed in `RESPONSE_FIELD_FILES`.

### The response-field file list

Jellyfin's fields are PascalCase (`apiData.RunTimeTicks`) and JellyRock's own node fields are camelCase (`item.runTimeTicks`). So a PascalCase read is a Jellyfin field, but only in a file that maps server data to nodes: elsewhere it can be a Roku object (`deviceInfo.DolbyVision`). That is why the generator reads a list of files and not a glob. `source/utils/session.bs` is on the list although it is not a pure mapper, because `user.Login()` and `server.Discover()` read the session responses there. The few PascalCase names it builds itself are left out through `APP_MADE_RESPONSE_FIELDS`.

**If you move server-field reads to a file, or add a mapper, add the file to the list.** A file left off shrinks the manifest without any error, and a quiet manifest looks the same as the app not using a field. This happened when the `BaseItemPerson` reads moved from `JellyfinDataTransformer` to `source/utils/people.bs`: `BaseItemPerson.PrimaryImageTag` dropped out until the file was added. The generator fails on a listed file that does not exist, so a typo cannot quietly scan less.

### Version tiers

JellyRock picks an endpoint by server API tier with `if m.getApiVersion() >= N`. `resolveApiVersion()` maps a server to tier 1 (before 10.9) or tier 2 (10.9 and later), and a future tier 3 nests the same way. Each endpoint records the tiers it serves as `minApiVersion` and `maxApiVersion` (`null` means no upper bound). The generator reads them from the tier checks around the call: both branches of an `if`, and the statement after an `if` that returns, which is the lower-tier case. `sdkV1.bs` and `sdkV2.bs` have no tier check of their own, because `ApiClient` picks between them, so the generator sets their range from the file name.

The pipeline relies on this range. A change in one tier's spec is a breaking candidate only for endpoints whose range includes that tier. Tier 1 covers servers that will get no more releases, so endpoints only tier 1 uses drop out of every new release's join with no list to keep. JellyRock supports the oldest servers for good, so tier 1 code is intended and may still grow.

The range covers the tier checks only, not a narrower floor that a call site checks itself. `MediaSegments` needs 10.10, which `supportsMediaSegments()` checks, but its builder has no tier check, so the manifest gives it tiers 1 and up. Endpoints like that are recorded in [`jellyfin-endpoint-availability.yml`](../dev/jellyfin-endpoint-availability.yml), so the floor checks do not flag them on every run.

### What it leaves out, on purpose

The generator reads a fixed set of files (`coverage.scope`) and lists what it misses in `coverage.knownGaps` instead of dropping it silently. Where it has to guess, it guesses wide. A name it captures that is not a real Jellyfin field matches nothing in the join, so it costs nothing. A missed field is the dangerous case: a breaking change to it would go unnoticed. A path built by joining strings at run time, such as a server-provided `stream.DeliveryUrl`, goes to `coverage.unresolvedEndpointSinks` and is not guessed.

## Regenerating

```bash
npm run docs:api-manifest          # regenerate the manifest
npm run docs:api-manifest:check    # fail if the committed manifest is stale
node scripts/generate/api-usage-manifest.js --verbose   # also print where each entry was found
```

The manifest is generated: never edit it by hand. When a push changes the API layer, the pre-push hook regenerates it and adds it to its auto-fix commit. CI and the pre-push hook both run `docs:api-manifest:check`, the same write-and-check pattern as the dev index and icon generators.
