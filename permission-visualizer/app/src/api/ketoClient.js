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
 * Pass either subject_id (string) or subject_set ({namespace, object, relation}).
 * Returns boolean.
 */
export async function checkPermission({ namespace, object, relation, subject_id, subject_set }) {
  const body = { namespace, object, relation };
  if (subject_set) body.subject_set = subject_set;
  else body.subject_id = subject_id;
  const res = await fetch(`${API}/relation-tuples/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  // Ory returns 200 for allowed, 403 for denied (both with JSON body)
  const data = await res.json();
  return data.allowed === true;
}

/**
 * Check multiple permissions in sequence (Ory doesn't have a batch endpoint
 * on the public check API; doing them individually).
 * Each check entry may carry subject_id or subject_set.
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
          subject_set: c.subject_set,
        });
        return { ...c, allowed };
      })
    );
    results.push(...batchResults);
  }
  return results;
}

/**
 * Delete a single relation tuple by exact match.
 * Hits Keto's admin API at /admin/relation-tuples (proxied with PAT auth).
 * The PAT must have write/delete scope.
 */
export async function deleteRelationTuple(tuple) {
  const params = new URLSearchParams({
    namespace: tuple.namespace,
    object: tuple.object,
    relation: tuple.relation,
  });
  if (tuple.subject_id) {
    params.set("subject_id", tuple.subject_id);
  } else if (tuple.subject_set) {
    params.set("subject_set.namespace", tuple.subject_set.namespace);
    params.set("subject_set.object", tuple.subject_set.object);
    params.set("subject_set.relation", tuple.subject_set.relation || "");
  }
  const res = await fetch(`${API}/admin/relation-tuples?${params}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204) {
    const text = await res.text().catch(() => "");
    throw new Error(`Delete failed (${res.status}): ${text || res.statusText}`);
  }
}

/**
 * Delete an array of tuples in batches. Returns { deleted, errors }.
 */
export async function deleteRelationTuples(tuples) {
  const errors = [];
  let deleted = 0;
  const BATCH_SIZE = 5;
  for (let i = 0; i < tuples.length; i += BATCH_SIZE) {
    const batch = tuples.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map((t) => deleteRelationTuple(t)));
    for (let j = 0; j < results.length; j++) {
      if (results[j].status === "fulfilled") deleted++;
      else errors.push({ tuple: batch[j], reason: results[j].reason?.message || String(results[j].reason) });
    }
  }
  return { deleted, errors };
}

/**
 * Derive the list of users from tuples.
 * A "user" is any subject_id that appears in the tuples.
 * Kept for back-compat; new code should use deriveSubjects.
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

/**
 * Synthetic "namespace" key under which all bare subject_id values are grouped,
 * since Keto's subject_id is namespace-less.
 */
export const DIRECT_ID_NAMESPACE = "Direct ID";

/**
 * Derive every distinct subject across all tuples, grouped by namespace.
 *
 * Returns:
 *   {
 *     [DIRECT_ID_NAMESPACE]: [{ id }, ...],
 *     [namespace]: [{ object, relation }, ...],
 *     ...
 *   }
 *
 * Direct subject_ids are grouped under DIRECT_ID_NAMESPACE.
 * Subject sets are grouped by their namespace and listed as object#relation pairs.
 */
export function deriveSubjects(tuples) {
  const directIds = new Set();
  const setsByNs = new Map();

  for (const t of tuples) {
    if (t.subject_id) {
      directIds.add(t.subject_id);
    } else if (t.subject_set) {
      const { namespace, object, relation } = t.subject_set;
      if (!namespace || !object) continue;
      if (!setsByNs.has(namespace)) setsByNs.set(namespace, new Map());
      const key = `${object}#${relation || ""}`;
      setsByNs.get(namespace).set(key, { object, relation: relation || "" });
    }
  }

  const result = {};
  if (directIds.size > 0) {
    result[DIRECT_ID_NAMESPACE] = Array.from(directIds)
      .sort()
      .map((id) => ({ id }));
  }
  for (const [ns, map] of setsByNs) {
    result[ns] = Array.from(map.values()).sort((a, b) => {
      if (a.object !== b.object) return a.object.localeCompare(b.object);
      return a.relation.localeCompare(b.relation);
    });
  }
  return result;
}
