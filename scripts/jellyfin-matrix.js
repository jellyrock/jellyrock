// scripts/jellyfin-matrix.js — send one Jellyfin API request to a server of each
// version and print what each one returns.
//
// Used to check how an endpoint or parameter behaves across releases before code
// depends on it (docs/dev/jellyfin-server-versioning.md §4): a parameter that one
// version honors can be ignored by the next without leaving the spec, and only a
// live request tells you which.
//
// Usage:
//   npm run jellyfin:matrix -- '/Shows/NextUp?UserId={userId}&DisableFirstEpisode=true'
//   npm run jellyfin:matrix -- '<path?query>' --json
//
// `{userId}` is replaced with the signed-in user's id on each server. The request
// is a GET. Servers come from JELLYFIN_VERSION_SERVERS (comma-separated base URLs),
// signed in as JELLYFIN_VERSION_SERVERS_USER / _PASS — see .env.example.
//
// Exit: 0 = every server answered (any HTTP status) · 1 = a server could not be
// reached or signed in to · 2 = bad usage or configuration.

import './lib/load-env.cjs';
import http from 'node:http';
import https from 'node:https';
import { pathToFileURL } from 'node:url';

const REQUEST_TIMEOUT_MS = 15000;
const CLIENT_AUTH =
  'MediaBrowser Client="JellyRock-matrix", Device="jellyfin-matrix", ' +
  'DeviceId="jellyrock-jellyfin-matrix", Version="1.0.0"';

/**
 * @param {string|undefined} value - JELLYFIN_VERSION_SERVERS
 * @returns {string[]} base URLs, trailing slashes removed
 */
export function parseServerList(value) {
  return String(value ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

/**
 * @param {string} baseUrl
 * @param {string} pathQuery - e.g. `/Shows/NextUp?UserId={userId}`
 * @param {string} userId
 * @returns {string}
 */
export function buildRequestUrl(baseUrl, pathQuery, userId) {
  const rel = pathQuery.startsWith('/') ? pathQuery : `/${pathQuery}`;
  return baseUrl + rel.replaceAll('{userId}', encodeURIComponent(userId));
}

/**
 * How many items a response holds: an `Items` array (query results), a bare
 * array, or null when the body is neither (a single object, text, or an error).
 *
 * @param {string} body
 * @returns {number|null}
 */
export function countItems(body) {
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    return null;
  }
  if (Array.isArray(data)) return data.length;
  if (data && Array.isArray(data.Items)) return data.Items.length;
  return null;
}

/**
 * @param {Array<{server: string, version?: string, status?: number, items?: number|null,
 *   bytes?: number, ms?: number, error?: string}>} rows
 * @returns {string}
 */
export function formatTable(rows) {
  const header = ['server', 'version', 'status', 'items', 'bytes', 'ms'];
  const cells = rows.map((r) =>
    r.error
      ? [r.server, r.version ?? '?', `ERROR: ${r.error}`, '', '', '']
      : [
          r.server,
          r.version,
          String(r.status),
          r.items == null ? '-' : String(r.items),
          String(r.bytes),
          String(r.ms),
        ],
  );
  const widths = header.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i].length)));
  const line = (c) =>
    c
      .map((v, i) => v.padEnd(widths[i]))
      .join('  ')
      .trimEnd();
  return [line(header), line(widths.map((w) => '-'.repeat(w))), ...cells.map(line)].join('\n');
}

// One HTTP request, resolving with the status and the body as text for any
// status. Rejects only when no response arrives (network error or timeout).
function request(urlStr, { method = 'GET', headers = {}, body } = {}) {
  const url = new URL(urlStr);
  const mod = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(url, { method, headers, timeout: REQUEST_TIMEOUT_MS }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error(`timed out after ${REQUEST_TIMEOUT_MS} ms`)));
    req.on('error', reject);
    req.end(body);
  });
}

async function requestJson(urlStr, init, what) {
  const res = await request(urlStr, init);
  if (res.status < 200 || res.status >= 300) throw new Error(`${what} returned HTTP ${res.status}`);
  return JSON.parse(res.body.toString('utf8'));
}

async function queryServer(baseUrl, pathQuery, username, password) {
  const row = { server: baseUrl };
  try {
    const info = await requestJson(`${baseUrl}/System/Info/Public`, {}, 'System/Info/Public');
    row.version = info.Version;

    const auth = await requestJson(
      `${baseUrl}/Users/AuthenticateByName`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: CLIENT_AUTH },
        body: JSON.stringify({ Username: username, Pw: password }),
      },
      'sign-in',
    );
    const tokenAuth = `${CLIENT_AUTH}, Token="${auth.AccessToken}"`;

    try {
      const started = performance.now();
      const res = await request(buildRequestUrl(baseUrl, pathQuery, auth.User.Id), {
        headers: { Authorization: tokenAuth },
      });
      row.ms = Math.round(performance.now() - started);
      row.status = res.status;
      row.bytes = res.body.length;
      row.items = countItems(res.body.toString('utf8'));
    } finally {
      // Best effort: end the session so repeated runs do not pile up tokens.
      await request(`${baseUrl}/Sessions/Logout`, {
        method: 'POST',
        headers: { Authorization: tokenAuth },
      }).catch(() => {});
    }
  } catch (err) {
    row.error = err.code ?? err.message;
  }
  return row;
}

async function main(argv) {
  const json = argv.includes('--json');
  const positional = argv.filter((a) => !a.startsWith('--'));
  if (positional.length !== 1) {
    console.error("usage: npm run jellyfin:matrix -- '<path?query>' [--json]");
    console.error("  e.g. '/Shows/NextUp?UserId={userId}&DisableFirstEpisode=true'");
    return 2;
  }
  const servers = parseServerList(process.env.JELLYFIN_VERSION_SERVERS);
  const username = process.env.JELLYFIN_VERSION_SERVERS_USER;
  if (servers.length === 0 || !username) {
    console.error(
      'jellyfin:matrix: set JELLYFIN_VERSION_SERVERS and JELLYFIN_VERSION_SERVERS_USER (see .env.example)',
    );
    return 2;
  }
  const password = process.env.JELLYFIN_VERSION_SERVERS_PASS ?? '';

  // One server at a time, so each timing is not shared with the others.
  const rows = [];
  for (const server of servers) {
    rows.push(await queryServer(server, positional[0], username, password));
  }

  if (json) process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
  else console.log(formatTable(rows));
  return rows.some((r) => r.error) ? 1 : 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`jellyfin:matrix: ${err.message}`);
      process.exit(2);
    },
  );
}
