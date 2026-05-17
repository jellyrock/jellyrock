// Vitest unit tests for scripts/crash-report.js.
//
// Tests are grouped by the pipeline stage they cover (parse → group →
// threshold → categorize → draft → dedup-search → CLI). Side effects (worktree
// build, GH writes) are exercised via injected fakes (gitExec, ghExec) so
// nothing in this suite shells out or touches the network.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnScript } from './_helpers/spawn-script.js';

import {
  REQUIRED_CSV_HEADERS,
  DEFAULT_MIN_DEVICES,
  DEFAULT_MIN_DATES,
  validateRokuCrashCsv,
  parseCsv,
  mergeCsvs,
  parseErrorText,
  groupBySignature,
  applyThreshold,
  inferCategory,
  resolveVersionTag,
  draftIssueTitle,
  draftIssueBody,
  draftDedupComment,
  draftRegressionComment,
  draftDedupSearchQuery,
  searchExistingIssues,
  renderRunSummary,
  parseArgs,
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
    expect(r.stdout).toMatch(/execute --plan/);
  });
});
