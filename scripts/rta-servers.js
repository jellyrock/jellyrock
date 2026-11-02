/**
 * Run the RTA suite against each Jellyfin server in JELLYFIN_VERSION_SERVERS, one
 * after the other, then print one table.
 *
 *   npm run test:rta:servers -- <vitest filter args>
 *
 * It builds once, then runs `scripts/rta-run.js` per server with RTA_SERVER_URL set to
 * that server and RTA_SERVER_USER / RTA_SERVER_PASS taken from
 * JELLYFIN_VERSION_SERVERS_USER / _PASS. The arguments pass straight through to Vitest.
 * Exit 1 when any server failed, 2 on bad configuration.
 *
 * A run the device lock refuses waits and retries, because another session holding the
 * device is the ordinary reason. Any other failure is recorded and the loop goes on.
 */
import './lib/load-env.cjs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { parseServerList } from './jellyfin-matrix.js';
import { pruneConsoles } from './lib/console-capture.js';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LOCK_RETRY_MS = 30_000;
export const LOCK_MAX_RETRIES = 20;
const CONSOLE_DIR = path.join('.device-runs', 'rta', 'servers');

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

export const stripAnsi = (text) => String(text).replace(ANSI, '');

/** The device lock refuses with "The Roku at <host> is in use by ...". */
export const isLockRefusal = (output) => stripAnsi(output).includes('is in use by');

/** Vitest's summary line, for example `Tests  3 passed (3)`; null when it never printed one. */
export function parseTestsLine(output) {
  const m = stripAnsi(output).match(/^\s*Tests\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

/** @returns {Record<string, string>} the environment one server's run needs */
export function serverEnv(url, user, pass, consoleFile) {
  return {
    RTA_SERVER_URL: url,
    RTA_SERVER_USER: user,
    RTA_SERVER_PASS: pass ?? '',
    RTA_CONSOLE_LOG: consoleFile,
  };
}

/**
 * @param {Array<{index: number, version?: string|null, tests?: string|null, code: number,
 *   consoleFile?: string, note?: string}>} rows
 */
export function formatSummary(rows) {
  const header = ['server', 'version', 'result', 'tests', 'console'];
  const cells = rows.map((r) => [
    `#${r.index}`,
    r.version ?? '?',
    r.code === 0 ? 'passed' : `FAILED (${r.code})`,
    r.tests ?? r.note ?? '-',
    r.consoleFile ?? '-',
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i].length)));
  const line = (c) =>
    c
      .map((v, i) => v.padEnd(widths[i]))
      .join('  ')
      .trimEnd();
  return [line(header), line(widths.map((w) => '-'.repeat(w))), ...cells.map(line)].join('\n');
}

async function serverVersion(url) {
  try {
    const res = await fetch(`${url}/System/Info/Public`, { signal: AbortSignal.timeout(5000) });
    return res.ok ? (await res.json()).Version : null;
  } catch {
    return null;
  }
}

// One rta-run child, output printed through and also collected.
function runChild(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(repoRoot, 'scripts', 'rta-run.js'), ...args], {
      cwd: repoRoot,
      env: { ...process.env, ...env },
    });
    let output = '';
    const tee = (stream) => (chunk) => {
      stream.write(chunk);
      output += chunk.toString();
    };
    child.stdout.on('data', tee(process.stdout));
    child.stderr.on('data', tee(process.stderr));
    child.on('error', (e) => resolve({ code: 1, output: `${output}\n${e.message}` }));
    child.on('exit', (code, signal) => resolve({ code: signal ? 130 : (code ?? 1), output }));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main(argv) {
  const servers = parseServerList(process.env.JELLYFIN_VERSION_SERVERS);
  const user = process.env.JELLYFIN_VERSION_SERVERS_USER;
  if (servers.length === 0 || !user) {
    console.error(
      'test:rta:servers: set JELLYFIN_VERSION_SERVERS and JELLYFIN_VERSION_SERVERS_USER (see .env.example)',
    );
    return 2;
  }
  const pass = process.env.JELLYFIN_VERSION_SERVERS_PASS;

  if (process.env.RTA_NO_DEPLOY !== '1') {
    console.log('[servers] building once ...');
    const built = spawnSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'inherit' });
    if (built.status !== 0) return 1;
  }

  const rows = [];
  let deployed = process.env.RTA_NO_DEPLOY === '1';
  for (const [i, url] of servers.entries()) {
    const index = i + 1;
    const consoleFile = path.join(CONSOLE_DIR, `console-${Date.now()}-${index}.log`);
    const version = await serverVersion(url);
    console.log(
      `\n[servers] #${index} of ${servers.length}${version ? ` (Jellyfin ${version})` : ''}`,
    );
    const env = serverEnv(url, user, pass, consoleFile);
    let result;
    for (let attempt = 0; ; attempt += 1) {
      // After one run has deployed, the same build is already on the device.
      result = await runChild(argv, deployed ? { ...env, RTA_NO_DEPLOY: '1' } : env);
      if (!isLockRefusal(result.output) || attempt >= LOCK_MAX_RETRIES) break;
      console.log(`[servers] device busy, retrying in ${LOCK_RETRY_MS / 1000} s`);
      await sleep(LOCK_RETRY_MS);
    }
    if (result.output.includes('[rta] deploying') && parseTestsLine(result.output)) deployed = true;
    rows.push({
      index,
      version,
      code: result.code,
      tests: parseTestsLine(result.output),
      note: isLockRefusal(result.output) ? 'device busy, gave up' : undefined,
      consoleFile,
    });
  }

  pruneConsoles(CONSOLE_DIR);
  console.log(`\n${formatSummary(rows)}`);
  console.log('Console files hold auth tokens. Keep them private.');
  return rows.some((r) => r.code !== 0) ? 1 : 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`test:rta:servers: ${err.message}`);
      process.exit(2);
    },
  );
}
