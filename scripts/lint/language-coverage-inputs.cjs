'use strict';

// The repo-relative files and folder that language-coverage.cjs reads. The script
// runs on load and exits, so it cannot export these itself. Keeping them here lets
// the CI and pre-push triggers be checked against the real inputs
// (tests/scripts/unit/lint/language-coverage-trigger-parity.test.js).

module.exports = {
  LANGS_BS: 'source/utils/languages.bs',
  PEOPLE_BS: 'source/utils/people.bs',
  EN_US: 'locale/custom/en_US.json',
  FINGERPRINT_DIR: 'docs/architecture/spec-fingerprints',
};
