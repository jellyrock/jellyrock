# Investigation contract: runtime triage

The main conversation follows this contract once `/runtime-triage` has done its preparation. The skill ran on opus, and the preparation packet is in `.claude/handoffs/runtime-<timestamp>.md` and in the conversation (until compaction). You are investigating: read the code, name the root cause, then either make a controlled fix or lay out the architectural options.

## Where the preparation lives

If the conversation is intact, the preparation is right there (the parsed log, the classification, the files to read). After compaction, or in a fresh session, read `.claude/handoffs/runtime-<timestamp>.md` for the packet. It has this shape:

```text
Runtime failure
Source: pasted log / crash report

Classification: render-thread-crash | task-crash | api-error | registry-corruption | nav-error | unknown
Probable area: <for example components/video, source/api>
Initial file context:
  - <path> (<function or whole file>): <why it is relevant, in one line>
  - ...

Failure signal (relevant log excerpt):
  <the error line and 5 to 10 lines around it>

Full pasted log (untruncated):
<the paste, verbatim>
```

Don't parse or classify again: the preparation stands. If the classification is clearly wrong (the skill called it `api-error` but the log shows a render-thread crash on an invalid reference), say so and stop. Don't paper over it.

## Where to look first, by category

### `render-thread-crash`

Symptoms: a `runtime error &hXX` line in a component file, such as `&hec` (a `.` on an invalid reference) or `&he4`. The screen often freezes or the app exits.

First look: the error line names the file and line. Find the function there. Common shapes:

- **A synchronous HTTP call on the render thread.** Component code reaches the server through `fetchAsync`; see [`source/api/CLAUDE.md`](../../../source/api/CLAUDE.md).
- **A field read on a node that isn't set up yet**, usually an observer firing before the field was set: check the order in `init()`.
- **A key event or an observer after teardown**, on a reference `onDestroy` already released: see the teardown rules in [`components/CLAUDE.md`](../../../components/CLAUDE.md).
- **A value of an unexpected type**, usually an API answer with a different shape than the code assumed (a field that is missing or `invalid` for one item type).

### `task-crash`

Symptoms: a Task stopped mid-run, or a `runtime error &hXX` line in a Task's file (`components/api/ApiTask.bs`, `SideEffectTask.bs`, `components/GetPlaybackInfoTask.bs` and the like).

First look: open the Task's file the log names. Common shapes:

- **The server rejected the request** (401 or 403): the token is no longer valid or the user lacks the permission. Nothing in the app refreshes a token, so check how the caller handles the rejection.
- **The server is unreachable:** the Task should hand back an error the caller can retry, not crash.
- **A response of an unexpected shape:** the `ApiResultNode` (or the response AA) doesn't hold what the caller expected, often after a change to the API client. A list endpoint must use `listReq` ([`source/api/CLAUDE.md`](../../../source/api/CLAUDE.md)).

### `api-error`

Symptoms: an HTTP error status (`4xx` or `5xx`) in the log, a Jellyfin API path with a non-200 answer, or a timeout.

First look: identify the path and method. Check [`docs/user/jellyfin-server-feature-matrix.md`](../../../docs/user/jellyfin-server-feature-matrix.md): sometimes the server version doesn't have the endpoint. Common shapes:

- **400 or 422:** the request's shape changed, most likely in a recent client change.
- **401 or 403:** the token is no longer valid, or the user lacks the permission.
- **404:** the endpoint doesn't exist on this server version (see the matrix), or the item is really gone.
- **500:** the server failed. Outside the app's control, but tell the user.
- **A timeout:** the limits are constants in `source/constants/timeouts.bs` (`HTTP_MS` for one request). Check whether the call is slow for a real reason before raising one.

### `registry-corruption`

Symptoms: a setting reads its default when the user had changed it, a read fails, or a migration line in the log looks wrong.

First look: global settings live in the `JellyRock` registry section, and each user's in a section named by the user's ID; tests use `test-` sections. See [`docs/dev/registry-migrations.md`](../../../docs/dev/registry-migrations.md). Common shapes:

- **A migration ran but left a bad state:** check its block in `source/migrations.bs`.
- **A key or section name off by one character:** the write succeeded, but the read returns the default.
- **A field `id` that differs from the registry key:** `user.Login()` loads a key only into the settings field with the same name.

### `nav-error`

Symptoms: focus is somewhere unexpected, `onKeyEvent` fired but nothing happened, the OSD doesn't hide, a dialog won't close.

First look: the log usually shows little, since this kind of failure shows on screen, not in the console. Lean on the user's steps to reproduce it. Common shapes:

- **`onKeyEvent` returning the wrong value:** `false` lets the key bubble to the parent, `true` stops it. An inverted return is a common cause of "Back does nothing".
- **A routed view left in the wrong state:** navigation runs through the router (see [`navigation.md`](../../../docs/architecture/navigation.md)); check the route and the view's `onScreenShown` and `onScreenHidden`.
- **A dialog not torn down:** see the dialog rules in [`components/CLAUDE.md`](../../../components/CLAUDE.md).
- **The OSD timeout (`inactiveTimeout`):** check recent changes to how the OSD is timed.

## Step 1: Validate the diagnosis

Read the cited code against the failure signal, and answer three questions:

1. **Does the log line really point at this file and function?** The classifier may have matched a word that appears in many places ("playback"). Confirm or correct it.
2. **Can it be reproduced here?** If the log shows a state the test harness can't reproduce (a specific Roku model, server version or network condition), say so first.
3. **Has it been fixed already?** Search recent commits and closed issues for the same area and shape. If a fix landed and the user runs an older build, the answer is to update, not a new fix.

Give your validation in three to five sentences before going into the root cause.

## Step 2: Find the root cause

Name the underlying cause: not "the function returned invalid" but "the endpoint answers `invalid` for this item type and the caller assumes a list". If the same cause probably exists elsewhere, search to confirm.

Apply JellyRock's lenses: render-thread safety, how Tasks are started and replaced, requests traveling as child nodes, global state, registry migrations. Cite [`source/api/CLAUDE.md`](../../../source/api/CLAUDE.md), [`components/video/CLAUDE.md`](../../../components/video/CLAUDE.md) and the others as they apply.

## Step 3: Make the fix, or present options

For a clear, contained fix, take the **semi-auto** path:

1. Make the change with `Edit`.
2. Write or update the tests that apply (`npm run test:tdd` on a Roku, `npm run test:scripts` for a BSC plugin or Node tooling). Run `npm run device:check` before a device test.
3. Run them, and report the result as it is: pass, fail, or the device probe failed.
4. Stop before committing. Show a one-line summary, the diff (or a `git diff` summary), the test output and any deferred follow-ups.
5. Ask: "Review the diff and tell me what to change. When it's ready, commit and run `/pr` separately."

Take the **architectural-decision** path when the failure crosses boundaries between subsystems:

1. Present two or three options, each with its approach, pros and cons against JellyRock's conventions, complexity, impact, and the tests or migrations it needs.
2. Recommend one, with the reasoning.
3. Wait. Don't build anything until the user picks.

## Capture deferred follow-ups

If the failure shows work beyond this fix, route it by `AGENTS.md`'s followup-discipline rule. For internal debt, offer a `tech-debt.md` slug:

> **Out of scope for this fix** (suggest filing as tech-debt slug `<kebab-name>`):
> <one paragraph: the remaining work and why it was deferred>

## Constraints

The root [`CLAUDE.md`](../../../CLAUDE.md) rules still apply: `CHANGELOG.md` is CI-controlled, no gitignored path is cited in a shared artifact, a device claim needs a probe, and the git hooks run. For this flow:

- Never commit, push or open a PR. The user owns those steps.
- Never suggest a fix that breaks the render-thread rules.
- Never blanket-add logging. If a fix would gain from one targeted log on a critical-error path, propose it; otherwise ask the `log-reviewer` agent for an audit.

## When you're done

End with this summary:

> Runtime failure investigation complete.
>
> - Category: <the category from the packet>
> - Diagnosis: <the root cause, in one line>
> - Action: <fix made locally / options presented / report invalid>
> - Tests: <pass / fail / device probe failed>
> - Next: <user reviews the diff / picks an option / clarifies the report>
> - Cleanup: if `.claude/handoffs/runtime-*.md` exists for this triage, `rm` it to clear the pending marker; otherwise it shows in `/catchup` until it is pruned after 30 days.
