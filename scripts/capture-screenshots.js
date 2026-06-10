/**
 * scripts/capture-screenshots.js — store-screenshot generator (#621).
 *
 * The reusable RTA layer (device driver, nav/wait steps, registry seeds, the
 * Jellyfin demo helpers, and the screen registry) lives under tests/rta/ and is
 * shared with the RTA functional tests. THIS script is the store-specific
 * orchestrator on top of it: it captures the full per-language matrix, composites
 * the real in-film frame behind the OSD (the video plane can't be screenshotted),
 * and emits the website manifest.
 *
 * Output — every locale folder is self-contained (all screens), so the website
 * reads docs/screenshots/<locale>/ with no fallback logic:
 *   docs/screenshots/<locale>/<screen>.png   one PNG per screen, per language
 *   docs/screenshots/screenshots.json        manifest: locales + screen order
 * Language-agnostic screens (capture.scope === 'shared') are captured ONCE then
 * copied into every locale folder.
 *
 * Store screenshots are captured from the PROD build (release branding, what
 * ships). RTA's deploy flips the manifest ENABLE_RTA on regardless of build
 * flavor, so prod works fine. Device creds: .env (ROKU_IP / ROKU_PASSWORD). The
 * device captures JPEG; we convert to PNG.
 *
 *   npm run screenshots:capture            # build:prod + deploy + capture (store default)
 *   npm run screenshots:capture:dev        # dev build instead of prod
 *   npm run screenshots:capture:fast       # no build/deploy — re-capture against the deployed build
 *   node scripts/capture-screenshots.js --languages=fr --screens=home   # subset (add DEPLOY=1 to deploy first)
 *
 * ============================ MAINTENANCE ============================
 * Demo server / hero movie / seek position / locales live in tests/rta/config.js
 * (RTA_CONFIG), shared with the functional tests. The screen list lives in
 * tests/rta/screens.js. This file only owns the store layer (matrix, backdrop,
 * manifest). To capture a new screen, add it to tests/rta/screens.js.
 * ====================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

import { RTA_CONFIG } from '../tests/rta/config.js';
import {
  ecp,
  odc,
  device,
  setupRtaEnv,
  deployRtaBuild,
  relaunch,
} from '../tests/rta/lib/driver.js';
import { sleep, waitFor } from '../tests/rta/lib/steps.js';
import {
  authenticate,
  findMovie,
  getBuffer,
  getLibraries,
  libraryIdFor,
} from '../tests/rta/lib/jellyfin.js';
import {
  seedHome,
  seedUserSelect,
  seedServerSelect,
  seedLibraryLanding,
  snapshotSession,
  restoreSession,
} from '../tests/rta/lib/seed.js';
import { SCREENS } from '../tests/rta/screens.js';
import { generateIndex } from './screenshots-index.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

// Store-specific config = the shared RTA config + the output location.
const CONFIG = {
  ...RTA_CONFIG,
  outDir: path.join(repoRoot, 'docs', 'screenshots'),
};

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

/**
 * Build the image to stand in for the (un-capturable) video frame on the osd
 * screen: the ACTUAL full-resolution frame at CONFIG.seekSeconds, extracted from
 * the direct video stream with ffmpeg. `-ss` before `-i` does an HTTP fast-seek,
 * so ffmpeg only fetches a small chunk near the timestamp (not the whole file).
 * This gives a crisp 1080p frame — trickplay tiles (320x180) are too low-res to
 * upscale cleanly. Falls back to the promo backdrop if ffmpeg/extraction fails.
 * Returns a JPEG Buffer (or null).
 */
async function prepareBackdrop(session, target) {
  const streamUrl =
    `${session.serverUrl}/Videos/${target.heroId}/stream` +
    `?static=true&mediaSourceId=${target.heroId}&api_key=${session.token}`;
  const out = path.join('/tmp/rta-shots', `frame-${target.heroId}-${target.seekSeconds}.jpg`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  try {
    await execFileAsync(
      'ffmpeg',
      [
        '-nostdin',
        '-loglevel',
        'error',
        '-ss',
        String(target.seekSeconds),
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
  if (target.backdropUrl) return await getBuffer(target.backdropUrl, {}).catch(() => null);
  return null;
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
      'below, in this order. `screens` is the full gallery set (every captured ' +
      'screen); `storeScreens` is the curated subset shown on the homepage / shipped ' +
      'in the Roku store listing (the store caps a listing at 6). storeLocales is the ' +
      'curated subset of locales that ships in the store listing.',
    locales: CONFIG.languages,
    storeLocales: CONFIG.storeLanguages,
    screens: SCREENS.filter((s) => s.capture?.eligible).map((s) => s.name),
    storeScreens: SCREENS.filter((s) => s.capture?.eligible && s.capture?.store).map((s) => s.name),
  };
  const dest = path.join(CONFIG.outDir, 'screenshots.json');
  fs.mkdirSync(CONFIG.outDir, { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`  wrote ${path.relative(repoRoot, dest)}`);
}

async function main() {
  const { languages, screens, deploy } = parseArgs();
  setupRtaEnv(); // reads ROKU_IP / ROKU_PASSWORD from .env (throws if missing)

  if (deploy) {
    console.log('Deploying screenshot build (ENABLE_RTA) ...');
    await deployRtaBuild();
  }

  // Good citizen: snapshot the device's current session so we can restore it after
  // (capturing logs the device into the demo server; we put it back the way we found it).
  const savedSession = await snapshotSession();

  console.log(`Authenticating ${CONFIG.server.username}@${CONFIG.server.url} ...`);
  const session = await authenticate(CONFIG.server);
  console.log(`  userId=${session.userId} token=${session.token.length}c`);

  // Runtime library map (collectionType -> current id) for deterministic view seeding.
  const libraries = await getLibraries(session);

  // Resolve a target movie (grid tile index + item id + seek position) per screen.
  // movieDetails/osd use heroMovie; trickplay uses its own film so its store frame
  // matches the long-standing reference. ctx for nav = { heroIndex, heroId, seekSeconds }.
  const mkTarget = (found, seekSeconds) => ({
    heroIndex: found.index,
    heroId: found.id,
    seekSeconds,
    backdropUrl: found.backdropUrl,
  });
  const heroTarget = mkTarget(await findMovie(session, CONFIG.heroMovie), CONFIG.seekSeconds);
  const trickTarget = mkTarget(
    await findMovie(session, CONFIG.trickplayMovie),
    CONFIG.trickplaySeekSeconds,
  );
  const targetFor = (screen) => (screen.name === 'trickplay' ? trickTarget : heroTarget);
  console.log(
    `  hero=${CONFIG.heroMovie} tile#${heroTarget.heroIndex}; ` +
      `trickplay=${CONFIG.trickplayMovie} tile#${trickTarget.heroIndex}`,
  );

  const wanted = SCREENS.filter((s) => screens.includes(s.name));
  // Build each distinct in-film backdrop frame ONCE (osd + trickplay may differ),
  // cached by movie+position so a per-language screen doesn't re-extract per locale.
  const backdrops = {};
  const backdropKey = (t) => `${t.heroId}@${t.seekSeconds}`;
  for (const screen of wanted) {
    if (!screen.capture?.backdrop) continue;
    const key = backdropKey(targetFor(screen));
    if (!(key in backdrops)) {
      backdrops[key] = await prepareBackdrop(session, targetFor(screen));
      console.log(
        `  backdrop[${key}] = ${backdrops[key] ? `${backdrops[key].length}b frame` : '(none)'}`,
      );
    }
  }

  const localizedScreens = wanted.filter((s) => s.capture?.scope !== 'shared');
  const sharedScreens = wanted.filter((s) => s.capture?.scope === 'shared');
  const seedAndNav = async (screen, locale, folder) => {
    const ctx = targetFor(screen);
    if (screen.state === 'home') await seedHome(session, locale);
    else if (screen.state === 'userSelect') await seedUserSelect(session, locale);
    else if (screen.state === 'serverSelect') await seedServerSelect(session, locale);
    // Deterministic landing view for library-dependent screens (resolve id at runtime).
    if (screen.view) {
      await seedLibraryLanding(
        session,
        libraryIdFor(libraries, screen.view.collectionType),
        screen.view.landing,
      );
    }
    await relaunch();
    if (screen.nav) await screen.nav(ctx);
    // Store-only polish: fill the un-capturable black video plane with the real
    // in-film frame (osd's paused frame). trickplay deliberately has no backdrop —
    // it would cover Roku's built-in trickPlayBar — so its video plane stays black.
    if (screen.capture?.backdrop) {
      await injectBackdrop(backdrops[backdropKey(ctx)]);
      await sleep(1000);
    }
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
    await restoreSession(savedSession);
    await ecp.sendLaunchChannel({ channelId: 'dev', verifyLaunch: false }).catch(() => {});
  }

  writeManifest();
  generateIndex(); // regenerate docs/screenshots/README.md (the by-language index)
  console.log('Done.');
  process.exit(0); // RTA keeps the port-9000 socket open; exit explicitly
}

main().catch((e) => {
  console.error('capture failed:', e?.stack || e?.message || e);
  process.exit(1);
});
