/**
 * scripts/capture-screenshots.js — RTA-driven per-language screenshot capture (#621).
 *
 * Drives a Roku device through roku-test-automation (RTA): authenticates against
 * the Jellyfin demo server, seeds the app's registry to land deterministically on
 * each target screen in each language, and captures a PNG per screen.
 *
 * Every locale folder is self-contained — it holds ALL screens, so the website
 * just reads docs/screenshots/<locale>/ with no fallback logic:
 *   docs/screenshots/<locale>/<screen>.png   one PNG per screen, per language
 *   docs/screenshots/screenshots.json        manifest: locales + screen order
 * Language-agnostic screens (see SCREENS `scope: 'shared'`) are captured ONCE on
 * the device then copied into every locale folder (saves device time, keeps the
 * folders uniform).
 *
 * Requires a screenshot-enabled build on the device (run once with DEPLOY=1, which
 * sideloads build/ with ENABLE_RTA flipped on so the on-device component runs).
 *
 *   npm run build && DEPLOY=1 node scripts/capture-screenshots.js   # deploy + capture
 *   node scripts/capture-screenshots.js                              # capture (already deployed)
 *   node scripts/capture-screenshots.js --languages=fr --screens=home   # subset
 *
 * Device creds: .env (ROKU_IP / ROKU_PASSWORD). The device captures JPEG; we
 * convert to PNG with sharp.
 *
 * ============================ MAINTENANCE ============================
 * To point at a different demo server, edit CONFIG.server.url (+ username/password)
 * below. To change which languages or screens are captured, edit CONFIG.languages /
 * CONFIG.screens. Nothing else needs to change.
 * ====================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import sharp from 'sharp';
import { ecp, odc, device, utils } from 'roku-test-automation';

const execFileAsync = promisify(execFile);

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

// ============================== CONFIG ==============================
const CONFIG = {
  // The demo server screenshots are captured from. License-clear content only —
  // these images go into a public store listing. Easy to repoint: change url here.
  server: {
    url: 'https://demo.jellyfin.org/stable',
    username: 'demo',
    password: '',
  },
  // Folder name == the exact translationLocale value, so folder<->setting is 1:1.
  languages: ['en_US', 'fr', 'de', 'pt', 'es'],
  outDir: path.join(repoRoot, 'docs', 'screenshots'),
  bootMs: 10000, // time to let the app boot + RTA on-device component come up
  // The movie used for movieDetails / osd / trickplay. License-clear, has a
  // backdrop, and visually distinctive. Reached in the Movies grid by its
  // SortName position (looked up at runtime), so this is the only knob to change.
  heroMovie: 'Dracula',
  // Playback position (seconds) for the osd screen — the osd is paused here so it
  // shows this exact timestamp + frame (matches the original Dracula reference at
  // 28:44). The trickplay strip lands on the nearest 10s thumbnail (~28:40); its
  // coarse chunking means it won't pixel-match the osd frame, which is expected.
  seekSeconds: 1724, // 28:44
};

/*
 * Each screen declares how to reach it:
 *  - state: 'home' (logged in) | 'userSelect' (signed out, server known)
 *  - nav:   optional async (ctx) => {} that drives keypresses from the landed state
 * The two seed-to-land states are deterministic (registry seed + relaunch); deeper
 * screens add in-app navigation on top of 'home'.
 */
// `scope` controls how a screen is captured (output is the same shape either
// way — every locale folder ends up with every screen):
//  - 'localized' (default): shows translated UI text, so it is captured once per
//     language into docs/screenshots/<locale>/<name>.png.
//  - 'shared': has NO translatable text (e.g. trickplay = thumbnails + numeric
//     times), so it is captured ONCE on the device and the resulting PNG is
//     copied into every locale folder. Identical bytes everywhere, but each
//     locale folder stays self-contained so the website needs no fallback logic.
const SCREENS = [
  { name: 'userSelect', state: 'userSelect' },
  { name: 'home', state: 'home' },
  // Deeper screens navigate from 'home' via ecp keypresses + odc node-waits.
  // movieDetails / osd / trickplay anchor on CONFIG.heroMovie, reached in the
  // Movies grid by its SortName tile index (looked up at runtime) — deterministic
  // regardless of the demo server's hourly-resetting Continue Watching row.
  { name: 'libraryGrid', state: 'home', nav: navLibraryGrid },
  { name: 'movieDetails', state: 'home', nav: navMovieDetails },
  { name: 'osd', state: 'home', nav: navOsd },
  { name: 'trickplay', state: 'home', nav: navTrickplay, scope: 'shared' },
];
// ===================================================================

function parseArgs() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const m = a.match(/^--([^=]+)=(.*)$/);
      return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
    }),
  );
  return {
    languages: args.languages ? String(args.languages).split(',') : CONFIG.languages,
    screens: args.screens ? String(args.screens).split(',') : SCREENS.map((s) => s.name),
    deploy: process.env.DEPLOY === '1',
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Minimal JSON POST over node http/https (picks the module by URL scheme). */
function postJson(urlStr, headers, bodyObj) {
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

/** Minimal JSON GET over node http/https (picks the module by URL scheme). */
function getJson(urlStr, headers) {
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
function getBuffer(urlStr, headers) {
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
async function authenticate(server) {
  const auth =
    'MediaBrowser Client="JellyRock-screenshots", Device="ci", DeviceId="jellyrock-screenshots", Version="1.0.0"';
  const d = await postJson(
    `${server.url}/Users/AuthenticateByName`,
    { 'Content-Type': 'application/json', 'X-Emby-Authorization': auth },
    { Username: server.username, Pw: server.password },
  );
  return {
    serverUrl: server.url,
    userId: d.User.Id,
    username: d.User.Name,
    token: d.AccessToken,
    serverId: d.ServerId,
    primaryImageTag: d.User?.PrimaryImageTag || '',
  };
}

/**
 * Locate CONFIG.heroMovie within the Movies grid. The grid is sorted by SortName
 * ascending (verified to match the app's grid order), so the item's index in
 * this list IS its grid tile index — the number of Right presses from the first
 * tile to focus it.
 *
 * Returns { index, id, backdropUrl } ({0, '', ''} if the movie isn't found).
 * backdropUrl is the promo still (fallback only — see prepareBackdrop).
 */
async function getHero(session) {
  const url =
    `${session.serverUrl}/Items?UserId=${session.userId}` +
    `&IncludeItemTypes=Movie&Recursive=true&SortBy=SortName&SortOrder=Ascending`;
  const data = await getJson(url, { 'X-Emby-Token': session.token }).catch(() => null);
  const items = data?.Items || [];
  const index = items.findIndex((i) => i.Name === CONFIG.heroMovie);
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

/**
 * Build the image to stand in for the (un-capturable) video frame on the osd
 * screen: the ACTUAL full-resolution frame at CONFIG.seekSeconds, extracted from
 * the direct video stream with ffmpeg. `-ss` before `-i` does an HTTP fast-seek,
 * so ffmpeg only fetches a small chunk near the timestamp (not the whole file).
 * This gives a crisp 1080p frame — trickplay tiles (320x180) are too low-res to
 * upscale cleanly. Falls back to the promo backdrop if ffmpeg/extraction fails.
 * Returns a JPEG Buffer (or null).
 */
async function prepareBackdrop(session, hero) {
  const streamUrl =
    `${session.serverUrl}/Videos/${hero.id}/stream` +
    `?static=true&mediaSourceId=${hero.id}&api_key=${session.token}`;
  const out = path.join('/tmp/rta-shots', `frame-${hero.id}-${CONFIG.seekSeconds}.jpg`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  try {
    await execFileAsync(
      'ffmpeg',
      [
        '-nostdin',
        '-loglevel',
        'error',
        '-ss',
        String(CONFIG.seekSeconds),
        '-i',
        streamUrl,
        '-frames:v',
        '1',
        '-q:v',
        '2',
        '-y',
        out,
      ],
      { timeout: 90000 },
    );
    if (fs.existsSync(out) && fs.statSync(out).size > 0) {
      // The on-device Poster render + the device's JPEG screenshot encode soften
      // the image; a mild unsharp mask pre-compensates so the captured osd frame
      // stays crisp.
      return await sharp(out).sharpen({ sigma: 1.5 }).jpeg({ quality: 95 }).toBuffer();
    }
  } catch (e) {
    console.log(
      `  ffmpeg frame extraction failed (${String(e.message).split('\n')[0]}); using promo backdrop`,
    );
  }
  if (hero.backdropUrl) return await getBuffer(hero.backdropUrl, {}).catch(() => null);
  return null;
}

const GLOBAL = 'JellyRock';

/** Seed registry to land logged-in on Home as the demo user, in `locale`. */
async function seedHome(session, locale) {
  await odc.writeRegistry({
    values: {
      [GLOBAL]: {
        server: session.serverUrl,
        active_user: session.userId,
        globalRememberMe: 'true',
        globalTranslationLocale: locale,
      },
      [session.userId]: {
        authToken: session.token,
        serverId: session.serverId,
        username: session.username,
        primaryImageTag: session.primaryImageTag,
        translationLocale: locale,
      },
    },
  });
}

/** Seed registry to land on the user-select screen (server known, no active user). */
async function seedUserSelect(session, locale) {
  // Delete just active_user (null = delete that key) so LoginFlow stops at
  // user-select; set the pre-login language. Non-destructive: saved_servers /
  // available_users are preserved. globalTranslationLocale is the ONLY lever that
  // localizes this pre-login screen (the Part-1 feature this work depends on).
  await odc.writeRegistry({
    values: {
      [GLOBAL]: {
        server: session.serverUrl,
        active_user: null,
        globalRememberMe: 'false',
        globalTranslationLocale: locale,
      },
    },
  });
}

async function relaunch() {
  await ecp.sendLaunchChannel({ channelId: 'dev', verifyLaunch: false });
  await sleep(CONFIG.bootMs);
}

// ========================== NAVIGATION =============================
// The two seed-to-land states (home / userSelect) are reached by registry
// seed + relaunch. The four deeper screens drive the app from 'home' with
// remote keypresses, waiting on Scene Graph node state (NOT fixed sleeps) so
// each step proceeds the moment the UI is actually ready. Node lookups use
// RTA's `#id` keyPath (a recursive findNode from the scene root).

const press = (key) => ecp.sendKeypress(key);

/** Read a scene-rooted keyPath; returns the value or undefined if not present. */
async function getVal(keyPath) {
  const res = await odc.getValue({ base: 'scene', keyPath }).catch(() => ({ found: false }));
  return res.found ? res.value : undefined;
}

/**
 * Poll `keyPath` until `predicate(value)` is true, optionally re-issuing
 * `action` (e.g. a keypress) each tick. Throws on timeout so a broken nav
 * fails loudly instead of capturing the wrong screen.
 */
async function waitFor(
  keyPath,
  predicate,
  { timeout = 30000, interval = 500, action, label } = {},
) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    if (action) await action().catch(() => {});
    last = await getVal(keyPath);
    if (predicate(last)) return last;
    await sleep(interval);
  }
  throw new Error(`nav timed out waiting for ${label || keyPath} (last=${JSON.stringify(last)})`);
}

const hasChildren = (n) => typeof n === 'number' && n > 0;

/** Poll the focused node until `predicate({node, keyPath})` is true; throws on timeout. */
async function waitFocused(predicate, { timeout = 15000, interval = 500, label } = {}) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    const f = await odc.getFocusedNode({ includeNode: true }).catch(() => null);
    last = `${f?.node?.subtype}@${f?.keyPath}`;
    if (f && predicate(f)) return f;
    await sleep(interval);
  }
  throw new Error(`nav timed out waiting for focus (${label || 'predicate'}); last=${last}`);
}

/** Home is ready once HomeRows has rendered its content. */
async function waitHome() {
  await waitFor('#homeRows.content.getChildCount()', hasChildren, {
    label: 'home rows',
    timeout: 20000,
  });
}

/** home -> OK on focused "Movies" tile -> Movies library grid. */
async function navLibraryGrid() {
  await waitHome();
  await press(ecp.Key.Ok);
  await waitFor('#itemGrid.content.getChildCount()', hasChildren, {
    label: 'movies grid',
    timeout: 20000,
  });
  await sleep(1200); // let posters paint before capture
}

/** grid -> focus the hero tile (Right x heroIndex) -> OK -> ItemDetails. */
async function navMovieDetails(ctx) {
  await navLibraryGrid();
  const target = ctx?.heroIndex || 0;
  if (target > 0) {
    // Press Right until the grid reports the hero tile focused (robust to a
    // dropped keypress — only presses while focus is still short of the target).
    await waitFor('#itemGrid.itemFocused', (v) => v === target, {
      timeout: 15000,
      interval: 500,
      action: async () => {
        const cur = await getVal('#itemGrid.itemFocused');
        if (typeof cur === 'number' && cur < target) await press(ecp.Key.Right);
      },
      label: `grid focus -> tile ${target}`,
    });
  }
  await press(ecp.Key.Ok);
  await waitFor('#videoTitle.text', (t) => typeof t === 'string' && t.length > 0, {
    label: 'details title',
    timeout: 20000,
  });
  await sleep(1500); // let backdrop + logo paint
}

/**
 * Stand in for the (un-capturable) video frame on the osd screen.
 *
 * Roku's developer screenshot only captures the SceneGraph graphics plane; the
 * decoded video lives on a separate hardware plane that reads back as pure black
 * (documented Roku limitation). So we push the real in-film frame (see
 * prepareBackdrop) to the device's tmp: sandbox and inject a graphics-plane
 * Poster of it into `#captionGroup` — the player's FIRST child, so it renders
 * BEHIND the OSD overlay — to fill that black area. tmp: is cleared on each
 * relaunch, so we (re)write it here, right before use.
 *
 * `#captionGroup` is translated to [960,1020] (subtitle anchor), so the Poster
 * is offset by the inverse to sit at screen origin and fill 1920x1080.
 */
async function injectBackdrop(buf) {
  if (!buf) return;
  const devicePath = 'tmp:/rtaBackdrop.jpg';
  await odc.writeFile({ path: devicePath, binaryPayload: buf }).catch(() => {});
  await odc
    .createChild({
      base: 'scene',
      keyPath: '#captionGroup',
      subtype: 'Poster',
      fields: {
        id: 'rtaBackdrop',
        uri: devicePath,
        width: 1920,
        height: 1080,
        translation: [-960, -1020],
        loadDisplayMode: 'scaleToZoom',
      },
    })
    .catch(() => {});
  // Wait for the image to decode so it's painted at capture time.
  await waitFor('#rtaBackdrop.loadStatus', (s) => s === 'ready', {
    timeout: 15000,
    interval: 500,
    label: 'backdrop image load',
  }).catch(() => {});
}

/** details -> OK on default Play/Resume button -> playback begins. */
async function startPlayback(ctx) {
  await navMovieDetails(ctx);
  // The title label renders before the button row is interactive; wait until
  // focus actually lands inside the details button group (Play or Resume,
  // depending on watch state) before pressing OK, else the press lands too
  // early and playback never starts.
  await waitFocused((f) => typeof f.keyPath === 'string' && f.keyPath.includes('#buttons'), {
    label: 'details play/resume button',
  });
  await press(ecp.Key.Ok);
}

/**
 * Playback -> show the OSD overlay. OSD only appears once the player reaches a
 * playable state (`stateAllowsOSD`), so we retry Up until it shows, then bump
 * its inactivity timeout so it can't auto-hide before the screenshot.
 */
async function navOsd(ctx) {
  await startPlayback(ctx);
  // Confirm the player reached a playable state (OSD only shows when it has).
  await waitFor('#osd.visible', (v) => v === true, {
    timeout: 90000,
    interval: 2000,
    action: () => press(ecp.Key.Up),
    label: 'osd visible',
  });
  // Hide the OSD (focus -> player), then Play to PAUSE + re-show the OSD. Pausing
  // matches the original reference (play-button state) and, crucially, freezes the
  // position: a paused OSD never auto-hides and we can seek to the exact frame.
  await press(ecp.Key.Back);
  await waitFor('#osd.visible', (v) => v === false, { timeout: 8000, label: 'osd hidden' });
  await press(ecp.Key.Play); // pause + show OSD
  await waitFor('#osd.visible', (v) => v === true, {
    timeout: 15000,
    interval: 500,
    label: 'osd visible (paused)',
  });
  // Seek the player (found by its id == the item id) to the exact target while
  // paused, so the OSD shows that exact timestamp with no playback drift.
  if (ctx?.heroId) {
    await odc
      .setValue({ base: 'scene', keyPath: `#${ctx.heroId}.seek`, value: CONFIG.seekSeconds })
      .catch(() => {});
  }
  await sleep(2500); // let the (paused) seek settle + frame render
  // Fill the black video plane with the real in-film frame at this position.
  await injectBackdrop(ctx?.backdropBuf);
  await sleep(1000);
}

/**
 * Playback -> trickplay seek strip. We use the OSD as the "playback ready"
 * gate (it only shows when playable), hide it (Back; OSD consumes it as a
 * hide, it does NOT stop playback), then Left/Right surfaces the carousel
 * (VideoPlayerView only shows it while the OSD is hidden).
 */
async function navTrickplay(ctx) {
  await startPlayback(ctx);
  await waitFor('#osd.visible', (v) => v === true, {
    timeout: 90000,
    interval: 2000,
    action: () => press(ecp.Key.Up),
    label: 'playback ready (osd)',
  });
  // Hide the OSD (focus returns to the player), then position the trickplay scrub
  // on CONFIG.seekSeconds so the strip's CENTER frame matches the osd frame.
  // Opening trickplay (the Right press below) jumps forward one thumbnail, so we
  // seek one trickplay interval (10s) BEFORE the target — the open then lands the
  // scrub exactly on seekSeconds.
  await press(ecp.Key.Back);
  await waitFor('#osd.visible', (v) => v === false, { timeout: 8000, label: 'osd hidden' });
  await odc
    .setValue({ base: 'focusedNode', keyPath: 'seek', value: CONFIG.seekSeconds - 10 })
    .catch(() => {});
  await sleep(3000); // let the seek settle
  // No backdrop injection here: the trickplay strip and Roku's native seek/time
  // bar (start/end timestamps) are graphics-plane and capture fine. A backdrop
  // would render in front of the native seek bar and hide the timestamps, which
  // reads as a broken screen. Roku dims the video during scrubbing anyway, so a
  // dark background here is the real, expected look.
  await press(ecp.Key.Right); // open trickplay; jumps ~one thumbnail forward to the target
  await waitFor('#trickplayCarousel.isVisible', (v) => v === true, {
    timeout: 15000,
    interval: 500,
    label: 'trickplay visible',
  });
  await sleep(2500); // let trickplay thumbnails load
}
// ===================================================================

/** Capture the current screen to docs/screenshots/<folder>/<name>.png (JPEG -> PNG). */
async function capture(name, folder) {
  const tmp = path.join('/tmp/rta-shots', `${folder}-${name}`);
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  const shot = await device.getScreenshot(tmp);
  // Guard: a pure-black capture is always a failure (e.g. the trickplay bar
  // auto-closed before the shot, leaving only the un-capturable video plane).
  // Throw so captureScreen retries the whole nav instead of saving a black PNG.
  const stats = await sharp(shot.path).stats();
  const maxChannel = Math.max(...stats.channels.map((ch) => ch.max));
  if (maxChannel < 8) {
    throw new Error(`capture of ${folder}/${name} is essentially black (max=${maxChannel})`);
  }
  const destDir = path.join(CONFIG.outDir, folder);
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, `${name}.png`);
  await sharp(shot.path).png().toFile(dest);
  console.log(`  captured ${path.relative(repoRoot, dest)} (from ${shot.format})`);
}

/**
 * Write the screenshots.json manifest — the contract the website (jellyrock.app)
 * reads. Every locale folder contains every screen, so the site just renders, for
 * the chosen locale, `<locale>/<screen>.png` for each screen in `screens` order.
 * Config-derived, so it always reflects the full intended set regardless of any
 * --screens/--languages subset captured this run.
 */
function writeManifest() {
  const manifest = {
    _comment:
      'Generated by scripts/capture-screenshots.js. Each locale folder contains ' +
      'every screen; render docs/screenshots/<locale>/<screen>.png for each screen ' +
      'below, in this order.',
    locales: CONFIG.languages,
    screens: SCREENS.map((s) => s.name),
  };
  const dest = path.join(CONFIG.outDir, 'screenshots.json');
  fs.mkdirSync(CONFIG.outDir, { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`  wrote ${path.relative(repoRoot, dest)}`);
}

async function main() {
  const { languages, screens, deploy } = parseArgs();
  const host = process.env.ROKU_IP;
  const password = process.env.ROKU_PASSWORD;
  if (!host || !password) {
    console.error('Missing ROKU_IP / ROKU_PASSWORD (set them in .env)');
    process.exit(1);
  }

  utils.setupEnvironmentFromConfig({
    RokuDevice: { devices: [{ host, password, screenshotFormat: 'png' }] },
    ECP: { default: { launchChannelId: 'dev' } },
    OnDeviceComponent: { logLevel: 'info' },
  });

  if (deploy) {
    console.log('Deploying screenshot build (ENABLE_RTA) ...');
    await device.deploy({ rootDir: 'build', injectTestingFiles: true });
    await sleep(CONFIG.bootMs);
  }

  // Good citizen: snapshot the device's current session so we can restore it after
  // (capturing logs the device into the demo server; we put it back the way we found it).
  const before = (await odc.readRegistry())?.values?.[GLOBAL] || {};
  const savedSession = {
    server: before.server ?? null,
    active_user: before.active_user ?? null,
    globalTranslationLocale: before.globalTranslationLocale ?? null,
  };

  console.log(`Authenticating ${CONFIG.server.username}@${CONFIG.server.url} ...`);
  const session = await authenticate(CONFIG.server);
  console.log(`  userId=${session.userId} token=${session.token.length}c`);

  // Locate the hero movie (CONFIG.heroMovie) in the grid (tile index = Right
  // presses to reach it) and build the osd backdrop image (the real in-film
  // frame at the seek position; see prepareBackdrop).
  const hero = await getHero(session);
  const heroIndex = hero.index;
  const backdropBuf = await prepareBackdrop(session, hero);
  console.log(
    `  hero=${CONFIG.heroMovie} tile#${heroIndex} backdrop=${backdropBuf ? `${backdropBuf.length}b frame` : '(none)'}`,
  );

  const wanted = SCREENS.filter((s) => screens.includes(s.name));
  const localizedScreens = wanted.filter((s) => s.scope !== 'shared');
  const sharedScreens = wanted.filter((s) => s.scope === 'shared');
  const seedAndNav = async (screen, locale, folder) => {
    if (screen.state === 'home') await seedHome(session, locale);
    else if (screen.state === 'userSelect') await seedUserSelect(session, locale);
    await relaunch();
    if (screen.nav) await screen.nav({ ecp, odc, device, backdropBuf, heroIndex, heroId: hero.id });
    await capture(screen.name, folder);
  };
  // Each screen reseeds + relaunches from scratch, so a transient hiccup (a
  // playback stall, a demo-server blip) is recoverable by simply retrying — and
  // one bad screen should never abandon a ~15-minute matrix run.
  const captureScreen = async (screen, locale, folder, attempts = 3) => {
    for (let i = 1; i <= attempts; i++) {
      try {
        await seedAndNav(screen, locale, folder);
        return;
      } catch (e) {
        console.log(`  ! ${folder}/${screen.name} attempt ${i}/${attempts} failed: ${e.message}`);
        if (i === attempts) throw e;
      }
    }
  };
  try {
    // Localized screens: one capture per language into <locale>/.
    for (const locale of languages) {
      if (!localizedScreens.length) break;
      console.log(`\n=== ${locale} ===`);
      for (const screen of localizedScreens) await captureScreen(screen, locale, locale);
    }
    // Shared screens: captured ONCE on the device, then copied into every locale
    // folder so each folder is self-contained. Any language renders them
    // identically; use a stable one for navigation.
    if (sharedScreens.length) {
      const navLocale = languages.includes('en_US') ? 'en_US' : languages[0];
      console.log(`\n=== shared (captured once via ${navLocale}, copied to all locales) ===`);
      for (const screen of sharedScreens) {
        await captureScreen(screen, navLocale, navLocale);
        const src = path.join(CONFIG.outDir, navLocale, `${screen.name}.png`);
        for (const locale of languages) {
          if (locale === navLocale) continue;
          const dest = path.join(CONFIG.outDir, locale, `${screen.name}.png`);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.copyFileSync(src, dest);
          console.log(`  copied ${screen.name}.png -> ${locale}/`);
        }
      }
    }
  } finally {
    console.log('\nRestoring original device session ...');
    await odc.writeRegistry({ values: { [GLOBAL]: savedSession } }).catch(() => {});
    await ecp.sendLaunchChannel({ channelId: 'dev', verifyLaunch: false }).catch(() => {});
  }

  writeManifest();
  console.log('Done.');
  process.exit(0); // RTA keeps the port-9000 socket open; exit explicitly
}

main().catch((e) => {
  console.error('capture failed:', e?.stack || e?.message || e);
  process.exit(1);
});
