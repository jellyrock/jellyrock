// Validates that every _lint-*.yml, _test-*.yml, and _smoke-test-*.yml
// reusable workflow under .github/workflows/ is listed as a job in
// _validate-dependencies.yml.
//
// Why: _validate-dependencies.yml re-runs every verification reusable
// unconditionally on dep-update PRs. If a new reusable is added without
// a matching entry here, dep bumps that break it will silently land green.
//
// _build-*.yml helpers are excluded — they're called on-demand, not
// verification reusables. _validate-dependencies.yml itself is excluded
// (it's the orchestrator, not a reusable).
//
// Only Node stdlib — no npm ci needed.

'use strict';

const fs = require('fs');
const path = require('path');

const workflowsDir = path.resolve(__dirname, '../../.github/workflows');
const orchestratorFile = '_validate-dependencies.yml';
const orchestratorPath = path.join(workflowsDir, orchestratorFile);

const REUSABLE_PATTERN = /^_(lint|test|smoke-test)-.*\.yml$/;

const reusables = fs
  .readdirSync(workflowsDir)
  .filter((f) => REUSABLE_PATTERN.test(f))
  .sort();

const orchestratorContent = fs.readFileSync(orchestratorPath, 'utf8');
const usesPattern = /uses:\s+\.\/\.github\/workflows\/([^\s]+)/g;
const referenced = new Set();
let m;
while ((m = usesPattern.exec(orchestratorContent)) !== null) {
  referenced.add(m[1]);
}

const missing = reusables.filter((f) => !referenced.has(f));

if (missing.length > 0) {
  console.error('❌ _validate-dependencies.yml is missing entries for:');
  missing.forEach((f) => console.error('   ' + f));
  console.error(
    '\nAdd a job with `force: true` for each missing file so dep-update PRs run those checks.',
  );
  process.exit(1);
}

console.log(`✅ _validate-dependencies.yml covers all ${reusables.length} verification reusables.`);
