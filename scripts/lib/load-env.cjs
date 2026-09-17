// scripts/lib/load-env.cjs — import this for its side effect, the way `dotenv/config`
// is used: `import '<path>/scripts/lib/load-env.cjs'` (or `require(...)`).
//
// Loads the checkout's `.env` and the per-user `~/.config/jellyrock/env` into
// `process.env`. The rules live in `env-config.cjs`.

require('./env-config.cjs').loadEnv();
