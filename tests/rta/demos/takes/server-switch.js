/**
 * Take: "cast to another server" (#550). Signed into the STABLE demo server, cast an item that
 * lives on the UNSTABLE demo server. The cast names a different saved server's GUID, so the app
 * prompts to switch, re-authenticates against unstable (a full re-auth by design — see
 * replayRoute.bs / SignOut clears active_user), and the stashed cast replays → plays on unstable.
 *
 * Privacy: BOTH servers are public demo servers; the home server is never touched (the runner
 * refuses any non-demo host, and the seed writes only the two demo servers).
 *
 * Beats: Home (stable) → cast id|serverId|action=play → "Change Server?" → Switch → "Switching
 * to unstable…" → user picker (unstable) → select demo user → playback on unstable.
 */

/**
 * Confirm the "Change Server" prompt (a JRDialog overlay, buttons [Cancel, Switch]).
 *
 * The prompt is a scene-appended overlay stamped `#jrDialog`, NOT Roku's modal channel — the
 * main-thread flows moved off `m.scene.dialog` in the #288 phase-3 migration. So every gate here
 * keys off the overlay: it is open while `#jrDialog.id` resolves, and answered once it stops.
 *
 * Buttons are identified by their RENDERED labels rather than by hardcoded translations, matching
 * tests/rta/specs/dialogs.spec.js. (`#buttonRow` is a recursive child id, not a field — don't chain
 * it off `#jrDialog`.) Selecting is then verified by OUTCOME: on "Switch" (not "Cancel") the stashed
 * cast survives to replay.
 */
async function confirmServerSwitch(ctx) {
  // A wait, so it goes through the shared `waitFor` rather than a hand-rolled poll:
  // that is what makes a dialog-never-appeared failure report the state the device was
  // actually in (see the diagnosedError rule in tests/rta/CLAUDE.md). Gating on the button
  // COUNT rather than on `#jrDialog.id` waits for the row to finish building, so the label
  // reads below cannot race an empty row.
  await ctx.waitFor('#buttonRow.getChildCount()', (n) => n === 2, {
    timeout: 15000,
    interval: 500,
    label: 'server-switch: change-server dialog',
  });

  // Hold on the dialog so a viewer can actually READ it ("Change Server? Switch to play '…'?")
  // before the take answers — without this the prompt flashes by faster than a human can follow.
  await ctx.hold(4500, 'Change Server? dialog (read)');

  // Read the labels off the rendered buttons instead of hardcoding translated strings, so the
  // take survives a locale change. ODC can read a field off an indexed child, but not call a
  // method on one, so focus is asserted via the focused NODE (waitFocused).
  const cancelLabel = await ctx.getVal('#buttonRow.0.text');
  const confirmLabel = await ctx.getVal('#buttonRow.1.text');
  // Throw rather than assert vacuously (tests/rta/CLAUDE.md: "make it throw when it verified
  // nothing"). An unresolved label leaves the focus predicates below comparing undefined to
  // undefined, so they would match any node without a `text` field and the take would report
  // green having checked nothing.
  if (!cancelLabel || !confirmLabel) {
    // eslint-disable-next-line no-restricted-syntax -- vacuity guard on a read, cause fully named
    throw new Error(
      `server-switch: could not read the dialog button labels (cancel=${cancelLabel}, confirm=${confirmLabel})`,
    );
  }

  // showConfirmDialog focuses the SAFE side first — assert it, because the single Right below
  // is only correct from Cancel.
  await ctx.waitFocused((f) => f.node?.text === cancelLabel, {
    label: 'server-switch: Cancel focused on open',
    timeout: 5000,
  });

  // One Right lands on Switch. Asserted, not assumed: JRDialog.moveButtonFocus WRAPS
  // ((index + delta + count) mod count) rather than clamping, so a second Right — or a third
  // button — would land back on Cancel and this take would silently click the wrong thing.
  // (The Down this replaces was an orientation hedge for a vertical stack. JRDialog.onKeyEvent
  // handles only back/left/right/OK and swallows everything else, so it was always a no-op.)
  await ctx.press(ctx.ecp.Key.Right);
  await ctx.waitFocused((f) => f.node?.text === confirmLabel, {
    label: 'server-switch: Switch focused',
    timeout: 5000,
  });
  await ctx.press(ctx.ecp.Key.Ok);

  // Self-gate on the dialog actually being answered — the overlay removes itself from the scene —
  // then confirm it was SWITCH not Cancel: on Switch the stash survives (replays post-login); on
  // Cancel it's wiped.
  await ctx.waitFor('#jrDialog.id', (v) => v === undefined, {
    label: 'server-switch: change-server dialog dismissed',
    timeout: 8000,
  });
  const stash = await ctx.odc
    .getValue({ base: 'global', keyPath: 'AuthManager.stashedDeepLink' })
    .catch(() => null);
  if (!stash?.value?.itemid) {
    // eslint-disable-next-line no-restricted-syntax -- outcome check, not a timeout: the stash state IS the diagnosis
    throw new Error(
      'server-switch: dialog dismissed but the cast was canceled (selected Cancel?) — stash cleared',
    );
  }
}

/**
 * After the switch, the re-login lands on the unstable server's user picker (#userRow). Wait for it,
 * hold a beat so the new server's sign-in reads on camera, then select the (no-password) demo user.
 */
async function selectDemoUser(ctx) {
  await ctx.waitFor('#userRow', (v) => v !== undefined && v !== null, {
    label: 'user picker (#userRow)',
    timeout: 30000,
  });
  await ctx.hold(3500, 'user picker (unstable) — orient to the new server'); // it's a screen change; give a beat to register
  await ctx.press(ctx.ecp.Key.Ok); // the single no-password demo user is focused by default
}

export default {
  name: 'server-switch',
  description:
    'Cast to a DIFFERENT saved server — confirm → "Switching to <server>…" → re-login → play on the other server.',
  servers: ['stable', 'unstable'], // signed into the first; cast targets the second

  async run(ctx) {
    // Resolve a real movie + title on the TARGET (unstable) server — that's where the cast lands.
    // target.serverId is unstable's DISTINCT id (the runner applies DEMO_SERVERS.syntheticServerId,
    // because the two demo servers are clones that share one real GUID); the cast targets it below.
    const target = ctx.sessionFor('unstable');
    const movie = await ctx.firstMovieOn('unstable');
    // eslint-disable-next-line no-restricted-syntax -- fail-fast on a REST result, before the device is driven
    if (!movie.id) throw new Error('server-switch: no movie found on the unstable demo server');

    await ctx.landWithSavedServers(); // logged into stable, both demo servers saved
    await ctx.startGate();

    await ctx.hold(3000, 'Home (stable)');

    // Cast an item that lives on the OTHER saved server → triggers the switch prompt. itemName rides
    // as a sibling param so the prompt reads "Switch to play '<title>'?".
    await ctx.cast(`id=${movie.id}|serverId=${target.serverId}|action=play`, {
      itemName: movie.name,
    });

    await confirmServerSwitch(ctx); // wait for the dialog, select Switch, verify it took
    await ctx.hold(2500, 'Switching to unstable…'); // reachability pre-flight + re-login underway

    await selectDemoUser(ctx); // unstable user picker → pick the demo user

    await ctx.waitPlaying(60000); // re-login + Home load + stashed-cast replay
    await ctx.hold(9000, 'playback (unstable)');
  },
};
