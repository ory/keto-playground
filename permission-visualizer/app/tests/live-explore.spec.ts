/**
 * E2E tests for Live → "Explore Live Data" against the local Keto in
 * permission-visualizer/local-keto (OPL from local-keto/namespaces.ts, tuples
 * from local-keto/seed.mjs). Start it with `bash local-keto/up.sh` and run with
 *   ORY_SDK_URL=http://localhost:4455 ORY_ACCESS_TOKEN=local ALLOW_TUPLE_DELETE=1
 * so the dev server's /api proxy points at it and forwards tuple deletes.
 *
 * Read-only tests use the seeded graph; the delete tests create (directly in
 * Keto) and clean up their own uniquely named tuples.
 */
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import { startDevServer } from "./helpers/devServer";
import { graphNodeIds, pickSubject, renderedGraph, tapNode } from "./helpers/graph";
import { deleteObjectTuples, expectLocalKeto, patchTuples, putTuples, runId, tuplesOnObject } from "./helpers/keto";
import type { TestTuple } from "./helpers/keto";

const OTHER_CLASS_DOC = /^Document:.+\/claude-(sonnet|haiku|fable)$/;

async function openExplore(page: Page, baseUrl = "") {
  await page.goto(`${baseUrl}/`);
  await page.getByRole("button", { name: "Live" }).click();
  await expect(page.locator(".connection-status")).toContainText(/Live — \d+ tuples/, { timeout: 30_000 });
}

test.beforeAll(async ({ request }) => {
  await expectLocalKeto(request);
});

test.describe("Explore Live Data (local Keto)", () => {
  test("Subject Namespace lists Direct ID first, then the subject namespaces", async ({ page }) => {
    await openExplore(page);
    await expect(page.getByLabel("Subject Namespace").locator("option")).toHaveText([
      "Select a namespace...",
      "Direct ID",
      "ClaudeClass",
      "Folder",
      "Group",
      "Role",
      "User",
    ]);
  });

  test("ClaudeClass subjects are offered as subject sets with their relation", async ({ page }) => {
    await openExplore(page);
    await page.getByLabel("Subject Namespace").selectOption("ClaudeClass");
    await expect(page.getByLabel("Subject", { exact: true }).locator("option")).toHaveText([
      "Select a subject...",
      "claude-fable #members",
      "claude-haiku #members",
      "claude-opus #members",
      "claude-sonnet #members",
    ]);
  });

  test("a legacy subject_id renders its direct relation", async ({ page }) => {
    await openExplore(page);
    await pickSubject(page, "Direct ID", "legacy-service-1");

    const graph = await renderedGraph(page);
    const center = graph?.nodes.find((n) => n.isSelectedUser);
    expect(center?.label).toBe("legacy-service-1");
    expect(graph?.edges).toContainEqual({ source: center?.id, target: "Document:doc-2999", label: "viewers" });
  });

  test("class scope hides resources of other classes and can be turned off", async ({ page }) => {
    await openExplore(page);
    await pickSubject(page, "ClaudeClass", "ClaudeClass:claude-opus#members");

    const scope = page.getByRole("checkbox", { name: "Only claude-opus" });
    await expect(scope).toBeEnabled();
    await expect(scope).toBeChecked();
    const scoped = await graphNodeIds(page);
    expect(scoped).toContain("Document:report-0016/claude-opus");
    expect(scoped.filter((id) => OTHER_CLASS_DOC.test(id))).toEqual([]);

  });

  test("a Group subject set's graph shows its parent group but not its sibling groups", async ({ page }) => {
    // acme.div1's members are members of Group:acme (a grant); acme's other
    // divisions and div1's own sub-groups grant div1 nothing.
    await openExplore(page);
    await pickSubject(page, "Group", "Group:acme.div1#members");

    const graph = await renderedGraph(page);
    expect(graph!.nodes.filter((n) => n.namespace === "Group").map((n) => n.id).sort()).toEqual([
      "Group:acme",
      "Group:acme.div1",
    ]);
    expect(graph!.edges).toContainEqual({ source: "Group:acme.div1", target: "Group:acme", label: "members (from #members)" });
  });

  test("a department's graph shows the whole chain of groups it inherits membership of", async ({ page }) => {
    // dept1 -> div1 -> acme; dept1's sibling departments and its own teams are hidden.
    await openExplore(page);
    await pickSubject(page, "Group", "Group:acme.div1.dept1#members");

    const groups = (await graphNodeIds(page)).filter((id) => id.startsWith("Group:"));
    expect(groups).toEqual(["Group:acme", "Group:acme.div1", "Group:acme.div1.dept1"]);
  });

  test("a Group subject set's graph contains every node it relates to directly", async ({ page }) => {
    // Group:acme.div1#members is a member of Group:acme and owns/edits folders.
    await openExplore(page);
    await pickSubject(page, "Group", "Group:acme.div1#members");

    const directTargets = (await page.locator(".relation-item").allTextContents()).map((t) =>
      t.slice(t.indexOf("->") + 2).trim(),
    );
    expect(directTargets).toContain("Group:acme");
    expect(await graphNodeIds(page)).toEqual(expect.arrayContaining(directTargets));
  });

  test("Folder:root's graph shows its child folders f1.1–f1.4", async ({ page }) => {
    await openExplore(page);
    await pickSubject(page, "Folder", "Folder:root");

    const graph = await renderedGraph(page);
    for (const child of ["Folder:f1.1", "Folder:f1.2", "Folder:f1.3", "Folder:f1.4"]) {
      expect(graph?.edges).toContainEqual({ source: "Folder:root", target: child, label: "parents" });
    }
  });

  test("picking a Folder branch of Folder:root shows that folder's subtree only", async ({ page }) => {
    await openExplore(page);
    await pickSubject(page, "Folder", "Folder:root");
    await page.getByLabel("Branch").selectOption("Folder:f1.1");

    await expect.poll(() => graphNodeIds(page)).toEqual(
      expect.arrayContaining(["Folder:root", "Folder:f1.1", "Folder:f1.1-f2.1", "Folder:f1.1-f2.2", "Folder:f1.1-f2.3"]),
    );
    // Root's direct edges to its other children are dropped.
    const graph = await renderedGraph(page);
    expect(graph!.edges.filter((e) => e.source === "Folder:root").map((e) => e.target)).toEqual(["Folder:f1.1"]);
  });

  test("a subject with a huge graph is capped at 150 nodes and says so", async ({ page }) => {
    await openExplore(page);
    await pickSubject(page, "User", "User:user-hub");

    const graph = await renderedGraph(page);
    expect(graph!.nodes.length).toBeLessThanOrEqual(150);
    const notice = page.getByRole("status").filter({ hasText: "Showing the first" });
    await expect(notice).toContainText(`Showing the first ${graph!.nodes.length} nodes of a larger graph`);
  });

  test("wide tiers wrap onto rows of at most 15 nodes", async ({ page }) => {
    // user-hub's first hop alone is 84 nodes.
    await openExplore(page);
    await pickSubject(page, "User", "User:user-hub");
    await renderedGraph(page);

    const rowSizes = await page.evaluate(() => {
      type Cy = { nodes(): { position(k: "y"): number }[] };
      const cy = (document.querySelector(".cy") as Element & { _cyreg: { cy: Cy } })._cyreg.cy;
      const rows = new Map<number, number>();
      for (const n of Array.from(cy.nodes())) {
        const y = Math.round(n.position("y"));
        rows.set(y, (rows.get(y) ?? 0) + 1);
      }
      return Array.from(rows.values());
    });
    expect(Math.max(...rowSizes)).toBe(15);
    expect(rowSizes.length).toBeGreaterThanOrEqual(Math.ceil(150 / 15));
  });

  test("a small graph shows no truncation notice", async ({ page }) => {
    await openExplore(page);
    await pickSubject(page, "Direct ID", "legacy-service-1");
    expect((await renderedGraph(page))!.nodes.length).toBeLessThan(150);

    await expect(page.locator(".graph-truncated")).toHaveCount(0);
  });

  test("namespaces with more than 50 subjects get a subject filter", async ({ page }) => {
    await openExplore(page);
    await page.getByLabel("Subject Namespace").selectOption("User");
    const filter = page.getByLabel("Filter subjects");
    await filter.fill("hub");

    await expect(page.getByLabel("Subject", { exact: true }).locator("option")).toHaveText(["Select a subject...", "user-hub"]);
    await page.getByLabel("Subject", { exact: true }).selectOption("User:user-hub");
    await expect(filter).toHaveValue("");

    // Filtering never drops the selected subject from the list.
    await filter.fill("user-00");
    const subject = page.getByLabel("Subject", { exact: true });
    await expect(subject).toHaveValue("User:user-hub");
    const options = await subject.locator("option").allTextContents();
    expect(options).toContain("user-hub");
    expect(options.filter((o) => o !== "user-hub" && o !== "Select a subject...").every((o) => o.includes("user-00"))).toBe(true);
    await filter.fill("no-subject-matches-this");
    await expect(subject.locator("option")).toHaveText(["Select a subject...", "user-hub"]);
    await expect(subject).toHaveValue("User:user-hub");
    expect(await graphNodeIds(page)).toContain("User:user-hub");

    // ClaudeClass has only 4 subjects.
    await page.getByLabel("Subject Namespace").selectOption("ClaudeClass");
    await expect(page.getByLabel("Filter subjects")).toHaveCount(0);
  });
});

test.describe("Deleting a node's tuples (local Keto)", () => {
  const run = runId();
  const user = `pw-user-${run}`;
  const doc = `pw-doc-${run}`;
  const otherDoc = `pw-other-${run}`;
  const folder = `pw-folder-${run}`;
  const docTuples: TestTuple[] = [
    { namespace: "Document", object: doc, relation: "viewers", subject_set: { namespace: "User", object: user, relation: "" } },
    { namespace: "Document", object: doc, relation: "parents", subject_set: { namespace: "Folder", object: folder, relation: "" } },
  ];
  // References the same user but not the deleted node; must survive.
  const sentinel: TestTuple = { namespace: "Document", object: otherDoc, relation: "viewers", subject_set: { namespace: "User", object: user, relation: "" } };

  const tuplesOf = (request: Parameters<typeof tuplesOnObject>[0], object: string) =>
    tuplesOnObject(request, "Document", object);

  test.beforeEach(async ({ request }) => {
    await putTuples(request, [...docTuples, sentinel]);
  });

  test.afterEach(async ({ request }) => {
    for (const object of [doc, otherDoc]) await deleteObjectTuples(request, "Document", object);
  });

  async function openDeleteDialog(page: Page) {
    await openExplore(page);
    await pickSubject(page, "User", `User:${user}`);
    expect(await graphNodeIds(page)).toEqual([`Document:${doc}`, `Document:${otherDoc}`, `User:${user}`].sort());

    await tapNode(page, `Document:${doc}`);
    const panel = page.locator(".node-delete-panel");
    await expect(panel).toContainText(`Document:${doc}`);
    await expect(panel).toContainText("2 tuples reference this node");
    await panel.getByRole("button", { name: "Delete 2 tuples" }).click();
  }

  test("the confirm dialog lists exactly the tuples that reference the node", async ({ page }) => {
    await openDeleteDialog(page);

    await expect(page.getByRole("heading", { name: "Delete 2 tuples?" })).toBeVisible();
    const listed = await page.locator(".modal-tuple").allTextContents();
    expect(listed.sort()).toEqual(
      [`Document:${doc}#parents @ Folder:${folder}`, `Document:${doc}#viewers @ User:${user}`].sort(),
    );
  });

  test("cancelling the dialog deletes nothing", async ({ page, request }) => {
    await openDeleteDialog(page);
    await page.getByRole("button", { name: "Cancel" }).click();

    await expect(page.getByRole("heading", { name: "Delete 2 tuples?" })).toHaveCount(0);
    expect(await tuplesOf(request, doc)).toHaveLength(2);
    expect(await tuplesOf(request, otherDoc)).toHaveLength(1);
  });

  test("confirming deletes only the node's tuples and refreshes the graph", async ({ page, request }) => {
    await openDeleteDialog(page);
    await page.getByRole("button", { name: "Delete 2", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Delete 2 tuples?" })).toHaveCount(0);
    await expect(page.locator(".delete-error")).toHaveCount(0);
    expect(await tuplesOf(request, doc)).toEqual([]);
    expect(await tuplesOf(request, otherDoc)).toHaveLength(1);
    await expect.poll(() => graphNodeIds(page)).toEqual([`Document:${otherDoc}`, `User:${user}`].sort());
  });
});

test.describe("Deleting a node with more than 25 tuples (local Keto)", () => {
  const run = runId();
  const user = `pw-big-user-${run}`;
  const doc = `pw-big-doc-${run}`;
  const nodeId = `Document:${doc}`;
  // The user plus 25 other viewers: 26 tuples reference the document.
  const tuples: TestTuple[] = [user, ...Array.from({ length: 25 }, (_, i) => `pw-big-viewer-${i}-${run}`)].map(
    (viewer) => ({ namespace: "Document", object: doc, relation: "viewers", subject_set: { namespace: "User", object: viewer, relation: "" } }),
  );

  test.beforeEach(async ({ request }) => {
    await putTuples(request, tuples);
  });

  test.afterEach(async ({ request }) => {
    await deleteObjectTuples(request, "Document", doc);
  });

  test("requires typing the node ID before deleting", async ({ page, request }) => {
    await openExplore(page);
    await pickSubject(page, "User", `User:${user}`);
    await tapNode(page, nodeId);
    await page.getByRole("button", { name: "Delete 26 tuples" }).click();

    await expect(page.getByRole("heading", { name: "Delete 26 tuples?" })).toBeVisible();
    const confirmButton = page.getByRole("button", { name: "Delete 26", exact: true });
    const confirmInput = page.getByLabel("Confirm node ID");
    await expect(confirmButton).toBeDisabled();

    await confirmInput.fill(nodeId.slice(0, -1));
    await expect(confirmButton).toBeDisabled();
    await confirmInput.fill(`${nodeId} `);
    await expect(confirmButton).toBeDisabled();
    expect(await tuplesOnObject(request, "Document", doc)).toHaveLength(26);

    await confirmInput.fill(nodeId);
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();

    await expect(page.getByRole("heading", { name: "Delete 26 tuples?" })).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(await tuplesOnObject(request, "Document", doc)).toEqual([]);
  });

  test("the typed confirmation is cleared when the dialog is reopened", async ({ page }) => {
    await openExplore(page);
    await pickSubject(page, "User", `User:${user}`);
    await tapNode(page, nodeId);
    await page.getByRole("button", { name: "Delete 26 tuples" }).click();
    await page.getByLabel("Confirm node ID").fill(nodeId);
    await page.getByRole("button", { name: "Cancel" }).click();

    await page.getByRole("button", { name: "Delete 26 tuples" }).click();
    await expect(page.getByLabel("Confirm node ID")).toHaveValue("");
    await expect(page.getByRole("button", { name: "Delete 26", exact: true })).toBeDisabled();
  });
});

test.describe("Deleting a legacy subject_id's node (local Keto)", () => {
  const run = runId();
  const id = `pw-legacy-${run}`;
  const legacyDoc = `pw-legacy-doc-${run}`;
  const namespacedDoc = `pw-namespaced-doc-${run}`;

  test.beforeEach(async ({ request }) => {
    await putTuples(request, [
      { namespace: "Document", object: legacyDoc, relation: "viewers", subject_id: id },
      { namespace: "Document", object: namespacedDoc, relation: "viewers", subject_set: { namespace: "User", object: id, relation: "" } },
    ]);
  });

  test.afterEach(async ({ request }) => {
    for (const object of [legacyDoc, namespacedDoc]) await deleteObjectTuples(request, "Document", object);
  });

  test("deletes only the subject_id's tuples, not those of User:<same id>", async ({ page, request }) => {
    await openExplore(page);
    await pickSubject(page, "Direct ID", id);
    const graph = await renderedGraph(page);
    const center = graph!.nodes.find((n) => n.isSelectedUser)!;
    expect(graph!.nodes.map((n) => n.id).sort()).toEqual([`Document:${legacyDoc}`, center.id].sort());

    await tapNode(page, center.id);
    const panel = page.locator(".node-delete-panel");
    await expect(panel.locator(".node-id")).toHaveText(id);
    await expect(panel).toContainText("1 tuple reference this node");
    await panel.getByRole("button", { name: "Delete 1 tuple" }).click();
    await expect(page.locator(".modal-tuple")).toHaveText([`Document:${legacyDoc}#viewers @ ${id}`]);
    await page.getByRole("button", { name: "Delete 1", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Delete 1 tuple?" })).toHaveCount(0);
    expect(await tuplesOnObject(request, "Document", legacyDoc)).toEqual([]);
    expect(await tuplesOnObject(request, "Document", namespacedDoc)).toEqual([
      { namespace: "Document", object: namespacedDoc, relation: "viewers", subject_set: { namespace: "User", object: id, relation: "" } },
    ]);
  });
});

test.describe("Deleting when the server has tuple deletion disabled (local Keto)", () => {
  const run = runId();
  const user = `pw-nodelete-user-${run}`;
  const doc = `pw-nodelete-doc-${run}`;
  let server: Awaited<ReturnType<typeof startDevServer>>;

  test.beforeAll(async () => {
    server = await startDevServer({
      ORY_SDK_URL: process.env.ORY_SDK_URL ?? "",
      ORY_ACCESS_TOKEN: process.env.ORY_ACCESS_TOKEN ?? "",
      ALLOW_TUPLE_DELETE: "",
    });
  });

  test.afterAll(async () => {
    await server?.stop();
  });

  test.beforeEach(async ({ request }) => {
    await putTuples(request, [
      { namespace: "Document", object: doc, relation: "viewers", subject_set: { namespace: "User", object: user, relation: "" } },
    ]);
  });

  test.afterEach(async ({ request }) => {
    await deleteObjectTuples(request, "Document", doc);
  });

  test("shows the server's refusal in the dialog, keeps the tuple and does not refetch", async ({ page, request }) => {
    await openExplore(page, server.url);
    await pickSubject(page, "User", `User:${user}`);
    await tapNode(page, `Document:${doc}`);
    await page.getByRole("button", { name: "Delete 1 tuple" }).click();
    const reads: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "GET" && new URL(r.url()).pathname.startsWith("/api/")) reads.push(r.url());
    });
    const confirm = page.getByRole("button", { name: "Delete 1", exact: true });
    await confirm.click();

    const modal = page.locator(".modal");
    await expect(modal.getByRole("alert")).toHaveText(
      "Deleted 0 of 1 tuples; 1 failed (403: Tuple deletion is disabled (set ALLOW_TUPLE_DELETE=1 to enable))",
    );
    await expect(modal.getByRole("heading", { name: "Delete 1 tuple?" })).toBeVisible();
    await expect(modal.locator(".modal-tuple")).toHaveText([`Document:${doc}#viewers @ User:${user}`]);
    await expect(confirm).toBeEnabled();
    expect(reads).toEqual([]);
    expect(await tuplesOnObject(request, "Document", doc)).toHaveLength(1);
    expect(await graphNodeIds(page)).toEqual([`Document:${doc}`, `User:${user}`].sort());
  });
});

test.describe("Deleting when some of a node's tuples fail (local Keto)", () => {
  const run = runId();
  const user = `pw-partial-user-${run}`;
  const doc = `pw-partial-doc-${run}`;
  const otherDoc = `pw-partial-other-${run}`;
  // The delete URL for this subject is longer than the local router accepts (nginx
  // answers 414), so its delete fails for real while the other one succeeds.
  const longUser = `pw-long-${run}-${"x".repeat(9000)}`;
  const deletable: TestTuple = { namespace: "Document", object: doc, relation: "viewers", subject_set: { namespace: "User", object: user, relation: "" } };
  const undeletable: TestTuple = { namespace: "Document", object: doc, relation: "viewers", subject_set: { namespace: "User", object: longUser, relation: "" } };

  test.beforeEach(async ({ request }) => {
    await patchTuples(request, "insert", [
      deletable,
      undeletable,
      { namespace: "Document", object: otherDoc, relation: "viewers", subject_set: { namespace: "User", object: user, relation: "" } },
    ]);
  });

  test.afterEach(async ({ request }) => {
    for (const object of [doc, otherDoc]) await deleteObjectTuples(request, "Document", object);
  });

  test("keeps the dialog open on just the failed tuples, with the reason, and refreshes the graph", async ({ page, request }) => {
    await openExplore(page);
    await pickSubject(page, "User", `User:${user}`);
    await tapNode(page, `Document:${doc}`);
    await expect(page.locator(".node-delete-panel")).toContainText("2 tuples reference this node");
    await page.getByRole("button", { name: "Delete 2 tuples" }).click();
    const reads: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "GET" && new URL(r.url()).pathname === "/api/namespaces") reads.push(r.url());
    });
    await page.getByRole("button", { name: "Delete 2", exact: true }).click();

    const modal = page.locator(".modal");
    await expect(modal.getByRole("heading", { name: "Delete 1 tuple?" })).toBeVisible();
    await expect(modal.getByRole("alert")).toContainText("Deleted 1 of 2 tuples; 1 failed (414");
    await expect(modal.locator(".modal-tuple")).toHaveText([`Document:${doc}#viewers @ User:${longUser}`]);
    await expect(modal.getByRole("button", { name: "Delete 1", exact: true })).toBeEnabled();
    expect(await tuplesOnObject(request, "Document", doc)).toEqual([undeletable]);
    // Something was deleted, so the data is refetched: the user no longer reaches the document.
    expect(reads).toHaveLength(1);
    await expect.poll(() => graphNodeIds(page)).toEqual([`Document:${otherDoc}`, `User:${user}`].sort());

    await modal.getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator(".modal")).toHaveCount(0);
  });
});

test.describe("Class scope and the node budget (local Keto)", () => {
  const run = runId();
  const classA = `pw-cls-a-${run}`;
  const classB = `pw-cls-b-${run}`;
  const viewerOf = (object: string, cls: string): TestTuple => ({
    namespace: "Document",
    object,
    relation: "viewers",
    subject_set: { namespace: "ClaudeClass", object: cls, relation: "members" },
  });
  // classA's members view 300 documents of class B (more than the node budget)
  // and 10 of their own class.
  const inClassDocs = Array.from({ length: 10 }, (_, i) => `pw-in-${i}-${run}/${classA}`);
  const tuples = [
    ...Array.from({ length: 300 }, (_, i) => viewerOf(`pw-out-${i}-${run}/${classB}`, classA)),
    ...inClassDocs.map((doc) => viewerOf(doc, classA)),
    // Makes classB a known class.
    viewerOf(`pw-b-${run}/${classB}`, classB),
  ];

  test.beforeEach(async ({ request }) => {
    await patchTuples(request, "insert", tuples);
  });

  test.afterEach(async ({ request }) => {
    await patchTuples(request, "delete", tuples);
  });

  test("out-of-class nodes do not use up the node budget", async ({ page }) => {
    await openExplore(page);
    await pickSubject(page, "ClaudeClass", `ClaudeClass:${classA}#members`);

    await expect(page.getByRole("checkbox", { name: `Only ${classA}` })).toBeChecked();
    expect(await graphNodeIds(page)).toEqual([`ClaudeClass:${classA}`, ...inClassDocs.map((d) => `Document:${d}`)].sort());
    await expect(page.locator(".graph-truncated")).toHaveCount(0);
  });

  test("turning class scope off shows the other class's documents up to the budget", async ({ page }) => {
    await openExplore(page);
    await pickSubject(page, "ClaudeClass", `ClaudeClass:${classA}#members`);
    await page.getByRole("checkbox", { name: `Only ${classA}` }).uncheck();

    await expect(page.getByRole("status").filter({ hasText: "Showing the first 150 nodes" })).toBeVisible();
    const ids = await graphNodeIds(page);
    expect(ids).toHaveLength(150);
    expect(ids.filter((id) => id.endsWith(`/${classB}`)).length).toBeGreaterThan(0);

    await page.getByRole("checkbox", { name: `Only ${classA}` }).check();
    await expect.poll(async () => (await graphNodeIds(page)).filter((id) => id.endsWith(`/${classB}`))).toEqual([]);
  });
});

test.describe("Hidden peers and the node budget (local Keto)", () => {
  const run = runId();
  const parent = `pw-parent-${run}`;
  const child = `pw-child-${run}`;
  const role = `pw-role-${run}`;
  const members = (object: string) => ({ namespace: "Group", object, relation: "members" });
  // child's members are members of parent, which holds a role. parent has 200
  // other member groups: child's peers, which grant child nothing.
  const tuples: TestTuple[] = [
    { namespace: "Group", object: parent, relation: "members", subject_set: members(child) },
    ...Array.from({ length: 200 }, (_, i): TestTuple => ({
      namespace: "Group",
      object: parent,
      relation: "members",
      subject_set: members(`pw-sib-${i}-${run}`),
    })),
    { namespace: "Role", object: role, relation: "holders", subject_set: members(parent) },
  ];

  test.beforeEach(async ({ request }) => {
    await patchTuples(request, "insert", tuples);
  });

  test.afterEach(async ({ request }) => {
    await patchTuples(request, "delete", tuples);
  });

  test("hidden sibling groups do not push granting nodes out of the graph", async ({ page }) => {
    await openExplore(page);
    await pickSubject(page, "Group", `Group:${child}#members`);

    expect(await graphNodeIds(page)).toEqual([`Group:${child}`, `Group:${parent}`, `Role:${role}`].sort());
    await expect(page.locator(".graph-truncated")).toHaveCount(0);
  });
});
