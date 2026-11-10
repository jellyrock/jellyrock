// The coverage processor in rooibos-roku must not emit a line-report call outside a function.
//
// A file-level `#if` wraps whole subs. The unpatched processor put a bare
// `RBS_CC_<id>_reportLine(...)` as the first statement of each branch of every `#if`, which
// BrightScript rejects at file scope. `patches/rooibos-roku+*.patch` guards it: only a `#if`
// inside a function gets the call. Runs the installed plugin over a small fixture.

import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';
import { transpileWithPlugin } from './_helpers/transpile-with-plugin.js';

const require = createRequire(import.meta.url);
const { CodeCoverageProcessor } = require('rooibos-roku/dist/lib/rooibos/CodeCoverageProcessor');
const { FileFactory } = require('rooibos-roku/dist/lib/rooibos/FileFactory');

const FIXTURE = `#if perfTiming
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

const REPORT_CALL = /RBS_CC_\d+_reportLine\("?\d+"?, 4\)/;

// Lines of the transpiled file that sit outside every sub, with directives ignored.
const fileLevelReportCalls = (code) => {
  let depth = 0;
  const found = [];
  for (const line of code.split('\n')) {
    const text = line.trim();
    if (/^(sub|function)\b/i.test(text)) depth++;
    else if (/^end (sub|function)\b/i.test(text)) depth--;
    else if (depth === 0 && REPORT_CALL.test(text)) found.push(text);
  }
  return found;
};

// The installed coverage processor, run on each file the way rooibos's plugin runs it. The whole
// plugin needs a test project and a main sub, which this fixture has no use for.
const coveragePlugin = () => {
  const processor = new CodeCoverageProcessor(
    { options: { rooibos: { isRecordingCodeCoverage: true } } },
    new FileFactory(),
  );
  return {
    name: 'coverage-only',
    prepareFile: (event) => processor.addCodeCoverage(event.file, event.editor),
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
    expect(fileLevelReportCalls(code)).toEqual([]);
  });

  it('still reports a conditional compile inside a function, in both branches', async () => {
    const code = await transpile();
    const doWork = code.slice(code.search(/sub doWork/i));
    expect(doWork.match(new RegExp(REPORT_CALL.source, 'g'))?.length).toBe(2);
  });

  it('still reports ordinary statements inside subs under a file-level #if', async () => {
    const code = await transpile();
    expect(code).toMatch(/RBS_CC_\d+_reportLine\("?\d+"?, 1\)\s*\n\s*print "start"/);
  });
});
