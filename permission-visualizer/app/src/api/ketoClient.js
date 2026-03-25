/**
 * Keto API client — calls the Ory Permissions API via the Vite dev proxy.
 *
 * Proxy route: /api/* -> ory tunnel (localhost:4000) -> Ory Network
 * The Vite proxy injects the Authorization header server-side so the
 * PAT never reaches the browser.
 */

const API = "/api";

/** Fetch the list of namespaces from the current OPL deployment. */
export async function fetchNamespaces() {
  const res = await fetch(`${API}/namespaces`);
  if (!res.ok) {
    throw new Error(`Failed to fetch namespaces: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  return (data.namespaces || []).map((n) => n.name);
}

/**
 * Fetch all relation tuples for a given namespace, handling pagination.
 * Returns a flat array of tuple objects.
 */
async function fetchTuplesForNamespace(namespace) {
  const tuples = [];
  let pageToken = "";

  do {
    const params = new URLSearchParams({ namespace, page_size: "250" });
    if (pageToken) params.set("page_token", pageToken);

    const res = await fetch(`${API}/relation-tuples?${params}`);
    if (!res.ok) {
      throw new Error(
        `Failed to fetch tuples for ${namespace}: ${res.status} ${res.statusText}`
      );
    }
    const data = await res.json();
    tuples.push(...(data.relation_tuples || []));
    pageToken = data.next_page_token || "";
  } while (pageToken);

  return tuples;
}

/**
 * Fetch ALL relation tuples across all namespaces.
 * Calls /namespaces first, then fetches each namespace in parallel.
 */
export async function fetchAllTuples(namespaces) {
  const results = await Promise.all(
    namespaces.map((ns) => fetchTuplesForNamespace(ns))
  );
  return results.flat();
}

/**
 * Check a single permission via POST /relation-tuples/check.
 * Returns { allowed: boolean }.
 */
export async function checkPermission({ namespace, object, relation, subject_id }) {
  const res = await fetch(`${API}/relation-tuples/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ namespace, object, relation, subject_id }),
  });
  // Ory returns 200 for allowed, 403 for denied (both with JSON body)
  const data = await res.json();
  return data.allowed === true;
}

/**
 * Check multiple permissions in sequence (Ory doesn't have a batch endpoint
 * on the public check API; doing them individually).
 * Returns an array of { namespace, object, permission, allowed } results.
 */
export async function checkPermissions(checks) {
  const results = [];
  // Run in batches of 10 concurrent requests to avoid overwhelming the API
  const BATCH_SIZE = 10;
  for (let i = 0; i < checks.length; i += BATCH_SIZE) {
    const batch = checks.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (c) => {
        const allowed = await checkPermission({
          namespace: c.namespace,
          object: c.object,
          relation: c.permission,
          subject_id: c.subject_id,
        });
        return { ...c, allowed };
      })
    );
    results.push(...batchResults);
  }
  return results;
}

/**
 * Derive the list of users from tuples.
 * A "user" is any subject_id that appears in the tuples.
 */
export function deriveUsers(tuples) {
  const userSet = new Set();
  for (const t of tuples) {
    if (t.subject_id) {
      userSet.add(t.subject_id);
    }
  }
  return Array.from(userSet).sort();
}
