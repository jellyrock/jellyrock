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
 * Confirm the "Change Server" StandardMessageDialog (buttons [Cancel, Switch]). A scene `dialog` is
 * a Roku overlay whose focus is managed internally — getFocusedNode keeps reporting the underlying
 * view — so we gate on the dialog NODE, drive it with keypresses, and verify by OUTCOME: the pending
 * flag clears once it's answered, and on "Switch" (not "Cancel") the stashed cast survives to replay.
 */
async function confirmServerSwitch(ctx) {
  // A wait, so it goes through the shared `waitFor` rather than a hand-rolled poll:
  // that is what makes a dialog-never-appeared failure report the state the device was
  // actually in (see the diagnosedError rule in tests/rta/CLAUDE.md). `getVal` yields
  // the `dialog` node's value when the keyPath resolves, so the predicate reads its
  // subtype directly.
  await ctx.waitFor('dialog', (d) => d?.subtype === 'StandardMessageDialog', {
    timeout: 15000,
    interval: 500,
    label: 'server-switch: change-server dialog',
  });

  // Hold on the dialog so a viewer can actually READ it ("Change Server? Switch to play '…'?")
  // before the take answers — without this the prompt flashes by faster than a human can follow.
  await ctx.hold(4500, 'Change Server? dialog (read)');

  // Buttons are [Cancel, Switch] (Switch = the last/affirmative). Clamp onto it — Down for a
  // vertical button stack, Right for a horizontal one; each is a harmless no-op in the other
  // orientation, and a 2-button list clamps at its end — then select.
  await ctx.press(ctx.ecp.Key.Down);
  await ctx.press(ctx.ecp.Key.Right);
  await ctx.sleep(500);
  await ctx.press(ctx.ecp.Key.Ok);

  // Self-gate on the dialog actually being answered (the pending flag clears), then confirm it was
  // SWITCH not Cancel: on Switch the stash survives (replays post-login); on Cancel it's wiped.
  const answered = async () => {
    const p = await ctx.odc
      .getValue({ base: 'global', keyPath: 'sceneManager.isPendingServerSwitch' })
      .catch(() => null);
    return p?.value === false;
  };
  const t0 = Date.now();
  while (Date.now() - t0 < 8000 && !(await answered())) await ctx.sleep(400);
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
