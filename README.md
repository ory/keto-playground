# Permission Visualizer

Interactive React app for exploring and editing Ory Keto permission graphs. Works in two modes:

- **Offline** — loads bundled example data, fully editable, no Keto instance needed
- **Live** — connects to your Ory Network project, fetches real tuples and runs live permission checks

Select a use case and a user to see their permission graph: which entities they're connected to, through what relations, and what permissions they have on each resource.

- Nodes are color-coded by namespace (User, Role, Customer, etc.)
- Edges show relation names (members, parent_lob, allowed_roles, etc.)
- The sidebar shows direct relations and permission results (ALLOWED/DENIED)

## Schema Editor

In **offline mode**, a **Schema** panel at the bottom of the graph shows the OPL (Ory Permission Language) TypeScript source for the selected example:

- **Expand** the panel to read the full namespace definitions (`related` blocks and `permits` logic)
- **Edit** the schema directly in the textarea — useful for exploring what-if changes locally
- An **"edited"** badge marks when the local copy differs from the original
- **Reset to original** restores the bundled schema
- Switching examples automatically loads the new schema and discards local edits
- **Local only** — to push changes to a live Ory instance, run `ory update opl --file namespace.ts`

> The Keto API does not expose OPL at runtime, so the Schema Editor is unavailable in Live mode.

## Relationship Editor

In **offline mode**, a **Relationships** panel at the bottom of the graph lets you edit the tuple data live:

- **Expand** the panel to see all relation tuples in a scrollable table
- **Delete** any tuple — the graph updates immediately
- **Edit** any tuple inline: hover a row to reveal the ✏ button, which turns the row into editable inputs; press Enter to save or Escape to cancel. Editing a base tuple saves it as a custom row (marked with a blue border)
- **Subject format** in the edit field: plain `alice` for a direct subject ID, or `Namespace:object` / `Namespace:object#relation` for a subject set
- **Add new tuples** via a form: pick namespace, object, relation, and a subject (User ID or Subject Set)
- Newly added `subject_id` values appear in the user dropdown straight away
- An **"edited"** badge marks when changes are active
- **Reset to default** restores the original example data

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
cd permission-visualizer/app
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

| Variable           | Default                 | Description                      |
| ------------------ | ----------------------- | -------------------------------- |
| `ORY_ACCESS_TOKEN` | (required)              | PAT injected into proxy requests |
| `ORY_TUNNEL_URL`   | `http://localhost:4000` | Where the ory tunnel is running  |

## Available Use Cases

The visualizer supports all 7 examples. The dropdown options are defined in `src/data/examples.js`:

| Use Case            | Interesting Users to Try                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------- |
| RBAC App Access     | `alice` (admin — all access), `eve` (viewer — limited)                                      |
| RBAC Bank Accounts  | `john-smith` (owner), `james` (teller), `kevin` (branch_admin)                              |
| RAG Document Access | `alice` (owner + team), `oscar` (no access)                                                 |
| B2B Hierarchy       | `ceo-pat` (sees everything), `mgr-retail-lisa` (one LOB), `rep-saas-yara` (one customer)    |
| SaaS Feature Gating | `alice` (enterprise), `eve` (free tier)                                                     |
| Healthcare Records  | `dr-jones` (multi-patient), `dr-garcia` (emergency access), `dr-specialist-lee` (consented) |
| Content Publishing  | `writer-alice` (drafts), `editor-diana` (review), `publisher-frank` (publish)               |

## Tech Stack

- [React](https://react.dev/) + [Vite](https://vite.dev/)
- [Cytoscape.js](https://js.cytoscape.org/) with [dagre layout](https://github.com/cytoscape/cytoscape.js-dagre) for directed graph rendering
- Ory Keto REST API (via tunnel proxy)

## Tests

```bash
npx playwright install chromium
npx playwright test   # runs all tests
```

| Test file                           | Requires                                        |
| ----------------------------------- | ----------------------------------------------- |
| `tests/relationship-editor.spec.js` | Nothing — uses offline bundled data (18 tests)  |
| `tests/schema-editor.spec.js`       | Nothing — uses offline bundled data (10 tests)  |
| `tests/visualizer.spec.js`          | Live Ory tunnel on port 4000 (11 tests)         |
