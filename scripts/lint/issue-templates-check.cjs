// Validates .github/ISSUE_TEMPLATE/*.yml against GitHub's issue-forms schema.
//
// Why this exists: GitHub silently drops issue templates that fail schema
// validation — they don't appear on /issues/new/choose, no error surfaced
// anywhere. We hit this when an editor save normalized `title: '[Bug]: '`
// to `title: ""` across all three templates; an empty title violates the
// schema's `minLength: 1` constraint and the chooser went blank.
//
// What it checks: every YAML file under .github/ISSUE_TEMPLATE/ except
// config.yml (which has its own separate schema not covered here yet) is
// parsed and validated against the vendored schema at
// scripts/lint/issue-forms.schema.json. The schema is the JSON-Schema-Store
// mirror of GitHub's official one (https://json.schemastore.org/github-issue-forms.json)
// — re-fetch it when GitHub announces new field types or constraints.
//
// Exits 1 on any validation error, 0 when clean.

'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const Ajv = require('ajv');

const ROOT_DIR = process.cwd();
const TEMPLATE_DIR = path.join(ROOT_DIR, '.github/ISSUE_TEMPLATE');
const SCHEMA_PATH = path.join(__dirname, 'issue-forms.schema.json');

function listIssueFormFiles() {
  if (!fs.existsSync(TEMPLATE_DIR)) return [];
  return fs
    .readdirSync(TEMPLATE_DIR)
    .filter((f) => /\.ya?ml$/i.test(f) && f !== 'config.yml')
    .map((f) => path.join(TEMPLATE_DIR, f));
}

function main() {
  const files = listIssueFormFiles();
  if (files.length === 0) {
    console.log('No issue-form templates found; nothing to check.');
    return 0;
  }

  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  // The schema is Draft-07, which both ajv 6 and ajv 8 support natively.
  // Don't pass `schemaId` (ajv 6-only) or addMetaSchema — npm hoisting may
  // resolve a different ajv major than what's pinned at the top level
  // (eslint and other devDeps pull ajv transitively).
  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(schema);

  let failures = 0;
  for (const file of files) {
    const rel = path.relative(ROOT_DIR, file);
    let parsed;
    try {
      parsed = yaml.load(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      console.error(`${rel}: YAML parse error — ${err.message}`);
      failures += 1;
      continue;
    }

    if (validate(parsed)) {
      console.log(`${rel}: OK`);
      continue;
    }

    failures += 1;
    console.error(`${rel}: schema validation failed`);
    for (const err of validate.errors) {
      const where = err.dataPath || err.instancePath || '<root>';
      console.error(`  ${where}: ${err.message}`);
    }
  }

  if (failures > 0) {
    console.error(
      `\n${failures} template(s) failed validation. ` +
        'GitHub silently hides invalid issue forms from /issues/new/choose. Fix and re-run.',
    );
    return 1;
  }
  return 0;
}

process.exit(main());
