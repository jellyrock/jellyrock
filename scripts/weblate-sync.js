/**
 * Bracket release prep's translation merge with Weblate's own repository state.
 *
 *   node scripts/weblate-sync.js lock-and-flush    lock the component, commit + push what Weblate holds
 *   node scripts/weblate-sync.js pull-and-unlock   make Weblate pull the weblate branch, then unlock
 *
 * Env: `WEBLATE_TOKEN` (a project token for `jellyrock`), optional `WEBLATE_URL`
 * (default https://translate.jellyrock.app) and `WEBLATE_COMPONENT`
 * (default `jellyrock/roku`).
 *
 * ## Why
 *
 * Weblate keeps translator edits in its own clone until it commits and pushes them to
 * the `weblate` branch. Release prep merges that branch into the release and then
 * pushes main's additions back to it. Without a flush, edits still inside Weblate are
 * missed by the release; and if Weblate commits next to a line the push-back
 * changed, its next pull hits a merge conflict an admin must clear by hand. Locking
 * first stops new edits arriving mid-merge; the pull afterwards hands Weblate the
 * merged branch before translators resume.
 *
 * ## Checked by outcome, not by response shape
 *
 * Depending on the Weblate version, a repository operation answers with
 * `{ "result": bool }` or queues a task (HTTP 202 + `task_url`). Rather than trust
 * either, `lock-and-flush` polls a queued task to completion and then reads the
 * documented repository status: it succeeds only when nothing is left to commit or
 * push.
 */
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
    lock: (locked) => call('POST', 'lock', { lock: locked }),
    repositoryStatus: async () => (await call('GET', 'repository')).data,
    operation,
  };
}

export async function lockAndFlush(api) {
  await api.lock(true);
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
    if (status.merge_failure)
      throw new WeblateError(`Weblate could not merge the weblate branch: ${status.merge_failure}`);
  } finally {
    // Always unlock: a component left locked stops every translator.
    await api.lock(false);
  }
}

async function main(argv) {
  const token = process.env.WEBLATE_TOKEN;
  if (!token) {
    console.log(
      '::warning::WEBLATE_TOKEN is not set — skipping the Weblate flush. Edits still inside Weblate wait for the next release.',
    );
    return;
  }
  const api = client({
    token,
    url: process.env.WEBLATE_URL || DEFAULT_URL,
    component: process.env.WEBLATE_COMPONENT || DEFAULT_COMPONENT,
  });
  const [command] = argv;
  if (command === 'lock-and-flush') await lockAndFlush(api);
  else if (command === 'pull-and-unlock') await pullAndUnlock(api);
  else
    throw new WeblateError(
      `unknown command ${command ?? '(none)'} — expected lock-and-flush or pull-and-unlock`,
    );
  console.log(`weblate-sync: ${command} done.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`::error::weblate-sync FAILED — ${e.message}`);
    process.exit(1);
  });
}
