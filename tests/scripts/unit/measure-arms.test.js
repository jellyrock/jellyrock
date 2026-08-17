import { describe, expect, it } from 'vitest';
import {
  ARMS,
  armLabel,
  CalibrationError,
  blockSizes,
  formatPlanLines,
  parseCalibrationArgs,
  planBlocks,
  summariseCalibration,
} from '../../../scripts/measure-arms.js';

const ok = (argv) => parseCalibrationArgs(['--server', 'http://192.0.2.10:8096', ...argv]);

describe('ARMS', () => {
  it('turns ENABLE_RTA off in the plain arm, not just the component injection', () => {
    // The finding this whole design rests on: `injectTestingFiles: false` does NOT skip
    // RTA's `ENABLE_RTA=false` -> `true` staged-manifest rewrite (it sits outside that
    // option's `if`, RokuDevice.js:71-76), and `#if` is evaluated on the DEVICE. So an
    // arm that only drops the component still runs every `#if ENABLE_RTA` block and is
    // not the build the recorded baselines were taken on.
    expect(ARMS.plain.injectTestingFiles).toBe(false);
    expect(ARMS.plain.enableRta).toBe(false);
    expect(ARMS.rta.injectTestingFiles).toBe(true);
    expect(ARMS.rta.enableRta).toBe(true);
  });

  it('marks only the RTA arm as able to read its own identity', () => {
    expect(ARMS.rta.odcResident).toBe(true);
    expect(ARMS.plain.odcResident).toBe(false);
  });
});

describe('parseCalibrationArgs', () => {
  it('defaults to n=30 in blocks of 5', () => {
    expect(ok([])).toMatchObject({ samples: 30, blockSize: 5, noBuild: false });
  });

  it('REQUIRES --server, because the plain arm has no read to fall back on', () => {
    // Without a declaration the enclosure could only show the two brackets agreed with
    // EACH OTHER — which a device parked on the wrong server the whole run satisfies.
    expect(() => parseCalibrationArgs([])).toThrow(CalibrationError);
    expect(() => parseCalibrationArgs([])).toThrow(/--server <url> is required/);
  });

  it('refuses an unknown flag rather than dropping it', () => {
    expect(() => ok(['--sever', 'http://x'])).toThrow(/unknown argument/);
  });

  it('names --nav and --deploy in that refusal, since both are the plausible mistakes', () => {
    expect(() => ok(['--nav', 'settings'])).toThrow(/--nav is not accepted/);
    expect(() => ok(['--deploy'])).toThrow(/--deploy/);
  });

  it('refuses a value flag with no value', () => {
    expect(() => ok(['--block-size'])).toThrow(/needs a value/);
  });

  it.each([
    ['-n', '0'],
    ['-n', '2.5'],
    ['--block-size', 'five'],
  ])('refuses %s %s', (flag, value) => {
    expect(() => ok([flag, value])).toThrow(/must be a positive integer/);
  });

  it('refuses a block size that would run all of one arm before the other', () => {
    // One block per arm is not an interleave: everything that drifts with time lands
    // entirely on the second arm and cannot be told from the effect under test.
    expect(() => ok(['-n', '10', '--block-size', '10'])).toThrow(/all of one arm/);
    expect(() => ok(['-n', '10', '--block-size', '10'])).toThrow(/--block-size 5 or smaller/);
  });

  it('accepts exactly two blocks per arm, the point at which it becomes an interleave', () => {
    expect(ok(['-n', '10', '--block-size', '5'])).toMatchObject({ samples: 10, blockSize: 5 });
  });
});

describe('blockSizes', () => {
  it('splits evenly when it divides', () => {
    expect(blockSizes(30, 5)).toEqual([5, 5, 5, 5, 5, 5]);
  });

  it('puts the remainder in the last block rather than padding the series', () => {
    // The operator asked for 30 samples; rounding up to 32 is the kind of change that is
    // found months later in the `requested` field.
    expect(blockSizes(30, 4)).toEqual([4, 4, 4, 4, 4, 4, 4, 2]);
    expect(blockSizes(30, 4).reduce((a, b) => a + b, 0)).toBe(30);
  });
});

describe('planBlocks', () => {
  const blocks = planBlocks({ samples: 30, blockSize: 5 });

  it('alternates, starting with the RTA arm', () => {
    expect(blocks.map((b) => b.arm)).toEqual([
      'rta',
      'plain',
      'rta',
      'plain',
      'rta',
      'plain',
      'rta',
      'plain',
      'rta',
      'plain',
      'rta',
      'plain',
    ]);
  });

  it('gives both arms exactly n — the closing bracket comes from the restore deploy', () => {
    const per = (arm) =>
      blocks.filter((b) => b.arm === arm).reduce((total, b) => total + b.count, 0);
    expect(per('rta')).toBe(30);
    expect(per('plain')).toBe(30);
  });

  it('puts an RTA block before every plain one, so each has a bracket on both sides', () => {
    blocks.forEach((block, i) => {
      if (block.arm !== 'plain') return;
      expect(blocks[i - 1].arm).toBe('rta');
    });
  });

  it('numbers each plain block with its own enclosure and leaves RTA blocks null', () => {
    expect(blocks.filter((b) => b.arm === 'plain').map((b) => b.enclosure)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
    expect(blocks.filter((b) => b.arm === 'rta').every((b) => b.enclosure === null)).toBe(true);
  });
});

describe('formatPlanLines', () => {
  it('states both arms and the server before anything touches the device', () => {
    const lines = formatPlanLines(planBlocks({ samples: 10, blockSize: 5 }), {
      samples: 10,
      server: 'http://192.0.2.10:8096',
    }).join('\n');
    expect(lines).toMatch(/ENABLE_RTA=false/);
    expect(lines).toMatch(/ENABLE_RTA=true/);
    expect(lines).toMatch(/http:\/\/192\.0\.2\.10:8096/);
  });
});

describe('summariseCalibration', () => {
  const row = (over = {}) => ({
    index: 0,
    arm: 'rta',
    count: 5,
    status: 0,
    published: true,
    reason: null,
    ...over,
  });

  it('passes only when every block published AND both arms are represented', () => {
    const both = [row(), row({ index: 1, arm: 'plain' })];
    expect(summariseCalibration(both).ok).toBe(true);
  });

  it('FAILS a run that published only one arm', () => {
    // Six clean RTA blocks and no plain ones is not a calibration, and without this it
    // would report itself as a clean pass.
    expect(summariseCalibration([row(), row({ index: 1 })]).ok).toBe(false);
  });

  it('fails, counts and NAMES a withheld block', () => {
    const summary = summariseCalibration([
      row(),
      row({ index: 1, arm: 'plain', published: false, reason: 'the brackets disagree' }),
    ]);
    expect(summary.ok).toBe(false);
    expect(summary.withheld).toBe(1);
    expect(summary.lines.join('\n')).toMatch(/NOT PUBLISHED — the brackets disagree/);
    expect(summary.lines.join('\n')).toMatch(/1 of 2 block\(s\) were withheld/);
  });

  it('fails an empty run rather than reporting nothing as success', () => {
    expect(summariseCalibration([]).ok).toBe(false);
  });
});

describe('--label — keeping two calibration runs from pooling', () => {
  it('suffixes both arm labels', () => {
    expect(armLabel('rta', 'smoke')).toBe('rta-smoke');
    expect(armLabel('plain', 'smoke')).toBe('plain-smoke');
  });

  it('leaves the bare arm id when no label was given', () => {
    // `measure:compare` selects by arm label across the WHOLE ledger, so an unlabelled
    // re-run merges into the previous one — the mixed-population failure this subsystem
    // refuses everywhere else, reachable through a default.
    expect(armLabel('rta', undefined)).toBe('rta');
    expect(ok([]).label).toBeUndefined();
  });

  it('accepts a label and carries it', () => {
    expect(ok(['--label', 'smoke']).label).toBe('smoke');
  });

  it('refuses a label the selector grammar cannot name', () => {
    expect(() => ok(['--label', 'a,b'])).toThrow(/may not contain/);
    expect(() => ok(['--label', 'a=b'])).toThrow(/may not contain/);
  });
});
