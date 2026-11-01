/**
 * Copy the Roku debug console (TCP port 8085) into a file for the length of a run.
 *
 * A failed RTA run used to leave no console behind, so seeing one meant a rerun with
 * a terminal attached. This is an instrument: it reports and never decides. A refused
 * or dropped connection logs one line and the run goes on, and nothing here throws.
 *
 * The file holds whatever the app printed, which includes auth tokens. It stays under
 * the gitignored `.device-runs/` and is never pasted anywhere public.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

export const CONSOLE_PORT = 8085;
const RECONNECT_DELAY_MS = 1000;
export const MAX_RECONNECTS = 20;
export const KEEP_SERVER_CONSOLES = 12;

/**
 * @param {number} attempt - 1 for the first reconnect
 * @returns {number|null} delay in ms, or null once the budget is spent
 */
export function reconnectDelay(attempt) {
  return attempt > MAX_RECONNECTS ? null : RECONNECT_DELAY_MS;
}

/**
 * Names to delete so only the newest `keep` remain.
 *
 * @param {Array<{name: string, mtimeMs: number}>} entries
 * @param {number} [keep]
 * @returns {string[]}
 */
export function consolesToPrune(entries, keep = KEEP_SERVER_CONSOLES) {
  return [...entries]
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(keep)
    .map((e) => e.name);
}

/** Delete the oldest `console-*.log` files in `dir`, keeping the newest `keep`. Never throws. */
export function pruneConsoles(dir, keep = KEEP_SERVER_CONSOLES) {
  try {
    const entries = fs
      .readdirSync(dir)
      .filter((n) => /^console-.*\.log$/.test(n))
      .map((name) => ({ name, mtimeMs: fs.statSync(path.join(dir, name)).mtimeMs }));
    for (const name of consolesToPrune(entries, keep))
      fs.rmSync(path.join(dir, name), { force: true });
  } catch {
    // Housekeeping only.
  }
}

/**
 * @param {object} opts
 * @param {string} opts.host
 * @param {string} opts.file - where the console is written (appended)
 * @param {(host: string, port: number) => import('node:net').Socket} [opts.connect]
 * @param {(msg: string) => void} [opts.log]
 * @returns {{ close: () => void, file: string }}
 */
export function startConsoleCapture({
  host,
  file,
  connect = (h, p) => net.connect({ host: h, port: p }),
  log = console.log,
}) {
  let closed = false;
  let attempt = 0;
  let socket = null;
  let timer = null;
  let announced = false;

  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '', { mode: 0o600 });
  } catch (e) {
    log(`[rta] console capture off: cannot write ${file} (${e.message})`);
    return { close() {}, file };
  }

  const complain = (why) => {
    if (announced) return;
    announced = true;
    log(`[rta] console capture: ${why}; the run goes on`);
  };

  function open() {
    if (closed) return;
    let s;
    try {
      s = connect(host, CONSOLE_PORT);
    } catch (e) {
      complain(`cannot connect (${e.message})`);
      return;
    }
    socket = s;
    s.on('connect', () => {
      attempt = 0;
    });
    s.on('data', (chunk) => {
      try {
        fs.appendFileSync(file, chunk);
      } catch {
        // A full disk must not fail the run.
      }
    });
    s.on('error', (e) => complain(`connection error (${e.code || e.message})`));
    s.on('close', () => {
      if (closed) return;
      attempt += 1;
      const delay = reconnectDelay(attempt);
      if (delay === null) return complain('gave up reconnecting');
      timer = setTimeout(open, delay);
      timer.unref?.();
    });
  }

  open();

  return {
    file,
    close() {
      closed = true;
      clearTimeout(timer);
      socket?.destroy();
    },
  };
}
