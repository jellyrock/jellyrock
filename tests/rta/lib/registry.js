/**
 * Leave the device exactly as we found it.
 *
 * RTA seeds the REAL `JellyRock` registry (see seed.js for why), so every run
 * mutates state a person is actually using. This module is the safety net:
 * snapshot the WHOLE registry before anything is seeded, and put it back —
 * exactly — afterwards.
 *
 * ## Why the whole registry, and not a list of keys
 *
 * The previous implementation snapshotted five hand-listed keys of the one
 * `JellyRock` section. That is an allow-list, and an allow-list of "keys the
 * seeds write" cannot cover the keys the APP writes while running under a
 * seeded session, nor whole SECTIONS the seeds bring into existence. Measured
 * on `.178` on 2026-08-10, after months of runs under that design, the device
 * still carried:
 *
 *   - a registry section for the demo user holding a live Jellyfin `authToken`,
 *     a seeded `display.<libraryId>.landing`, and its `username`/`serverId`
 *   - a `demo`/`demo.jellyfin.org` entry appended into `available_users`
 *
 * Neither was ever a candidate for restore: `available_users` is written by the
 * app, and the user section was never in the snapshot at all. Both read back as
 * `VERIFIED CLEAN`. Snapshotting everything removes the judgement call — there
 * is no list to keep in sync with the seeds, and none to keep in sync with the
 * app either.
 *
 * ## Why the snapshot goes to disk
 *
 * A snapshot that lives only in the test process dies with it. That is how this
 * repo has stranded devices: an interrupted run leaves the device on the demo
 * server with nothing left to restore from, and — worse — the NEXT run then
 * snapshots that dirty state as if it were the user's, making the damage
 * permanent and self-certifying. Persisting the snapshot before any seeding
 * turns both cases into recoveries: `snapshotRegistry()` finds the leftover
 * file, restores from it FIRST, and only then takes its own snapshot.
 *
 * The file is `.device-runs/registry-<host>.json` (gitignored) and it holds auth
 * tokens, so nothing here ever prints its contents — only its path. It lives
 * outside `out/` for a load-bearing reason — see `SNAPSHOT_DIR` below.
 */
import fs from 'node:fs';
import path from 'node:path';
import { odc, device, hardRelaunch } from './driver.js';

/**
 * Where the snapshot lives — deliberately NOT under `out/`, and gitignored.
 *
 * Every `build*` script opens with `npx rimraf build/ out/` and `npm run test:rta`
 * builds first, so a snapshot under `out/` was deleted before the recovery in
 * `snapshotRegistry` could use it. A file whose contract is "survives across runs"
 * cannot live in the build output directory — same fix as the run ledger in
 * `scripts/run-record.js`.
 *
 * Kept SHARED across entry points, unlike the per-run-kind record directory, and
 * that difference is load-bearing: the record is per-run evidence, so a shared path
 * clobbers it; the snapshot is cross-run recovery state, so a device stranded by
 * `npm run demo` must be repairable by the next `npm run test:rta` and
 * `rta:restore` has to find it with no arguments.
 *
 * Evidence, the reproduction and the ruled-out alternatives:
 * `decisions.md` -> `registry-snapshot-outside-build-output`. Gated by
 * `registry.test.js` ("the snapshot survives a build").
 */
const SNAPSHOT_DIR = '.device-runs';

/**
 * Where snapshots lived before the move above. Read-only, and only as a
 * fallback: without it, upgrading across this change orphans a snapshot for a
 * device that is stranded RIGHT NOW — the one moment the file matters most.
 * Harmless to keep, harmless to delete once no such snapshot can exist.
 */
const LEGACY_SNAPSHOT_DIR = path.join('out', 'rta');

/**
 * Keys the app itself rewrites as a normal consequence of booting, so they
 * cannot be held to the snapshot across the restore's cold start.
 *
 * `LastRunVersion` is the only one: `main.bs` writes it post-migration whenever
 * the running build's version differs from the stored one, in the global
 * section and in the active user's section, and `migrations.bs` back-fills it
 * into any user section that lacks it. Deploying an RTA build therefore changes
 * it legitimately — it is app bookkeeping about the app, not user state.
 *
 * This is a DENY-list of app-owned keys, not an allow-list of test-owned ones:
 * anything new the seeds or the app leave behind fails the verify loudly rather
 * than passing silently, which is the direction the old design got wrong.
 */
const APP_OWNED_KEYS = new Set(['lastrunversion']);

/**
 * Credentials the app RE-MINTS for the same user on the same server, so their
 * VALUE cannot be held to the snapshot — only their presence.
 *
 * Without this the restore could not converge, and the failure was not rare:
 * `resolveUser()` validates the stored token over REST on every cold boot, and on
 * rejection falls back to `getToken(username, "")`, whose response `user.Login`
 * persists (`source/loginRouter.bs` -> `source/utils/session.bs`). The restore's
 * verify IS a cold boot. So it wrote the snapshot's token, the app replaced it,
 * and the compare failed — every attempt, forever. Worse, the snapshot is
 * deliberately KEPT on failure and `snapshotRegistry()` restores from it first, so
 * one occurrence wedged every LATER run, and `npm run rta:restore` re-ran the same
 * loop. Reproduced deliberately on `.177` (plant a bad token, cold boot, read
 * back); the app's own console says `Auth token is no longer valid - attempting
 * no-password login` / `login success!`.
 *
 * PRESENCE still counts, in both directions, and that is what keeps this an
 * exemption rather than a hole:
 *
 *   - snapshot had one, device now has none  -> DIFF. The session was destroyed;
 *     that is exactly the "signed my device out" damage this module exists to stop.
 *   - snapshot had none, device now has one  -> DIFF. We left a credential behind.
 *   - both present, values differ            -> fine. The app re-minted its own.
 *
 * `primaryImageTag` rides the same `if saveCredentials` block in `session.bs`,
 * written from the same login response — so it is the same class by construction.
 * Included on that shared code path rather than on an observed failure, because
 * the failure it would produce is the wedging one above, and finding out the
 * expensive way costs more than exempting an avatar tag.
 *
 * The other members of the app's own `sessionKeys` list (`settings.bs`) stay
 * byte-asserted: `username` and `serverId` are re-written by the same login but
 * with STABLE values, so they compare equal and losing that assertion would buy
 * nothing.
 *
 * This is the same split the measurement guard settled on independently — assert
 * IDENTITY, record everything else. `serverId` / `userId` / every setting stay
 * exact; only what the app mints for itself is exempt.
 */
const SESSION_CREDENTIAL_KEYS = new Set(['authtoken', 'primaryimagetag']);

const isPresent = (v) => v !== null && v !== undefined && v !== '';

/** Values are secrets when the key says so — used to redact diff output. */
const SECRET_KEY = /token|password|secret/i;

function deviceHost() {
  return device.getCurrentDeviceConfig().host;
}

function snapshotPath() {
  return path.join(SNAPSHOT_DIR, `registry-${deviceHost()}.json`);
}

/** The pre-move location — read as a fallback, never written. See `LEGACY_SNAPSHOT_DIR`. */
function legacySnapshotPath() {
  return path.join(LEGACY_SNAPSHOT_DIR, `registry-${deviceHost()}.json`);
}

/**
 * Where `--accept` records what it could NOT restore. See `writeAcceptedRecord`.
 *
 * A distinct PREFIX rather than a `registry-<host>.accepted.json` suffix, and that
 * is not cosmetic: the stranded-snapshot glob in `scripts/device-lock.js` matches
 * `registry-(.+)\.json` greedily, so a suffixed name would be reported as a stranded
 * snapshot for a device called `<host>.accepted` — and offer a recovery command with
 * that as its `ROKU_IP`. Two different prefixes cannot collide however either glob
 * is later edited.
 */
function acceptedPath() {
  return path.join(SNAPSHOT_DIR, `accepted-${deviceHost()}.json`);
}

/** Both places a stranded snapshot could be, newest location first. */
const snapshotCandidates = () => [snapshotPath(), legacySnapshotPath()];

/** The snapshot directory, exported so a test can assert it is outside the build output. */
export const snapshotDir = () => SNAPSHOT_DIR;

function redact(key, value) {
  if (value === null || value === undefined) return '<absent>';
  if (SECRET_KEY.test(key)) return `<${String(value).length} chars>`;
  const s = String(value);
  return s.length > 80 ? `${s.slice(0, 80)}…` : s;
}

/**
 * Every difference between a snapshot and a live read, as `{section, key, want, got}`.
 *
 * Three tiers, narrowest exemption first:
 *   - `APP_OWNED_KEYS` — ignored outright; the app rewrites them about itself.
 *   - `SESSION_CREDENTIAL_KEYS` — compared on PRESENCE, because the app re-mints
 *     the value for the same user. See that constant for why, and for the two
 *     directions that still fail.
 *   - everything else — byte-equal, in both directions: a key that changed, a key
 *     that vanished, and a key or whole section that appeared.
 */
export function compareRegistries(saved, live) {
  const diffs = [];
  const sameEnough = (key, want, got) =>
    SESSION_CREDENTIAL_KEYS.has(key.toLowerCase())
      ? isPresent(want) === isPresent(got)
      : want === got;

  for (const [section, keys] of Object.entries(saved)) {
    for (const [key, want] of Object.entries(keys)) {
      if (APP_OWNED_KEYS.has(key.toLowerCase())) continue;
      const got = live[section]?.[key] ?? null;
      if (!sameEnough(key, want, got)) diffs.push({ section, key, want, got });
    }
  }
  for (const [section, keys] of Object.entries(live)) {
    for (const key of Object.keys(keys)) {
      if (APP_OWNED_KEYS.has(key.toLowerCase())) continue;
      // A key the snapshot never had is a leak whatever its name — a session
      // credential appearing in a section that had none is precisely the "left
      // signed into the demo server" damage, so presence-comparison does not
      // soften this direction.
      if (saved[section]?.[key] === undefined) {
        diffs.push({ section, key, want: null, got: keys[key] });
      }
    }
  }
  return diffs;
}

/** The writes + section deletions that turn `live` back into `saved`. */
export function planRestore(saved, live) {
  // A section that exists now and was not in the snapshot is entirely ours —
  // the demo user's section is exactly this shape. Delete it outright rather
  // than nulling its keys, so no empty husk is left behind.
  const sectionsToDelete = Object.keys(live).filter((section) => !(section in saved));

  const writes = {};
  for (const [section, keys] of Object.entries(saved)) {
    const current = live[section] || {};
    const patch = {};
    for (const [key, value] of Object.entries(keys)) {
      // Session credentials are written back like everything else, deliberately.
      // An earlier cut of the presence fix skipped the write whenever the device
      // already had one, reasoning that the live token is the app's own and works
      // — but that is not "as we found it", it is "whatever the run left", and the
      // hardware repro proved the difference: it left the device holding a
      // deliberately-invalid planted token and called that converged. The value
      // restored here is the USER's. If it has since expired the app re-logins on
      // the next boot, which is what it would do anyway; the COMPARE is what stops
      // that re-mint from failing the verify (see `SESSION_CREDENTIAL_KEYS`).
      if (current[key] !== value) patch[key] = value;
    }
    // `null` deletes the key (see RTA_OnDeviceComponentTask.brs) — this is what
    // removes keys the run added to a section the user already had, e.g. a
    // `display.<libraryId>.landing` seeded onto a real user.
    for (const key of Object.keys(current)) {
      if (!(key in keys)) patch[key] = null;
    }
    if (Object.keys(patch).length) writes[section] = patch;
  }
  return { sectionsToDelete, writes };
}

/**
 * The record `--accept` leaves behind, as a plain object. Pure, so the redaction
 * below is unit-testable without a device.
 *
 * REDACTED on purpose, and this is the one place the two files differ in kind: the
 * snapshot has to hold real values because it exists to write them back, which is
 * why it is treated as a secret at rest. This record only has to say WHAT was left
 * wrong, so it stores the same `<n chars>` elision the console shows — making it
 * safe to read, paste into an issue, or delete. It is evidence, never a backup.
 */
export function buildAcceptedRecord({ host, acceptedAt, label, diffs, previous = null }) {
  const event = {
    acceptedAt,
    label,
    differences: diffs.map((d) => ({
      section: d.section,
      key: d.key,
      want: redact(d.key, d.want),
      got: redact(d.key, d.got),
    })),
  };
  // APPENDS, because a second accept must not erase the first. Nothing repairs an
  // accepted difference — the original value is gone — so an earlier event is still
  // live damage when a later one lands, and overwriting would quietly drop it while
  // leaving the device exactly as wrong. The file grows only when a human accepts
  // something and never clears it, which is the point.
  const events = Array.isArray(previous?.events) ? previous.events : [];
  return { host, events: [...events, event] };
}

/**
 * Persist that record, and return the path so the caller can name it.
 *
 * Why it has to outlive the terminal: `--accept` CLEARS the snapshot, which is the
 * whole point — an unconvergeable residual otherwise wedges every later run. But
 * clearing it also removes the only durable signal that anything is wrong, and the
 * next `snapshotRegistry()` then captures the accepted-dirty state as if it were the
 * user's own. That is precisely the compounding damage described at the top of this
 * file (run N leaks, run N+1 adopts the leak as the baseline), arrived at from the
 * other direction. A `console.warn` dies with the scrollback; this file is what
 * `npm run device:status` reads, so "I accepted something on this device" survives.
 *
 * Nothing here clears it on a later successful restore, deliberately. A verified
 * restore proves the device matches the LAST snapshot — and after an accept, that
 * snapshot is the accepted state. It cannot prove the original value came back,
 * because that value is gone. Only a human can close this, by deleting the file.
 */
function writeAcceptedRecord(diffs, label) {
  const file = acceptedPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // An unreadable existing record cannot be preserved, but it must not stop this
  // one being written: the alternative to a partial history is no history.
  let previous = null;
  try {
    previous = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    /* no prior record, or a corrupt one — start the history here */
  }
  fs.writeFileSync(
    file,
    JSON.stringify(
      buildAcceptedRecord({
        host: deviceHost(),
        acceptedAt: new Date().toISOString(),
        label,
        diffs,
        previous,
      }),
      null,
      2,
    ),
  );
  return file;
}

function writeSnapshotFile(values) {
  const file = snapshotPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({ host: deviceHost(), takenAt: new Date().toISOString(), values }, null, 2),
  );
  return file;
}

/**
 * Clears BOTH locations. A restore driven from the legacy fallback has to remove
 * the file it actually read, or every later run would re-detect it as stranded
 * and restore from it again — turning a one-off recovery into a permanent one.
 */
function clearSnapshotFile() {
  for (const file of snapshotCandidates()) fs.rmSync(file, { force: true });
}

/**
 * Read a snapshot file written by a previous process, or `null` if there is none.
 * Refuses a file belonging to another device — restoring device A's registry onto
 * device B would be worse than doing nothing.
 *
 * Checks the current location then the legacy one, so a device stranded before
 * the move is still recoverable. The returned object carries the `file` it came
 * from: a caller reporting "the previous run never restored this device" has to
 * name the path it actually found, not the one it would write.
 */
export function readSnapshotFile(file) {
  const found = (file ? [file] : snapshotCandidates()).find((f) => fs.existsSync(f));
  if (!found) return null;
  const parsed = JSON.parse(fs.readFileSync(found, 'utf8'));
  const host = deviceHost();
  if (parsed.host !== host) {
    throw new Error(
      `${found} was taken from ${parsed.host}, but this run targets ${host}. ` +
        "Refusing to restore one device's registry onto another — delete the file if it is stale.",
    );
  }
  parsed.file = found;
  return parsed;
}

/**
 * Snapshot the device's ENTIRE registry, persisting it before returning.
 *
 * If a snapshot file is already sitting there, the previous run never completed
 * its restore (killed, crashed, or a restore that threw). Restore from it FIRST,
 * so this run's snapshot captures the user's state rather than the last run's
 * seeded leftovers. Without this the damage compounds silently: run N leaks, run
 * N+1 adopts the leak as the baseline and faithfully restores it forever.
 */
export async function snapshotRegistry() {
  const stranded = readSnapshotFile();
  if (stranded) {
    console.warn(
      `\n[registry] ${stranded.file} exists — the previous run never restored this device.` +
        `\n[registry] Restoring from it first so this run does not snapshot its leftovers.`,
    );
    await applyRestore(stranded.values, { attempts: 3, label: 'stranded snapshot' });
    clearSnapshotFile();
  }

  const { values } = await odc.readRegistry();
  const file = writeSnapshotFile(values);
  console.log(
    `[registry] snapshot: ${Object.keys(values).length} sections -> ${file} (restore: npm run rta:restore)`,
  );
  return values;
}

/**
 * Put the registry back to `saved`, and PROVE it took.
 *
 * Write → cold restart → read back → compare EVERYTHING → retry → throw. The
 * cold restart is not optional and `relaunch()` will not do: an ECP
 * `/launch/dev` against a running channel only foregrounds it, so the app keeps
 * the seeded session in memory and re-persists it over the restore. Verifying
 * after the restart is what makes the check mean "this survives", rather than
 * "the write landed for now".
 *
 * On success the snapshot file is removed. On failure it is deliberately kept —
 * that file is the recovery path, for the next run and for `npm run rta:restore`.
 */
export async function restoreRegistry(saved, { attempts = 3, accept = false } = {}) {
  await applyRestore(saved, { attempts, label: 'restoreRegistry', accept });
  clearSnapshotFile();
  armed = null; // nothing left for the interrupt handler to do
}

async function applyRestore(saved, { attempts, label, accept = false }) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const { values: live } = await odc.readRegistry();
    const { sectionsToDelete, writes } = planRestore(saved, live);

    if (sectionsToDelete.length) await odc.deleteRegistrySections({ sections: sectionsToDelete });
    if (Object.keys(writes).length) await odc.writeRegistry({ values: writes });

    // Cold start, so the verify below reads what SURVIVES rather than what we
    // just wrote over a still-running app.
    await hardRelaunch();

    const { values: after } = await odc.readRegistry().catch(() => ({ values: {} }));
    const diffs = compareRegistries(saved, after);
    if (diffs.length === 0) return;

    if (attempt === attempts) {
      const detail = diffs
        .map(
          (d) =>
            `    ${d.section}.${d.key}: want ${redact(d.key, d.want)} / got ${redact(d.key, d.got)}`,
        )
        .join('\n');
      // The operator override. Deliberately loud and deliberately not a retry: it
      // does NOT claim the device is clean, it says these differences were seen
      // and accepted so the snapshot can be cleared. Without it, a residual this
      // loop cannot converge wedges every LATER run — `snapshotRegistry()`
      // restores from the kept file first and hits the same wall — and the
      // documented recovery re-runs the same loop, so the only way out was `rm`
      // on a file that is also the device's only backup. That is a worse failure
      // than an accepted diff, which is why this exists.
      //
      // The record is written BEFORE the caller clears the snapshot, so there is no
      // window in which the device is dirty and nothing on disk says so.
      if (accept) {
        const record = writeAcceptedRecord(diffs, label);
        console.warn(
          `[registry] ${label}: ACCEPTING ${diffs.length} unrestored difference(s) ` +
            `on operator override.\n${detail}\n` +
            '[registry] The device is NOT as it was found. Treat any measurement ' +
            'taken from it as unverified until you have checked these by hand.\n' +
            `[registry] Recorded to ${record} — \`npm run device:status\` will keep ` +
            'reporting it until you delete that file. (Safe to delete: it is redacted ' +
            'evidence, not a backup.)',
        );
        return;
      }
      throw new Error(
        `${label} failed after ${attempts} attempts — this device is NOT as we found it.\n` +
          `  ${diffs.length} difference(s):\n${detail}\n` +
          `  Recover with: npm run rta:restore  (snapshot kept at ${snapshotPath()})\n` +
          '  If it keeps failing on the same keys, `npm run rta:restore -- --accept`\n' +
          '  records them and clears the snapshot, so the next run is not blocked too.\n' +
          '  Do not trust any on-device measurement from this device until it is fixed.',
      );
    }
  }
}

// ── Interrupt-safe restore ──────────────────────────────────────────────────
//
// A Ctrl-C during a ~13-minute suite terminates before any `finally` /
// `afterAll` / teardown runs. Arming registers signal handlers that run the
// same verified restore before exiting.
//
// This is now BEST-EFFORT convenience rather than the safety net it used to
// have to be: the snapshot is on disk before any seeding, so even a SIGKILL is
// recoverable — the next run repairs the device automatically, and
// `npm run rta:restore` does it on demand.
let armed = null;
let restoring = false;
let handlersInstalled = false;

/**
 * Restore `saved` if this process is interrupted. Call right after
 * `snapshotRegistry()`; a successful `restoreRegistry()` disarms it.
 *
 * A second interrupt abandons the restore and exits immediately, so a wedged
 * device can never trap someone in an un-killable process — the snapshot file
 * makes that safe to do.
 */
export function armRestoreOnInterrupt(saved) {
  armed = saved;
  if (handlersInstalled) return;
  handlersInstalled = true;

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      if (!armed) process.exit(130);
      if (restoring) {
        console.log(`\n[registry] second ${signal} — abandoning restore, exiting now.`);
        console.log(`[registry] recover with: npm run rta:restore`);
        process.exit(130);
      }
      restoring = true;
      const saving = armed;
      console.log(
        `\n[registry] ${signal} received — restoring the device registry before exit.` +
          ' This takes ~30s (cold restart + verify). Ctrl-C again to abandon.',
      );
      restoreRegistry(saving, { attempts: 2 })
        .then(() => console.log('[registry] VERIFIED CLEAN — device left as found.'))
        .catch((e) => {
          console.error(`[registry] FAILED: ${e.message}`);
          console.error('[registry] recover with: npm run rta:restore');
        })
        .finally(() => process.exit(130));
    });
  }
}

/** Drop the interrupt-restore arming (e.g. after restoring by another path). */
export function disarmRestoreOnInterrupt() {
  armed = null;
}
