/**
 * The Backdrop Images setting (`uiShowBackdrop`) in its "Only on item details" mode
 * (`details`): browse screens show no backdrop, an item's details screen does, and Back from
 * the item to Home or to search results clears it again. The clear comes from the browse
 * screen writing its own backdrop as it is shown again, which this mode turns into a clear
 * (`backdropUriFor`), so these Back checks also guard that rule. The Movies presentation pane
 * is a backdrop too, so it is hidden in this mode.
 *
 * The `enabled` run is the control: the same walk shows the pane and a Home backdrop, so an
 * empty read in `details` mode means the mode hid it, not that nothing had been written yet.
 */
import { beforeAll, it, expect } from 'vitest';
import { RTA_CONFIG } from '../config.js';
import { authenticate, getLibraries, libraryIdFor } from '../lib/jellyfin.js';
import { seedHome, seedLibraryLanding, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch, odc, ecp } from '../lib/driver.js';
import { focusHomeRow, navLibraryGrid, navSearch } from '../lib/nav.js';
import {
  getActiveVal,
  getVal,
  press,
  waitFor,
  waitFocusInHomeContent,
  waitFocused,
  waitHome,
  waitHomeRows,
} from '../lib/steps.js';

const LOCALE = RTA_CONFIG.languages[0];
// The Movies library's presentation view (MoviePresenter.getBackdropMode returns
// "presentation" only for it).
const PRESENTATION_VIEW = 'Movies';
const isImage = (u) => typeof u === 'string' && u.length > 0;
const hasTitle = (t) => typeof t === 'string' && t.length > 0;

let session;
let moviesId;

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
  moviesId = libraryIdFor(await getLibraries(session), 'movies');
});

async function launchHome(mode, label) {
  const expectedServer = await seedHome(session, LOCALE);
  const landing = await seedLibraryLanding(session, moviesId, PRESENTATION_VIEW);
  // rta-run.js restores the whole registry after the run.
  await odc.writeRegistry({ values: { [session.userId]: { uiShowBackdrop: mode } } });
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, label, { landing });
  await waitHome();
}

/** A Latest row that has loaded real items: its tiles open an item's details screen. */
const latestWithItems = (r) =>
  r.sectionId?.startsWith('latest_') && r.items > 0 && r.firstType !== 'Loading' && !r.loadFailed;

it('shows a backdrop only on item details in details mode', async (testCtx) => {
  if (!moviesId) testCtx.skip('server has no "movies" library');
  const ctx = { libraries: await getLibraries(session) };
  await launchHome('details', 'backdrop details mode');

  // Wait for every section to answer before choosing the row, so rows above it can no longer
  // be removed and the index stays right (the same reason as home-failure.spec.js).
  const snap = await waitHomeRows(
    (s) =>
      s.rows.every((r) => r.firstType !== 'Loading' || r.loadFailed) &&
      s.rows.some(latestWithItems),
    { label: 'Home settled with a Latest row' },
  );
  const row = snap.rows.findIndex(latestWithItems);
  expect(row).toBeGreaterThan(-1);
  await focusHomeRow(row, snap.rows[row].sectionId);
  expect(await getVal('#imageFader.uri')).toBe('');

  await press(ecp.Key.Ok);
  await waitFor('#videoTitle.text', hasTitle, { label: 'details title', timeout: 20000 });
  await waitFor('#imageFader.uri', isImage, { label: 'details backdrop shown', timeout: 20000 });

  await press(ecp.Key.Back);
  await waitFocusInHomeContent({ label: 'back on Home', timeout: 20000 });
  await waitFor('#imageFader.uri', (u) => u === '', {
    label: 'backdrop cleared on Back to Home',
    timeout: 5000,
  });

  await navLibraryGrid(ctx);
  expect(await getActiveVal('#presentationBackdrop.visible')).toBe(false);
  expect(await getVal('#imageFader.uri')).toBe('');
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
