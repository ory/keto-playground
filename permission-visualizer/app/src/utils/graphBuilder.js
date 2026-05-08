/**
 * Build Cytoscape graph elements from Keto relation tuples for a given user.
 *
 * Shows all objects the user is connected to (directly or via intermediate entities),
 * the relations between them, and permission results.
 */

const NAMESPACE_COLORS = {
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

/**
 * Build cytoscape elements for a subject's permission graph.
 *
 * @param {Array} tuples - All relation tuples
 * @param {object|string} subject - Subject spec: { kind:'id', id, namespace? } or
 *   { kind:'set', namespace, object, relation }. A bare string is treated as a direct id.
 * @param {Array} permissionResults - Array of { namespace, object, permission, allowed }
 * @param {Object} [colorOverrides] - Optional namespace->color map
 * @returns {{ nodes: Array, edges: Array }}
 */
export function buildGraph(tuples, subject, permissionResults = [], colorOverrides = {}) {
  const subj = normalizeSubject(subject);
  if (!subj) return { nodes: [], edges: [] };

  const nodeMap = new Map();
  const edges = [];

  // Central node + first-pass filter differ by subject kind.
  let centerId;
  let firstPassTuples;
  if (subj.kind === "id") {
    const ns = subj.namespace || "User";
    centerId = `${ns}:${subj.id}`;
    addNode(nodeMap, ns, subj.id, true, colorOverrides);
    firstPassTuples = tuples.filter((t) => t.subject_id === subj.id);
  } else {
    centerId = `${subj.namespace}:${subj.object}`;
    addNode(nodeMap, subj.namespace, subj.object, true, colorOverrides);
    firstPassTuples = tuples.filter(
      (t) =>
        t.subject_set &&
        t.subject_set.namespace === subj.namespace &&
        t.subject_set.object === subj.object &&
        (t.subject_set.relation || "") === (subj.relation || "")
    );
  }

  // Build a set of objects/namespaces connected to the subject
  const connectedEntities = new Set();

  for (const t of firstPassTuples) {
    const targetId = `${t.namespace}:${t.object}`;
    addNode(nodeMap, t.namespace, t.object, false, colorOverrides);
    connectedEntities.add(targetId);
    const label =
      subj.kind === "set" && subj.relation
        ? `${t.relation} (from #${subj.relation})`
        : t.relation;
    edges.push({
      data: {
        id: `e-${centerId}-${t.relation}-${targetId}`,
        source: centerId,
        target: targetId,
        label,
        relation: t.relation,
      },
    });
  }

  // Multi-hop traversal: surface chains the subject reaches via subject sets and outgoing relations.
  const intermediateEntities = new Set(connectedEntities);
  let changed = true;
  let depth = 0;

  while (changed && depth < 4) {
    changed = false;
    depth++;
    const currentEntities = new Set(intermediateEntities);

    for (const t of tuples) {
      if (t.subject_set) {
        const ssId = `${t.subject_set.namespace}:${t.subject_set.object}`;
        if (currentEntities.has(ssId)) {
          const targetId = `${t.namespace}:${t.object}`;
          if (!intermediateEntities.has(targetId)) {
            intermediateEntities.add(targetId);
            changed = true;
          }
          addNode(nodeMap, t.namespace, t.object, false, colorOverrides);
          addNode(nodeMap, t.subject_set.namespace, t.subject_set.object, false, colorOverrides);

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
      const sourceId = `${t.namespace}:${t.object}`;
      if (currentEntities.has(sourceId)) {
        if (t.subject_id && (subj.kind !== "id" || t.subject_id !== subj.id)) {
          // Don't add unrelated direct subjects to the graph
        } else if (t.subject_set) {
          const ssId = `${t.subject_set.namespace}:${t.subject_set.object}`;
          addNode(nodeMap, t.subject_set.namespace, t.subject_set.object, false, colorOverrides);
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

  // Attach permission results to nodes already in the graph; only add new nodes
  // for resources the subject is actually ALLOWED to access (avoids disconnected denied nodes).
  for (const pr of permissionResults) {
    const nodeId = `${pr.namespace}:${pr.object}`;
    const existingNode = nodeMap.get(nodeId);
    if (existingNode) {
      if (!existingNode.data.permissions) existingNode.data.permissions = [];
      existingNode.data.permissions.push({
        permission: pr.permission,
        allowed: pr.allowed,
      });
    } else if (pr.allowed) {
      addNode(nodeMap, pr.namespace, pr.object, false, colorOverrides);
      const node = nodeMap.get(nodeId);
      if (!node.data.permissions) node.data.permissions = [];
      node.data.permissions.push({
        permission: pr.permission,
        allowed: pr.allowed,
      });
    }
  }

  // Mark the central subject node
  const centerNode = nodeMap.get(centerId);
  if (centerNode) {
    centerNode.data.isSelectedUser = true;
    if (subj.kind === "set" && subj.relation) {
      centerNode.data.label = `${subj.object} #${subj.relation}`;
    }
  }

  const nodes = Array.from(nodeMap.values());
  return { nodes, edges };
}

function normalizeSubject(subject) {
  if (!subject) return null;
  if (typeof subject === "string") {
    return subject ? { kind: "id", id: subject } : null;
  }
  if (subject.kind === "id" && subject.id) {
    return { kind: "id", id: subject.id, namespace: subject.namespace };
  }
  if (
    subject.kind === "set" &&
    subject.namespace &&
    subject.object &&
    subject.relation !== undefined
  ) {
    return {
      kind: "set",
      namespace: subject.namespace,
      object: subject.object,
      relation: subject.relation || "",
    };
  }
  return null;
}

function addNode(nodeMap, namespace, object, isUser = false, colorOverrides = {}) {
  const id = `${namespace}:${object}`;
  if (!nodeMap.has(id)) {
    nodeMap.set(id, {
      data: {
        id,
        label: object,
        namespace,
        color: colorOverrides[namespace] || NAMESPACE_COLORS[namespace] || "#6366f1",
        isUser,
        permissions: [],
      },
    });
  }
  return nodeMap.get(id);
}

/**
 * Get all unique objects (namespace:object pairs) from tuples
 * that a user can potentially have permissions on.
 */
export function getPermissionTargets(tuples, permissions) {
  const targets = [];
  for (const p of permissions) {
    const objects = new Set();
    for (const t of tuples) {
      if (t.namespace === p.namespace) {
        objects.add(t.object);
      }
    }
    for (const obj of objects) {
      for (const perm of p.permissions) {
        targets.push({ namespace: p.namespace, object: obj, permission: perm });
      }
    }
  }
  return targets;
}

/**
 * Get the cytoscape stylesheet.
 */
export function getCytoscapeStylesheet() {
  return [
    {
      selector: "node",
      style: {
        label: "data(label)",
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
        "text-wrap": "none",
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
