// Vitest unit tests for scripts/crash-report.js.
//
// Tests are grouped by the pipeline stage they cover (parse → group →
// threshold → categorize → draft → dedup-search → CLI). Side effects (worktree
// build, GH writes) are exercised via injected fakes (gitExec, ghExec) so
// nothing in this suite shells out or touches the network.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SourceMapGenerator } from 'source-map';
import { spawnScript } from './_helpers/spawn-script.js';

import {
  REQUIRED_CSV_HEADERS,
  DEFAULT_MIN_DEVICES,
  DEFAULT_MIN_DATES,
  DEFAULT_SPIKE_MULTIPLIER,
  validateRokuCrashCsv,
  validateDashboardCsv,
  parseCsv,
  mergeCsvs,
  parseErrorText,
  parseBacktraceCell,
  parseDashboardCsv,
  innermostFrame,
  groupBySignature,
  applyThreshold,
  inferCategory,
  resolveVersionTag,
  resolveSourceLocations,
  resolveBacktraceFrames,
  draftIssueTitle,
  draftIssueBody,
  draftDedupComment,
  draftRegressionComment,
  draftDedupSearchQuery,
  parseCrashIssueTitle,
  normalizeBacktraceText,
  enrichIssue,
  getOrBuildAnalysis,
  ANALYSIS_CACHE_PREFIX,
  classifyBacktraceForEnrichment,
  parseOccurrenceCount,
  classifyForEnrichment,
  TIMEOUT_ERROR_CODE,
  NULL_DOT_ERROR_CODE,
  resolveIssuesByBacktrace,
  searchExistingIssues,
  renderRunSummary,
  parseArgs,
  loadNoiseConfig,
  matchNoisePattern,
  classifyAgainstNoise,
  evaluateSpikes,
  draftSpikeComment,
} from '../../../scripts/crash-report.js';

// ────────────────────────────────────────────────────────────────────
// Test fixtures (matches the format of Roku's emailed weekly CSV — note the
// leading row-index column with no header, which our parser tolerates).

const SAMPLE_CSV = `,Date,Roku OS Release,App Version,Error Text,Total Count of Crashes,Total Count of Devices with Crashes
1,2026-05-16,G2,2.17.0,Function init() As Void; pkg:/components/ui/rectangle/RectangleSecondary.brs(2),2,2
2,2026-05-12,G2,2.17.0,Function downloadfallbackfont() As Void; pkg:/components/tasks/FontDownloadTask.brs(29),5,2
3,2026-05-15,G2,2.17.0,Function init() As Void; pkg:/components/ui/poster/JRPoster.brs(8),1,1
4,2026-05-17,G2,2.17.0,Function init() As Void; pkg:/components/ui/label/JRLabel.brs(5),1,1
5,2026-05-15,G2,2.17.0,Function init() As Void; pkg:/components/ui/label/JRLabel.brs(5),1,1
6,2026-05-13,G1,2.17.0,Function toms(t As Dynamic) As Dynamic; pkg:/components/captionTask.brs(276),2,1
`;

const UNRELATED_CSV = `Item,Count,Note\nWidget,5,fine\nGadget,2,also fine\n`;

// ────────────────────────────────────────────────────────────────────

describe('validateRokuCrashCsv', () => {
  it('accepts the Roku crash-report header shape (with leading index column)', () => {
    expect(validateRokuCrashCsv(SAMPLE_CSV.split('\n')[0])).toBe(true);
  });

  it('accepts the header without a leading row-index column', () => {
    const header = REQUIRED_CSV_HEADERS.join(',');
    expect(validateRokuCrashCsv(header)).toBe(true);
  });

  it('rejects unrelated CSV headers', () => {
    expect(validateRokuCrashCsv(UNRELATED_CSV.split('\n')[0])).toBe(false);
  });

  it('rejects empty input', () => {
    expect(validateRokuCrashCsv('')).toBe(false);
    expect(validateRokuCrashCsv(null)).toBe(false);
  });
});

describe('parseCsv', () => {
  it('parses the sample CSV into 6 rows with normalized fields', () => {
    const rows = parseCsv(SAMPLE_CSV);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({
      date: '2026-05-16',
      osRelease: 'G2',
      version: '2.17.0',
      crashes: 2,
      devices: 2,
    });
    expect(rows[0].errorText).toContain('RectangleSecondary.brs(2)');
  });

  it('throws when the header does not match Roku shape', () => {
    expect(() => parseCsv(UNRELATED_CSV)).toThrow(/Roku crash report/);
  });

  it('handles quoted fields containing commas', () => {
    const csv = `,Date,Roku OS Release,App Version,Error Text,Total Count of Crashes,Total Count of Devices with Crashes
1,2026-05-16,G2,"2.17.0","Function foo(a, b) As Void; pkg:/source/bar.brs(10)",1,1
`;
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].errorText).toBe('Function foo(a, b) As Void; pkg:/source/bar.brs(10)');
  });

  it('skips fully empty rows', () => {
    const csv =
      `,Date,Roku OS Release,App Version,Error Text,Total Count of Crashes,Total Count of Devices with Crashes\n` +
      `1,2026-05-16,G2,2.17.0,Function init() As Void; pkg:/x.brs(1),1,1\n` +
      `,,,,,,\n`;
    expect(parseCsv(csv)).toHaveLength(1);
  });
});

describe('mergeCsvs', () => {
  it('concatenates rows from multiple CSVs and dedups exact duplicates', () => {
    const merged = mergeCsvs([SAMPLE_CSV, SAMPLE_CSV]);
    // Exact dups collapse to the original row count.
    expect(merged).toHaveLength(6);
  });

  it('keeps rows that differ only in date', () => {
    const csvA =
      `,Date,Roku OS Release,App Version,Error Text,Total Count of Crashes,Total Count of Devices with Crashes\n` +
      `1,2026-05-16,G2,2.17.0,Function init() As Void; pkg:/x.brs(1),1,1\n`;
    const csvB =
      `,Date,Roku OS Release,App Version,Error Text,Total Count of Crashes,Total Count of Devices with Crashes\n` +
      `1,2026-05-17,G2,2.17.0,Function init() As Void; pkg:/x.brs(1),1,1\n`;
    expect(mergeCsvs([csvA, csvB])).toHaveLength(2);
  });
});

describe('parseErrorText', () => {
  it('extracts function name + pkg path + line', () => {
    const parsed = parseErrorText(
      'Function init() As Void; pkg:/components/ui/rectangle/RectangleSecondary.brs(2)',
    );
    expect(parsed).toEqual({
      function: 'init',
      pkgPath: 'pkg:/components/ui/rectangle/RectangleSecondary.brs',
      line: 2,
    });
  });

  it('handles functions with parameters', () => {
    const parsed = parseErrorText(
      'Function toms(t As Dynamic) As Dynamic; pkg:/components/captionTask.brs(276)',
    );
    expect(parsed.function).toBe('toms');
    expect(parsed.line).toBe(276);
  });

  it('returns null for unrecognized text', () => {
    expect(parseErrorText('not a crash signature')).toBeNull();
    expect(parseErrorText('')).toBeNull();
    expect(parseErrorText(null)).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────
// Dashboard CSV (manually exported from Roku analytics — carries the
// multi-frame backtrace + local-variable snapshot the weekly email omits).
// ────────────────────────────────────────────────────────────────────

const SAMPLE_DASHBOARD_CELL =
  `~~'Dot' Operator attempted with invalid BrightScript Component or interface reference. ` +
  `(runtime error &hec) in pkg:/components/captionTask.brs(276) ` +
  `~~Backtrace: ` +
  `~~#2  Function toms(t As Dynamic) As $1 file/line: pkg:/components/captionTask.brs(276) ` +
  `~~#1  Function parsevtt(lines As Dynamic) As $1 file/line: pkg:/components/captionTask.brs(312) ` +
  `~~#0  Function fetchcaption() As $1 file/line: pkg:/components/captionTask.brs(146) ` +
  `~~Local Variables: ` +
  `~~t                roString (2.1 was String) refcnt=1 val:"15:00,170?" ` +
  `~~global           Interface:ifGlobal ` +
  `~~m                roAssociativeArray refcnt=4 count:17 ` +
  `~~timestamp        roList refcnt=1 count:2 ~~`;

// Tab-separated, 4 columns. The cell is CSV-quoted; embedded `"` is doubled.
const SAMPLE_DASHBOARD_CSV =
  `Agg Channel Brightscript Error Daily Error Key\tDate\tAgg Channel Brightscript Error Backtrace Formatted\tBacktrace Text Formatted\n` +
  `\t2026-05-13\t\t"${SAMPLE_DASHBOARD_CELL.replaceAll('"', '""')}"\n`;

describe('validateDashboardCsv', () => {
  it('accepts a tab-separated header containing the required columns', () => {
    expect(
      validateDashboardCsv('Daily Error Key\tDate\tBacktrace Formatted\tBacktrace Text Formatted'),
    ).toBe(true);
  });

  it('rejects a comma-separated header', () => {
    expect(
      validateDashboardCsv('Daily Error Key,Date,Backtrace Formatted,Backtrace Text Formatted'),
    ).toBe(false);
  });

  it('rejects empty or non-string input', () => {
    expect(validateDashboardCsv('')).toBe(false);
    expect(validateDashboardCsv(null)).toBe(false);
  });
});

describe('parseBacktraceCell', () => {
  it('parses error header, every frame, and every local variable', () => {
    const parsed = parseBacktraceCell(SAMPLE_DASHBOARD_CELL);
    expect(parsed).toBeTruthy();
    expect(parsed.errorCode).toBe('&hec');
    expect(parsed.errorMessage).toMatch(/Dot' Operator attempted/);
    expect(parsed.frames).toHaveLength(3);
    expect(parsed.frames[0]).toEqual({
      index: 2,
      function: 'toms',
      args: 't As Dynamic',
      returnType: '$1',
      pkgPath: 'pkg:/components/captionTask.brs',
      line: 276,
    });
    expect(parsed.frames[2].function).toBe('fetchcaption');
    expect(parsed.locals).toHaveLength(4);
    expect(parsed.locals[0].raw).toMatch(/^t\s+roString.*15:00,170\?/);
  });

  it('returns null for empty / non-string / unrecognized input', () => {
    expect(parseBacktraceCell('')).toBeNull();
    expect(parseBacktraceCell(null)).toBeNull();
    expect(parseBacktraceCell('just some random text with no error header')).toBeNull();
  });

  it('returns null when the cell has a header but no frames', () => {
    const headerOnly = `~~Header (runtime error &hff) in pkg:/x.brs(1) ~~Backtrace: ~~Local Variables: ~~`;
    expect(parseBacktraceCell(headerOnly)).toBeNull();
  });

  it('tolerates a missing Local Variables section', () => {
    const noLocals =
      `~~msg (runtime error &h22) in pkg:/x.brs(1) ` +
      `~~Backtrace: ~~#0  Function foo() As Void file/line: pkg:/x.brs(1) ~~`;
    const parsed = parseBacktraceCell(noLocals);
    expect(parsed).toBeTruthy();
    expect(parsed.frames).toHaveLength(1);
    expect(parsed.locals).toEqual([]);
  });
});

describe('innermostFrame', () => {
  it('returns the frame with the highest index (innermost / crash site)', () => {
    const parsed = parseBacktraceCell(SAMPLE_DASHBOARD_CELL);
    expect(innermostFrame(parsed)).toMatchObject({ index: 2, function: 'toms' });
  });

  it('returns null when no frames are present', () => {
    expect(innermostFrame(null)).toBeNull();
    expect(innermostFrame({ frames: [] })).toBeNull();
  });
});

describe('parseDashboardCsv', () => {
  it('keys entries by innermost-frame signature (matches email-CSV signature shape)', () => {
    const map = parseDashboardCsv(SAMPLE_DASHBOARD_CSV);
    const entry = map.get('pkg:/components/captionTask.brs(276)');
    expect(entry).toBeTruthy();
    expect(entry.date).toBe('2026-05-13');
    expect(entry.errorCode).toBe('&hec');
    expect(entry.frames).toHaveLength(3);
    expect(entry.locals).toHaveLength(4);
  });

  it('throws when the input does not look like a dashboard export', () => {
    expect(() => parseDashboardCsv('foo,bar,baz\n1,2,3\n')).toThrow(/dashboard/i);
  });

  it('returns an empty map for empty / nullish input', () => {
    expect(parseDashboardCsv('').size).toBe(0);
    expect(parseDashboardCsv(null).size).toBe(0);
  });

  it('dedups same-signature rows across dates by keeping the most-recent date', () => {
    const cellNewer = SAMPLE_DASHBOARD_CELL.replace('val:"15:00,170?"', 'val:"NEWER"');
    const csv =
      `Daily Error Key\tDate\tBacktrace Formatted\tBacktrace Text Formatted\n` +
      `\t2026-05-10\t\t"${SAMPLE_DASHBOARD_CELL.replaceAll('"', '""')}"\n` +
      `\t2026-05-13\t\t"${cellNewer.replaceAll('"', '""')}"\n`;
    const map = parseDashboardCsv(csv);
    expect(map.size).toBe(1);
    const entry = map.get('pkg:/components/captionTask.brs(276)');
    expect(entry.date).toBe('2026-05-13');
    expect(entry.locals[0].raw).toMatch(/NEWER/);
  });

  it('skips rows with unparseable backtrace cells', () => {
    const csv =
      `Daily Error Key\tDate\tBacktrace Formatted\tBacktrace Text Formatted\n` +
      `\t2026-05-13\t\t"garbage with no error header"\n` +
      `\t2026-05-13\t\t"${SAMPLE_DASHBOARD_CELL.replaceAll('"', '""')}"\n`;
    const map = parseDashboardCsv(csv);
    expect(map.size).toBe(1);
  });
});

describe('groupBySignature', () => {
  it('aggregates rows with the same signature across dates/OS releases', () => {
    const rows = parseCsv(SAMPLE_CSV);
    const groups = groupBySignature(rows);
    // Same JRLabel signature appears twice — should collapse to one group.
    const jrLabel = groups.get('pkg:/components/ui/label/JRLabel.brs(5)');
    expect(jrLabel).toBeDefined();
    expect(jrLabel.totalCrashes).toBe(2);
    expect(jrLabel.dates.size).toBe(2);
    expect(jrLabel.maxDevicesPerRow).toBe(1);
  });

  it('captures all distinct OS releases per signature', () => {
    const csv =
      `,Date,Roku OS Release,App Version,Error Text,Total Count of Crashes,Total Count of Devices with Crashes\n` +
      `1,2026-05-16,G2,2.17.0,Function init() As Void; pkg:/x.brs(1),1,1\n` +
      `2,2026-05-16,G1,2.17.0,Function init() As Void; pkg:/x.brs(1),1,1\n`;
    const groups = groupBySignature(parseCsv(csv));
    const g = groups.get('pkg:/x.brs(1)');
    expect([...g.osReleases].sort()).toEqual(['G1', 'G2']);
  });

  it('skips rows whose errorText does not parse', () => {
    const csv =
      `,Date,Roku OS Release,App Version,Error Text,Total Count of Crashes,Total Count of Devices with Crashes\n` +
      `1,2026-05-16,G2,2.17.0,unparseable garbage,1,1\n`;
    expect(groupBySignature(parseCsv(csv)).size).toBe(0);
  });
});

describe('applyThreshold', () => {
  it('keeps groups meeting min-devices OR min-dates', () => {
    const rows = parseCsv(SAMPLE_CSV);
    const groups = groupBySignature(rows);
    const { kept, filtered } = applyThreshold(groups, { minDevices: 2, minDates: 2 });
    const keptSigs = kept.map((g) => g.signature);
    // FontDownloadTask: 2 devices, 1 date → kept (devices threshold)
    expect(keptSigs).toContain('pkg:/components/tasks/FontDownloadTask.brs(29)');
    // RectangleSecondary: 2 devices, 1 date → kept (devices threshold)
    expect(keptSigs).toContain('pkg:/components/ui/rectangle/RectangleSecondary.brs(2)');
    // JRLabel: 1 device, 2 dates → kept (dates threshold)
    expect(keptSigs).toContain('pkg:/components/ui/label/JRLabel.brs(5)');
    // JRPoster: 1 device, 1 date → filtered
    expect(filtered.map((g) => g.signature)).toContain('pkg:/components/ui/poster/JRPoster.brs(8)');
  });

  it('respects custom thresholds', () => {
    const rows = parseCsv(SAMPLE_CSV);
    const groups = groupBySignature(rows);
    const { kept } = applyThreshold(groups, { minDevices: 1, minDates: 1 });
    // All groups should be kept.
    expect(kept).toHaveLength(groups.size);
  });

  it('uses the documented defaults when called with no args', () => {
    expect(DEFAULT_MIN_DEVICES).toBe(2);
    expect(DEFAULT_MIN_DATES).toBe(2);
  });
});

describe('inferCategory', () => {
  it('flags m.global access as global-state-race', () => {
    expect(inferCategory('m.top.color = m.global.constants.colorSecondary')).toBe(
      'global-state-race',
    );
  });

  it('flags array indexing after tokenize as array-bounds', () => {
    expect(inferCategory('parts = t.tokenize(":")\nhours = parts[0].toInt()')).toBe('array-bounds');
  });

  it('flags findNode-then-deref as null-node-ref', () => {
    expect(inferCategory('m.videoPositionTime = m.top.findNode("videoPositionTime").text')).toBe(
      'null-node-ref',
    );
  });

  it('flags callFunc inside a loop as callback-exception', () => {
    expect(
      inferCategory('for each group in m.groups\n  group.callFunc("onDestroy")\nend for'),
    ).toBe('callback-exception');
  });

  it('flags onHandler args without nil guards as event-handler-nil-arg', () => {
    expect(
      inferCategory(
        '  result = event.getRoSGNode().getFields()',
        'Function onProgressChanged(event As Object) As Void; pkg:/x.brs(1)',
      ),
    ).toBe('event-handler-nil-arg');
  });

  it('returns unknown for unrecognized patterns', () => {
    expect(inferCategory('print "hello world"')).toBe('unknown');
    expect(inferCategory('')).toBe('unknown');
  });
});

describe('resolveVersionTag', () => {
  it('returns exact match when available', () => {
    const fakeGit = (args) => {
      if (args[0] === 'tag') return 'v2.17.0\nv2.16.0\nv2.15.0\n';
      return '';
    };
    expect(resolveVersionTag('2.17.0', fakeGit)).toEqual({ tag: 'v2.17.0', exactMatch: true });
  });

  it('falls back to closest same-major.minor tag', () => {
    const fakeGit = (args) => {
      if (args[0] === 'tag') return 'v2.17.5\nv2.17.0\nv2.16.0\n';
      return '';
    };
    // Asking for 2.17.3 (which isn't a tag) should fall back to v2.17.5 (highest in 2.17.x).
    expect(resolveVersionTag('2.17.3', fakeGit)).toEqual({ tag: 'v2.17.5', exactMatch: false });
  });

  it('returns null when no matching major.minor exists', () => {
    const fakeGit = () => 'v1.0.0\n';
    expect(resolveVersionTag('2.17.0', fakeGit)).toBeNull();
  });

  it('returns null for missing version', () => {
    expect(resolveVersionTag('', () => '')).toBeNull();
    expect(resolveVersionTag(null, () => '')).toBeNull();
  });
});

describe('draftIssueTitle', () => {
  it('produces a deterministic [crash] prefixed title', () => {
    const group = {
      function: 'init',
      pkgPath: 'pkg:/components/ui/rectangle/RectangleSecondary.brs',
      line: 2,
      versions: new Set(['2.17.0']),
    };
    expect(draftIssueTitle(group)).toBe('[crash] init() in RectangleSecondary.brs:2 (v2.17.0)');
  });
});

describe('draftDedupSearchQuery', () => {
  it('returns a stable file:line substring wrapped in quotes', () => {
    const group = {
      pkgPath: 'pkg:/components/ui/rectangle/RectangleSecondary.brs',
      line: 2,
    };
    expect(draftDedupSearchQuery(group)).toBe('"RectangleSecondary.brs:2"');
  });
});

describe('draftIssueBody', () => {
  const group = {
    function: 'init',
    pkgPath: 'pkg:/components/ui/rectangle/RectangleSecondary.brs',
    line: 2,
    versions: new Set(['2.17.0']),
    osReleases: new Set(['G2', 'G1']),
    rawErrorText: 'Function init() As Void; pkg:/components/ui/rectangle/RectangleSecondary.brs(2)',
    rows: [
      { date: '2026-05-16', osRelease: 'G2', crashes: 2, devices: 2 },
      { date: '2026-05-14', osRelease: 'G2', crashes: 1, devices: 1 },
    ],
  };
  const source = {
    bsFile: 'components/ui/rectangle/RectangleSecondary.bs',
    bsLine: 2,
    codeSnippet: 'm.top.color = m.global.constants.colorSecondary',
  };

  it('includes all required bug-report.yml field headers', () => {
    const body = draftIssueBody(group, source, 'global-state-race', {
      runDate: '2026-05-17',
      csvWindow: { start: '2026-05-12', end: '2026-05-17' },
    });
    expect(body).toContain('### What happened?');
    expect(body).toContain('### Steps to reproduce');
    expect(body).toContain('### JellyRock client version');
    expect(body).toContain('### Roku device info');
    expect(body).toContain('### Server connection type');
    expect(body).toContain('### Logs (optional)');
    expect(body).toContain('### Additional context (optional)');
  });

  it('cites the resolved source location and category', () => {
    const body = draftIssueBody(group, source, 'global-state-race', {
      runDate: '2026-05-17',
      csvWindow: { start: '2026-05-12', end: '2026-05-17' },
    });
    expect(body).toContain('components/ui/rectangle/RectangleSecondary.bs:2');
    expect(body).toContain('m.global.constants.colorSecondary');
    expect(body).toContain('Suspected category**: global-state-race');
    expect(body).toContain('| 2026-05-16 | G2 | 2 | 2 |');
  });

  it('handles unresolved source locations gracefully', () => {
    const body = draftIssueBody(group, null, 'unknown', {
      runDate: '2026-05-17',
      csvWindow: { start: '2026-05-12', end: '2026-05-17' },
    });
    expect(body).toContain('unresolved');
    expect(body).toContain('Transpiled file');
    // Unknown category should be hidden.
    expect(body).not.toContain('Suspected category');
  });
});

describe('draftDedupComment / draftRegressionComment', () => {
  const group = {
    function: 'init',
    versions: new Set(['2.17.0']),
    rows: [{ date: '2026-05-16', osRelease: 'G2', crashes: 2, devices: 2 }],
  };
  const ctx = { runDate: '2026-05-17', csvWindow: { start: '2026-05-12', end: '2026-05-17' } };

  it('dedup comment cites the new occurrences and stays signature-stable', () => {
    const c = draftDedupComment(group, ctx);
    expect(c).toContain('New occurrences');
    expect(c).toContain('Still occurring in app version 2.17.0');
    expect(c).toContain('Crash signature unchanged');
  });

  it('regression comment calls out the reopen', () => {
    const c = draftRegressionComment(group, { ...ctx, previousState: 'closed' });
    expect(c).toContain('Regression');
    expect(c).toContain('reoccurring');
    expect(c).toContain('Reopening for investigation');
  });

  describe('with dashboard-csv backtrace enrichment', () => {
    const backtrace = {
      errorMessage:
        "'Dot' Operator attempted with invalid BrightScript Component or interface reference.",
      errorCode: '&hec',
      date: '2026-05-16',
      frames: [
        {
          index: 1,
          function: 'init',
          args: '',
          returnType: 'Void',
          pkgPath: 'pkg:/components/x.brs',
          line: 2,
        },
      ],
      locals: [{ raw: 'm                roAssociativeArray refcnt=2 count:5' }],
    };
    const resolvedFrames = [
      { ...backtrace.frames[0], bsFile: 'components/x.bs', bsLine: 2, codeSnippet: '' },
    ];

    it('dedup comment includes backtrace section when enrichment data is passed', () => {
      const c = draftDedupComment(group, { ...ctx, backtrace, resolvedFrames });
      expect(c).toContain('New occurrences');
      expect(c).toMatch(/Runtime error.*`&hec`/);
      expect(c).toMatch(/Backtrace.*innermost frame first/);
      expect(c).toMatch(/\| 1 \| `init\(\) As Void`/);
      expect(c).toMatch(/Local variables at crash time.*2026-05-16/);
    });

    it('regression comment includes backtrace section when enrichment data is passed', () => {
      const c = draftRegressionComment(group, {
        ...ctx,
        previousState: 'closed',
        backtrace,
        resolvedFrames,
      });
      expect(c).toContain('Regression');
      expect(c).toMatch(/Runtime error.*`&hec`/);
      expect(c).toMatch(/Backtrace.*innermost frame first/);
    });

    it('dedup comment omits backtrace block when no enrichment is provided (back-compat)', () => {
      const c = draftDedupComment(group, ctx);
      expect(c).not.toMatch(/Backtrace.*innermost/);
      expect(c).not.toMatch(/Runtime error/);
    });
  });
});

describe('parseCrashIssueTitle (inverse of draftIssueTitle)', () => {
  it('extracts function, basename, line, version from a well-formed crash title', () => {
    const r = parseCrashIssueTitle(
      '[crash] downloadfallbackfont() in FontDownloadTask.brs:29 (v2.17.0)',
    );
    expect(r).toEqual({
      function: 'downloadfallbackfont',
      basename: 'FontDownloadTask.brs',
      line: 29,
      version: '2.17.0',
    });
  });

  it('handles 4-segment versions (patch + build suffix-free)', () => {
    const r = parseCrashIssueTitle('[crash] popscene() in SceneManager.brs:83 (v2.17.0.1)');
    expect(r.version).toBe('2.17.0.1');
  });

  it('tolerates trailing whitespace', () => {
    const r = parseCrashIssueTitle('[crash] init() in JRLabel.brs:5 (v2.17.0)   ');
    expect(r).not.toBeNull();
    expect(r.line).toBe(5);
  });

  it('returns null for a non-crash title', () => {
    expect(parseCrashIssueTitle('Bug: something is broken')).toBe(null);
    expect(parseCrashIssueTitle('[crash] but missing the version part')).toBe(null);
    expect(parseCrashIssueTitle('')).toBe(null);
    expect(parseCrashIssueTitle(null)).toBe(null);
  });
});

describe('normalizeBacktraceText (dashboard plaintext → cell format)', () => {
  it('joins newline-separated lines with `~~` so parseBacktraceCell can consume them', () => {
    const text = `'Type Mismatch' (runtime error &h18) in pkg:/components/captionTask.brs(276)
Backtrace:
#0  Function fetchcaption() As Void file/line: pkg:/components/captionTask.brs(146)
#1  Function toms(t As Dynamic) As Dynamic file/line: pkg:/components/captionTask.brs(276)
Local Variables:
t                roString val:"15:00,170?"`;
    const normalized = normalizeBacktraceText(text);
    expect(normalized).toContain('~~Backtrace:~~');
    expect(normalized).toContain('~~Local Variables:~~');
    const parsed = parseBacktraceCell(normalized);
    expect(parsed).not.toBeNull();
    expect(parsed.errorCode).toBe('&h18');
    expect(parsed.frames).toHaveLength(2);
    expect(parsed.locals).toHaveLength(1);
  });

  it('handles CRLF line endings', () => {
    const text =
      "'X' (runtime error &h01) in pkg:/x.brs(1)\r\nBacktrace:\r\n#0  Function a() As Void file/line: pkg:/x.brs(1)\r\n";
    const parsed = parseBacktraceCell(normalizeBacktraceText(text));
    expect(parsed).not.toBeNull();
    expect(parsed.frames[0].function).toBe('a');
  });

  it('drops empty and whitespace-only lines', () => {
    const text =
      "\n\n  \n'X' (runtime error &h01) in pkg:/x.brs(1)\n\nBacktrace:\n#0  Function a() As Void file/line: pkg:/x.brs(1)\n";
    const normalized = normalizeBacktraceText(text);
    expect(normalized.startsWith("'X'")).toBe(true);
    expect(normalized).not.toMatch(/~~~~/);
  });

  it('returns empty string for non-string input', () => {
    expect(normalizeBacktraceText(null)).toBe('');
    expect(normalizeBacktraceText(undefined)).toBe('');
    expect(normalizeBacktraceText(123)).toBe('');
  });

  it('extracts the first data row cell when fed a dashboard TSV directly', () => {
    const normalized = normalizeBacktraceText(SAMPLE_DASHBOARD_CSV);
    const parsed = parseBacktraceCell(normalized);
    expect(parsed).not.toBeNull();
    expect(parsed.errorCode).toBe('&hec');
    expect(parsed.frames).toHaveLength(3);
  });

  it('throws on a dashboard TSV with no data rows', () => {
    const headerOnly = `Daily Error Key\tDate\tBacktrace Formatted\tBacktrace Text Formatted\n`;
    expect(() => normalizeBacktraceText(headerOnly)).toThrow(/no data rows/i);
  });

  it('throws on a dashboard TSV whose first data row has an empty backtrace cell', () => {
    const emptyCell =
      `Daily Error Key\tDate\tBacktrace Formatted\tBacktrace Text Formatted\n` +
      `\t2026-05-13\t\t\n`;
    expect(() => normalizeBacktraceText(emptyCell)).toThrow(/empty/i);
  });
});

describe('classifyBacktraceForEnrichment (pre-enrichment noise check)', () => {
  function makeBacktrace({ errorCode, errorMessage, innermostFn = 'someFunc' }) {
    return {
      errorCode,
      errorMessage,
      date: '2026-05-15',
      frames: [
        {
          index: 1,
          function: innermostFn,
          args: '',
          returnType: '$1',
          pkgPath: 'pkg:/components/x.brs',
          line: 100,
        },
        {
          index: 0,
          function: 'onpositionchanged',
          args: '',
          returnType: '$1',
          pkgPath: 'pkg:/components/y.brs',
          line: 200,
        },
      ],
      locals: [],
    };
  }

  it('flags Execution timeout (&h23) with exactly 1 occurrence as timeout-one-off', () => {
    const bt = makeBacktrace({
      errorCode: TIMEOUT_ERROR_CODE,
      errorMessage: 'Execution timeout',
      innermostFn: 'onprogresspercentagechanged',
    });
    const c = classifyBacktraceForEnrichment(bt, { occurrenceCount: 1 });
    expect(c).not.toBeNull();
    expect(c.kind).toBe('timeout-one-off');
    expect(c.recommendedAction).toBe('close-as-not-actionable');
  });

  it('flags Execution timeout with 2+ occurrences as timeout-recurring (enrich + escalate)', () => {
    const bt = makeBacktrace({ errorCode: TIMEOUT_ERROR_CODE, errorMessage: 'Execution timeout' });
    const c = classifyBacktraceForEnrichment(bt, { occurrenceCount: 3 });
    expect(c.kind).toBe('timeout-recurring');
    expect(c.recommendedAction).toBe('enrich-and-escalate');
  });

  it('matches timeout by error-message substring too (case-insensitive)', () => {
    const bt = makeBacktrace({ errorCode: '&h99', errorMessage: 'Execution TIMEOUT after 30s' });
    const c = classifyBacktraceForEnrichment(bt, { occurrenceCount: 1 });
    expect(c).not.toBeNull();
    expect(c.kind).toBe('timeout-one-off');
  });

  it('flags init() + Dot-operator error (&hec) as #103 suspect (belt-and-suspenders)', () => {
    const bt = makeBacktrace({
      errorCode: NULL_DOT_ERROR_CODE,
      errorMessage:
        "'Dot' Operator attempted with invalid BrightScript Component or interface reference.",
      innermostFn: 'init',
    });
    const c = classifyBacktraceForEnrichment(bt, { occurrenceCount: 5 });
    expect(c.kind).toBe('global-constants-init-race-suspect');
    expect(c.tracker).toBe(103);
    expect(c.recommendedAction).toBe('close-as-duplicate-of-103');
  });

  it('returns null for a backtrace that is neither timeout nor #103-shape', () => {
    const bt = makeBacktrace({ errorCode: '&h18', errorMessage: 'Type Mismatch' });
    expect(classifyBacktraceForEnrichment(bt, { occurrenceCount: 5 })).toBeNull();
  });

  it('returns null for missing backtrace input', () => {
    expect(classifyBacktraceForEnrichment(null, {})).toBeNull();
    expect(classifyBacktraceForEnrichment(undefined, {})).toBeNull();
  });

  it('does NOT classify init() + non-Dot error as #103 (avoids false positives)', () => {
    const bt = makeBacktrace({
      errorCode: '&h18',
      errorMessage: 'Type Mismatch',
      innermostFn: 'init',
    });
    expect(classifyBacktraceForEnrichment(bt, { occurrenceCount: 1 })).toBeNull();
  });
});

describe('parseOccurrenceCount (extract total crashes from issue body)', () => {
  it('sums the Crashes column across all rows of the Occurrence stats table', () => {
    const body = `### What happened?
Lorem ipsum.

**Occurrence stats** (this report window):

| Date | Roku OS | Crashes | Devices |
|---|---|---|---|
| 2026-05-12 | G2 | 5 | 2 |
| 2026-05-13 | G1 | 2 | 1 |
| 2026-05-14 | G2 | 1 | 1 |

### Steps to reproduce
N/A
`;
    expect(parseOccurrenceCount(body)).toBe(8);
  });

  it('returns the single-row count for a single-occurrence issue', () => {
    const body = `**Occurrence stats** (this report window):

| Date | Roku OS | Crashes | Devices |
|---|---|---|---|
| 2026-05-15 | G2 | 1 | 1 |
`;
    expect(parseOccurrenceCount(body)).toBe(1);
  });

  it('returns null when the body has no Occurrence stats section', () => {
    expect(parseOccurrenceCount('A normal issue body without that table.')).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(parseOccurrenceCount(null)).toBeNull();
    expect(parseOccurrenceCount(undefined)).toBeNull();
    expect(parseOccurrenceCount(123)).toBeNull();
  });

  it('skips malformed rows but counts valid ones', () => {
    const body = `**Occurrence stats** (this report window):

| Date | Roku OS | Crashes | Devices |
|---|---|---|---|
| 2026-05-12 | G2 | 4 | 2 |
| malformed row |
| 2026-05-13 | G1 | not-a-number | 1 |
| 2026-05-14 | G2 | 3 | 1 |
`;
    expect(parseOccurrenceCount(body)).toBe(7);
  });
});

describe('classifyForEnrichment (end-to-end wiring)', () => {
  function makeGhExec(viewJson) {
    return (args) => {
      if (args[0] === 'issue' && args[1] === 'view') return JSON.stringify(viewJson);
      throw new Error(`unexpected gh args: ${args.join(' ')}`);
    };
  }

  it('returns a timeout-one-off classification given a real-shape timeout backtrace + a 1-crash issue body', async () => {
    const backtraceText = `Execution timeout (runtime error &h23) in pkg:/components/video/OSD.brs(504)
Backtrace:
#1  Function onprogresspercentagechanged() As $1 file/line: pkg:/components/video/OSD.brs(506)
#0  Function onpositionchanged() As $1 file/line: pkg:/components/video/VideoPlayerView.brs(1156)
Local Variables:
global           Interface:ifGlobal
m                roAssociativeArray refcnt=2 count:31`;
    const ghExec = makeGhExec({
      title: '[crash] onprogresspercentagechanged() in OSD.brs:506 (v2.17.0)',
      body: `**Occurrence stats** (this report window):

| Date | Roku OS | Crashes | Devices |
|---|---|---|---|
| 2026-05-15 | G2 | 1 | 1 |
`,
      labels: [{ name: 'crash' }],
      state: 'OPEN',
    });
    const result = await classifyForEnrichment({ issueNumber: 583, backtraceText, ghExec });
    expect(result.errorCode).toBe('&h23');
    expect(result.occurrenceCount).toBe(1);
    expect(result.innermostFrame.function).toBe('onprogresspercentagechanged');
    expect(result.classification.kind).toBe('timeout-one-off');
  });

  it('returns null classification for a unique backtrace worth enriching', async () => {
    const backtraceText = `'Type Mismatch' (runtime error &h18) in pkg:/components/captionTask.brs(276)
Backtrace:
#0  Function toms(t As Dynamic) As Dynamic file/line: pkg:/components/captionTask.brs(276)
Local Variables:
t                roString val:"15:00,170?"`;
    const ghExec = makeGhExec({
      title: '[crash] toms() in captionTask.brs:276 (v2.17.0)',
      body: `**Occurrence stats** (this report window):

| Date | Roku OS | Crashes | Devices |
|---|---|---|---|
| 2026-05-13 | G1 | 2 | 1 |
`,
      labels: [{ name: 'crash' }],
      state: 'OPEN',
    });
    const result = await classifyForEnrichment({ issueNumber: 584, backtraceText, ghExec });
    expect(result.classification).toBeNull();
    expect(result.errorCode).toBe('&h18');
    expect(result.occurrenceCount).toBe(2);
  });
});

describe('resolveIssuesByBacktrace (auto-resolve issue from backtrace)', () => {
  const backtrace = {
    errorCode: '&h18',
    errorMessage: 'Type Mismatch',
    date: '2026-05-13',
    frames: [
      {
        index: 1,
        function: 'toms',
        args: 't As Dynamic',
        returnType: '$1',
        pkgPath: 'pkg:/components/captionTask.brs',
        line: 276,
      },
      {
        index: 0,
        function: 'fetchcaption',
        args: '',
        returnType: '$1',
        pkgPath: 'pkg:/components/captionTask.brs',
        line: 146,
      },
    ],
    locals: [],
  };

  it('returns open + closed [crash] issues matching the innermost frame basename:line', () => {
    const ghExec = (args) => {
      expect(args).toContain('--search');
      const queryIdx = args.indexOf('--search') + 1;
      expect(args[queryIdx]).toBe('"captionTask.brs:276"');
      return JSON.stringify([
        { number: 584, title: '[crash] toms() in captionTask.brs:276 (v2.17.0)', state: 'OPEN' },
        { number: 410, title: '[crash] toms() in captionTask.brs:276 (v2.15.0)', state: 'CLOSED' },
      ]);
    };
    const matches = resolveIssuesByBacktrace(backtrace, { ghExec });
    expect(matches).toHaveLength(2);
    expect(matches[0]).toEqual({
      number: 584,
      title: '[crash] toms() in captionTask.brs:276 (v2.17.0)',
      state: 'OPEN',
    });
  });

  it('filters out gh search hits whose title is not [crash]-prefixed (avoid false positives)', () => {
    const ghExec = () =>
      JSON.stringify([
        { number: 584, title: '[crash] toms() in captionTask.brs:276 (v2.17.0)', state: 'OPEN' },
        { number: 999, title: 'Bug: captionTask.brs:276 looks weird', state: 'OPEN' },
      ]);
    const matches = resolveIssuesByBacktrace(backtrace, { ghExec });
    expect(matches).toHaveLength(1);
    expect(matches[0].number).toBe(584);
  });

  it('returns [] when gh returns no results', () => {
    const ghExec = () => '[]';
    expect(resolveIssuesByBacktrace(backtrace, { ghExec })).toEqual([]);
  });

  it('returns [] when gh exec throws (network/auth)', () => {
    const ghExec = () => {
      throw new Error('auth failure');
    };
    expect(resolveIssuesByBacktrace(backtrace, { ghExec })).toEqual([]);
  });

  it('returns [] when backtrace has no innermost frame', () => {
    expect(resolveIssuesByBacktrace({ frames: [] })).toEqual([]);
    expect(resolveIssuesByBacktrace(null)).toEqual([]);
  });

  it('returns [] when gh returns malformed JSON', () => {
    const ghExec = () => 'not json at all';
    expect(resolveIssuesByBacktrace(backtrace, { ghExec })).toEqual([]);
  });
});

describe('getOrBuildAnalysis (worktree cache)', () => {
  let cacheDir;
  let buildDirPath;
  const tag = 'v9.99.99';

  beforeAll(() => {
    // Pre-seed a "cached" worktree at the path the cache would use.
    cacheDir = join(tmpdir(), `${ANALYSIS_CACHE_PREFIX}${tag}`);
    buildDirPath = join(cacheDir, 'build-analysis');
    mkdirSync(buildDirPath, { recursive: true });
    // Drop a fake source map so the cache hit returns a usable buildDir.
    writeFileSync(join(buildDirPath, 'placeholder.brs.map'), '{}');
  });

  afterAll(() => {
    if (cacheDir) rmSync(cacheDir, { recursive: true, force: true });
  });

  it('returns cached worktree when build-analysis exists and is within TTL', () => {
    // Stub gitExec so resolveVersionTag returns our fake tag without shelling out.
    const gitExec = () => `${tag}\n`;
    const logs = [];
    const result = getOrBuildAnalysis('9.99.99', { gitExec, logger: (m) => logs.push(m) });
    expect(result.fromCache).toBe(true);
    expect(result.buildDir).toBe(buildDirPath);
    expect(result.worktreePath).toBe(cacheDir);
    // Cleanup is a no-op for cached returns (we keep the cache for re-use).
    expect(typeof result.cleanup).toBe('function');
    expect(logs.some((m) => m.includes('reusing cached worktree'))).toBe(true);
  });

  it('treats a TTL of 0 as immediate staleness (forces rebuild path)', () => {
    const gitExec = () => `${tag}\n`;
    const logs = [];
    // ttlMs: 0 → the existsSync(buildDir) check still passes but the ageMs < ttlMs
    // check fails (any age is > 0), so we expect a rebuild log.
    expect(() => getOrBuildAnalysis('9.99.99', { gitExec, ttlMs: 0, logger: (m) => logs.push(m) }))
      // Will throw because resolveVersionTag returns our fake tag but no real
      // worktree can be built from it. We only care that we entered the rebuild
      // branch — verified via the staleness log message.
      .toThrow();
    expect(logs.some((m) => m.includes('stale') && m.includes('rebuilding'))).toBe(true);
  });
});

describe('enrichIssue (orchestrator wiring)', () => {
  // The full end-to-end requires a real `buildAnalysisInWorktree` call. We
  // exercise the wiring shape via the failure paths that bail before the build
  // step — title-shape rejection and missing-label rejection. The happy path
  // is covered by composition: parseCrashIssueTitle + normalizeBacktraceText +
  // parseBacktraceCell + resolveBacktraceFrames + backtraceSection are each
  // independently tested above.

  function makeGhExec(viewJson) {
    return (args) => {
      if (args[0] === 'issue' && args[1] === 'view') return JSON.stringify(viewJson);
      throw new Error(`unexpected gh args: ${args.join(' ')}`);
    };
  }

  it('rejects an issue whose title does not match the [crash] shape', async () => {
    const ghExec = makeGhExec({
      title: 'Bug: something is broken',
      labels: [{ name: 'crash' }],
      state: 'OPEN',
    });
    await expect(
      enrichIssue({ issueNumber: 999, backtraceText: 'irrelevant', ghExec }),
    ).rejects.toThrow(/doesn't match the \[crash\] shape/);
  });

  it('rejects an issue missing the `crash` label', async () => {
    const ghExec = makeGhExec({
      title: '[crash] init() in JRLabel.brs:5 (v2.17.0)',
      labels: [{ name: 'bug' }],
      state: 'OPEN',
    });
    await expect(
      enrichIssue({ issueNumber: 999, backtraceText: 'irrelevant', ghExec }),
    ).rejects.toThrow(/missing the 'crash' label/);
  });

  it('rejects when the backtrace text is unparseable', async () => {
    const ghExec = makeGhExec({
      title: '[crash] init() in JRLabel.brs:5 (v2.17.0)',
      labels: [{ name: 'crash' }],
      state: 'OPEN',
    });
    await expect(
      enrichIssue({
        issueNumber: 999,
        backtraceText: 'this is not a backtrace at all',
        ghExec,
      }),
    ).rejects.toThrow(/Could not parse backtrace text/);
  });
});

describe('searchExistingIssues', () => {
  it('returns OPEN match when title prefix matches', () => {
    const groups = [
      {
        signature: 'pkg:/x.brs(2)',
        function: 'init',
        pkgPath: 'pkg:/x.brs',
        line: 2,
      },
    ];
    const fakeGh = () =>
      JSON.stringify([
        {
          number: 42,
          state: 'OPEN',
          title: '[crash] init() in x.brs:2 (v2.17.0)',
          updatedAt: '2026-05-10T00:00:00Z',
        },
      ]);
    const result = searchExistingIssues(groups, { ghExec: fakeGh });
    expect(result.get('pkg:/x.brs(2)')).toEqual({
      number: 42,
      state: 'OPEN',
      title: '[crash] init() in x.brs:2 (v2.17.0)',
    });
  });

  it('returns null when no candidate title starts with [crash] prefix', () => {
    const groups = [
      { signature: 'pkg:/x.brs(2)', function: 'init', pkgPath: 'pkg:/x.brs', line: 2 },
    ];
    const fakeGh = () =>
      JSON.stringify([
        // Manually-filed bug — title does NOT have the [crash] prefix.
        { number: 5, state: 'OPEN', title: 'x.brs:2 sometimes crashes', updatedAt: '' },
      ]);
    expect(searchExistingIssues(groups, { ghExec: fakeGh }).get('pkg:/x.brs(2)')).toBeNull();
  });

  it('returns null on gh failure (degraded mode)', () => {
    const groups = [
      { signature: 'pkg:/x.brs(2)', function: 'init', pkgPath: 'pkg:/x.brs', line: 2 },
    ];
    const fakeGh = () => {
      throw new Error('gh: not authenticated');
    };
    expect(searchExistingIssues(groups, { ghExec: fakeGh }).get('pkg:/x.brs(2)')).toBeNull();
  });
});

describe('renderRunSummary', () => {
  it('renders frontmatter + sections including ignored zip entries', () => {
    const plan = {
      createdAt: '2026-05-17T00:00:00Z',
      input: { kind: 'zip', sourcePath: '/tmp/foo.zip', csvCount: 2, ignoredFiles: ['notes.txt'] },
      csvWindow: { start: '2026-05-12', end: '2026-05-17' },
      totalRows: 14,
      uniqueSignatures: 9,
      threshold: { minDevices: 2, minDates: 2 },
      aboveThreshold: 1,
      belowThreshold: 8,
      skippedBelowThreshold: [
        { signature: 'pkg:/x.brs(1)', maxDevicesPerRow: 1, dates: ['2026-05-16'] },
      ],
      buildErrors: [],
      actions: [],
    };
    const results = [
      {
        action: 'create',
        issueNumber: 99,
        title: '[crash] foo() in foo.brs:1 (v2.17.0)',
        totalCrashes: 3,
        maxDevicesPerRow: 2,
        signature: 'pkg:/foo.brs(1)',
        error: null,
      },
    ];
    const out = renderRunSummary(plan, results);
    expect(out).toContain('target: crash-report');
    expect(out).toContain('input-kind: zip');
    expect(out).toContain('## Ignored zip entries');
    expect(out).toContain('- notes.txt');
    expect(out).toContain('## Created');
    expect(out).toContain('#99 — [crash] foo() in foo.brs:1 (v2.17.0)');
    expect(out).toContain('## Skipped below threshold');
  });
});

describe('parseArgs', () => {
  it('captures positional and flag args', () => {
    const parsed = parseArgs(['plan', '--input', 'foo.csv', '--min-devices', '3', '--dry-run']);
    expect(parsed._).toEqual(['plan']);
    expect(parsed.flags.input).toBe('foo.csv');
    expect(parsed.flags['min-devices']).toBe('3');
    expect(parsed.flags['dry-run']).toBe(true);
  });

  it('supports --flag=value form', () => {
    const parsed = parseArgs(['plan', '--input=foo.csv']);
    expect(parsed.flags.input).toBe('foo.csv');
  });
});

// ────────────────────────────────────────────────────────────────────
// Known-noise classification + spike detection.

describe('loadNoiseConfig', () => {
  let dir;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'crash-noise-test-'));
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('returns empty patterns when the config file does not exist', () => {
    const empty = mkdtempSync(join(tmpdir(), 'crash-noise-empty-'));
    try {
      expect(loadNoiseConfig(empty)).toEqual({ patterns: [] });
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('parses a valid config and defaults spike_multiplier', () => {
    const root = mkdtempSync(join(tmpdir(), 'crash-noise-valid-'));
    try {
      const cfgDir = join(root, '.crash-report');
      mkdirSync(cfgDir);
      writeFileSync(
        join(cfgDir, 'known-noise.yml'),
        `patterns:
  - id: example
    tracker_issue: 42
    baseline_crashes_per_week: 5
    match:
      function: ^init$
`,
      );
      const cfg = loadNoiseConfig(root);
      expect(cfg.patterns).toHaveLength(1);
      expect(cfg.patterns[0].id).toBe('example');
      expect(cfg.patterns[0].spike_multiplier).toBe(DEFAULT_SPIKE_MULTIPLIER);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('throws on missing required fields', () => {
    const root = mkdtempSync(join(tmpdir(), 'crash-noise-bad-'));
    try {
      const cfgDir = join(root, '.crash-report');
      mkdirSync(cfgDir);
      writeFileSync(
        join(cfgDir, 'known-noise.yml'),
        `patterns:
  - id: missing-tracker
    baseline_crashes_per_week: 5
    match: { function: x }
`,
      );
      expect(() => loadNoiseConfig(root)).toThrow(/tracker_issue/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('matchNoisePattern', () => {
  const group = {
    function: 'init',
    signature: 'pkg:/x.brs(1)',
    inferredCategory: 'global-state-race',
  };
  const source = {
    bsFile: 'components/ui/rectangle/RectangleSecondary.bs',
    bsLine: 2,
    codeSnippet: 'm.top.color = m.global.constants.colorSecondary',
  };

  it('matches when all predicates agree', () => {
    const pattern = {
      match: {
        function: '^init$',
        category: 'global-state-race',
        file_glob: ['components/ui/**'],
        snippet_regex: 'm\\.global\\.constants',
      },
    };
    expect(matchNoisePattern(group, source, pattern)).toBe(true);
  });

  it('does not match when category differs', () => {
    const pattern = { match: { category: 'array-bounds' } };
    expect(matchNoisePattern(group, source, pattern)).toBe(false);
  });

  it('does not match when file glob misses', () => {
    const pattern = { match: { file_glob: ['source/api/**'] } };
    expect(matchNoisePattern(group, source, pattern)).toBe(false);
  });

  it('returns false when source is missing but file_glob is required', () => {
    const pattern = { match: { file_glob: ['components/**'] } };
    expect(matchNoisePattern(group, null, pattern)).toBe(false);
  });

  it('matches with no predicates (empty match = wildcard)', () => {
    expect(matchNoisePattern(group, source, { match: {} })).toBe(true);
  });
});

describe('classifyAgainstNoise', () => {
  function makeGroup(overrides = {}) {
    return {
      signature: 'pkg:/x.brs(1)',
      function: 'init',
      pkgPath: 'pkg:/x.brs',
      line: 1,
      rawErrorText: 'Function init() As Void; pkg:/x.brs(1)',
      versions: new Set(['2.17.0']),
      osReleases: new Set(['G2']),
      dates: new Set(['2026-05-16']),
      totalCrashes: 3,
      maxDevicesPerRow: 2,
      rows: [{ date: '2026-05-16', osRelease: 'G2', crashes: 3, devices: 2 }],
      ...overrides,
    };
  }

  it('partitions groups into byPattern and novel', () => {
    const noiseGroup = makeGroup({
      signature: 'pkg:/components/ui/rectangle/RectangleSecondary.brs(2)',
      function: 'init',
    });
    const novelGroup = makeGroup({
      signature: 'pkg:/components/api/Sessions.brs(50)',
      function: 'fetchSessions',
    });
    const sourceBySig = new Map([
      [
        noiseGroup.signature,
        {
          bsFile: 'components/ui/rectangle/RectangleSecondary.bs',
          bsLine: 2,
          codeSnippet: 'm.global.constants.colorSecondary',
        },
      ],
      [
        novelGroup.signature,
        { bsFile: 'components/api/Sessions.bs', bsLine: 50, codeSnippet: 'print "fetching"' },
      ],
    ]);
    const config = {
      patterns: [
        {
          id: 'p1',
          tracker_issue: 103,
          baseline_crashes_per_week: 10,
          spike_multiplier: 2.0,
          match: { function: '^init$', category: 'global-state-race' },
        },
      ],
    };
    const { byPattern, novel } = classifyAgainstNoise(
      [noiseGroup, novelGroup],
      sourceBySig,
      config,
    );
    expect(byPattern.size).toBe(1);
    expect(byPattern.get('p1').groups).toHaveLength(1);
    expect(byPattern.get('p1').groups[0].signature).toBe(noiseGroup.signature);
    expect(novel).toHaveLength(1);
    expect(novel[0].signature).toBe(novelGroup.signature);
  });

  it('first-match wins when multiple patterns could match', () => {
    const group = makeGroup({ function: 'init' });
    const sourceBySig = new Map([
      [group.signature, { bsFile: 'components/x.bs', bsLine: 1, codeSnippet: 'm.global.x = 1' }],
    ]);
    const config = {
      patterns: [
        {
          id: 'first',
          tracker_issue: 1,
          baseline_crashes_per_week: 5,
          spike_multiplier: 2.0,
          match: { category: 'global-state-race' },
        },
        {
          id: 'second',
          tracker_issue: 2,
          baseline_crashes_per_week: 5,
          spike_multiplier: 2.0,
          match: { category: 'global-state-race' },
        },
      ],
    };
    const { byPattern } = classifyAgainstNoise([group], sourceBySig, config);
    expect(byPattern.has('first')).toBe(true);
    expect(byPattern.has('second')).toBe(false);
  });

  it('with no patterns, all groups are novel', () => {
    const group = makeGroup();
    const { byPattern, novel } = classifyAgainstNoise([group], new Map(), { patterns: [] });
    expect(byPattern.size).toBe(0);
    expect(novel).toHaveLength(1);
  });
});

describe('evaluateSpikes', () => {
  const pattern = {
    id: 'p',
    tracker_issue: 103,
    baseline_crashes_per_week: 10,
    spike_multiplier: 2.0,
    match: {},
  };

  it('does NOT spike when combined count is below baseline × multiplier', () => {
    const byPattern = new Map([
      [
        'p',
        {
          pattern,
          groups: [
            { signature: 'a', totalCrashes: 5, maxDevicesPerRow: 1 },
            { signature: 'b', totalCrashes: 7, maxDevicesPerRow: 2 },
          ],
        },
      ],
    ]);
    const [spike] = evaluateSpikes(byPattern, {
      runDate: '2026-05-17',
      csvWindow: { start: '2026-05-12', end: '2026-05-17' },
    });
    expect(spike.totalCrashes).toBe(12);
    expect(spike.isSpike).toBe(false);
    expect(spike.commentBody).toBeNull();
    expect(spike.ratio).toBeCloseTo(1.2);
  });

  it('spikes when combined count strictly exceeds baseline × multiplier', () => {
    const byPattern = new Map([
      [
        'p',
        {
          pattern,
          groups: [
            { signature: 'a', totalCrashes: 15, maxDevicesPerRow: 3 },
            { signature: 'b', totalCrashes: 10, maxDevicesPerRow: 2 },
          ],
        },
      ],
    ]);
    const [spike] = evaluateSpikes(byPattern, {
      runDate: '2026-05-17',
      csvWindow: { start: '2026-05-12', end: '2026-05-17' },
    });
    expect(spike.totalCrashes).toBe(25);
    expect(spike.isSpike).toBe(true);
    expect(spike.commentBody).toContain('Spike alert');
    expect(spike.commentBody).toContain('25');
    expect(spike.commentBody).toContain(
      'm-global-constants-init-race'.length > 0 ? 'pattern `p`' : '',
    );
    expect(spike.ratio).toBe(2.5);
  });
});

describe('draftSpikeComment', () => {
  it('includes pattern id, totals, baseline, ratio, and per-signature breakdown', () => {
    const body = draftSpikeComment(
      {
        id: 'm-global-constants-init-race',
        baseline_crashes_per_week: 10,
        spike_multiplier: 2.0,
      },
      [
        { signature: 'pkg:/a.brs(1)', totalCrashes: 12, maxDevicesPerRow: 3 },
        { signature: 'pkg:/b.brs(2)', totalCrashes: 9, maxDevicesPerRow: 2 },
      ],
      {
        runDate: '2026-05-17',
        csvWindow: { start: '2026-05-12', end: '2026-05-17' },
      },
    );
    expect(body).toContain('Spike alert');
    expect(body).toContain('`m-global-constants-init-race`');
    expect(body).toContain('21'); // total
    expect(body).toContain('baseline **10/week**');
    expect(body).toContain('multiplier **2×**');
    expect(body).toContain('2.10×'); // ratio is toFixed(2)
    expect(body).toContain('pkg:/a.brs(1)');
    expect(body).toContain('pkg:/b.brs(2)');
  });
});

describe('resolveSourceLocations', () => {
  let dir;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'crash-report-srcmap-'));
    mkdirSync(join(dir, 'build-analysis', 'source'), { recursive: true });
    mkdirSync(join(dir, 'source'), { recursive: true });

    // Source .bs file the map points back to.
    writeFileSync(
      join(dir, 'source', 'foo.bs'),
      'sub bar()\n    print "line two"\n    print "line three"\nend sub\n',
    );

    // Transpiled .brs file present in build output.
    writeFileSync(
      join(dir, 'build-analysis', 'source', 'foo.brs'),
      'sub bar()\n    print "line two"\n    print "line three"\nend sub\n',
    );

    // Synthetic source map: build/source/foo.brs(N) → ../../source/foo.bs(N) for N=1..3.
    const gen = new SourceMapGenerator({ file: 'foo.brs' });
    for (let i = 1; i <= 3; i++) {
      gen.addMapping({
        source: '../../source/foo.bs',
        original: { line: i, column: 0 },
        generated: { line: i, column: 0 },
      });
    }
    writeFileSync(join(dir, 'build-analysis', 'source', 'foo.brs.map'), gen.toString());

    // A second .brs file with NO sibling .map (no-transpile fallback path).
    writeFileSync(
      join(dir, 'build-analysis', 'source', 'no-map.brs'),
      'sub baz()\n    return 42\nend sub\n',
    );
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('maps pkg:/source/foo.brs(2) back to source/foo.bs:2 via the source map', async () => {
    const result = await resolveSourceLocations(
      [{ pkgPath: 'pkg:/source/foo.brs', line: 2, signature: 'pkg:/source/foo.brs(2)' }],
      join(dir, 'build-analysis'),
      dir,
    );
    const loc = result.get('pkg:/source/foo.brs(2)');
    expect(loc).toBeTruthy();
    expect(loc.bsFile).toBe('source/foo.bs');
    expect(loc.bsLine).toBe(2);
    expect(loc.codeSnippet).toContain('line two');
  });

  it('falls back to 1:1 mapping (build-dir path) when destination file exists but has no source map', async () => {
    const result = await resolveSourceLocations(
      [{ pkgPath: 'pkg:/source/no-map.brs', line: 2, signature: 'sig-no-map' }],
      join(dir, 'build-analysis'),
      dir,
    );
    const loc = result.get('sig-no-map');
    expect(loc).toBeTruthy();
    expect(loc.bsFile).toBe('build-analysis/source/no-map.brs');
    expect(loc.bsLine).toBe(2);
  });

  it('returns null for a pkg path with neither a .map nor a destination .brs file', async () => {
    const result = await resolveSourceLocations(
      [{ pkgPath: 'pkg:/source/nonexistent.brs', line: 1, signature: 'sig-missing' }],
      join(dir, 'build-analysis'),
      dir,
    );
    expect(result.get('sig-missing')).toBe(null);
  });

  it('reuses one SourceMapConsumer across multiple signatures in the same .brs file', async () => {
    const result = await resolveSourceLocations(
      [
        { pkgPath: 'pkg:/source/foo.brs', line: 1, signature: 'sig-1' },
        { pkgPath: 'pkg:/source/foo.brs', line: 2, signature: 'sig-2' },
        { pkgPath: 'pkg:/source/foo.brs', line: 3, signature: 'sig-3' },
      ],
      join(dir, 'build-analysis'),
      dir,
    );
    expect(result.get('sig-1').bsLine).toBe(1);
    expect(result.get('sig-2').bsLine).toBe(2);
    expect(result.get('sig-3').bsLine).toBe(3);
  });
});

describe('resolveBacktraceFrames', () => {
  let dir;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'crash-report-backtrace-'));
    mkdirSync(join(dir, 'build-analysis', 'components'), { recursive: true });
    mkdirSync(join(dir, 'components'), { recursive: true });

    // Source .bs has 200 lines of comments — enough to satisfy any line lookup.
    writeFileSync(
      join(dir, 'components', 'captionTask.bs'),
      Array.from({ length: 200 }, (_, i) => `' source line ${i + 1}`).join('\n'),
    );
    writeFileSync(
      join(dir, 'build-analysis', 'components', 'captionTask.brs'),
      Array.from({ length: 350 }, (_, i) => `' transpiled line ${i + 1}`).join('\n'),
    );

    const gen = new SourceMapGenerator({ file: 'captionTask.brs' });
    for (const [g, o] of [
      [276, 124],
      [312, 155],
      [146, 72],
    ]) {
      gen.addMapping({
        source: '../../components/captionTask.bs',
        original: { line: o, column: 0 },
        generated: { line: g, column: 0 },
      });
    }
    writeFileSync(join(dir, 'build-analysis', 'components', 'captionTask.brs.map'), gen.toString());
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('resolves every frame and preserves frame metadata (index, function, args)', async () => {
    const frames = [
      {
        index: 2,
        function: 'toms',
        args: 't As Dynamic',
        returnType: '$1',
        pkgPath: 'pkg:/components/captionTask.brs',
        line: 276,
      },
      {
        index: 1,
        function: 'parsevtt',
        args: 'lines As Dynamic',
        returnType: '$1',
        pkgPath: 'pkg:/components/captionTask.brs',
        line: 312,
      },
      {
        index: 0,
        function: 'fetchcaption',
        args: '',
        returnType: '$1',
        pkgPath: 'pkg:/components/captionTask.brs',
        line: 146,
      },
    ];
    const resolved = await resolveBacktraceFrames(frames, join(dir, 'build-analysis'), dir);
    expect(resolved).toHaveLength(3);
    expect(resolved[0]).toMatchObject({
      index: 2,
      function: 'toms',
      args: 't As Dynamic',
      bsFile: 'components/captionTask.bs',
      bsLine: 124,
    });
    expect(resolved[1].bsLine).toBe(155);
    expect(resolved[2].bsLine).toBe(72);
  });

  it('flags unresolvable frames with bsFile/bsLine = null but keeps the frame in the array', async () => {
    const frames = [
      {
        index: 0,
        function: 'foo',
        args: '',
        returnType: 'Void',
        pkgPath: 'pkg:/does/not/exist.brs',
        line: 5,
      },
    ];
    const resolved = await resolveBacktraceFrames(frames, join(dir, 'build-analysis'), dir);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].bsFile).toBeNull();
    expect(resolved[0].bsLine).toBeNull();
    expect(resolved[0].function).toBe('foo');
  });
});

describe('draftIssueBody with backtrace', () => {
  const group = {
    function: 'toms',
    pkgPath: 'pkg:/components/captionTask.brs',
    line: 276,
    rawErrorText: 'Function toms(t As Dynamic) As Dynamic; pkg:/components/captionTask.brs(276)',
    versions: new Set(['2.17.0']),
    osReleases: new Set(['G1']),
    rows: [{ date: '2026-05-13', osRelease: 'G1', crashes: 5, devices: 3 }],
  };
  const source = {
    bsFile: 'components/captionTask.bs',
    bsLine: 124,
    codeSnippet: '    print "near crash site"',
  };
  const backtrace = {
    errorMessage:
      "'Dot' Operator attempted with invalid BrightScript Component or interface reference.",
    errorCode: '&hec',
    date: '2026-05-13',
    frames: [
      {
        index: 2,
        function: 'toms',
        args: 't As Dynamic',
        returnType: '$1',
        pkgPath: 'pkg:/components/captionTask.brs',
        line: 276,
      },
      {
        index: 0,
        function: 'fetchcaption',
        args: '',
        returnType: '$1',
        pkgPath: 'pkg:/components/captionTask.brs',
        line: 146,
      },
    ],
    locals: [{ raw: 't                roString val:"15:00,170?"' }],
  };
  const resolvedFrames = [
    { ...backtrace.frames[0], bsFile: 'components/captionTask.bs', bsLine: 124, codeSnippet: '' },
    { ...backtrace.frames[1], bsFile: 'components/captionTask.bs', bsLine: 72, codeSnippet: '' },
  ];

  it('renders runtime-error header, backtrace table, and local-variables block', () => {
    const body = draftIssueBody(group, source, 'unknown', {
      runDate: '2026-05-13',
      csvWindow: { start: '2026-05-11', end: '2026-05-17' },
      backtrace,
      resolvedFrames,
    });
    expect(body).toMatch(/Runtime error.*`&hec`/);
    expect(body).toMatch(/Dot' Operator attempted/);
    expect(body).toMatch(/Backtrace.*innermost frame first/);
    expect(body).toMatch(/\| 2 \| `toms\(t As Dynamic\) As \$1`/);
    expect(body).toMatch(/\| 0 \| `fetchcaption\(\) As \$1`/);
    expect(body).toMatch(/components\/captionTask\.bs:72/);
    expect(body).toMatch(/Local variables at crash time.*2026-05-13/);
    expect(body).toMatch(/val:"15:00,170\?"/);
  });

  it('omits the backtrace block when no backtrace is provided (back-compat)', () => {
    const body = draftIssueBody(group, source, 'unknown', {
      runDate: '2026-05-13',
      csvWindow: { start: '2026-05-11', end: '2026-05-17' },
    });
    expect(body).not.toMatch(/Backtrace.*innermost/);
    expect(body).not.toMatch(/Local variables/);
    expect(body).not.toMatch(/Runtime error/);
  });

  it('shows *unresolved* for backtrace frames whose source-map lookup failed', () => {
    const partiallyResolved = [
      { ...resolvedFrames[0] },
      { ...backtrace.frames[1], bsFile: null, bsLine: null, codeSnippet: '' },
    ];
    const body = draftIssueBody(group, source, 'unknown', {
      runDate: '2026-05-13',
      csvWindow: { start: '2026-05-11', end: '2026-05-17' },
      backtrace,
      resolvedFrames: partiallyResolved,
    });
    expect(body).toMatch(/\| 0 \|.*\*unresolved\*/);
  });
});

// ────────────────────────────────────────────────────────────────────
// CLI integration smoke tests (spawn the script as a subprocess).
// These cover the plan/execute orchestration without performing network or
// worktree side effects.

describe('CLI: plan subcommand', () => {
  let dir;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'crash-report-test-'));
    writeFileSync(join(dir, 'sample.csv'), SAMPLE_CSV);
  });
  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('errors with helpful message when input is missing', () => {
    const r = spawnScript('scripts/crash-report.js', ['plan']);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/--input/);
  });

  it('errors when input file is not a Roku crash CSV', () => {
    const bogusPath = join(dir, 'bogus.csv');
    writeFileSync(bogusPath, UNRELATED_CSV);
    const r = spawnScript('scripts/crash-report.js', ['plan', '--input', bogusPath, '--no-build']);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/Roku crash-report/i);
  });

  it('emits help text when invoked with no subcommand', () => {
    const r = spawnScript('scripts/crash-report.js', []);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/Usage:/);
    expect(r.stdout).toMatch(/plan --input/);
    expect(r.stdout).toMatch(/--dashboard-csv/);
    expect(r.stdout).toMatch(/execute --plan/);
  });

  it('accepts --dashboard-csv without error and merges into the plan', () => {
    const dashPath = join(dir, 'dashboard.csv');
    writeFileSync(dashPath, SAMPLE_DASHBOARD_CSV);
    const csvPath = join(dir, 'sample.csv');
    const r = spawnScript('scripts/crash-report.js', [
      'plan',
      '--input',
      csvPath,
      '--dashboard-csv',
      dashPath,
      '--no-build',
    ]);
    // --no-build skips builds → no source resolution → no backtrace resolution
    // (since both need a build dir). But the flag itself must parse cleanly
    // and the dashboard CSV must parse without throwing.
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/"actions":/);
  });

  it('errors clearly when --dashboard-csv points at a non-dashboard CSV', () => {
    const bogusPath = join(dir, 'bogus.csv');
    writeFileSync(bogusPath, UNRELATED_CSV);
    const csvPath = join(dir, 'sample.csv');
    const r = spawnScript('scripts/crash-report.js', [
      'plan',
      '--input',
      csvPath,
      '--dashboard-csv',
      bogusPath,
      '--no-build',
    ]);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/dashboard/i);
  });
});
