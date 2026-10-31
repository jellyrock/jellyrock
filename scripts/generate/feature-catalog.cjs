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
//   node scripts/generate/feature-catalog.cjs --release <x.y.z> --ref <tag>
//       when a release is published: change `since: unreleased` to the version on each page
//       that was unreleased in the tagged commit, then write the outputs. A page merged after
//       the tag is not in the release, so it stays unreleased. Run by release-build.yml.

'use strict';

const fs = require('fs');
const path = require('path');
const { git } = require('../lib/git-safe.cjs');
const {
  FEATURES_REL,
  INDEX_FILE,
  FEATURE_FIELDS,
  appFacts,
  featurePageFiles,
  parseFeaturePage,
} = require('../lib/feature-facts.cjs');

const args = process.argv.slice(2);
// The flags that take a value, so the value is not read as the root folder.
const VALUE_FLAGS = ['--release', '--ref'];
const flagValue = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
};
const ROOT_DIR =
  args.find((a, i) => !a.startsWith('--') && !VALUE_FLAGS.includes(args[i - 1])) || '.';
const CHECK_MODE = args.includes('--check');
const RELEASE = flagValue('--release');
const RELEASE_REF = flagValue('--ref');

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
      https: fields.httpsserver
        ? { server: fields.httpsserver, plugins: fields.httpsplugins || [] }
        : null,
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
    const httpsServer = f.https ? ` (HTTPS: ${f.https.server} or later)` : '';
    const httpsPlugins = f.https ? ` (HTTPS: ${f.https.plugins.join(' or ')})` : '';
    return `| [${f.title}](${f.slug}.md) | ${f.pitch} | ${f.server} or later${httpsServer} | ${plugins}${httpsPlugins} |`;
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
  const all = `See [all features](${INDEX_REL}).`;
  const block = [README_BEGIN, '', ...list, ...(list.length ? [''] : []), all, '', README_END].join(
    '\n',
  );
  return current.slice(0, begin) + block + current.slice(end + README_END.length);
}

// `since: unreleased` becomes the release's version on each page that was unreleased in the
// tagged commit. Reading the tag, not the working tree, keeps a feature merged after the tag
// unreleased: the release does not hold it.
function stampRelease(version, ref) {
  if (!/^\d+\.\d+\.\d+$/.test(version || '') || !ref) {
    fail(
      "--release takes a version x.y.z and --ref the release's tag, for example --release 3.4.0 --ref v3.4.0",
    );
  }
  try {
    git(ROOT_DIR, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  } catch {
    fail(`${ref} is not a commit in this repo`);
  }
  for (const name of featurePageFiles(ROOT_DIR)) {
    const rel = `${FEATURES_REL}/${name}`;
    let tagged;
    try {
      tagged = git(ROOT_DIR, ['show', `${ref}:${rel}`]);
    } catch {
      continue; // not in the release
    }
    if (parseFeaturePage(tagged).fields?.since !== 'unreleased') continue;
    const file = path.join(ROOT_DIR, rel);
    const current = fs.readFileSync(file, 'utf8');
    const stamped = current.replace(/^since: unreleased$/m, `since: ${version}`);
    if (stamped === current) continue;
    fs.writeFileSync(file, stamped);
    console.log(`docs:features: stamped since: ${version} on ${rel}`);
  }
}

if (RELEASE !== undefined || RELEASE_REF !== undefined) {
  if (CHECK_MODE) fail('--check writes nothing and --release writes pages: use one of them');
  stampRelease(RELEASE, RELEASE_REF);
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
