/**
 * Build Cytoscape graph elements from Keto relation tuples for a given user.
 *
 * Shows all objects the user is connected to (directly or via intermediate entities),
 * the relations between them, and permission results.
 */
import type { Relationship } from "@ory/client-fetch";
import type cytoscape from "cytoscape";

import { subjectMatches, subjectRefOf } from "../api/ketoClient";
import type { PermissionResult, SubjectRef } from "../api/ketoClient";

const NAMESPACE_COLORS: Record<string, string> = {
  User: "#3b82f6",
  Role: "#a855f7",
  Application: "#f59e0b",
  BankAccount: "#22c55e",
  Team: "#06b6d4",
  Document: "#f59e0b",
  Business: "#ec4899",
  LineOfBusiness: "#f59e0b",
  Customer: "#22c55e",
  Organization: "#ec4899",
  Plan: "#f59e0b",
  Feature: "#22c55e",
  Patient: "#06b6d4",
  MedicalRecord: "#22c55e",
  Article: "#f59e0b",
};

export interface NodePermission {
  permission: string;
  allowed: boolean;
}

export interface GraphNodeData {
  id: string;
  label: string;
  namespace: string;
  color: string;
  isUser: boolean;
  permissions: NodePermission[];
  isSelectedUser?: boolean;
}

export interface GraphNode {
  data: GraphNodeData;
}

export interface GraphEdgeData {
  id: string;
  source: string;
  target: string;
  label: string;
  relation: string;
}

export interface GraphEdge {
  data: GraphEdgeData;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** The node budget ran out: more of the graph exists than is shown. */
  truncated?: boolean;
}

/** Larger graphs lay out too small to read (and freeze the page well before 1,000 nodes). */
export const DEFAULT_MAX_NODES = 150;

/** Narrow the first hop to one branch: a node, or one relation to that node. */
export interface BranchFilter {
  namespace: string;
  object: string;
  relation?: string | null;
}

/**
 * Hide resources that belong to another class. Object names follow a
 * `<base>/<class>` convention; nodes whose suffix is a known class other than
 * selectedClass are dropped.
 */
export interface ClassScope {
  selectedClass: string;
  classNames: Iterable<string>;
}

export interface BuildGraphOptions {
  /** Max hops to traverse from the subject (default 4). */
  maxDepth?: number;
  /** Stop adding nodes at this many (default DEFAULT_MAX_NODES); sets `truncated`. */
  maxNodes?: number;
  branchFilter?: BranchFilter | null;
  classScope?: ClassScope | null;
}

/**
 * The graph node identity of an entity subject. Legacy subject_ids carry no
 * namespace, so they are displayed under a synthetic "User" namespace.
 */
function subjectNode(subject: SubjectRef): { namespace: string; object: string } {
  if (subject.subject_set) {
    return { namespace: subject.subject_set.namespace, object: subject.subject_set.object };
  }
  return { namespace: "User", object: subject.subject_id ?? "" };
}

/**
 * Labels of leaf subjects: entities that appear as the subject of tuples but
 * never as an object. These are the "people" of the graph — expanding them
 * would pull in every co-member's tree, so traversal stops at them unless
 * they are the selected subject.
 */
function leafSubjectLabels(tuples: Relationship[]): Set<string> {
  const labels = new Set<string>();
  for (const t of tuples) {
    const ref = subjectRefOf(t);
    if (ref) labels.add(ref.label);
  }
  for (const t of tuples) {
    labels.delete(`${t.namespace}:${t.object}`);
  }
  return labels;
}

/**
 * Build cytoscape elements for a subject's permission graph.
 * @param tuples - All relation tuples for this example
 * @param subject - The selected subject
 * @param permissionResults - Permission check verdicts to attach to nodes
 * @param colorOverrides - Optional namespace->color map (overrides defaults)
 * @param options - Depth limit, node budget, single-branch view and class scoping
 */
export function buildGraph(
  tuples: Relationship[],
  subject: SubjectRef,
  permissionResults: PermissionResult[] = [],
  colorOverrides: Record<string, string> = {},
  { maxDepth = 4, maxNodes = DEFAULT_MAX_NODES, branchFilter = null, classScope = null }: BuildGraphOptions = {},
): GraphData {
  const nodeMap = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const edgeIds = new Set<string>();
  // Edges along which the subject gains access (subject -> object, subject set -> object).
  const grantEdges: [string, string][] = [];
  const leafSubjects = leafSubjectLabels(tuples);
  const outOfClass = classFilter(classScope);

  // Add a node unless it belongs to another class; returns whether it is in the graph.
  const place = (namespace: string, object: string): boolean => {
    if (nodeMap.has(`${namespace}:${object}`)) return true;
    if (outOfClass(object)) return false;
    addNode(nodeMap, namespace, object, false, colorOverrides);
    return true;
  };
  const addEdge = (source: string, target: string, relation: string, label = relation) => {
    const id = `e-${source}-${relation}-${target}`;
    if (edgeIds.has(id)) return;
    edgeIds.add(id);
    edges.push({ data: { id, source, target, label, relation } });
  };

  // Add the selected subject as the central node
  const center = subjectNode(subject);
  const centerId = `${center.namespace}:${center.object}`;
  addNode(nodeMap, center.namespace, center.object, true, colorOverrides);

  // First pass: every tuple where this subject is the subject. A branch filter
  // narrows it to one node (or one relation to that node).
  const subjectRelation = subject.subject_set?.relation || "";
  const userTuples = tuples.filter((t) => subjectMatches(t, subject)).filter(
    (t) =>
      !branchFilter ||
      (t.namespace === branchFilter.namespace &&
        t.object === branchFilter.object &&
        (branchFilter.relation == null || t.relation === branchFilter.relation)),
  );

  // Build a set of objects/namespaces connected to the subject
  const connectedEntities = new Set<string>();

  for (const t of userTuples) {
    const targetId = `${t.namespace}:${t.object}`;
    if (!place(t.namespace, t.object)) continue;
    connectedEntities.add(targetId);
    grantEdges.push([centerId, targetId]);
    addEdge(centerId, targetId, t.relation, subjectRelation ? `${t.relation} (from #${subjectRelation})` : t.relation);
  }

  // Second pass: find tuples where the subject's entities appear as a subject_set
  // e.g., User is member of Role:admin, and Role:admin is an allowed_role on Application:X
  // We need to find Role:admin -> Application:X edges too
  const intermediateEntities = new Set(connectedEntities);
  let changed = true;
  let depth = 0;

  while (changed && depth < maxDepth) {
    changed = false;
    depth++;
    const currentEntities = new Set(intermediateEntities);

    for (const t of tuples) {
      if (t.subject_set) {
        const ssId = `${t.subject_set.namespace}:${t.subject_set.object}`;
        if (currentEntities.has(ssId)) {
          const targetId = `${t.namespace}:${t.object}`;
          // With a branch filter, never fan back out through the subject itself.
          if (branchFilter && targetId === centerId) continue;
          if (!place(t.namespace, t.object) || !place(t.subject_set.namespace, t.subject_set.object)) continue;
          if (!intermediateEntities.has(targetId)) {
            intermediateEntities.add(targetId);
            changed = true;
          }
          grantEdges.push([ssId, targetId]);
          const relLabel = t.subject_set.relation
            ? `${t.relation} (via ${t.subject_set.relation})`
            : t.relation;
          addEdge(ssId, targetId, t.relation, relLabel);
        }
      }

      // Also add tuples where entities the subject reaches have outgoing relations
      // (e.g. MedicalRecord.patient -> Patient, Customer.parent_lob -> LOB)
      const sourceId = `${t.namespace}:${t.object}`;
      if (currentEntities.has(sourceId)) {
        const entityRef = subjectRefOf(t);
        const isTerminal =
          entityRef !== null &&
          (entityRef.label === subject.label || leafSubjects.has(entityRef.label));
        if (isTerminal) {
          // Don't add other leaf subjects (people) to the graph, and don't
          // draw reverse edges back to the selected subject.
        } else if (t.subject_set) {
          const ssId = `${t.subject_set.namespace}:${t.subject_set.object}`;
          // With a branch filter, looping back through the subject would expose
          // every other branch on the next iteration.
          if (branchFilter && ssId === centerId) continue;
          if (!place(t.subject_set.namespace, t.subject_set.object)) continue;
          // Context nodes (a document's folder, a record's patient) are shown; in a
          // single-branch view they are not expanded, or siblings of the branch
          // (the folder's other documents) would flood back in.
          if (!branchFilter && !intermediateEntities.has(ssId)) {
            intermediateEntities.add(ssId);
            changed = true;
          }
          addEdge(sourceId, ssId, t.relation);
        }
      }
    }
  }

  // Third pass: attach permission results to nodes already in the graph,
  // and only add new nodes for resources the user is actually ALLOWED to access
  // (avoids flooding the graph with disconnected denied nodes)
  for (const pr of permissionResults) {
    const nodeId = `${pr.namespace}:${pr.object}`;
    if (!nodeMap.has(nodeId) && (!pr.allowed || !place(pr.namespace, pr.object))) continue;
    nodeMap.get(nodeId)!.data.permissions.push({
      permission: pr.permission,
      allowed: pr.allowed,
    });
  }

  // Mark the selected subject's node
  const centerNode = nodeMap.get(centerId);
  if (centerNode) {
    centerNode.data.isSelectedUser = true;
    if (subjectRelation) centerNode.data.label = `${center.object} #${subjectRelation}`;
  }

  const grantIds = reachableFrom(centerId, grantEdges, { directed: true });
  const hidden = hiddenNodeIds(nodeMap, { centerId, subjectNamespace: center.namespace, grantIds });
  const visibleEdges = edges.filter((e) => !hidden.has(e.data.source) && !hidden.has(e.data.target));

  // Keep what is connected to the subject up to the node budget: the subject's own
  // granting chain in its namespace first (e.g. every ancestor group), then nearest first.
  const order = bfsOrder(centerId, visibleEdges.map((e) => [e.data.source, e.data.target]));
  const chain = order.filter((id) => id !== centerId && grantIds.has(id) && nodeMap.get(id)!.data.namespace === center.namespace);
  const kept = new Set([centerId, ...chain.slice(0, maxNodes - 1)]);
  for (const id of order) {
    if (kept.size >= maxNodes) break;
    kept.add(id);
  }
  return {
    nodes: order.filter((id) => kept.has(id)).map((id) => nodeMap.get(id)!),
    edges: visibleEdges.filter((e) => kept.has(e.data.source) && kept.has(e.data.target)),
    truncated: order.length > kept.size,
  };
}

/**
 * Other entities of the subject's own namespace are hidden unless they lie on a
 * path that grants the subject access (parent groups, sub-folders): a team's graph
 * should not fan out to every other team that shares a document.
 */
function hiddenNodeIds(
  nodeMap: Map<string, GraphNode>,
  { centerId, subjectNamespace, grantIds }: { centerId: string; subjectNamespace: string; grantIds: Set<string> },
): Set<string> {
  const hidden = new Set<string>();
  for (const [id, node] of nodeMap) {
    if (id !== centerId && node.data.namespace === subjectNamespace && !grantIds.has(id)) hidden.add(id);
  }
  return hidden;
}

/** Whether an object belongs to a class other than the selected one (`<base>/<class>`). */
function classFilter(classScope: ClassScope | null): (object: string) => boolean {
  if (!classScope?.selectedClass) return () => false;
  const otherClasses = new Set(Array.from(classScope.classNames).filter((c) => c !== classScope.selectedClass));
  return (object) => {
    const slash = object.lastIndexOf("/");
    return slash !== -1 && otherClasses.has(object.slice(slash + 1));
  };
}

/** Node IDs in breadth-first order from start, following edges in both directions. */
function bfsOrder(start: string, edges: [string, string][]): string[] {
  return [...reachableFrom(start, edges, { directed: false })];
}

/**
 * Node IDs reachable from start, in breadth-first order (Set insertion order).
 * Directed: only source -> target.
 */
function reachableFrom(start: string, edges: [string, string][], { directed }: { directed: boolean }): Set<string> {
  const adjacency = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    const list = adjacency.get(a);
    if (list) list.push(b);
    else adjacency.set(a, [b]);
  };
  for (const [source, target] of edges) {
    link(source, target);
    if (!directed) link(target, source);
  }
  const reachable = new Set([start]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    for (const next of adjacency.get(queue[i]) ?? []) {
      if (!reachable.has(next)) {
        reachable.add(next);
        queue.push(next);
      }
    }
  }
  return reachable;
}

function addNode(
  nodeMap: Map<string, GraphNode>,
  namespace: string,
  object: string,
  isUser = false,
  colorOverrides: Record<string, string> = {},
): GraphNode {
  const id = `${namespace}:${object}`;
  let node = nodeMap.get(id);
  if (!node) {
    node = {
      data: {
        id,
        label: object,
        namespace,
        color: colorOverrides[namespace] || NAMESPACE_COLORS[namespace] || "#6366f1",
        isUser,
        permissions: [],
      },
    };
    nodeMap.set(id, node);
  }
  return node;
}

/**
 * Word-wrap for node labels: lines break at separators when they would
 * exceed maxCharsPerLine, runs without a separator are hard-broken, and
 * anything past maxLines is ellipsized. Labels that fit stay on one line.
 */
function wrapLabel(
  label: string,
  maxCharsPerLine = 18,
  maxLines = 2,
  separators = /([:])/,
) {
  if (!label) return "";
  maxCharsPerLine = Math.max(1, maxCharsPerLine);
  maxLines = Math.max(1, maxLines);
  if (label.length <= maxCharsPerLine) return label;
  // Tokenize into chunks that each end with their trailing separator
  const parts = label.split(separators);
  const chunks = [];
  for (let i = 0; i < parts.length; i += 2) {
    let chunk = parts[i] + (parts[i + 1] ?? "");
    while (chunk.length > maxCharsPerLine) {
      chunks.push(chunk.slice(0, maxCharsPerLine));
      chunk = chunk.slice(maxCharsPerLine);
    }
    if (chunk) chunks.push(chunk);
  }
  const lines = [];
  let current = "";
  for (const chunk of chunks) {
    if (current && current.length + chunk.length > maxCharsPerLine) {
      lines.push(current);
      current = chunk;
    } else {
      current += chunk;
    }
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    // Fill the last line with raw text up to the limit instead of
    // stopping at a separator boundary before ellipsizing
    const kept = lines.slice(0, maxLines - 1);
    const rest = label.slice(kept.join("").length);
    kept.push(rest.slice(0, maxCharsPerLine - 1) + "…");
    return kept.join("\n");
  }
  return lines.join("\n");
}

/**
 * Get the cytoscape stylesheet.
 */
export function getCytoscapeStylesheet(): cytoscape.StylesheetStyle[] {
  return [
    {
      selector: "node",
      style: {
        label: (el: cytoscape.NodeSingular) => wrapLabel(el.data("label")),
        "background-color": "data(color)",
        color: "#e1e4ed",
        "font-size": "11px",
        "text-valign": "bottom",
        "text-margin-y": 8,
        width: 36,
        height: 36,
        "border-width": 2,
        "border-color": "data(color)",
        "background-opacity": 0.2,
        "text-wrap": "wrap",
        "min-zoomed-font-size": 8,
      },
    },
    {
      selector: "node[?isSelectedUser]",
      style: {
        width: 50,
        height: 50,
        "background-opacity": 0.4,
        "border-width": 3,
        "font-size": "13px",
        "font-weight": "bold",
        "z-index": 10,
      },
    },
    {
      selector: "edge",
      style: {
        label: "data(label)",
        "font-size": "9px",
        color: "#8b8fa3",
        "text-rotation": "autorotate",
        "text-margin-y": -8,
        "line-color": "#2e3348",
        "target-arrow-color": "#2e3348",
        "target-arrow-shape": "triangle",
        "curve-style": "bezier",
        width: 1.5,
        "arrow-scale": 0.8,
        opacity: 0.7,
        "min-zoomed-font-size": 10,
      },
    },
    {
      selector: "edge:selected",
      style: {
        "line-color": "#6366f1",
        "target-arrow-color": "#6366f1",
        width: 2.5,
        opacity: 1,
      },
    },
    {
      selector: "node:selected",
      style: {
        "border-color": "#6366f1",
        "border-width": 3,
        "background-opacity": 0.5,
      },
    },
  ];
}
