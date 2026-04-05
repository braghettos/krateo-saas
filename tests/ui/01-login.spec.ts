import { test, expect } from "@playwright/test";
import { config, waitForFrontend, STORAGE_STATE } from "./helpers";
import * as fs from "fs";
import * as path from "path";

test.describe("GitHub OAuth Login", () => {
  test("frontend is reachable and shows login page", async ({ page }) => {
    await waitForFrontend(page);
    // The login page should render some form of login UI
    await expect(page).toHaveTitle(/.*/); // page loads at all
    // Look for a GitHub login button / link
    const githubBtn = page.locator(
      'button:has-text("GitHub"), a:has-text("GitHub"), ' +
      '[data-testid="github-login"], [class*="github"]'
    ).first();
    await expect(githubBtn).toBeVisible({ timeout: 15_000 });
  });

  test("GitHub OAuth flow completes and user is authenticated", async ({ page, context }) => {
    if (!config.githubUser || !config.githubPassword) {
      test.skip(true, "GITHUB_USER and GITHUB_PASSWORD env vars required");
    }

    // 1. Navigate to frontend
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // 2. Click GitHub login — this redirects to github.com
    const githubBtn = page.locator(
      'button:has-text("GitHub"), a:has-text("GitHub"), ' +
      '[data-testid="github-login"], [class*="github"]'
    ).first();
    await githubBtn.click();

    // 3. Wait for GitHub login page
    await page.waitForURL(/github\.com\/login/, { timeout: 15_000 });

    // 4. Fill in GitHub credentials
    await page.fill('input[name="login"]', config.githubUser);
    await page.fill('input[name="password"]', config.githubPassword);
    await page.click('input[type="submit"], button[type="submit"]');

    // 5. Handle 2FA if present (TOTP)
    const otpInput = page.locator('input[name="app_otp"], input[id="app_totp"]').first();
    if (await otpInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      test.skip(!config.githubTOTP, "GITHUB_TOTP_SECRET required for 2FA");
      // Dynamic TOTP import — only needed if 2FA is enabled
      // Users must provide GITHUB_TOTP_SECRET env var with the TOTP seed
      const { authenticator } = await import("otplib") as any;
      const code = authenticator.generate(config.githubTOTP);
      await otpInput.fill(code);
      await page.click('button[type="submit"]');
    }

    // 6. Handle OAuth authorization prompt (first time only)
    const authorizeBtn = page.locator('button[name="authorize"], button:has-text("Authorize")').first();
    if (await authorizeBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await authorizeBtn.click();
    }

    // 7. Wait for redirect back to Krateo frontend
    await page.waitForURL(url => !url.hostname.includes("github.com"), { timeout: 30_000 });
    await page.waitForLoadState("networkidle");

    // 8. Verify authenticated state — user avatar or menu visible
    const authIndicator = page.locator(
      '[data-testid="user-menu"], [class*="avatar"], [class*="user-info"], ' +
      '[class*="sidebar"], [class*="nav"]'
    ).first();
    await expect(authIndicator).toBeVisible({ timeout: 20_000 });

    // 9. Save auth state for subsequent tests
    const authDir = path.dirname(STORAGE_STATE);
    if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });
    await context.storageState({ path: STORAGE_STATE });
  });
});
