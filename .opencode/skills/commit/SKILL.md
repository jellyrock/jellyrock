---
name: commit
description: Commit uncommitted changes with proper security checks, conventional commits, and intelligent grouping. Analyzes changes, verifies no secrets/debug flags are committed, and creates logical commits following project conventions.
disable-model-invocation: true
user-invocable: true
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git add:*), Bash(git commit:*), Read, Glob, Edit
type: Build
---

# Commit Changes

Commit all uncommitted changes to the repository with comprehensive security checks and intelligent grouping.

## CRITICAL: Security Fixes (Edit Tool - User Approval Required)

Fix these security issues using the Edit tool (will trigger approval popup).

### 1. manifest File
**File:** `manifest`
- MUST have: `bs_const=debug=false`
- MUST NOT have: `bs_const=debug=true`
- **ACTION:** If `debug=true` is found, edit the file to change it to `debug=false`

### 2. launch.json Security  
**File:** `.vscode/launch.json`
- MUST have: `"injectRaleTrackerTask": false`
- MUST NOT have: `"injectRaleTrackerTask": true`
- MUST NOT have uncommented host or password values
- **ACTION:** If ANY security issue found, edit the file to fix it

### 3. Locale Files
**Files:** `locale/**`
- These are auto-managed by translation system
- **ACTION:** Do not commit these files

### 4. CHANGELOG.md
**File:** `CHANGELOG.md`
- This is CI-controlled (auto-updated by bot)
- **ACTION:** Do not commit manual changes to this file

### 5. Other Protected Files
- `.env*` files
- `secrets.*` or `credentials.*` files
- Private keys (`.pem`, `.key`)
- **ACTION:** Do not commit these files

## Pre-Commit Analysis

```bash
git status
git diff
git log --oneline -15
git diff --cached --name-only
git diff --name-only
```

## JellyRock Commit Conventions

Use conventional commits with JellyRock-specific patterns:

### Format
```
<type>[(scope)]: <description>
```

### Types
- **feat**: New feature
- **fix**: Bug fix  
- **refactor**: Code restructuring
- **chore**: Maintenance, formatting, dependencies
- **docs**: Documentation
- **test**: Tests
- **perf**: Performance improvements
- **style**: Code style (formatting, semicolons)

### Scopes
Use component/feature names:
- Component files: `feat(JRRowItem):`, `fix(Player):`
- Test files: `fix(test):`, `chore(test):`
- General: omit scope

### Rules
- Lowercase after colon
- Descriptive but concise
- Max 72 characters
- Present tense ("Add" not "Added")

### Examples
```
feat(JRRowItem): unified row item component
refactor(ApiClient): delegate to getApiVersionFromGlobal()
fix(test): correct misleading comment about GetGlobalAA()
chore: rename doc
```

## Understanding Changes

### Analyze Each File
- **What**: added, removed, modified
- **Why**: feature, fix, refactor, chore
- **Relationships**: dependencies between changes

## Commit Strategy

### Single Commit
- Changes are tightly coupled
- Splitting would break things

### Multiple Commits  
- Changes are logically separate
- Different commit types (feat vs chore)

**Only split if changes are independent.**

## Execution Steps

1. **Security Check**: Fix manifest, launch.json if needed
2. **Analyze Changes**: Understand what and why
3. **Ask if Unclear**: Purpose or commit type unclear
4. **Determine Strategy**: Single vs multiple commits
5. **Stage Changes**: `git add`
6. **Create Commits**: Following conventions
7. **Verify**: `git log --oneline -5`

## User Interaction

### Security (Edit Tool):
- Fix security issues using Edit tool
- Approval popup will appear
- Report what was fixed

### When to ASK:
- Don't understand why change was made
- Changes seem incomplete
- Can't determine commit type
- Merge conflicts exist

### Report Security Fixes:
- "Fixed: launch.json (RALE injection disabled)"
- "Fixed: manifest (debug mode disabled)"

## Example Workflows

### Simple Fix
```
Security check: No issues
Files: components/video/Player.bs
Type: fix

git add components/video/Player.bs
git commit -m "fix(Player): add null check for m.video to prevent crash"
```

### Multiple Commits
```
Security check: No issues
Files: Button.bs, Icon.bs, format.js

git add Button.bs Icon.bs
git commit -m "feat(ui): add icon button support"

git add format.js
git commit -m "chore: apply code formatting"
```

### Security Issue Fixed
```
Security check: launch.json has injectRaleTrackerTask=true
Edit: Change to false (approval popup)
[User approves]

Files: JRRowItem.bs

git add JRRowItem.bs launch.json
git commit -m "feat(JRRowItem): unified row item component"

Report: Fixed launch.json (RALE injection disabled)
```

## Verification

```bash
git log --oneline -5
git show --stat HEAD
git status
```
