/**
 * Read the rendered Cytoscape graph from the page. The graph is a canvas, so
 * its nodes and edges are read from the Cytoscape instance that cytoscape
 * registers on its container element.
 */
import type { Page } from "@playwright/test";

export interface RenderedGraph {
  nodes: { id: string; label: string; namespace: string; isSelectedUser: boolean }[];
  edges: { source: string; target: string; label: string }[];
}

/** Choose a subject through the two-step Subject Namespace + Subject picker. */
export async function pickSubject(page: Page, namespace: string, subjectValue: string) {
  await page.getByLabel("Subject Namespace").selectOption(namespace);
  await page.getByLabel("Subject", { exact: true }).selectOption(subjectValue);
}

/**
 * The graph once its layout has settled (no node animating, same viewport for
 * a few consecutive polls), or null while no graph is mounted.
 */
export async function renderedGraph(page: Page): Promise<RenderedGraph | null> {
  await page.evaluate(() => {
    delete (window as unknown as { __graphSig?: string }).__graphSig;
  });
  const handle = await page.waitForFunction(
    () => {
      type Node = { id(): string; data(k: string): unknown; animated(): boolean };
      type Edge = { data(k: string): string };
      type Cy = {
        nodes(): Node[] & { some(fn: (n: Node) => boolean): boolean };
        edges(): Edge[];
        zoom(): number;
        pan(): { x: number; y: number };
      };
      const w = window as unknown as { __graphSig?: string; __graphStable?: number };
      const el = document.querySelector(".cy") as (Element & { _cyreg?: { cy?: Cy } }) | null;
      const cy = el?._cyreg?.cy;
      if (!cy) return document.querySelector(".empty-state") ? { none: true } : null;
      if (cy.nodes().some((n) => n.animated())) return null;
      const sig = `${cy.zoom()}|${cy.pan().x}|${cy.pan().y}|${cy.nodes().length}|${cy.edges().length}`;
      if (w.__graphSig !== sig) {
        w.__graphSig = sig;
        w.__graphStable = 0;
        return null;
      }
      if ((w.__graphStable = (w.__graphStable ?? 0) + 1) < 3) return null;
      return {
        nodes: Array.from(cy.nodes()).map((n) => ({
          id: n.id(),
          label: String(n.data("label")),
          namespace: String(n.data("namespace")),
          isSelectedUser: Boolean(n.data("isSelectedUser")),
        })),
        edges: Array.from(cy.edges()).map((e) => ({
          source: e.data("source"),
          target: e.data("target"),
          label: e.data("label"),
        })),
      };
    },
    null,
    { polling: 100, timeout: 30_000 },
  );
  const value = (await handle.jsonValue()) as RenderedGraph | { none: true };
  return "none" in value ? null : value;
}

/** Sorted node IDs of the rendered graph ([] when no graph is shown). */
export async function graphNodeIds(page: Page): Promise<string[]> {
  const graph = await renderedGraph(page);
  return graph ? graph.nodes.map((n) => n.id).sort() : [];
}

/** Click a graph node by ID at its on-screen position. */
export async function tapNode(page: Page, nodeId: string) {
  await renderedGraph(page);
  const point = await page.evaluate((id) => {
    type Cy = {
      getElementById(id: string): { length: number; renderedPosition(): { x: number; y: number } };
      container(): HTMLElement;
    };
    const el = document.querySelector(".cy") as (Element & { _cyreg?: { cy?: Cy } }) | null;
    const cy = el?._cyreg?.cy;
    const node = cy?.getElementById(id);
    if (!cy || !node || node.length === 0) return null;
    const box = cy.container().getBoundingClientRect();
    const p = node.renderedPosition();
    return { x: box.left + p.x, y: box.top + p.y };
  }, nodeId);
  if (!point) throw new Error(`node ${nodeId} is not in the rendered graph`);
  await page.mouse.click(point.x, point.y);
}
