/**
 * Direct access to the Keto behind ORY_SDK_URL, for creating and removing test
 * data. The app's /api proxy only forwards the reads (and deletes) the UI makes,
 * so tuple writes go straight to Keto's admin API.
 */
import { expect } from "@playwright/test";
import type { APIRequestContext, APIResponse } from "@playwright/test";

export interface TestTuple {
  namespace: string;
  object: string;
  relation: string;
  subject_id?: string;
  subject_set?: { namespace: string; object: string; relation: string };
}

export const LOCAL_KETO_NAMESPACES = ["ClaudeClass", "Document", "Folder", "Group", "Role", "User"];

function ketoUrl(path: string): string {
  const base = process.env.ORY_SDK_URL;
  if (!base) throw new Error("ORY_SDK_URL is not set: run the live tests against local-keto (see local-keto/up.sh)");
  return `${base.replace(/\/$/, "")}${path}`;
}

function authHeaders(): Record<string, string> {
  const token = process.env.ORY_ACCESS_TOKEN || process.env.ORY_PROJECT_API_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Fail fast unless the /api proxy at baseURL serves the local-keto OPL. */
export async function expectLocalKeto(request: APIRequestContext) {
  const res = await request.get("/api/namespaces");
  const names = res.ok() ? ((await res.json()).namespaces as { name: string }[]).map((n) => n.name) : [];
  if (!LOCAL_KETO_NAMESPACES.every((n) => names.includes(n))) {
    throw new Error(
      "these tests need the local Keto from local-keto/up.sh behind the dev server's ORY_SDK_URL " +
        `(got namespaces: ${JSON.stringify(names)}, status ${res.status()})`,
    );
  }
}

async function expectStatus(res: APIResponse, status: number) {
  expect(res.status(), await res.text()).toBe(status);
}

export async function putTuples(request: APIRequestContext, tuples: TestTuple[]) {
  for (const t of tuples) {
    await expectStatus(await request.put(ketoUrl("/admin/relation-tuples"), { data: t, headers: authHeaders() }), 201);
  }
}

/**
 * Insert or delete many tuples in one transaction. Also the way to write tuples
 * whose names are too long for a PUT: Keto echoes those in a Location header the
 * local router refuses to pass on.
 */
export async function patchTuples(request: APIRequestContext, action: "insert" | "delete", tuples: TestTuple[]) {
  const body = tuples.map((relation_tuple) => ({ action, relation_tuple }));
  await expectStatus(await request.patch(ketoUrl("/admin/relation-tuples"), { data: body, headers: authHeaders() }), 204);
}

/** Delete every tuple on an object (no-op when there are none). */
export async function deleteObjectTuples(request: APIRequestContext, namespace: string, object: string) {
  const query = new URLSearchParams({ namespace, object });
  await expectStatus(await request.delete(ketoUrl(`/admin/relation-tuples?${query}`), { headers: authHeaders() }), 204);
}

export async function tuplesOnObject(request: APIRequestContext, namespace: string, object: string) {
  const query = new URLSearchParams({ namespace, object });
  const res = await request.get(ketoUrl(`/relation-tuples?${query}`), { headers: authHeaders() });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).relation_tuples as TestTuple[];
}

/** Unique per run, so reruns and parallel workers never share objects. */
export function runId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
