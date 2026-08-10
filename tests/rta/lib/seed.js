/**
 * Registry seeding to land the app deterministically on a screen.
 *
 * NOTE: these write the REAL `JellyRock` registry (not a `test-*` section)
 * because the app reads the real keys to decide which screen to show — inherent
 * to driving the real app from outside (unlike in-process Rooibos tests, which
 * the `test-*` isolation rule governs). Putting the device back afterwards is
 * [`registry.js`](registry.js)'s job — it snapshots the WHOLE registry before
 * any of this runs, so nothing here needs a matching "and undo it" list.
 */
import { odc } from 'roku-test-automation';

export const GLOBAL = 'JellyRock';

/**
 * Prove a seed actually survived the relaunch.
 *
 * The failure this exists to catch is silent and expensive. `relaunch()` only
 * FOREGROUNDS an already-running channel, so the app keeps its in-memory session
 * and re-persists it over whatever was just seeded. The suite then drives an app
 * pointed at the wrong server using the seeded server's item ids: every
 * content-dependent test fails with an unrelated-looking timeout, and a capture
 * run would silently photograph the wrong library. It cost a full CI run and two
 * device runs to trace once — hence a loud, specific assertion instead.
 *
 * Seeds return their own expected `server` value (a URL, or `null` for
 * server-select, where the key is deliberately deleted), so this stays correct
 * as seeds are added.
 *
 * @param {string|null} expectedServer - what the seed said it wrote
 * @param {string} label - screen / test name, for the error message
 */
export async function assertSeedTookEffect(expectedServer, label) {
  const values = (await odc.readRegistry({}))?.values || {};
  const live = values[GLOBAL]?.server ?? null;
  const want = expectedServer ?? null;
  if (live === want) return;
  throw new Error(
    `seed did not take for "${label}": registry says server=${JSON.stringify(live)} ` +
      `but the seed wrote ${JSON.stringify(want)}. The app re-persisted its in-memory ` +
      'session over the seed — the relaunch after seeding must be hardRelaunch() ' +
      '(a plain relaunch only foregrounds a running channel).',
  );
}

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
  return session.serverUrl;
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
  return primary.serverUrl;
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
  return null; // `server` is deliberately absent on this screen
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
  return session.serverUrl;
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
