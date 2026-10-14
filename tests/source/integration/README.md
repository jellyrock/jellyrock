# Integration Unit Tests

**Purpose:** Test component interactions and integration with Roku platform APIs.

**Characteristics:**

- May perform real I/O (registry writes)
- Must not depend on a public server such as demo.jellyfin.org: a test that fails whenever someone else's server is down or its shared account changes says nothing about your change ([#945](https://github.com/jellyrock/jellyrock/issues/945))
- Tests multiple components working together
- Slower execution than unit tests
- Requires cleanup after execution (handled by `BaseTestSuite`)

**Build:** `npm run build:tests-integration`

**Examples:**

- Testing `user.Login()` with real registry writes
- Testing session management with persistent storage

**Cleanup:**

- Registry sections with "test-" prefix are automatically cleaned up
- BaseTestSuite.afterEach() handles cleanup
