import { describe, it, expect } from 'vitest';
import {
  createSummaryCollector,
  unaccountedTests,
  stampManifestTitle,
  createRunGate,
} from '../../../../scripts/lib/rooibos-summary.cjs';

// The shape Rooibos's console reporter prints (leading spaces included; the runner
// has already stripped the Roku console's trailing \r).
const summaryLines = ({ total, passed, crashed = 0, failed = 0, ignored = 0 }) => [
  ` Total: ${total}`,
  `   Passed: ${passed}`,
  `   Crashed: ${crashed}`,
  `   Failed: ${failed}`,
  `   Ignored: ${ignored}`,
  '   Time: 874ms',
];

const collect = (lines) => {
  const collector = createSummaryCollector();
  for (const line of lines) collector.addLine(line);
  return collector.summary();
};

describe('createSummaryCollector', () => {
  it('reads the summary block', () => {
    expect(collect(summaryLines({ total: 26, passed: 24, ignored: 2 }))).toEqual({
      total: 26,
      passed: 24,
      crashed: 0,
      failed: 0,
      ignored: 2,
    });
  });

  it('returns null when the run never printed a complete summary', () => {
    expect(collect([' Total: 26', '   Passed: 24'])).toBeNull();
    expect(collect([])).toBeNull();
  });

  it('keeps the last value, so test output mid-run cannot shadow the summary', () => {
    const lines = ['Total: 5', ...summaryLines({ total: 26, passed: 26 })];
    expect(collect(lines).total).toBe(26);
  });

  it('ignores lines that merely mention a field', () => {
    const lines = [
      '  |--Failed: retries once : ..PASS (0ms)',
      ...summaryLines({ total: 3, passed: 3 }),
    ];
    expect(collect(lines).failed).toBe(0);
  });
});

describe('unaccountedTests', () => {
  it('is 0 when every counted test is reported', () => {
    expect(unaccountedTests({ total: 26, passed: 24, crashed: 0, failed: 0, ignored: 2 })).toBe(0);
  });

  it("counts tests Rooibos left out of every line (individually @ignore'd)", () => {
    // CI device run 35406738967: two individually ignored tests, reported as Ignored: 0.
    expect(unaccountedTests({ total: 3890, passed: 3888, crashed: 0, failed: 0, ignored: 0 })).toBe(
      2,
    );
  });

  it('is negative when Ignored over-counts an ignored suite, which hides nothing', () => {
    expect(unaccountedTests({ total: 10, passed: 7, crashed: 0, failed: 0, ignored: 4 })).toBe(-1);
  });
});

const manifest = [
  '## Channel Details',
  '',
  'title=JellyRock',
  'major_version=3',
  '',
  '### title=Commented out',
  '',
].join('\n');

describe('stampManifestTitle', () => {
  it('suffixes only the title line', () => {
    const stamped = stampManifestTitle(manifest, 'ab12cd34');
    expect(stamped).toBe(manifest.replace('title=JellyRock\n', 'title=JellyRock run-ab12cd34\n'));
  });

  it('ignores a commented title line', () => {
    const text = '### title=Nope\ntitle=App\n';
    expect(stampManifestTitle(text, 'x1')).toBe('### title=Nope\ntitle=App run-x1\n');
  });

  it('throws when the manifest has no title', () => {
    expect(() => stampManifestTitle('### title=Nope\nmajor_version=3\n', 'x1')).toThrow(/title/);
  });
});

describe('createRunGate', () => {
  const stale = [
    "------ Running dev 'JellyRock run-00000000' main ------",
    '[Rooibos Result]: PASS',
    ' Total: 5',
    '[Rooibos Shutdown]',
  ];

  it('accepts nothing from a stale replay', () => {
    const gate = createRunGate('ab12cd34');
    expect(stale.map((line) => gate.accepts(line))).toEqual([false, false, false, false]);
  });

  it('rejects an older Running dev line with no run id', () => {
    const gate = createRunGate('ab12cd34');
    expect(gate.accepts("------ Running dev 'JellyRock' main ------")).toBe(false);
    expect(gate.accepts('[Rooibos Result]: PASS')).toBe(false);
  });

  it('opens on this run and accepts what follows', () => {
    const gate = createRunGate('ab12cd34');
    const lines = [
      ...stale,
      "------ Running dev 'JellyRock run-ab12cd34' main ------",
      '[Rooibos Result]: FAIL',
    ];
    expect(lines.map((line) => gate.accepts(line))).toEqual([
      false,
      false,
      false,
      false,
      true,
      true,
    ]);
  });

  it('does not depend on the title prefix', () => {
    const gate = createRunGate('ab12cd34');
    expect(gate.accepts("------ Running dev 'Other Name run-ab12cd34' main ------")).toBe(true);
  });
});
