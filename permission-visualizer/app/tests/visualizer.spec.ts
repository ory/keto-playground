/**
 * E2E tests for the Permission Visualizer in Live mode, against the local Keto
 * in permission-visualizer/local-keto (OPL from local-keto/namespaces.ts, tuples
 * from local-keto/seed.mjs). Start it with `bash local-keto/up.sh` and run with
 *   ORY_SDK_URL=http://localhost:4455 ORY_ACCESS_TOKEN=local
 * so the dev server's /api proxy points at it.
 *
 * The error-handling test starts its own dev server pointed at a port nothing
 * listens on, so it needs no Keto.
 */
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import { freePort, startDevServer } from "./helpers/devServer";
import { graphNodeIds, pickSubject, renderedGraph } from "./helpers/graph";
import { startFaultyUpstream } from "./helpers/faultyUpstream";
import { LOCAL_KETO_NAMESPACES, deleteObjectTuples, expectLocalKeto, putTuples, runId } from "./helpers/keto";

const LOCAL_EXAMPLE = "Local deep graph (local-keto)";

async function openLive(page: Page, baseUrl = "") {
  await page.goto(`${baseUrl}/`);
  await page.getByRole("button", { name: "Live" }).click();
}

async function expectLiveTuplesLoaded(page: Page) {
  await expect(page.locator(".connection-status")).toContainText(
    new RegExp(`Live — \\d+ tuples, ${LOCAL_KETO_NAMESPACES.length} namespaces`),
    { timeout: 30_000 },
  );
}

test.describe("API connectivity (local Keto)", () => {
  test.beforeAll(async ({ request }) => {
    await expectLocalKeto(request);
  });

  test("GET /api/namespaces returns the live namespace list", async ({ request }) => {
    const res = await request.get("/api/namespaces");
    expect(res.status()).toBe(200);
    const names = ((await res.json()).namespaces as { name: string }[]).map((n) => n.name);
    expect(names.sort()).toEqual(LOCAL_KETO_NAMESPACES);
  });

  test("GET /api/relation-tuples returns a page of tuples for a namespace", async ({ request }) => {
    const res = await request.get("/api/relation-tuples?namespace=Folder&page_size=5");
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.relation_tuples).toHaveLength(5);
    for (const t of data.relation_tuples) expect(t.namespace).toBe("Folder");
    expect(data.next_page_token).toBeTruthy();
  });

  test("POST /api/relation-tuples/check returns a verdict for a subject set", async ({ request }) => {
    const tuples = (await (await request.get("/api/relation-tuples?namespace=Folder&object=f1.1")).json())
      .relation_tuples as { namespace: string; object: string; relation: string; subject_set?: object }[];
    const owner = tuples.find((t) => t.relation === "owners" && t.subject_set);
    expect(owner, JSON.stringify(tuples)).toBeDefined();

    const allowed = await request.post("/api/relation-tuples/check", {
      data: { namespace: "Folder", object: "f1.1", relation: "own", subject_set: owner!.subject_set },
    });
    expect(allowed.status()).toBe(200);
    expect(await allowed.json()).toEqual({ allowed: true });

    // Folder:root is f1.1's parent, not the other way round. Keto's /check answers
    // a denial with 403; /check/openapi with 200.
    const reversed = { namespace: "Folder", object: "root", relation: "parents", subject_set: { namespace: "Folder", object: "f1.1", relation: "" } };
    const denied = await request.post("/api/relation-tuples/check", { data: reversed });
    expect(denied.status()).toBe(403);
    expect(await denied.json()).toEqual({ allowed: false });
    const deniedOpenApi = await request.post("/api/relation-tuples/check/openapi", { data: reversed });
    expect(deniedOpenApi.status()).toBe(200);
    expect(await deniedOpenApi.json()).toEqual({ allowed: false });
  });
});

test.describe("UI renders with live data (local Keto)", () => {
  test.beforeAll(async ({ request }) => {
    await expectLocalKeto(request);
  });

  test("Live mode opens Explore Live Data and lists the examples next to it", async ({ page }) => {
    await openLive(page);
    const useCase = page.locator("select").first();
    await expect(useCase).toHaveValue("__explore__");
    const options = await useCase.locator("option").allTextContents();
    expect(options.slice(0, 2)).toEqual(["Select a use case...", "Explore Live Data"]);
    expect(options).toEqual(expect.arrayContaining(["RBAC App Access", "Content Publishing Workflow", LOCAL_EXAMPLE]));
  });

  test("Explore Live Data fetches the live tuples and offers their subjects", async ({ page }) => {
    await openLive(page);
    await expectLiveTuplesLoaded(page);

    await page.getByLabel("Subject Namespace").selectOption("User");
    const subjects = await page.getByLabel("Subject", { exact: true }).locator("option").allTextContents();
    expect(subjects).toEqual(expect.arrayContaining(["user-0001", "user-hub"]));
  });

  test("the local example checks its permissions and shows ALLOWED and DENIED verdicts", async ({ page, request }) => {
    await openLive(page);
    await page.locator("select").first().selectOption({ label: LOCAL_EXAMPLE });
    await expectLiveTuplesLoaded(page);
    await pickSubject(page, "User", "User:user-hub");

    const card = page.locator(".permission-card").filter({ hasText: "Document:doc-0024" });
    await expect(card).toContainText("view: ALLOWED", { timeout: 60_000 });
    await expect(card).toContainText("edit: DENIED");
    await expect(page.locator(".badge-allowed").first()).toBeVisible();
    await expect(page.locator(".badge-denied").first()).toBeVisible();

    // The badges are Keto's verdicts.
    const subject = { namespace: "User", object: "user-hub", relation: "" };
    for (const [relation, allowed] of [["view", true], ["edit", false]] as const) {
      const res = await request.post("/api/relation-tuples/check/openapi", {
        data: { namespace: "Document", object: "doc-0024", relation, subject_set: subject },
      });
      expect(await res.json()).toEqual({ allowed });
    }

    // Only objects in the subject's graph are checked.
    const graphIds = new Set(await graphNodeIds(page));
    const checked = await page.locator(".perm-object").allTextContents();
    expect(checked.length).toBeGreaterThan(0);
    expect(checked.filter((id) => !graphIds.has(id))).toEqual([]);
  });

  test("the graph renders the selected subject with its relations", async ({ page }) => {
    await openLive(page);
    await expectLiveTuplesLoaded(page);
    await pickSubject(page, "User", "User:user-0001");

    const graph = await renderedGraph(page);
    const center = graph?.nodes.find((n) => n.isSelectedUser);
    expect(center?.id).toBe("User:user-0001");
    expect(graph!.nodes.length).toBeGreaterThan(1);
    expect(graph!.edges.some((e) => e.source === "User:user-0001")).toBe(true);
  });

  test("the sidebar lists exactly the subject's direct relations", async ({ page, request }) => {
    const res = await request.get(
      "/api/relation-tuples?subject_set.namespace=User&subject_set.object=user-0001&subject_set.relation=",
    );
    const direct = ((await res.json()).relation_tuples as { namespace: string; object: string; relation: string }[])
      .map((t) => `${t.relation}->${t.namespace}:${t.object}`)
      .sort();
    expect(direct.length).toBeGreaterThan(0);

    await openLive(page);
    await expectLiveTuplesLoaded(page);
    await pickSubject(page, "User", "User:user-0001");

    await expect(page.getByRole("heading", { name: "Direct Relations" })).toBeVisible();
    const shown = (await page.locator(".relation-item").allTextContents()).sort();
    expect(shown).toEqual(direct);
  });

  test("the namespace legend lists the live namespaces", async ({ page }) => {
    await openLive(page);
    await expectLiveTuplesLoaded(page);

    await expect(page.getByRole("heading", { name: "Namespaces" })).toBeVisible();
    await expect(page.locator(".legend-item")).toHaveText(LOCAL_KETO_NAMESPACES);
  });

  test("switching use cases resets the subject and re-fetches", async ({ page }) => {
    await openLive(page);
    await expectLiveTuplesLoaded(page);
    await pickSubject(page, "User", "User:user-0001");

    await page.locator("select").first().selectOption({ label: LOCAL_EXAMPLE });

    await expect(page.getByLabel("Subject Namespace")).toHaveValue("");
    await expect(page.getByLabel("Subject", { exact: true })).toHaveValue("");
    await expectLiveTuplesLoaded(page);
  });
});

test.describe("Permission checks that fail (local Keto)", () => {
  const run = runId();
  const user = `pw-chk-user-${run}`;
  const okDoc = `pw-chk-ok-${run}`;
  const erroringDoc = `pw-chk-500-${run}`;
  const hangingDoc = `pw-chk-hang-${run}`;
  const docs = [okDoc, erroringDoc, hangingDoc];

  test.beforeAll(async ({ request }) => {
    await expectLocalKeto(request);
  });

  test.beforeEach(async ({ request }) => {
    await putTuples(
      request,
      docs.map((object) => ({ namespace: "Document", object, relation: "viewers", subject_set: { namespace: "User", object: user, relation: "" } })),
    );
  });

  test.afterEach(async ({ request }) => {
    for (const object of docs) await deleteObjectTuples(request, "Document", object);
  });

  test("errored and timed-out checks are counted, the other verdicts still show", async ({ page }) => {
    // Real Keto behind a proxy that answers checks on one document with 500 and
    // never answers those on another (the client gives up after 15 s).
    const upstream = await startFaultyUpstream(process.env.ORY_SDK_URL!, { error: [erroringDoc], hang: [hangingDoc] });
    const server = await startDevServer({ ORY_SDK_URL: upstream.url, ORY_ACCESS_TOKEN: process.env.ORY_ACCESS_TOKEN ?? "" });
    try {
      await openLive(page, server.url);
      await page.locator("select").first().selectOption({ label: LOCAL_EXAMPLE });
      await expectLiveTuplesLoaded(page);
      await pickSubject(page, "User", `User:${user}`);

      // Document view + edit on each of the 3 documents; 2 x 2 of them fail.
      await expect(page.locator(".status-indicator.error")).toHaveText("4 permission checks failed", { timeout: 45_000 });
      await expect(page.locator(".perm-object")).toHaveText([`Document:${okDoc}`]);
      const card = page.locator(".permission-card");
      await expect(card).toContainText("view: ALLOWED");
      await expect(card).toContainText("edit: DENIED");
      await expect(page.getByText("Checking permissions...")).toHaveCount(0);
      expect(await graphNodeIds(page)).toEqual([...docs.map((d) => `Document:${d}`), `User:${user}`].sort());
    } finally {
      await server.stop();
      await upstream.close();
    }
  });

  test("no failure indicator when every check succeeds", async ({ page }) => {
    await openLive(page);
    await page.locator("select").first().selectOption({ label: LOCAL_EXAMPLE });
    await expectLiveTuplesLoaded(page);
    await pickSubject(page, "User", `User:${user}`);

    await expect
      .poll(async () => (await page.locator(".perm-object").allTextContents()).sort(), { timeout: 30_000 })
      .toEqual(docs.map((d) => `Document:${d}`).sort());
    await expect(page.getByText("Checking permissions...")).toHaveCount(0);
    await expect(page.getByText(/permission checks failed/)).toHaveCount(0);
  });
});

test.describe("Offline mode", () => {
  test("Offline mode lists neither Explore Live Data nor the live-only example", async ({ page }) => {
    await page.goto("/");
    const options = await page.locator("select").first().locator("option").allTextContents();
    expect(options).toContain("RBAC App Access");
    expect(options).not.toContain("Explore Live Data");
    expect(options).not.toContain(LOCAL_EXAMPLE);
  });
});

test.describe("error handling", () => {
  test("shows an error when the proxy cannot reach Keto", async ({ page }) => {
    const unreachable = `http://127.0.0.1:${await freePort()}`;
    const server = await startDevServer({ ORY_SDK_URL: unreachable, ORY_ACCESS_TOKEN: "unused" });
    try {
      await openLive(page, server.url);

      await expect(page.locator(".status-indicator.error")).toContainText("Error:", { timeout: 15_000 });
      await expect(page.getByText("Failed to connect to Ory Keto")).toBeVisible();
      await expect(page.locator(".connection-status")).toHaveCount(0);
      await expect(page.getByLabel("Subject Namespace")).toBeDisabled();
      await expect(page.getByLabel("Subject Namespace").locator("option")).toHaveText(["No subjects found"]);
    } finally {
      await server.stop();
    }
  });
});
