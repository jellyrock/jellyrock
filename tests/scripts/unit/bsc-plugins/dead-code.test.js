// Tests for the dead-code plugin.
//
// Plugin under test: scripts/bsc-plugins/dead-code.cjs
// Diagnostic codes: dead-code, dead-code-keep, dead-code-baseline
//
// The plugin is a build-failing gate, so a false positive blocks correct work.
// Most scenarios here pin one way SceneGraph reaches code BY NAME (a string, an
// XML attribute, the firmware) that a plain call graph would miss — each one was
// either a real false positive while the plugin was built against the app, or a
// real dead-code case a naive grep missed.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { runPluginOnSource, runPluginOnEdits, diagnosticsByCode } from '../_helpers/run-plugin.js';
import deadCodePlugin from '../../../../scripts/bsc-plugins/dead-code.cjs';

const CODE = 'dead-code';
const KEEP = 'dead-code-keep';
const BASELINE = 'dead-code-baseline';

// Qualified names the plugin reported dead, e.g. ["getButton", "imageSize.LOGO"].
function deadNames(diagnostics) {
  return diagnosticsByCode(diagnostics, CODE)
    .map((d) => /The [a-z ]+ '([^']+)'/.exec(d.message)?.[1])
    .sort();
}
// A fixture that declares MainScene gets the app's real root: main() creating it
// by name, as source/main.bs creates JRScene. Otherwise the scene itself is dead.
const withRoot = (files) =>
  files['components/MainScene.xml'] && !files['source/main.bs']
    ? {
        'source/main.bs':
          'sub main()\n  CreateObject("roSGScreen").CreateScene("MainScene")\nend sub',
        ...files,
      }
    : files;
// bsconfig-base.json's autoImportComponentScript: a same-named .bs is the codebehind.
const APP_OPTIONS = { autoImportComponentScript: true };
const run = (files, options) =>
  runPluginOnSource(deadCodePlugin, withRoot(files), { ...APP_OPTIONS, ...options });
const dead = (files, options) => deadNames(run(files, options));

const component = (name, { parent = 'Group', iface = '', children = '' } = {}) =>
  `<?xml version="1.0" encoding="utf-8"?>
<component name="${name}" extends="${parent}">
  <interface>
${iface}
  </interface>
  <children>
${children}
  </children>
</component>`;

// A scene that instantiates the given component names, so they are live roots.
const scene = (...uses) =>
  component('MainScene', { parent: 'Scene', children: uses.map((u) => `    <${u} />`).join('\n') });

describe('dead-code — what it reports', () => {
  it('reports a source function nothing calls, as an error', () => {
    const diagnostics = run({
      'source/main.bs': 'sub main()\n  used()\nend sub',
      'source/util.bs': 'sub used()\nend sub\nsub unused()\nend sub',
    });
    const flagged = diagnosticsByCode(diagnostics, CODE);
    expect(flagged.map((d) => /'([^']+)'/.exec(d.message)[1])).toEqual(['unused']);
    expect(flagged[0].severity).toBe(1);
  });

  it('is transitive: code only dead code reaches is dead, and says where from', () => {
    const diagnostics = run({
      'source/main.bs': 'sub main()\nend sub',
      'source/util.bs': 'sub outer()\n  inner()\nend sub\nsub inner()\nend sub',
    });
    expect(deadNames(diagnostics)).toEqual(['inner', 'outer']);
    const inner = diagnosticsByCode(diagnostics, CODE).find((d) => d.message.includes("'inner'"));
    expect(inner.message).toMatch(/inside code that is itself dead \(outer\)/);
  });

  it('ignores recursion: a function that only calls itself is dead', () => {
    expect(dead({ 'source/util.bs': 'sub loop(n)\n  if n > 0 then loop(n - 1)\nend sub' })).toEqual(
      ['loop'],
    );
  });

  it('never reports Roku entry points or component lifecycle callbacks', () => {
    expect(
      dead({
        'source/main.bs':
          'sub main()\n  CreateObject("roSGScreen").CreateScene("MainScene")\nend sub\nsub RunScreenSaver()\nend sub',
        'components/MainScene.xml': scene(),
        'components/MainScene.bs':
          'sub init()\nend sub\nfunction onKeyEvent(key, press) as boolean\n  return false\nend function',
      }),
    ).toEqual([]);
  });
});

describe('dead-code — references by name (each one a real false-positive shape)', () => {
  it('counts observeField / functionName / callFunc strings', () => {
    expect(
      dead({
        'components/MainScene.xml': scene('Worker'),
        'components/MainScene.bs':
          'sub init()\n  m.top.observeField("focusedChild", "onFocus")\n  m.w.callFunc("doWork")\nend sub\nsub onFocus()\nend sub',
        'components/Worker.xml': component('Worker', {
          parent: 'Task',
          iface: '    <function name="doWork" />',
        }),
        'components/Worker.bs':
          'sub init()\n  m.top.functionName = "run"\nend sub\nsub run()\nend sub\nsub doWork()\nend sub',
      }),
    ).toEqual([]);
  });

  it('counts node@.fn() as a callFunc', () => {
    expect(
      dead({
        'components/MainScene.xml': scene('Worker'),
        'components/MainScene.bs': 'sub init()\n  m.w@.doWork()\nend sub',
        'components/Worker.xml': component('Worker', { iface: '    <function name="doWork" />' }),
        'components/Worker.bs': 'sub doWork()\nend sub',
      }),
    ).toEqual([]);
  });

  it('counts XML onChange handlers, child tags and extends — across multi-line elements', () => {
    expect(
      dead({
        'components/MainScene.xml': component('MainScene', {
          parent: 'Scene',
          children:
            '    <MarkupList\n      id="list"\n      itemComponentName="Row" />\n    <Fancy />',
        }),
        'components/Row.xml': component('Row', {
          iface: '    <field id="itemContent" type="node" onChange="onContent" />',
        }),
        'components/Row.bs': 'sub onContent()\nend sub',
        'components/Base.xml': component('Base'),
        'components/Fancy.xml': component('Fancy', { parent: 'Base' }),
      }),
    ).toEqual([]);
  });

  it('counts CreateObject / createChild node names', () => {
    expect(
      dead({
        'source/main.bs': 'sub main()\n  CreateObject("roSGNode", "Made")\nend sub',
        'components/Made.xml': component('Made'),
      }),
    ).toEqual([]);
  });

  it('counts a concatenated string prefix as naming every declaration it starts', () => {
    // mediaSegments.bs reads config["segmentAction" + segmentType].
    expect(
      dead({
        'components/MainScene.xml': scene('Config'),
        'components/MainScene.bs':
          'sub init()\n  m.c = m.top.findNode("c")\n  print m.c["segmentAction" + m.kind]\nend sub',
        'components/Config.xml': component('Config', {
          iface:
            '    <field id="segmentActionIntro" type="string" />\n    <field id="segmentActionOutro" type="string" />',
        }),
      }),
    ).toEqual([]);
  });

  it('does not treat a short concatenated string ("x" + w) as a name prefix', () => {
    expect(
      dead({
        'source/main.bs': 'sub main()\n  print "x" + "y"\nend sub',
        'source/util.bs': 'sub xUnused()\nend sub',
      }),
    ).toEqual(['xUnused']);
  });

  it('counts words in packaged JSON (settings.json names user-setting fields)', () => {
    expect(
      dead({
        'components/MainScene.xml': scene('Settings'),
        'components/Settings.xml': component('Settings', {
          iface: '    <field id="uiRowLayout" type="string" />',
        }),
        'settings/settings.json': '{ "settingName": "uiRowLayout" }',
      }),
    ).toEqual([]);
  });

  it('counts AA keys as field references (setFields)', () => {
    expect(
      dead({
        'components/MainScene.xml': scene('Panel'),
        'components/MainScene.bs':
          'sub init()\n  m.top.findNode("p").setFields({ title: "x" })\nend sub',
        'components/Panel.xml': component('Panel', {
          iface: '    <field id="title" type="string" />',
        }),
      }),
    ).toEqual([]);
  });

  it('counts a field set as an attribute on a child element', () => {
    expect(
      dead({
        'components/MainScene.xml': component('MainScene', {
          parent: 'Scene',
          children: '    <Panel heading="Hi" />',
        }),
        'components/Panel.xml': component('Panel', {
          iface: '    <field id="heading" type="string" />',
        }),
      }),
    ).toEqual([]);
  });
});

describe('dead-code — scope resolution', () => {
  it('resolves namespace members by qualified name, not by a short name another namespace shares', () => {
    // itemAspectRatio.SQUARE hid behind the live rowSlotSize.SQUARE under bare-name matching.
    expect(
      dead({
        'source/main.bs': 'sub main()\n  print rowSlotSize.SQUARE\nend sub',
        'source/sizes.bs':
          'namespace itemAspectRatio\n  const SQUARE = 1.0\nend namespace\nnamespace rowSlotSize\n  const SQUARE = [234, 234]\nend namespace',
      }),
    ).toEqual(['itemAspectRatio.SQUARE']);
  });

  it('counts a relative reference inside the namespace, and a chain that continues past the member', () => {
    expect(
      dead({
        'source/main.bs':
          'sub main()\n  print imageSize.LOGO.width\n  imageSize.useSelf()\nend sub',
        'source/sizes.bs':
          'namespace imageSize\n  const LOGO = { width: 1 }\n  const OWN = 2\n  sub useSelf()\n    print OWN\n  end sub\nend namespace',
      }),
    ).toEqual([]);
  });

  it("counts a namespaced function's transpiled ns_name spelling in a string callback", () => {
    expect(
      dead({
        'components/MainScene.xml': scene(),
        'components/MainScene.bs':
          'import "pkg:/source/h.bs"\nsub init()\n  m.top.observeField("focusedChild", "handlers_onFocus")\nend sub',
        'source/h.bs': 'namespace handlers\n  sub onFocus()\n  end sub\nend namespace',
      }),
    ).toEqual([]);
  });

  it('checks a codebehind function only in the component scopes that include it', () => {
    // IconButton observes "height" → onHeightChanged; TextButton's own onHeightChanged
    // was never wired and stayed hidden behind it under program-wide matching.
    expect(
      dead({
        'components/MainScene.xml': scene('IconButton', 'TextButton'),
        'components/IconButton.xml': component('IconButton'),
        'components/IconButton.bs':
          'sub init()\n  m.top.observeField("height", "onHeightChanged")\nend sub\nsub onHeightChanged()\nend sub',
        'components/TextButton.xml': component('TextButton'),
        'components/TextButton.bs': 'sub onHeightChanged()\nend sub',
      }),
    ).toEqual(['onHeightChanged']);
  });

  it('does not count a findNode() node id as naming a component', () => {
    // findNode("itemGrid") kept the retired ItemGrid component looking alive.
    expect(
      dead({
        'components/MainScene.xml': scene(),
        'components/MainScene.bs': 'sub init()\n  m.grid = m.top.findNode("itemGrid")\nend sub',
        'components/ItemGrid.xml': component('ItemGrid'),
      }),
    ).toEqual(['ItemGrid']);
  });

  it('matches a child tag to its component whatever the case (<extrasSlider> is the live ExtrasSlider)', () => {
    expect(
      dead({
        'components/MainScene.xml': component('MainScene', {
          parent: 'Scene',
          children: '    <extrasSlider id="itemExtras" />',
        }),
        'components/ExtrasSlider.xml': component('ExtrasSlider'),
      }),
    ).toEqual([]);
  });

  it("attributes m.top.field to the file's own component, not to another component's field of that name", () => {
    // Home's m.top.userMenuAction kept JROverhang's unused userMenuAction alive.
    expect(
      dead({
        'components/MainScene.xml': scene('Home', 'Overhang'),
        'components/Home.xml': component('Home', {
          iface: '    <field id="userMenuAction" type="string" />',
        }),
        'components/Home.bs': 'sub init()\n  m.top.userMenuAction = "x"\nend sub',
        'components/Overhang.xml': component('Overhang', {
          iface: '    <field id="userMenuAction" type="string" />',
        }),
      }),
    ).toEqual(['Overhang.userMenuAction']);
  });

  it('lets a parent component call a hook its child defines (template method)', () => {
    expect(
      dead({
        'components/MainScene.xml': scene('Child'),
        'components/Base.xml': component('Base'),
        'components/Base.bs': 'sub init()\n  hook()\nend sub',
        'components/Child.xml': component('Child', { parent: 'Base' }),
        'components/Child.bs': 'sub hook()\nend sub',
      }),
    ).toEqual([]);
  });

  it('reports a dead component once, not every function in its codebehind', () => {
    expect(
      dead({
        'components/MainScene.xml': scene(),
        'components/Orphan.xml': component('Orphan', {
          iface: '    <field id="value" type="string" />',
        }),
        'components/Orphan.bs': 'sub init()\n  helper()\nend sub\nsub helper()\nend sub',
      }),
    ).toEqual(['Orphan']);
  });

  it('matches class methods by member access and reports a dead class once', () => {
    expect(
      dead({
        'source/main.bs': 'sub main()\n  t = new Tool()\n  t.run()\nend sub',
        'source/tool.bs':
          'class Tool\n  sub run()\n  end sub\n  sub idle()\n  end sub\nend class\nclass Ghost\n  sub run()\n  end sub\nend class',
      }),
    ).toEqual(['Ghost', 'Tool.idle']);
  });

  it('resolves enum members by qualified name', () => {
    expect(
      dead({
        'source/main.bs': 'sub main()\n  print Kind.A\nend sub',
        'source/kind.bs': 'enum Kind\n  A = "a"\n  B = "b"\nend enum',
      }),
    ).toEqual(['Kind.B']);
  });
});

describe('dead-code — code the platform or tooling reaches', () => {
  it('never reports interface fields the firmware writes into item components', () => {
    expect(
      dead({
        'components/MainScene.xml': component('MainScene', {
          parent: 'Scene',
          children: '    <RowList itemComponentName="Item" />',
        }),
        'components/Item.xml': component('Item', {
          iface: ['itemContent', 'focusPercent', 'rowHasFocus', 'itemHasFocus']
            .map((f) => `    <field id="${f}" type="float" />`)
            .join('\n'),
        }),
      }),
    ).toEqual([]);
  });

  it('never reports keySelected on a DynamicCustomKeyboard subclass (the firmware calls it)', () => {
    expect(
      dead({
        'components/MainScene.xml': scene('Keys'),
        'components/Keys.xml': component('Keys', {
          parent: 'DynamicCustomKeyboard',
          iface: '    <function name="keySelected" />',
        }),
        'components/Keys.bs':
          'function keySelected(key as string) as boolean\n  return false\nend function',
      }),
    ).toEqual([]);
  });

  it('keeps an alias field with a value (its value configures the child) but not one without', () => {
    expect(
      dead({
        'components/MainScene.xml': scene('Form'),
        'components/Form.xml': component('Form', {
          iface:
            '    <field id="boxWidth" alias="box.width" value="1620" />\n    <field id="boxText" alias="box.text" />',
          children: '    <Rectangle id="box" />',
        }),
      }),
    ).toEqual(['Form.boxText']);
  });

  it('never reports a call another plugin injects at transpile time', () => {
    expect(dead({ 'source/api.bs': 'sub abandonApiPromises()\nend sub' })).toEqual([]);
  });

  it('never reports vendored code', () => {
    expect(dead({ 'source/roku_modules/lib/lib.brs': 'sub libOnly()\nend sub' })).toEqual([]);
  });
});

describe('dead-code — keeping code on purpose', () => {
  it('honors a keep marker with a kind and a reason, and keeps what the kept code uses', () => {
    const diagnostics = run({
      'source/api.bs':
        "' bsc-disable-next-line dead-code keep: api — first caller lands later\nsub publicApi()\n  helper()\nend sub\nsub helper()\nend sub",
    });
    expect(deadNames(diagnostics)).toEqual([]);
    expect(diagnosticsByCode(diagnostics, KEEP)).toEqual([]);
  });

  it('honors a keep marker on an XML declaration', () => {
    const diagnostics = run({
      'components/MainScene.xml': scene('Item'),
      'components/Item.xml': component('Item', {
        iface:
          '    <!-- bsc-disable-next-line dead-code keep: planned — theme media, #1070 -->\n    <field id="themeSongs" type="array" />',
      }),
    });
    expect(deadNames(diagnostics)).toEqual([]);
    expect(diagnosticsByCode(diagnostics, KEEP)).toEqual([]);
  });

  it.each([
    ["' bsc-disable-next-line dead-code", /names no keep kind/],
    ["' bsc-disable-next-line dead-code keep: api", /gives no reason/],
    ["' bsc-disable-next-line dead-code keep: someday — maybe", /not a keep kind/],
    ["' bsc-disable-next-line dead-code keep: planned — for later", /must cite its issue/],
  ])('rejects the marker %s, and still reports the code', (marker, problem) => {
    const diagnostics = run({ 'source/api.bs': `${marker}\nsub publicApi()\nend sub` });
    expect(deadNames(diagnostics)).toEqual(['publicApi']);
    const keep = diagnosticsByCode(diagnostics, KEEP);
    expect(keep).toHaveLength(1);
    expect(keep[0].message).toMatch(problem);
  });

  it('reports a keep marker on code that is used as stale', () => {
    const diagnostics = run({
      'source/main.bs': 'sub main()\n  publicApi()\nend sub',
      'source/api.bs':
        "' bsc-disable-next-line dead-code keep: api — for later\nsub publicApi()\nend sub",
    });
    expect(diagnosticsByCode(diagnostics, KEEP)[0].message).toMatch(
      /is used, so this dead-code keep marker is stale/,
    );
  });

  it('rejects a file-level suppression', () => {
    const diagnostics = run({
      'source/api.bs': "' bsc-disable-file dead-code\nsub publicApi()\nend sub",
    });
    expect(deadNames(diagnostics)).toEqual(['publicApi']);
    expect(diagnosticsByCode(diagnostics, KEEP)[0].message).toMatch(/file-level/);
  });

  it('keeps a whole set through the bsconfig allowlist, and reports an entry that matches nothing', () => {
    const options = {
      deadCode: {
        keep: [
          { kind: 'design-system', files: ['components/ui/label/**'], reason: 'the label matrix' },
          { kind: 'design-system', files: ['components/nowhere/**'], reason: 'stale entry' },
        ],
      },
    };
    const diagnostics = run(
      {
        'components/MainScene.xml': scene(),
        'components/ui/label/LabelErrorLarge.xml': component('LabelErrorLarge', {
          parent: 'Label',
        }),
      },
      options,
    );
    expect(deadNames(diagnostics)).toEqual([]);
    const keep = diagnosticsByCode(diagnostics, KEEP);
    expect(keep).toHaveLength(1);
    expect(keep[0].message).toMatch(/entry 1 .* matches no declaration/);
  });
});

describe('dead-code — tests as consumers of interface exposures only', () => {
  let dir;
  afterEach(() => dir && fs.rmSync(dir, { recursive: true, force: true }));

  it('counts a callFunc from a test for an exposure, but not a test calling a source function', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dead-code-tests-'));
    fs.writeFileSync(
      path.join(dir, 'queue.spec.bs'),
      'sub t()\n  m.q.callFunc("pop")\n  helperOnlyTestsUse()\nend sub',
    );
    fs.writeFileSync(
      path.join(dir, 'bench.spec.js'),
      "await odc.callFunc({ funcName: 'runCell' });",
    );
    const names = dead(
      {
        'components/MainScene.xml': scene('Queue'),
        'components/Queue.xml': component('Queue', {
          iface:
            '    <function name="pop" />\n    <function name="runCell" />\n    <function name="peek" />',
        }),
        'components/Queue.bs': 'sub pop()\nend sub\nsub runCell()\nend sub\nsub peek()\nend sub',
        'source/util.bs': 'sub helperOnlyTestsUse()\nend sub',
      },
      {
        deadCode: { exposureConsumers: [path.join(dir, '*.spec.bs'), path.join(dir, '*.spec.js')] },
      },
    );
    expect(names).toEqual(['Queue.peek', 'helperOnlyTestsUse', 'peek']);
  });
});

describe('dead-code — baseline', () => {
  let dir;
  afterEach(() => {
    delete process.env.DEAD_CODE_WRITE_BASELINE;
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  const files = {
    'source/main.bs': 'sub main()\nend sub',
    'source/util.bs': 'sub oldDead()\nend sub',
  };

  it('skips a baselined finding, and reports an entry that is no longer dead', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dead-code-baseline-'));
    const baseline = path.join(dir, 'baseline.json');
    fs.writeFileSync(
      baseline,
      JSON.stringify({
        entries: ['function source/util.bs oldDead', 'function source/util.bs removedLongAgo'],
      }),
    );
    const diagnostics = run(files, { deadCode: { baseline } });
    expect(deadNames(diagnostics)).toEqual([]);
    const stale = diagnosticsByCode(diagnostics, BASELINE);
    expect(stale).toHaveLength(1);
    expect(stale[0].message).toMatch(/removedLongAgo.*no longer exists/);
  });

  it('writes every current finding, keyed without line numbers, when asked to', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dead-code-baseline-'));
    const baseline = path.join(dir, 'baseline.json');
    process.env.DEAD_CODE_WRITE_BASELINE = '1';
    const diagnostics = run(files, { deadCode: { baseline } });
    expect(deadNames(diagnostics)).toEqual([]);
    expect(JSON.parse(fs.readFileSync(baseline, 'utf8')).entries).toEqual([
      'function source/util.bs oldDead',
    ]);
  });
});

describe('dead-code — incremental edits (language server)', () => {
  it('clears a finding when a caller appears in ANOTHER file, and restores it when the caller goes', () => {
    const steps = runPluginOnEdits(
      deadCodePlugin,
      [
        { 'source/main.bs': 'sub main()\nend sub', 'source/util.bs': 'sub helper()\nend sub' },
        { 'source/main.bs': 'sub main()\n  helper()\nend sub' },
        { 'source/main.bs': 'sub main()\nend sub' },
      ],
      APP_OPTIONS,
    );
    expect(steps.map(deadNames)).toEqual([['helper'], [], ['helper']]);
  });
});
