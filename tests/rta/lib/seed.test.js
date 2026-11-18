/**
 * Hardware-free gate on which registry keys a signed-in seed resets to put the user back on
 * default settings: the fields of JellyfinUserSettings.xml, split by section as the app splits
 * them. Read from the real XML, so a setting added there is reset with no change here.
 *
 * `.test.js` (Vitest, `npm run test:scripts`, no device).
 */
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { settingKeys, UNSAVED_FIELDS } from './seed.js';

const XML = fs.readFileSync(
  new URL('../../../components/data/jellyfin/JellyfinUserSettings.xml', import.meta.url),
  'utf8',
);

describe('settingKeys', () => {
  const keys = settingKeys(XML);

  it("puts a user setting in the user's section, those the menu lists and those it does not", () => {
    expect(keys.user).toContain('uiRowLayout');
    expect(keys.user).toContain('itemGridShowItemCount');
    expect(keys.user).toContain('homeSection0');
  });

  it('puts a `global` setting in the global section, as isGlobalSetting does', () => {
    expect(keys.global).toContain('globalSplashScreen');
    expect(keys.user.filter((key) => key.startsWith('global'))).toEqual([]);
  });

  it('leaves out the fields not saved under their own name', () => {
    for (const field of UNSAVED_FIELDS) {
      expect(keys.user).not.toContain(field);
      expect(keys.global).not.toContain(field);
    }
  });

  // A rename in the XML would otherwise turn an exclusion into a delete of a real setting key
  it('names only fields the XML declares as unsaved', () => {
    for (const field of UNSAVED_FIELDS) expect(XML).toContain(`<field id="${field}"`);
  });

  it('reads a field id whatever the attributes after it', () => {
    expect(
      settingKeys('<field id="a" type="string" />\n<field  id="globalB" alwaysNotify="true"/>'),
    ).toEqual({ user: ['a'], global: ['globalB'] });
  });
});
