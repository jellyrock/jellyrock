/**
 * Make the app's API requests fail or answer slowly on purpose, so a spec can drive a screen's
 * failure and slow-server paths against a healthy, fast server. RTA builds only: the API
 * coordinator reads `m.global.rtaFailRequests` and answers a failing request with the failure
 * the pool itself would deliver, instead of sending it, or sends a slowed one and holds its
 * answer (`source/api/apiFaults.bs`, `ApiQueueTask.answeredOnPurpose`).
 *
 * A rule: `{ prefix, kind: 'timeout' | 'http' | 'slow', status, ms, times, after }`.
 *  - `prefix` matches the start of the request id the app passes to fetchRes / fetchAsync
 *    (`itemQuery_usersItems`, `itemMetaData`, …).
 *  - `timeout` answers as roku-requests does when it gives up; `http` needs a `status` >= 400.
 *  - `slow` needs `ms`: the answer arrives `ms` after the request was sent, its pool slot busy
 *    all that time.
 *  - `times` is how many matching requests the rule applies to; omit it for all of them.
 *  - `after` is how many matching requests go through before the rule starts failing — for an
 *    id that repeats faster than a spec can set a rule in between (a grid's page 1 and 2).
 * A rule the app cannot honor exactly is dropped, not guessed at.
 *
 * Set rules AFTER relaunching: they live in app memory, so a relaunch clears them and no
 * restore step is needed.
 */
import { odc } from 'roku-test-automation';

/** Replace the active rules. */
export async function failRequests(rules) {
  await odc.setValue({ base: 'global', keyPath: 'rtaFailRequests', value: rules });
}

/** Let every request through again, at full speed. */
export async function clearRequestFailures() {
  await failRequests([]);
}
