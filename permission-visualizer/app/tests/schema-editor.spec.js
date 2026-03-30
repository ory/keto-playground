/**
 * E2E tests for the Schema Editor panel (offline mode).
 *
 * Verifies the OPL schema viewer/editor: toolbar visibility, expand/collapse,
 * content correctness, editing, reset, and example-switch reset.
 */
import { test, expect } from "@playwright/test";

test.describe("Schema Editor (offline mode)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    const useCaseSelect = page.locator("select").first();
    await useCaseSelect.selectOption({ index: 1 }); // first real offline example
    await expect(page.locator(".schema-editor")).toBeVisible();
  });

  test("shows schema toolbar with OPL badge when example is selected", async ({
    page,
  }) => {
    await expect(page.locator(".schema-toggle-btn")).toContainText("Schema");
    await expect(page.locator(".schema-lang-badge")).toContainText("OPL");
    await expect(page.locator(".rel-modified")).not.toBeVisible();
  });

  test("expanding panel shows the OPL schema source", async ({ page }) => {
    await expect(page.locator(".schema-editor-body")).not.toBeVisible();
    await page.locator(".schema-toggle-btn").click();
    await expect(page.locator(".schema-editor-body")).toBeVisible();
    await expect(page.locator(".schema-textarea")).toBeVisible();

    const content = await page.locator(".schema-textarea").inputValue();
    expect(content).toContain("implements Namespace");
    expect(content).toContain("import { Namespace, Context }");
  });

  test("clicking toolbar again collapses the panel", async ({ page }) => {
    await page.locator(".schema-toggle-btn").click();
    await expect(page.locator(".schema-editor-body")).toBeVisible();
    await page.locator(".schema-toggle-btn").click();
    await expect(page.locator(".schema-editor-body")).not.toBeVisible();
  });

  test("schema content matches selected example", async ({ page }) => {
    await page.locator(".schema-toggle-btn").click();
    const content = await page.locator(".schema-textarea").inputValue();
    // All examples define at least one namespace class and import keto types
    expect(content).toContain("class");
    expect(content).toContain("implements Namespace");
    expect(content).toContain("@ory/keto-namespace-types");
  });

  test("editing the textarea shows 'edited' badge", async ({ page }) => {
    await page.locator(".schema-toggle-btn").click();
    await expect(page.locator(".rel-modified")).not.toBeVisible();

    await page.locator(".schema-textarea").click();
    await page.locator(".schema-textarea").press("End");
    await page.locator(".schema-textarea").type("\n// my edit");

    await expect(page.locator(".schema-editor .rel-modified")).toBeVisible();
  });

  test("reset button restores original content and removes badge", async ({
    page,
  }) => {
    await page.locator(".schema-toggle-btn").click();
    const original = await page.locator(".schema-textarea").inputValue();

    await page.locator(".schema-textarea").fill("// completely replaced");
    await expect(page.locator(".schema-editor .rel-modified")).toBeVisible();

    await page.locator(".schema-editor .rel-btn-ghost").click();

    const restored = await page.locator(".schema-textarea").inputValue();
    expect(restored).toBe(original);
    await expect(page.locator(".schema-editor .rel-modified")).not.toBeVisible();
  });

  test("reset button is hidden until there are edits", async ({ page }) => {
    await page.locator(".schema-toggle-btn").click();
    await expect(page.locator(".schema-editor .rel-btn-ghost")).not.toBeVisible();

    await page.locator(".schema-textarea").fill("// changed");
    await expect(page.locator(".schema-editor .rel-btn-ghost")).toBeVisible();
  });

  test("switching examples loads the new example's schema", async ({ page }) => {
    await page.locator(".schema-toggle-btn").click();
    const firstContent = await page.locator(".schema-textarea").inputValue();

    // Switch to a different example — panel remounts (collapses), re-expand it
    await page.locator("select").first().selectOption({ index: 2 });
    await page.locator(".schema-toggle-btn").click();

    const secondContent = await page.locator(".schema-textarea").inputValue();
    expect(secondContent).not.toBe(firstContent);
    expect(secondContent).toContain("implements Namespace");
  });

  test("switching examples resets any edits", async ({ page }) => {
    await page.locator(".schema-toggle-btn").click();
    await page.locator(".schema-textarea").fill("// my local changes");
    await expect(page.locator(".schema-editor .rel-modified")).toBeVisible();

    await page.locator("select").first().selectOption({ index: 2 });

    await expect(page.locator(".schema-editor .rel-modified")).not.toBeVisible();
  });

  test("footer shows ory update opl command hint", async ({ page }) => {
    await page.locator(".schema-toggle-btn").click();
    await expect(page.locator(".schema-editor-footer")).toContainText(
      "ory update opl"
    );
  });
});
