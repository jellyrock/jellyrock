// The coverage build must transpile a local variable the way the normal build does.
//
// BrighterScript finds a local by statement position: while validating it records where in a
// block each local becomes known. The coverage processor then inserts a line-report call before
// each statement, which shifts every later statement. Unpatched, a statement could end up where
// its local was not known yet, and a local that shares its name with a namespace member was
// written as that member (`user.settings.x` as `user_settings_x`), which fails on the device.
// `patches/rooibos-roku+*.patch` makes each statement keep answering with the position it had
// before the calls went in. Each fixture is a shape that crashed `npm run test:complete`.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { Program } from 'brighterscript';

const require = createRequire(import.meta.url);
const { CodeCoverageProcessor } = require('rooibos-roku/dist/lib/rooibos/CodeCoverageProcessor');
const { FileFactory } = require('rooibos-roku/dist/lib/rooibos/FileFactory');

const SESSION = `namespace user
  sub Login()
  end sub
end namespace
namespace user.settings
  sub Save(name as string, value as string)
  end sub
end namespace
`;

// A local `user` beside the `user.settings` namespace, read in a one-line `if` late enough in
// the function for the inserted calls to push its definition past the `if`'s recorded position.
const HOOKS = `namespace hooks
  function groupModes() as dynamic
    manager = m.global.syncPlayManager
    if not isValid(manager) or manager.following <> true then return invalid
    sync = manager.sync
    if not isValid(sync) then return invalid
    offsetMs = 0
    user = m.global.user
    if isValid(user) and isValid(user.settings) and isValid(user.settings.playbackOffsetMs) then offsetMs = user.settings.playbackOffsetMs
    return offsetMs
  end function
end namespace
`;

// A local `isWanted` beside the namespace's own `isWanted()`, written in a loop that follows an
// early return.
const GUIDE = `namespace guide
  function isWanted(block as integer, wanted as object) as boolean
    return true
  end function

  function evictions(held as object, wanted as object, cap as integer) as object
    excess = held.count() - cap
    if excess <= 0 then return []

    isWanted = {}
    for each block in wanted
      isWanted[block.toStr()] = true
    end for

    dropped = []
    for each key in held
      if not isWanted.DoesExist(key)
        dropped.push(key)
      end if
    end for
    return dropped
  end function

  function earlyExit(held as object) as integer
    count = 0
    for each key in held
      if count > 2 then exit for
      count++
    end for
    return count
  end function
end namespace
`;

// Validates first, as a real build does: the positions the processor disturbs are recorded then.
const transpile = async (files, target, withCoverage) => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jellyrock-coverage-names-'));
  try {
    const program = new Program({ rootDir: '/tmp/jellyrock-coverage-names', outDir });
    if (withCoverage) {
      const processor = new CodeCoverageProcessor(
        { options: { rooibos: { isRecordingCodeCoverage: true } } },
        new FileFactory(),
      );
      program.plugins.add({
        name: 'coverage-only',
        prepareFile: (event) => processor.addCodeCoverage(event.file, event.editor),
      });
    }
    for (const [pkgPath, content] of Object.entries(files)) {
      program.setFile(pkgPath, content);
    }
    await program.validate();
    return (await program.getTranspiledFileContents(target)).code;
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
};

const REPORT_LINE = /^\s*RBS_CC_\d+_reportLine\("\d+", \d+\)\s*$/;

// The function's own lines with the bare coverage calls dropped, trimmed.
const bodyOf = (code, functionName) => {
  const lines = code.split('\n');
  const start = lines.findIndex((line) =>
    new RegExp(`^function ${functionName}\\(`, 'i').test(line),
  );
  const end = lines.findIndex((line, index) => index > start && /^end function/i.test(line));
  return lines
    .slice(start, end + 1)
    .filter((line) => !REPORT_LINE.test(line))
    .map((line) => line.trim());
};

describe('rooibos coverage keeps local variable names', () => {
  it('reads a local named like a namespace as the local, in a one-line if', async () => {
    const files = { 'source/session.bs': SESSION, 'source/hooks.bs': HOOKS };
    const plain = await transpile(files, 'source/hooks.bs', false);
    const covered = await transpile(files, 'source/hooks.bs', true);

    expect(plain).toContain('offsetMs = user.settings.playbackOffsetMs');
    expect(covered).toContain('offsetMs = user.settings.playbackOffsetMs');
    expect(covered).not.toContain('user_settings_playbackOffsetMs');
  });

  it('writes a local named like a sibling function as the local, in a loop', async () => {
    const files = { 'source/guide.bs': GUIDE };
    const plain = await transpile(files, 'source/guide.bs', false);
    const covered = await transpile(files, 'source/guide.bs', true);

    expect(plain).toContain('isWanted[block.toStr()] = true');
    expect(covered).toContain('isWanted[block.toStr()] = true');
    expect(covered).not.toContain('guide_isWanted[');
  });

  it('still reports each statement before it runs', async () => {
    const covered = await transpile({ 'source/guide.bs': GUIDE }, 'source/guide.bs', true);
    const lines = covered.split('\n').map((line) => line.trim());
    const callBefore = (text) => REPORT_LINE.test(lines[lines.indexOf(text) - 1] ?? '');

    expect(lines).toContain('return dropped');
    expect(callBefore('return dropped')).toBe(true);
    expect(callBefore('dropped = []')).toBe(true);
    expect(callBefore('count++')).toBe(true);
  });

  it('changes nothing in the function but the coverage calls', async () => {
    const files = { 'source/guide.bs': GUIDE };
    const plain = bodyOf(await transpile(files, 'source/guide.bs', false), 'guide_earlyExit');
    const covered = bodyOf(await transpile(files, 'source/guide.bs', true), 'guide_earlyExit');
    const unwrapped = covered.map((line) =>
      line
        .replace(/RBS_CC_\d+_reportLine\("\d+", \d+\) and \((.*)\)( then)?$/, '$1$2')
        .replace(/^RBS_CC_\d+_reportLine\("\d+", \d+\): /, ''),
    );

    expect(unwrapped).toEqual(plain);
  });
});
