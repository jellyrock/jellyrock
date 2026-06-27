/**
 * Demo-take runner — the ONE entry point for capturing feature videos hands-free.
 *
 *   npm run demo                 # list the available takes (your feature checklist)
 *   npm run demo -- cast-play    # run one take
 *   DEMO_NO_WAIT=1 npm run demo -- cast-play   # validation pass (skips the record gates)
 *
 * It owns the privacy-safe LIFECYCLE so individual takes never have to: snapshot the real
 * session, drive the take against a PUBLIC demo server (never the home server — enforced
 * structurally below), gate on the operator's capture card, and restore the real session
 * cleanly off-camera. A take (takes/*.js) declares only its choreography.
 *
 * Branding-agnostic: the same runner drives the dev-branded build (in-PR demos) and a
 * prod-branded build (marketing) — branding is a build-time asset swap, the automation hook
 * (ENABLE_RTA) is independent. Prereq: an RTA-enabled build is already sideloaded (run
 * `npm run test:rta` once, or any deploy with injectTestingFiles). The runner only drives.
 */
import { RTA_CONFIG } from '../config.js';
import { authenticate, getHero } from '../lib/jellyfin.js';
import { seedHome, snapshotSession, restoreSession } from '../lib/seed.js';
import { setupRtaEnv, relaunch, ecp } from '../lib/driver.js';
import { press, waitHome, sleep } from '../lib/steps.js';
import { TAKES } from './takes/index.js';

const LOCALE = RTA_CONFIG.languages[0];
const PLAYING_STATES = ['startup', 'buffer', 'play', 'pause']; // Roku media-player active states

// Privacy guard, made STRUCTURAL: a take declares which demo server it targets; the runner
// resolves it and REFUSES to run against anything that isn't a public demo host. The "never
// touch the home server" rule stops being something each take must remember.
const DEMO_HOST = 'demo.jellyfin.org';
const DEMO_SERVERS = {
  stable: RTA_CONFIG.server, // https://demo.jellyfin.org/stable
  // unstable: { url: 'https://demo.jellyfin.org/unstable', username: 'demo', password: '' }, // add when a take needs it
};

function resolveServer(name) {
  const server = DEMO_SERVERS[name];
  if (!server) {
    throw new Error(
      `take declares unknown demo server "${name}" (known: ${Object.keys(DEMO_SERVERS).join(', ')})`,
    );
  }
  if (new URL(server.url).host !== DEMO_HOST) {
    throw new Error(
      `refusing to run: "${name}" (${server.url}) is not the public demo host (${DEMO_HOST}). ` +
        `Demos must never touch a real server.`,
    );
  }
  return server;
}

/** Block until the operator presses ENTER (skipped in DEMO_NO_WAIT validation mode). */
function waitForEnter(prompt) {
  if (process.env.DEMO_NO_WAIT) {
    console.log(`${prompt} [DEMO_NO_WAIT — skipping the record gate]`);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    process.stdin.resume();
    process.stdin.once('data', () => {
      process.stdin.pause();
      resolve();
    });
  });
}

/** Poll the device media-player until it reaches an active playback state. */
async function waitMediaPlaying(timeout = 30000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    const mp = await ecp.getMediaPlayer().catch(() => null);
    last = mp?.state;
    if (mp && !mp.error && PLAYING_STATES.includes(mp.state)) return;
    await sleep(1000);
  }
  throw new Error(`demo: media player never started (last state=${last})`);
}

/** Back on the player stops it; retry until the media-player reports stopped. */
async function stopPlayback() {
  const start = Date.now();
  while (Date.now() - start < 10000) {
    const mp = await ecp.getMediaPlayer().catch(() => null);
    if (!mp || !PLAYING_STATES.includes(mp.state)) return;
    await press(ecp.Key.Back);
    await sleep(1200);
  }
}

/** The choreography toolkit handed to each take's run(). The take touches ONLY this. */
function makeContext(session, server) {
  return {
    session,
    server,
    ecp,
    press,
    getHero: () => getHero(session),

    /** Seed + relaunch + wait for the named opening screen (the frame the operator records first). */
    async land(screen) {
      if (screen !== 'home')
        throw new Error(`land(): unsupported screen "${screen}" (add a seed for it)`);
      await seedHome(session, LOCALE); // demo server only — the home server is never written
      await relaunch();
      await waitHome();
    },

    /** Operator gate: "start recording, press ENTER". Runner-owned timing, take chooses placement. */
    startGate: () =>
      waitForEnter('\n▶ Start your capture card, then press ENTER to run the take... '),

    /** Hold a beat on camera (logged so the run reads like a shot list). */
    async hold(ms, label) {
      console.log(`· holding on ${label}...`);
      await sleep(ms);
    },

    /** Fire a runtime cast — the same ECP wire a Jellyfin sender mints. */
    async cast(contentId) {
      console.log(`· casting ${contentId} ...`);
      await ecp.sendInput({ params: { contentId } });
    },

    waitPlaying: (timeout) => waitMediaPlaying(timeout),
  };
}

function printList() {
  console.log('\nAvailable demo takes:\n');
  for (const t of TAKES) console.log(`  ${t.name.padEnd(14)} ${t.description}`);
  console.log('\nRun one:  npm run demo -- <name>\n');
}

async function main() {
  const name = process.argv[2];
  if (!name || name === '--list' || name === 'list') {
    printList();
    return;
  }
  const take = TAKES.find((t) => t.name === name);
  if (!take) {
    console.error(`Unknown take "${name}".`);
    printList();
    process.exit(1);
  }

  const server = resolveServer(take.server); // throws before touching the device if not a demo host
  setupRtaEnv();
  // Wake the device + bring the RTA channel (and its ODC component) up BEFORE the first registry
  // call — snapshotSession is an ODC call and would fail on a suspended/relaunched device.
  await relaunch();
  const saved = await snapshotSession(); // restore the real session afterward, no matter what
  let cleanlyRestored = false;
  try {
    const session = await authenticate(server);
    console.log('\n──────────────────────────────────────────────');
    console.log(`  Take    : ${take.name}`);
    console.log(`  ${take.description}`);
    console.log(`  Server  : ${server.url}`);
    console.log(`  User    : ${session.username}`);
    console.log('──────────────────────────────────────────────');

    await take.run(makeContext(session, server));
    console.log('✓ take complete.');

    // Stop gate guarantees recording is stopped BEFORE we touch the session, so it's now safe to
    // fully restore AND relaunch into the real session — leaving the app in a clean, expected
    // state rather than a torn one (registry restored but the running app still on the demo token).
    await waitForEnter('\n⏹ Stop your capture card, then press ENTER to restore your session... ');
    await stopPlayback().catch(() => {});
    await restoreSession(saved);
    await relaunch();
    cleanlyRestored = true;
    console.log('· session restored — app relaunched into your real session.');
  } finally {
    // Error-path safety net: if the take threw BEFORE the stop gate, the operator may still be
    // recording, so restore the registry (real session back in storage) but do NOT relaunch — a
    // relaunch could flash the real session on camera mid-take.
    if (!cleanlyRestored) {
      await restoreSession(saved);
      console.log('· session restored to the registry after an early exit (app not relaunched).');
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
