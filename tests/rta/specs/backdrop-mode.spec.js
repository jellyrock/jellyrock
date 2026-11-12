/**
 * The Backdrop Images setting (`uiShowBackdrop`) in its "Only on item details" mode
 * (`details`): browse screens show no backdrop, an item's details screen does, and Back from
 * the item to the library grid or to search results clears it again. The clear comes from the
 * browse screen writing its own backdrop as it is shown again, which this mode turns into a
 * clear (`backdropUriFor`), so these Back checks also guard that rule. The Movies presentation
 * pane is a backdrop too, so it is hidden in this mode.
 *
 * Back from an item is checked on the grid and on search. Home is not checked directly, because
 * the demo server offers no stable Home row that opens an item, and the grid clears the
 * backdrop before Back could reach Home.
 *
 * The `enabled` runs are the controls: Home shows a backdrop and the library grid shows the
 * pane and the focused movie's backdrop, so the empty reads in `details` mode mean the mode
 * hid them, not that nothing had been written yet.
 *
 * A change made in Settings applies when Back returns to the screen it was opened from, without
 * a visit to Home: the scene keeps the mode it decided, and Settings refreshes it.
 */
import { beforeAll, it, expect } from 'vitest';
import { RTA_CONFIG } from '../config.js';
import { authenticate, getJson, getLibraries, libraryIdFor, tokenHeader } from '../lib/jellyfin.js';
import { seedHome, seedLibraryLanding, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch, odc, ecp } from '../lib/driver.js';
import {
  focusGridTile,
  navLibraryGrid,
  navSearch,
  openSettingsFromGear,
  pickSettingsRadioOption,
  pressGridTile,
  waitSettingsMenuHas,
} from '../lib/nav.js';
import {
  getActiveVal,
  getVal,
  press,
  waitFor,
  waitFocused,
  waitFocusInside,
  waitHome,
  walkFocusUntil,
  walkOverhangRowTo,
} from '../lib/steps.js';

const LOCALE = RTA_CONFIG.languages[0];
// The Movies tab in its presentation layout (MoviePresenter.getBackdropMode returns
// "presentation" only for it).
const PRESENTATION_VIEW = 'presentation';
// The Movies tab in its poster grid, which sends the focused movie's backdrop to the scene
// (MoviePresenter.getBackdropMode returns "fullscreen" for it), so details mode has a browse
// write to turn into a clear.
const POSTER_VIEW = 'comfortable';
const isImage = (u) => typeof u === 'string' && u.length > 0;
const hasTitle = (t) => typeof t === 'string' && t.length > 0;

let session;
let moviesId;
let backdropIndex = -1;

/**
 * The grid index of the first movie (by SortName, as the grid sorts) that has a backdrop, or -1.
 * Runs the query `findMovie` runs; a failed request throws, so -1 only means the server
 * answered and no movie qualifies.
 */
async function firstBackdropMovieIndex(sess, parentId) {
  const url =
    `${sess.serverUrl}/Items?UserId=${sess.userId}&ParentId=${parentId}` +
    `&IncludeItemTypes=Movie&Recursive=true&SortBy=SortName&SortOrder=Ascending`;
  const data = await getJson(url, tokenHeader(sess.token));
  const items = data?.Items || [];
  return items.findIndex(
    (i) => Array.isArray(i.BackdropImageTags) && i.BackdropImageTags.length > 0,
  );
}

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
  moviesId = libraryIdFor(await getLibraries(session), 'movies');
  if (moviesId) backdropIndex = await firstBackdropMovieIndex(session, moviesId);
});

const NO_BACKDROP_MOVIE = 'no movie with a backdrop in the "movies" library';

async function launchHome(mode, label, layout = PRESENTATION_VIEW) {
  const expectedServer = await seedHome(session, LOCALE);
  const landing = await seedLibraryLanding(session, moviesId, 'movies', { layout });
  // rta-run.js restores the whole registry after the run.
  await odc.writeRegistry({ values: { [session.userId]: { uiShowBackdrop: mode } } });
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, label, { landing });
  await waitHome();
}

it('shows a backdrop only on item details in details mode', async (testCtx) => {
  if (!moviesId) testCtx.skip('server has no "movies" library');
  if (backdropIndex < 0) testCtx.skip(NO_BACKDROP_MOVIE);
  const ctx = { libraries: await getLibraries(session) };
  await launchHome('details', 'backdrop details mode', POSTER_VIEW);
  await navLibraryGrid(ctx);

  // The grid's focus write becomes a clear in this mode.
  await focusGridTile(backdropIndex);
  expect(await getVal('#imageFader.uri')).toBe('');

  await press(ecp.Key.Ok);
  await waitFor('#videoTitle.text', hasTitle, { label: 'details title', timeout: 20000 });
  await waitFor('#imageFader.uri', isImage, { label: 'details backdrop shown', timeout: 20000 });

  await press(ecp.Key.Back);
  await waitFocusInside('#itemGrid', { label: 'back on the grid', timeout: 20000 });
  await waitFor('#imageFader.uri', (u) => u === '', {
    label: 'backdrop cleared on Back to the grid',
    timeout: 5000,
  });
});

it("shows the focused movie's backdrop in the poster grid when enabled", async (testCtx) => {
  if (!moviesId) testCtx.skip('server has no "movies" library');
  if (backdropIndex < 0) testCtx.skip(NO_BACKDROP_MOVIE);
  const ctx = { libraries: await getLibraries(session) };
  await launchHome('enabled', 'backdrop enabled, poster grid', POSTER_VIEW);
  await navLibraryGrid(ctx);

  await focusGridTile(backdropIndex);
  await waitFor('#imageFader.uri', isImage, {
    label: 'poster grid backdrop shown',
    timeout: 20000,
  });
});

it('clears the backdrop on Back from an item to search results in details mode', async () => {
  await launchHome('details', 'backdrop details mode, search');
  await navSearch();
  await press(ecp.Key.Ok);
  await waitFor('#videoTitle.text', hasTitle, {
    label: 'details title from search',
    timeout: 20000,
  });
  await waitFor('#imageFader.uri', isImage, { label: 'details backdrop shown', timeout: 20000 });

  await press(ecp.Key.Back);
  await waitFocused((f) => f?.node?.id === 'searchSelect', {
    timeout: 15000,
    interval: 250,
    label: 'back on the search results',
  });
  await waitFor('#imageFader.uri', (u) => u === '', {
    label: 'backdrop cleared on Back to search',
    timeout: 5000,
  });
});

it('shows the presentation pane and the Home backdrop when enabled', async (testCtx) => {
  if (!moviesId) testCtx.skip('server has no "movies" library');
  const ctx = { libraries: await getLibraries(session) };
  await launchHome('enabled', 'backdrop enabled mode');

  await waitFor('#imageFader.uri', isImage, { label: 'Home backdrop shown', timeout: 20000 });

  await navLibraryGrid(ctx);
  expect(await getActiveVal('#presentationBackdrop.visible')).toBe(true);
});

const inOverhangRow = (f) => f?.node?.subtype === 'JROverhangIcon';

/** From the library grid: Up into the overhang row, along it to the gear, and OK. */
async function openSettingsFromGrid() {
  await waitFocused(inOverhangRow, {
    timeout: 15000,
    interval: 350,
    action: walkFocusUntil(ecp.Key.Up, inOverhangRow),
    label: 'the overhang row from the grid',
  });
  await walkOverhangRowTo('settingsIcon', { label: 'the gear from the grid' });
  // A movie library's Movies tab has a page setting (Layout), so its gear opens a menu.
  await openSettingsFromGear({ pageMenu: true });
}

/**
 * Pick a Backdrop Images mode in Settings, then Back out to the grid Settings was opened from:
 * Back lands on the gear, and Down returns to the grid.
 */
async function chooseModeAndReturnToGrid(mode) {
  await pickSettingsRadioOption(['User Interface', 'General'], 'uiShowBackdrop', mode);
  await press(ecp.Key.Back);
  await waitFocusInside('#settingsMenu', { label: 'the menu after the pick' });
  await press(ecp.Key.Back);
  await waitSettingsMenuHas('Libraries', 'back in the User Interface group');
  await press(ecp.Key.Back);
  await waitSettingsMenuHas('User Interface', 'back at the top menu');
  await waitFocusInside('#settingsMenu', { label: 'the top menu' });
  await press(ecp.Key.Back);
  await waitFocused((f) => f?.node?.id === 'settingsIcon', {
    timeout: 15000,
    interval: 250,
    label: 'the gear again, back on the grid',
  });
  await press(ecp.Key.Down);
  await waitFocusInside('#itemGrid', { label: 'the grid after Settings' });
}

it('applies a mode chosen in Settings over the library grid, with no visit to Home', async (testCtx) => {
  if (!moviesId) testCtx.skip('server has no "movies" library');
  if (backdropIndex < 0) testCtx.skip(NO_BACKDROP_MOVIE);
  const ctx = { libraries: await getLibraries(session) };
  await launchHome('disabled', 'backdrop mode chosen over the grid');
  await navLibraryGrid(ctx);

  await openSettingsFromGrid();
  await chooseModeAndReturnToGrid('details');
  expect(await getActiveVal('#presentationBackdrop.visible'), 'the pane stays hidden').toBe(false);

  // The scene decided "disabled" on Home's first write; the item's backdrop shows only if
  // Settings made it read the setting again.
  await pressGridTile(backdropIndex);
  await waitFor('#videoTitle.text', hasTitle, { label: 'details title', timeout: 20000 });
  await waitFor('#imageFader.uri', isImage, {
    label: 'details backdrop shown after the change',
    timeout: 20000,
  });
});

it('hides the pane when details mode is chosen over the grid, and Back from an item clears', async (testCtx) => {
  if (!moviesId) testCtx.skip('server has no "movies" library');
  if (backdropIndex < 0) testCtx.skip(NO_BACKDROP_MOVIE);
  const ctx = { libraries: await getLibraries(session) };
  await launchHome('enabled', 'backdrop details chosen over the grid');
  await navLibraryGrid(ctx);
  expect(await getActiveVal('#presentationBackdrop.visible'), 'the pane shows at first').toBe(true);

  await openSettingsFromGrid();
  await chooseModeAndReturnToGrid('details');
  expect(await getActiveVal('#presentationBackdrop.visible'), 'the pane hidden on return').toBe(
    false,
  );
  expect(await getActiveVal('#presentationBackdrop.uri'), 'the hidden pane holds no image').toBe(
    '',
  );

  await pressGridTile(backdropIndex);
  await waitFor('#videoTitle.text', hasTitle, { label: 'details title', timeout: 20000 });
  await waitFor('#imageFader.uri', isImage, { label: 'details backdrop shown', timeout: 20000 });

  // The grid writes its own backdrop as it is shown again, which details mode turns into a clear.
  await press(ecp.Key.Back);
  await waitFocusInside('#itemGrid', { label: 'back on the grid', timeout: 20000 });
  await waitFor('#imageFader.uri', (u) => u === '', {
    label: 'backdrop cleared on Back to the grid',
    timeout: 5000,
  });
});
