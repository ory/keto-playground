// Unit tests for proxy-policy.mjs. Run: node --test test/
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  allowedOryPath,
  isAllowedHost,
  isSameOriginWrite,
  parseAllowedHosts,
} from "../proxy-policy.mjs";

describe("allowedOryPath", () => {
  const allowed = [
    ["GET", "/api/namespaces", "/namespaces"],
    ["get", "/api/namespaces", "/namespaces"],
    ["GET", "/api/relation-tuples?namespace=Folder&page_size=500", "/relation-tuples?namespace=Folder&page_size=500"],
    ["POST", "/api/relation-tuples/check", "/relation-tuples/check"],
    ["POST", "/api/relation-tuples/check/openapi?max-depth=5", "/relation-tuples/check/openapi?max-depth=5"],
    // Dot segments are resolved before matching, and the resolved path is what is forwarded.
    ["GET", "/api/admin/../namespaces", "/namespaces"],
    ["GET", "/api/./relation-tuples", "/relation-tuples"],
  ];
  for (const [method, url, expected] of allowed) {
    it(`forwards ${method} ${url} as ${expected}`, () => {
      assert.equal(allowedOryPath(method, url), expected);
    });
  }

  const refused = [
    ["GET", "/api/admin/identities"],
    ["GET", "/api/admin/relation-tuples"],
    ["PUT", "/api/admin/relation-tuples"],
    ["PATCH", "/api/admin/relation-tuples"],
    ["POST", "/api/admin/relation-tuples"],
    ["DELETE", "/api/admin/relation-tuples?namespace=Document"],
    ["POST", "/api/namespaces"],
    ["GET", "/api/relation-tuples/check"],
    ["GET", "/api/relation-tuples/expand"],
    ["GET", "/api/namespaces/"],
    ["GET", "/api"],
    ["GET", "/api/"],
    ["GET", "/apinamespaces"],
    ["GET", "/namespaces"],
    ["GET", "/api//admin/identities"],
    ["GET", "/api/../api/admin/identities"],
    ["GET", "/api/namespaces/../admin/identities"],
    ["GET", "/api/%2e%2e/admin/identities"],
    ["GET", "/api/relation-tuples%2fcheck"],
    ["GET", "/api%2fnamespaces"],
    ["GET", "/api/relation-tuples/..%2f..%2fadmin%2fidentities"],
    ["GET", "//evil.example/api/namespaces"],
    ["GET", "http://evil.example/api/namespaces"],
    ["GET", "/api//evil.example/namespaces"],
  ];
  for (const [method, url] of refused) {
    it(`refuses ${method} ${url}`, () => {
      assert.equal(allowedOryPath(method, url), null);
    });
  }

  it("forwards tuple deletes only when deletion is enabled", () => {
    const url = "/api/admin/relation-tuples?namespace=Document&object=doc-1";
    assert.equal(allowedOryPath("DELETE", url), null);
    assert.equal(allowedOryPath("DELETE", url, { allowDelete: false }), null);
    assert.equal(allowedOryPath("DELETE", url, { allowDelete: true }), "/admin/relation-tuples?namespace=Document&object=doc-1");
  });

  it("enabling deletes does not open other admin APIs", () => {
    for (const [method, url] of [
      ["DELETE", "/api/admin/identities/abc"],
      ["PUT", "/api/admin/relation-tuples"],
      ["PATCH", "/api/admin/relation-tuples"],
      ["DELETE", "/api/relation-tuples"],
    ]) {
      assert.equal(allowedOryPath(method, url, { allowDelete: true }), null, `${method} ${url}`);
    }
  });
});

describe("isAllowedHost", () => {
  const hosts = parseAllowedHosts(undefined);
  for (const host of ["localhost", "localhost:3000", "LOCALHOST:5173", "127.0.0.1:3000", "[::1]:3000"]) {
    it(`accepts ${host}`, () => assert.equal(isAllowedHost(host, hosts), true));
  }
  for (const host of [undefined, "", "evil.example", "localhost.evil.example", "evil.example:3000", "127.0.0.2:3000"]) {
    it(`rejects ${JSON.stringify(host)}`, () => assert.equal(isAllowedHost(host, hosts), false));
  }
  it("accepts configured hosts only", () => {
    const custom = parseAllowedHosts("viz.example.com");
    assert.equal(isAllowedHost("viz.example.com:443", custom), true);
    assert.equal(isAllowedHost("localhost:3000", custom), false);
  });
});

describe("isSameOriginWrite", () => {
  it("lets reads through whatever their Origin", () => {
    assert.equal(isSameOriginWrite("GET", "http://evil.example", "localhost:3000"), true);
    assert.equal(isSameOriginWrite("HEAD", "http://evil.example", "localhost:3000"), true);
  });
  it("accepts writes from the app's own origin", () => {
    assert.equal(isSameOriginWrite("DELETE", "http://localhost:3000", "localhost:3000"), true);
    assert.equal(isSameOriginWrite("POST", "http://localhost:3000", "localhost:3000"), true);
  });
  it("accepts writes without an Origin header (non-browser clients)", () => {
    assert.equal(isSameOriginWrite("DELETE", undefined, "localhost:3000"), true);
  });
  for (const origin of ["http://evil.example", "http://localhost:3001", "http://localhost", "null", "not a url"]) {
    it(`refuses writes from Origin ${origin}`, () => {
      assert.equal(isSameOriginWrite("DELETE", origin, "localhost:3000"), false);
    });
  }
});

describe("parseAllowedHosts", () => {
  it("defaults to the loopback names", () => {
    assert.deepEqual(parseAllowedHosts(undefined), ["localhost", "127.0.0.1", "[::1]"]);
    assert.deepEqual(parseAllowedHosts(""), ["localhost", "127.0.0.1", "[::1]"]);
  });
  it("trims, lowercases and drops empty entries", () => {
    assert.deepEqual(parseAllowedHosts(" Viz.Example.com , ,localhost "), ["viz.example.com", "localhost"]);
  });
});
