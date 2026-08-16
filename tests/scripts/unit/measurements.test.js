/**
 * The measurement registry — see `scripts/measurements.js`.
 *
 * Every pattern here is asserted against a line captured VERBATIM off `.177`
 * (2026-08-12), not against the idealized form in
 * `docs/dev/home-first-paint-performance.md`. That distinction is the reason
 * these tests exist: the doc shows only the message, while the device prefixes
 * every line with roku-log's level + source path and pads the tail, so a pattern
 * written from the doc matches nothing at all. A test using a hand-typed line
 * would have agreed with the bug.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  MEASUREMENTS,
  assembleSamples,
  matchLine,
  measurementById,
  measurementIds,
  parseBuildFlags,
  parseLogLine,
  splitWorkload,
} from '../../../scripts/measurements.js';

/**
 * Captured off `.177` on 2026-08-12 — two complete Home runs seen in one console
 * window. Trailing whitespace is REAL and preserved: `m.log.*` joins its nine
 * possible arguments with spaces whether or not they were supplied.
 *
 * ⚠️ These two runs were NOT both live. A later timestamped probe showed the
 * first was REPLAYED out of the device's console buffer 10 ms after connect, and
 * that one launch produces exactly one run. The fixture is kept because the lines
 * themselves are verbatim device output and the multi-run assembly they exercise
 * is still needed (a `refresh()` on returning to Home is a genuine second run) —
 * but nothing here may be read as evidence about how many runs a launch emits.
 */
const CAPTURED = [
  'INFO file:///home/charlie/PROJECTS/JellyRock/jellyrock/components/home/HomeRows.bs:459 latest-rows run complete 10 rows 1500 ms    ',
  'INFO file:///home/charlie/PROJECTS/JellyRock/jellyrock/components/home/HomeRows.bs:463 latest-rows populate split attach 209 detach 17 other 140  ',
  'INFO file:///home/charlie/PROJECTS/JellyRock/jellyrock/components/home/LoadLatestRowsTask.bs:139 latest-rows orchestrator done - [debug=false perfTiming=true] task 1375 wait 776 emit 587  ',
  'INFO file:///home/charlie/PROJECTS/JellyRock/jellyrock/components/home/LoadLatestRowsTask.bs:145 latest-rows emit split - [debug=false perfTiming=true] xform 164 append 28 notify 385  ',
  'INFO file:///home/charlie/PROJECTS/JellyRock/jellyrock/components/home/HomeRows.bs:459 latest-rows run complete 10 rows 2654 ms    ',
  'INFO file:///home/charlie/PROJECTS/JellyRock/jellyrock/components/home/HomeRows.bs:463 latest-rows populate split attach 288 detach 24 other 114  ',
  'INFO file:///home/charlie/PROJECTS/JellyRock/jellyrock/components/home/LoadLatestRowsTask.bs:139 latest-rows orchestrator done - [debug=false perfTiming=true] task 2546 wait 1852 emit 685  ',
  'INFO file:///home/charlie/PROJECTS/JellyRock/jellyrock/components/home/LoadLatestRowsTask.bs:145 latest-rows emit split - [debug=false perfTiming=true] xform 186 append 31 notify 456  ',
];

/** Console traffic that is NOT a measurement, also captured off the device. */
const NOISE = [
  '[http] Response Code             200',
  '[http] ------ END HTTP REQUEST ------',
  'INFO file:///home/charlie/PROJECTS/JellyRock/jellyrock/components/data/SceneManager.bs:39 SceneManager.setBackgroundImage called  true false     ',
];

const home = measurementById('home-latest-rows');

describe('parseLogLine', () => {
  it("strips roku-log's level and source prefix off a real device line", () => {
    const parsed = parseLogLine(CAPTURED[0]);
    expect(parsed.level).toBe('INFO');
    expect(parsed.source).toBe('HomeRows.bs');
    expect(parsed.sourceLine).toBe(459);
    expect(parsed.message).toBe('latest-rows run complete 10 rows 1500 ms');
  });

  it("keeps only the basename, never the builder's absolute path", () => {
    // The absolute path is provenance about the machine that built the app, and it
    // carries a developer's home directory into every record we write to disk.
    expect(parseLogLine(CAPTURED[0]).source).not.toContain('/');
  });

  it('parses a bare message, so a build without the file transport still matches', () => {
    expect(parseLogLine('latest-rows run complete 11 rows 2728 ms').message).toBe(
      'latest-rows run complete 11 rows 2728 ms',
    );
  });

  it('returns null for a non-line rather than throwing', () => {
    expect(parseLogLine('')).toBeNull();
    expect(parseLogLine(undefined)).toBeNull();
  });
});

describe('the Home pattern against captured device lines', () => {
  it('reads rows and total off `run complete`, where the value PRECEDES its label', () => {
    const hit = matchLine(home, CAPTURED[0]);
    expect(hit.key).toBe('total');
    expect(hit.fields).toEqual({ rows: 10, totalMs: 1500 });
  });

  it('reads the orchestrator split, where the value FOLLOWS its label', () => {
    // The two shapes in one family are why this cannot be a generic key/value
    // extractor — the reason the registry declares a pattern per line.
    expect(matchLine(home, CAPTURED[2]).fields).toEqual({
      taskMs: 1375,
      waitMs: 776,
      emitMs: 587,
    });
  });

  it('reads both optional splits', () => {
    expect(matchLine(home, CAPTURED[1]).fields).toEqual({
      attachMs: 209,
      detachMs: 17,
      otherMs: 140,
    });
    expect(matchLine(home, CAPTURED[3]).fields).toEqual({
      xformMs: 164,
      appendMs: 28,
      notifyMs: 385,
    });
  });

  it('ignores console traffic that is not a measurement', () => {
    for (const line of NOISE) expect(matchLine(home, line)).toBeNull();
  });

  it("would NOT match the doc's idealized form if the prefix were mandatory", () => {
    // Guards the actual bug: a pattern anchored at the start of the raw line.
    expect(/^latest-rows run complete/.test(CAPTURED[0])).toBe(false);
    expect(matchLine(home, CAPTURED[0])).not.toBeNull();
  });
});

describe('build flags', () => {
  it("parses the app's own bracket into booleans", () => {
    expect(parseBuildFlags(parseLogLine(CAPTURED[2]).message)).toEqual({
      debug: false,
      perfTiming: true,
    });
  });

  it('is absent on the lines that carry no bracket', () => {
    expect(parseBuildFlags(parseLogLine(CAPTURED[0]).message)).toBeUndefined();
  });

  it('does not invent ENABLE_RTA, which the app never stamps', () => {
    // The third flag that can move a measurement is NOT in the bracket, so a line
    // lifted out of a scrollback cannot self-report it. If this ever starts
    // passing, `measure.js` should stop recording it from the deploy side.
    const flags = parseBuildFlags(parseLogLine(CAPTURED[2]).message);
    expect(flags).not.toHaveProperty('ENABLE_RTA');
  });
});

describe('assembleSamples', () => {
  it('splits a console window into the separate runs it contained', () => {
    // Why the splitting matters: one of these two was replayed out of the device's
    // buffer (see the fixture note). Collapsing a window to "the" number is how a
    // stale 7241 ms line gets averaged into a cold-paint series — measured on
    // `.177`, against a live range of 1439–2654 ms.
    const samples = assembleSamples(home, CAPTURED);
    expect(samples).toHaveLength(2);
    expect(samples.map((s) => s.fields.totalMs)).toEqual([1500, 2654]);
    expect(samples.every((s) => s.complete)).toBe(true);
  });

  it('merges every line of one run into a single sample', () => {
    const [first] = assembleSamples(home, CAPTURED);
    expect(first.fields).toEqual({
      rows: 10,
      totalMs: 1500,
      attachMs: 209,
      detachMs: 17,
      otherMs: 140,
      taskMs: 1375,
      waitMs: 776,
      emitMs: 587,
      xformMs: 164,
      appendMs: 28,
      notifyMs: 385,
    });
    expect(first.buildFlags).toEqual({ debug: false, perfTiming: true });
  });

  it('starts a new sample when a line REPEATS, not on a fixed line order', () => {
    // The four lines come from two different threads and can interleave, so order
    // cannot delimit a run. A repeat is unambiguous; this asserts the rule holds
    // when the optional lines arrive in the other order.
    const reordered = [CAPTURED[2], CAPTURED[0], CAPTURED[3], CAPTURED[1], CAPTURED[2]];
    const samples = assembleSamples(home, reordered);
    expect(samples).toHaveLength(2);
    expect(samples[0].fields.totalMs).toBe(1500);
  });

  it('reports an incomplete sample rather than dropping or merging it forward', () => {
    // Dropping would make a device that died mid-run look like a device that ran
    // fewer times; merging would fabricate one run out of halves of two.
    const truncated = [CAPTURED[0], CAPTURED[1]]; // no `orchestrator done`
    const [only] = assembleSamples(home, truncated);
    expect(only.complete).toBe(false);
    expect(only.fields.totalMs).toBe(1500);
  });

  it('ignores interleaved noise without breaking a sample apart', () => {
    const withNoise = [CAPTURED[0], NOISE[0], CAPTURED[2], NOISE[1]];
    const samples = assembleSamples(home, withNoise);
    expect(samples).toHaveLength(1);
    expect(samples[0].complete).toBe(true);
  });

  it('returns nothing for a console that emitted no measurement', () => {
    expect(assembleSamples(home, NOISE)).toEqual([]);
    expect(assembleSamples(home, [])).toEqual([]);
  });
});

/**
 * One `screen-load` sample as `source/utils/screenReadiness.bs` builds it, with
 * roku-log's real prefix and trailing padding.
 *
 * ⚠️ Written from the emitting source, NOT captured off a device. A test written from
 * the emitter proves the pattern matches what THIS repo emits; only a device can prove
 * the device emits it. That is exactly the distinction the header above draws, and the
 * reason the Home fixture is verbatim capture instead.
 *
 * The family's `grounded` flag used to say the same thing and no longer does — it was
 * flipped to `true` on 2026-08-16 once the ledger held 32 series with complete samples.
 * So this fixture is now the WEAKER of the two claims about the same pattern, and it is
 * still the right shape for a unit test: it fails when the emitter and the parser drift
 * apart, which a device capture pinned in a file cannot.
 */
const SCREEN_LOAD_LINES = [
  'INFO file:///x/source/utils/screenReadiness.bs:118 screen-load paint - component itemDetails variant Movie ms 812 [debug=false perfTiming=true]  ',
  'INFO file:///x/source/utils/screenReadiness.bs:212 screen-load settled - component itemDetails variant Movie ms 3104 fills 3 [debug=false perfTiming=true]  ',
  'INFO file:///x/source/utils/screenReadiness.bs:213 screen-load split - component itemDetails variant Movie content 2 contentMs 2704 slowestContent extras 2310 texture 1 textureMs 640 slowestTexture logo 640  ',
];

/**
 * A chained navigation, as `--nav seasonDetails` produces it: the Series and the Season
 * are two SEPARATE ItemDetails mounts (the details route sets no allowReuse), so two
 * ledgers emit onto one console and interleave. The nav's gate waits
 * on paint, so it presses into the Season while the Series' extras chain is still
 * running — which puts the Series' settle AFTER the Season's paint.
 *
 * Written from the emitter, not captured: the ordering is inferred from the nav gate and
 * the measured fill durations. The point of the fixture is that the assembler must be
 * correct WITHOUT anyone having to prove this exact ordering occurs.
 */
const INTERLEAVED_LINES = [
  'INFO file:///x/screenReadiness.bs:118 screen-load paint - component itemDetails variant Series ms 900 [debug=false perfTiming=true]  ',
  'INFO file:///x/screenReadiness.bs:118 screen-load paint - component itemDetails variant Season ms 700 [debug=false perfTiming=true]  ',
  'INFO file:///x/screenReadiness.bs:212 screen-load settled - component itemDetails variant Series ms 2400 fills 2 [debug=false perfTiming=true]  ',
  'INFO file:///x/screenReadiness.bs:213 screen-load split - component itemDetails variant Series content 1 contentMs 1500 slowestContent extras 1500 texture 1 textureMs 200 slowestTexture logo 200  ',
  'INFO file:///x/screenReadiness.bs:212 screen-load settled - component itemDetails variant Season ms 1800 fills 2 [debug=false perfTiming=true]  ',
  'INFO file:///x/screenReadiness.bs:213 screen-load split - component itemDetails variant Season content 1 contentMs 1100 slowestContent extras 1100 texture 1 textureMs 150 slowestTexture logo 150  ',
];

describe('the screen-load family', () => {
  const load = measurementById('screen-load');

  it('assembles paint + settled + split into ONE sample', () => {
    const samples = assembleSamples(load, SCREEN_LOAD_LINES);
    expect(samples).toHaveLength(1);
    expect(samples[0].complete).toBe(true);
    expect(samples[0].lines).toEqual(['paint', 'settled', 'split']);
  });

  it('keeps a screen that painted but never settled, marked complete', () => {
    // The whole reason `paint` is the only required line. A fill that never resolved
    // must produce a sample carrying a paint time and NO settle time — not a dropped
    // sample, which would make a broken screen look like a device that ran fewer
    // times, and not an incomplete one, which would fall out of the median entirely.
    const [sample] = assembleSamples(load, [SCREEN_LOAD_LINES[0]]);
    expect(sample.complete).toBe(true);
    expect(sample.fields.paintMs).toBe(812);
    expect(sample.fields).not.toHaveProperty('settledMs');
  });

  it('splits two mounts of one component into two samples, told apart by variant', () => {
    // Reaching a Season means loading its Series first, so ONE launch legitimately
    // mounts this component twice. Both loads really happened; what makes them usable
    // is that the app names which is which.
    const samples = assembleSamples(load, [INTERLEAVED_LINES[0], INTERLEAVED_LINES[1]]);
    expect(samples).toHaveLength(2);
    expect(samples.map((s) => s.fields.variant)).toEqual(['Series', 'Season']);
  });

  it("does NOT file one mount's settle against another mount's paint", () => {
    // The finding this identity exists for. Under a single-open assembler the Series'
    // settle arrives while the Season is the open sample, and is merged into it —
    // producing one well-formed sample whose paint is the Season and whose settled
    // describes the Series. Nothing in the fields would reveal it.
    const samples = assembleSamples(load, INTERLEAVED_LINES);
    expect(samples).toHaveLength(2);

    const series = samples.find((s) => s.fields.variant === 'Series');
    const season = samples.find((s) => s.fields.variant === 'Season');
    expect(series.fields.paintMs).toBe(900);
    expect(series.fields.settledMs).toBe(2400);
    expect(series.fields.slowestContentMs).toBe(1500);
    expect(season.fields.paintMs).toBe(700);
    expect(season.fields.settledMs).toBe(1800);
    expect(season.fields.slowestContentMs).toBe(1100);
    expect(series.complete && season.complete).toBe(true);
  });

  it('emits samples in MOUNT order, not completion order', () => {
    // `indexInLaunch` has to keep meaning "which mount". The two differ exactly here:
    // the Series opens first and finishes last, because its extras chain outlives the
    // walk into the Season.
    const samples = assembleSamples(load, INTERLEAVED_LINES);
    expect(samples.map((s) => s.fields.variant)).toEqual(['Series', 'Season']);
  });

  it('reads the build flags the app stamped into the paint line', () => {
    const [sample] = assembleSamples(load, SCREEN_LOAD_LINES);
    expect(sample.buildFlags).toEqual({ debug: false, perfTiming: true });
  });

  it('matches a screen with no variant and no slowest fill', () => {
    // `screenReadiness.bs` writes the literal `none` rather than an empty token: an
    // empty one collapses the two spaces around it and shifts every field after it,
    // so the pattern would match the wrong group rather than fail.
    const [sample] = assembleSamples(load, [
      'INFO file:///x/screenReadiness.bs:118 screen-load paint - component settings variant none ms 240 [debug=false perfTiming=true]  ',
      'INFO file:///x/screenReadiness.bs:213 screen-load split - component settings variant none content 0 contentMs 0 slowestContent none 0 texture 0 textureMs 0 slowestTexture none 0  ',
    ]);
    expect(sample.fields.component).toBe('settings');
    expect(sample.fields.variant).toBe('none');
    expect(sample.fields.slowestContent).toBe('none');
  });

  it('is declared with no screen, because the app names its own', () => {
    // Unlike `item-grid`, whose null screen is a GAP only `--screen` can fill. Here the
    // screen arrives as evidence in the line rather than as an operator's assertion.
    expect(load.screen).toBeNull();
    expect(measurementIds()).toContain('screen-load');
  });
});

describe('splitWorkload', () => {
  it('separates what the run had to DO from how long it took', () => {
    const [first] = assembleSamples(home, CAPTURED);
    const { workload, timings } = splitWorkload(home, first.fields);
    // `rows` is the workload; everything else is a timing. No naming convention
    // separates them, which is why the family declares it.
    expect(workload).toEqual({ rows: 10 });
    expect(timings.totalMs).toBe(1500);
    expect(timings).not.toHaveProperty('rows');
  });

  it('leaves a family that emits only numbers with no dimensions', () => {
    const [first] = assembleSamples(home, CAPTURED);
    expect(splitWorkload(home, first.fields).dimensions).toEqual({});
  });

  it('routes a NON-NUMERIC field to dimensions, out of both halves', () => {
    const load = measurementById('screen-load');
    const [sample] = assembleSamples(load, SCREEN_LOAD_LINES);
    const { workload, timings, dimensions } = splitWorkload(load, sample.fields);

    // The three names the app stamps. Subtracting two of these is meaningless, and
    // leaving them in `timings` would hand `measure-compare.js` string operands for a
    // numeric delta and a Mann-Whitney.
    expect(dimensions).toEqual({
      component: 'itemDetails',
      variant: 'Movie',
      slowestContent: 'extras',
      slowestTexture: 'logo',
    });
    expect(timings).not.toHaveProperty('component');
    expect(workload).not.toHaveProperty('variant');

    // Counts are workload, durations are timings — the family still has to say which,
    // because both are numbers.
    expect(workload).toEqual({ fills: 3, contentFills: 2, textureFills: 1 });
    expect(timings).toEqual({
      paintMs: 812,
      settledMs: 3104,
      contentMs: 2704,
      slowestContentMs: 2310,
      textureMs: 640,
      slowestTextureMs: 640,
    });
  });
});

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('the registry itself', () => {
  it("every family's doc: path resolves to a file that exists", () => {
    // `doc:` is printed to operators and pasted into write-ups, and NOTHING reads it —
    // there is no consumer to fail, so a dead path survives indefinitely. `screen-load`
    // shipped pointing at `docs/dev/measuring-performance.md`, a Charter deliverable
    // that has not been written; the only file by that name lived under a gitignored
    // archive. This converts the eyeball into a gate.
    for (const m of MEASUREMENTS) {
      // Strip a `#anchor` — the file is what must exist; anchor resolution is
      // `lint:docs`' job and it already owns it.
      const file = m.doc.split('#')[0];
      expect(fs.existsSync(path.join(repoRoot, file)), `${m.id} doc: ${file}`).toBe(true);
    }
  });

  it('registers the item-grid family the genres work reads', () => {
    // The reason this is a registry and not a Home parser: the app already emits a
    // second family, and every future instrumented screen adds a third.
    expect(measurementIds()).toContain('item-grid');
  });

  it('parses an item-grid line built from its emitting call site', () => {
    const grid = measurementById('item-grid');
    const line =
      'INFO file:///x/components/ItemGrid/LoadItemsTask2.bs:421 item-grid load done - items 42 genreFetches 3 firstPaint 812 [debug=false perfTiming=true] task 1200 wait 900 emit 300  ';
    expect(matchLine(grid, line).fields).toEqual({
      items: 42,
      genreFetches: 3,
      firstPaintMs: 812,
      taskMs: 1200,
      waitMs: 900,
      emitMs: 300,
    });
  });

  it('handles the -1 firstPaint the grid emits when it never painted', () => {
    const grid = measurementById('item-grid');
    const line =
      'item-grid load done - items 0 genreFetches 0 firstPaint -1 [debug=false perfTiming=true] task 5 wait 0 emit 0';
    expect(matchLine(grid, line).fields.firstPaintMs).toBe(-1);
  });

  it('flags item-grid as NOT yet observed on a device', () => {
    // Honest provenance about the pattern itself: it is written from the format
    // string, which is authoritative for the message but says nothing about what
    // the wire looks like. Flip this to true only after a real line has matched.
    expect(measurementById('item-grid').grounded).toBe(false);
    expect(measurementById('home-latest-rows').grounded).toBe(true);
    // `screen-load` was flipped on 2026-08-16, on evidence rather than recollection:
    // the measurement ledger held 35 series of it, 32 carrying a COMPLETE sample,
    // across six components. Pinned here because the flag decides what `measure.js`
    // tells an operator to suspect on a zero-sample run, and left stale it sent them
    // to audit a parser that had matched hundreds of real lines.
    expect(measurementById('screen-load').grounded).toBe(true);
  });

  it('names a primary field for every family', () => {
    // A tool that headlined "the biggest number" would headline `drain`, the one
    // value the docs say is a derived remainder and must not be compared.
    for (const m of MEASUREMENTS) {
      expect(typeof m.primary).toBe('string');
      expect(m.workload).not.toContain(m.primary);
    }
  });

  it('returns undefined for an unregistered id rather than guessing', () => {
    expect(measurementById('nope')).toBeUndefined();
  });
});
