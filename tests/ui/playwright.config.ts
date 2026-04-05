import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1, // sequential — tests share browser state via storageState

  use: {
    baseURL: process.env.KRATEO_FRONTEND_URL || "http://localhost:30080",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "retain-on-failure",
  },

  projects: [
    {
      name: "login",
      testMatch: "01-login.spec.ts",
    },
    {
      name: "portal",
      testMatch: "02-portal.spec.ts",
      dependencies: ["login"],
    },
    {
      name: "tenant",
      testMatch: "03-tenant.spec.ts",
      dependencies: ["portal"],
    },
  ],

  outputDir: "./test-results",
});
