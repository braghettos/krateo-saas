import { test, expect } from "@playwright/test";
import { STORAGE_STATE } from "./helpers";
import * as fs from "fs";

// Reuse authenticated session from login test
test.use({
  storageState: fs.existsSync(STORAGE_STATE) ? STORAGE_STATE : undefined,
});

test.describe("Portal Navigation and Blueprint Discovery", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test("portal home page renders after login", async ({ page }) => {
    // Authenticated user should see the portal, not the login page
    const loginBtn = page.locator(
      'button:has-text("GitHub"), a:has-text("GitHub"), [data-testid="github-login"]'
    ).first();
    // Login button should NOT be visible — we are already authenticated
    await expect(loginBtn).not.toBeVisible({ timeout: 10_000 }).catch(() => {
      // If login button is visible, auth state was lost
      test.fail(true, "Auth state lost — login button visible on portal home");
    });
  });

  test("Blueprints page is navigable", async ({ page }) => {
    // Navigate to Blueprints — try sidebar link, nav item, or direct URL
    const blueprintsLink = page.locator(
      'a:has-text("Blueprints"), a:has-text("blueprints"), ' +
      '[href*="blueprint"], [data-testid="blueprints-nav"]'
    ).first();

    if (await blueprintsLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await blueprintsLink.click();
    } else {
      // Fallback: try direct URL pattern
      await page.goto("/blueprints");
    }

    await page.waitForLoadState("networkidle");

    // Page should have loaded (not 404 or error)
    await expect(page.locator("body")).not.toHaveText(/not found|404|error/i);
  });

  test("'Deploy Krateo Instance' blueprint card is visible", async ({ page }) => {
    // Navigate to Blueprints
    const blueprintsLink = page.locator(
      'a:has-text("Blueprints"), a:has-text("blueprints"), ' +
      '[href*="blueprint"], [data-testid="blueprints-nav"]'
    ).first();

    if (await blueprintsLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await blueprintsLink.click();
    } else {
      await page.goto("/blueprints");
    }

    await page.waitForLoadState("networkidle");

    // Look for the blueprint card — the panel title from krateo-tenant-portal
    const blueprintCard = page.locator(
      'text="Deploy Krateo Instance", ' +
      '[class*="card"]:has-text("Deploy Krateo"), ' +
      '[class*="panel"]:has-text("Deploy Krateo")'
    ).first();
    await expect(blueprintCard).toBeVisible({ timeout: 15_000 });
  });

  test("clicking the blueprint card opens a form drawer", async ({ page }) => {
    // Navigate to Blueprints
    const blueprintsLink = page.locator(
      'a:has-text("Blueprints"), a:has-text("blueprints"), ' +
      '[href*="blueprint"], [data-testid="blueprints-nav"]'
    ).first();

    if (await blueprintsLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await blueprintsLink.click();
    } else {
      await page.goto("/blueprints");
    }

    await page.waitForLoadState("networkidle");

    // Click the blueprint card
    const blueprintCard = page.locator(
      'text="Deploy Krateo Instance", ' +
      '[class*="card"]:has-text("Deploy Krateo"), ' +
      '[class*="panel"]:has-text("Deploy Krateo")'
    ).first();
    await blueprintCard.click();

    // A drawer/modal with the form should appear
    const formContainer = page.locator(
      '[class*="drawer"], [class*="modal"], [class*="form"], [role="dialog"]'
    ).first();
    await expect(formContainer).toBeVisible({ timeout: 15_000 });
  });

  test("form contains expected tenant fields", async ({ page }) => {
    // Navigate to Blueprints and open the form
    const blueprintsLink = page.locator(
      'a:has-text("Blueprints"), a:has-text("blueprints"), ' +
      '[href*="blueprint"], [data-testid="blueprints-nav"]'
    ).first();

    if (await blueprintsLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await blueprintsLink.click();
    } else {
      await page.goto("/blueprints");
    }

    await page.waitForLoadState("networkidle");

    const blueprintCard = page.locator(
      'text="Deploy Krateo Instance", ' +
      '[class*="card"]:has-text("Deploy Krateo"), ' +
      '[class*="panel"]:has-text("Deploy Krateo")'
    ).first();
    await blueprintCard.click();

    // Wait for form to render
    await page.waitForTimeout(3_000);

    // Check form fields — the form is generated from values.schema.json
    // tenantName: text input
    const tenantNameField = page.locator(
      'input[name*="tenantName" i], input[placeholder*="tenant" i], ' +
      'label:has-text("tenantName"), label:has-text("Tenant Name")'
    ).first();
    await expect(tenantNameField).toBeVisible({ timeout: 10_000 });

    // plan: dropdown/select with enum values
    const planField = page.locator(
      'select[name*="plan" i], [role="listbox"]:near(:text("plan")), ' +
      'label:has-text("plan")'
    ).first();
    await expect(planField).toBeVisible({ timeout: 10_000 });

    // namespace: dropdown (RBAC-filtered)
    const namespaceField = page.locator(
      'select[name*="namespace" i], [role="listbox"]:near(:text("namespace")), ' +
      'label:has-text("namespace")'
    ).first();
    await expect(namespaceField).toBeVisible({ timeout: 10_000 });
  });

  test("namespace dropdown only shows user's namespace (RBAC filtering)", async ({ page }) => {
    // Navigate to Blueprints and open the form
    const blueprintsLink = page.locator(
      'a:has-text("Blueprints"), a:has-text("blueprints"), ' +
      '[href*="blueprint"], [data-testid="blueprints-nav"]'
    ).first();

    if (await blueprintsLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await blueprintsLink.click();
    } else {
      await page.goto("/blueprints");
    }

    await page.waitForLoadState("networkidle");

    const blueprintCard = page.locator(
      'text="Deploy Krateo Instance", ' +
      '[class*="card"]:has-text("Deploy Krateo"), ' +
      '[class*="panel"]:has-text("Deploy Krateo")'
    ).first();
    await blueprintCard.click();
    await page.waitForTimeout(3_000);

    // Open the namespace dropdown
    const namespaceDropdown = page.locator(
      'select[name*="namespace" i], ' +
      '[role="listbox"]:near(:text("namespace")), ' +
      '[class*="select"]:near(:text("namespace"))'
    ).first();
    await namespaceDropdown.click();

    // System namespaces should NOT be in the dropdown
    const options = page.locator(
      'option, [role="option"], [class*="option"], [class*="menu-item"]'
    );
    const allOptions = await options.allTextContents();

    // krateo-system and kube-system must not appear (RBAC filtered out)
    for (const opt of allOptions) {
      expect(opt).not.toContain("krateo-system");
      expect(opt).not.toContain("kube-system");
      expect(opt).not.toContain("kube-public");
    }

    // At least one namespace should be available (the user's namespace)
    expect(allOptions.length).toBeGreaterThan(0);
  });
});
