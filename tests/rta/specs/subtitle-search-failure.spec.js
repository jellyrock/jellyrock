/**
 * A subtitle search that failed never reads as one that found nothing, driven through the
 * request-failure switch (`rtaFailRequests`):
 *
 *  - an HTTP error or a timeout says the search failed and names the Search button;
 *  - a search the server answered empty says no subtitles were found;
 *  - Search after a failure runs the search again.
 *
 * FIXTURE-GATED, like the `subtitlePanel` screen: Manage Subtitles is offered only to a user
 * who may search subtitles, on a server with a subtitle provider (`manageSubtitlesOffered`).
 * The public demo is neither, so every case skips there. Run it against a local server with
 * the Open Subtitles plugin installed, with or without credentials: the plugin is needed only
 * to open the panel, and every search answer here comes from a rule, not from the provider.
 *
 *   RTA_SERVER_URL=http://<host>:<port> RTA_SERVER_USER=… RTA_SERVER_PASS=… \
 *     npm run test:rta -- tests/rta/specs/subtitle-search-failure.spec.js
 *
 * The panel searches as soon as it opens (`SubtitlePanel.maybeAutoSearch`), so each case sets
 * its rule before opening it. The search ids start with `subtitleSearch`
 * (`SubtitlePanel.runSearch`).
 */
import { beforeAll, it, expect } from 'vitest';
import { ecp } from 'roku-test-automation';
import { RTA_CONFIG } from '../config.js';
import { authenticate, getLibraries, manageSubtitlesOffered } from '../lib/jellyfin.js';
import { seedHome, assertSeedTookEffect } from '../lib/seed.js';
import { hardRelaunch } from '../lib/driver.js';
import { navSubtitlePanel } from '../lib/nav.js';
import { failRequests } from '../lib/failRequests.js';
import { getActiveVal, press, waitFocused, waitFor } from '../lib/steps.js';
import { captureRawUI } from '../capture.js';

const LOCALE = RTA_CONFIG.languages[0];
const SEARCH_FAILED = "Couldn't search for subtitles. Press Search to try again.";
const SEARCH_EMPTY =
  'No subtitles found. If this keeps happening, ask your server admin to set up a subtitle provider such as Open Subtitles.';
const SKIP_REASON = 'user cannot manage subtitles, or the server has no subtitle provider plugin';
// RTA_CAPTURE=1 also saves each state to out/rta-captures/ for review.
const CAPTURE = process.env.RTA_CAPTURE === '1';

let session;
let ctx;
let offered;

beforeAll(async () => {
  session = await authenticate(RTA_CONFIG.server);
  offered = await manageSubtitlesOffered(session);
  // Any movie will do: the search is failed on purpose or answered empty by the server, so
  // the first tile of the movies grid is enough.
  ctx = { heroIndex: 0, libraries: await getLibraries(session) };
});

/** Relaunches, applies `rules`, then opens the panel, whose auto-search the rules meet. */
async function openPanelWith(rules) {
  const expectedServer = await seedHome(session, LOCALE);
  await hardRelaunch();
  await assertSeedTookEffect(expectedServer, 'subtitle-search-failure');
  await failRequests(rules);
  await navSubtitlePanel(ctx);
}

/** Waits for the status line under the search controls to read `text`. */
async function waitStatus(text, label) {
  await waitFor('#statusLabel.text', (v) => v === text, {
    read: getActiveVal,
    timeout: 20000,
    interval: 250,
    label,
  });
  expect(await getActiveVal('#statusLabel.visible'), 'the status line shows').toBe(true);
  expect(await getActiveVal('#resultsList.visible'), 'no result rows').toBe(false);
}

it('a search that got an HTTP error says it failed, not that nothing was found', async (t) => {
  if (!offered) t.skip(SKIP_REASON);
  await openPanelWith([{ prefix: 'subtitleSearch', kind: 'http', status: 500 }]);
  await waitStatus(SEARCH_FAILED, 'the failed search message');
  if (CAPTURE) await captureRawUI('subtitleSearchFailed');
});

it('a search that timed out says it failed', async (t) => {
  if (!offered) t.skip(SKIP_REASON);
  await openPanelWith([{ prefix: 'subtitleSearch', kind: 'timeout' }]);
  await waitStatus(SEARCH_FAILED, 'the failed search message');
});

it('a search the server answered empty says no subtitles were found', async (t) => {
  if (!offered) t.skip(SKIP_REASON);
  await openPanelWith([{ prefix: 'subtitleSearch', kind: 'empty' }]);
  await waitStatus(SEARCH_EMPTY, 'the no-subtitles message');
  if (CAPTURE) await captureRawUI('subtitleSearchEmpty');
});

it('Search after a failed search runs it again', async (t) => {
  if (!offered) t.skip(SKIP_REASON);
  // The first rule fails the opening search once and is then spent, so the second answers
  // the retry: rules apply in order (apiFaults.take), whatever the provider would return.
  await openPanelWith([
    { prefix: 'subtitleSearch', kind: 'http', status: 500, times: 1 },
    { prefix: 'subtitleSearch', kind: 'empty' },
  ]);
  await waitStatus(SEARCH_FAILED, 'the failed search message');

  const atSearch = (f) => f?.node?.id === 'searchButton';
  await waitFocused(atSearch, { timeout: 5000, label: 'the Search button holds focus' });
  await press(ecp.Key.Ok);
  await waitStatus(SEARCH_EMPTY, 'the answer of the search run again');
});
