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
}

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
 * @param options - Depth limit, single-branch view and class scoping
 */
export function buildGraph(
  tuples: Relationship[],
  subject: SubjectRef,
  permissionResults: PermissionResult[] = [],
  colorOverrides: Record<string, string> = {},
  { maxDepth = 4, branchFilter = null, classScope = null }: BuildGraphOptions = {},
): GraphData {
  const nodeMap = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const leafSubjects = leafSubjectLabels(tuples);

  // Add the selected subject as the central node
  const center = subjectNode(subject);
  const centerId = `${center.namespace}:${center.object}`;
  addNode(nodeMap, center.namespace, center.object, true, colorOverrides);

  // First pass: find all tuples where this subject is the subject, optionally
  // narrowed to a single branch (one node, or one relation to it)
  const subjectRelation = subject.subject_set?.relation || "";
  const userTuples = tuples.filter(
    (t) =>
      subjectMatches(t, subject) &&
      (!branchFilter ||
        (t.namespace === branchFilter.namespace &&
          t.object === branchFilter.object &&
          (branchFilter.relation == null || t.relation === branchFilter.relation))),
  );

  // Build a set of objects/namespaces connected to the subject
  const connectedEntities = new Set<string>();

  for (const t of userTuples) {
    const targetId = `${t.namespace}:${t.object}`;
    addNode(nodeMap, t.namespace, t.object, false, colorOverrides);
    connectedEntities.add(targetId);
    edges.push({
      data: {
        id: `e-${centerId}-${t.relation}-${targetId}`,
        source: centerId,
        target: targetId,
        label: subjectRelation ? `${t.relation} (from #${subjectRelation})` : t.relation,
        relation: t.relation,
      },
    });
  }

  // Second pass: find tuples where the user is part of a subject_set
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
          if (!intermediateEntities.has(targetId)) {
            intermediateEntities.add(targetId);
            changed = true;
          }
          addNode(nodeMap, t.namespace, t.object, false, colorOverrides);
          addNode(
            nodeMap,
            t.subject_set.namespace,
            t.subject_set.object,
            false,
            colorOverrides,
          );

          const relLabel = t.subject_set.relation
            ? `${t.relation} (via ${t.subject_set.relation})`
            : t.relation;

          const edgeId = `e-${ssId}-${t.relation}-${targetId}`;
          if (!edges.find((e) => e.data.id === edgeId)) {
            edges.push({
              data: {
                id: edgeId,
                source: ssId,
                target: targetId,
                label: relLabel,
                relation: t.relation,
              },
            });
          }
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
          addNode(
            nodeMap,
            t.subject_set.namespace,
            t.subject_set.object,
            false,
            colorOverrides,
          );
          if (!intermediateEntities.has(ssId)) {
            intermediateEntities.add(ssId);
            changed = true;
          }
          const edgeId = `e-${sourceId}-${t.relation}-${ssId}`;
          if (!edges.find((e) => e.data.id === edgeId)) {
            edges.push({
              data: {
                id: edgeId,
                source: sourceId,
                target: ssId,
                label: t.relation,
                relation: t.relation,
              },
            });
          }
        }
      }
    }
  }

  // Third pass: attach permission results to nodes already in the graph,
  // and only add new nodes for resources the user is actually ALLOWED to access
  // (avoids flooding the graph with disconnected denied nodes)
  for (const pr of permissionResults) {
    const nodeId = `${pr.namespace}:${pr.object}`;
    const existingNode = nodeMap.get(nodeId);
    if (existingNode) {
      existingNode.data.permissions.push({
        permission: pr.permission,
        allowed: pr.allowed,
      });
    } else if (pr.allowed) {
      const node = addNode(nodeMap, pr.namespace, pr.object, false, colorOverrides);
      node.data.permissions.push({
        permission: pr.permission,
        allowed: pr.allowed,
      });
    }
  }

  // Mark the selected subject's node
  const centerNode = nodeMap.get(centerId);
  if (centerNode) {
    centerNode.data.isSelectedUser = true;
    if (subjectRelation) centerNode.data.label = `${center.object} #${subjectRelation}`;
  }

  const hidden = hiddenNodeIds(nodeMap, centerId, center.namespace, branchFilter, classScope);
  for (const id of hidden) nodeMap.delete(id);
  const visibleEdges = edges.filter((e) => !hidden.has(e.data.source) && !hidden.has(e.data.target));

  // Drop nodes the filters left disconnected from the subject.
  const reachable = reachableFrom(centerId, visibleEdges);
  for (const id of Array.from(nodeMap.keys())) {
    if (!reachable.has(id)) nodeMap.delete(id);
  }
  return {
    nodes: Array.from(nodeMap.values()),
    edges: visibleEdges.filter((e) => reachable.has(e.data.source) && reachable.has(e.data.target)),
  };
}

/**
 * Nodes to hide: other entities in the subject's namespace (only the chosen
 * subject is shown), other nodes in the branch filter's namespace, and
 * resources scoped to a class other than the selected one.
 */
function hiddenNodeIds(
  nodeMap: Map<string, GraphNode>,
  centerId: string,
  subjectNamespace: string,
  branchFilter: BranchFilter | null,
  classScope: ClassScope | null,
): Set<string> {
  const branchNodeId = branchFilter ? `${branchFilter.namespace}:${branchFilter.object}` : null;
  const otherClasses = classScope?.selectedClass
    ? new Set(Array.from(classScope.classNames).filter((c) => c !== classScope.selectedClass))
    : null;
  const hidden = new Set<string>();
  for (const [id, node] of nodeMap) {
    if (id === centerId) continue;
    if (node.data.namespace === subjectNamespace) hidden.add(id);
    if (branchFilter && id !== branchNodeId && node.data.namespace === branchFilter.namespace) hidden.add(id);
    if (otherClasses) {
      const object = id.slice(id.indexOf(":") + 1);
      const slash = object.lastIndexOf("/");
      if (slash !== -1 && otherClasses.has(object.slice(slash + 1))) hidden.add(id);
    }
  }
  return hidden;
}

/** Node IDs connected to start through the edges, in either direction. */
function reachableFrom(start: string, edges: GraphEdge[]): Set<string> {
  const adjacency = new Map<string, string[]>();
  for (const { data } of edges) {
    adjacency.set(data.source, [...(adjacency.get(data.source) ?? []), data.target]);
    adjacency.set(data.target, [...(adjacency.get(data.target) ?? []), data.source]);
  }
  const reachable = new Set([start]);
  const queue = [start];
  while (queue.length) {
    for (const next of adjacency.get(queue.shift()!) ?? []) {
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
