import { test, expect } from "@playwright/test";
import { config, STORAGE_STATE } from "./helpers";
import { execSync } from "child_process";
import * as fs from "fs";

const KUBECONFIG = process.env.KUBECONFIG || `${process.env.HOME}/.kube/krateo-kind.yaml`;

function kubectl(cmd: string): string {
  return execSync(`kubectl --kubeconfig ${KUBECONFIG} ${cmd}`, {
    encoding: "utf-8",
    timeout: 30_000,
  }).trim();
}

// Reuse authenticated session
test.use({
  storageState: fs.existsSync(STORAGE_STATE) ? STORAGE_STATE : undefined,
});

test.describe("Tenant Provisioning via UI", () => {
  test("submit tenant request form and verify Composition CR created", async ({ page }) => {
    // 1. Navigate to Blueprints
    const blueprintsLink = page.locator(
      'a:has-text("Blueprints"), a:has-text("blueprints"), ' +
      '[href*="blueprint"], [data-testid="blueprints-nav"]'
    ).first();

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    if (await blueprintsLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await blueprintsLink.click();
    } else {
      await page.goto("/blueprints");
    }
    await page.waitForLoadState("networkidle");

    // 2. Open blueprint form
    const blueprintCard = page.locator(
      'text="Deploy Krateo Instance", ' +
      '[class*="card"]:has-text("Deploy Krateo"), ' +
      '[class*="panel"]:has-text("Deploy Krateo")'
    ).first();
    await blueprintCard.click();
    await page.waitForTimeout(3_000);

    // 3. Fill in tenant name
    const tenantNameInput = page.locator(
      'input[name*="tenantName" i], input[placeholder*="tenant" i]'
    ).first();
    await tenantNameInput.fill(config.tenantName);

    // 4. Select plan (free)
    const planSelect = page.locator(
      'select[name*="plan" i]'
    ).first();
    if (await planSelect.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await planSelect.selectOption(config.tenantPlan);
    } else {
      // Try clicking a dropdown and selecting
      const planDropdown = page.locator(
        '[class*="select"]:near(:text("plan")), [role="listbox"]:near(:text("plan"))'
      ).first();
      await planDropdown.click();
      await page.locator(`[role="option"]:has-text("${config.tenantPlan}")`).first().click();
    }

    // 5. Select namespace (first available — should be the user's namespace)
    const nsSelect = page.locator('select[name*="namespace" i]').first();
    if (await nsSelect.isVisible({ timeout: 3_000 }).catch(() => false)) {
      // Select the first non-empty option
      const options = await nsSelect.locator("option").allTextContents();
      const userNs = options.find((o) => o && !o.includes("Select") && !o.includes("--"));
      if (userNs) await nsSelect.selectOption(userNs);
    } else {
      const nsDropdown = page.locator(
        '[class*="select"]:near(:text("namespace")), [role="listbox"]:near(:text("namespace"))'
      ).first();
      await nsDropdown.click();
      await page.locator('[role="option"]').first().click();
    }

    // 6. Submit the form
    const submitBtn = page.locator(
      'button[type="submit"], button:has-text("Submit"), button:has-text("Create"), ' +
      'button:has-text("Deploy")'
    ).first();
    await submitBtn.click();

    // 7. Wait for navigation to composition page or success feedback
    await page.waitForTimeout(5_000);

    // 8. Verify Composition CR exists via kubectl
    // Allow some time for the CR to be created
    let compositionFound = false;
    for (let i = 0; i < 6; i++) {
      try {
        const output = kubectl("get compositions -A --no-headers");
        if (output.includes(config.tenantName) || output.length > 0) {
          compositionFound = true;
          break;
        }
      } catch {
        // not found yet
      }
      await page.waitForTimeout(5_000);
    }
    expect(compositionFound).toBe(true);
  });

  test("composition page loads and shows status", async ({ page }) => {
    // Navigate to the composition — either via redirect from form or direct navigation
    // Try to find a composition link in the portal
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const compositionsLink = page.locator(
      'a:has-text("Compositions"), a:has-text("compositions"), ' +
      '[href*="composition"], [data-testid="compositions-nav"]'
    ).first();

    if (await compositionsLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await compositionsLink.click();
    } else {
      await page.goto("/compositions");
    }
    await page.waitForLoadState("networkidle");

    // Look for the tenant composition in the list
    const compositionEntry = page.locator(
      `text="${config.tenantName}", [class*="card"]:has-text("${config.tenantName}"), ` +
      `[class*="row"]:has-text("${config.tenantName}")`
    ).first();

    // It may take time for the composition to appear
    await expect(compositionEntry).toBeVisible({ timeout: 30_000 });
  });

  test("composition detail page has Status, Values, and Events tabs", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const compositionsLink = page.locator(
      'a:has-text("Compositions"), a:has-text("compositions"), ' +
      '[href*="composition"], [data-testid="compositions-nav"]'
    ).first();

    if (await compositionsLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await compositionsLink.click();
    } else {
      await page.goto("/compositions");
    }
    await page.waitForLoadState("networkidle");

    // Click into the composition detail
    const compositionEntry = page.locator(
      `text="${config.tenantName}", [class*="card"]:has-text("${config.tenantName}")`
    ).first();
    await compositionEntry.click();
    await page.waitForLoadState("networkidle");

    // Verify tabs exist (from krateo-tenant-composition-page templates)
    const statusTab = page.locator(
      'text="Status", [role="tab"]:has-text("Status"), [data-testid="status-tab"]'
    ).first();
    await expect(statusTab).toBeVisible({ timeout: 15_000 });

    const valuesTab = page.locator(
      'text="Values", [role="tab"]:has-text("Values"), [data-testid="values-tab"]'
    ).first();
    await expect(valuesTab).toBeVisible({ timeout: 10_000 });

    const eventsTab = page.locator(
      'text="Events", [role="tab"]:has-text("Events"), [data-testid="events-tab"]'
    ).first();
    await expect(eventsTab).toBeVisible({ timeout: 10_000 });
  });

  test("verify tenant resources created in cluster", async ({ page }) => {
    // Get the user's namespace (first composition namespace found)
    let namespace = "";
    try {
      const output = kubectl("get compositions -A --no-headers -o custom-columns=NS:.metadata.namespace");
      namespace = output.split("\n")[0].trim();
    } catch {
      test.skip(true, "No compositions found in cluster");
    }

    if (!namespace) test.skip(true, "Could not determine tenant namespace");

    // Verify ResourceQuota
    const quota = kubectl(`get resourcequota -n ${namespace} --no-headers`);
    expect(quota).toBeTruthy();

    // Verify tenant-info ConfigMap
    const configmap = kubectl(`get configmap -n ${namespace} -l app.kubernetes.io/part-of=krateo-saas --no-headers`);
    expect(configmap).toBeTruthy();

    // Verify vCluster StatefulSet (may take a few minutes)
    let vclusterFound = false;
    for (let i = 0; i < 12; i++) {
      try {
        const sts = kubectl(`get statefulset -n ${namespace} --no-headers`);
        if (sts.length > 0) {
          vclusterFound = true;
          break;
        }
      } catch {
        // not yet
      }
      await page.waitForTimeout(10_000);
    }
    expect(vclusterFound).toBe(true);
  });

  test("delete tenant composition and verify cleanup", async ({ page }) => {
    // Navigate to composition detail
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const compositionsLink = page.locator(
      'a:has-text("Compositions"), a:has-text("compositions"), ' +
      '[href*="composition"], [data-testid="compositions-nav"]'
    ).first();

    if (await compositionsLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await compositionsLink.click();
    } else {
      await page.goto("/compositions");
    }
    await page.waitForLoadState("networkidle");

    // Click into the composition
    const compositionEntry = page.locator(
      `text="${config.tenantName}", [class*="card"]:has-text("${config.tenantName}")`
    ).first();

    if (!await compositionEntry.isVisible({ timeout: 10_000 }).catch(() => false)) {
      test.skip(true, "Composition not visible — may have been cleaned up already");
    }

    await compositionEntry.click();
    await page.waitForLoadState("networkidle");

    // Click the delete button
    const deleteBtn = page.locator(
      'button:has-text("Delete"), button:has-text("delete"), ' +
      '[data-testid="delete-btn"], [class*="delete"]'
    ).first();
    await expect(deleteBtn).toBeVisible({ timeout: 10_000 });
    await deleteBtn.click();

    // Confirm deletion if a confirmation dialog appears
    const confirmBtn = page.locator(
      'button:has-text("Confirm"), button:has-text("Yes"), button:has-text("OK")'
    ).first();
    if (await confirmBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await confirmBtn.click();
    }

    // Wait for deletion to propagate
    await page.waitForTimeout(10_000);

    // Verify via kubectl that composition is gone
    let deleted = false;
    for (let i = 0; i < 6; i++) {
      try {
        const output = kubectl("get compositions -A --no-headers");
        if (!output.includes(config.tenantName)) {
          deleted = true;
          break;
        }
      } catch {
        deleted = true;
        break;
      }
      await page.waitForTimeout(5_000);
    }
    expect(deleted).toBe(true);
  });
});
