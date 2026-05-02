// Tier 2 coverage for the roku-log plugin.
//
// Each scenario feeds inline .bs/.xml source through transpileWithPlugin
// and asserts on the transpiled string. Configuration flows through Program
// options as `rokuLog`, which the plugin reads in beforeBuildProgram.
//
// See `scripts/bsc-plugins/roku-log.cjs` for the plugin under test.

import { describe, it, expect } from 'vitest';
import { transpileWithPlugin } from '../_helpers/transpile-with-plugin.js';
import rokuLogPlugin from '../../../../scripts/bsc-plugins/roku-log.cjs';

describe('roku-log plugin (Tier 2)', () => {
  describe('strip', () => {
    it('strips m.log.* calls by default', async () => {
      const out = await transpileWithPlugin(rokuLogPlugin, {
        'source/foo.bs': `
          sub init()
            m.log.info("hello")
          end sub
        `,
      });
      expect(out['source/foo.bs']).not.toMatch(/m\.log\.info/);
    });

    it('preserves m.log.* calls when strip is false', async () => {
      const out = await transpileWithPlugin(
        rokuLogPlugin,
        {
          'source/foo.bs': `
            sub init()
              m.log.info("hi")
            end sub
          `,
        },
        { rokuLog: { strip: false, insertPkgPath: false, guard: false, removeComments: false } },
      );
      expect(out['source/foo.bs']).toMatch(/m\.log\.info\(\s*"hi"\s*\)/);
    });
  });

  describe('insertPkgPath', () => {
    it('prepends a source-location string to known log levels', async () => {
      const out = await transpileWithPlugin(
        rokuLogPlugin,
        {
          'source/foo.bs': `
            sub init()
              m.log.info("hi")
            end sub
          `,
        },
        { rokuLog: { strip: false, insertPkgPath: true, guard: false, removeComments: false } },
      );
      // SourceLocationLiteral transpiles to `"file" + ":///<absolute>:<line>"`.
      // We just need to confirm a source-location literal was prepended ahead
      // of the original "hi" arg.
      expect(out['source/foo.bs']).toMatch(/m\.log\.info\([^)]*source\/foo\.bs[^)]*"hi"\s*\)/);
    });

    it('does not prepend for unknown log levels', async () => {
      const out = await transpileWithPlugin(
        rokuLogPlugin,
        {
          'source/foo.bs': `
            sub init()
              m.log.unknown("x")
            end sub
          `,
        },
        { rokuLog: { strip: false, insertPkgPath: true, guard: false, removeComments: false } },
      );
      // Unknown level should keep its single arg, no source-location prepend
      expect(out['source/foo.bs']).toMatch(/m\.log\.unknown\(\s*"x"\s*\)/);
      expect(out['source/foo.bs']).not.toMatch(/m\.log\.unknown\(\s*"pkg:/);
    });
  });

  describe('guard', () => {
    it('wraps m.log.* calls in if m.__le = true then ... end if', async () => {
      // Combine with insertPkgPath so the plugin's visitedLines dedup fires
      // — see tech-debt.md#roku-log-guard-without-pkgpath-recurses. Asserting
      // on both behaviors here doubles as a combined-mode check.
      const out = await transpileWithPlugin(
        rokuLogPlugin,
        {
          'source/foo.bs': `
            sub init()
              m.log.info("hi")
            end sub
          `,
        },
        { rokuLog: { strip: false, insertPkgPath: true, guard: true, removeComments: false } },
      );
      expect(out['source/foo.bs']).toMatch(
        /if\s+m\.__le\s*=\s*true\s+then[\s\S]*m\.log\.info[\s\S]*end if/i,
      );
      expect(out['source/foo.bs']).toMatch(/m\.log\.info\([^)]*source\/foo\.bs[^)]*"hi"\s*\)/);
    });

    it('injects m.__le = m.log.enabled after `m.log = new log.Logger(...)`', async () => {
      const out = await transpileWithPlugin(
        rokuLogPlugin,
        {
          'source/foo.bs': `
            sub init()
              m.log = new log.Logger("Foo")
            end sub
          `,
        },
        { rokuLog: { strip: false, insertPkgPath: false, guard: false, removeComments: false } },
      );
      expect(out['source/foo.bs']).toMatch(/m\.__le\s*=\s*m\.log\.enabled/);
    });

    it('injects m.__le = m.log.enabled after `m.log = log.Logger(...)` factory form', async () => {
      const out = await transpileWithPlugin(
        rokuLogPlugin,
        {
          'source/foo.bs': `
            sub init()
              m.log = log.Logger("Foo")
            end sub
          `,
        },
        { rokuLog: { strip: false, insertPkgPath: false, guard: false, removeComments: false } },
      );
      expect(out['source/foo.bs']).toMatch(/m\.__le\s*=\s*m\.log\.enabled/);
    });
  });

  describe('removeComments', () => {
    it('strips comments from .brs output by default', async () => {
      const out = await transpileWithPlugin(rokuLogPlugin, {
        'source/foo.bs': `
          sub init()
            ' this comment should be stripped
            print "hello"
          end sub
        `,
      });
      expect(out['source/foo.bs']).not.toMatch(/this comment should be stripped/);
    });

    it('strips comments from .xml output by default', async () => {
      const out = await transpileWithPlugin(rokuLogPlugin, {
        'components/Foo.xml': `<?xml version="1.0" encoding="utf-8" ?>
<component name="Foo" extends="Group">
  <!-- this xml comment should be stripped -->
  <interface></interface>
</component>
        `,
      });
      expect(out['components/Foo.xml']).not.toMatch(/this xml comment should be stripped/);
      expect(out['components/Foo.xml']).not.toMatch(/<!--/);
    });

    it('preserves comments when removeComments is false', async () => {
      const out = await transpileWithPlugin(
        rokuLogPlugin,
        {
          'source/foo.bs': `
            sub init()
              ' keep this comment
              print "hello"
            end sub
          `,
        },
        { rokuLog: { strip: true, insertPkgPath: false, guard: false, removeComments: false } },
      );
      expect(out['source/foo.bs']).toMatch(/keep this comment/);
    });
  });
});
