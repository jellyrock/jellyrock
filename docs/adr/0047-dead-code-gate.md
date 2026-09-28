# ADR 0047: Dead code is a build error, judged the way SceneGraph resolves names

**Status:** Accepted
**Date:** 2026-09-28

**related-files**: `scripts/bsc-plugins/dead-code.cjs`, `scripts/bsc-plugins/auto-abandon-promises.cjs`, `bsconfig.json`, `.dead-code-baseline.json`, `tests/scripts/unit/bsc-plugins/dead-code.test.js`, `docs/architecture/build-and-tooling.md`

Unused code is found by `scripts/bsc-plugins/dead-code.cjs`, an error-severity plugin on the app build, rather than by occasional manual sweeps. The sweep that led to it (#1072) showed why a grep cannot do the job: SceneGraph reaches code by name far more than by call. The rule therefore counts every way a name is spoken — strings (`observeField`, `callFunc`, `functionName`, `CreateObject`), XML tags and attributes, packaged JSON, and concatenated prefixes (`"segmentAction" + type`) — and resolves them by scope. A codebehind function is matched only in the component scopes that include it, a namespace member only by its qualified name, `m.top.x` only against the file's own component, and a component only by an exact value, never a word inside a string or a `findNode()` id. Code reachable only from dead code is dead too. The consumer set is the app build, so **code only a test uses is dead**; the single exception is an interface function a test drives through `callFunc`, because a test needs the exposure to reach live code. Firmware callbacks and fields are exempt, each cited to Roku's node docs, as are transpile-time injected calls, which the injecting plugin exports.

**Keeping unused code is a recorded decision, not a suppression.** It must name one of five kinds: `design-system`, `api`, `planned` (which must cite its issue), `platform` or `test-infra`. A marker without a kind and reason, a file-level marker, a marker on code that is used, and an allowlist entry matching nothing are all errors. Code we intend to fix is never a keep. It waits in `.dead-code-baseline.json`, keyed by kind, file and qualified name with no line numbers, which fails on any entry that stops matching and so only shrinks. Component names match case-insensitively, although Roku documents them as case-sensitive: `ItemDetails.xml` declares `<extrasSlider>` for the live `ExtrasSlider`, and until a device settles that, the gate takes the side that cannot fail a correct build. Evidence, measured 2026-09-28 before merge:

- every hand-verified dead item was flagged, and every verified-live trap was not;
- replayed at the parent of each historical dead-code-removal commit, it flagged 442 of 445 removed dead declarations;
- all 66 sampled live declarations, across nine kinds, were flagged once their references were erased;
- it adds about 0.6 s to a full validation.

**Ruled out:**

- **Warning severity.** Dead code creeps back unseen.
- **Counting tests as consumers.** This keeps untested-in-app code alive.
- **Bare-name matching.** It hid `itemAspectRatio.SQUARE` behind `rowSlotSize.SQUARE`, and a codebehind handler behind another component's handler of the same name.
- **Words inside strings naming components.** This kept four retired components alive in the replay.
- **Case-sensitive component matching.** It would have failed the build on the live `<extrasSlider>`.

**Revisit if:**

- The same-name limit starts to matter. A member access on anything but `m.top` is matched by name, which is behind the replay's 3 misses. Fixing it needs node typing.
- A device check settles tag case-sensitivity.
