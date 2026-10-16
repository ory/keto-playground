# Keto Playground

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
- **Subject format** in the edit field: plain `alice` for a direct subject ID (deprecated — prefer namespaced subject sets), or `Namespace:object` / `Namespace:object#relation` for a subject set
- **Add new tuples** via a form: pick namespace, object, relation, and a subject (User ID or Subject Set)
- Newly added `subject_id` values appear in the user dropdown straight away
- An **"edited"** badge marks when changes are active
- **Reset to default** restores the original example data

## Prerequisites

- Node.js 22+ (the Docker image builds on Node 24)
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
make docker-build   # distroless image (gcr.io/distroless/nodejs24), linux/amd64 by default
make docker-run     # reads .env; published on 127.0.0.1:3000 only
make docker-push    # builds and pushes registry.macgyver.work/keto-playground:<git sha> and :latest
```

The production container uses a zero-dependency Node.js server (`server.js`) that serves the built SPA and proxies `/api/*` to Ory. Runs on port 3000 by default. Override `PLATFORM`, `REGISTRY` or `REGISTRY_IMAGE` on the `make` command line.

> **Do not expose the server publicly without an authenticating proxy in front of it.** The proxy only forwards the
> visualizer's own Keto reads and checks (see below), but anyone who can reach it can read every relationship and,
> with `ALLOW_TUPLE_DELETE=1`, delete them.

### Local Keto with a large, deep graph

`permission-visualizer/local-keto/` runs Ory Keto (open-source `oryd/keto` by default; set `KETO_IMAGE` for the
Enterprise build) on Postgres behind a small router, and seeds a generated graph: groups nested 5 levels, an 8-level
folder tree, 3,000 documents, ~400 users, ClaudeClass-scoped documents and a few legacy `subject_id` tuples (~11k tuples).

```bash
cd permission-visualizer
bash local-keto/up.sh     # start (fresh database), load the OPL, seed
ORY_SDK_URL=http://localhost:4455 ORY_ACCESS_TOKEN=local ALLOW_TUPLE_DELETE=1 make dev
bash local-keto/down.sh   # stop and remove
```

In the app pick **Live → "Local deep graph (local-keto)"** (runs permission checks) or **Explore Live Data**.
`local-keto/keto.yml` sets `max_read_depth: 18`, the smallest depth at which the deepest paths evaluate as allowed —
see the comment there for the cost of denied checks on deep models.

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
    |  only GET /namespaces, GET /relation-tuples, POST /relation-tuples/check
    |  (+ DELETE /admin/relation-tuples with ALLOW_TUPLE_DELETE=1); everything else 404
    |  + Authorization: Bearer <PAT>   (no cookies forwarded, Set-Cookie stripped)
    ▼
Ory Network API (ORY_SDK_URL)
```

The project API key reaches every admin API of the project, so the proxy forwards only the visualizer's own
requests (`proxy-policy.mjs`). `server.js` also checks the `Host` header (DNS rebinding) and refuses cross-origin writes.

1. **Fetch namespaces** — gets the list of entity types from the current OPL
2. **Fetch all tuples** — paginated fetch across all namespaces
3. **Derive subjects** — collects entity subject sets (`User:alice`), subject sets with a relation (`Team:engineering#members`) and legacy `subject_id` values; the picker groups them by namespace
4. **Build graph** — traces the selected subject's connections (optionally one **Branch** only, or scoped to one ClaudeClass); stops at 150 nodes with a notice
5. **Check permissions** — in Live mode, checks the example's permissions for the objects in the graph and shows ALLOWED/DENIED badges
6. **Delete** (Live mode, `ALLOW_TUPLE_DELETE=1`) — tap a node to delete the tuples that reference it, after confirmation

If no API is reachable, the app falls back to bundled offline data generated from `examples/`.

## Configuration

Environment variables are read from `permission-visualizer/.env`:

| Variable             | Default                      | Description |
| -------------------- | ---------------------------- | ----------- |
| `ORY_SDK_URL`        | `ORY_TUNNEL_URL`             | Your Ory project URL (e.g. `https://your-project.projects.oryapis.com`) |
| `ORY_TUNNEL_URL`     | `http://localhost:4000`      | Where the ory tunnel is running (used when `ORY_SDK_URL` is unset) |
| `ORY_ACCESS_TOKEN`   | —                            | Project API key, injected into proxied requests |
| `ALLOW_TUPLE_DELETE` | off                          | `1` lets the proxy delete relation tuples (Live-mode node delete) |
| `ALLOWED_HOSTS`      | `localhost,127.0.0.1,[::1]`  | `server.js`: hostnames it answers on |
| `HOST` / `PORT`      | `127.0.0.1` / `3000`         | `server.js` listen address (the image sets `HOST=0.0.0.0`) |
| `ORY_PROJECT`, `ORY_WORKSPACE` | —                  | `make seed` only: the project to replace the OPL of |

## Available Use Cases

All 7 examples live in `permission-visualizer/examples/` and are available in the app dropdown:

| Use Case            | Interesting Users to Try                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------- |
| RBAC App Access     | `User:alice` (admin — all access), `User:eve` (viewer — limited)                                      |
| RBAC Bank Accounts  | `User:john-smith` (owner), `User:james` (teller), `User:kevin` (branch_admin)                              |
| RAG Document Access | `User:alice` (owner + team), `User:oscar` (no access)                                                 |
| B2B Hierarchy       | `User:ceo-pat` (sees everything), `User:mgr-retail-lisa` (one LOB), `User:rep-saas-yara` (one customer)    |
| SaaS Feature Gating | `User:alice` (enterprise), `User:eve` (free tier)                                                     |
| Healthcare Records  | `User:dr-jones` (multi-patient), `User:dr-garcia` (emergency access), `User:dr-specialist-lee` (consented) |
| Content Publishing  | `User:writer-alice` (drafts), `User:editor-diana` (review), `User:publisher-frank` (publish)               |

## Makefile Targets

Run all targets from `permission-visualizer/`:

| Target | Description |
|--------|-------------|
| `make dev` | Start the Vite dev server |
| `make build` | Install deps and create the production bundle |
| `make seed EXAMPLE=<name>` | Seed a use case into Ory Keto |
| `make generate-offline` | Regenerate offline data from `examples/` |
| `make docker-build` | Build the distroless Docker image (`linux/amd64`) |
| `make docker-run` | Run the container on 127.0.0.1 (reads `.env`) |
| `make docker-push` | Build and push to `registry.macgyver.work/keto-playground` |
| `make test` | Unit tests for the proxy policy and servers (`node --test`) |
| `make clean` | Remove `dist/` and `node_modules/` |

## Tech Stack

- [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) + [Vite](https://vite.dev/)
- [Cytoscape.js](https://js.cytoscape.org/) for graph rendering, with a breadth-first tiered layout around the selected subject
- Ory Keto REST API (via dev proxy or production server)

## Tests

```bash
cd permission-visualizer
make test                                  # node:test — proxy policy, server.js, Vite proxy
cd app && npx playwright install chromium
npx playwright test                        # offline specs run anywhere
# live specs need the local Keto (bash local-keto/up.sh):
ORY_SDK_URL=http://localhost:4455 ORY_ACCESS_TOKEN=local ALLOW_TUPLE_DELETE=1 npx playwright test
```

| Test file | Requires |
| --------- | -------- |
| `tests/relationship-editor.spec.ts`, `tests/schema-editor.spec.ts`, `tests/graph-offline.spec.ts`, `tests/subject-graph-offline.spec.ts` | Nothing — bundled offline data |
| `tests/visualizer.spec.ts`, `tests/live-explore.spec.ts`, `tests/proxy-policy.spec.ts` | The local Keto from `local-keto/` |
| `../test/*.test.mjs` | Nothing — fake upstream servers |
