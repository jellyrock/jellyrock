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

export const GLOBAL = 'JellyRock';

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

/** Snapshot the device's current top-level session so it can be restored after. */
export async function snapshotSession() {
  const before = (await odc.readRegistry())?.values?.[GLOBAL] || {};
  return {
    server: before.server ?? null,
    active_user: before.active_user ?? null,
    globalTranslationLocale: before.globalTranslationLocale ?? null,
    // seedServerSelect writes saved_servers, so it must be snapshotted+restored too,
    // else the seeded one-server list leaks onto the device (null restore deletes it).
    saved_servers: before.saved_servers ?? null,
  };
}

/** Restore a snapshot taken by snapshotSession (best-effort). Caller relaunches. */
export async function restoreSession(saved) {
  await odc.writeRegistry({ values: { [GLOBAL]: saved } }).catch(() => {});
}
