/**
 * Registry seeding to land the app deterministically on a screen.
 *
 * NOTE: these write the REAL `JellyRock` registry (not a `test-*` section)
 * because the app reads the real keys to decide which screen to show. That is
 * inherent to driving the real app from outside (unlike in-process Rooibos tests,
 * which the `test-*` isolation rule governs). Putting the device back afterwards
 * is [`registry.js`](registry.js)'s job: it snapshots the whole registry before
 * any of this runs, so nothing here needs a matching "and undo it" list.
 */
import { odc } from 'roku-test-automation';

export const GLOBAL = 'JellyRock';

/**
 * Prove a seed actually survived the relaunch.
 *
 * The failure this exists to catch is silent and expensive. The app reads the
 * registry only when it starts, so a seed reaches it only through a cold start;
 * if the app did not start cold, it keeps its in-memory session and can write it
 * back over the seed. The suite then drives an app
 * pointed at the wrong server using the seeded server's item ids: every
 * content-dependent test fails with an unrelated-looking timeout, and a capture
 * run would silently photograph the wrong library. It cost a full CI run and two
 * device runs to trace once, hence a loud, specific assertion instead.
 *
 * Seeds return their own expected `server` value (a URL, or `null` for
 * server-select, where the key is deleted on purpose), so this stays correct
 * as seeds are added.
 *
 * ## The landing view, when one was seeded
 *
 * `server` alone cannot see a lost seed when two seeds in a row name the same server,
 * which is every pair of Home seeds in the suite. A seeded landing view can: pass what
 * `seedLibraryLanding` returned, and this also checks the view the APP holds in memory
 * (`m.global.user.settings.displaySettings`, filled from the registry at login). The
 * registry alone would hold the seed even if the app never read it again, so only the
 * app's copy proves the cold start happened. Call it after `hardRelaunch()`, which
 * returns once the login flow has landed.
 *
 * @param {string|null} expectedServer - what the seed said it wrote
 * @param {string} label - screen / test name, for the error message
 * @param {object} [options]
 * @param {{libraryId: string, view: string}|null} [options.landing] - what
 *   `seedLibraryLanding` returned, to check the view as well
 */
export async function assertSeedTookEffect(expectedServer, label, { landing = null } = {}) {
  const values = (await odc.readRegistry({}))?.values || {};
  const live = values[GLOBAL]?.server ?? null;
  const want = expectedServer ?? null;
  if (live !== want) {
    throw new Error(
      `seed did not take for "${label}": registry says server=${JSON.stringify(live)} ` +
        `but the seed wrote ${JSON.stringify(want)}. The app did not start cold and wrote ` +
        'its in-memory session back over the seed: the relaunch after seeding must be ' +
        'hardRelaunch(), which confirms the app exited before launching it again.',
    );
  }
  if (!landing) return;
  // Named field only: `displaySettings` holds view settings, never a credential, while a
  // read of `m.global.user` whole would carry `authToken` into whatever logs the error.
  const held = (await odc.getValue({ base: 'global', keyPath: 'user.settings.displaySettings' }))
    ?.value?.[landing.libraryId]?.landing;
  if (held === landing.view) return;
  throw new Error(
    `seed did not take for "${label}": the app holds landing view ${JSON.stringify(held)} ` +
      `for library ${landing.libraryId}, but the seed wrote ${JSON.stringify(landing.view)}. ` +
      'The app did not read the registry again after the seed, so it did not start cold: ' +
      'the relaunch after seeding must be hardRelaunch().',
  );
}

/**
 * Clear all sticky per-library view settings (`display.<libraryId>.*` keys in the
 * user's registry section) so a screen starts from the presenter DEFAULT view.
 * Library views are sticky (set by the grid options dialog, persisted to registry),
 * so without this a view seeded for one screen leaks into the next. For example, a
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
    id: session.serverId, // GUID: what a cast's serverId is matched against (findServerInList)
    baseUrl: session.serverUrl, // canonical https URL; the reachability pre-flight probes this
    originalUrl: session.serverUrl, // becomes the `server` setting on switch (canonical = no redirect step)
    iconUrl: 'pkg:/images/branding/logo-icon120.jpg',
    iconWidth: 120,
    iconHeight: 120,
  };
}

/**
 * Seed registry to land logged-in on Home as `primary`'s user, with `saved_servers` listing
 * every passed session. This is the state a cast-to-another-server demo needs: signed into one
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
 * on submit. The login router shows server-select interactively whenever `server` is
 * unset (`loginRouter.bs`), so we delete `server` (and `active_user`) and populate
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
        // Match SaveServerList()'s persisted shape (`config.bs`) so the picker
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
  return null; // `server` is absent on this screen on purpose
}

/** Seed registry to land on the user-select screen (server known, no active user). */
export async function seedUserSelect(session, locale) {
  // Delete only active_user (null = delete that key) so the login router stops at
  // user-select; set the pre-login language. Non-destructive: saved_servers /
  // available_users are preserved. globalTranslationLocale is the only lever that
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
 * options dialog; read at login by `TransformDisplaySettings` in `session.bs`).
 * `libraryId` is resolved at runtime (libraryIdFor), never hardcoded. Call after
 * seedHome and before relaunch; the per-key write merges into the user section
 * seedHome wrote.
 *
 * @returns {Promise<{libraryId: string, view: string}|null>} what was written, for
 *   `assertSeedTookEffect`'s `landing` option; `null` when nothing was.
 */
export async function seedLibraryLanding(session, libraryId, view) {
  if (!libraryId || !view) return null;
  await odc.writeRegistry({
    values: { [session.userId]: { [`display.${libraryId}.landing`]: view } },
  });
  return { libraryId, view };
}
