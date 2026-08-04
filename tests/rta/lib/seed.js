/**
 * Registry seeding to land the app deterministically on a screen, plus
 * snapshot/restore of the device's prior session.
 *
 * NOTE: these write the REAL `JellyRock` registry (not a `test-*` section)
 * because the app reads the real keys to decide which screen to show — inherent
 * to driving the real app from outside (unlike in-process Rooibos tests, which
 * the `test-*` isolation rule governs). `snapshotSession`/`restoreSession` are
 * the safety net: callers snapshot before seeding and restore in a finally /
 * afterAll so the device is left as found.
 */
import { odc } from 'roku-test-automation';
import { hardRelaunch } from './driver.js';

export const GLOBAL = 'JellyRock';

/**
 * Clear all sticky per-library view settings (`display.<libraryId>.*` keys in the
 * user's registry section) so a screen starts from the presenter DEFAULT view.
 * Library views are sticky (set by the grid options dialog, persisted to registry),
 * so without this a view seeded for one screen leaks into the next — e.g. a
 * Genres-view screen would leave the Movies library in Genres (which renders into
 * #genreList, no #itemGrid), breaking the next movie-grid nav. Reset-then-seed
 * makes every capture deterministic regardless of run order or prior device state.
 */
async function clearDisplaySettings(session) {
  const reg = await odc.readRegistry().catch(() => null);
  const userSection = reg?.values?.[session.userId] || {};
  const nulls = {};
  for (const key of Object.keys(userSection)) {
    if (key.startsWith('display.')) nulls[key] = null; // null = delete the key
  }
  if (Object.keys(nulls).length) {
    await odc.writeRegistry({ values: { [session.userId]: nulls } });
  }
}

/** Seed registry to land logged-in on Home as the demo user, in `locale`. */
export async function seedHome(session, locale) {
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
  // Reset sticky library views to defaults; view-dependent screens re-seed after.
  await clearDisplaySettings(session);
}

/** A `saved_servers` list entry built from an authenticated session (mirrors SaveServerList's shape). */
export function savedServerEntry(session) {
  return {
    name: session.serverName,
    id: session.serverId, // GUID — what a cast's serverId is matched against (findServerInList)
    baseUrl: session.serverUrl, // canonical https URL; the reachability pre-flight probes this
    originalUrl: session.serverUrl, // becomes the `server` setting on switch (canonical = no redirect step)
    iconUrl: 'pkg:/images/branding/logo-icon120.jpg',
    iconWidth: 120,
    iconHeight: 120,
  };
}

/**
 * Seed registry to land logged-in on Home as `primary`'s user, with `saved_servers` listing
 * EVERY passed session. This is the state a cast-to-another-server demo needs: signed into one
 * demo server while another is saved, so a cast naming the other server's GUID resolves to a
 * saved entry and prompts the switch (replayRoute.findSavedServerByGuid). All sessions are demo
 * servers (privacy). Composes seedHome's logged-in keys with the SaveServerList saved_servers shape.
 */
export async function seedHomeWithSavedServers(primary, sessions, locale) {
  const savedServers = { serverList: sessions.map(savedServerEntry) };
  await odc.writeRegistry({
    values: {
      [GLOBAL]: {
        server: primary.serverUrl,
        active_user: primary.userId,
        globalRememberMe: 'true',
        globalTranslationLocale: locale,
        saved_servers: JSON.stringify(savedServers),
      },
      [primary.userId]: {
        authToken: primary.token,
        serverId: primary.serverId,
        username: primary.username,
        primaryImageTag: primary.primaryImageTag,
        translationLocale: locale,
      },
    },
  });
  await clearDisplaySettings(primary);
}

/**
 * Seed registry to land on the SERVER-select screen with exactly one saved server:
 * the demo server, saved under the bare scheme-less URL "demo.jellyfin.org/stable"
 * so the picker entry demonstrates the URL parser / http->https redirect we follow
 * on submit. LoginFlow shows server-select interactively whenever `server` is unset
 * (showScenes.bs), so we delete `server` (and `active_user`) and populate
 * `saved_servers`. The remote demo server isn't SSDP-discoverable, so it surfaces
 * via SetServerScreen's "Pass 2" saved-server injection. `id` matches the session's
 * serverId so that pass dedups correctly and marks the entry deletable.
 */
export async function seedServerSelect(session, locale) {
  const savedServers = {
    serverList: [
      {
        name: session.serverName,
        id: session.serverId,
        baseUrl: session.serverUrl, // canonical (https) URL the app connects to
        originalUrl: 'demo.jellyfin.org/stable', // bare URL shown in the picker
        // Match SaveServerList()'s persisted shape (showScenes.bs) so the picker
        // renders the Jellyfin branding icon next to the entry, not a blank slot.
        iconUrl: 'pkg:/images/branding/logo-icon120.jpg',
        iconWidth: 120,
        iconHeight: 120,
      },
    ],
  };
  await odc.writeRegistry({
    values: {
      [GLOBAL]: {
        server: null, // delete -> LoginFlow shows server-select interactively
        active_user: null,
        globalRememberMe: 'false',
        globalTranslationLocale: locale,
        saved_servers: JSON.stringify(savedServers),
      },
    },
  });
}

/** Seed registry to land on the user-select screen (server known, no active user). */
export async function seedUserSelect(session, locale) {
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

/**
 * Seed a deterministic LANDING VIEW for a library so a capture doesn't depend on
 * whatever view is stickily persisted on the device. Views are sticky per library
 * in the user's registry under `display.<libraryId>.landing` (set by the grid's
 * options dialog; read at login by SessionDataTransformer). `libraryId` is resolved
 * at runtime (libraryIdFor) — never hardcoded. Call AFTER seedHome and before
 * relaunch; the per-key write merges into the user section seedHome wrote.
 */
export async function seedLibraryLanding(session, libraryId, view) {
  if (!libraryId || !view) return;
  await odc.writeRegistry({
    values: { [session.userId]: { [`display.${libraryId}.landing`]: view } },
  });
}

/**
 * Snapshot the device's current top-level session so it can be restored after.
 *
 * Every key any seed in this file writes to `GLOBAL` must be listed here, or the
 * seeded value survives the restore. `globalRememberMe` is the one that bit:
 * `seedHome` forces it to `'true'`, so without snapshotting it a device that had
 * remember-me OFF silently came back with it ON.
 */
export async function snapshotSession() {
  const before = (await odc.readRegistry())?.values?.[GLOBAL] || {};
  return {
    server: before.server ?? null,
    active_user: before.active_user ?? null,
    globalTranslationLocale: before.globalTranslationLocale ?? null,
    globalRememberMe: before.globalRememberMe ?? null,
    // seedServerSelect writes saved_servers, so it must be snapshotted+restored too,
    // else the seeded one-server list leaks onto the device (null restore deletes it).
    saved_servers: before.saved_servers ?? null,
  };
}

/**
 * Restore a snapshot taken by `snapshotSession`, and PROVE it took.
 *
 * A best-effort write is not enough here, for two reasons:
 *
 *  1. The app is still RUNNING with the seeded session live in memory, and it
 *     re-persists that session. A write that lands can therefore be clobbered
 *     the moment the channel next exits — and an ECP `/launch/dev` against a
 *     running channel only foregrounds it, so a plain `relaunch()` does not
 *     clear the stale session either. Hence `hardRelaunch`.
 *  2. The previous implementation swallowed every error (`.catch(() => {})`),
 *     which made a failed restore completely invisible.
 *
 * Together those left devices signed into `demo.jellyfin.org` twice, each time
 * silently invalidating a later on-device measurement — the row count was the
 * only tell (3 libraries instead of the real server's) and it was noticed late
 * both times. See the followup in docs/progress.md.
 *
 * So: write → cold restart → read back → compare. On failure this THROWS.
 * A loud failure in an `afterAll` is much cheaper than a device that quietly
 * lies to whatever runs next.
 */
export async function restoreSession(saved, { attempts = 3 } = {}) {
  const keys = Object.keys(saved);
  let observed = {};

  for (let attempt = 1; attempt <= attempts; attempt++) {
    await odc.writeRegistry({ values: { [GLOBAL]: saved } });
    await hardRelaunch();
    observed = (await odc.readRegistry().catch(() => null))?.values?.[GLOBAL] || {};

    // `null` in the snapshot means "the key was absent"; a deleted key reads back
    // as undefined, so normalise both sides before comparing.
    const wrong = keys.filter((k) => (observed[k] ?? null) !== (saved[k] ?? null));
    if (wrong.length === 0) return;

    if (attempt === attempts) {
      throw new Error(
        `restoreSession failed after ${attempts} attempts — this device is NOT as we found it.\n` +
          `  mismatched keys: ${wrong.join(', ')}\n` +
          `  expected server: ${saved.server}\n` +
          `  actual server:   ${observed.server}\n` +
          `Do not trust any on-device measurement from this device until it is fixed.`,
      );
    }
  }
}
