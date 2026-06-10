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
  };
}

/** Restore a snapshot taken by snapshotSession (best-effort). Caller relaunches. */
export async function restoreSession(saved) {
  await odc.writeRegistry({ values: { [GLOBAL]: saved } }).catch(() => {});
}
