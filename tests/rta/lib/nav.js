/**
 * In-app navigation to each screen, driven from a seeded "home" state with
 * remote keypresses + odc node-waits (NOT fixed sleeps) so each step proceeds
 * the moment the UI is actually ready. The `waitFor` gates inside each nav ARE
 * the "screen loaded" assertions — if a screen fails to render, the nav throws.
 *
 * `ctx` carries { heroIndex, heroId } (from getHero). The osd backdrop injection
 * is intentionally NOT here — it's a screenshot-only concern handled by the
 * store orchestrator after nav, so the functional test for osd stays free of
 * ffmpeg/backdrop logic.
 */
import { ecp, odc } from 'roku-test-automation';
import { press, getVal, waitFor, waitFocused, waitHome, hasChildren, sleep } from './steps.js';

/**
 * home -> overhang settings icon -> Settings screen. Up moves focus from the home
 * content into the overhang; the overhang focus chain is TabBar -> Search ->
 * Settings (left to right, see JROverhang.bs), with a variable tab count, so we
 * walk Right until the settings icon (id "settingsIcon") is focused. The action is
 * guarded to only press while NOT yet on the icon, so it can't overshoot onto the
 * user dropdown. The version label (settings.bs: "v" + app.version) is the load gate.
 */
export async function navSettings() {
  await waitHome();
  await press(ecp.Key.Up); // home content -> overhang
  await waitFocused((f) => f?.node?.id === 'settingsIcon', {
    timeout: 15000,
    interval: 400,
    action: async () => {
      const f = await odc.getFocusedNode({ includeNode: true }).catch(() => null);
      if (f?.node?.id !== 'settingsIcon') await press(ecp.Key.Right);
    },
    label: 'overhang settings icon',
  });
  await press(ecp.Key.Ok);
  await waitFor('#versionLabel.text', (t) => typeof t === 'string' && /^v/.test(t), {
    label: 'settings version label',
    timeout: 20000,
  });
  await sleep(1000); // let the settings menu + panels paint before capture
}

/**
 * Locate a library tile on the Home screen by its Jellyfin collectionType
 * ("movies" | "tvshows" | "music" | "playlists" | ...). The Home layout is
 * server-side user-configurable (the "My Media" row's position AND its tile order
 * can be changed from any Jellyfin web client on the demo account), so we resolve
 * the tile by CONTENT, never by a fixed index: find the row whose sectionId is
 * "library", then the tile whose collectionType matches. Returns { row, col }.
 */
async function findHomeLibraryTile(collectionType) {
  const rowCount = (await getVal('#homeRows.content.getChildCount()')) || 0;
  for (let r = 0; r < rowCount; r++) {
    const sectionId = await getVal(`#homeRows.content.${r}.sectionId`);
    if (sectionId !== 'library') continue;
    const tiles = (await getVal(`#homeRows.content.${r}.getChildCount()`)) || 0;
    for (let c = 0; c < tiles; c++) {
      const ct = await getVal(`#homeRows.content.${r}.${c}.collectionType`);
      if (ct === collectionType) return { row: r, col: c };
    }
  }
  throw new Error(`home library tile collectionType="${collectionType}" not found`);
}

/**
 * home -> focus the library tile of `collectionType` -> OK -> its library grid.
 * Drives the HomeRows RowList focus to the resolved [row, col] by reading
 * `rowItemFocused` and stepping Down/Up then Right/Left (guarded so it can't
 * overshoot), independent of how the demo account has arranged its Home screen.
 */
export async function navLibraryByType(collectionType) {
  await waitHome();
  const { row, col } = await findHomeLibraryTile(collectionType);
  // Vertical: step to the library row.
  await waitFor('#homeRows.rowItemFocused', (v) => Array.isArray(v) && v[0] === row, {
    timeout: 12000,
    interval: 350,
    action: async () => {
      const v = await getVal('#homeRows.rowItemFocused');
      if (!Array.isArray(v)) return;
      if (v[0] < row) await press(ecp.Key.Down);
      else if (v[0] > row) await press(ecp.Key.Up);
    },
    label: `home library row ${row} (${collectionType})`,
  });
  // Horizontal: step to the target tile within that row.
  await waitFor('#homeRows.rowItemFocused', (v) => Array.isArray(v) && v[1] === col, {
    timeout: 12000,
    interval: 350,
    action: async () => {
      const v = await getVal('#homeRows.rowItemFocused');
      if (!Array.isArray(v)) return;
      if (v[1] < col) await press(ecp.Key.Right);
      else if (v[1] > col) await press(ecp.Key.Left);
    },
    label: `home library tile col ${col} (${collectionType})`,
  });
  await press(ecp.Key.Ok);
  await waitGridLoaded(`${collectionType} grid`);
  await sleep(1200); // let posters paint before capture
}

/**
 * A library grid is "loaded" once its load task has SETTLED — which means one of:
 *  - `#itemGrid` has items (most views), OR
 *  - `#genreList` has items (the GENRES view renders genre folders here, with
 *    `#itemGrid` hidden), OR
 *  - `#emptyText.visible` is true (the load finished with zero items and the
 *    "No Items" empty-state is shown — a real, capture-worthy screen, e.g. the
 *    Networks view on a server whose shows have no network).
 * Accepting the empty-state lets the same nav capture empty views instead of
 * timing out on them.
 */
async function waitGridLoaded(label, timeout = 20000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    const grid = await getVal('#itemGrid.content.getChildCount()');
    const genres = await getVal('#genreList.content.getChildCount()');
    const empty = await getVal('#emptyText.visible');
    last = `grid=${grid} genreList=${genres} empty=${empty}`;
    if (
      (typeof grid === 'number' && grid > 0) ||
      (typeof genres === 'number' && genres > 0) ||
      empty === true
    ) {
      return;
    }
    await sleep(500);
  }
  throw new Error(`nav timed out waiting for ${label} (last ${last})`);
}

/** home -> Movies library grid (hardened against Home-layout changes). */
export async function navLibraryGrid() {
  await navLibraryByType('movies');
}

/** TV / Shows library grid. */
export async function navTvLibrary() {
  await navLibraryByType('tvshows');
}

/** Music library grid (default view). */
export async function navMusicLibrary() {
  await navLibraryByType('music');
}

/** Playlists library grid. */
export async function navPlaylistsLibrary() {
  await navLibraryByType('playlists');
}

/**
 * Open the first tile of the currently-loaded grid and wait for its detail
 * screen. The grid focuses tile 0 on load, so a single OK opens a representative
 * item of that library's type (`#videoTitle` is the shared detail title node for
 * every item type). Used by the per-type detail screens that just need ONE example.
 */
async function openFirstGridTileDetail(label) {
  await press(ecp.Key.Ok);
  await waitFor('#videoTitle.text', (t) => typeof t === 'string' && t.length > 0, {
    label: `${label} detail title`,
    timeout: 20000,
  });
  await sleep(1500); // let backdrop + logo paint
}

/** Shows library -> first tile -> Series detail. */
export async function navSeriesDetails() {
  await navTvLibrary();
  await openFirstGridTileDetail('series');
}

/**
 * Music library -> first tile -> its detail. WHICH detail (MusicAlbum vs
 * MusicArtist) is decided by the seeded landing view: an Albums-view first tile
 * opens a MusicAlbum; an Artists/AlbumArtists-view first tile opens a MusicArtist.
 * Both share this nav; the screen entry's `view` selects the type.
 */
export async function navMusicDetail() {
  await navMusicLibrary();
  await openFirstGridTileDetail('music');
}

/** Playlists library -> first tile -> Playlist detail. */
export async function navPlaylistDetails() {
  await navPlaylistsLibrary();
  await openFirstGridTileDetail('playlist');
}

/**
 * Movies grid -> open the grid OPTIONS dialog (View / Sort / Filter). The `*`
 * button (ECP "Info" -> BrightScript "options") toggles the `#options`
 * ItemGridOptions overlay; we wait on its `visible` field.
 */
export async function navLibraryOptions() {
  await navLibraryGrid();
  await press(ecp.Key.Option); // '*' opens the grid options dialog
  await waitFor('#options.visible', (v) => v === true, {
    label: 'grid options dialog',
    timeout: 8000,
  });
  await sleep(800); // let the dialog's menus paint
}

/**
 * Movie detail -> open the extras panel (Down) -> Cast & Crew row -> OK the first
 * person -> Person detail. The hero movie (RTA_CONFIG.heroMovie) has a rich cast,
 * and the Cast & Crew row is the first extras row, so the first tile is a person.
 * The cast row loads asynchronously, so we wait for `#extrasGrid` content before
 * selecting. Person detail uses the same `#videoTitle` node as every other type.
 */
export async function navPersonDetails(ctx) {
  await navMovieDetails(ctx);
  await press(ecp.Key.Down); // open extras panel; focus lands on the Cast & Crew row
  await waitFor('#extrasGrid.content.getChildCount()', hasChildren, {
    label: 'extras cast/crew row',
    timeout: 20000,
  });
  await sleep(1200); // let the cast tiles paint before selecting
  await press(ecp.Key.Ok); // open the focused person -> Person detail
  // The Person detail loads async behind the scene's global #spinner. `#videoTitle`
  // is NOT a reliable gate: while the new detail loads, the previous (movie)
  // ItemDetails is still in the scene tree, so the recursive `#videoTitle` lookup
  // resolves to the MOVIE's title and a non-empty check passes prematurely. Instead
  // gate on the scene spinner. It can blink twice (the person item, then their
  // filmography), so: wait for it to come ON, then settle OFF and STAY off.
  await waitFor('#spinner.visible', (v) => v === true, {
    label: 'person load started',
    timeout: 8000,
    interval: 150,
  }).catch(() => {}); // tolerate a load fast enough that we miss the ON edge
  await waitSpinnerSettled();
  await sleep(1500); // let backdrop + biography paint
}

/** Wait until the scene spinner has been OFF for a few consecutive polls (stable). */
async function waitSpinnerSettled(timeout = 25000) {
  const start = Date.now();
  let offStreak = 0;
  while (Date.now() - start < timeout) {
    const visible = await getVal('#spinner.visible');
    offStreak = visible === false ? offStreak + 1 : 0;
    if (offStreak >= 3) return; // ~3 polls off in a row => load settled
    await sleep(500);
  }
  throw new Error('nav timed out waiting for scene spinner to settle off');
}

/** grid -> focus the hero tile (Right x heroIndex) -> OK -> ItemDetails. */
export async function navMovieDetails(ctx) {
  await navLibraryGrid();
  const target = ctx?.heroIndex || 0;
  if (target > 0) {
    // Press Right until the grid reports the hero tile focused (robust to a
    // dropped keypress — only presses while focus is still short of the target).
    await waitFor('#itemGrid.itemFocused', (v) => v === target, {
      timeout: 15000,
      interval: 500,
      action: async () => {
        const cur = await getVal('#itemGrid.itemFocused');
        if (typeof cur === 'number' && cur < target) await press(ecp.Key.Right);
      },
      label: `grid focus -> tile ${target}`,
    });
  }
  await press(ecp.Key.Ok);
  await waitFor('#videoTitle.text', (t) => typeof t === 'string' && t.length > 0, {
    label: 'details title',
    timeout: 20000,
  });
  await sleep(1500); // let backdrop + logo paint
}

/** details -> OK on default Play/Resume button -> playback begins. */
export async function startPlayback(ctx) {
  await navMovieDetails(ctx);
  // The title label renders before the button row is interactive; wait until
  // focus actually lands inside the details button group (Play or Resume,
  // depending on watch state) before pressing OK, else the press lands too
  // early and playback never starts.
  await waitFocused((f) => typeof f.keyPath === 'string' && f.keyPath.includes('#buttons'), {
    label: 'details play/resume button',
  });
  await press(ecp.Key.Ok);
}

/**
 * Playback -> paused OSD overlay at the exact target position. OSD only appears
 * once the player reaches a playable state (`stateAllowsOSD`), so we retry Up
 * until it shows, then Play to PAUSE + re-show it (matches the reference's
 * play-button state and freezes the position so it never auto-hides), then seek
 * to the exact target. The store orchestrator injects the in-film backdrop after
 * this returns.
 */
export async function navOsd(ctx) {
  await startPlayback(ctx);
  // Confirm the player reached a playable state (OSD only shows when it has).
  await waitFor('#osd.visible', (v) => v === true, {
    timeout: 90000,
    interval: 2000,
    action: () => press(ecp.Key.Up),
    label: 'osd visible',
  });
  // Hide the OSD (focus -> player), then Play to PAUSE + re-show the OSD.
  await press(ecp.Key.Back);
  await waitFor('#osd.visible', (v) => v === false, { timeout: 8000, label: 'osd hidden' });
  await press(ecp.Key.Play); // pause + show OSD
  await waitFor('#osd.visible', (v) => v === true, {
    timeout: 15000,
    interval: 500,
    label: 'osd visible (paused)',
  });
  // Seek the player (found by its id == the item id) to the exact target while
  // paused, so the OSD shows that exact timestamp with no playback drift.
  if (ctx?.heroId) {
    await odc
      .setValue({ base: 'scene', keyPath: `#${ctx.heroId}.seek`, value: ctx.seekSeconds })
      .catch(() => {});
  }
  await sleep(2500); // let the (paused) seek settle + frame render
}

/**
 * Playback -> trickplay seek strip on the target. The scrubber + position/remaining
 * times are Roku's built-in trickPlayBar (shown during a scrub), NOT the JellyRock
 * OSD — so we HIDE the OSD (Back) so the player, not the OSD, receives Right; seek
 * one trickplay interval (10s) before the target; then Right scrubs forward one
 * thumbnail onto the target, revealing the carousel + trickPlayBar. No in-film
 * backdrop is injected for this shot (it would render OVER Roku's built-in bar),
 * so the video plane reads black — the bar + filmstrip are what the shot shows.
 */
export async function navTrickplay(ctx) {
  await startPlayback(ctx);
  await waitFor('#osd.visible', (v) => v === true, {
    timeout: 90000,
    interval: 2000,
    action: () => press(ecp.Key.Up),
    label: 'playback ready (osd)',
  });
  await press(ecp.Key.Back); // hide OSD so the player (not the OSD) receives Right
  await waitFor('#osd.visible', (v) => v === false, { timeout: 8000, label: 'osd hidden' });
  await odc
    .setValue({ base: 'focusedNode', keyPath: 'seek', value: ctx.seekSeconds - 10 })
    .catch(() => {});
  await sleep(3000); // let the seek settle
  await press(ecp.Key.Right); // scrub +10s -> target; reveals the carousel + trickPlayBar
  await waitFor('#trickplayCarousel.isVisible', (v) => v === true, {
    timeout: 15000,
    interval: 500,
    label: 'trickplay visible',
  });
  await sleep(2000); // let the filmstrip thumbnails load while the trickPlayBar is still up
}
