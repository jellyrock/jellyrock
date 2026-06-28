// scripts/lib/signals-fetch.cjs — Upstream version fetchers for the three
// signals tracked in docs/signals-backlog.md.
//
// Used by scripts/catchup-state.js to auto-maintain `latest_upstream` +
// `last_checked` so the watchlist reflects reality without manual journaling.
// Per-signal failures are non-fatal: the caller falls back to the file's
// existing latest_upstream and surfaces the error in `_errors.signals_fetch`.
//
// `.cjs` because scripts/catchup-state.js is ESM and uses createRequire — see
// scripts/CLAUDE.md ("Module system rule"): anything required by a .cjs is
// .cjs, and ESM CAN require .cjs but the reverse is messy. Pure CJS here keeps
// us future-proof.

const https = require('node:https');

const USER_AGENT = 'jellyrock-catchup-state/1.0 (+https://github.com/jellyrock/jellyrock)';
const DEFAULT_TIMEOUT_MS = 5000;

// Minimal HTTPS GET with redirect-follow (max 3 hops) and timeout. Returns the
// response body as a UTF-8 string, or rejects with a one-line error.
function httpGet(url, { timeoutMs = DEFAULT_TIMEOUT_MS, redirects = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html, text/plain, */*' } },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (redirects >= 3) return reject(new Error(`too many redirects fetching ${url}`));
          const next = new URL(res.headers.location, url).href;
          httpGet(next, { timeoutMs, redirects: redirects + 1 }).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => resolve(data));
      },
    );
    req.on('error', (err) => reject(new Error(`${err.code || 'ERR'}: ${url}`)));
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout fetching ${url}`)));
  });
}

// Compare two semver bases (MAJOR.MINOR.PATCH) numerically. Returns negative,
// zero, or positive. Pre-release suffixes are NOT considered here — call sites
// use this only on already-split base strings.
function compareSemverBase(a, b) {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// Pure parser for the api.jellyfin.org/openapi/stable/ index HTML.
//
// stable/ is an Apache-style directory listing. Filenames carry the version:
// `jellyfin-openapi-X.Y.Z.json` (stable) or `jellyfin-openapi-X.Y.Z-rcN.json`
// (release candidate). Pre-release also covers `-betaN` / `-alphaN` defensively.
//
// "RC in flight" rule (per user spec): only count an RC when its base version
// is GREATER than the latest stable. Otherwise the RCs are historical (already
// shipped to stable) and we report null.
//
// Exported separately so unit tests can exercise the parser without network
// mocking. The `fetchJellyfinVersions` wrapper just composes httpGet + this.
function parseJellyfinIndex(html) {
  const re = /jellyfin-openapi-(\d+\.\d+\.\d+)(?:-(rc\d+|beta\d+|alpha\d+))?\.json/g;
  const seen = new Set();
  const versions = [];
  for (let m; (m = re.exec(html));) {
    const key = m[1] + (m[2] ? '-' + m[2] : '');
    if (seen.has(key)) continue;
    seen.add(key);
    versions.push({ base: m[1], pre: m[2] || null });
  }
  if (versions.length === 0) {
    throw new Error('no jellyfin-openapi-*.json filenames matched in stable/ index');
  }

  const stables = versions.filter((v) => !v.pre);
  if (stables.length === 0) {
    throw new Error('no non-prerelease versions in jellyfin stable/ index');
  }
  stables.sort((a, b) => compareSemverBase(b.base, a.base));
  const latestStable = stables[0].base;

  const candidateRcs = versions.filter((v) => v.pre && compareSemverBase(v.base, latestStable) > 0);
  let rc = null;
  if (candidateRcs.length > 0) {
    candidateRcs.sort((a, b) => {
      const diff = compareSemverBase(b.base, a.base);
      if (diff !== 0) return diff;
      const ai = parseInt(a.pre.replace(/[a-z]+/g, ''), 10) || 0;
      const bi = parseInt(b.pre.replace(/[a-z]+/g, ''), 10) || 0;
      return bi - ai;
    });
    rc = `${candidateRcs[0].base}-${candidateRcs[0].pre}`;
  }

  return { stable: latestStable, rc };
}

async function fetchJellyfinVersions({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const html = await httpGet('https://api.jellyfin.org/openapi/stable/', { timeoutMs });
  return parseJellyfinIndex(html);
}

// Pure parser for the api.jellyfin.org/openapi/unstable/ index HTML.
//
// unstable/ is an Apache-style directory listing of IMMUTABLE master builds:
// `jellyfin-openapi-<datestamp>.json`. Recent builds carry a 14-digit
// YYYYMMDDHHMMSS stamp (20240402201942); legacy builds used a <YYYYMMDD>.<N>
// form (20240207.2). We return the NEWEST 14-digit build — lexical sort equals
// chronological order for fixed-width datestamps. The legacy `.N` builds are
// years old and structurally unsortable against the modern form, so they're
// ignored when modern stamps exist (noted here so a future maintainer isn't
// surprised that "latest" skips them).
//
// Returns a concrete datestamp string the caller can PIN (immutable, re-diffable)
// — never the mutable /openapi/ root pointer. Exported separately for unit-test
// parity with parseJellyfinIndex.
function parseUnstableIndex(html) {
  const re = /jellyfin-openapi-(\d{8}(?:\d{6}|\.\d+)?)\.json/g;
  const stamps = new Set();
  for (let m; (m = re.exec(html));) stamps.add(m[1]);
  if (stamps.size === 0) {
    throw new Error('no jellyfin-openapi-<datestamp>.json filenames matched in unstable/ index');
  }
  const modern = [...stamps].filter((s) => /^\d{14}$/.test(s));
  const pool = modern.length > 0 ? modern : [...stamps];
  pool.sort(); // lexical == chronological for fixed-width datestamps
  return pool[pool.length - 1];
}

async function fetchLatestUnstable({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const html = await httpGet('https://api.jellyfin.org/openapi/unstable/', { timeoutMs });
  return parseUnstableIndex(html);
}

// Pure parser for the rokudev/dev-doc release-notes markdown. File order is
// newest-first by author convention, so the first `## Roku OS X.Y` heading
// wins. Exported separately for unit-test parity with parseJellyfinIndex.
function parseRokuOsMarkdown(md) {
  const m = md.match(/^## Roku OS (\d+\.\d+(?:\.\d+)?)\s*$/m);
  if (!m) throw new Error('no `## Roku OS X.Y` heading in release notes markdown');
  return m[1];
}

async function fetchRokuOs({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const md = await httpGet(
    'https://raw.githubusercontent.com/rokudev/dev-doc/v2.0/docs/DEVELOPER/release-notes/index.md',
    { timeoutMs },
  );
  return parseRokuOsMarkdown(md);
}

module.exports = {
  httpGet,
  fetchJellyfinVersions,
  fetchLatestUnstable,
  fetchRokuOs,
  parseJellyfinIndex,
  parseUnstableIndex,
  parseRokuOsMarkdown,
  compareSemverBase,
};
