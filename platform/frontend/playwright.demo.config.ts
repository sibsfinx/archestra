import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

if (process.env.PLAYWRIGHT_BROWSERS_PATH?.includes("cursor-sandbox-cache")) {
  delete process.env.PLAYWRIGHT_BROWSERS_PATH;
}

const here = dirname(fileURLToPath(import.meta.url));
const recordingsRoot = resolve(here, "../../../recordings/.demo");

function chromiumProjectUse() {
  const userCache = resolve(homedir(), "Library/Caches/ms-playwright");
  if (existsSync(userCache)) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = userCache;
  }

  return {
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    launchOptions: { slowMo: 280 },
    contextOptions: {
      recordVideo: {
        dir: resolve(recordingsRoot, "_video-tmp"),
        size: { width: 1440, height: 900 },
      },
    },
  };
}

const INT_TESTS_PORT =
  process.env.ARCHESTRA_FRONTEND_INT_TESTS_PORT ??
  readFileSync(resolve(here, "../.env"), "utf8").match(
    /^\s*ARCHESTRA_FRONTEND_INT_TESTS_PORT\s*=\s*(\S+)/m,
  )?.[1] ??
  "3010";
const INT_TESTS_URL = `http://127.0.0.1:${INT_TESTS_PORT}`;

export default defineConfig({
  testDir: "./tests-integration",
  testMatch: "**/record-onboarding-mail-demo.spec.ts",
  tsconfig: "./tests-integration/tsconfig.json",
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  reporter: "list",
  outputDir: resolve(recordingsRoot, "test-results"),
  use: {
    baseURL: INT_TESTS_URL,
    video: "on",
    trace: "off",
    screenshot: "off",
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
  expect: { timeout: 15_000 },
  projects: [{ name: "chromium", use: chromiumProjectUse() }],
  webServer: {
    command: `next dev -H 127.0.0.1 -p ${INT_TESTS_PORT}`,
    url: INT_TESTS_URL,
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_API_MOCKING: "enabled",
      ARCHESTRA_INTERNAL_API_BASE_URL: "http://127.0.0.1:1",
      NEXT_PUBLIC_SENTRY_DSN: "",
    },
  },
});
