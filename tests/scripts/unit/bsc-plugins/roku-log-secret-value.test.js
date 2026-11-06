// Tests for the roku-log plugin's secret-value check.
//
// Plugin under test: scripts/bsc-plugins/roku-log.cjs
// Diagnostic code: log-secret-value
//
// The logger masks a secret only where a key and a separator name it (`token=…`, `"Pw":"…"`).
// The house style passes a label and a value as separate arguments, which the logger joins with
// a space, so `m.log.debug("token", token)` would print the token raw. The build rejects an
// m.log argument whose name says it holds a secret instead.

import { describe, it, expect } from 'vitest';
import { runPluginOnSource, diagnosticsByCode } from '../_helpers/run-plugin.js';
import rokuLogPlugin from '../../../../scripts/bsc-plugins/roku-log.cjs';

const CODE = 'log-secret-value';

function check(statement) {
  const source = `
    sub init()
      ${statement}
    end sub
  `;
  return diagnosticsByCode(runPluginOnSource(rokuLogPlugin, { 'components/Foo.bs': source }), CODE);
}

describe('roku-log secret value', () => {
  it.each([
    ['a token', 'm.log.debug("token", token)'],
    ['an access token property', 'm.log.debug("session", user.accessToken)'],
    ['a token read by index', 'm.log.debug("session", res.json["AccessToken"])'],
    ['an API key', 'm.log.debug("key", m.apiKey)'],
    ['a legacy api_key', 'm.log.debug("key", api_key)'],
    ['a password', 'm.log.warn("sign in", password)'],
    ['the Pw field', 'm.log.warn("sign in", body.Pw)'],
    ['a secret', 'm.log.info("quick connect", m.top.secret)'],
    ['a device ID', 'm.log.info("device", deviceId)'],
    ['a converted token', 'm.log.info("token", token.toStr())'],
    ['a token joined into the message', 'm.log.info("token " + authToken)'],
    ['a token inside a template string', 'm.log.info(`token ${authToken}`)'],
    ['a token as the value of an AA literal', 'm.log.info("session", { t: authToken })'],
    ['a token as the key of an AA literal', 'm.log.info("session", { token: t })'],
  ])('fails %s', (_label, statement) => {
    const found = check(statement);
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe(1);
  });

  it.each([
    [
      'the word token inside the message',
      'm.log.warn("Quick Connect token exchange refused", code)',
    ],
    ['a token count', 'm.log.info("tokens", tokenCount)'],
    ['a user ID', 'm.log.info("user", userId)'],
    ['a call that is not on m.log', 'print token'],
    ['a length', 'm.log.info("token", "length", Len(token))'],
  ])('passes %s', (_label, statement) => {
    expect(check(statement)).toHaveLength(0);
  });

  it('reports each secret argument once', () => {
    expect(check('m.log.info("auth", token, "device", deviceId)')).toHaveLength(2);
  });

  it('does not also report a secret as personal text', () => {
    const source = `
      sub init()
        m.log.info("auth", token)
      end sub
    `;
    const all = runPluginOnSource(rokuLogPlugin, { 'components/Foo.bs': source });
    expect(diagnosticsByCode(all, 'log-personal-text')).toHaveLength(0);
  });

  it('honours bsc-disable-line', () => {
    expect(
      check(`m.log.info("flag", hasPassword) ' bsc-disable-line log-secret-value a boolean`),
    ).toHaveLength(0);
  });

  it('honours bsc-disable-next-line', () => {
    expect(
      check(`' bsc-disable-next-line log-secret-value a boolean
      m.log.info("flag", hasPassword)`),
    ).toHaveLength(0);
  });
});
