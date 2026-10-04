/**
 * `scripts/weblate-sync.js` against a fake Weblate: both response shapes a
 * repository operation can take (immediate result, or a queued task), and the
 * outcome check that decides success.
 */
import { describe, expect, it } from 'vitest';

import {
  client,
  lockAndFlush,
  pullAndUnlock,
  WeblateError,
} from '../../../scripts/weblate-sync.js';

function fakeWeblate({
  queued = false,
  status = { needs_commit: false, needs_push: false },
  failPull = false,
} = {}) {
  const calls = [];
  let polls = 0;
  const fetchImpl = async (url, { method, body }) => {
    const path = url.replace('https://w.test/api/components/jellyrock/roku', '');
    calls.push(`${method} ${path}${body ? ` ${body}` : ''}`);
    const json = (data, s = 200) => ({
      ok: s < 400,
      status: s,
      text: async () => JSON.stringify(data),
    });
    if (path === '/repository/' && method === 'POST') {
      if (failPull && body.includes('pull')) return json({ result: false });
      return queued
        ? json({ task_url: 'https://w.test/api/tasks/1/' }, 202)
        : json({ result: true });
    }
    if (url === 'https://w.test/api/tasks/1/') return json({ completed: ++polls >= 2 });
    if (path === '/repository/') return json(status);
    if (path === '/lock/') return json({ locked: JSON.parse(body).lock });
    return json({ detail: 'not found' }, 404);
  };
  return {
    calls,
    api: client({ token: 't', url: 'https://w.test', fetchImpl, sleep: async () => {} }),
  };
}

describe('lockAndFlush', () => {
  it('locks, pushes, and checks nothing is left', async () => {
    const { calls, api } = fakeWeblate();
    await lockAndFlush(api);
    expect(calls).toEqual([
      'POST /lock/ {"lock":true}',
      'POST /repository/ {"operation":"push"}',
      'GET /repository/',
    ]);
  });

  it('waits for a queued operation', async () => {
    const { calls, api } = fakeWeblate({ queued: true });
    await lockAndFlush(api);
    expect(calls.filter((c) => c.includes('tasks'))).toHaveLength(2);
  });

  it('fails when Weblate still holds changes', async () => {
    const { api } = fakeWeblate({ status: { needs_commit: false, needs_push: true } });
    await expect(lockAndFlush(api)).rejects.toThrow(WeblateError);
  });
});

describe('pullAndUnlock', () => {
  it('pulls, then unlocks', async () => {
    const { calls, api } = fakeWeblate();
    await pullAndUnlock(api);
    expect(calls.at(-1)).toBe('POST /lock/ {"lock":false}');
  });

  it('unlocks even when the pull fails', async () => {
    const { calls, api } = fakeWeblate({ failPull: true });
    await expect(pullAndUnlock(api)).rejects.toThrow(/pull reported failure/);
    expect(calls.at(-1)).toBe('POST /lock/ {"lock":false}');
  });

  it('reports a merge failure', async () => {
    const { calls, api } = fakeWeblate({
      status: { merge_failure: 'CONFLICT (content): fr.json' },
    });
    await expect(pullAndUnlock(api)).rejects.toThrow(/CONFLICT/);
    expect(calls.at(-1)).toBe('POST /lock/ {"lock":false}');
  });
});
