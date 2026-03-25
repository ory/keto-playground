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
import "./App.css";

cytoscape.use(dagre);

const exampleKeys = Object.keys(EXAMPLES);
const offlineKeys = getOfflineExampleKeys();
const EXPLORE_KEY = "__explore__";

const DYNAMIC_PALETTE = [
  "#6366f1", "#f59e0b", "#10b981", "#ef4444", "#06b6d4",
  "#ec4899", "#8b5cf6", "#22c55e", "#f97316", "#14b8a6",
];

function App() {
  const [mode, setMode] = useState("offline");
  const [selectedExample, setSelectedExample] = useState("");
  const [selectedUser, setSelectedUser] = useState("");
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
    users,
    namespaces,
    loading,
    error,
    permissionResults,
    loadingPermissions,
    checkUserPermissions,
  } = isLive ? liveData : offlineData;

  // Reset user when example or mode changes
  useEffect(() => {
    setSelectedUser("");
  }, [selectedExample, mode]);

  // Reset example when switching modes — auto-select explore in live mode
  useEffect(() => {
    setSelectedExample(mode === "live" ? EXPLORE_KEY : "");
  }, [mode]);

  // Check permissions when user changes (live mode only)
  useEffect(() => {
    if (selectedUser && isLive) {
      checkUserPermissions(selectedUser);
    }
  }, [selectedUser, checkUserPermissions, isLive]);

  // Get user's direct relations for sidebar
  const userRelations = useMemo(() => {
    if (!selectedUser || tuples.length === 0) return [];
    return tuples
      .filter((t) => t.subject_id === selectedUser)
      .map((t) => ({
        namespace: t.namespace,
        object: t.object,
        relation: t.relation,
      }));
  }, [selectedUser, tuples]);

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

  // Build graph elements from tuples + permission results
  const graphData = useMemo(() => {
    if (!selectedUser || tuples.length === 0) return null;
    return buildGraph(tuples, selectedUser, permissionResults, namespaceColorMap);
  }, [selectedUser, tuples, permissionResults, namespaceColorMap]);

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
            <div className="selector-group">
              <label>User</label>
              <select
                value={selectedUser}
                onChange={(e) => setSelectedUser(e.target.value)}
                disabled={loading}
              >
                <option value="">
                  {loading ? "Loading users..." : "Select a user..."}
                </option>
                {users.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
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
          {tuples.length > 0 && !loading && !error && (
            <div className={`connection-status ${isLive ? "" : "offline"}`}>
              <span className={`status-dot ${isLive ? "live-dot" : "offline-dot"}`} />
              {isLive ? "Live" : "Offline"} — {tuples.length} tuples, {namespaces.length} namespaces
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

          {/* User's Direct Relations */}
          {selectedUser && userRelations.length > 0 && (
            <>
              <h2>Direct Relations</h2>
              <div className="relations-list">
                {userRelations.map((r, i) => (
                  <div className="relation-item" key={i} title={`${selectedUser} -> ${r.relation} -> ${r.namespace}:${r.object}`}>
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
          {isLive && selectedUser && permissionsByObject.length > 0 && (
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

          {isLive && selectedUser && loadingPermissions && (
            <div className="loading-permissions">Checking permissions...</div>
          )}

          {/* Offline CTA — shown instead of permissions in offline mode */}
          {!isLive && selectedUser && userRelations.length > 0 && (
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

        {/* Graph */}
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
          ) : !selectedUser ? (
            <div className="empty-state">
              <div className="icon">&#x1F464;</div>
              <p>Select a user to view their permission graph</p>
            </div>
          ) : elements.length > 0 ? (
            <CytoscapeComponent
              key={`${mode}-${selectedExample}-${selectedUser}`}
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
      </div>
    </div>
  );
}

export default App;
