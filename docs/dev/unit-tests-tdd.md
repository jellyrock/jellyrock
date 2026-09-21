---
topic: unit-tests-tdd
related-files:
  - bsconfig-tdd-sample.json
  - scripts/run-roku-tests.js
  - scripts/lib/env-config.cjs
  - tests/source/BaseTestSuite.spec.bs
last-reviewed: 2026-09-21
---

# Test-Driven Development (TDD) Workflow

## Overview

TDD mode enables rapid, focused development by building and running only the tests you're actively working on. This provides instant feedback and dramatically faster build times compared to running the full test suite.

**Prerequisites:** Familiarity with [unit testing basics](unit-tests.md)

**What you'll learn:**

- Setting up TDD workflow for JellyRock
- Configuring focused test execution
- TDD best practices and workflow patterns
- Troubleshooting common TDD issues

---

## Why Use TDD Mode?

- **Fast iteration**: Rebuild only the tests you're working on (seconds vs minutes)
- **Focused development**: Work on one feature/fix at a time without distractions
- **Continuous feedback**: Watch mode rebuilds automatically on save
- **Better than @ignore**: Clean, file-based filtering without polluting your codebase

---

## Setup Instructions

### 1. Create Your TDD Configuration File

```bash
cp bsconfig-tdd-sample.json bsconfig-tdd.json
```

**Note:** `bsconfig-tdd.json` is gitignored - it's your personal development config.

The sample `extends` `bsconfig-base.json`, which supplies the compiler options and every diagnostic filter, so your copy only needs `files`, `plugins` and `rooibos`. Keep it that way: a `diagnosticFilters` array in your copy replaces the base's list instead of adding to it. If your copy predates the base — it has top-level `sourceMap` / `autoImportComponentScript` keys or its own `diagnosticFilters`, and the build warns `deprecated-bsconfig-option` — re-copy the sample and re-add your spec entries.

### 2. Edit the `files` Array

Include only your test file(s):

```json
{
  "files": [
    // ... other entries ...
    "!**/*.spec.bs",  // Exclude all test files
    {
      "src": "**/BaseTestSuite.spec.bs",  // Always include base
      "dest": "source"
    },
    {
      "src": "**/YourTestFile.spec.bs",  // Your test file
      "dest": "source"
    }
  ]
}
```

**Examples:**

```json
// Working on isValid tests
"src": "**/isValid.spec.bs"

// Working on ItemGrid component tests
"src": "**/ItemGrid.spec.bs"

// Working on multiple related tests
"src": "**/DisplaySettings.spec.bs"
"src": "**/UserSettings.spec.bs"
```

### 3. Use VSCode "Run TDD tests" Launch Configuration

- Press `F5` or use Run & Debug panel
- Select **"Run TDD tests"**
- Tests rebuild automatically on save (watch mode)

---

## TDD Configuration Options

The sample config includes optimized settings for TDD:

```json
{
  "rooibos": {
    "isRecordingCodeCoverage": false,  // Faster builds
    "showOnlyFailures": true,          // Cleaner output
    "failFast": false,                 // Run all tests
    "catchCrashes": true               // Graceful error handling
  }
}
```

**Adjust for your workflow:**

- `"failFast": true` - Stop on first failure (faster feedback)
- `"showOnlyFailures": false` - Show all test results
- `"isRecordingCodeCoverage": true` - Enable coverage (slower)

---

## TDD Workflow Best Practices

### ✅ DO

- Use TDD mode for daily development
- Focus on 1-3 related test files at a time
- Use `@only` temporarily to debug specific tests
- Remove `@only` before committing

### ❌ DON'T

- Commit `bsconfig-tdd.json` (it's gitignored)
- Use `@ignore` to skip tests during development (use TDD file filtering instead)
- Leave `@only` annotations in committed code
- Include all test files (defeats the purpose)

---

## Example TDD Session

**Scenario:** Adding a new `getDisplaySetting()` function

1. Create test file: `tests/source/unit/utils/DisplaySettings.spec.bs`
2. Update `bsconfig-tdd.json`:

   ```json
   "src": "**/DisplaySettings.spec.bs"
   ```

3. Write failing test
4. Run TDD tests (`F5`)
5. Implement function
6. Watch tests pass automatically
7. Refactor with confidence
8. Before commit: Run full test suite to ensure no regressions

---

## Controlling Test Execution in TDD

### Recommended: File-Based Filtering

**For daily development**, use TDD mode to run only specific test files. This is cleaner and faster than annotation-based filtering.

### Use @only for Temporary Debugging

When debugging a specific test within your TDD session:

```brighterscript
@only  ' Temporarily run only this test
@it("debug this test")
function _()
end function
```

**⚠️ CRITICAL: Remove all `@only` annotations before committing!**

**Note:** `@only` can be used on `@suite`, `@describe`, or `@it` to focus execution at any level.

### Avoid @ignore During Development

**❌ Don't use `@ignore` to skip tests during development** - use TDD file filtering instead.

**✅ Only use `@ignore` for permanently disabled tests:**

```brighterscript
@ignore  ' TODO: Fix in ticket #123 - API endpoint deprecated
@it("calls legacy endpoint")
function _()
end function
```

**Best practice:** Always include a comment explaining why the test is ignored and reference a ticket/issue number.

---

## Troubleshooting TDD Mode

### Tests Won't Run

- Verify `bsconfig-tdd.json` exists (not the `-sample` version)
- Check `files` array includes your test file
- Ensure `BaseTestSuite.spec.bs` is included

### Builds Are Slow

- Check `isRecordingCodeCoverage: false`
- Verify only 1-3 test files are included
- Disable source maps: `"compilerOptions": { "sourceMap": false }` (a top-level `"sourceMap": false` is ignored — the base's `compilerOptions.sourceMap` wins)

### Changes Not Detected

- Save the file (`Ctrl+S`)
- Check VSCode output panel for build errors
- Restart the debug session

---

## Quick Reference

### TDD Commands

```bash
# Setup (one time)
cp bsconfig-tdd-sample.json bsconfig-tdd.json

# Edit bsconfig-tdd.json to include your test file(s)
# Then run in VSCode: "Run TDD tests" (F5)

# Build commands
npm run build:tdd                # Build TDD config (watch mode)
npm run build:tests-unit         # Build all unit tests
npm run build:tests-integration  # Build all integration tests
npm run build:tests              # Build all tests
```

### TDD File Filtering Example

```json
{
  "files": [
    "!**/*.spec.bs",
    {"src": "**/BaseTestSuite.spec.bs", "dest": "source"},
    {"src": "**/YourTest.spec.bs", "dest": "source"}
  ]
}
```

### Best Practice Comparison

```brighterscript
' ✅ GOOD - Use TDD file filtering
' In bsconfig-tdd.json:
"src": "**/DisplaySettings.spec.bs"

' ❌ BAD - Using @ignore during development
@ignore  ' Working on other tests first
@it("test I'll do later")

' ⚠️ ACCEPTABLE - Temporary debugging only (MUST remove before commit)
@only
@it("debugging this specific test")
```

**Why:** TDD file filtering keeps your codebase clean, builds faster, and prevents accidental commits of ignored tests.

---

## Agent Workflow Notes

These notes apply when an automated agent (Claude Code, etc.) needs to run tests from a CLI session rather than the VSCode "Run TDD tests" launch.

### Running

- **Single spec (TDD)**: `npm run test:tdd` — builds with `bsconfig-tdd.json` and deploys to the Roku at `ROKU_IP`.
- **Broader runs**: `npm run test:unit`, `npm run test:integration`, `npm run test:all`.
- The runner ([`scripts/run-roku-tests.js`](../../scripts/run-roku-tests.js)) zips the build, sideloads to the Roku, and tails the debug console for `[Rooibos Result]: PASS|FAIL`.

### Roku Credentials (`.env` and the per-user env file)

Every tool reads its device settings (`ROKU_IP`, `ROKU_PASSWORD`, `ROKU_DEVICES`, …) from the environment, filled from two files that never enter the repo. Highest precedence first:

1. **Variables already set** in your shell or by a parent process. Never overwritten.
2. **The checkout's `.env`** at the repo root. Use it for a per-checkout override, such as one folder pointed at a different device.
3. **The per-user file** `~/.config/jellyrock/env` (or `$XDG_CONFIG_HOME/jellyrock/env`). Put your defaults here once and every checkout of the repo uses them.

Both files use the `.env.example` format. An **empty value in a file counts as unset**, so a `.env` copied from `.env.example` with blank keys does not hide the per-user file. The exceptions are `MEASURE_SIGNIN_PASSWORD`, `RTA_SERVER_PASS` and `JELLYFIN_VERSION_SERVERS_PASS`, where blank means an account with no password, so `.env.example` ships those commented out. **The per-user file is skipped under GitHub Actions**, so CI is configured only by its workflow, and whenever `JELLYROCK_USER_ENV=off` is set (the scripts' unit tests set it). To stop using a device for a while, comment out the full `ROKU_DEVICES` line and keep a shorter active one below it. `npm run device:check` prints which file its device list came from. The rules live in [`scripts/lib/env-config.cjs`](../../scripts/lib/env-config.cjs).

If neither file exists, source the values from the user's VSCode settings:

```bash
grep -E '"brightscript\.debug\.(host|password)"' ~/.config/Code/User/settings.json
```

…and write them as `ROKU_IP=...` / `ROKU_PASSWORD=...` to the per-user file (`chmod 600` it), or to `.env` for this checkout only.

### Debugger Contention

If a VSCode BrightScript debugger session is already attached to the test device, the deploy will fail (ECP refuses the second sideload) and may also kill the active debugger. Surface this to the user — do not retry blindly.

### When Hardware Isn't Available

**Check before you conclude it isn't: `npm run device:check`.** It probes every device in `.env` over ECP and tells you which answered. A device that answers is a device you can test on — run the tests.

If the probe genuinely fails (no `.env`, no device on the network, debugger holding the port), say so explicitly, and say *the probe failed* rather than that you lack access. Do not claim a fix was tested when only the build (`npm run build:tdd`) was verified.

ECP answering is not a promise that a sideload will succeed — dev mode off, or a `ROKU_PASSWORD` belonging to a different device, still fails at deploy. That is a different (and also checkable) report.

---

## Related Documentation

- [Unit Testing Guide](unit-tests.md) - Core testing concepts and Rooibos framework
- [Logging Guide](logging.md) - Using roku-log for runtime debugging
- [Developer Guide](DEVGUIDE.md) - General development workflow
