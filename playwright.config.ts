import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

const APP_PORT = 3100;
const MOCK_PORT = 4010;
export const FREE_PORT = 3200;
export const HOSTED_PORT = 3300;
export const SUPABASE_APP_PORT = 3400;
export const BRIDGE_PORT = 7871;
const BRIDGE_TOKEN = "e2e-bridge-token";
const API_KEY = "e2e_id:e2e_secret_value_123456";
export const E2E_PASSWORD = "e2e-password";

/* Use the pre-installed Chromium when present (sandboxed CI images ship one);
   otherwise Playwright's own download. */
const CHROMIUM = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}`,
    httpCredentials: { username: "owner", password: E2E_PASSWORD },
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(existsSync(CHROMIUM) ? { launchOptions: { executablePath: CHROMIUM } } : {}),
      },
    },
  ],
  webServer: [
    {
      command: "node tests/e2e/mock-provider.mjs",
      url: `http://127.0.0.1:${MOCK_PORT}/asset.png`,
      env: { MOCK_PROVIDER_PORT: String(MOCK_PORT), MOCK_EXPECTED_KEY: API_KEY },
      reuseExistingServer: false,
    },
    {
      /* The production build: React's masking of thrown server-action errors
         only happens there, which is the bug this suite guards against. */
      command: `pnpm build && pnpm start -p ${APP_PORT}`,
      url: `http://127.0.0.1:${APP_PORT}/api/health`,
      timeout: 240_000,
      reuseExistingServer: false,
      env: {
        HF_API_BASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
        HF_API_KEY: API_KEY,
        APP_PASSWORD: E2E_PASSWORD,
        STORAGE_DRIVER: "local",
        PUBLIC_BASE_URL: `http://127.0.0.1:${APP_PORT}`,
        LOCAL_UPLOAD_DIR: ".uploads-e2e",
        ALLOW_PRIVATE_MEDIA_URLS: "true",
      },
    },
    {
      /* WanGP bridge in fake mode: the real bridge code, no GPU. Each job
         takes ~6s so a run can be watched and canceled. */
      command: `python3 bridge/wangp_bridge.py --fake --port ${BRIDGE_PORT} --token ${BRIDGE_TOKEN} --output-dir .bridge-e2e --fake-steps 24 --fake-step-seconds 0.25`,
      url: `http://127.0.0.1:${BRIDGE_PORT}/v1/health`,
      reuseExistingServer: false,
    },
    {
      /* The same build with no provider configured at all: free mode. */
      command: `pnpm start -p ${FREE_PORT}`,
      url: `http://127.0.0.1:${FREE_PORT}/api/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        HF_API_BASE_URL: "",
        HF_API_KEY: "",
        APP_PASSWORD: "",
        LOCAL_SD_URL: `http://127.0.0.1:${MOCK_PORT}`,
        LOCAL_UPLOAD_DIR: ".uploads-e2e",
        WANGP_URL: `http://127.0.0.1:${BRIDGE_PORT}`,
        WANGP_TOKEN: BRIDGE_TOKEN,
      },
    },
    {
      /* Like the hosted site: no GPU, no key, no storage. */
      command: `pnpm start -p ${HOSTED_PORT}`,
      url: `http://127.0.0.1:${HOSTED_PORT}/api/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: { HF_API_BASE_URL: "", HF_API_KEY: "", APP_PASSWORD: "", WANGP_URL: "", STORAGE_DRIVER: "", LOCAL_SD_URL: "" },
    },
    {
      /* The hosted site with Vercel's Supabase integration connected. */
      command: `pnpm start -p ${SUPABASE_APP_PORT}`,
      url: `http://127.0.0.1:${SUPABASE_APP_PORT}/api/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        HF_API_BASE_URL: "",
        HF_API_KEY: "",
        APP_PASSWORD: "",
        WANGP_URL: "",
        STORAGE_DRIVER: "",
        LOCAL_SD_URL: "",
        SUPABASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
        SUPABASE_SERVICE_ROLE_KEY: "e2e_supabase_key",
      },
    },
  ],
});
