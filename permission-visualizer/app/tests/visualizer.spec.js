/**
 * E2E tests for the Permission Visualizer.
 *
 * Prerequisites:
 *   1. `ory tunnel` running on port 4000 (proxies to Ory Network)
 *   2. An OPL and tuples loaded for at least one example (e.g., content-publishing-workflow)
 *   3. Vite dev server on port 5173 (started automatically by Playwright)
 *
 * These tests verify the app fetches LIVE data from Keto via the tunnel.
 */
import { test, expect } from "@playwright/test";

// Helper: check that the Keto API is reachable through the proxy
test.describe("API connectivity", () => {
  test("GET /api/namespaces returns live namespace list", async ({
    request,
  }) => {
    const res = await request.get("/api/namespaces");
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.namespaces).toBeDefined();
    expect(Array.isArray(data.namespaces)).toBeTruthy();
    expect(data.namespaces.length).toBeGreaterThan(0);
    // Each namespace should have a name
    for (const ns of data.namespaces) {
      expect(ns.name).toBeDefined();
      expect(typeof ns.name).toBe("string");
    }
  });

  test("GET /api/relation-tuples returns tuples for a namespace", async ({
    request,
  }) => {
    // First get the namespaces to know which to query
    const nsRes = await request.get("/api/namespaces");
    const nsData = await nsRes.json();
    const firstName = nsData.namespaces[0].name;

    const res = await request.get(
      `/api/relation-tuples?namespace=${firstName}&page_size=5`
    );
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.relation_tuples).toBeDefined();
    expect(Array.isArray(data.relation_tuples)).toBeTruthy();
  });

  test("POST /api/relation-tuples/check returns allowed boolean", async ({
    request,
  }) => {
    // Use a known tuple from whatever example is currently loaded
    const nsRes = await request.get("/api/namespaces");
    const nsData = await nsRes.json();
    const firstName = nsData.namespaces[0].name;

    // Get a tuple to test with
    const tuplesRes = await request.get(
      `/api/relation-tuples?namespace=${firstName}&page_size=1`
    );
    const tuplesData = await tuplesRes.json();

    if (tuplesData.relation_tuples.length > 0) {
      const t = tuplesData.relation_tuples[0];
      // If this tuple has a subject_id, check it
      if (t.subject_id) {
        const checkRes = await request.post("/api/relation-tuples/check", {
          data: {
            namespace: t.namespace,
            object: t.object,
            relation: t.relation,
            subject_id: t.subject_id,
          },
        });
        const checkData = await checkRes.json();
        expect(typeof checkData.allowed).toBe("boolean");
      }
    }
  });
});

test.describe("UI renders with live data", () => {
  test("homepage loads with use case selector", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1")).toContainText("Permission Visualizer");
    // Should have the use case dropdown
    const select = page.locator("select").first();
    await expect(select).toBeVisible();
    // Should have options for all 7 examples
    const options = await select.locator("option").allTextContents();
    expect(options.length).toBeGreaterThanOrEqual(8); // 1 placeholder + 7 examples
    expect(options).toContain("RBAC App Access");
    expect(options).toContain("Content Publishing Workflow");
  });

  test("selecting a use case fetches live tuples and shows users", async ({
    page,
  }) => {
    await page.goto("/");

    // Select any use case
    const useCaseSelect = page.locator("select").first();
    await useCaseSelect.selectOption({ index: 1 }); // First real example

    // Should show loading indicator briefly, then user dropdown
    const userSelect = page.locator("select").nth(1);
    await expect(userSelect).toBeVisible({ timeout: 10_000 });

    // Wait for users to load (the dropdown should have more than just the placeholder)
    await expect(async () => {
      const options = await userSelect.locator("option").allTextContents();
      expect(options.length).toBeGreaterThan(1);
    }).toPass({ timeout: 15_000 });

    // Should show connection status with tuple count
    await expect(page.locator(".connection-status")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator(".connection-status")).toContainText("Live");
    await expect(page.locator(".connection-status")).toContainText("tuples");
  });

  test("selecting a user triggers live permission checks and shows results", async ({
    page,
    request,
  }) => {
    // First, determine which example matches the currently loaded OPL
    const nsRes = await request.get("/api/namespaces");
    const nsData = await nsRes.json();
    const liveNamespaces = new Set(nsData.namespaces.map((n) => n.name));

    // Map namespaces to examples
    const exampleMap = {
      "RBAC App Access": ["Application", "Role"],
      "RBAC Bank Accounts": ["BankAccount", "Role"],
      "RAG Document Access": ["Document", "Team"],
      "B2B Hierarchy": ["Business", "LineOfBusiness", "Customer"],
      "SaaS Feature Gating": ["Feature", "Plan", "Organization"],
      "Healthcare Records": ["Patient", "MedicalRecord"],
      "Content Publishing Workflow": ["Article", "Role"],
    };

    let matchedExample = null;
    for (const [name, required] of Object.entries(exampleMap)) {
      if (required.every((ns) => liveNamespaces.has(ns))) {
        matchedExample = name;
        break;
      }
    }

    // Skip if no matching example found (wrong OPL loaded)
    test.skip(!matchedExample, "No matching example for currently loaded OPL");

    await page.goto("/");
    const useCaseSelect = page.locator("select").first();
    await useCaseSelect.selectOption({ label: matchedExample });

    const userSelect = page.locator("select").nth(1);
    await expect(userSelect).toBeVisible({ timeout: 10_000 });
    await expect(async () => {
      const options = await userSelect.locator("option").allTextContents();
      expect(options.length).toBeGreaterThan(1);
    }).toPass({ timeout: 15_000 });

    // Select the first user
    await userSelect.selectOption({ index: 1 });

    // Should show permission results section with ALLOWED/DENIED text
    await expect(async () => {
      const permCards = page.locator(".permission-card");
      const count = await permCards.count();
      expect(count).toBeGreaterThan(0);
    }).toPass({ timeout: 30_000 });

    // Verify badges contain actual permission verdicts
    const pageText = await page.locator(".permissions-grid").textContent();
    expect(pageText).toMatch(/ALLOWED|DENIED/);
  });

  test("graph renders with nodes and edges for selected user", async ({
    page,
  }) => {
    await page.goto("/");

    const useCaseSelect = page.locator("select").first();
    await useCaseSelect.selectOption({ index: 1 });

    const userSelect = page.locator("select").nth(1);
    await expect(userSelect).toBeVisible({ timeout: 10_000 });
    await expect(async () => {
      const options = await userSelect.locator("option").allTextContents();
      expect(options.length).toBeGreaterThan(1);
    }).toPass({ timeout: 15_000 });

    await userSelect.selectOption({ index: 1 });

    // Cytoscape canvas should appear
    const canvas = page.locator(".cy canvas");
    await expect(canvas.first()).toBeVisible({ timeout: 15_000 });
  });

  test("sidebar shows direct relations for selected user", async ({
    page,
  }) => {
    await page.goto("/");

    const useCaseSelect = page.locator("select").first();
    await useCaseSelect.selectOption({ index: 1 });

    const userSelect = page.locator("select").nth(1);
    await expect(userSelect).toBeVisible({ timeout: 10_000 });
    await expect(async () => {
      const options = await userSelect.locator("option").allTextContents();
      expect(options.length).toBeGreaterThan(1);
    }).toPass({ timeout: 15_000 });

    await userSelect.selectOption({ index: 1 });

    // Should show "Direct Relations" section
    await expect(page.locator("text=Direct Relations")).toBeVisible({
      timeout: 15_000,
    });
    // Should have at least one relation item
    const relations = page.locator(".relation-item");
    await expect(async () => {
      expect(await relations.count()).toBeGreaterThan(0);
    }).toPass({ timeout: 10_000 });
  });

  test("namespace legend reflects live namespaces", async ({ page }) => {
    await page.goto("/");

    const useCaseSelect = page.locator("select").first();
    await useCaseSelect.selectOption({ index: 1 });

    // Wait for data to load
    await expect(page.locator(".connection-status")).toBeVisible({
      timeout: 15_000,
    });

    // Legend should be visible with namespace names
    await expect(page.getByRole("heading", { name: "Namespaces" })).toBeVisible();
    const legendItems = page.locator(".legend-item");
    const count = await legendItems.count();
    expect(count).toBeGreaterThan(0);
  });

  test("switching use cases resets state and re-fetches", async ({ page }) => {
    await page.goto("/");

    const useCaseSelect = page.locator("select").first();

    // Select first example
    await useCaseSelect.selectOption({ index: 1 });
    await expect(page.locator(".connection-status")).toBeVisible({
      timeout: 15_000,
    });

    // Select a user
    const userSelect = page.locator("select").nth(1);
    await expect(async () => {
      const options = await userSelect.locator("option").allTextContents();
      expect(options.length).toBeGreaterThan(1);
    }).toPass({ timeout: 15_000 });
    await userSelect.selectOption({ index: 1 });

    // Now switch to a different example
    await useCaseSelect.selectOption({ index: 2 });

    // User dropdown should reset
    const userSelect2 = page.locator("select").nth(1);
    await expect(userSelect2).toHaveValue("");

    // Should re-fetch and show connection status again
    await expect(page.locator(".connection-status")).toBeVisible({
      timeout: 15_000,
    });
  });
});

test.describe("error handling", () => {
  test("shows error state when API is unreachable", async ({ page }) => {
    // Intercept API calls to simulate failure
    await page.route("**/api/namespaces", (route) =>
      route.fulfill({ status: 500, body: "Internal Server Error" })
    );

    await page.goto("/");
    const useCaseSelect = page.locator("select").first();
    await useCaseSelect.selectOption({ index: 1 });

    // Should show error status
    await expect(page.locator(".status-indicator.error")).toBeVisible({
      timeout: 10_000,
    });
  });
});
