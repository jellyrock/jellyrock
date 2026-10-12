/**
 * The translation-file parsers and placeholder converters behind
 * `npm run translations:seed` (`scripts/lib/translation-formats.cjs`).
 *
 * Each fixture is a few lines in the real format of the project that ships it, with
 * the escapes that project's files actually contain: a parser that mis-decodes one
 * would put a backslash or an entity on screen in 50 languages at once.
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  PARSERS,
  PlaceholderError,
  placeholderSignature,
  toIndexedPlaceholders,
} = require('../../../../scripts/lib/translation-formats.cjs');

const buf = (text) => Buffer.from(text, 'utf8');

describe('json-flat', () => {
  it('keeps string values and drops anything else', () => {
    expect(PARSERS['json-flat'](buf('{ "Actor": "Acteur", "Count": 3, "Nested": {} }'))).toEqual({
      Actor: 'Acteur',
    });
  });

  it('strips a UTF-8 BOM', () => {
    expect(PARSERS['json-flat'](buf('﻿{ "Yes": "Oui" }'))).toEqual({ Yes: 'Oui' });
  });
});

describe('json-nested (i18next)', () => {
  it('flattens nested keys with dots', () => {
    const json = '{ "player": { "menu": { "speed": "Vitesse" } }, "common": { "audio": "Audio" } }';
    expect(PARSERS['json-nested'](buf(json))).toEqual({
      'player.menu.speed': 'Vitesse',
      'common.audio': 'Audio',
    });
  });
});

describe('android-xml', () => {
  const parse = (body) =>
    PARSERS['android-xml'](
      buf(`<?xml version="1.0" encoding="utf-8"?>\n<resources>\n${body}\n</resources>`),
    );

  it('decodes Android escapes and XML entities', () => {
    expect(parse(`<string name="a">L\\'élément &amp; \\"co\\"</string>`)).toEqual({
      a: `L'élément & "co"`,
    });
  });

  it('collapses whitespace outside quotes and keeps it inside', () => {
    expect(
      parse(`<string name="a">  one\n    two  </string><string name="b">"  kept  "</string>`),
    ).toEqual({
      a: 'one two',
      b: '  kept  '.trim(),
    });
  });

  it('decodes \\n and \\u escapes', () => {
    expect(parse('<string name="a">x\\ny\\u00e9</string>')).toEqual({ a: 'x\nyé' });
  });

  it('keeps CDATA literally and unwraps xliff:g', () => {
    expect(
      parse(
        '<string name="a"><![CDATA[<b>bold</b>]]></string>' +
          '<string name="b" xmlns:xliff="urn:oasis:names:tc:xliff:document:1.2"><xliff:g id="n">%1$s</xliff:g> items</string>',
      ),
    ).toEqual({ a: '<b>bold</b>', b: '%1$s items' });
  });

  it('skips translatable="false", comments and plurals', () => {
    expect(
      parse(
        '<!-- <string name="gone">x</string> -->' +
          '<string name="id" translatable="false">abc</string>' +
          '<plurals name="p"><item quantity="one">1</item></plurals>' +
          '<string name="ok">Oui</string>',
      ),
    ).toEqual({ ok: 'Oui' });
  });
});

describe('apple-strings', () => {
  it('reads UTF-16LE with a BOM, as Swiftfin ships it', () => {
    const text = '/* comment */\n"director" = "Réalisateur";\n"quote" = "Il a dit \\"oui\\"";\n';
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
    expect(PARSERS['apple-strings'](utf16)).toEqual({
      director: 'Réalisateur',
      quote: 'Il a dit "oui"',
    });
  });

  it('reads UTF-8 too', () => {
    expect(PARSERS['apple-strings'](buf('"a" = "b";'))).toEqual({ a: 'b' });
  });
});

describe('qt-ts', () => {
  const ts = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE TS>
<TS version="2.1" language="fr">
<context>
  <message><source>Bit Rate</source><translation>Débit binaire</translation></message>
  <message><source>as %1</source><translation>en tant que %1</translation></message>
  <message><source>Draft</source><translation type="unfinished">Brouillon</translation></message>
  <message><source>Old</source><translation type="obsolete">Vieux</translation></message>
  <message><source>Fish &amp; Chips</source><translation>Poisson &amp; frites</translation></message>
</context>
</TS>`;

  it('keys by source text and skips unfinished and obsolete entries', () => {
    expect(PARSERS['qt-ts'](buf(ts))).toEqual({
      'Bit Rate': 'Débit binaire',
      'as %1': 'en tant que %1',
      'Fish & Chips': 'Poisson & frites',
    });
  });
});

describe('toIndexedPlaceholders', () => {
  it('converts printf, positional and sequential', () => {
    expect(toIndexedPlaceholders('%1$s of %2$d', 'printf')).toBe('{0} of {1}');
    expect(toIndexedPlaceholders('%s and %@', 'printf')).toBe('{0} and {1}');
    expect(toIndexedPlaceholders('%1$,.0f Mbit/s', 'printf')).toBe('{0} Mbit/s');
    expect(toIndexedPlaceholders('100%% done', 'printf')).toBe('100% done');
  });

  it('converts Qt %1', () => {
    expect(toIndexedPlaceholders('as %1', 'qt')).toBe('as {0}');
  });

  it('maps i18next names only through an explicit index', () => {
    expect(toIndexedPlaceholders('Buffer: {{seconds}}s', 'i18next', { seconds: 0 })).toBe(
      'Buffer: {0}s',
    );
    expect(() => toIndexedPlaceholders('{{name}}', 'i18next')).toThrow(PlaceholderError);
  });

  it('leaves brace-index alone', () => {
    expect(toIndexedPlaceholders('as {0}', 'brace-index')).toBe('as {0}');
  });
});

describe('placeholderSignature', () => {
  it('compares placeholder sets regardless of order or repetition', () => {
    expect(placeholderSignature('{1} {0} {0}')).toBe(placeholderSignature('{0}, {1}'));
    expect(placeholderSignature('{0}')).not.toBe(placeholderSignature('none'));
  });
});
