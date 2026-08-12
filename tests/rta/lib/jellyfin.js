/**
 * Minimal Jellyfin demo-server REST helpers used to authenticate and locate the
 * hero movie. Plain node http/https — no SDK dependency.
 *
 * ## A failed request is never an empty result
 *
 * Every authenticated helper below used to end in `.catch(() => null)`, so a 401 or
 * a dropped connection returned the same value as a successful query that found
 * nothing. Callers cannot tell those apart, and they read the sentinel as a fact
 * about the FIXTURE — which is how a transport failure becomes a confident false
 * statement about the demo server.
 *
 * That is not theoretical, and it is worse than a red run. Measured 2026-08-12:
 * `genreItemNames` queries its genres SEQUENTIALLY, and a session eviction partway
 * through the loop made the first two genres return their items and the remaining
 * twelve return empty sets. The output was not an error — it was a coherent, fully
 * plausible picture of a demo server whose content had thinned to two genres, which
 * was then written up as a finding and reasoned from. All 14 genres were populated
 * the whole time. The reader who believed it had this exact defect open in front of
 * them, having just diagnosed it.
 *
 * The rule that follows: **absence is only ever reported from a request that
 * SUCCEEDED.** `findMovie` may still say "not in the library", `getLibraries` may
 * still return `[]` — but only after the server actually answered. Anything else
 * throws, and the run stops rather than reasoning from a fiction.
 *
 * The one deliberate exception is marked at its call site in `authenticate`.
 */
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import { FAILURE_KINDS, recordFailure } from '../../../scripts/run-record.js';
import { RTA_CONFIG } from '../config.js';

/**
 * A request that reached a verdict we cannot use — a non-2xx status, or a transport
 * error with no status at all.
 *
 * Typed rather than a bare `Error` so the run record can tell an INFRASTRUCTURE
 * failure from an app failure. A 401 midway through a suite says nothing about the
 * app; counting it red inflates a flake rate and counting it green hides a real
 * failure, so `rta-run.js` marks the run a non-sample and drops it from the
 * population. Same partition, and same reasoning, as `crashed`/`interrupted` in
 * `scripts/run-record.js`.
 */
export class JellyfinRequestError extends Error {
  constructor(method, urlStr, status, statusMessage, cause) {
    const where = `${method} ${urlStr}`;
    super(status ? `${where} -> ${status} ${statusMessage}` : `${where} -> ${cause?.message}`);
    this.name = 'JellyfinRequestError';
    /** HTTP status, or `null` when the request never got one (DNS, reset, timeout). */
    this.status = status ?? null;
    this.url = urlStr;
    if (cause) this.cause = cause;
  }

  /** A dead or evicted session, as opposed to a request the server refused on merit. */
  get isAuth() {
    return this.status === 401 || this.status === 403;
  }
}

/** True for anything this module throws because the SERVER, not the app, failed us. */
export const isRequestError = (e) => e instanceof JellyfinRequestError;

/**
 * Write the failure into the run record, at the throw site, before it propagates.
 *
 * Recorded HERE and not where it surfaces because by the time it surfaces the cause
 * is gone: a 401 inside `getLibraries` reaches the operator as an assertion failure
 * in a screen test several frames away, and the exit code cannot tell the parent
 * process the difference. This is the only place that still knows the request failed
 * and why. Same reasoning as `diagnostics.js` capturing device state at its throw
 * site — a cause not written down when it happens is not recoverable afterwards.
 *
 * Best-effort by construction: a record that cannot be written must never replace the
 * error it was describing.
 */
function fail(err) {
  try {
    recordFailure({
      kind: FAILURE_KINDS.SERVER_REQUEST_FAILED,
      at: new Date().toISOString(),
      message: err.message,
      status: err.status,
      url: err.url,
      isAuth: err.isAuth || undefined,
    });
  } catch {
    /* the error we return is the signal that matters */
  }
  return err;
}

/**
 * Modern Jellyfin auth header for an authenticated request. Newer servers (e.g. the v12 unstable
 * demo) REJECT the legacy `X-Emby-Token` (401) and `X-Emby-Authorization` (400) headers; the
 * `Authorization: MediaBrowser ...` form is what current Jellyfin and JellyRock itself send, and
 * 10.x accepts it too — so this one header works across every demo server.
 */
export const tokenHeader = (token) => ({ Authorization: `MediaBrowser Token="${token}"` });

/** JSON POST over node http/https (picks the module by URL scheme). */
export function postJson(urlStr, headers, bodyObj) {
  const url = new URL(urlStr);
  const mod = url.protocol === 'http:' ? http : https;
  const body = JSON.stringify(bodyObj);
  return new Promise((resolve, reject) => {
    const req = mod.request(
      url,
      { method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(JSON.parse(data));
          else
            reject(
              fail(new JellyfinRequestError('POST', urlStr, res.statusCode, res.statusMessage)),
            );
        });
      },
    );
    req.on('error', (e) => reject(fail(new JellyfinRequestError('POST', urlStr, null, null, e))));
    req.write(body);
    req.end();
  });
}

/** JSON GET over node http/https. */
export function getJson(urlStr, headers) {
  const url = new URL(urlStr);
  const mod = url.protocol === 'http:' ? http : https;
  return new Promise((resolve, reject) => {
    const req = mod.request(url, { method: 'GET', headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(JSON.parse(data));
        else
          reject(fail(new JellyfinRequestError('GET', urlStr, res.statusCode, res.statusMessage)));
      });
    });
    req.on('error', (e) => reject(fail(new JellyfinRequestError('GET', urlStr, null, null, e))));
    req.end();
  });
}

/**
 * GET raw bytes (e.g. an image) as a Buffer.
 *
 * Types its failures like every other request here even though its only caller
 * (`capture-screenshots.js`, fetching a backdrop) discards the error and falls back.
 * An untyped straggler would make the module's rule — every request throws
 * `JellyfinRequestError` — false, and a rule with one undocumented exception is one
 * a reader has to go and check rather than rely on.
 */
export function getBuffer(urlStr, headers) {
  const url = new URL(urlStr);
  const mod = url.protocol === 'http:' ? http : https;
  return new Promise((resolve, reject) => {
    const req = mod.request(url, { method: 'GET', headers }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(
          fail(new JellyfinRequestError('GET', urlStr, res.statusCode, res.statusMessage)),
        );
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', (e) => reject(fail(new JellyfinRequestError('GET', urlStr, null, null, e))));
    req.end();
  });
}

/**
 * The DeviceId a session is minted under.
 *
 * **Jellyfin keys a session to its DeviceId, and authenticating again under the same
 * one EVICTS the previous session's token.** Verified against the demo server
 * 2026-08-12: a second `AuthenticateByName` with an identical DeviceId turned the
 * first token into a 401 on the next request.
 *
 * Every Node-side helper here — the RTA suite, `capture-screenshots.js`,
 * `demos/run.mjs` — used to authenticate as the literal string
 * `"jellyrock-screenshots"`, so any two of them running at once logged each other
 * out. `device-lock.js` hid this by serializing them on ONE device; it becomes
 * reachable the moment two devices are driven at once, which is exactly the
 * two-suite contention experiment. It cost a real run: a probe sharing the DeviceId
 * killed a suite's token 66 s into a 12-minute run, and every server-derived
 * expectation for the rest of that file was computed from swallowed 401s.
 *
 * Per ROLE and per DEVICE, so neither axis can collide: two tools on one device get
 * different ids, and one tool on two devices does too. Stable across runs rather
 * than random per process, so the demo server reuses a session instead of
 * accumulating one per invocation — and the id reads as what it is in the server's
 * session list, which is the difference between debuggable and not.
 *
 * The discriminator is the run's `deviceKey` (the lock already resolved it, and
 * `run-record.js` puts it on the child's env). It falls back to a hash of `ROKU_IP`
 * for the degraded-lock path and for entry points that never took a lock — hashed,
 * not raw, because a LAN address is the device's own business and this string is
 * sent to a third-party server.
 */
export function sessionDeviceId(role, deviceKey) {
  const disc =
    deviceKey ||
    process.env.RTA_DEVICE_KEY ||
    crypto
      .createHash('sha256')
      .update(process.env.ROKU_IP || 'no-device')
      .digest('hex')
      .slice(0, 16);
  return `jellyrock-${role}-${disc}`;
}

/**
 * Authenticate against the demo Jellyfin server -> session used to seed registry.
 *
 * `role` names the tool, and rides into the DeviceId — see `sessionDeviceId` for why
 * two callers must never share one. Defaults to `rta` because the suite is the
 * caller that matters most; the other entry points name themselves.
 */
export async function authenticate(server, { role = 'rta', deviceKey } = {}) {
  const deviceId = sessionDeviceId(role, deviceKey);
  const auth =
    `MediaBrowser Client="JellyRock-${role}", Device="${role}", ` +
    `DeviceId="${deviceId}", Version="1.0.0"`;
  const d = await postJson(
    `${server.url}/Users/AuthenticateByName`,
    { 'Content-Type': 'application/json', Authorization: auth },
    { Username: server.username, Pw: server.password },
  );
  // AuthenticateByName carries no server NAME (only ServerId); the human-readable
  // name lives on the unauthenticated public-info endpoint. seedServerSelect needs
  // it for the saved-server picker entry, so fetch it once here.
  //
  // THE ONE DELIBERATE SWALLOW IN THIS FILE, and it is narrow on purpose: the value
  // is a cosmetic label, the failure cannot be mistaken for a fact about the library
  // (an empty name renders an empty label; nothing downstream reasons from it), and
  // the request is unauthenticated so it cannot mask a session problem. Every other
  // helper here throws — see the module header.
  const info = await getJson(`${server.url}/System/Info/Public`, {}).catch(() => null);
  return {
    serverUrl: server.url,
    userId: d.User.Id,
    username: d.User.Name,
    token: d.AccessToken,
    serverId: d.ServerId,
    serverName: info?.ServerName || '',
    primaryImageTag: d.User?.PrimaryImageTag || '',
    // Carried so a failure can name the identity it was minted under. `serverId` and
    // `userId` cannot do that job: the stable and unstable demo backends are cloned
    // from one seed DB and report IDENTICAL values for both (measured 2026-08-12 —
    // 10.11.11 vs 12.0.0, same `f0b3381…`), so they distinguish neither the server
    // nor the client. `serverUrl` separates the backends; this separates the tools.
    deviceId,
  };
}

/**
 * Locate a movie by Name within the Movies grid. The grid is sorted by SortName
 * ascending (verified to match the app's grid order), so the item's index in this
 * list IS its grid tile index — the number of Right presses from the first tile to
 * focus it.
 *
 * Returns { index, id, backdropUrl } ({0, '', ''} if the movie isn't found).
 * backdropUrl is the promo still (a fallback only — see prepareBackdrop).
 */
export async function findMovie(session, movieName) {
  const url =
    `${session.serverUrl}/Items?UserId=${session.userId}` +
    `&IncludeItemTypes=Movie&Recursive=true&SortBy=SortName&SortOrder=Ascending`;
  // Throws on a failed request. The `{ index: 0, id: '' }` miss below is reserved for
  // a query that SUCCEEDED and did not list the movie — a fact about the library, and
  // one a caller may legitimately act on. A request that never answered is not that.
  const data = await getJson(url, tokenHeader(session.token));
  const items = data?.Items || [];
  const index = items.findIndex((i) => i.Name === movieName);
  if (index < 0) return { index: 0, id: '', backdropUrl: '' };
  const item = items[index];
  const hasBackdrop = Array.isArray(item.BackdropImageTags) && item.BackdropImageTags.length > 0;
  const kind = hasBackdrop ? 'Backdrop/0' : 'Primary';
  return {
    index,
    id: item.Id,
    backdropUrl: `${session.serverUrl}/Items/${item.Id}/Images/${kind}?maxWidth=1920`,
  };
}

/** The movie used by movieDetails + osd (RTA_CONFIG.heroMovie). */
export const getHero = (session) => findMovie(session, RTA_CONFIG.heroMovie);

/**
 * First movie (by SortName) on a server, with its title — `{ id, name }` (or `{ '', '' }`).
 * Resolved at runtime so a take never assumes a specific title exists on a given demo server
 * (e.g. the cast-to-another-server take needs a real movie + name on the TARGET server, which
 * may differ from RTA_CONFIG.heroMovie). The name feeds the cast's `itemName` switch-prompt arg.
 */
export async function firstMovie(session) {
  const url =
    `${session.serverUrl}/Items?UserId=${session.userId}` +
    `&IncludeItemTypes=Movie&Recursive=true&SortBy=SortName&SortOrder=Ascending&Limit=1`;
  // Throws on a failed request; the empty result below means the server answered and
  // the library has no movies. See the module header.
  const data = await getJson(url, tokenHeader(session.token));
  const item = data?.Items?.[0];
  return item ? { id: item.Id, name: item.Name } : { id: '', name: '' };
}

/**
 * Fetch the user's libraries, resolved at RUNTIME so we never hardcode a library
 * GUID (those are minted when a library is created and die if it's recreated /
 * the server is rebuilt). Returns [{ name, collectionType, id }]; callers key off
 * the STABLE collectionType ("movies" | "tvshows" | "music" | "playlists" | ...)
 * and read the current id from here. Used to seed a deterministic landing view
 * (display.<id>.landing) per library.
 */
export async function getLibraries(session) {
  const url = `${session.serverUrl}/Users/${session.userId}/Views`;
  // Throws on a failed request, and this one is the sharpest case in the file.
  // `screens.spec.js` skips a screen when `libraryIdFor` finds no library of its
  // collectionType — correctly, since a fixture without a Music library is a
  // statement about the fixture, not a regression. But a swallowed 401 here returned
  // `[]`, which drove that same skip with the message `server has no "movies"
  // library` — false, and GREEN. Since this runs once in `beforeAll`, one swallowed
  // 401 would skip every view-based screen and report the run a success. A failing
  // request must never be able to buy a pass.
  const data = await getJson(url, tokenHeader(session.token));
  return (data?.Items || []).map((i) => ({
    name: i.Name,
    collectionType: i.CollectionType,
    id: i.Id,
  }));
}

/**
 * Every genre in a library, mapped to the FULL set of item names the server files
 * under it: `Map<genreName, Set<itemName>>`.
 *
 * Mirrors the query `LoadItemsTask2` makes per genre row (same parentId, same
 * includeItemTypes, recursive) but without its `Limit: 6` / `SortBy: Random`, so
 * the result is the complete membership a sampled row must draw from. Resolved at
 * runtime — the demo server's content is not a fixed contract.
 */
export async function genreItemNames(session, libraryId, includeItemTypes) {
  const headers = tokenHeader(session.token);
  const base = `${session.serverUrl}/Items?userId=${session.userId}&parentId=${libraryId}`;
  // Both queries throw. This helper is where the swallow did its worst damage, and
  // the loop is why: it fetches the genres one at a time, so a session that dies
  // partway through returns real items for the genres before the break and empty sets
  // for every genre after it. Nothing errors, and the result is a perfectly coherent
  // "this library's later genres are empty" — a shape no reader questions.
  //
  // The empty set is also the tell that it was always a lie: `/Genres` only lists
  // genres that EXIST in the library, so a genre with no items is self-contradictory.
  // Measured 2026-08-12 with the catches removed: all 14 movie genres populated, all
  // 14 queries fine. The two-genre reading that a swallowed run produced an hour
  // earlier was pure artifact.
  const genres = await getJson(
    `${session.serverUrl}/Genres?userId=${session.userId}` +
      `&parentId=${libraryId}&includeItemTypes=${includeItemTypes}`,
    headers,
  );

  const byGenre = new Map();
  for (const genre of genres?.Items || []) {
    const items = await getJson(
      `${base}&genreIds=${genre.Id}&recursive=true` +
        `&includeItemTypes=${includeItemTypes}&enableTotalRecordCount=false`,
      headers,
    );
    byGenre.set(genre.Name, new Set((items?.Items || []).map((i) => i.Name)));
  }
  return byGenre;
}

/** Resolve a stable collectionType to the current library id (or null). */
export function libraryIdFor(libraries, collectionType) {
  const lib = (libraries || []).find((l) => l.collectionType === collectionType);
  return lib ? lib.id : null;
}

/**
 * First item id of a given Jellyfin type (Recursive, SortName), or '' if none.
 * Used by the deep-link specs to cast a real id resolved at runtime (never
 * hardcoded), e.g. an 'Audio' item to exercise the instantmix action.
 *
 * NOTE — the instantmix spec ASSUMES the demo server's library is large enough that
 * `/Items/<this id>/InstantMix` returns a NON-empty mix. The beforeAll guard only checks the
 * id resolved (not that it yields a mix), so on a too-small demo audio library the instantmix
 * test fails as a generic `waitMediaPlaying` timeout, not an obvious "demo can't build a mix".
 */
export async function firstItemId(session, includeItemTypes) {
  const url =
    `${session.serverUrl}/Items?UserId=${session.userId}` +
    `&IncludeItemTypes=${includeItemTypes}&Recursive=true&SortBy=SortName&SortOrder=Ascending&Limit=1`;
  // Throws on a failed request; `''` means the server answered and has no such item.
  // The deeplink spec's beforeAll guard reads that miss as "the fixture cannot support
  // this test", which is only true when the server actually said so.
  const data = await getJson(url, tokenHeader(session.token));
  return data?.Items?.[0]?.Id || '';
}
