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

    const subjectSelect = page.locator("select").nth(1);
    const options = await subjectSelect.locator("option").allTextContents();
    // All bundled examples seed subjects as User:<name> subject sets.
    expect(options.filter((o) => o.startsWith("User:")).length).toBeGreaterThan(0);
  });

  test("selecting a subject renders its relation graph and sidebar", async ({
    page,
  }) => {
    await page.goto("/");
    await page.locator("select").first().selectOption({ index: 1 }); // b2b-hierarchy

    const subjectSelect = page.locator("select").nth(1);
    await subjectSelect.selectOption({ label: "User:ceo-pat" });

    await expect(page.locator(".cy canvas").first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator("text=Direct Relations")).toBeVisible();
    const relations = page.locator(".relation-item");
    expect(await relations.count()).toBeGreaterThan(0);
  });
});
