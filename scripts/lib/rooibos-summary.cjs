// Reads the summary Rooibos's console reporter prints at the end of a device test
// run, and says how many counted tests it never reported.
//
// `Total` counts every test that ran, but unpatched Rooibos (6.0.0-alpha.55 and
// alpha.56) prints `Ignored` from a build-time count that leaves out a test `@ignore`d
// on its own (an ignored group or suite IS counted), so such a test appears in `Total`
// and in no other line, and the run still reads as a clean pass. `patches/rooibos-roku+*.patch`
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

/**
 * Marks the manifest's `title=` value with this run's id. The device prints the
 * sideloaded app's title in its `Running dev` line, which is how the runner tells this
 * run's output from a replay of the previous app's.
 */
function stampManifestTitle(manifestText, runId) {
  const titleLine = /^(title=.*?)[ \t]*(\r?)$/m;
  if (!titleLine.test(manifestText)) {
    throw new Error('manifest has no title= line to stamp');
  }
  return manifestText.replace(titleLine, `$1 run-${runId}$2`);
}

/**
 * Says which console lines belong to this run. The Roku replays its buffer when the
 * console connects, so lines from the previous app can arrive first. Nothing counts
 * until the `Running dev` line carrying this run's stamped title appears.
 */
function createRunGate(runId) {
  const marker = new RegExp(`^------ Running dev '.* run-${runId}' main ------`);
  let open = false;
  return {
    accepts(line) {
      if (open) return true;
      if (marker.test(line.trim())) open = true;
      return open;
    },
  };
}

module.exports = { createSummaryCollector, unaccountedTests, stampManifestTitle, createRunGate };
