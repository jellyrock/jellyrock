// Builds the feature catalog from the frontmatter of the feature pages in
// docs/user/features/, so a feature is described once and every place that
// lists features shows the same thing.
//
// What it writes:
//   - docs/feature-catalog.json: every feature's facts and the app's counts,
//     for the marketing site to read at build time (a `schema` number marks
//     changes to its shape).
//   - docs/user/features/index.md: the features index on the docs site.
//   - README.md: the highlighted features, in their `highlight:` rank, between
//     its generated markers, then a link to the features index.
//
// It refuses a page whose frontmatter is missing a required field or holds an
// unknown one, rather than publish it; `npm run lint:docs` checks every value.
// The fields and their parsing are in scripts/lib/feature-facts.cjs.
//
// Run modes:
//   node scripts/generate/feature-catalog.cjs           write (default)
//   node scripts/generate/feature-catalog.cjs --check   fail if an output is stale, write nothing

'use strict';

const fs = require('fs');
const path = require('path');
const {
  FEATURES_REL,
  INDEX_FILE,
  FEATURE_FIELDS,
  appFacts,
  featurePageFiles,
  parseFeaturePage,
} = require('../lib/feature-facts.cjs');

const args = process.argv.slice(2);
const ROOT_DIR = args.find((a) => !a.startsWith('--')) || '.';
const CHECK_MODE = args.includes('--check');

const CATALOG_REL = 'docs/feature-catalog.json';
const INDEX_REL = `${FEATURES_REL}/${INDEX_FILE}`;
const README_REL = 'README.md';
const README_BEGIN = '<!-- BEGIN generated features (npm run docs:features) -->';
const README_END = '<!-- END generated features -->';
const DOCS_SITE = 'https://docs.jellyrock.app';

function fail(message) {
  console.error(`docs:features: ${message}`);
  process.exit(1);
}

function readFeatures() {
  const problems = [];
  const features = [];
  for (const name of featurePageFiles(ROOT_DIR)) {
    const rel = `${FEATURES_REL}/${name}`;
    const {
      title,
      fields,
      problems: lines,
    } = parseFeaturePage(fs.readFileSync(path.join(ROOT_DIR, rel), 'utf8'));
    const found = [...lines];
    if (fields === null) found.push('has no frontmatter');
    else {
      for (const [key, { required }] of Object.entries(FEATURE_FIELDS)) {
        if (required && !(key in fields)) found.push(`missing \`${key}:\``);
      }
    }
    if (!title) found.push('has no # title');
    if (found.length) {
      problems.push(...found.map((p) => `${rel}: ${p}`));
      continue;
    }
    const slug = name.replace(/\.md$/, '');
    features.push({
      slug,
      title,
      pitch: fields.pitch,
      since: fields.since,
      server: fields.server,
      plugins: fields.plugins || [],
      screenshots: fields.screenshots || [],
      highlight: fields.highlight ? Number(fields.highlight) : null,
      page: rel,
      url: `${DOCS_SITE}/features/${slug}/`,
    });
  }
  if (problems.length) {
    fail(
      `${problems.join('\n')}\nFix the page, then run again (npm run lint:docs checks every field).`,
    );
  }
  return features.sort((a, b) => a.title.localeCompare(b.title));
}

function buildCatalog(features) {
  const { languages, themes, floor } = appFacts(ROOT_DIR);
  const catalog = {
    _comment: `Generated from the frontmatter of ${FEATURES_REL}/*.md by npm run docs:features. Edit the pages, not this file.`,
    schema: 1,
    app: { languages, themes, serverFloor: floor },
    // The README's pick is not a fact about the feature: the site reads none of it.
    features: features.map(({ highlight: _highlight, ...feature }) => feature),
  };
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

function buildIndex(features) {
  const rows = features.map((f) => {
    const plugins = f.plugins.length ? f.plugins.join(' or ') : 'None';
    return `| [${f.title}](${f.slug}.md) | ${f.pitch} | ${f.server} or later | ${plugins} |`;
  });
  return [
    '# Features',
    '',
    "<!-- Generated from the feature pages' frontmatter by npm run docs:features. Edit the pages, not this file. -->",
    '',
    'What JellyRock does, one page per feature. Each page says what the feature needs and how to use it.',
    '',
    '| Feature | What you get | Jellyfin server | Server plugin |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}

function buildReadme(features, current) {
  const begin = current.indexOf(README_BEGIN);
  const end = current.indexOf(README_END);
  if (begin === -1 || end === -1 || begin > end) {
    fail(`${README_REL} is missing its markers, in this order:\n${README_BEGIN}\n${README_END}`);
  }
  const list = features
    .filter((f) => f.highlight)
    .sort((a, b) => a.highlight - b.highlight)
    .map((f) => `- **[${f.title}](${f.page}):** ${f.pitch}`);
  const all = `See [all ${features.length} features](${INDEX_REL}).`;
  const block = [README_BEGIN, '', ...list, ...(list.length ? [''] : []), all, '', README_END].join(
    '\n',
  );
  return current.slice(0, begin) + block + current.slice(end + README_END.length);
}

const features = readFeatures();
const readmePath = path.join(ROOT_DIR, README_REL);
const outputs = [
  [CATALOG_REL, buildCatalog(features)],
  [INDEX_REL, buildIndex(features)],
  [README_REL, buildReadme(features, fs.readFileSync(readmePath, 'utf8'))],
];

const stale = outputs.filter(([rel, content]) => {
  const file = path.join(ROOT_DIR, rel);
  return !fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content;
});

if (CHECK_MODE) {
  if (stale.length) {
    fail(`out of date: ${stale.map(([rel]) => rel).join(', ')}. Run npm run docs:features.`);
  }
  console.log(`docs:features: ${features.length} feature(s), every output up to date.`);
  process.exit(0);
}

for (const [rel, content] of stale) fs.writeFileSync(path.join(ROOT_DIR, rel), content);
console.log(
  `docs:features: ${features.length} feature(s); ${stale.length ? `wrote ${stale.map(([rel]) => rel).join(', ')}` : 'no changes'}.`,
);
