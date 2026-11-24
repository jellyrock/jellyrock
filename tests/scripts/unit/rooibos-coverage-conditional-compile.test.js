// The coverage processor in rooibos-roku must not emit a coverage call outside a function.
//
// A file-level `#if` wraps whole subs, and BrightScript rejects a bare call at file scope.
// rooibos-roku 6.0.0-alpha.56 wrote one there, and a local patch guarded it. The processor was
// rewritten upstream and no longer does, so this runs the installed plugin over a small fixture
// to notice if it comes back.

import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';
import { transpileWithPlugin } from './_helpers/transpile-with-plugin.js';

const require = createRequire(import.meta.url);
const { CodeCoverageProcessor } = require('rooibos-roku/dist/lib/rooibos/CodeCoverageProcessor');
const { FileFactory } = require('rooibos-roku/dist/lib/rooibos/FileFactory');

const FIXTURE = `#const perfTiming = true
#if perfTiming
sub timedStart()
  print "start"
end sub
#else
sub timedStart()
  print "no timing"
end sub
#end if

sub doWork()
  #if perfTiming
    print "inside then"
  #else
    print "inside else"
  #end if
end sub
`;

const COVERAGE_CALL = /RBS_CC_\d+_report\w+\(/;
const LINE_CALL = /RBS_CC_\d+_reportLine\(\d+\)/;

// Lines of the transpiled file that sit outside every sub, with directives ignored.
const fileLevelReportCalls = (code) => {
  let depth = 0;
  const found = [];
  for (const line of code.split('\n')) {
    const text = line.trim();
    if (/^(sub|function)\b/i.test(text)) depth++;
    else if (/^end (sub|function)\b/i.test(text)) depth--;
    else if (depth === 0 && COVERAGE_CALL.test(text)) found.push(text);
  }
  return found;
};

// The installed coverage processor, wired the way rooibos's own plugin wires it. The whole
// plugin needs a test project and a main sub, which this fixture has no use for.
const coveragePlugin = () => {
  let processor;
  return {
    name: 'coverage-only',
    beforeBuildProgram: (event) => {
      processor = new CodeCoverageProcessor(
        { options: { rooibos: { codeCoverage: true } }, program: event.program },
        new FileFactory(),
      );
      processor.onBeforeBuildProgram(event.program);
    },
    beforePrepareFile: (event) => processor.addCodeCoverage(event.file, event.editor),
  };
};

const transpile = async () => {
  const out = await transpileWithPlugin(coveragePlugin, { 'source/fixture.bs': FIXTURE }, {});
  return out['source/fixture.bs'];
};

describe('rooibos coverage of conditional compilation', () => {
  it('emits no coverage call at file level', async () => {
    const code = await transpile();
    expect(code).toContain('timedStart');
    // The file is instrumented at all: without this, an empty list below proves nothing.
    expect(code).toMatch(LINE_CALL);
    expect(fileLevelReportCalls(code)).toEqual([]);
  });

  it('still reports the live branch of a conditional compile inside a function', async () => {
    const code = await transpile();
    const doWork = code.slice(code.search(/sub doWork/i));
    expect(doWork).toMatch(new RegExp(`${LINE_CALL.source}\\s*\\n\\s*print "inside then"`));
  });

  it('still reports ordinary statements inside subs under a file-level #if', async () => {
    const code = await transpile();
    expect(code).toMatch(new RegExp(`${LINE_CALL.source}\\s*\\n\\s*print "start"`));
  });
});
