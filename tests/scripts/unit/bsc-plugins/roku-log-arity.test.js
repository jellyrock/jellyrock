// Tests for the roku-log plugin's call-arity check.
//
// Plugin under test: scripts/bsc-plugins/roku-log.cjs
// Diagnostic code: log-too-many-values
//
// The roku-log runtime takes `message` plus nine values per level function, and
// the build prepends a file-and-line argument, so a source call may pass the
// message plus at most eight values. A ninth is a runtime "Wrong number of
// function parameters" crash that the compiler never reports.

import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { runPluginOnSource, diagnosticsByCode } from '../_helpers/run-plugin.js';
import rokuLogPlugin from '../../../../scripts/bsc-plugins/roku-log.cjs';

const CODE = 'log-too-many-values';

/** A call `<target>.<level>("msg", 1, 2, ...)` with `values` values after the message. */
function callWith(target, level, values) {
  const args = ['"msg"', ...Array.from({ length: values }, (_, i) => String(i + 1))];
  return `${target}.${level}(${args.join(', ')})`;
}

function check(statement, path = 'components/Foo.bs') {
  const source = `
    sub init()
      ${statement}
    end sub
  `;
  return diagnosticsByCode(runPluginOnSource(rokuLogPlugin, { [path]: source }), CODE);
}

describe('roku-log call arity', () => {
  const levels = ['debug', 'verbose', 'info', 'warn', 'error'];

  it.each(levels)('passes m.log.%s with the message and 8 values', (level) => {
    expect(check(callWith('m.log', level, 8))).toHaveLength(0);
  });

  it.each(levels)('fails m.log.%s with the message and 9 values', (level) => {
    const found = check(callWith('m.log', level, 9));
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe(1);
    expect(found[0].message).toContain('has 9 values after the message');
    expect(found[0].message).toContain('the limit is 8 values');
  });

  it('fails a call with 10 values (the crash seen on a Roku Ultra)', () => {
    expect(check(callWith('m.log', 'info', 10))).toHaveLength(1);
  });

  it('leaves a call that is not on m.log alone', () => {
    expect(check(callWith('m.other', 'info', 12))).toHaveLength(0);
    expect(check(callWith('logger', 'info', 12))).toHaveLength(0);
  });

  it('leaves a method that is not a log level alone', () => {
    expect(check(callWith('m.log', 'increaseIndent', 12))).toHaveLength(0);
  });

  it('honors a same-line suppression marker', () => {
    expect(check(`${callWith('m.log', 'info', 9)} ' bsc-disable-line ${CODE}`)).toHaveLength(0);
  });

  it('honors a next-line suppression marker', () => {
    expect(
      check(`' bsc-disable-next-line ${CODE}\n      ${callWith('m.log', 'info', 9)}`),
    ).toHaveLength(0);
  });

  it('ignores a whole-file suppression marker', () => {
    const source = `' bsc-disable-file ${CODE}
    sub init()
      ${callWith('m.log', 'info', 9)}
    end sub
  `;
    const found = diagnosticsByCode(
      runPluginOnSource(rokuLogPlugin, { 'components/Foo.bs': source }),
      CODE,
    );
    expect(found).toHaveLength(1);
  });

  it('keeps its limit in step with the logger', () => {
    // A missing file fails rather than skips: moving the logger is the drift this
    // test exists to catch.
    const source = 'source/logging/LogMixin.bs';
    expect(fs.existsSync(source), `${source} is missing`).toBe(true);
    const text = fs.readFileSync(source, 'utf8');
    for (const level of rokuLogPlugin.LOG_LEVELS) {
      const signature = text.match(new RegExp(`(?:sub|function) ${level}\\(([^)]*)\\)`));
      expect(signature, level).not.toBeNull();
      expect(signature[1].split(',').length, level).toBe(rokuLogPlugin.LOG_FUNCTION_PARAMS);
    }
  });
});
