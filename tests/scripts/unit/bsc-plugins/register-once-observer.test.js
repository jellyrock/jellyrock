// Tests for the register-once-observer plugin.
//
// Plugin under test: scripts/bsc-plugins/register-once-observer.cjs
// Diagnostic code: register-once-observer
//
// What the plugin enforces: a member bound from `m.top.findNode()` in `init()` and
// observed EXACTLY ONCE (that once being in `init()`) may only be `unobserveField`'d
// in `onDestroy()`. That is the REGISTER-ONCE shape from components/CLAUDE.md.
//
// The population matters as much as the check. Balanced toggles must never enter it —
// their observe is not a lone call inside `init()` — which is what separates this from
// the earlier naive attempt that flagged 143 sites at a 3-of-3 false-positive rate.

import { describe, it, expect } from 'vitest';
import { runPluginOnSource, diagnosticsByCode } from '../_helpers/run-plugin.js';
import registerOnceObserverPlugin from '../../../../scripts/bsc-plugins/register-once-observer.cjs';

const CODE = 'register-once-observer';

const xmlPaired = (name) => `<?xml version="1.0" encoding="utf-8" ?>
<component name="${name}" extends="Group">
  <script type="text/brightscript" uri="${name}.bs" />
</component>`;

function runOnBody(bsBody, { componentName = 'TestComponent' } = {}) {
  return runPluginOnSource(registerOnceObserverPlugin, {
    [`components/${componentName}.xml`]: xmlPaired(componentName),
    [`components/${componentName}.bs`]: bsBody,
  });
}

describe('register-once-observer', () => {
  it('flags a register-once member unobserved outside onDestroy', () => {
    // This is VideoPlayerView.playbackTimer, reduced: observed once in init(),
    // detached from a state handler, never re-registered.
    const diagnostics = runOnBody(`
      sub init()
        m.playbackTimer = m.top.findNode("playbackTimer")
        m.playbackTimer.observeField("fire", "reportPlayback")
      end sub
      sub onState()
        m.playbackTimer.control = "stop"
        m.playbackTimer.unobserveField("fire")
      end sub
      sub onDestroy()
        m.playbackTimer.unobserveField("fire")
      end sub
    `);
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(1);
  });

  it('passes the register-once shape done correctly', () => {
    // PhotoDetails.slideshowTimer: driven by `control`, detached only at teardown.
    const diagnostics = runOnBody(`
      sub init()
        m.slideshowTimer = m.top.findNode("slideshowTimer")
        m.slideshowTimer.observeField("fire", "onTick")
      end sub
      sub startSlideshow()
        m.slideshowTimer.control = "start"
      end sub
      sub stopSlideshow()
        m.slideshowTimer.control = "stop"
      end sub
      sub onDestroy()
        m.slideshowTimer.unobserveField("fire")
      end sub
    `);
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('ignores a balanced toggle — the observe is not a lone call in init()', () => {
    // VideoPlayerView.bufferCheckTimer: bound in init() but observed on the way in
    // and released on every exit. Out of population, so never flagged.
    const diagnostics = runOnBody(`
      sub init()
        m.bufferCheckTimer = m.top.findNode("bufferCheckTimer")
      end sub
      sub onBuffering()
        m.bufferCheckTimer.unobserveField("fire")
        m.bufferCheckTimer.observeField("fire", "bufferCheck")
        m.bufferCheckTimer.control = "start"
      end sub
      sub onPlaying()
        m.bufferCheckTimer.control = "stop"
        m.bufferCheckTimer.unobserveField("fire")
      end sub
    `);
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('ignores a member that is observed twice, even if one observe is in init()', () => {
    const diagnostics = runOnBody(`
      sub init()
        m.timer = m.top.findNode("timer")
        m.timer.observeField("fire", "onTick")
      end sub
      sub restart()
        m.timer.unobserveField("fire")
        m.timer.observeField("fire", "onTick")
      end sub
    `);
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('ignores members not bound from m.top.findNode() in init()', () => {
    // A CreateObject-bound Task is the ~127-site population the old naive check
    // drowned in. It is not in this rule's population at all.
    const diagnostics = runOnBody(`
      sub init()
        m.loadTask = CreateObject("roSGNode", "LoadTask")
        m.loadTask.observeField("content", "onContent")
      end sub
      sub onContent()
        m.loadTask.unobserveField("content")
      end sub
    `);
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('does not let unobserveField satisfy an observeFieldScoped registration', () => {
    // Roku keeps scoped and unscoped registrations on separate observer lists.
    const diagnostics = runOnBody(`
      sub init()
        m.timer = m.top.findNode("timer")
        m.timer.observeFieldScoped("fire", "onTick")
      end sub
      sub onSomething()
        m.timer.unobserveField("fire")
      end sub
    `);
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('flags a scoped register-once detached outside onDestroy', () => {
    const diagnostics = runOnBody(`
      sub init()
        m.timer = m.top.findNode("timer")
        m.timer.observeFieldScoped("fire", "onTick")
      end sub
      sub onSomething()
        m.timer.unobserveFieldScoped("fire")
      end sub
    `);
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(1);
  });

  it('tracks fields independently on the same member', () => {
    const diagnostics = runOnBody(`
      sub init()
        m.node = m.top.findNode("node")
        m.node.observeField("fire", "onFire")
        m.node.observeField("other", "onOther")
      end sub
      sub onSomething()
        m.node.unobserveField("other")
      end sub
      sub onDestroy()
        m.node.unobserveField("fire")
      end sub
    `);
    // Only the "other" detach is out of place; "fire" is textbook register-once.
    const found = diagnosticsByCode(diagnostics, CODE);
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('"other"');
  });

  it('honours the bsc-disable-next-line escape hatch', () => {
    const diagnostics = runOnBody(`
      sub init()
        m.buttonIcon = m.top.findNode("buttonIcon")
        m.buttonIcon.observeField("loadStatus", "onIconLoaded")
      end sub
      sub onIconLoaded()
        ' bsc-disable-next-line register-once-observer
        m.buttonIcon.unobserveField("loadStatus")
      end sub
    `);
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });

  it('does nothing in a component with no init()', () => {
    const diagnostics = runOnBody(`
      sub onSomething()
        m.timer.unobserveField("fire")
      end sub
    `);
    expect(diagnosticsByCode(diagnostics, CODE)).toHaveLength(0);
  });
});
