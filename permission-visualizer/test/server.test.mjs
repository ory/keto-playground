// Integration tests for server.js's /api proxy. The upstream Ory API is a local
// HTTP server that records what reaches it, so the tests can assert what the
// proxy forwards, strips and refuses. Run: node --test test/
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const SERVER_JS = fileURLToPath(new URL("../server.js", import.meta.url));

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function freePort() {
  const srv = createServer();
  return listen(srv).then((port) => new Promise((resolve) => srv.close(() => resolve(port))));
}

/** A stand-in for the Ory API that records every request it receives. */
async function startUpstream() {
  const received = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ method: req.method, url: req.url, headers: req.headers, body });
      res.writeHead(200, { "content-type": "application/json", "set-cookie": "ory_session=upstream; Path=/" });
      res.end(JSON.stringify({ ok: true, url: req.url }));
    });
  });
  const port = await listen(server);
  return { url: `http://127.0.0.1:${port}`, received, close: () => new Promise((r) => server.close(r)) };
}

async function startServer(env) {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER_JS], {
    env: { PATH: process.env.PATH, PORT: String(port), ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server.js did not start\n${output}`)), 10_000);
    const onData = (chunk) => {
      output += chunk;
      if (output.includes("-----------------------------\n")) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`server.js exited with ${code}\n${output}`));
    });
  });
  return {
    port,
    child,
    stop: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once("exit", resolve);
        child.kill("SIGTERM");
      }),
  };
}

/** Send a request with the exact path and headers given. */
function send(port, { method = "GET", path, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { hostname: "127.0.0.1", port, method, path, headers: { host: `localhost:${port}`, ...headers } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

describe("server.js /api proxy", () => {
  let upstream;
  let server;
  let deleting;

  before(async () => {
    upstream = await startUpstream();
    const env = { ORY_SDK_URL: upstream.url, ORY_ACCESS_TOKEN: "test-project-key" };
    [server, deleting] = await Promise.all([
      startServer(env),
      startServer({ ...env, ALLOW_TUPLE_DELETE: "1" }),
    ]);
  });

  after(async () => {
    await Promise.all([server?.stop(), deleting?.stop()]);
    await upstream?.close();
  });

  function lastReceived() {
    return upstream.received.at(-1);
  }

  it("forwards an allowed read with the project key, without the browser's cookies or auth", async () => {
    const res = await send(server.port, {
      path: "/api/relation-tuples?namespace=Folder&page_size=2",
      headers: { cookie: "ory_session=browser", authorization: "Bearer browser-token", accept: "application/json" },
    });
    assert.equal(res.status, 200);
    const got = lastReceived();
    assert.equal(got.method, "GET");
    assert.equal(got.url, "/relation-tuples?namespace=Folder&page_size=2");
    assert.equal(got.headers.authorization, "Bearer test-project-key");
    assert.equal(got.headers.cookie, undefined);
    assert.equal(got.headers.accept, "application/json");
  });

  it("strips Set-Cookie from upstream responses", async () => {
    const res = await send(server.port, { path: "/api/namespaces" });
    assert.equal(res.status, 200);
    assert.equal(res.headers["set-cookie"], undefined);
    assert.deepEqual(JSON.parse(res.body), { ok: true, url: "/namespaces" });
  });

  it("forwards a same-origin permission check with its body", async () => {
    const body = JSON.stringify({ namespace: "Folder", object: "root", relation: "view", subject_id: "u" });
    const res = await send(server.port, {
      method: "POST",
      path: "/api/relation-tuples/check",
      headers: { origin: `http://localhost:${server.port}`, "content-type": "application/json", "content-length": Buffer.byteLength(body) },
      body,
    });
    assert.equal(res.status, 200);
    assert.equal(lastReceived().url, "/relation-tuples/check");
    assert.equal(lastReceived().body, body);
  });

  for (const [method, path] of [
    ["GET", "/api/admin/identities"],
    ["PATCH", "/api/admin/relation-tuples"],
    ["PUT", "/api/admin/relation-tuples"],
    ["GET", "/api//admin/identities"],
    ["GET", "/api/../api/admin/identities"],
    ["GET", "/api/%2e%2e/admin/identities"],
    ["GET", "/api//evil.example/namespaces"],
    ["GET", "/api"],
  ]) {
    it(`refuses ${method} ${path} with 404 without contacting Ory`, async () => {
      const before = upstream.received.length;
      const res = await send(server.port, { method, path });
      assert.equal(res.status, 404);
      assert.deepEqual(JSON.parse(res.body), { error: "Not an allowed Ory API request" });
      assert.equal(upstream.received.length, before);
    });
  }

  it("refuses tuple deletes with 403 unless ALLOW_TUPLE_DELETE=1", async () => {
    const before = upstream.received.length;
    const res = await send(server.port, { method: "DELETE", path: "/api/admin/relation-tuples?namespace=Document&object=d" });
    assert.equal(res.status, 403);
    assert.match(JSON.parse(res.body).error, /ALLOW_TUPLE_DELETE=1/);
    assert.equal(upstream.received.length, before);
  });

  it("forwards same-origin tuple deletes when ALLOW_TUPLE_DELETE=1", async () => {
    const res = await send(deleting.port, {
      method: "DELETE",
      path: "/api/admin/relation-tuples?namespace=Document&object=d",
      headers: { origin: `http://localhost:${deleting.port}` },
    });
    assert.equal(res.status, 200);
    assert.equal(lastReceived().method, "DELETE");
    assert.equal(lastReceived().url, "/admin/relation-tuples?namespace=Document&object=d");
  });

  it("refuses cross-origin writes with 403", async () => {
    const before = upstream.received.length;
    for (const [method, path] of [
      ["DELETE", "/api/admin/relation-tuples?namespace=Document&object=d"],
      ["POST", "/api/relation-tuples/check"],
    ]) {
      const res = await send(deleting.port, { method, path, headers: { origin: "http://evil.example" } });
      assert.equal(res.status, 403, `${method} ${path}`);
    }
    assert.equal(upstream.received.length, before);
  });

  it("refuses requests for an unexpected Host with 421 (DNS rebinding)", async () => {
    const before = upstream.received.length;
    for (const path of ["/api/namespaces", "/"]) {
      const res = await send(server.port, { path, headers: { host: "evil.example" } });
      assert.equal(res.status, 421, path);
    }
    assert.equal(upstream.received.length, before);
  });

  it("answers 404 instead of crashing when dist/ has not been built", async () => {
    const res = await send(server.port, { path: "/" });
    assert.equal(res.status, 404);
    assert.equal(server.child.exitCode, null);
    assert.equal((await send(server.port, { path: "/api/namespaces" })).status, 200);
  });
});

describe("server.js upstream failures", () => {
  it("answers 502 when Ory is unreachable", async () => {
    const server = await startServer({ ORY_SDK_URL: `http://127.0.0.1:${await freePort()}`, ORY_ACCESS_TOKEN: "k" });
    try {
      const res = await send(server.port, { path: "/api/namespaces" });
      assert.equal(res.status, 502);
      assert.deepEqual(JSON.parse(res.body), { error: "Upstream request failed" });
    } finally {
      await server.stop();
    }
  });

  it("answers 502 when ORY_SDK_URL is not configured", async () => {
    const server = await startServer({});
    try {
      const res = await send(server.port, { path: "/api/namespaces" });
      assert.equal(res.status, 502);
      assert.deepEqual(JSON.parse(res.body), { error: "ORY_SDK_URL not configured" });
    } finally {
      await server.stop();
    }
  });
});
