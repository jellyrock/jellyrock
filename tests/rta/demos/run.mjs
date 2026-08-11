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
import { authenticate, getHero, firstMovie } from '../lib/jellyfin.js';
import { seedHome, seedHomeWithSavedServers } from '../lib/seed.js';
import { snapshotRegistry, restoreRegistry, armRestoreOnInterrupt } from '../lib/registry.js';
import { setupRtaEnv, relaunch, hardRelaunch, ecp, odc } from '../lib/driver.js';
import { acquireDeviceLock } from '../../../scripts/device-lock.js';
import { beginRun, endRun } from '../../../scripts/run-record.js';
import { setFailureContext } from '../lib/diagnostics.js';
import {
  press,
  waitHome,
  waitFor,
  waitFocused,
  getVal,
  getActiveVal,
  sleep,
} from '../lib/steps.js';
import { TAKES } from './takes/index.js';

/** Module-scoped so every exit path can release a lock main() took. */
let activeLock = null;
let activeRun = null;

const LOCALE = RTA_CONFIG.languages[0];
const PLAYING_STATES = ['startup', 'buffer', 'play', 'pause']; // Roku media-player active states

// Privacy guard, made STRUCTURAL: a take declares which demo server it targets; the runner
// resolves it and REFUSES to run against anything that isn't a public demo host. The "never
// touch the home server" rule stops being something each take must remember.
const DEMO_HOST = 'demo.jellyfin.org';
const DEMO_SERVERS = {
  stable: RTA_CONFIG.server, // https://demo.jellyfin.org/stable
  unstable: {
    url: 'https://demo.jellyfin.org/unstable',
    username: 'demo',
    password: '',
    // CLONE WORKAROUND (infra fact, not a take concern). The public demo servers are clones of one
    // image, so BOTH report the same Jellyfin server GUID. JellyRock (correctly) keys server identity
    // on that GUID — that's what unifies one server reached via several URLs (LAN / reverse-proxy /
    // VPN) — so it cannot distinguish these two clones, and a cast-to-another-server switch never
    // fires. The servers ARE genuinely different (names / URLs / versions 10.11 vs 12.0); only their
    // internal id got duplicated by sloppy cloning. We give the server a stable, distinct synthetic
    // id so multi-server features behave exactly as they would against two real distinct servers.
    // The id is never shown in any UI (verified by grep) — it only steers a cast's switch target.
    // Scope: this is the identity a server presents when it's a cast TARGET (its saved-list entry +
    // the cast's serverId). A take that LOGS INTO this server would also inherit it as its user
    // binding — fine as long as overridden servers are used as switch targets, which is their purpose.
    syntheticServerId: 'de504c0011114a0d8b1de13c1a9d0b71',
  },
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

/**
 * The choreography toolkit handed to each take's run(). The take touches ONLY this. Exposes the
 * primary demo session plus low-level primitives (press/waitFor/getActiveVal/odc) so a take can
 * drive its own UI beats (dialogs, pickers) without the runner growing a helper per feature.
 */
function makeContext(sessions, serversByName, primaryName) {
  const session = sessions[primaryName];
  const server = serversByName[primaryName];
  return {
    session, // primary demo session (the one the take lands on)
    server,
    sessions, // every authenticated demo session, keyed by name ('stable' | 'unstable' | ...)
    ecp,
    odc,
    press,
    sleep,
    waitFor,
    waitFocused,
    getVal,
    getActiveVal,
    getHero: () => getHero(session),
    firstMovieOn: (name) => firstMovie(sessions[name]), // a real movie + title on a named server
    sessionFor: (name) => sessions[name],

    /** Seed + relaunch + wait for the named opening screen (the frame the operator records first). */
    async land(screen) {
      if (screen !== 'home')
        throw new Error(`land(): unsupported screen "${screen}" (add a seed for it)`);
      await seedHome(session, LOCALE); // demo server only — the home server is never written
      await hardRelaunch(); // soft relaunch lets the running app re-persist over the seed
      await waitHome();
    },

    /**
     * Land logged into the primary demo server with EVERY take server saved — the state a
     * cast-to-another-server take needs (signed into one, another saved to switch to).
     */
    async landWithSavedServers() {
      await seedHomeWithSavedServers(session, Object.values(sessions), LOCALE);
      await hardRelaunch(); // soft relaunch lets the running app re-persist over the seed
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

    /**
     * Fire a runtime cast — the same ECP wire a Jellyfin sender mints. `extraParams` carries the
     * sibling ECP params a real sender adds (e.g. `itemName` for the server-switch prompt title).
     */
    async cast(contentId, extraParams = {}) {
      console.log(`· casting ${contentId} ...`);
      await ecp.sendInput({ params: { contentId, ...extraParams } });
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

  // A take targets one server (`server: 'stable'`) or several (`servers: ['stable','unstable']`);
  // the first is primary (the one it lands on). Privacy-check ALL before touching the device.
  const serverNames = take.servers ?? [take.server];
  const serversByName = {};
  for (const name of serverNames) serversByName[name] = resolveServer(name); // throws early if not a demo host
  setupRtaEnv();
  // Claim the device before waking it. A demo take is a RECORDING — another
  // party driving the device mid-take does not just fail, it silently ruins
  // footage that looks fine until playback.
  activeLock = await acquireDeviceLock({ what: `demo:${take.name}` });
  // Records to `out/demo/`. Takes drive the same navs as the suite, so a nav that
  // times out mid-recording now leaves the device state behind instead of just a
  // ruined take.
  activeRun = beginRun({ lock: activeLock, run: 'demo' });
  setFailureContext({ take: take.name });
  // Registered BEFORE armRestoreOnInterrupt() below, because that installs its
  // own signal handlers which end in process.exit(). Node runs listeners in
  // registration order, so this gets to start the release first. It is
  // fire-and-forget by necessity — on the abandon path the process leaves
  // before the DELETE lands, and the lock's TTL is what covers that.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => void activeLock?.release());
  }
  // Wake the device + bring the RTA channel (and its ODC component) up BEFORE the first registry
  // call — snapshotRegistry is an ODC call and would fail on a suspended/relaunched device.
  await relaunch();
  const saved = await snapshotRegistry(); // restore the real session afterward, no matter what
  armRestoreOnInterrupt(saved); // ...including when the operator Ctrl-Cs a recording
  let cleanlyRestored = false;
  try {
    const sessions = {};
    for (const name of serverNames) {
      const cfg = serversByName[name];
      const session = await authenticate(cfg);
      // Apply a declared synthetic id (clone workaround — see DEMO_SERVERS) so takes can read
      // session.serverId transparently without knowing the demo servers share a real GUID. Pure
      // identity data layered on an immutable copy; the real url / token / name are untouched.
      sessions[name] = cfg.syntheticServerId
        ? { ...session, serverId: cfg.syntheticServerId }
        : session;
    }
    const primaryName = serverNames[0];
    console.log('\n──────────────────────────────────────────────');
    console.log(`  Take    : ${take.name}`);
    console.log(`  ${take.description}`);
    console.log(
      `  Server  : ${serverNames.map((n) => `${n} (${serversByName[n].url})`).join('  +  ')}`,
    );
    console.log(`  User    : ${sessions[primaryName].username}`);
    console.log('──────────────────────────────────────────────');

    await take.run(makeContext(sessions, serversByName, primaryName));
    console.log('✓ take complete.');

    // Stop gate guarantees recording is stopped BEFORE we touch the session, so it's now safe to
    // fully restore AND relaunch into the real session — leaving the app in a clean, expected
    // state rather than a torn one (registry restored but the running app still on the demo token).
    await waitForEnter('\n⏹ Stop your capture card, then press ENTER to restore your session... ');
    await stopPlayback().catch(() => {});
    await restoreRegistry(saved);
    await relaunch();
    cleanlyRestored = true;
    console.log('· session restored — app relaunched into your real session.');
  } finally {
    // Error-path safety net: if the take threw BEFORE the stop gate, the operator may still be
    // recording, so restore the registry (real session back in storage) but do NOT relaunch — a
    // relaunch could flash the real session on camera mid-take.
    if (!cleanlyRestored) {
      await restoreRegistry(saved);
      console.log('· session restored to the registry after an early exit (app not relaunched).');
    }
  }
}

const closeRun = () => {
  if (activeLock && activeRun)
    endRun({ lock: activeLock, run: 'demo', startedAt: activeRun.startedAt });
};

main()
  .then(async () => {
    closeRun();
    await activeLock?.release();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err);
    closeRun();
    await activeLock?.release();
    process.exit(1);
  });
