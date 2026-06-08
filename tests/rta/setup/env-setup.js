/**
 * Vitest setupFiles — runs in EACH test worker before the specs. Configures the
 * RTA client singletons from .env (the device host/password). globalSetup runs
 * in the main process, so the worker needs its own env setup to talk to the device.
 */
import { setupRtaEnv } from '../lib/driver.js';

setupRtaEnv();
