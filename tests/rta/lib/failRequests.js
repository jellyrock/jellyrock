/**
 * Make the app's API requests fail on purpose, so a spec can drive a screen's failure path
 * against a healthy server. RTA builds only: the API coordinator reads `m.global.rtaFailRequests`
 * and answers a matching request with the failure the pool itself would deliver, instead of
 * sending it (`source/api/apiFaults.bs`, `ApiQueueTask.failedOnPurpose`).
 *
 * A rule: `{ prefix, kind: 'timeout' | 'http', status, times, after }`.
 *  - `prefix` matches the start of the request id the app passes to fetchRes / fetchAsync
 *    (`itemQuery_usersItems`, `itemMetaData`, …).
 *  - `timeout` answers as roku-requests does when it gives up; `http` needs a `status` >= 400.
 *  - `times` is how many matching requests fail; omit it for all of them.
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

/** Let every request through again. */
export async function clearRequestFailures() {
  await failRequests([]);
}
