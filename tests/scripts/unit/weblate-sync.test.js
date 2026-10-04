/**
 * `scripts/weblate-sync.js` against a fake Weblate: both response shapes a
 * repository operation can take (immediate result, or a queued task), and the
 * outcome check that decides success.
 */
import { describe, expect, it } from 'vitest';

import { spawnScript } from './_helpers/spawn-script.js';

import {
  check,
  client,
  lockAndFlush,
  pullAndUnlock,
  WeblateError,
} from '../../../scripts/weblate-sync.js';

function fakeWeblate({
  queued = false,
  status = { needs_commit: false, needs_push: false },
  failPull = false,
  locked = false,
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
    if (path === '/lock/' && method === 'GET') return json({ locked });
    if (path === '/lock/') return json({ locked: JSON.parse(body).lock });
    return json({ detail: 'not found' }, 404);
  };
  return {
    calls,
    api: client({ token: 't', url: 'https://w.test', fetchImpl, sleep: async () => {} }),
  };
}

describe('lockAndFlush', () => {
  it('checks the lock, locks, pushes, and checks nothing is left', async () => {
    const { calls, api } = fakeWeblate();
    await lockAndFlush(api);
    expect(calls).toEqual([
      'GET /lock/',
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

  it('refuses a component that is already locked, and never locks or reports it as ours', async () => {
    const { calls, api } = fakeWeblate({ locked: true });
    let ours = false;
    await expect(lockAndFlush(api, { onLocked: () => (ours = true) })).rejects.toThrow(
      /already locked/,
    );
    expect(calls).toEqual(['GET /lock/']);
    expect(ours).toBe(false);
  });

  it('reports the lock as ours only once it is in place', async () => {
    const { calls, api } = fakeWeblate({ status: { needs_commit: true, needs_push: false } });
    let seenAt;
    await expect(lockAndFlush(api, { onLocked: () => (seenAt = calls.length) })).rejects.toThrow(
      WeblateError,
    );
    // After the lock call, before the push: a failed flush still gets unlocked.
    expect(calls.slice(0, seenAt)).toEqual(['GET /lock/', 'POST /lock/ {"lock":true}']);
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

describe('check', () => {
  it('reads the lock and the repository status, and changes nothing', async () => {
    const { calls, api } = fakeWeblate();
    expect(await check(api)).toMatchObject({ locked: false, needs_commit: false });
    expect(calls).toEqual(['GET /lock/', 'GET /repository/']);
  });
});

describe('CLI', () => {
  it('fails without WEBLATE_TOKEN and says how to set it up', () => {
    // Release prep must stop here: the push-back is only safe under our own lock.
    const r = spawnScript('scripts/weblate-sync.js', ['lock-and-flush'], {
      env: { WEBLATE_TOKEN: '' },
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/WEBLATE_TOKEN is not set/);
    expect(r.stderr).toMatch(/gh secret set WEBLATE_TOKEN/);
  });
});
