import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import CytoscapeComponent from "react-cytoscapejs";
import cytoscape from "cytoscape";
import dagre from "cytoscape-dagre";
import type { Relationship } from "@ory/client-fetch";

import EXAMPLES from "./data/examples";
import type { ExampleMeta } from "./data/examples";
import { useKetoData } from "./hooks/useKetoData";
import { useOfflineData, getOfflineExampleKeys } from "./hooks/useOfflineData";
import { buildGraph, getCytoscapeStylesheet } from "./utils/graphBuilder";
import type { BranchFilter, ClassScope, GraphData } from "./utils/graphBuilder";
import {
  DIRECT_ID_NAMESPACE,
  deleteRelationTuples,
  deriveSubjects,
  groupSubjectsByNamespace,
  subjectMatches,
} from "./api/ketoClient";
import type { SubjectRef } from "./api/ketoClient";
import { RelationshipEditor } from "./components/RelationshipEditor";
import { SchemaEditor } from "./components/SchemaEditor";
import OPL_SCHEMAS from "./data/oplSchemas";
import "./App.css";

cytoscape.use(dagre);

const exampleKeys = Object.keys(EXAMPLES);
const offlineKeys = getOfflineExampleKeys();
const EXPLORE_KEY = "__explore__";
/** Subject-set namespace whose objects act as "classes" for class scoping. */
const CLASS_NAMESPACE = "ClaudeClass";

const DYNAMIC_PALETTE = [
  "#6366f1", "#f59e0b", "#10b981", "#ef4444", "#06b6d4",
  "#ec4899", "#8b5cf6", "#22c55e", "#f97316", "#14b8a6",
];

/** Option text in the Subject dropdown, within the chosen namespace. */
function subjectOptionLabel(s: SubjectRef): string {
  if (!s.subject_set) return s.label;
  return s.subject_set.relation ? `${s.subject_set.object} #${s.subject_set.relation}` : s.subject_set.object;
}

/** A tuple's subject as text: "id", "Ns:obj" or "Ns:obj#rel". */
function tupleSubjectText(t: Relationship): string {
  if (t.subject_id) return t.subject_id;
  if (!t.subject_set) return "?";
  const { namespace, object, relation } = t.subject_set;
  return `${namespace}:${object}${relation ? `#${relation}` : ""}`;
}

/** Tuples that reference a node: as the object, or as a subject-set anchor. */
interface NodeTuples {
  label: string;
  tuples: Relationship[];
}

/**
 * Subject at the top, then one horizontal row per BFS distance. Within a row,
 * nodes sort by the average x of their parents (barycenter) to reduce crossings.
 */
function bfsTierLayout(graphData: GraphData | null): cytoscape.LayoutOptions {
  const fallback: cytoscape.LayoutOptions = { name: "preset", fit: true, padding: 40 };
  const centerId = graphData?.nodes.find((n) => n.data.isSelectedUser)?.data.id;
  if (!graphData || !centerId) return fallback;

  const NODE_SEP = 200;
  const RANK_SEP = 220;

  const adjacency = new Map<string, string[]>();
  for (const { data } of graphData.edges) {
    adjacency.set(data.source, [...(adjacency.get(data.source) ?? []), data.target]);
    adjacency.set(data.target, [...(adjacency.get(data.target) ?? []), data.source]);
  }

  const level = new Map([[centerId, 0]]);
  const queue = [centerId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of adjacency.get(cur) ?? []) {
      if (!level.has(next)) {
        level.set(next, level.get(cur)! + 1);
        queue.push(next);
      }
    }
  }

  const tiers = new Map<number, string[]>();
  for (const node of graphData.nodes) {
    const lvl = level.get(node.data.id) ?? 999;
    tiers.set(lvl, [...(tiers.get(lvl) ?? []), node.data.id]);
  }

  const positions: Record<string, cytoscape.Position> = { [centerId]: { x: 0, y: 0 } };
  const placedX = new Map([[centerId, 0]]);
  const maxLevel = Math.max(...tiers.keys());
  for (let lvl = 1; lvl <= maxLevel; lvl++) {
    const withBary = (tiers.get(lvl) ?? []).map((id) => {
      const parents = (adjacency.get(id) ?? []).filter((n) => level.get(n) === lvl - 1 && placedX.has(n));
      const avgX = parents.length ? parents.reduce((sum, p) => sum + placedX.get(p)!, 0) / parents.length : 0;
      return { id, avgX };
    });
    withBary.sort((a, b) => a.avgX - b.avgX);
    withBary.forEach(({ id }, i) => {
      const x = (i - (withBary.length - 1) / 2) * NODE_SEP;
      positions[id] = { x, y: lvl * RANK_SEP };
      placedX.set(id, x);
    });
  }

  return { name: "preset", positions, fit: true, padding: 40, animate: true, animationDuration: 300 };
}

function App() {
  const [mode, setMode] = useState<"offline" | "live">("offline");
  const [selectedExample, setSelectedExample] = useState("");
  const [selectedSubjectNs, setSelectedSubjectNs] = useState("");
  const [selectedSubject, setSelectedSubject] = useState("");
  const [selectedBranchKey, setSelectedBranchKey] = useState("");
  const [scopeToClass, setScopeToClass] = useState(true);
  const [customTuples, setCustomTuples] = useState<Relationship[]>([]);
  const [deletedTupleKeys, setDeletedTupleKeys] = useState<Set<number>>(new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<NodeTuples | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);

  const isLive = mode === "live";
  const isExploreMode = selectedExample === EXPLORE_KEY;

  const exampleMeta = useMemo<ExampleMeta | null>(() => {
    if (isExploreMode) {
      return { name: "Explore Live Data", description: "Exploring all live data from Ory Keto — select a subject to see its relation graph.", permissions: [] };
    }
    return EXAMPLES[selectedExample] || null;
  }, [selectedExample, isExploreMode]);

  // Data hooks — only one is active at a time
  const liveData = useKetoData(isLive ? exampleMeta : null);
  const offlineData = useOfflineData(isLive ? null : selectedExample);

  const {
    tuples,
    subjects,
    namespaces,
    loading,
    error,
    permissionResults,
    loadingPermissions,
    checkSubjectPermissions,
    refetch,
  } = isLive ? liveData : offlineData;

  function selectSubject(label: string) {
    setSelectedSubject(label);
    setSelectedBranchKey("");
    setSelectedNodeId(null);
  }

  // Reset subject, relationship edits and node selection whenever the example or mode changes.
  function resetSelections() {
    setSelectedSubjectNs("");
    selectSubject("");
    setCustomTuples([]);
    setDeletedTupleKeys(new Set());
    setConfirmDelete(null);
    setDeleteError(null);
  }

  // Switch modes — auto-select explore in live mode.
  function switchMode(next: "offline" | "live") {
    if (next === mode) return;
    setMode(next);
    setSelectedExample(next === "live" ? EXPLORE_KEY : "");
    resetSelections();
  }

  function selectExample(key: string) {
    setSelectedExample(key);
    resetSelections();
  }

  // Merge base tuples with custom edits (offline mode only)
  const effectiveTuples = useMemo(() => {
    if (isLive) return tuples;
    const base = tuples.filter((_, i) => !deletedTupleKeys.has(i));
    return [...base, ...customTuples];
  }, [tuples, customTuples, deletedTupleKeys, isLive]);

  // Derive subjects from effective tuples so newly added subjects appear in the dropdowns
  const effectiveSubjects = useMemo(() => {
    if (isLive) return subjects;
    return deriveSubjects(effectiveTuples);
  }, [effectiveTuples, subjects, isLive]);

  // Subjects grouped by namespace for the two-step picker; legacy IDs first.
  const subjectGroups = useMemo(() => groupSubjectsByNamespace(effectiveSubjects), [effectiveSubjects]);
  const subjectNamespaces = useMemo(() => {
    const keys = [...subjectGroups.keys()];
    return keys.includes(DIRECT_ID_NAMESPACE)
      ? [DIRECT_ID_NAMESPACE, ...keys.filter((k) => k !== DIRECT_ID_NAMESPACE)]
      : keys;
  }, [subjectGroups]);
  const subjectOptions = subjectGroups.get(selectedSubjectNs) ?? [];

  // Resolve the selected dropdown value back to its SubjectRef
  const selectedSubjectRef = useMemo(
    () => effectiveSubjects.find((s) => s.label === selectedSubject) ?? null,
    [effectiveSubjects, selectedSubject],
  );

  // Check permissions when the subject changes (live mode only)
  useEffect(() => {
    if (selectedSubjectRef && isLive) {
      checkSubjectPermissions(selectedSubjectRef);
    }
  }, [selectedSubjectRef, checkSubjectPermissions, isLive]);

  // Get the subject's direct relations for the sidebar
  const subjectRelations = useMemo(() => {
    if (!selectedSubjectRef || effectiveTuples.length === 0) return [];
    return effectiveTuples
      .filter((t) => subjectMatches(t, selectedSubjectRef))
      .map((t) => ({
        namespace: t.namespace,
        object: t.object,
        relation: t.relation,
      }));
  }, [selectedSubjectRef, effectiveTuples]);

  // Permission targets for the sidebar — group by namespace:object
  const permissionsByObject = useMemo(() => {
    if (permissionResults.length === 0) return [];
    const map = new Map<
      string,
      { namespace: string; object: string; perms: { permission: string; allowed: boolean }[] }
    >();
    for (const pr of permissionResults) {
      const key = `${pr.namespace}:${pr.object}`;
      let entry = map.get(key);
      if (!entry) {
        entry = { namespace: pr.namespace, object: pr.object, perms: [] };
        map.set(key, entry);
      }
      entry.perms.push({ permission: pr.permission, allowed: pr.allowed });
    }
    return Array.from(map.values());
  }, [permissionResults]);

  const stylesheet = useMemo(() => getCytoscapeStylesheet(), []);

  const handleCyInit = useCallback((cy: cytoscape.Core) => {
    cyRef.current = cy;
    cy.on("layoutstop", () => {
      cy.fit(undefined, 40);
    });
    cy.on("tap", "node", (evt) => {
      setSelectedNodeId(evt.target.id());
    });
    cy.on("tap", (evt) => {
      // A background tap (not on a node) clears the selection
      if (evt.target === cy) setSelectedNodeId(null);
    });
  }, []);

  // Build namespace legend from live namespaces + colors
  const namespaceLegend = useMemo(() => {
    if ((!exampleMeta && !selectedExample) || namespaces.length === 0) return [];
    const legend: { namespace: string; color: string }[] = [];
    const seen = new Set<string>();

    if (!namespaces.includes("User")) {
      const color = exampleMeta?.namespaceColors?.User || DYNAMIC_PALETTE[0];
      legend.push({ namespace: "User", color });
      seen.add("User");
    }

    for (const ns of namespaces) {
      if (!seen.has(ns)) {
        seen.add(ns);
        const color = exampleMeta?.namespaceColors?.[ns]
          || DYNAMIC_PALETTE[seen.size % DYNAMIC_PALETTE.length];
        legend.push({ namespace: ns, color });
      }
    }
    return legend;
  }, [exampleMeta, selectedExample, namespaces]);

  // Build a namespace->color map from the legend for consistent graph colors
  const namespaceColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const l of namespaceLegend) {
      map[l.namespace] = l.color;
    }
    return map;
  }, [namespaceLegend]);

  // Unique nodes (namespace:object) the subject relates to directly: the branches.
  const branchNodes = useMemo(() => {
    const byKey = new Map<string, { key: string; namespace: string; object: string }>();
    for (const r of subjectRelations) {
      const key = `${r.namespace}:${r.object}`;
      if (!byKey.has(key)) byKey.set(key, { key, namespace: r.namespace, object: r.object });
    }
    return Array.from(byKey.values());
  }, [subjectRelations]);

  const branchFilter = useMemo<BranchFilter | null>(() => {
    const node = branchNodes.find((n) => n.key === selectedBranchKey);
    return node ? { namespace: node.namespace, object: node.object, relation: null } : null;
  }, [selectedBranchKey, branchNodes]);

  // Every ClaudeClass object referenced as a subject set — the known classes.
  const classNames = useMemo(() => {
    const names = new Set<string>();
    for (const t of effectiveTuples) {
      if (t.subject_set?.namespace === CLASS_NAMESPACE) names.add(t.subject_set.object);
    }
    return names;
  }, [effectiveTuples]);

  // The selected subject's class, when it is a ClaudeClass subject set.
  const selectedClass =
    selectedSubjectRef?.subject_set?.namespace === CLASS_NAMESPACE ? selectedSubjectRef.subject_set.object : null;

  const classScope = useMemo<ClassScope | null>(
    () => (scopeToClass && selectedClass ? { selectedClass, classNames } : null),
    [scopeToClass, selectedClass, classNames],
  );

  // Build graph elements from effective tuples + permission results
  const graphData = useMemo(() => {
    if (!selectedSubjectRef || effectiveTuples.length === 0) return null;
    return buildGraph(effectiveTuples, selectedSubjectRef, permissionResults, namespaceColorMap, {
      branchFilter,
      classScope,
    });
  }, [selectedSubjectRef, effectiveTuples, permissionResults, namespaceColorMap, branchFilter, classScope]);

  const elements = useMemo(() => {
    if (!graphData) return [];
    return [...graphData.nodes, ...graphData.edges];
  }, [graphData]);

  const layout = useMemo(() => bfsTierLayout(graphData), [graphData]);

  // Tuples that reference the tapped node (live mode delete panel). Node IDs are
  // "Namespace:object"; the label can differ (e.g. "obj #relation"), so parse the ID.
  const nodeTuples = useMemo<NodeTuples | null>(() => {
    const node = graphData?.nodes.find((n) => n.data.id === selectedNodeId);
    if (!node) return null;
    const { namespace } = node.data;
    const object = node.data.id.slice(namespace.length + 1);
    // Legacy subject_ids are drawn as "User:<id>" nodes and referenced by subject_id.
    const legacyId =
      selectedSubjectRef?.subject_id && node.data.isSelectedUser ? selectedSubjectRef.subject_id : null;

    const seen = new Set<string>();
    const matched: Relationship[] = [];
    for (const t of effectiveTuples) {
      const isObject = t.namespace === namespace && t.object === object;
      const isSubjectSet = t.subject_set?.namespace === namespace && t.subject_set.object === object;
      const isLegacySubject = legacyId !== null && t.subject_id === legacyId;
      if (!isObject && !isSubjectSet && !isLegacySubject) continue;
      const key = `${t.namespace}:${t.object}#${t.relation}@${tupleSubjectText(t)}`;
      if (!seen.has(key)) {
        seen.add(key);
        matched.push(t);
      }
    }
    return { label: node.data.id, tuples: matched };
  }, [selectedNodeId, graphData, effectiveTuples, selectedSubjectRef]);

  const handleConfirmDelete = useCallback(async () => {
    if (!confirmDelete || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const { deleted, errors } = await deleteRelationTuples(confirmDelete.tuples);
      if (errors.length > 0) {
        setDeleteError(
          `Deleted ${deleted} of ${confirmDelete.tuples.length} tuples; ${errors.length} failed (${errors[0].reason})`,
        );
      }
      setConfirmDelete(null);
      setSelectedNodeId(null);
      await refetch();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  }, [confirmDelete, deleting, refetch]);

  // Which example keys to show in the dropdown
  const dropdownKeys = isLive ? exampleKeys : offlineKeys;

  return (
    <div className="app">
      <header className="header">
        <h1>
          <span>Ory Keto</span> Permission Visualizer
        </h1>
        <div className="selectors">
          <div className="mode-toggle">
            <button
              className={`mode-btn ${!isLive ? "active" : ""}`}
              onClick={() => switchMode("offline")}
            >
              Offline
            </button>
            <button
              className={`mode-btn ${isLive ? "active" : ""}`}
              onClick={() => switchMode("live")}
            >
              Live
            </button>
          </div>
          <div className="selector-group">
            <label>Use Case</label>
            <select
              value={selectedExample}
              onChange={(e) => selectExample(e.target.value)}
            >
              <option value="">Select a use case...</option>
              {isLive ? (
                <option value={EXPLORE_KEY}>Explore Live Data</option>
              ) : (
                <optgroup label="Examples">
                  {dropdownKeys.map((key) => (
                    <option key={key} value={key}>
                      {EXAMPLES[key]?.name || key}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
          {(exampleMeta || (!isLive && selectedExample)) && (
            <>
              <div className="selector-group">
                <label>Subject Namespace</label>
                <select
                  aria-label="Subject Namespace"
                  value={selectedSubjectNs}
                  onChange={(e) => {
                    setSelectedSubjectNs(e.target.value);
                    selectSubject("");
                  }}
                  disabled={loading || subjectNamespaces.length === 0}
                >
                  <option value="">
                    {loading
                      ? "Loading subjects..."
                      : subjectNamespaces.length === 0
                        ? "No subjects found"
                        : "Select a namespace..."}
                  </option>
                  {subjectNamespaces.map((ns) => (
                    <option key={ns} value={ns}>
                      {ns}
                    </option>
                  ))}
                </select>
              </div>
              <div className="selector-group">
                <label>Subject</label>
                <select
                  aria-label="Subject"
                  value={selectedSubject}
                  onChange={(e) => selectSubject(e.target.value)}
                  disabled={loading || !selectedSubjectNs}
                >
                  <option value="">
                    {!selectedSubjectNs ? "Pick a namespace first..." : "Select a subject..."}
                  </option>
                  {subjectOptions.map((s) => (
                    <option key={s.label} value={s.label}>
                      {subjectOptionLabel(s)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="selector-group">
                <label>Branch</label>
                <select
                  aria-label="Branch"
                  value={selectedBranchKey}
                  onChange={(e) => setSelectedBranchKey(e.target.value)}
                  disabled={!selectedSubjectRef || branchNodes.length === 0}
                >
                  <option value="">
                    {branchNodes.length === 0 ? "No branches" : `All branches (${branchNodes.length})`}
                  </option>
                  {branchNodes.map((n) => (
                    <option key={n.key} value={n.key}>
                      {n.key}
                    </option>
                  ))}
                </select>
              </div>
              <div className="selector-group">
                <label>Class scope</label>
                <label className="checkbox-inline">
                  <input
                    type="checkbox"
                    checked={scopeToClass}
                    onChange={(e) => setScopeToClass(e.target.checked)}
                    disabled={!selectedClass}
                  />
                  {selectedClass ? `Only ${selectedClass}` : "Select a class subject"}
                </label>
              </div>
            </>
          )}
          {loading && <div className="status-indicator loading">Fetching tuples...</div>}
          {loadingPermissions && (
            <div className="status-indicator loading">Checking permissions...</div>
          )}
          {error && <div className="status-indicator error">Error: {error}</div>}
        </div>
      </header>

      <div className="main">
        {/* Sidebar */}
        <div className="sidebar">
          {exampleMeta && (
            <div className="description">{exampleMeta.description}</div>
          )}

          {/* Connection status */}
          {effectiveTuples.length > 0 && !loading && !error && (
            <div className={`connection-status ${isLive ? "" : "offline"}`}>
              <span className={`status-dot ${isLive ? "live-dot" : "offline-dot"}`} />
              {isLive ? "Live" : "Offline"} — {effectiveTuples.length} tuples, {namespaces.length} namespaces
            </div>
          )}

          {/* Namespace Legend */}
          {namespaceLegend.length > 0 && (
            <div className="legend">
              <h2>Namespaces</h2>
              <div className="legend-items">
                {namespaceLegend.map((l) => (
                  <div className="legend-item" key={l.namespace}>
                    <div
                      className="legend-dot"
                      style={{ backgroundColor: l.color }}
                    />
                    {l.namespace}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Selected node — live-mode-only delete panel */}
          {isLive && nodeTuples && (
            <div className="node-delete-panel">
              <h2>Selected Node</h2>
              <div className="node-info">
                <div className="node-id">{nodeTuples.label}</div>
                <div className="node-counts">
                  {nodeTuples.tuples.length} tuple{nodeTuples.tuples.length === 1 ? "" : "s"} reference this node
                </div>
              </div>
              <button
                className="btn-danger"
                disabled={nodeTuples.tuples.length === 0 || deleting}
                onClick={() => setConfirmDelete(nodeTuples)}
              >
                Delete {nodeTuples.tuples.length} tuple{nodeTuples.tuples.length === 1 ? "" : "s"}
              </button>
              {deleteError && <div className="delete-error">{deleteError}</div>}
            </div>
          )}

          {/* Subject's Direct Relations */}
          {selectedSubject && subjectRelations.length > 0 && (
            <>
              <h2>Direct Relations</h2>
              <div className="relations-list">
                {subjectRelations.map((r, i) => (
                  <div className="relation-item" key={i} title={`${selectedSubject} -> ${r.relation} -> ${r.namespace}:${r.object}`}>
                    <span className="rel-label">{r.relation}</span>
                    <span className="rel-arrow">-&gt;</span>
                    <span>
                      {r.namespace}:{r.object}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Permission Results (live mode) */}
          {isLive && selectedSubject && permissionsByObject.length > 0 && (
            <>
              <h2 style={{ marginTop: 24 }}>Permissions</h2>
              <div className="permissions-grid">
                {permissionsByObject.map((obj) => (
                  <div key={`${obj.namespace}:${obj.object}`} className="permission-card">
                    <div className="perm-info">
                      <div className="perm-object">
                        {obj.namespace}:{obj.object}
                      </div>
                      <div className="perm-actions">
                        {obj.perms.map((p) => (
                          <span
                            key={p.permission}
                            className={`badge ${p.allowed ? "badge-allowed" : "badge-denied"}`}
                          >
                            {p.permission}: {p.allowed ? "ALLOWED" : "DENIED"}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {isLive && selectedSubject && loadingPermissions && (
            <div className="loading-permissions">Checking permissions...</div>
          )}

          {/* Offline CTA — shown instead of permissions in offline mode */}
          {!isLive && selectedSubject && subjectRelations.length > 0 && (
            <div className="offline-cta">
              <h2 style={{ marginTop: 24 }}>Permissions</h2>
              <p>
                Connect to a live Ory Keto instance to see permission checks
                (ALLOWED / DENIED) for each resource.
              </p>
              <p>
                Switch to <strong>Live</strong> mode above and configure your{" "}
                <code>ORY_SDK_URL</code> and <code>ORY_ACCESS_TOKEN</code>, or{" "}
                <a href="https://console.ory.sh/registration" target="_blank" rel="noopener noreferrer">
                  sign up for Ory
                </a>{" "}
                to get started.
              </p>
            </div>
          )}
        </div>

        {/* Main panel: graph + relationship editor */}
        <div className="main-panel">
          <div className="graph-container">
            {!selectedExample ? (
              <div className="empty-state">
                <div className="icon">&#x1F510;</div>
                <p>Select a use case to get started</p>
              </div>
            ) : loading ? (
              <div className="empty-state">
                <div className="icon">&#x23F3;</div>
                <p>Fetching live data from Ory Keto...</p>
              </div>
            ) : error ? (
              <div className="empty-state">
                <div className="icon">&#x26A0;&#xFE0F;</div>
                <p>Failed to connect to Ory Keto</p>
                <p className="error-detail">{error}</p>
                <p className="error-hint">
                  Make sure <code>ORY_SDK_URL</code> and <code>ORY_ACCESS_TOKEN</code> are set in your <code>.env</code>
                </p>
              </div>
            ) : !selectedSubject ? (
              <div className="empty-state">
                <div className="icon">&#x1F464;</div>
                <p>Select a subject to view its permission graph</p>
              </div>
            ) : elements.length > 0 ? (
              <CytoscapeComponent
                key={`${mode}-${selectedExample}-${selectedSubject}-${selectedBranchKey}-${scopeToClass}`}
                elements={elements}
                stylesheet={stylesheet}
                layout={layout}
                className="cy"
                cy={handleCyInit}
                wheelSensitivity={0.3}
              />
            ) : (
              <div className="empty-state">
                <div className="icon">&#x1F4CA;</div>
                <p>No graph data available</p>
              </div>
            )}
          </div>

          {!isLive && selectedExample && (
            <SchemaEditor
              key={selectedExample}
              defaultSchema={OPL_SCHEMAS[selectedExample] ?? ""}
            />
          )}

          {!isLive && selectedExample && (
            <RelationshipEditor
              baseTuples={tuples}
              customTuples={customTuples}
              deletedTupleKeys={deletedTupleKeys}
              namespaces={namespaces}
              onAddTuple={(tuple) => setCustomTuples((prev) => [...prev, tuple])}
              onDeleteBaseTuple={(i) =>
                setDeletedTupleKeys((prev) => new Set([...prev, i]))
              }
              onDeleteCustomTuple={(i) =>
                setCustomTuples((prev) => prev.filter((_, j) => j !== i))
              }
              onUpdateCustomTuple={(i, tuple) =>
                setCustomTuples((prev) => prev.map((t, j) => (j === i ? tuple : t)))
              }
              onReset={() => {
                setCustomTuples([]);
                setDeletedTupleKeys(new Set());
              }}
            />
          )}
        </div>
      </div>

      {confirmDelete && (
        <div className="modal-overlay" onClick={() => !deleting && setConfirmDelete(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Delete {confirmDelete.tuples.length} tuple{confirmDelete.tuples.length === 1 ? "" : "s"}?</h2>
            <p className="modal-warn">
              This will permanently delete the following tuples from Ory Keto.
              All tuples involving <strong>{confirmDelete.label}</strong> (as object or as a subject set) will be removed. <strong>This cannot be undone.</strong>
            </p>
            <div className="modal-tuple-list">
              {confirmDelete.tuples.slice(0, 50).map((t, i) => (
                <div key={i} className="modal-tuple">
                  {t.namespace}:{t.object}#{t.relation} @ {tupleSubjectText(t)}
                </div>
              ))}
              {confirmDelete.tuples.length > 50 && (
                <div className="modal-tuple-more">
                  …and {confirmDelete.tuples.length - 50} more
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button
                className="btn-secondary"
                disabled={deleting}
                onClick={() => setConfirmDelete(null)}
              >
                Cancel
              </button>
              <button
                className="btn-danger"
                disabled={deleting}
                onClick={handleConfirmDelete}
              >
                {deleting ? "Deleting…" : `Delete ${confirmDelete.tuples.length}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
