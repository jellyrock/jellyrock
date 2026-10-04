// scripts/lib/translation-formats.cjs — read other projects' translation files.
//
// Every parser takes the file's raw bytes (a Buffer) and returns a flat
// `{ sourceKey: value }` object of plain strings: markup the format uses for its OWN
// escaping is decoded, markup that would reach the screen is left in place so the
// seeder can refuse it. Every placeholder converter turns a value into JellyRock's
// indexed `{0}` form, or throws when it cannot do so unambiguously.
//
// Used by `scripts/translations-seed.js`. Pure functions, no I/O, so each format is
// tested against a few lines of fixture text in
// `tests/scripts/unit/lib/translation-formats.test.js`.

'use strict';

// ── Shared decoding ──────────────────────────────────────────────────────────

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXmlEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name) => {
    if (name[0] === '#') {
      const code =
        name[1] === 'x' || name[1] === 'X'
          ? parseInt(name.slice(2), 16)
          : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return XML_ENTITIES[name.toLowerCase()] ?? match;
  });
}

/** Strip a UTF-8 / UTF-16 byte-order mark and decode. Swiftfin ships UTF-16LE. */
function decodeText(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString('utf16le');
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer.subarray(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  const text = buffer.toString('utf8');
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function onlyStrings(object) {
  const out = {};
  for (const [key, value] of Object.entries(object))
    if (typeof value === 'string') out[key] = value;
  return out;
}

// ── Parsers ──────────────────────────────────────────────────────────────────

/** `{ "Key": "Value" }` — jellyfin-web, the Jellyfin server. */
function parseJsonFlat(buffer) {
  return onlyStrings(JSON.parse(decodeText(buffer)));
}

/** Nested i18next JSON — streamyfin. Keys are joined with `.`: `player.menu.audio`. */
function parseJsonNested(buffer) {
  const out = {};
  const walk = (node, prefix) => {
    for (const [key, value] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof value === 'string') out[path] = value;
      else if (value && typeof value === 'object') walk(value, path);
    }
  };
  walk(JSON.parse(decodeText(buffer)), '');
  return out;
}

/**
 * Android's string-resource escaping, applied to the text between the tags:
 * whitespace runs collapse to one space outside double quotes, unescaped double
 * quotes are delimiters (removed), and `\n`, `\t`, `\'`, `\"`, `\\`, `\@`, `\?`,
 * `\uXXXX` are escapes.
 */
function decodeAndroidText(raw) {
  let out = '';
  let inQuotes = false;
  let pendingSpace = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '\\' && i + 1 < raw.length) {
      const next = raw[++i];
      if (pendingSpace) {
        out += ' ';
        pendingSpace = false;
      }
      if (next === 'n') out += '\n';
      else if (next === 't') out += '\t';
      else if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(raw.slice(i + 1, i + 5))) {
        out += String.fromCharCode(parseInt(raw.slice(i + 1, i + 5), 16));
        i += 4;
      } else out += next;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && /\s/.test(ch)) {
      pendingSpace = out.length > 0;
      continue;
    }
    if (pendingSpace) {
      out += ' ';
      pendingSpace = false;
    }
    out += ch;
  }
  return out;
}

/**
 * Android `res/values-*\/strings.xml` — jellyfin-androidtv, jellyfin-android.
 * Only `<string>` elements: `<plurals>` and `<string-array>` have no single value
 * to map, and `translatable="false"` strings are not translations.
 */
function parseAndroidXml(buffer) {
  const xml = decodeText(buffer).replace(/<!--[\s\S]*?-->/g, '');
  const out = {};
  for (const m of xml.matchAll(/<string\b([^>]*)>([\s\S]*?)<\/string>|<string\b([^>]*)\/>/g)) {
    const attrs = m[1] ?? m[3];
    const name = /\bname="([^"]+)"/.exec(attrs)?.[1];
    if (!name || /\btranslatable="false"/.test(attrs)) continue;
    let body = m[2] ?? '';
    // xliff:g only marks "do not translate this span" (usually a placeholder); keep
    // its content. CDATA is literal text. Anything else stays, to be refused.
    body = body.replace(/<xliff:g\b[^>]*>([\s\S]*?)<\/xliff:g>/g, '$1');
    const parts = body.split(/(<!\[CDATA\[[\s\S]*?\]\]>)/);
    out[name] = parts
      .map((part) =>
        part.startsWith('<![CDATA[')
          ? part.slice(9, -3)
          : decodeAndroidText(decodeXmlEntities(part)),
      )
      .join('')
      .trim();
  }
  return out;
}

function decodeAppleString(raw) {
  return raw.replace(/\\(U[0-9a-fA-F]{4}|u[0-9a-fA-F]{4}|.)/g, (match, esc) => {
    if (esc.length === 5) return String.fromCharCode(parseInt(esc.slice(1), 16));
    return { n: '\n', t: '\t', r: '\r', 0: '\0' }[esc] ?? esc;
  });
}

/** Apple `.strings` — Swiftfin. `"key" = "value";`, with C comments. */
function parseAppleStrings(buffer) {
  const text = decodeText(buffer).replace(/\/\*[\s\S]*?\*\//g, '');
  const out = {};
  for (const m of text.matchAll(/^\s*"((?:[^"\\]|\\.)*)"\s*=\s*"((?:[^"\\]|\\.)*)"\s*;/gm)) {
    out[decodeAppleString(m[1])] = decodeAppleString(m[2]);
  }
  return out;
}

/**
 * Qt Linguist `.ts` — jellyfin-roku. The English source text IS the key. Entries
 * marked `unfinished`, `obsolete` or `vanished` are not translations; numerus forms
 * have no single value.
 */
function parseQtTs(buffer) {
  const xml = decodeText(buffer).replace(/<!--[\s\S]*?-->/g, '');
  const out = {};
  for (const m of xml.matchAll(/<message\b[^>]*>([\s\S]*?)<\/message>/g)) {
    const source = /<source>([\s\S]*?)<\/source>/.exec(m[1]);
    const translation = /<translation\b([^>]*)>([\s\S]*?)<\/translation>/.exec(m[1]);
    if (!source || !translation) continue;
    if (/\btype="(unfinished|obsolete|vanished)"/.test(translation[1])) continue;
    if (/<numerusform/.test(translation[2])) continue;
    out[decodeXmlEntities(source[1])] = decodeXmlEntities(translation[2]);
  }
  return out;
}

const PARSERS = {
  'json-flat': parseJsonFlat,
  'json-nested': parseJsonNested,
  'android-xml': parseAndroidXml,
  'apple-strings': parseAppleStrings,
  'qt-ts': parseQtTs,
};

// ── Placeholders ─────────────────────────────────────────────────────────────

class PlaceholderError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PlaceholderError';
  }
}

// printf-family: %1$s %s %d %1$,.0f %@ %lld, and the %% literal.
const PRINTF = /%%|%(?:(\d+)\$)?[-+ 0#,']*\d*(?:\.\d+)?(?:hh|h|ll|l|q|L|z|j|t)?([sdifuxXeEgGcb@])/g;

/**
 * Convert a value's placeholders to `{N}` form.
 *
 * @param {string} value
 * @param {'brace-index'|'printf'|'qt'|'i18next'} style
 * @param {object} [named] - i18next only: `{ name: index }` from the reviewed keymap.
 *   A named placeholder has no inherent position, so guessing one would be making
 *   it up; an unmapped name throws.
 */
function toIndexedPlaceholders(value, style, named = {}) {
  switch (style) {
    case 'brace-index':
      return value;
    case 'printf': {
      let next = 0;
      return value.replace(PRINTF, (match, index) => {
        if (match === '%%') return '%';
        return `{${index ? Number(index) - 1 : next++}}`;
      });
    }
    case 'qt':
      return value.replace(/%L?(\d{1,2})/g, (match, n) => `{${Number(n) - 1}}`);
    case 'i18next':
      return value.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, name) => {
        if (!(name in named))
          throw new PlaceholderError(`named placeholder {{${name}}} has no index in the keymap`);
        return `{${named[name]}}`;
      });
    default:
      throw new Error(`unknown placeholder style ${JSON.stringify(style)}`);
  }
}

/** The sorted set of `{N}` placeholders in a value, as a comparable string. */
function placeholderSignature(value) {
  return [...new Set(value.match(/\{\d+\}/g) ?? [])].sort().join(',');
}

module.exports = {
  PARSERS,
  PlaceholderError,
  decodeText,
  placeholderSignature,
  toIndexedPlaceholders,
};
