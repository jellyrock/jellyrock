# ADR 0040: The API pool skips a queued read whose caller has stopped waiting

**Status:** Accepted
**Partially superseded by:** [ADR 0043](0043-pool-stops-long-reads-of-gone-callers.md) (in-flight cancel of long reads only)
**Date:** 2026-09-22

**related-files**: `source/api/apiPool.bs`, `components/api/ApiQueueTask.bs`, `components/api/ApiResultNode.xml`, `source/api/apiPromise.bs`, `source/api/apiPipeline.bs`, `source/api/ApiClient.bs`, `scripts/measurements.js`, `tests/source/unit/api/apiPoolSkip.spec.bs`, `docs/architecture/api.md`

The pool has no way to cancel a request, but callers stop listening all the time: `replaceTask()` stops a Task that is waiting in `fetchRes` ([ADR 0037](0037-task-run-replacement.md)), a component's promises are abandoned at teardown ([ADR 0013](0013-auto-abandon-promises-bsc-plugin.md)), a pipeline run ends early, or a caller times out. Each of these left its request in the coordinator's FIFO queue, where it was still dispatched and held a [pool slot](../architecture/api.md#pool-width) for up to `timeouts.HTTP_MS`. On a slow server a burst of replaced runs, such as Search starting a new `SearchTask` per keystroke, queued the request the user was waiting for behind ones nobody would read. Now, when a slot frees, the coordinator completes such a queued request with `error: apiResponse.ERROR_ABANDONED` instead of sending it, if its caller has marked it abandoned or the Task recorded as waiting for it is no longer running. [ADR 0012](0012-promise-native-interface-fetchres-exception.md) kept the pool engine unchanged for the promise migration; this changes the engine by one check at dispatch and leaves the interface alone.

**Only reads are skipped.** A GET or HEAD is skipped, and so is a POST that declares `skippable: true` because it only reads (`BuildGetLiveTvScheduleRequest`). Never skipped: POST and DELETE requests the user asked for (favorite, played, delete, recordings), which should land even after the screen moved on, and in order. Also never skipped: `BuildPostPlaybackInfoRequest`, which sends `AutoOpenLiveStream` and can open a live stream.

**Only a request that WAITED for a slot is checked, because the check is expensive.** Each check crosses to the render thread up to three times, on the coordinator — the serial path every request in the app passes through. Measured on a Stick 4K (`.177`, Jellyfin 12.1.0, 2026-09-22, six Home loads via `npm run measure -- --measurement api-dispatch`):

| | checking every entry | checking only entries that waited |
|---|---|---|
| Cost per request dispatched | **7796 µs** | **88 µs** |
| The slot write beside it, unchanged | 1559 µs | 1789 µs |
| Requests that had waited for a slot | 0 of 96 | 0 of 96 |
| Requests skipped | 0 | 0 |

On a 6-wide pool against a server that keeps up, **nothing ever queues** — so checking every entry spent ~7.8 ms per request, about five times the slot write, on a question that could not have a positive answer. A request that finds a free slot on arrival is sent in the same breath, so its caller cannot have gone anywhere. The check is therefore confined to entries that were still queued when every slot was busy, which is both the only population a caller can vanish from and the only situation where freeing a slot is worth anything. A forced 1-wide-pool arm confirms the rule fires: 36 of 84 requests waited, at 17398 µs per waited request.

**Ruled out:** canceling a request already on a slot, which would mean replacing the blocking HTTP call in `ApiTask` and only saves the remaining time of a request the server is already handling; skipping by method alone, which would waste a slot on each abandoned schedule query; recording an owner for render-thread callers, where the component, not a Task, is the listener, so a stopped Task could skip a request someone still wants; and clearing `owner` on the delivery write as `setFields({result, owner: invalid})`, which measured *slower* than the plain `result =` write it replaced (27.4 ms median against 10.8 and 12.1 ms in the two arms that kept it), so the reference is dropped only on the skip path, where it is known dead. A dispatched entry's owner is still waiting for its answer by definition, and the node releases it when the coordinator's 50-child prune releases the node.

**Still not measured:** how often a skip happens in real use. One was observed on device (an `ItemDetails` `logoSize` promise abandoned by backing out of the screen, against a forced 1-wide pool), and the coordinator logs each one, but no rate has been taken. `npm run measure -- --measurement api-dispatch` re-takes the table above on demand; the emit is `#if perfTiming`, which `harden-prod-manifest.js` forces off for production builds.
