import { describe, it, expect } from 'vitest';
import {
  createSummaryCollector,
  unaccountedTests,
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
