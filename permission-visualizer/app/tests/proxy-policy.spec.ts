/**
 * API tests for the dev server's /api proxy policy (../proxy-policy.mjs wired
 * into vite.config.ts): only the reads the visualizer makes reach Ory, tuple
 * deletes only with ALLOW_TUPLE_DELETE=1, everything else is refused before it
 * leaves the proxy.
 *
 * Needs the local Keto (local-keto/up.sh) behind ORY_SDK_URL; the delete tests
 * start their own dev servers with deletion enabled and disabled.
 */
import { request as httpRequest } from "node:http";

import { test, expect } from "@playwright/test";

import { startDevServer } from "./helpers/devServer";
import type { DevServer } from "./helpers/devServer";
import { deleteObjectTuples, expectLocalKeto, putTuples, runId, tuplesOnObject } from "./helpers/keto";

/** Send a request with the path exactly as given (no URL normalisation). */
function rawRequest(baseUrl: string, method: string, path: string) {
  const { hostname, port } = new URL(baseUrl);
  return new Promise<{ status: number; contentType: string; body: string }>((resolve, reject) => {
    const req = httpRequest({ hostname, port, method, path, headers: { host: `localhost:${port}` } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, contentType: String(res.headers["content-type"] ?? ""), body }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

const BASE_URL = "http://localhost:5173";

// The refusals are decided before the proxy contacts Ory, so they need no Keto.
test.describe("/api proxy policy (dev server)", () => {
  test("forwards the reads the visualizer makes", async ({ request }) => {
    await expectLocalKeto(request);
    const namespaces = await request.get("/api/namespaces");
    expect(namespaces.status()).toBe(200);
    expect(((await namespaces.json()).namespaces as { name: string }[]).map((n) => n.name)).toContain("Folder");

    const tuples = await request.get("/api/relation-tuples?namespace=Folder&object=f1.1");
    expect(tuples.status()).toBe(200);
    expect((await tuples.json()).relation_tuples).toContainEqual({
      namespace: "Folder",
      object: "f1.1",
      relation: "parents",
      subject_set: { namespace: "Folder", object: "root", relation: "" },
    });

    const check = { namespace: "Folder", object: "f1.1", relation: "parents", subject_set: { namespace: "Folder", object: "root", relation: "" } };
    for (const path of ["/api/relation-tuples/check", "/api/relation-tuples/check/openapi"]) {
      const res = await request.post(path, { data: check });
      expect(res.status(), path).toBe(200);
      expect(await res.json(), path).toEqual({ allowed: true });
    }
  });

  for (const [method, path] of [
    ["GET", "/api/admin/identities"],
    ["GET", "/api/admin/relation-tuples"],
    ["PUT", "/api/admin/relation-tuples"],
    ["PATCH", "/api/admin/relation-tuples"],
    ["POST", "/api/admin/relation-tuples"],
    ["GET", "/api/relation-tuples/expand?namespace=Folder&object=root&relation=owners"],
    ["GET", "/api/health/ready"],
    ["GET", "/api"],
  ] as const) {
    test(`refuses ${method} ${path} with 404`, async ({ request }) => {
      const res = await request.fetch(path, { method, data: method === "GET" ? undefined : {} });
      expect(res.status()).toBe(404);
      expect(await res.json()).toHaveProperty("error");
    });
  }

  for (const path of [
    "/api//admin/identities",
    "/api/../api/admin/identities",
    "/api/%2e%2e/admin/identities",
    "/api/namespaces/../admin/identities",
    "/api/relation-tuples/..%2f..%2fadmin%2fidentities",
    "/api/namespaces%2f..%2fadmin%2fidentities",
    "/api//localhost:4455/namespaces",
    "/api//evil.example/namespaces",
  ]) {
    test(`refuses the path trick ${path}`, async () => {
      const res = await rawRequest(BASE_URL, "GET", path);
      expect(res.status).toBe(404);
      expect(JSON.parse(res.body)).toEqual({ error: "Not an allowed Ory API request" });
    });
  }

  test("a protocol-relative URL is not proxied to another host", async () => {
    const res = await rawRequest(BASE_URL, "GET", "//evil.example/api/namespaces");
    expect(res.contentType).toContain("text/html");
    expect(res.body).not.toContain('"namespaces"');
  });
});

test.describe("/api tuple deletes", () => {
  const run = runId();
  let enabled: DevServer;
  let disabled: DevServer;

  test.beforeAll(async ({ request }) => {
    await expectLocalKeto(request);
    const keto = { ORY_SDK_URL: process.env.ORY_SDK_URL ?? "", ORY_ACCESS_TOKEN: process.env.ORY_ACCESS_TOKEN ?? "" };
    [enabled, disabled] = await Promise.all([
      startDevServer({ ...keto, ALLOW_TUPLE_DELETE: "1" }),
      startDevServer({ ...keto, ALLOW_TUPLE_DELETE: "" }),
    ]);
  });

  test.afterAll(async () => {
    await Promise.all([enabled?.stop(), disabled?.stop()]);
  });

  async function seed(request: Parameters<typeof putTuples>[0], object: string) {
    await putTuples(request, [
      { namespace: "Document", object, relation: "viewers", subject_set: { namespace: "User", object: `pw-${run}`, relation: "" } },
    ]);
    return `namespace=Document&object=${encodeURIComponent(object)}`;
  }

  test("are refused with 403 when ALLOW_TUPLE_DELETE is not set", async ({ request }) => {
    const object = `pw-del-off-${run}`;
    const query = await seed(request, object);
    try {
      const res = await request.delete(`${disabled.url}/api/admin/relation-tuples?${query}`);
      expect(res.status()).toBe(403);
      expect((await res.json()).error).toContain("ALLOW_TUPLE_DELETE");
      expect(await tuplesOnObject(request, "Document", object)).toHaveLength(1);
    } finally {
      await deleteObjectTuples(request, "Document", object);
    }
  });

  test("are forwarded when ALLOW_TUPLE_DELETE=1", async ({ request }) => {
    const object = `pw-del-on-${run}`;
    const query = await seed(request, object);
    try {
      const res = await request.delete(`${enabled.url}/api/admin/relation-tuples?${query}`);
      expect(res.status()).toBe(204);
      expect(await tuplesOnObject(request, "Document", object)).toEqual([]);
    } finally {
      await deleteObjectTuples(request, "Document", object);
    }
  });

  test("of anything but relation tuples are refused even when enabled", async ({ request }) => {
    for (const path of ["/api/namespaces", "/api/admin/identities/some-id", "/api/relation-tuples"]) {
      const res = await request.delete(`${enabled.url}${path}`);
      expect(res.status(), path).toBe(404);
    }
  });

  test("from another origin are refused even when enabled", async ({ request }) => {
    const object = `pw-del-xorigin-${run}`;
    const query = await seed(request, object);
    try {
      const res = await request.delete(`${enabled.url}/api/admin/relation-tuples?${query}`, {
        headers: { Origin: "http://evil.example" },
      });
      expect(res.status()).toBe(404);
      expect(await tuplesOnObject(request, "Document", object)).toHaveLength(1);
    } finally {
      await deleteObjectTuples(request, "Document", object);
    }
  });
});
