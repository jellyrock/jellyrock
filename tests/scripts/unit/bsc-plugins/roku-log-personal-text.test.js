// Tests for the roku-log plugin's personal-text check.
//
// Plugin under test: scripts/bsc-plugins/roku-log.cjs
// Diagnostic code: log-personal-text
//
// The logger masks what has a shape (tokens, hosts, IPs), but a title or a name is free text
// it cannot find. So the build rejects an m.log argument whose name says it holds one.

import { describe, it, expect } from 'vitest';
import { runPluginOnSource, diagnosticsByCode } from '../_helpers/run-plugin.js';
import rokuLogPlugin from '../../../../scripts/bsc-plugins/roku-log.cjs';

const CODE = 'log-personal-text';

function check(statement) {
  const source = `
    sub init()
      ${statement}
    end sub
  `;
  return diagnosticsByCode(runPluginOnSource(rokuLogPlugin, { 'components/Foo.bs': source }), CODE);
}

describe('roku-log personal text', () => {
  it.each([
    ['a property named name', 'm.log.info("playing", item.name)'],
    ['a variable ending in Title', 'm.log.verbose("row", rowTitle)'],
    ['a field read by index', 'm.log.info("item", item["Name"])'],
    ['a user name', 'm.log.warn("signed in", username)'],
    ['a series name', 'm.log.debug("next up", m.top.seriesName)'],
    ['a group name', 'm.log.info("creating group", "groupName", groupName)'],
    ['a converted name', 'm.log.info("album", item.album.toStr())'],
  ])('fails %s', (_label, statement) => {
    const found = check(statement);
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe(1);
  });

  it.each([
    ['an item ID', 'm.log.info("playing", item.id)'],
    ['a subtitle index', 'm.log.info("subtitle", subtitleIdx, m.top.subtitle)'],
    ['a setting name', 'm.log.warn("no default", selectedSetting.settingName)'],
    ['the word name inside the message', 'm.log.info("name and number matches", count)'],
    ['a call that is not on m.log', 'print item.name'],
  ])('passes %s', (_label, statement) => {
    expect(check(statement)).toHaveLength(0);
  });

  it('reports each personal argument once', () => {
    expect(check('m.log.info("item", item.name, "row", rowTitle)')).toHaveLength(2);
  });

  it('honours bsc-disable-line', () => {
    expect(
      check('m.log.info("theme", theme.name) \' bsc-disable-line log-personal-text a theme name'),
    ).toHaveLength(0);
  });

  it('honours bsc-disable-next-line', () => {
    expect(
      check(`' bsc-disable-next-line log-personal-text a theme name
      m.log.info("theme", theme.name)`),
    ).toHaveLength(0);
  });
});
