#!/usr/bin/env node

// CI guard: Ensure no hardcoded translatable strings in XML attributes.
//
// Checks:
// - text= attributes don't contain English-translatable strings
// - <field type="string" value="..."> don't contain translatable text
//
// Exits with error code on failure.

const fs = require('fs');
const path = require('path');
const fg = require('fast-glob');

const ROOT_DIR = process.cwd();

const XML_PATTERNS = [
  'components/**/*.xml',
  '!node_modules/**',
  '!**/roku_modules/**',
  '!build/**',
  '!out/**'
];

// Legitimate non-translatable text= values
const ALLOWED_TEXT_VALUES = new Set([
  '',       // empty — correct pattern (set dynamically in BrightScript)
  ':',      // clock separator (Clock.xml)
  '0:00',   // timestamp placeholder (AudioPlayerView.xml)
  '\u2713', // checkmark symbol (JRPoster.xml)
]);

// Legitimate non-translatable field string values
const ALLOWED_FIELD_VALUES = new Set([
  'jellyfin server', // Constants.xml: protocol response identifier, not user-facing
]);

/**
 * Returns true if a text= value looks like translatable English text.
 * Allows empty strings, single characters, symbols, and numbers.
 */
function textLooksTranslatable(value) {
  if (ALLOWED_TEXT_VALUES.has(value)) return false;
  // Allow single characters (symbols, punctuation)
  if (value.length <= 1) return false;
  // Flag if it contains word-like alphabetic content (2+ letters in a row)
  return /[a-zA-Z]{2,}/.test(value);
}

/**
 * Returns true if a <field type="string" value="..."> looks like translatable text.
 * Allows empty strings, single words, paths, hex colors, numbers, etc.
 */
function fieldValueLooksTranslatable(value) {
  if (ALLOWED_FIELD_VALUES.has(value)) return false;
  if (value === '') return false;
  // Allow paths (pkg:/, http://, https://, tmp:/, etc.)
  if (/^(pkg:|http:|https:|tmp:)/.test(value)) return false;
  // Allow hex colors (0x...)
  if (/^0x[0-9a-fA-F]+$/.test(value)) return false;
  // Allow pure numbers (integers, decimals, negatives)
  if (/^-?\d+(\.\d+)?$/.test(value)) return false;
  // Allow booleans
  if (value === 'true' || value === 'false') return false;
  // Allow single words (camelCase, PascalCase, enum-like) — no spaces
  if (!/\s/.test(value)) return false;
  // Has spaces — flag if it looks like natural language (2+ words with letters)
  return /[a-zA-Z]+\s+[a-zA-Z]+/.test(value);
}

/**
 * Extracts <field> elements with type="string" and a value= attribute.
 * Handles attribute order variations.
 */
function extractStringFieldValue(line) {
  // Must be a <field element
  if (!/<field\s/.test(line)) return null;
  // Must have type="string"
  const typeMatch = line.match(/\btype="string"/);
  if (!typeMatch) return null;
  // Extract value attribute
  const valueMatch = line.match(/\bvalue="([^"]*)"/);
  if (!valueMatch) return null;
  return valueMatch[1];
}

async function main() {
  const errors = [];

  const files = await fg(XML_PATTERNS, { cwd: ROOT_DIR, absolute: true });

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const relativePath = path.relative(ROOT_DIR, filePath);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Check text= attributes
      const textMatches = line.matchAll(/\btext="([^"]*)"/g);
      for (const match of textMatches) {
        const value = match[1];
        if (textLooksTranslatable(value)) {
          errors.push({
            file: relativePath,
            line: lineNum,
            message: `Hardcoded text: text="${value}"`,
            hint: 'Set text="" in XML and use translate(translationKeys.Key) in BrightScript'
          });
        }
      }

      // Check <field type="string" value="..."> elements
      const fieldValue = extractStringFieldValue(line);
      if (fieldValue !== null && fieldValueLooksTranslatable(fieldValue)) {
        errors.push({
          file: relativePath,
          line: lineNum,
          message: `Translatable field value: value="${fieldValue}"`,
          hint: 'Set value="" in XML and use translate(translationKeys.Key) in BrightScript'
        });
      }
    }
  }

  if (errors.length > 0) {
    console.error(`\nXML translation guard failed (${errors.length} error(s)):\n`);
    for (const err of errors) {
      console.error(`  \u2717 ${err.file}:${err.line} \u2014 ${err.message}`);
      console.error(`    ${err.hint}`);
    }
    process.exit(1);
  }

  console.log(`\u2713 XML translation guard passed (${files.length} files scanned)`);
}

main().catch(err => { console.error(err); process.exit(1); });
