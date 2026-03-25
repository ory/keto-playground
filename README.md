# Keto Playground

Interactive React app that connects to [Ory Keto](https://www.ory.sh/keto/) and visualizes the permission graph for any user. It fetches real relation tuples, derives users from the data, and runs actual permission checks against the Keto API. Also works fully offline with bundled example data.

Select a use case and a user to see their permission graph: which entities they're connected to, through what relations, and what permissions they have on each resource.

- Nodes are color-coded by namespace (User, Role, Customer, etc.)
- Edges show relation names (members, parent_lob, allowed_roles, etc.)
- The sidebar shows direct relations and permission results (ALLOWED/DENIED)

## Prerequisites

- Node.js 20+
- An Ory Network project with OPL and tuples loaded (optional — the app works offline with bundled examples)

## Quick Start

### Offline (no Ory project needed)

```bash
cd permission-visualizer
make dev
```

Open **http://localhost:5173** — the app detects that no API is configured and uses bundled offline data.

### With a live Ory project

1. Copy the env file and fill in your credentials:

```bash
cd permission-visualizer
cp .env.example .env
# Edit .env with your ORY_SDK_URL and ORY_ACCESS_TOKEN
```

2. Seed an example into Keto:

```bash
make seed EXAMPLE=b2b-hierarchy   # or any example from examples/
```

3. Start the dev server:

```bash
make dev
```

Open **http://localhost:5173**. The Vite dev server proxies `/api/*` requests to your Ory project, injecting the access token so the browser never sees the PAT.

### Docker

```bash
make docker-build
make docker-run   # reads .env for ORY_SDK_URL and ORY_ACCESS_TOKEN
```

The production container uses a zero-dependency Node.js server (`server.js`) that serves the built SPA and proxies `/api/*` to Ory. Runs on port 3000 by default.

## How It Works

```
Browser (React + Cytoscape.js)
    |
    |  /api/relation-tuples
    |  /api/relation-tuples/check
    |  /api/namespaces
    ▼
Vite Dev Proxy (:5173/api/*) — or — server.js (:3000/api/*)
    |
    |  + Authorization: Bearer <PAT>
    ▼
Ory Network API (ORY_SDK_URL)
```

1. **Fetch namespaces** — gets the list of entity types from the current OPL
2. **Fetch all tuples** — paginated fetch across all namespaces
3. **Derive users** — extracts all `subject_id` values from tuples
4. **Build graph** — when a user is selected, traces their connections through the tuple graph
5. **Check permissions** — runs permission checks for all relevant resources and displays ALLOWED/DENIED badges

If no API is reachable, the app falls back to bundled offline data generated from `examples/`.

## Configuration

Environment variables are read from `permission-visualizer/.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `ORY_SDK_URL` | — | Your Ory project URL (e.g. `https://your-project.projects.oryapis.com`) |
| `ORY_ACCESS_TOKEN` | — | Ory PAT, injected into proxy requests |

## Available Use Cases

All 7 examples live in `permission-visualizer/examples/` and are available in the app dropdown:

| Use Case | Interesting Users to Try |
|----------|-------------------------|
| RBAC App Access | `alice` (admin — all access), `eve` (viewer — limited) |
| RBAC Bank Accounts | `john-smith` (owner), `james` (teller), `kevin` (branch_admin) |
| RAG Document Access | `alice` (owner + team), `oscar` (no access) |
| B2B Hierarchy | `ceo-pat` (sees everything), `mgr-retail-lisa` (one LOB), `rep-saas-yara` (one customer) |
| SaaS Feature Gating | `alice` (enterprise), `eve` (free tier) |
| Healthcare Records | `dr-jones` (multi-patient), `dr-garcia` (emergency access), `dr-specialist-lee` (consented) |
| Content Publishing | `writer-alice` (drafts), `editor-diana` (review), `publisher-frank` (publish) |

## Makefile Targets

Run all targets from `permission-visualizer/`:

| Target | Description |
|--------|-------------|
| `make dev` | Start the Vite dev server |
| `make build` | Install deps and create the production bundle |
| `make seed EXAMPLE=<name>` | Seed a use case into Ory Keto |
| `make generate-offline` | Regenerate offline data from `examples/` |
| `make docker-build` | Build the Docker image |
| `make docker-run` | Run the container (reads `.env`) |
| `make clean` | Remove `dist/` and `node_modules/` |

## Tech Stack

- [React](https://react.dev/) + [Vite](https://vite.dev/)
- [Cytoscape.js](https://js.cytoscape.org/) with [dagre layout](https://github.com/cytoscape/cytoscape.js-dagre) for directed graph rendering
- Ory Keto REST API (via dev proxy or production server)

## Tests

```bash
cd permission-visualizer/app
npx playwright install chromium
npx playwright test
```
