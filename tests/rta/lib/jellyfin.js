/**
 * Minimal Jellyfin demo-server REST helpers used to authenticate and locate the
 * hero movie. Plain node http/https — no SDK dependency.
 */
import http from 'node:http';
import https from 'node:https';
import { RTA_CONFIG } from '../config.js';

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
          else reject(new Error(`POST ${urlStr} -> ${res.statusCode} ${res.statusMessage}`));
        });
      },
    );
    req.on('error', reject);
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
        else reject(new Error(`GET ${urlStr} -> ${res.statusCode} ${res.statusMessage}`));
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/** GET raw bytes (e.g. an image) as a Buffer. */
export function getBuffer(urlStr, headers) {
  const url = new URL(urlStr);
  const mod = url.protocol === 'http:' ? http : https;
  return new Promise((resolve, reject) => {
    const req = mod.request(url, { method: 'GET', headers }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error(`GET ${urlStr} -> ${res.statusCode} ${res.statusMessage}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.end();
  });
}

/** Authenticate against the demo Jellyfin server -> session used to seed registry. */
export async function authenticate(server) {
  const auth =
    'MediaBrowser Client="JellyRock-screenshots", Device="ci", DeviceId="jellyrock-screenshots", Version="1.0.0"';
  const d = await postJson(
    `${server.url}/Users/AuthenticateByName`,
    { 'Content-Type': 'application/json', Authorization: auth },
    { Username: server.username, Pw: server.password },
  );
  // AuthenticateByName carries no server NAME (only ServerId); the human-readable
  // name lives on the unauthenticated public-info endpoint. seedServerSelect needs
  // it for the saved-server picker entry, so fetch it once here. Best-effort: a
  // missing name just renders an empty label, not a failed run.
  const info = await getJson(`${server.url}/System/Info/Public`, {}).catch(() => null);
  return {
    serverUrl: server.url,
    userId: d.User.Id,
    username: d.User.Name,
    token: d.AccessToken,
    serverId: d.ServerId,
    serverName: info?.ServerName || '',
    primaryImageTag: d.User?.PrimaryImageTag || '',
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
  const data = await getJson(url, tokenHeader(session.token)).catch(() => null);
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
  const data = await getJson(url, tokenHeader(session.token)).catch(() => null);
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
  const data = await getJson(url, tokenHeader(session.token)).catch(() => null);
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
  const genres = await getJson(
    `${session.serverUrl}/Genres?userId=${session.userId}` +
      `&parentId=${libraryId}&includeItemTypes=${includeItemTypes}`,
    headers,
  ).catch(() => null);

  const byGenre = new Map();
  for (const genre of genres?.Items || []) {
    const items = await getJson(
      `${base}&genreIds=${genre.Id}&recursive=true` +
        `&includeItemTypes=${includeItemTypes}&enableTotalRecordCount=false`,
      headers,
    ).catch(() => null);
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
  const data = await getJson(url, tokenHeader(session.token)).catch(() => null);
  return data?.Items?.[0]?.Id || '';
}
