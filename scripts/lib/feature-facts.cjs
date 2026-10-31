// Facts about the app and its feature pages, read the same way by the check
// that guards them (scripts/lint/docs-check.cjs) and the generator that
// publishes them (scripts/generate/feature-catalog.cjs).
//
// Stdlib only, like scripts/lib/frontmatter.cjs. Reading a value as real YAML is
// the check's job, not this file's: see yamlMisreading() in docs-check.cjs.

'use strict';

const fs = require('fs');
const path = require('path');
const { readFrontmatter } = require('./frontmatter.cjs');

const FEATURES_REL = 'docs/user/features';
// The generated index of the feature pages. It is not a feature page itself.
const INDEX_FILE = 'index.md';

// A feature page's frontmatter: flat `key: value` lines, a list comma-separated.
const FEATURE_FIELDS = {
  pitch: { required: true },
  since: { required: true },
  server: { required: true },
  plugins: { required: false, list: true },
  screenshots: { required: false, list: true },
  // A rank from 1 puts the page in the README's short list, in that order;
  // the field left out means no.
  highlight: { required: false },
};

// The most pages the README lists, so its features list stays a short pitch
// and the full list lives in the features index. Ranks run 1 to this.
const README_HIGHLIGHTS_MAX = 6;

function readJson(root, rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
}

// The oldest supported server: the top-level `floor:` in the version map that
// scripts/lib/version-boundaries.cjs validates, read with a pattern so this
// file needs no YAML library.
function readServerFloor(root) {
  const map = fs.readFileSync(path.join(root, 'docs/dev/jellyfin-version-boundaries.yml'), 'utf8');
  const match = map.match(/^floor: '([0-9.]+)'$/m);
  if (!match) throw new Error('no `floor:` in docs/dev/jellyfin-version-boundaries.yml');
  return match[1];
}

// Languages: the entries in locale/languages.json with a code ("Automatic" has
// none and is not a language). Themes: the uiTheme presets, without Custom,
// which is the viewer's own colors.
function appFacts(root) {
  const languages = readJson(root, 'locale/languages.json').filter((l) => l.code).length;
  let themes = null;
  const walk = (entries) => {
    for (const e of entries) {
      if (e.settingName === 'uiTheme') themes = e.options.filter((o) => o.id !== 'custom').length;
      if (e.children) walk(e.children);
    }
  };
  walk(readJson(root, 'settings/settings.json'));
  return { languages, themes, floor: readServerFloor(root) };
}

function appVersion(root) {
  return readJson(root, 'package.json').version;
}

function compareVersions(a, b) {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] || 0) - (y[i] || 0);
  return 0;
}

// The plugin names in the first column of the plugins page's table.
function listedPlugins(root) {
  const page = fs.readFileSync(path.join(root, 'docs/user/jellyfin-server-plugins.md'), 'utf8');
  return new Set([...page.matchAll(/^\| \[([^\]]+)\]\(/gm)].map((m) => m[1]));
}

function screenshotKeys(root) {
  return new Set(readJson(root, 'docs/screenshots/screenshots.json').screens);
}

// The feature pages' file names, sorted, without the generated index.
function featurePageFiles(root) {
  const dir = path.join(root, FEATURES_REL);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f !== INDEX_FILE)
    .sort();
}

// Parse one feature page: its title (the first H1), its fields, and the lines
// that are not a known `key: value` (each a message). `fields` is null when the
// page has no frontmatter.
function parseFeaturePage(content) {
  const fm = readFrontmatter(content);
  const body = fm === null ? content : content.slice(content.indexOf('\n---', 3) + 4);
  const h1 = body.match(/^#\s+(.+)$/m);
  const title = h1 ? h1[1].trim() : null;
  if (fm === null) return { title, fields: null, raw: null, problems: [] };
  const fields = {};
  const raw = {}; // each value as written, a list still one string
  const problems = [];
  for (const line of fm.split(/\r?\n/)) {
    const match = line.match(/^([a-z]+): (.+)$/);
    if (!match) {
      problems.push(`frontmatter line is not \`key: value\`: ${line}`);
    } else if (!(match[1] in FEATURE_FIELDS)) {
      problems.push(
        `unknown field \`${match[1]}:\` (known: ${Object.keys(FEATURE_FIELDS).join(', ')})`,
      );
    } else {
      const value = match[2].trim();
      raw[match[1]] = value;
      fields[match[1]] = FEATURE_FIELDS[match[1]].list
        ? value
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean)
        : value;
    }
  }
  return { title, fields, raw, problems };
}

module.exports = {
  FEATURES_REL,
  INDEX_FILE,
  FEATURE_FIELDS,
  README_HIGHLIGHTS_MAX,
  readServerFloor,
  appFacts,
  appVersion,
  compareVersions,
  listedPlugins,
  screenshotKeys,
  featurePageFiles,
  parseFeaturePage,
};
