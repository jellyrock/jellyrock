/**
 * Make the app's API requests fail or answer slowly on purpose, so a spec can drive a screen's
 * failure and slow-server paths against a healthy, fast server. RTA builds only: the API
 * coordinator reads `m.global.rtaFailRequests` and answers a failing request with the failure
 * the pool itself would deliver, instead of sending it, or sends a slowed one and holds its
 * answer (`source/api/apiFaults.bs`, `ApiQueueTask.answeredOnPurpose`).
 *
 * A rule: `{ prefix, kind: 'timeout' | 'http' | 'slow' | 'empty', status, ms, times, after }`.
 *  - `prefix` matches the start of the request id the app passes to fetchRes / fetchAsync
 *    (`itemQuery_usersItems`, `itemMetaData`, …).
 *  - `timeout` answers as roku-requests does when it gives up; `http` needs a `status` >= 400.
 *    Given `ms`, a timeout first keeps its pool slot busy that long, as a server that never
 *    answers does until roku-requests gives up (`ms: 10000`, timeouts.HTTP_MS); without it, it
 *    answers at once.
 *  - `slow` needs `ms`: the answer arrives `ms` after the request was sent, its pool slot busy
 *    all that time.
 *  - `empty` answers ok with nothing in it, as a server with nothing to give would: a screen's
 *    "nothing here" path against a demo library that is never empty.
 *  - `times` is how many matching requests the rule applies to; omit it for all of them.
 *  - `after` is how many matching requests go through before the rule starts failing, for an
 *    id that repeats faster than a spec can set a rule in between (a grid's page 1 and 2).
 * A rule the app cannot honor exactly is dropped, not guessed at, and the app logs only how
 * many it kept. So `failRequests` refuses such a rule here first (`checkFailRule`): a dropped
 * rule leaves the spec running against a healthy server, passing without its failure path.
 *
 * Set rules AFTER relaunching: they live in app memory, so a relaunch clears them and no
 * restore step is needed.
 */
import { odc } from 'roku-test-automation';

const KINDS = new Set(['timeout', 'http', 'slow', 'empty']);

const isWhole = (n, min) => Number.isInteger(n) && n >= min;

/**
 * Throws when the app would drop `rule`. The same checks as `apiFaults.checkedRule` in
 * `source/api/apiFaults.bs`; change the two together.
 */
export function checkFailRule(rule) {
  const where = `failRequests rule ${JSON.stringify(rule)}`;
  if (typeof rule?.prefix !== 'string' || rule.prefix === '') {
    throw new Error(`${where}: needs a non-empty prefix`);
  }
  if (!KINDS.has(rule.kind)) {
    throw new Error(`${where}: kind must be one of ${[...KINDS].join(', ')}`);
  }
  if (rule.kind === 'http' && !isWhole(rule.status, 400)) {
    throw new Error(`${where}: an http rule needs a status of 400 or more`);
  }
  if (rule.kind === 'slow' && !isWhole(rule.ms, 1)) {
    throw new Error(`${where}: a slow rule needs ms of 1 or more`);
  }
  if (rule.kind === 'timeout' && 'ms' in rule && !isWhole(rule.ms, 1)) {
    throw new Error(`${where}: a timeout's ms, when given, must be 1 or more`);
  }
  if ('times' in rule && !isWhole(rule.times, 1)) {
    throw new Error(`${where}: times must be 1 or more`);
  }
  if ('after' in rule && !isWhole(rule.after, 0)) {
    throw new Error(`${where}: after must be 0 or more`);
  }
}

/** Replace the active rules. Throws on a rule the app would drop (`checkFailRule`). */
export async function failRequests(rules) {
  for (const rule of rules) checkFailRule(rule);
  await odc.setValue({ base: 'global', keyPath: 'rtaFailRequests', value: rules });
}
