/**
 * E2E tests for the merged subject picker and graph filters, against the
 * bundled offline data (no Keto needed): subject sets with a relation as the
 * subject, the Branch filter, pruning of other leaf subjects ("people") and
 * disconnected nodes, legacy Direct ID subjects, and the live-only delete panel.
 *
 * Expected graphs are derived from the rag-document-access tuples in
 * src/data/offlineExamples.ts.
 */
import { test, expect } from "@playwright/test";

import { graphNodeIds, pickSubject, renderedGraph, tapNode } from "./helpers/graph";

const ENGINEERING_DOCS = [
  "Document:api-design-doc",
  "Document:cross-team-roadmap",
  "Document:deployment-runbook",
  "Document:design-system-v2",
  "Document:incident-postmortem-42",
  "Document:product-launch-brief",
];

test.describe("Subject picker and graph filters (offline mode)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.locator("select").first().selectOption({ label: "RAG Document Access" });
  });

  test("Subject dropdown is disabled until a subject namespace is picked", async ({ page }) => {
    const subject = page.getByLabel("Subject", { exact: true });
    await expect(subject).toBeDisabled();
    await expect(subject.locator("option").first()).toHaveText("Pick a namespace first...");

    await page.getByLabel("Subject Namespace").selectOption("Team");
    await expect(subject).toBeEnabled();
  });

  test("subject sets with a relation are listed as 'object #relation' under their namespace", async ({ page }) => {
    await page.getByLabel("Subject Namespace").selectOption("Team");
    const options = page.getByLabel("Subject", { exact: true }).locator("option");
    await expect(options).toHaveText([
      "Select a subject...",
      "design #members",
      "engineering #members",
      "leadership #members",
      "marketing #members",
    ]);
  });

  test("a subject set with a relation renders the objects it is granted on", async ({ page }) => {
    await pickSubject(page, "Team", "Team:engineering#members");

    const graph = await renderedGraph(page);
    expect(graph).not.toBeNull();
    const ids = graph!.nodes.map((n) => n.id);
    expect(ids).toEqual(expect.arrayContaining([...ENGINEERING_DOCS, "Team:engineering"]));
    // People (leaf subjects) are pruned.
    expect(ids.filter((id) => id.startsWith("User:"))).toEqual([]);
    const center = graph!.nodes.find((n) => n.isSelectedUser);
    expect(center?.label).toBe("engineering #members");
    for (const doc of ENGINEERING_DOCS) {
      expect(graph!.edges).toContainEqual({
        source: "Team:engineering",
        target: doc,
        label: "viewers (from #members)",
      });
    }
    await expect(page.locator(".relation-item")).toHaveCount(ENGINEERING_DOCS.length);
  });

  test("a team's graph hides the other teams that only share its documents", async ({ page }) => {
    // design, marketing and leadership view cross-team-roadmap, design-system-v2 and
    // product-launch-brief too, but grant Team:engineering nothing.
    await pickSubject(page, "Team", "Team:engineering#members");

    const ids = await graphNodeIds(page);
    expect(ids.filter((id) => id.startsWith("Team:"))).toEqual(["Team:engineering"]);
    expect(ids).toEqual([...ENGINEERING_DOCS, "Team:engineering"].sort());
  });

  test("a user's graph still shows the teams on documents it can see", async ({ page }) => {
    // Hiding applies to the subject's own namespace only: for User:alice, the other
    // teams that view the shared roadmap are context, not her peers.
    await pickSubject(page, "User", "User:alice");

    const graph = await renderedGraph(page);
    for (const team of ["Team:design", "Team:leadership", "Team:marketing"]) {
      expect(graph!.edges).toContainEqual({ source: "Document:cross-team-roadmap", target: team, label: "viewers" });
    }
  });

  test("the selected subject is the only node of its namespace in the graph", async ({ page }) => {
    // Team:engineering's members (bob, charlie, oscar) and the other people on
    // shared documents are leaf subjects: pruned, only alice remains.
    await pickSubject(page, "User", "User:alice");

    const ids = await graphNodeIds(page);
    expect(ids.filter((id) => id.startsWith("User:"))).toEqual(["User:alice"]);
    expect(ids).toEqual(expect.arrayContaining(["Team:engineering", "Document:alice-private-notes"]));
  });

  test("Branch lists one option per node the subject relates to directly", async ({ page }) => {
    await pickSubject(page, "User", "User:alice");

    await expect(page.getByLabel("Branch").locator("option")).toHaveText([
      "All branches (6)",
      "Team:engineering",
      "Document:api-design-doc",
      "Document:alice-private-notes",
      "Document:cross-team-roadmap",
      "Document:budget-forecast",
      "Document:product-launch-brief",
    ]);
  });

  test("picking a leaf branch narrows the graph to that single relation", async ({ page }) => {
    await pickSubject(page, "User", "User:alice");
    await page.getByLabel("Branch").selectOption("Document:alice-private-notes");

    await expect.poll(() => graphNodeIds(page)).toEqual(["Document:alice-private-notes", "User:alice"]);
    // The sidebar still lists every direct relation.
    await expect(page.locator(".relation-item")).toHaveCount(6);
  });

  test("picking a branch keeps every node it grants, including ones also granted directly", async ({ page }) => {
    await pickSubject(page, "User", "User:alice");
    await page.getByLabel("Branch").selectOption("Team:engineering");

    // Every document Team:engineering grants stays, including the ones alice also
    // views directly; alice-private-notes and budget-forecast are only reachable
    // through her own direct tuples.
    await expect.poll(() => graphNodeIds(page)).toEqual(
      expect.arrayContaining(["Team:engineering", "User:alice", ...ENGINEERING_DOCS]),
    );
    const ids = await graphNodeIds(page);
    expect(ids).not.toContain("Document:alice-private-notes");
    expect(ids).not.toContain("Document:budget-forecast");
    const graph = await renderedGraph(page);
    expect(graph!.edges.filter((e) => e.source === "User:alice")).toEqual([
      { source: "User:alice", target: "Team:engineering", label: "members" },
    ]);
  });

  test("changing the subject resets the branch filter", async ({ page }) => {
    await pickSubject(page, "User", "User:alice");
    await page.getByLabel("Branch").selectOption("Document:alice-private-notes");

    await page.getByLabel("Subject", { exact: true }).selectOption("User:bob");
    await expect(page.getByLabel("Branch")).toHaveValue("");
    expect(await graphNodeIds(page)).toContain("Team:engineering");
  });

  test("class scope is disabled for subjects that are not a ClaudeClass", async ({ page }) => {
    await pickSubject(page, "User", "User:alice");
    const scope = page.getByRole("checkbox", { name: "Select a class subject" });
    await expect(scope).toBeDisabled();
  });

  test("a legacy subject_id added in the editor is drawn as the graph's subject", async ({ page }) => {
    await page.locator(".rel-toggle-btn").click();
    await page.getByRole("button", { name: "+ Add Tuple" }).click();
    await page.locator(".rel-add-form select.rel-input").selectOption("Document");
    await page.locator('.rel-add-form input[placeholder="Object"]').fill("api-design-doc");
    await page.locator('.rel-add-form input[placeholder="Relation"]').fill("viewers");
    await page.locator('.rel-add-form input[placeholder="Subject ID"]').fill("svc-indexer");
    await page.locator(".rel-add-form button[type='submit']").click();

    await pickSubject(page, "Direct ID", "svc-indexer");

    const graph = await renderedGraph(page);
    const center = graph?.nodes.find((n) => n.isSelectedUser);
    expect(center?.label).toBe("svc-indexer");
    expect(graph?.edges).toContainEqual({ source: center?.id, target: "Document:api-design-doc", label: "viewers" });
  });

  test("tapping a node in offline mode does not offer to delete tuples", async ({ page }) => {
    await pickSubject(page, "User", "User:alice");
    await tapNode(page, "Document:alice-private-notes");

    await expect(page.getByRole("heading", { name: "Selected Node" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Delete \d+ tuple/ })).toHaveCount(0);
  });
});
