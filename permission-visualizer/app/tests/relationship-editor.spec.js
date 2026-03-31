/**
 * E2E tests for the Relationship Editor panel (offline mode).
 *
 * These tests run entirely against bundled offline data — no live Keto API or
 * ory tunnel required.
 */
import { test, expect } from "@playwright/test";

test.describe("Relationship Editor (offline mode)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // App starts in offline mode; select the first bundled example (index 1 skips placeholder)
    const useCaseSelect = page.locator("select").first();
    await useCaseSelect.selectOption({ index: 1 });
    // Editor toolbar should appear immediately (offline data loads synchronously)
    await expect(page.locator(".rel-editor")).toBeVisible();
  });

  test("toolbar shows tuple count after selecting an example", async ({ page }) => {
    await expect(page.locator(".rel-toggle-btn")).toContainText("Relationships");
    await expect(page.locator(".rel-count")).toContainText("tuples");
    // No edits yet — "edited" badge should not be visible
    await expect(page.locator(".rel-modified")).not.toBeVisible();
  });

  test("clicking toolbar expands table with all tuples", async ({ page }) => {
    // Body hidden while collapsed
    await expect(page.locator(".rel-editor-body")).not.toBeVisible();

    await page.locator(".rel-toggle-btn").click();

    await expect(page.locator(".rel-editor-body")).toBeVisible();
    await expect(page.locator(".rel-table")).toBeVisible();
    // At least some rows from bundled data
    const rows = page.locator(".rel-row");
    expect(await rows.count()).toBeGreaterThan(0);
  });

  test("clicking toolbar again collapses the editor", async ({ page }) => {
    await page.locator(".rel-toggle-btn").click();
    await expect(page.locator(".rel-editor-body")).toBeVisible();

    await page.locator(".rel-toggle-btn").click();
    await expect(page.locator(".rel-editor-body")).not.toBeVisible();
  });

  test("deleting a base tuple decrements count and shows 'edited' badge", async ({
    page,
  }) => {
    await page.locator(".rel-toggle-btn").click();
    await expect(page.locator(".rel-editor-body")).toBeVisible();

    const countText = await page.locator(".rel-count").textContent();
    const initialCount = parseInt(countText.match(/\d+/)[0]);

    await page.locator(".rel-delete-btn").first().click();

    await expect(page.locator(".rel-count")).toContainText(
      `${initialCount - 1} tuples`
    );
    await expect(page.locator(".rel-modified")).toBeVisible();
  });

  test("adding a new User ID tuple appends a custom row", async ({ page }) => {
    await page.locator(".rel-toggle-btn").click();
    await expect(page.locator(".rel-editor-body")).toBeVisible();

    const countText = await page.locator(".rel-count").textContent();
    const initialCount = parseInt(countText.match(/\d+/)[0]);

    await page.locator("button", { hasText: "+ Add Tuple" }).click();
    await expect(page.locator(".rel-add-form")).toBeVisible();

    // Pick the first real namespace
    await page
      .locator(".rel-add-form select.rel-input")
      .selectOption({ index: 1 });
    await page
      .locator('.rel-add-form input[placeholder="Object"]')
      .fill("test-object");
    await page
      .locator('.rel-add-form input[placeholder="Relation"]')
      .fill("members");
    await page
      .locator('.rel-add-form input[placeholder="Subject ID"]')
      .fill("test-user-99");
    await page.locator(".rel-add-form button[type='submit']").click();

    // Form should close and custom row should appear
    await expect(page.locator(".rel-add-form")).not.toBeVisible();
    await expect(page.locator(".rel-row-custom")).toBeVisible();
    await expect(page.locator(".rel-row-custom")).toContainText("test-object");
    await expect(page.locator(".rel-row-custom")).toContainText("test-user-99");

    // Count and badge
    await expect(page.locator(".rel-count")).toContainText(
      `${initialCount + 1} tuples`
    );
    await expect(page.locator(".rel-modified")).toBeVisible();
  });

  test("newly added subject_id appears in user dropdown", async ({ page }) => {
    await page.locator(".rel-toggle-btn").click();
    await page.locator("button", { hasText: "+ Add Tuple" }).click();

    await page
      .locator(".rel-add-form select.rel-input")
      .selectOption({ index: 1 });
    await page
      .locator('.rel-add-form input[placeholder="Object"]')
      .fill("new-app");
    await page
      .locator('.rel-add-form input[placeholder="Relation"]')
      .fill("members");
    await page
      .locator('.rel-add-form input[placeholder="Subject ID"]')
      .fill("brand-new-user-xyz");
    await page.locator(".rel-add-form button[type='submit']").click();

    const userSelect = page.locator("select").nth(1);
    const options = await userSelect.locator("option").allTextContents();
    expect(options).toContain("brand-new-user-xyz");
  });

  test("adding a Subject Set tuple shows it with correct subject format", async ({
    page,
  }) => {
    await page.locator(".rel-toggle-btn").click();
    await page.locator("button", { hasText: "+ Add Tuple" }).click();

    await page
      .locator(".rel-add-form select.rel-input")
      .selectOption({ index: 1 });
    await page
      .locator('.rel-add-form input[placeholder="Object"]')
      .fill("my-resource");
    await page
      .locator('.rel-add-form input[placeholder="Relation"]')
      .fill("viewers");

    // Switch to Subject Set mode
    await page.locator(".rel-type-btn", { hasText: "Subject Set" }).click();

    await page
      .locator('.rel-add-form select.rel-input')
      .nth(1)
      .selectOption({ index: 1 });
    await page
      .locator('.rel-add-form input[placeholder="Object"]')
      .nth(1)
      .fill("parent-group");

    await page.locator(".rel-add-form button[type='submit']").click();

    await expect(page.locator(".rel-row-custom")).toBeVisible();
    await expect(page.locator(".rel-row-custom")).toContainText("my-resource");
    // Subject cell should contain namespace:object format
    await expect(
      page.locator(".rel-row-custom .rel-subject-cell")
    ).toContainText("parent-group");
  });

  test("form shows validation error for missing fields", async ({ page }) => {
    await page.locator(".rel-toggle-btn").click();
    await page.locator("button", { hasText: "+ Add Tuple" }).click();

    // Submit without filling anything
    await page.locator(".rel-add-form button[type='submit']").click();

    await expect(page.locator(".rel-form-error")).toBeVisible();
    await expect(page.locator(".rel-form-error")).toContainText("required");
  });

  test("reset restores original tuple count after edits", async ({ page }) => {
    await page.locator(".rel-toggle-btn").click();

    const countText = await page.locator(".rel-count").textContent();
    const initialCount = parseInt(countText.match(/\d+/)[0]);

    // Delete a tuple
    await page.locator(".rel-delete-btn").first().click();
    await expect(page.locator(".rel-modified")).toBeVisible();

    // Accept the confirm dialog and click reset
    page.on("dialog", (dialog) => dialog.accept());
    await page.locator("button", { hasText: "Reset to default" }).click();

    await expect(page.locator(".rel-count")).toContainText(
      `${initialCount} tuples`
    );
    await expect(page.locator(".rel-modified")).not.toBeVisible();
  });

  // ── Inline editing ───────────────────────────────────────────────────

  test("edit button is hidden until row is hovered", async ({ page }) => {
    await page.locator(".rel-toggle-btn").click();
    const firstRow = page.locator(".rel-row").first();
    const editBtn = firstRow.locator(".rel-edit-btn");
    // Not visible before hover (opacity:0 via CSS, but still in DOM)
    await expect(editBtn).toHaveCSS("opacity", "0");
    await firstRow.hover();
    await expect(editBtn).toHaveCSS("opacity", "1");
  });

  test("clicking edit puts row into edit mode with pre-filled values", async ({
    page,
  }) => {
    await page.locator(".rel-toggle-btn").click();

    const firstRow = page.locator(".rel-row").first();
    // Read current display values
    const namespace = await firstRow.locator("td").nth(0).textContent();
    const object = await firstRow.locator("td").nth(1).textContent();

    await firstRow.hover();
    await firstRow.locator(".rel-edit-btn").click();

    // Row should now show inputs
    const editRow = page.locator(".rel-row-editing");
    await expect(editRow).toBeVisible();
    // Namespace select should have original value
    await expect(editRow.locator("select.rel-input-cell")).toHaveValue(namespace.trim());
    // Object input should have original value
    await expect(editRow.locator("input.rel-input-cell").first()).toHaveValue(
      object.trim()
    );
    // Save and cancel buttons should be visible
    await expect(page.locator(".rel-save-btn")).toBeVisible();
    await expect(page.locator(".rel-cancel-btn")).toBeVisible();
  });

  test("cancel edit restores the original read-only row", async ({ page }) => {
    await page.locator(".rel-toggle-btn").click();
    const firstRow = page.locator(".rel-row").first();
    await firstRow.hover();
    await firstRow.locator(".rel-edit-btn").click();
    await expect(page.locator(".rel-row-editing")).toBeVisible();

    await page.locator(".rel-cancel-btn").click();

    await expect(page.locator(".rel-row-editing")).not.toBeVisible();
    await expect(firstRow).toBeVisible();
  });

  test("Escape key cancels edit", async ({ page }) => {
    await page.locator(".rel-toggle-btn").click();
    const firstRow = page.locator(".rel-row").first();
    await firstRow.hover();
    await firstRow.locator(".rel-edit-btn").click();
    await expect(page.locator(".rel-row-editing")).toBeVisible();

    // Focus an input so the keydown handler fires
    await page.locator(".rel-subject-input").press("Escape");
    await expect(page.locator(".rel-row-editing")).not.toBeVisible();
  });

  test("editing a base tuple saves as a custom row and updates graph data", async ({
    page,
  }) => {
    await page.locator(".rel-toggle-btn").click();

    const firstRow = page.locator(".rel-row").first();
    const originalObject = await firstRow.locator("td").nth(1).textContent();

    await firstRow.hover();
    await firstRow.locator(".rel-edit-btn").click();

    // Change the object field
    const objectInput = page.locator(".rel-row-editing input.rel-input-cell").first();
    await objectInput.fill("edited-object-xyz");

    await page.locator(".rel-save-btn").click();

    // Edit row should be gone
    await expect(page.locator(".rel-row-editing")).not.toBeVisible();

    // The modified row should now appear as a custom row (blue left border)
    await expect(page.locator(".rel-row-custom")).toBeVisible();
    await expect(page.locator(".rel-row-custom")).toContainText("edited-object-xyz");

    // edited badge should be visible
    await expect(page.locator(".rel-modified")).toBeVisible();
  });

  test("editing a custom tuple updates it in place", async ({ page }) => {
    // First add a custom tuple
    await page.locator(".rel-toggle-btn").click();
    await page.locator("button", { hasText: "+ Add Tuple" }).click();
    await page.locator(".rel-add-form select.rel-input").selectOption({ index: 1 });
    await page.locator('.rel-add-form input[placeholder="Object"]').fill("orig-obj");
    await page.locator('.rel-add-form input[placeholder="Relation"]').fill("members");
    await page.locator('.rel-add-form input[placeholder="Subject ID"]').fill("orig-user");
    await page.locator(".rel-add-form button[type='submit']").click();

    // Now edit the custom row
    const customRow = page.locator(".rel-row-custom");
    await customRow.hover();
    await customRow.locator(".rel-edit-btn").click();

    const objectInput = page.locator(".rel-row-editing input.rel-input-cell").first();
    await objectInput.fill("updated-obj");
    await page.locator(".rel-save-btn").click();

    // Should still be a custom row, now with updated content
    await expect(page.locator(".rel-row-custom")).toContainText("updated-obj");
    await expect(page.locator(".rel-row-custom")).not.toContainText("orig-obj");
  });

  test("edit validation shows error for empty object field", async ({ page }) => {
    await page.locator(".rel-toggle-btn").click();
    const firstRow = page.locator(".rel-row").first();
    await firstRow.hover();
    await firstRow.locator(".rel-edit-btn").click();

    // Clear the object input
    const objectInput = page.locator(".rel-row-editing input.rel-input-cell").first();
    await objectInput.fill("");
    await page.locator(".rel-save-btn").click();

    await expect(page.locator(".rel-edit-error")).toBeVisible();
    await expect(page.locator(".rel-edit-error")).toContainText("required");
    // Row stays in edit mode
    await expect(page.locator(".rel-row-editing")).toBeVisible();
  });

  test("editing subject with NS:object format produces subject_set", async ({
    page,
  }) => {
    await page.locator(".rel-toggle-btn").click();
    const firstRow = page.locator(".rel-row").first();
    await firstRow.hover();
    await firstRow.locator(".rel-edit-btn").click();

    // Change subject to subject_set format
    const subjectInput = page.locator(".rel-row-editing .rel-subject-input");
    await subjectInput.fill("Role:admin");
    await page.locator(".rel-save-btn").click();

    // The custom row subject cell should show "Role:admin"
    await expect(page.locator(".rel-row-custom .rel-subject-cell")).toContainText(
      "Role:admin"
    );
  });

  test("switching examples resets relationship edits", async ({ page }) => {
    await page.locator(".rel-toggle-btn").click();

    // Make an edit
    await page.locator(".rel-delete-btn").first().click();
    await expect(page.locator(".rel-modified")).toBeVisible();

    // Switch to a different example
    await page.locator("select").first().selectOption({ index: 2 });

    // Edits should be cleared
    await expect(page.locator(".rel-modified")).not.toBeVisible();
  });
});
