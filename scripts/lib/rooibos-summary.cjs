// Reads the summary Rooibos's console reporter prints at the end of a device test
// run, and says how many counted tests it never reported.
//
// `Total` counts every test that ran, but unpatched Rooibos (6.0.0-alpha.55) prints
// `Ignored` from a build-time count that leaves out a test `@ignore`d on its own — an
// ignored group or suite IS counted — so such a test appears in `Total` and in no
// other line, and the run still reads as a clean pass. `patches/rooibos-roku+*.patch`
// makes the reporter print the runtime count; this check notices if anything ever
// leaves a counted test unreported again.

const SUMMARY_LINE = /^\s*(Total|Passed|Crashed|Failed|Ignored):\s*(\d+)\s*$/;
const FIELDS = ['total', 'passed', 'crashed', 'failed', 'ignored'];

/**
 * Collects summary fields from console lines as they arrive. The last value seen
 * wins, so a test that happens to print "Total: 5" cannot shadow the real summary.
 */
function createSummaryCollector() {
  const fields = {};
  return {
    addLine(line) {
      const match = SUMMARY_LINE.exec(line);
      if (match) fields[match[1].toLowerCase()] = Number(match[2]);
    },
    /** The summary, or null when the run never printed a complete one. */
    summary() {
      return FIELDS.every((key) => key in fields) ? { ...fields } : null;
    },
  };
}

/**
 * Tests counted in `total` but reported as none of passed / crashed / failed /
 * ignored. Negative when `ignored` over-counts (unpatched Rooibos adds 1 for an ignored suite
 * on top of its tests), which hides nothing.
 */
function unaccountedTests({ total, passed, crashed, failed, ignored }) {
  return total - (passed + crashed + failed + ignored);
}

module.exports = { createSummaryCollector, unaccountedTests };
