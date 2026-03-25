# Permission Visualizer

Interactive React app that connects to Ory Keto **live** and visualizes the permission graph for any user. Not a static mockup — it fetches real relation tuples, derives users from the data, and runs actual permission checks against the Keto API.



Select a use case and a user to see their permission graph: which entities they're connected to, through what relations, and what permissions they have on each resource.

- Nodes are color-coded by namespace (User, Role, Customer, etc.)
- Edges show relation names (members, parent_lob, allowed_roles, etc.)
- The sidebar shows direct relations and permission results (ALLOWED/DENIED)

## Prerequisites

- Node.js 18+
- An Ory Network project with OPL and tuples loaded
- The `ory` CLI installed

## Quick Start

### 1. Seed Keto with an example

From the project root:

```bash
source .env
bash scripts/seed-keto.sh b2b-hierarchy   # or any other example
```

### 2. Start the Ory tunnel

The visualizer needs a local proxy to the Ory Network API:

```bash
source .env
ory tunnel --dev --port 4000 http://localhost:5173
```

This runs on port 4000 and the Vite dev server proxies `/api/*` requests through it. The tunnel injects your `ORY_ACCESS_TOKEN` so the browser never sees the PAT.

### 3. Start the visualizer

```bash
cd permission-visualizer
npm install
npm run dev
```

Open **http://localhost:5173** in your browser.

### 4. Use it

1. Select a **Use Case** from the dropdown (must match what's seeded in Keto)
2. Select a **User** to see their permission graph
3. The graph builds automatically — nodes are entities, edges are relations
4. The sidebar shows direct relations and permission check results

## How It Works

```
Browser (React + Cytoscape.js)
    |
    |  /api/relation-tuples
    |  /api/relation-tuples/check
    |  /api/namespaces
    ▼
Vite Dev Proxy (:5173/api/*)
    |
    |  + Authorization: Bearer <PAT>
    ▼
Ory Tunnel (:4000)
    |
    ▼
Ory Network API
```

1. **Fetch namespaces** — gets the list of entity types from the current OPL
2. **Fetch all tuples** — paginated fetch across all namespaces
3. **Derive users** — extracts all `subject_id` values from tuples
4. **Build graph** — when a user is selected, traces their connections through the tuple graph
5. **Check permissions** — runs permission checks for all relevant resources and displays ALLOWED/DENIED badges

## Configuration

The Vite proxy is configured in `vite.config.js`. It reads from the project root `.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `ORY_ACCESS_TOKEN` | (required) | PAT injected into proxy requests |
| `ORY_TUNNEL_URL` | `http://localhost:4000` | Where the ory tunnel is running |

## Available Use Cases

The visualizer supports all 7 examples. The dropdown options are defined in `src/data/examples.js`:

| Use Case | Interesting Users to Try |
|----------|-------------------------|
| RBAC App Access | `alice` (admin — all access), `eve` (viewer — limited) |
| RBAC Bank Accounts | `john-smith` (owner), `james` (teller), `kevin` (branch_admin) |
| RAG Document Access | `alice` (owner + team), `oscar` (no access) |
| B2B Hierarchy | `ceo-pat` (sees everything), `mgr-retail-lisa` (one LOB), `rep-saas-yara` (one customer) |
| SaaS Feature Gating | `alice` (enterprise), `eve` (free tier) |
| Healthcare Records | `dr-jones` (multi-patient), `dr-garcia` (emergency access), `dr-specialist-lee` (consented) |
| Content Publishing | `writer-alice` (drafts), `editor-diana` (review), `publisher-frank` (publish) |

## Tech Stack

- [React](https://react.dev/) + [Vite](https://vite.dev/)
- [Cytoscape.js](https://js.cytoscape.org/) with [dagre layout](https://github.com/cytoscape/cytoscape.js-dagre) for directed graph rendering
- Ory Keto REST API (via tunnel proxy)

## Tests

```bash
npx playwright install chromium
npx playwright test   # 11 tests
```
