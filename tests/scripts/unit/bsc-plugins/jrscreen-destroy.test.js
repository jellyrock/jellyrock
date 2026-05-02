// Prototype test for the jrscreen-destroy plugin.
//
// Goal of THIS file: validate the harness pattern works end-to-end. Once
// proven, expand to full scenario coverage (every rule path + every escape
// hatch) per the redlined plan.

import { describe, it, expect } from 'vitest';
import { runPluginOnSource, diagnosticsByCode } from '../_helpers/run-plugin.js';
import jrscreenDestroyPlugin from '../../../../scripts/bsc-plugins/jrscreen-destroy.cjs';

const DIAGNOSTIC_CODE = 'jrscreen-destroy-required';

describe('jrscreen-destroy', () => {
  it('flags a JRScreen subclass whose codebehind has no destroy()', () => {
    const diagnostics = runPluginOnSource(jrscreenDestroyPlugin, {
      'components/TestScreen.xml': `<?xml version="1.0" encoding="utf-8" ?>
<component name="TestScreen" extends="JRScreen">
  <script type="text/brightscript" uri="TestScreen.bs" />
</component>`,
      'components/TestScreen.bs': `
        sub init()
          ' intentionally missing destroy()
        end sub
      `,
    });
    const flagged = diagnosticsByCode(diagnostics, DIAGNOSTIC_CODE);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].message).toMatch(/TestScreen/);
  });

  it('does not flag a JRScreen subclass whose codebehind declares destroy()', () => {
    const diagnostics = runPluginOnSource(jrscreenDestroyPlugin, {
      'components/TestScreen.xml': `<?xml version="1.0" encoding="utf-8" ?>
<component name="TestScreen" extends="JRScreen">
  <script type="text/brightscript" uri="TestScreen.bs" />
</component>`,
      'components/TestScreen.bs': `
        sub init()
        end sub
        sub destroy()
          ' nothing to release in this synthetic test
        end sub
      `,
    });
    const flagged = diagnosticsByCode(diagnostics, DIAGNOSTIC_CODE);
    expect(flagged).toHaveLength(0);
  });
});
