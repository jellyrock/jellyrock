/**
 * WHICH sample of a launch a number is about. See `scripts/measure-selection.js`.
 *
 * This is the layer every defect in the measurement subsystem has been found in, and
 * until this file existed every one of them was found by hand on a Roku. The rule lived
 * inline in `measure.js`, which claims the device on import and so cannot be imported by
 * a test — the same reason `measure-args.js` was carved out, with more force here,
 * because arg parsing never had a defect and this has had four.
 *
 * The cases below are the four real ones, not invented shapes: a chained nav, a playback
 * nav, a legacy family that stamps nothing, and a warm refresh beside a cold paint.
 */
import { describe, expect, it } from 'vitest';

import {
  analyseMounts,
  launchAudit,
  mountIdOf,
  otherMountsIn,
  selectColdSamples,
  selectionRefusalFor,
  selectsMount,
} from '../../../scripts/measure-selection.js';

/** One assembled sample, in the shape `measure.js` writes. */
const s = (launch, indexInLaunch, component, variant, over = {}) => ({
  launch,
  indexInLaunch,
  complete: true,
  dimensions: component || variant ? { component, variant } : undefined,
  timings: { paintMs: 100 },
  ...over,
});

/** A PLAYBACK nav: reaching the player walks through the details screen, both `Movie`. */
const playbackLaunch = (launch) => [
  s(launch, 0, 'itemDetails', 'Movie'),
  s(launch, 1, 'videoPlayer', 'Movie'),
];

/** A CHAINED nav: reaching a Season loads its Series first — one component, two variants. */
const chainedLaunch = (launch) => [
  s(launch, 0, 'itemDetails', 'Series'),
  s(launch, 1, 'itemDetails', 'Season'),
];

describe('mount identity', () => {
  it('is component AND variant, because either alone is blind to one real shape', () => {
    expect(mountIdOf({ component: 'videoPlayer', variant: 'Movie' })).toBe('videoPlayer/Movie');
    // A grid stamps no variant; the component alone is still an identity.
    expect(mountIdOf({ component: 'settings' })).toBe('settings');
    expect(mountIdOf(undefined)).toBe('');
  });

  it('matches vacuously when nothing is named, so one predicate serves every caller', () => {
    const dims = { component: 'videoPlayer', variant: 'Movie' };
    expect(selectsMount(dims, {})).toBe(true);
    expect(selectsMount(dims, { component: 'videoPlayer' })).toBe(true);
    expect(selectsMount(dims, { component: 'itemDetails' })).toBe(false);
    expect(selectsMount(dims, { component: 'videoPlayer', variant: 'Series' })).toBe(false);
  });
});

describe('detecting a launch that mounted more than one screen', () => {
  it('sees a PLAYBACK nav, where both mounts share a variant', () => {
    // The case that shipped broken: keyed on variant alone this reads as single-mount,
    // and the tool then publishes the details screen under the player's name.
    const analysis = analyseMounts(playbackLaunch(0), {});
    expect(analysis.multiMount).toBe(true);
    expect(analysis.observedVariants).toEqual(['Movie']);
    expect(analysis.observedComponents).toEqual(['itemDetails', 'videoPlayer']);
    expect(analysis.observedIds).toEqual(['itemDetails/Movie', 'videoPlayer/Movie']);
  });

  it('sees a CHAINED nav, where both mounts share a component', () => {
    const analysis = analyseMounts(chainedLaunch(0), {});
    expect(analysis.multiMount).toBe(true);
    expect(analysis.observedComponents).toEqual(['itemDetails']);
    expect(analysis.observedVariants).toEqual(['Series', 'Season']);
  });

  it('does not call a single-mount series ambiguous', () => {
    expect(analyseMounts([s(0, 0, 'settings')], {}).multiMount).toBe(false);
  });

  it('asks the SAMPLES whether the flags narrow it, not whether flags were passed', () => {
    // `--variant Movie` IS passed and the launch is STILL ambiguous, because both mounts
    // of a playback nav stamp `Movie`. Asking the flags would call this resolved.
    expect(analyseMounts(playbackLaunch(0), { variant: 'Movie' }).stillAmbiguous).toBe(true);
    expect(analyseMounts(playbackLaunch(0), { component: 'videoPlayer' }).stillAmbiguous).toBe(
      false,
    );
  });
});

describe('refusing to publish a median', () => {
  it('refuses a playback nav with nothing named, and says what to pass', () => {
    const refusal = selectionRefusalFor(playbackLaunch(0), {});
    expect(refusal).toMatch(/mounted more than one screen/);
    expect(refusal).toMatch(/itemDetails\/Movie, videoPlayer\/Movie/);
    expect(refusal).toMatch(/--component/);
  });

  it('refuses a flag that matched nothing, ahead of any ambiguity', () => {
    // Order matters: reported as "matched nothing" rather than as ambiguity, or the
    // message would tell the operator to pass a flag they have just passed.
    expect(selectionRefusalFor(playbackLaunch(0), { component: 'searchResults' })).toMatch(
      /--component searchResults matched no sample.*itemDetails, videoPlayer/s,
    );
    expect(selectionRefusalFor(playbackLaunch(0), { variant: 'Series' })).toMatch(
      /--variant Series matched no sample/,
    );
  });

  it('does NOT send the operator in a circle when they already named half of it', () => {
    // `--variant Movie` is passed and still matches BOTH mounts of a playback nav. Telling
    // them to "re-run naming a mount" is advice they have taken; the useful thing to say
    // is which half is missing.
    const refusal = selectionRefusalFor(playbackLaunch(0), { variant: 'Movie' });
    expect(refusal).toMatch(/still matches more than one mount/);
    expect(refusal).toMatch(/Add --component/);
    expect(refusal).not.toMatch(/nothing was named/);
  });

  it('does NOT refuse one identity mounted twice — the second is a later run, not a rival', () => {
    // Queue advancement remounts the player inside one launch. Refusing here would ask
    // for a flag that cannot exist: nothing separates a thing from itself. The first is
    // the cold one, by the same rule that keeps a warm refresh out of a cold median.
    const twice = [s(0, 0, 'videoPlayer', 'Movie'), s(0, 1, 'videoPlayer', 'Movie')];
    expect(selectionRefusalFor(twice, { component: 'videoPlayer' })).toBeNull();
    expect(selectColdSamples(twice, { component: 'videoPlayer' })).toHaveLength(1);
  });

  it('publishes when the named mount is unambiguous', () => {
    expect(selectionRefusalFor(playbackLaunch(0), { component: 'videoPlayer' })).toBeNull();
    expect(selectionRefusalFor([s(0, 0, 'settings')], {})).toBeNull();
  });

  it('refuses a series whose LAUNCHES measured different variants, one mount each', () => {
    // The case no per-launch check can see: every launch mounted exactly one screen, so
    // nothing was ambiguous at the time — but which variant you got was decided by the
    // ENVIRONMENT. `setServer` stamps `discovered` when SSDP answered that launch and
    // `savedOnly` when it did not, so an intermittent LAN yields two populations.
    const mixed = [
      s(0, 0, 'setServer', 'savedOnly'),
      s(1, 0, 'setServer', 'discovered'),
      s(2, 0, 'setServer', 'savedOnly'),
    ];
    const refusal = selectionRefusalFor(mixed, { component: 'setServer' });
    expect(refusal).toMatch(/did not all measure the same variant/);
    expect(refusal).toMatch(/savedOnly ×2, discovered ×1/);
    expect(refusal).toMatch(/--variant/);
  });

  it('publishes once one of those variants is NAMED', () => {
    const mixed = [s(0, 0, 'setServer', 'savedOnly'), s(1, 0, 'setServer', 'discovered')];
    expect(selectionRefusalFor(mixed, { component: 'setServer', variant: 'savedOnly' })).toBeNull();
  });

  it('does NOT fire on the two mounts of one no-server launch, which is every correct run', () => {
    // The false positive that would have made this refusal worthless. A launch with no
    // server mounts `preLogin/start` AND `setServer/savedOnly`, so counting variants over
    // ALL samples refuses the very series the check was written for. It counts the
    // SELECTED ones.
    const noServerLaunch = (launch) => [
      s(launch, 0, 'preLogin', 'start'),
      s(launch, 1, 'setServer', 'savedOnly'),
    ];
    const clean = [...noServerLaunch(0), ...noServerLaunch(1)];
    expect(selectionRefusalFor(clean, { component: 'setServer' })).toBeNull();
  });

  it('reports a per-launch ambiguity as THAT, not as a mixed series', () => {
    // A chained nav mounts two variants inside ONE launch. Both messages would be true;
    // only the ambiguity one tells the operator something they can act on first, and its
    // advice (`--variant`) resolves this too.
    const refusal = selectionRefusalFor([...chainedLaunch(0), ...chainedLaunch(1)], {});
    expect(refusal).toMatch(/mounted more than one screen/);
    expect(refusal).not.toMatch(/did not all measure the same variant/);
  });

  it('ignores a family that stamps no variant at all', () => {
    // `home-latest-rows` and `item-grid` emit purely numeric lines by design. An
    // unstamped series is one population by definition, not a mixed one.
    const unstamped = [s(0, 0), s(1, 0), s(2, 0)];
    expect(selectionRefusalFor(unstamped, {})).toBeNull();
    // Same for a component that stamps no variant.
    expect(selectionRefusalFor([s(0, 0, 'settings'), s(1, 0, 'settings')], {})).toBeNull();
  });
});

describe('selecting the cold sample of each launch', () => {
  it('takes the NAMED mount, not the first one — the 8x defect', () => {
    const samples = [...playbackLaunch(0), ...playbackLaunch(1)];
    samples[1].timings.paintMs = 2811;
    samples[3].timings.paintMs = 3471;

    const picked = selectColdSamples(samples, { component: 'videoPlayer' });
    expect(picked.map((p) => p.timings.paintMs)).toEqual([2811, 3471]);
    expect(picked.every((p) => p.dimensions.component === 'videoPlayer')).toBe(true);
  });

  it('falls back to first-mount when nothing is named', () => {
    const picked = selectColdSamples([...playbackLaunch(0), ...playbackLaunch(1)], {});
    expect(picked.map((p) => p.dimensions.component)).toEqual(['itemDetails', 'itemDetails']);
  });

  it('falls back to first-mount when the SAMPLES stamped nothing, whatever the record says', () => {
    // The two legacy families emit no dimensions, and older records predate stamping —
    // while the record may still carry a `screenVariant`. Matching a named mount against
    // unstamped samples would select none and read as "this series is empty", quietly
    // losing every historical series the moment compare started honouring the field.
    const legacy = [s(0, 0, null, null), s(1, 0, null, null)];
    expect(selectColdSamples(legacy, { variant: 'Movie' })).toHaveLength(2);
  });

  it('never pools a warm refresh with the cold paint beside it', () => {
    const warm = s(0, 1, 'itemDetails', 'Movie', { timings: { paintMs: 40 } });
    expect(selectColdSamples([s(0, 0, 'itemDetails', 'Movie'), warm], {})).toHaveLength(1);
  });

  it('skips an incomplete sample and takes the complete one behind it', () => {
    // The progress line used to take the first MATCH and only then ask whether it was
    // complete, so it printed "no complete sample" while the summary counted this launch.
    const samples = [
      s(0, 0, 'videoPlayer', 'Movie', { complete: false }),
      s(0, 1, 'videoPlayer', 'Movie', { timings: { paintMs: 2155 } }),
    ];
    expect(selectColdSamples(samples, { component: 'videoPlayer' })[0].timings.paintMs).toBe(2155);
  });
});

describe('naming the mounts a launch produced but did not publish', () => {
  it('names the mount that came BEFORE the selected one, rather than calling it later', () => {
    // The search screen opens (`open`) and then runs a query (`query`), so `--variant query`
    // selects the SECOND sample. The other one precedes it, and the line used to call every
    // unselected sample a "later run" — reporting a screen-open as a re-render that followed
    // the search.
    const launch = [s(0, 0, 'searchResults', 'open'), s(0, 1, 'searchResults', 'query')];
    const cold = selectColdSamples(launch, { variant: 'query' })[0];

    expect(cold).toBe(launch[1]);
    expect(otherMountsIn(launch, cold)).toEqual(['searchResults/open']);
  });

  it('names nothing when the launch mounted one screen', () => {
    const launch = [s(0, 0, 'settings', '')];
    expect(otherMountsIn(launch, selectColdSamples(launch)[0])).toEqual([]);
  });

  it('names every mount when none was selected', () => {
    // A launch whose named mount never painted still has samples worth naming: they are what
    // the app DID emit, and printing them is how the operator sees they asked for the wrong
    // one rather than reading "no complete sample" and suspecting the build.
    const launch = playbackLaunch(0);
    expect(otherMountsIn(launch, undefined)).toEqual(['itemDetails/Movie', 'videoPlayer/Movie']);
  });

  it('falls back to the sample index when the family stamps no identity', () => {
    // `home-latest-rows` and `item-grid` emit purely numeric lines by design, so there is no
    // mount id to print and the position is all there is to say.
    const launch = [s(0, 0), s(0, 1)];
    expect(otherMountsIn(launch, launch[0])).toEqual(['#1']);
  });
});

describe('auditing which launches came back empty', () => {
  it('separates "emitted nothing" from "emitted, but not the mount you named"', () => {
    // Launch 0 is healthy; launch 1 reached the details screen but the player never
    // painted; launch 2 emitted nothing at all. One count cannot carry all three states,
    // and collapsing them hides a screen that failed behind a healthy sample total.
    const samples = [
      ...playbackLaunch(0),
      s(1, 0, 'itemDetails', 'Movie'),
      s(2, 0, 'itemDetails', 'Movie', { complete: false }),
    ];
    const audit = launchAudit(samples, { component: 'videoPlayer' }, 3);
    expect(audit.withoutAnySample).toBe(1);
    expect(audit.withoutNamedMount).toBe(1);
    expect(audit.completeSamples).toHaveLength(3);
  });

  it('counts nothing missing on a clean series', () => {
    const audit = launchAudit([...playbackLaunch(0), ...playbackLaunch(1)], {}, 2);
    expect(audit.withoutAnySample).toBe(0);
    expect(audit.withoutNamedMount).toBe(0);
  });
});
