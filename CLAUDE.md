# JellyRock Developer Guide
JellyRock is a Jellyfin client for Roku devices allowing users to consume media from their personal Jellyfin servers.
## Technologies used
- **BrighterScript (.bs)** - Primary language, compiles to BrightScript (.brs)
- **(RSG) Roku Scene Graph (.xml)** - Node-based UI framework (NOT HTML!)
- **Jellyfin API** - Via `source/api/sdk.bs`, Task Node pattern required
## ⚠️ Mandatory Agent Rules ⚠️
1. DO NOT make things up or assume
2. Ask clarifying questions when you are not sure about something
3. Focus on best practices, industry standards, and easy long term maintenance
4. ALWAYS look for the best possible solution to a problem then provide the user with their best options
5. Iterate on a plan with the user until they approve it, and only then begin coding
6. After finishing a user-approved plan: run automated tests to verify; provide a manual test plan only for UI/runtime behavior tests don't cover, plus any expected debug-log output
## Development Context
**Check relevant docs for specific areas:**
- **Adding user settings?** → `docs/dev/adding-user-settings.md`
- **Writing tests?** → `docs/dev/unit-tests.md`
- **Running tests?** → `docs/dev/unit-tests-tdd.md`
- **Registry migrations?** → `docs/dev/registry-migrations.md`
- **Debug flags / toast testing?** → `docs/dev/debug-flags.md`
**All dev docs:** `docs/dev/`
## Development Workflow
### IDE Integration
- `brightscript.projects` (in `.vscode/settings.json`) drives auto-build/validate via the BrighterScript extension during dev.
- **Don't run `npm run validate` / `npm run build:*` / `npm run lint*` manually** — the IDE already runs them, and the pre-push hook runs validate as a backstop. Manual runs waste tokens and time.
### Agent Restrictions
- **Cannot modify CHANGELOG.md** (CI-controlled only).
### Running Tests
- Run tests to verify fixes — do not commit test changes based on reasoning alone.
- TDD (single spec): `npm run test:tdd` (after editing `bsconfig-tdd.json`). Broader: `npm run test:unit | test:integration | test:all`.
- Setup, credentials, debugger contention → [docs/dev/unit-tests-tdd.md](docs/dev/unit-tests-tdd.md).
### Pre-push Hook (husky)
- `.husky/pre-push` runs on `git push`. Mirrors the CI lint suite, scoped to files in the push range:
  - **Auto-fix** (mutating; combined into a single `chore: auto-fix via pre-push hook` commit; never amends):
    1. `bsfmt --write` on `*.bs`/`*.brs`
    2. `npm run update-translations` if BS source / `locale/**` / `settings/settings.json` changed
  - **Check** (read-only; non-zero exit aborts the push):
    3. `npm run validate` — `*.bs`/`*.brs`/`*.xml`/`bsconfig*.json` changes
    4. `npm run lint:markdown` + `npm run lint:spelling` — `*.md` changes
    5. `npm run lint:json` — `*.json` changes
- Requires a clean working tree for auto-fix so WIP can't be swept into the auto-fix commit. If dirty, auto-fix is skipped (with warning); checks still run.
- Bypass with `git push --no-verify` if you must.
### Commit Messages
- Conventional Commits style (matches `git log`): `type(scope): summary`. No `Co-Authored-By` footer.
### Code Standards
- **Follow [docs/dev/code-style.md](docs/dev/code-style.md)** for naming, formatting, and BrightScript patterns.

## Architecture Overview
### `SceneManager` System
- Stack navigation: `pushScene()`, `popScene()`, `clearScenes()`
- Lifecycle: `OnScreenShown()`, `OnScreenHidden()`
- Component hierarchy: `JRScene` → `JRScreen`/`JRGroup`
- Focus management with `lastFocus` preservation
### Global State Structure
- `m.global.app` - App state
- `m.global.constants` - UI constants
- `m.global.device` - Device state
- `m.global.server` - The active Jellyfin server state
- `m.global.user` - Authenticated user state
- `m.global.user.settings` - User setting configuration. Contains child nodes `user` and `policy`, which hold the Jellyfin server authoritative config data.
  Example: `m.global.user.settings.user`, `m.global.user.settings.policy`
## Folder Structure & Scoping Rules
### Component Folder (`components/`)
- **ONLY place XML files allowed in project**
- XML + BS file pairs with same name auto-scope together
- Organized by feature (video/, login/, settings/, etc.)
### Source Folder (`source/`)
- **BS files only** - no XML allowed
- Files auto-scope together, no imports needed
- **BUT**: Must import to use in components: `import "pkg:/source/..."`
### Scripts Folder (`scripts/`)
- JavaScript files for NPM build processes
- Build automation and tooling scripts
### Settings (`settings/settings.json`)
- **Single source of truth** for all app settings
- Default values and configuration options
- User preferences and app behavior controls
### Tests Structure (`tests/`)
- **Unit tests** (`source/unit/`): Isolated function testing, no I/O
- **Integration tests** (`source/integration/`): Component interactions, real I/O allowed
- **E2E tests** (`source/e2e/`): UI automation (future RTA implementation)
### Build (`build/`)
- Transpiled `.brs` files from BrighterScript compilation
- **These are the actual deployed files** shown in runtime logs
## Roku-Specific Requirements
### Render Thread Protection
- **ALL API calls and I/O operations via Task Nodes only** (use `source/api/sdk.bs` for API calls)
- Single field access: direct OK (m.global.device.locale)
- Multiple `m.global.child` access: cache local reference first (`globalUser = m.global.user`) to reduce render thread overhead
- Use `getFields()`/`setFields()` for bulk operations
### Component Patterns
- File pairing: same base name auto-scopes XML+BS together
- Use import statements (not XML script tags)
- `isValid()` for conditional invalid checks
- `onKeyEvent()`: return true = handled, false = bubble up
### Task Node Field Types
- **assocarray**: Pass multiple input parameters
- **node/nodearray**: Handle large data transfers
- **string**: Simple single parameters
### Input Event Handling
- `onKeyEvent(key, press) as boolean`
- `return true` = event consumed, no bubble
- `return false` = event bubbles up to parent
