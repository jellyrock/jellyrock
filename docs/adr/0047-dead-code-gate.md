# ADR 0047: Dead code is a build error, judged the way SceneGraph resolves names

**Status:** Accepted
**Date:** 2026-09-28

**related-files**: `scripts/bsc-plugins/dead-code.cjs`, `scripts/bsc-plugins/auto-abandon-promises.cjs`, `scripts/dead-code-accuracy.js`, `bsconfig.json`, `.dead-code-baseline.json`, `tests/scripts/unit/bsc-plugins/dead-code.test.js`, `tests/source/unit/components/ItemDetailsExtrasSlider.spec.bs`, `docs/architecture/build-and-tooling.md`

Unused code is found by `scripts/bsc-plugins/dead-code.cjs`, an error-severity plugin on the app build, rather than by occasional manual sweeps. The sweep that led to it (#1072) showed why a grep cannot do the job: SceneGraph reaches code by name far more than by call. The rule therefore counts every way a name is spoken — strings (`observeField`, `functionName`, `CreateObject`), `callFunc` calls, XML tags and attributes, packaged JSON, and concatenated prefixes (`"segmentAction" + type`) — and resolves each the way SceneGraph would. A codebehind function is matched only in the component scopes that include it, and a `source/` function is called only from `source/` or from a component that imports it. A `callFunc` reaches a function only through an `<interface>` `<function>` a component in its scope declares, and nothing but a call reaches an interface function. A namespace member is matched only by its qualified name, `m.top.x` only against the file's own component, and a component only by an exact value, never a word inside a string or a `findNode()` id. Code reachable only from dead code is dead too, including a dead field's XML element and a script once every component that includes it is dead. The consumer set is the app build, so **code only a test uses is dead**. The single exception is a test's `callFunc`, which keeps an interface declaration alive only while the app still runs the function behind it. Firmware callbacks and fields are exempt, each cited to Roku's node docs, as are transpile-time injected calls, which the injecting plugin exports.

**Keeping unused code is a recorded decision, not a suppression.** It must name one of five kinds: `design-system`, `api`, `planned` (which must cite its issue), `platform` or `test-infra`. A marker without a kind and reason, a file-level marker, a marker on code that is used, and an allowlist entry matching nothing are all errors. Code we intend to fix is never a keep. It waits in `.dead-code-baseline.json`, keyed by kind, file and qualified name with no line numbers, which fails on any entry that stops matching, so it cannot hold a stale one; an addition is a deferral decided in review. Component names match case-insensitively: Roku documents them as case-sensitive, but a Roku Ultra builds an `ExtrasSlider` from `ItemDetails.xml`'s `<extrasSlider>`, and `ItemDetailsExtrasSlider.spec.bs` pins that.

**Evidence** comes from `scripts/dead-code-accuracy.js`, committed so it can be rerun after any change to the rule, and each command first proves its loader sees what `bsc` sees. Measured 2026-09-28 to 2026-09-29:

- Replayed at the parent of every commit on `origin/main` at `98c4f1fe` whose message mentions dead or unused code, the rule flagged 677 of the 678 deleted declarations it could judge. The one miss was a component still created by name when a commit deleted it. 49 more are ambiguous, which puts the floor at 677 of 727.
- All 72 sampled live declarations, eight of each of nine kinds, were flagged once their references were erased.
- It adds 0.34–0.38 s to a ~9 s validation.
- An earlier round of evidence, from uncommitted scripts, reported 442 of 445 with figures that did not reconcile. It was replaced by the tool rather than corrected by hand.

**Ruled out:**

- **Warning severity.** Dead code creeps back unseen.
- **Counting tests as consumers.** This keeps code alive that the app never runs (`QueueManager.pop` was called only by a spec's cleanup).
- **Bare-name matching.** It hid `itemAspectRatio.SQUARE` behind `rowSlotSize.SQUARE`, and a codebehind handler behind another component's handler of the same name.
- **A string spelling an interface function counting as a call.** `vertAlignment = "top"` kept `QueueManager.top` alive.
- **Words inside strings naming components.** This kept four retired components alive in the replay.
- **Case-sensitive component matching.** It would fail the build on the live `<extrasSlider>`.
- **Gating write-only fields.** A `getFields()` loop reads a field by no name, so deciding one needs judgment. `npm run dead-code:write-only` lists them for review instead.

**Revisit if:**

- The same-name limit starts to matter. A member access on anything but `m.top` is matched by name, so an unused field or method that shares its name with another type's is kept alive. Fixing it needs the rule to know which component a variable holds.
- A firmware update makes `ItemDetailsExtrasSlider.spec.bs` fail.
