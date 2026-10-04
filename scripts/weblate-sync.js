/**
 * Bracket release prep's translation merge with Weblate's own repository state.
 *
 *   node scripts/weblate-sync.js check             read-only: does the token work, what state is Weblate in
 *   node scripts/weblate-sync.js lock-and-flush    lock the component, commit + push what Weblate holds
 *   node scripts/weblate-sync.js pull-and-unlock   make Weblate pull the weblate branch, then unlock
 *
 * Env: `WEBLATE_TOKEN` (required: a project token for `jellyrock` in a team with the
 * "Manage repository" role; setup in docs/architecture/translations.md#weblate-sync),
 * optional `WEBLATE_URL` (default https://translate.jellyrock.app) and
 * `WEBLATE_COMPONENT` (default `jellyrock/roku`).
 *
 * ## Why
 *
 * Weblate keeps translator edits in its own clone until it commits and pushes them to
 * the `weblate` branch. Release prep merges that branch into the release and then
 * pushes main's additions back to it. Without a flush, edits still inside Weblate are
 * missed by the release; and if Weblate commits next to a line the push-back
 * changed, its next pull hits a merge conflict, which (with `auto_lock_error`) locks
 * the component until an admin clears it. Locking first stops new edits arriving
 * mid-merge; the pull afterwards hands Weblate the merged branch before translators
 * resume. That is why the token is required: without the lock the push-back is
 * unsafe, so release prep stops rather than run it.
 *
 * ## Only ever unlock our own lock
 *
 * A component that is already locked was locked by an admin or by Weblate itself
 * after an error. `lock-and-flush` refuses to touch it, and reports `locked=true`
 * (a GitHub step output) only once its own lock succeeded; the unlock step runs on
 * that output alone.
 *
 * ## Checked by outcome, not by response shape
 *
 * A component repository operation answers `{ "result": bool }` (the instance's own
 * OpenAPI schema, checked 2026-10-04 on Weblate 2026.8.1); a queued task (HTTP 202 +
 * `task_url`) is handled too, as project-level operations answer that way. Rather
 * than trust either, `lock-and-flush` then reads the documented repository status:
 * it succeeds only when nothing is left to commit or push.
 */
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DEFAULT_URL = 'https://translate.jellyrock.app';
const DEFAULT_COMPONENT = 'jellyrock/roku';

export class WeblateError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WeblateError';
  }
}

/** A tiny client over `fetch`, injectable for tests. */
export function client({
  token,
  url = DEFAULT_URL,
  component = DEFAULT_COMPONENT,
  fetchImpl = fetch,
  sleep,
} = {}) {
  const base = `${url.replace(/\/$/, '')}/api/components/${component}`;
  const wait = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  async function call(method, pathOrUrl, body) {
    const target = pathOrUrl.startsWith('http') ? pathOrUrl : `${base}/${pathOrUrl}/`;
    const res = await fetchImpl(target, {
      method,
      headers: {
        Authorization: `Token ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (!res.ok && res.status !== 202) {
      throw new WeblateError(
        `${method} ${target} → HTTP ${res.status}: ${data.detail ?? text.slice(0, 200)}`,
      );
    }
    return { status: res.status, data };
  }

  /** Run a repository operation; wait for it if Weblate queued it. */
  async function operation(name, { attempts = 60, intervalMs = 5000 } = {}) {
    const { data } = await call('POST', 'repository', { operation: name });
    if (data.result === false) throw new WeblateError(`Weblate ${name} reported failure`);
    if (!data.task_url) return;
    for (let i = 0; i < attempts; i++) {
      const task = (await call('GET', data.task_url)).data;
      if (task.completed) return;
      await wait(intervalMs);
    }
    throw new WeblateError(
      `Weblate ${name} did not finish within ${(attempts * intervalMs) / 1000}s`,
    );
  }

  return {
    isLocked: async () => (await call('GET', 'lock')).data.locked === true,
    lock: (locked) => call('POST', 'lock', { lock: locked }),
    repositoryStatus: async () => (await call('GET', 'repository')).data,
    operation,
  };
}

/**
 * @param {object} api
 * @param {{ onLocked?: () => void }} [hooks] - called once OUR lock is in place
 */
export async function lockAndFlush(api, { onLocked = () => {} } = {}) {
  if (await api.isLocked()) {
    throw new WeblateError(
      'the component is already locked — by an admin, or by Weblate after a repository error. ' +
        'Resolve it in Weblate, unlock the component, then re-run release prep.',
    );
  }
  await api.lock(true);
  onLocked();
  // `push` commits pending changes first (Weblate's do_push(force_commit=True)).
  await api.operation('push');
  const status = await api.repositoryStatus();
  if (status.needs_commit || status.needs_push) {
    throw new WeblateError(
      `Weblate still holds unflushed changes (needs_commit=${status.needs_commit}, needs_push=${status.needs_push})` +
        (status.merge_failure ? `: ${status.merge_failure}` : ''),
    );
  }
}

export async function pullAndUnlock(api) {
  try {
    await api.operation('pull');
    const status = await api.repositoryStatus();
    // Not `needs_merge`: jellyrock-bot pushes en_US to weblate on every main push, so
    // it can be true here even though this pull succeeded.
    if (status.merge_failure)
      throw new WeblateError(`Weblate could not merge the weblate branch: ${status.merge_failure}`);
  } finally {
    // Always unlock: a component left locked stops every translator.
    await api.lock(false);
  }
}

/** Read-only: proves the token can read the repository status, and shows the state. */
export async function check(api) {
  const locked = await api.isLocked();
  const status = await api.repositoryStatus();
  return { locked, ...status };
}

const SETUP = [
  'WEBLATE_TOKEN is not set. Release prep needs it to lock Weblate around the translation merge.',
  'Create a project token in Weblate (project jellyrock → API access), give it only the team',
  'with the "Manage repository" role, check it with `WEBLATE_TOKEN=… node scripts/weblate-sync.js check`,',
  'then store it: gh secret set WEBLATE_TOKEN -R jellyrock/jellyrock',
].join(' ');

/** Append `name=value` to the GitHub step output, when running in Actions. */
function stepOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

async function main(argv) {
  const token = process.env.WEBLATE_TOKEN;
  if (!token) throw new WeblateError(SETUP);
  const api = client({
    token,
    url: process.env.WEBLATE_URL || DEFAULT_URL,
    component: process.env.WEBLATE_COMPONENT || DEFAULT_COMPONENT,
  });
  const [command] = argv;
  if (command === 'check') console.log(JSON.stringify(await check(api), null, 2));
  else if (command === 'lock-and-flush')
    await lockAndFlush(api, { onLocked: () => stepOutput('locked', 'true') });
  else if (command === 'pull-and-unlock') await pullAndUnlock(api);
  else
    throw new WeblateError(
      `unknown command ${command ?? '(none)'} — expected check, lock-and-flush or pull-and-unlock`,
    );
  console.log(`weblate-sync: ${command} done.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`::error::weblate-sync FAILED — ${e.message}`);
    process.exit(1);
  });
}
