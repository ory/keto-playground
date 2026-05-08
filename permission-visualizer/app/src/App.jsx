import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import CytoscapeComponent from "react-cytoscapejs";
import cytoscape from "cytoscape";
import dagre from "cytoscape-dagre";
import EXAMPLES from "./data/examples";
import { useKetoData } from "./hooks/useKetoData";
import { useOfflineData, getOfflineExampleKeys } from "./hooks/useOfflineData";
import {
  buildGraph,
  getCytoscapeStylesheet,
} from "./utils/graphBuilder";
import { deriveSubjects, DIRECT_ID_NAMESPACE } from "./api/ketoClient";
import { RelationshipEditor } from "./components/RelationshipEditor";
import { SchemaEditor } from "./components/SchemaEditor";
import OPL_SCHEMAS from "./data/oplSchemas";
import "./App.css";

cytoscape.use(dagre);

const exampleKeys = Object.keys(EXAMPLES);
const offlineKeys = getOfflineExampleKeys();
const EXPLORE_KEY = "__explore__";

const DYNAMIC_PALETTE = [
  "#6366f1", "#f59e0b", "#10b981", "#ef4444", "#06b6d4",
  "#ec4899", "#8b5cf6", "#22c55e", "#f97316", "#14b8a6",
];

function subjectTitle(subj) {
  if (!subj) return "";
  if (subj.kind === "id") return subj.id;
  return subj.relation
    ? `${subj.namespace}:${subj.object}#${subj.relation}`
    : `${subj.namespace}:${subj.object}`;
}

function App() {
  const [mode, setMode] = useState("offline");
  const [selectedExample, setSelectedExample] = useState("");
  const [selectedSubjectNs, setSelectedSubjectNs] = useState("");
  const [selectedSubjectKey, setSelectedSubjectKey] = useState("");
  const [customTuples, setCustomTuples] = useState([]);
  const [deletedTupleKeys, setDeletedTupleKeys] = useState(new Set());
  const cyRef = useRef(null);

  const isLive = mode === "live";
  const isExploreMode = selectedExample === EXPLORE_KEY;

  const exampleMeta = useMemo(() => {
    if (isExploreMode) {
      return { name: "Explore Live Data", description: "Exploring all live data from Ory Keto — select a user to see their relation graph.", permissions: [] };
    }
    return EXAMPLES[selectedExample] || null;
  }, [selectedExample, isExploreMode]);

  // Data hooks — only one is active at a time
  const liveData = useKetoData(isLive ? exampleMeta : null);
  const offlineData = useOfflineData(isLive ? null : selectedExample);

  const {
    tuples,
    namespaces,
    loading,
    error,
    permissionResults,
    loadingPermissions,
    checkUserPermissions,
  } = isLive ? liveData : offlineData;

  // Reset subject + relationship edits when example or mode changes
  useEffect(() => {
    setSelectedSubjectNs("");
    setSelectedSubjectKey("");
    setCustomTuples([]);
    setDeletedTupleKeys(new Set());
  }, [selectedExample, mode]);

  // Reset example when switching modes — auto-select explore in live mode
  useEffect(() => {
    setSelectedExample(mode === "live" ? EXPLORE_KEY : "");
  }, [mode]);

  // Merge base tuples with custom edits (offline mode only)
  const effectiveTuples = useMemo(() => {
    if (isLive) return tuples;
    const base = tuples.filter((_, i) => !deletedTupleKeys.has(i));
    return [...base, ...customTuples];
  }, [tuples, customTuples, deletedTupleKeys, isLive]);

  // Derive subjects from effective tuples (live or offline) so newly added
  // subjects appear in the dropdowns immediately.
  const effectiveSubjects = useMemo(
    () => deriveSubjects(effectiveTuples),
    [effectiveTuples]
  );

  // Sorted list of namespaces for the Subject Namespace dropdown.
  // Direct ID group always comes first if present.
  const subjectNamespaces = useMemo(() => {
    const keys = Object.keys(effectiveSubjects);
    const hasDirect = keys.includes(DIRECT_ID_NAMESPACE);
    const rest = keys.filter((k) => k !== DIRECT_ID_NAMESPACE).sort();
    return hasDirect ? [DIRECT_ID_NAMESPACE, ...rest] : rest;
  }, [effectiveSubjects]);

  // Subject options for the chosen namespace, with stable string keys for the dropdown.
  const subjectOptions = useMemo(() => {
    if (!selectedSubjectNs) return [];
    const list = effectiveSubjects[selectedSubjectNs] || [];
    if (selectedSubjectNs === DIRECT_ID_NAMESPACE) {
      return list.map((s) => ({ key: s.id, label: s.id, kind: "id", id: s.id }));
    }
    return list.map((s) => {
      const key = `${s.object}#${s.relation || ""}`;
      const label = s.relation ? `${s.object} #${s.relation}` : s.object;
      return {
        key,
        label,
        kind: "set",
        namespace: selectedSubjectNs,
        object: s.object,
        relation: s.relation || "",
      };
    });
  }, [effectiveSubjects, selectedSubjectNs]);

  // Resolve the selected subject spec from the two dropdown values.
  const selectedSubject = useMemo(() => {
    if (!selectedSubjectNs || !selectedSubjectKey) return null;
    return subjectOptions.find((o) => o.key === selectedSubjectKey) || null;
  }, [selectedSubjectNs, selectedSubjectKey, subjectOptions]);

  // Run live permission checks when the resolved subject changes.
  useEffect(() => {
    if (selectedSubject && isLive) {
      checkUserPermissions(selectedSubject);
    }
  }, [selectedSubject, checkUserPermissions, isLive]);

  // Get the subject's direct relations for the sidebar.
  const userRelations = useMemo(() => {
    if (!selectedSubject || effectiveTuples.length === 0) return [];
    return effectiveTuples
      .filter((t) => {
        if (selectedSubject.kind === "id") return t.subject_id === selectedSubject.id;
        return (
          t.subject_set &&
          t.subject_set.namespace === selectedSubject.namespace &&
          t.subject_set.object === selectedSubject.object &&
          (t.subject_set.relation || "") === (selectedSubject.relation || "")
        );
      })
      .map((t) => ({
        namespace: t.namespace,
        object: t.object,
        relation: t.relation,
      }));
  }, [selectedSubject, effectiveTuples]);

  // Permission targets for the sidebar — group by namespace:object
  const permissionsByObject = useMemo(() => {
    if (permissionResults.length === 0) return [];
    const map = new Map();
    for (const pr of permissionResults) {
      const key = `${pr.namespace}:${pr.object}`;
      if (!map.has(key)) {
        map.set(key, { namespace: pr.namespace, object: pr.object, perms: [] });
      }
      map.get(key).perms.push({ permission: pr.permission, allowed: pr.allowed });
    }
    return Array.from(map.values());
  }, [permissionResults]);

  // Cytoscape layout
  const layout = useMemo(
    () => ({
      name: "dagre",
      rankDir: "LR",
      spacingFactor: 1.5,
      nodeSep: 60,
      rankSep: 120,
      animate: true,
      animationDuration: 300,
    }),
    []
  );

  const stylesheet = useMemo(() => getCytoscapeStylesheet(), []);

  const handleCyInit = useCallback((cy) => {
    cyRef.current = cy;
    cy.on("layoutstop", () => {
      cy.fit(undefined, 40);
    });
  }, []);

  // Build namespace legend from live namespaces + colors
  const namespaceLegend = useMemo(() => {
    if ((!exampleMeta && !selectedExample) || namespaces.length === 0) return [];
    const legend = [];
    const seen = new Set();

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
    const map = {};
    for (const l of namespaceLegend) {
      map[l.namespace] = l.color;
    }
    return map;
  }, [namespaceLegend]);

  // Build graph elements from effective tuples + permission results
  const graphData = useMemo(() => {
    if (!selectedSubject || effectiveTuples.length === 0) return null;
    return buildGraph(effectiveTuples, selectedSubject, permissionResults, namespaceColorMap);
  }, [selectedSubject, effectiveTuples, permissionResults, namespaceColorMap]);

  const elements = useMemo(() => {
    if (!graphData) return [];
    return [...graphData.nodes, ...graphData.edges];
  }, [graphData]);

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
              onClick={() => setMode("offline")}
            >
              Offline
            </button>
            <button
              className={`mode-btn ${isLive ? "active" : ""}`}
              onClick={() => setMode("live")}
            >
              Live
            </button>
          </div>
          <div className="selector-group">
            <label>Use Case</label>
            <select
              value={selectedExample}
              onChange={(e) => setSelectedExample(e.target.value)}
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
                    setSelectedSubjectKey("");
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
                  value={selectedSubjectKey}
                  onChange={(e) => setSelectedSubjectKey(e.target.value)}
                  disabled={loading || !selectedSubjectNs}
                >
                  <option value="">
                    {!selectedSubjectNs
                      ? "Pick a namespace first..."
                      : "Select a subject..."}
                  </option>
                  {subjectOptions.map((opt) => (
                    <option key={opt.key} value={opt.key}>
                      {opt.label}
                    </option>
                  ))}
                </select>
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

          {/* Subject's Direct Relations */}
          {selectedSubject && userRelations.length > 0 && (
            <>
              <h2>Direct Relations</h2>
              <div className="relations-list">
                {userRelations.map((r, i) => (
                  <div className="relation-item" key={i} title={`${subjectTitle(selectedSubject)} -> ${r.relation} -> ${r.namespace}:${r.object}`}>
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
          {!isLive && selectedSubject && userRelations.length > 0 && (
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
                key={`${mode}-${selectedExample}-${selectedSubjectNs}-${selectedSubjectKey}`}
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
    </div>
  );
}

export default App;
