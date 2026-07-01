// api specs drive the server via the `request` fixture and never touch a browser, so they use
// the plain playwright test - NOT tests/fixtures.ts, whose auto coverage fixture forces a
// chromium page + V8 coverage start/stop per test (zero client coverage for an api-only test,
// but real cpu/memory contention on a 2-core runner and 90+ empty coverage reports at the end).
export { expect, test } from '@playwright/test';
