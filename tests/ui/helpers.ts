import { Page, expect } from "@playwright/test";

/** Storage state file shared between test projects. */
export const STORAGE_STATE = "tests/ui/.auth/state.json";

/** Environment-driven config. */
export const config = {
  frontendURL: process.env.KRATEO_FRONTEND_URL || "http://localhost:30080",
  githubUser: process.env.GITHUB_USER || "",
  githubPassword: process.env.GITHUB_PASSWORD || "",
  githubTOTP: process.env.GITHUB_TOTP_SECRET || "", // optional 2FA
  tenantName: process.env.TENANT_NAME || "ui-test-tenant",
  tenantPlan: process.env.TENANT_PLAN || "free",
};

/**
 * Wait for the Krateo frontend to be reachable.
 * Retries with a short delay — useful right after cluster startup.
 */
export async function waitForFrontend(page: Page, maxRetries = 10) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await page.goto("/", { waitUntil: "domcontentloaded" });
      if (res && res.status() < 500) return;
    } catch {
      // connection refused — cluster not ready yet
    }
    await page.waitForTimeout(3_000);
  }
  throw new Error(`Frontend at ${config.frontendURL} not reachable after ${maxRetries} retries`);
}

/**
 * Assert we are on an authenticated page (not the login screen).
 */
export async function expectAuthenticated(page: Page) {
  // The login page typically has a GitHub login button; authenticated pages do not.
  // Wait for either an avatar/user element or the absence of the login button.
  await expect(
    page.locator('[data-testid="user-menu"], [class*="avatar"], [class*="user-info"]').first()
  ).toBeVisible({ timeout: 20_000 });
}
