/**
 * Minimal Jellyfin demo-server REST helpers used to authenticate and locate the
 * hero movie. Plain node http/https — no SDK dependency.
 */
import http from 'node:http';
import https from 'node:https';
import { RTA_CONFIG } from '../config.js';

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
    { 'Content-Type': 'application/json', 'X-Emby-Authorization': auth },
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
  const data = await getJson(url, { 'X-Emby-Token': session.token }).catch(() => null);
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
