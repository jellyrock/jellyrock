/**
 * scripts/capture-screenshots.js — RTA-driven per-language screenshot capture (#621).
 *
 * Drives a Roku device through roku-test-automation (RTA): authenticates against
 * the Jellyfin demo server, seeds the app's registry to land deterministically on
 * each target screen in each language, and captures a PNG per screen/language into
 * docs/screenshots/<locale>/<screen>.png.
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
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import sharp from 'sharp';
import { ecp, odc, device, utils } from 'roku-test-automation';

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
};

/*
 * Each screen declares how to reach it:
 *  - state: 'home' (logged in) | 'userSelect' (signed out, server known)
 *  - nav:   optional async (ctx) => {} that drives keypresses from the landed state
 * The two seed-to-land states are deterministic (registry seed + relaunch); deeper
 * screens add in-app navigation on top of 'home'.
 */
const SCREENS = [
  { name: 'userSelect', state: 'userSelect' },
  { name: 'home', state: 'home' },
  // TODO: libraryGrid / movieDetails / osd / trickplay — navigate from 'home'.
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

/** Capture the current screen to docs/screenshots/<locale>/<name>.png (JPEG -> PNG). */
async function capture(name, locale) {
  const tmp = path.join('/tmp/rta-shots', `${locale}-${name}`);
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  const shot = await device.getScreenshot(tmp);
  const destDir = path.join(CONFIG.outDir, locale);
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, `${name}.png`);
  await sharp(shot.path).png().toFile(dest);
  console.log(`  captured ${path.relative(repoRoot, dest)} (from ${shot.format})`);
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

  const wanted = SCREENS.filter((s) => screens.includes(s.name));
  try {
    for (const locale of languages) {
      console.log(`\n=== ${locale} ===`);
      for (const screen of wanted) {
        if (screen.state === 'home') await seedHome(session, locale);
        else if (screen.state === 'userSelect') await seedUserSelect(session, locale);
        await relaunch();
        if (screen.nav) await screen.nav({ ecp, odc, device });
        await capture(screen.name, locale);
      }
    }
  } finally {
    console.log('\nRestoring original device session ...');
    await odc.writeRegistry({ values: { [GLOBAL]: savedSession } }).catch(() => {});
    await ecp.sendLaunchChannel({ channelId: 'dev', verifyLaunch: false }).catch(() => {});
  }

  console.log('Done.');
  process.exit(0); // RTA keeps the port-9000 socket open; exit explicitly
}

main().catch((e) => {
  console.error('capture failed:', e?.stack || e?.message || e);
  process.exit(1);
});
