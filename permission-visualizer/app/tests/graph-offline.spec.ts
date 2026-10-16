/**
 * E2E tests for the graph view in offline mode.
 *
 * Verifies that subjects derived from namespaced subject sets (the
 * recommended tuple form — no legacy subject_ids in the bundled examples)
 * populate the subject dropdown and render a graph.
 */
import { test, expect } from "@playwright/test";

test.describe("Graph (offline mode)", () => {
  test("subject dropdown lists namespaced subjects", async ({ page }) => {
    await page.goto("/");
    await page.locator("select").first().selectOption({ index: 1 });

    // All bundled examples seed subjects as User:<name> subject sets, so the
    // User namespace is offered and lists the bare object names.
    await page.getByLabel("Subject Namespace").selectOption("User");
    const options = await page.getByLabel("Subject", { exact: true }).locator("option").allTextContents();
    expect(options).toContain("ceo-pat");
  });

  test("selecting a subject renders its relation graph and sidebar", async ({
    page,
  }) => {
    await page.goto("/");
    await page.locator("select").first().selectOption({ index: 1 }); // b2b-hierarchy

    await page.getByLabel("Subject Namespace").selectOption("User");
    await page.getByLabel("Subject", { exact: true }).selectOption("User:ceo-pat");

    await expect(page.locator(".cy canvas").first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator("text=Direct Relations")).toBeVisible();
    const relations = page.locator(".relation-item");
    expect(await relations.count()).toBeGreaterThan(0);
  });
});
