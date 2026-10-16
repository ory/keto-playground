// Integration tests for the Vite dev server's /api proxy (app/vite.config.ts),
// against a local stand-in for the Ory API that records what reaches it.
// Needs app/node_modules (npm install in app/). Run: node --test test/
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const APP_DIR = fileURLToPath(new URL("../app/", import.meta.url));
const VITE_BIN = fileURLToPath(new URL("../app/node_modules/vite/bin/vite.js", import.meta.url));

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function freePort() {
  const srv = createServer();
  return listen(srv).then((port) => new Promise((resolve) => srv.close(() => resolve(port))));
}

function send(port, { method = "GET", path, headers = {} }) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { hostname: "localhost", port, method, path, headers: { host: `localhost:${port}`, ...headers } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("vite dev /api proxy", () => {
  const received = [];
  let upstream;
  let vite;
  let port;

  before(async () => {
    upstream = createServer((req, res) => {
      received.push({ method: req.method, url: req.url, headers: req.headers });
      res.writeHead(200, { "content-type": "application/json", "set-cookie": "ory_session=upstream; Path=/" });
      res.end("{}");
    });
    const upstreamPort = await listen(upstream);
    port = await freePort();
    vite = spawn(process.execPath, [VITE_BIN, "--port", String(port), "--strictPort"], {
      cwd: APP_DIR,
      env: {
        PATH: process.env.PATH,
        NO_COLOR: "1",
        ORY_SDK_URL: `http://127.0.0.1:${upstreamPort}`,
        ORY_ACCESS_TOKEN: "test-project-key",
        ALLOW_TUPLE_DELETE: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`vite did not start\n${output}`)), 30_000);
      const onData = (chunk) => {
        output += String(chunk).replace(/\x1b\[[0-9;]*m/g, ""); // eslint-disable-line no-control-regex
        if (output.includes(`:${port}/`)) {
          clearTimeout(timer);
          resolve();
        }
      };
      vite.stdout.on("data", onData);
      vite.stderr.on("data", onData);
      vite.once("exit", (code) => reject(new Error(`vite exited with ${code}\n${output}`)));
    });
  });

  after(async () => {
    if (vite && vite.exitCode === null) {
      await new Promise((resolve) => {
        vite.once("exit", resolve);
        vite.kill("SIGTERM");
      });
    }
    await new Promise((resolve) => upstream?.close(resolve));
  });

  it("forwards allowed reads with the project key and without the browser's cookies", async () => {
    const res = await send(port, {
      path: "/api/relation-tuples?namespace=Folder",
      headers: { cookie: "ory_session=browser" },
    });
    assert.equal(res.status, 200);
    const got = received.at(-1);
    assert.equal(got.url, "/relation-tuples?namespace=Folder");
    assert.equal(got.headers.authorization, "Bearer test-project-key");
    assert.equal(got.headers.cookie, undefined);
    assert.equal(res.headers["set-cookie"], undefined);
  });

  for (const [path, forwarded] of [
    ["/api/admin/%2e%2e/namespaces", "/namespaces"],
    ["/api/admin/%2E%2E/relation-tuples?namespace=Folder", "/relation-tuples?namespace=Folder"],
    ["/api/./relation-tuples?namespace=Document&object=d", "/relation-tuples?namespace=Document&object=d"],
    ["/api/admin/../namespaces", "/namespaces"],
  ]) {
    it(`forwards ${path} as exactly the approved path ${forwarded}`, async () => {
      const before = received.length;
      const res = await send(port, { path });
      assert.equal(res.status, 200);
      assert.deepEqual(
        received.slice(before).map((r) => `${r.method} ${r.url}`),
        [`GET ${forwarded}`],
      );
    });
  }

  for (const [method, path, status] of [
    ["GET", "/api/admin/identities", 404],
    ["PATCH", "/api/admin/relation-tuples", 404],
    ["GET", "/api//admin/identities", 404],
    ["GET", "/api/../api/admin/identities", 404],
    ["DELETE", "/api/admin/relation-tuples?namespace=Document&object=d", 403],
  ]) {
    it(`refuses ${method} ${path} with ${status} without contacting Ory`, async () => {
      const before = received.length;
      const res = await send(port, { method, path });
      assert.equal(res.status, status);
      assert.ok(JSON.parse(res.body).error);
      assert.equal(received.length, before);
    });
  }
});
