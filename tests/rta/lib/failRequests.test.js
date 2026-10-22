/**
 * Hardware-free gate on the rules `failRequests` accepts.
 *
 * The app drops a rule it can't honor (`apiFaults.checkedRule` in `source/api/apiFaults.bs`)
 * and logs only a count, so a spec with a bad rule runs against a healthy server and passes
 * without ever reaching its failure path. `audio-seek.spec.js` shipped one (`kind: 'fail'`).
 * The helper now refuses such a rule before it reaches the device, and these pin which rules
 * it refuses.
 */
import { describe, it, expect } from 'vitest';
import { checkFailRule } from './failRequests.js';

describe('checkFailRule', () => {
  it.each([
    [{ prefix: 'playbackInfo', kind: 'timeout' }],
    [{ prefix: 'playbackInfo', kind: 'timeout', ms: 10000 }],
    [{ prefix: 'playbackInfo', kind: 'http', status: 500, times: 1 }],
    [{ prefix: 'itemMetaData', kind: 'slow', ms: 2000, after: 0 }],
    [{ prefix: 'itemQuery_usersItems', kind: 'empty', times: 2, after: 1 }],
  ])('accepts %j', (rule) => {
    expect(() => checkFailRule(rule)).not.toThrow();
  });

  it.each([
    [{ prefix: 'playbackInfo', kind: 'fail' }, /kind/],
    [{ prefix: 'playbackInfo' }, /kind/],
    [{ prefix: '', kind: 'timeout' }, /prefix/],
    [{ kind: 'timeout' }, /prefix/],
    [{ prefix: 'playbackInfo', kind: 'http' }, /status/],
    [{ prefix: 'playbackInfo', kind: 'http', status: 302 }, /status/],
    [{ prefix: 'playbackInfo', kind: 'slow' }, /ms/],
    [{ prefix: 'playbackInfo', kind: 'timeout', ms: 0 }, /ms/],
    [{ prefix: 'playbackInfo', kind: 'timeout', times: 0 }, /times/],
    [{ prefix: 'playbackInfo', kind: 'timeout', after: -1 }, /after/],
  ])('refuses %j', (rule, reason) => {
    expect(() => checkFailRule(rule)).toThrow(reason);
  });
});
