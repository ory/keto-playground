import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { URL } from "node:url";

import {
  FORWARDED_REQUEST_HEADERS,
  allowedOryPath,
  isAllowedHost,
  isSameOriginWrite,
  parseAllowedHosts,
} from "./proxy-policy.mjs";

const PORT = parseInt(process.env.PORT || "3000", 10);
// Loopback by default; the container image sets HOST=0.0.0.0 and the Makefile
// publishes it on 127.0.0.1 only. Never expose this without an auth layer in front.
const HOST = process.env.HOST || "127.0.0.1";
const ALLOWED_HOSTS = parseAllowedHosts(process.env.ALLOWED_HOSTS);
const ALLOW_TUPLE_DELETE = process.env.ALLOW_TUPLE_DELETE === "1";
const ORY_SDK_URL = process.env.ORY_SDK_URL || "";
const ORY_ACCESS_TOKEN =
  process.env.ORY_ACCESS_TOKEN || process.env.ORY_PROJECT_API_TOKEN || "";
const HTTPS_PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || "";
const NO_PROXY = process.env.NO_PROXY || process.env.no_proxy || "";

// Configure forward proxy agent (same approach as the WealthCo B2B app)
let proxyAgent;
if (HTTPS_PROXY) {
  const { HttpsProxyAgent } = await import("https-proxy-agent");
  proxyAgent = new HttpsProxyAgent(HTTPS_PROXY);
}

const STATIC_DIR = join(import.meta.dirname, "dist");

const MIME = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

function serveStatic(req, res, filePath) {
  return readFile(filePath)
    .then((data) => {
      const ext = extname(filePath);
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      res.end(data);
    })
    .catch(() => {
      console.log(`static 404 ${filePath} — serving SPA fallback`);
      return readFile(join(STATIC_DIR, "index.html")).then(
        (data) => {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(data);
        },
        () => {
          // No build yet (run `make build`): answer instead of crashing the server.
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not found");
        },
      );
    });
}

function shouldProxy(hostname) {
  if (!NO_PROXY) return true;
  return !NO_PROXY.split(",")
    .map((h) => h.trim().toLowerCase())
    .some((h) => hostname.toLowerCase() === h || hostname.toLowerCase().endsWith(`.${h}`));
}

function reject(res, status, error) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error }));
}

function proxyToOry(req, res) {
  const path = allowedOryPath(req.method, req.url, { allowDelete: ALLOW_TUPLE_DELETE });
  if (!path) {
    console.warn(`!! refused ${req.method} ${req.url}`);
    const isDelete = req.method === "DELETE";
    return reject(res, isDelete ? 403 : 404, isDelete
      ? "Tuple deletion is disabled (set ALLOW_TUPLE_DELETE=1 to enable)"
      : "Not an allowed Ory API request");
  }
  if (!isSameOriginWrite(req.method, req.headers.origin, req.headers.host)) {
    return reject(res, 403, "Cross-origin request refused");
  }
  if (!ORY_SDK_URL) {
    console.error(`!! ${req.method} ${req.url} — ORY_SDK_URL not configured`);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "ORY_SDK_URL not configured" }));
    return;
  }

  const target = new URL(ORY_SDK_URL);
  const url = `${target.origin}${path}`;

  const headers = { host: target.host };
  for (const name of FORWARDED_REQUEST_HEADERS) {
    if (req.headers[name]) headers[name] = req.headers[name];
  }
  if (ORY_ACCESS_TOKEN) headers["authorization"] = `Bearer ${ORY_ACCESS_TOKEN}`;

  const useProxy = proxyAgent && shouldProxy(target.hostname);
  const isHttps = target.protocol === "https:";
  const via = useProxy ? `via ${HTTPS_PROXY}` : "direct";

  console.log(`-> ${req.method} ${url} (${via})`);

  const transport = isHttps ? httpsRequest : httpRequest;
  const opts = {
    hostname: target.hostname,
    port: target.port || (isHttps ? 443 : 80),
    path,
    method: req.method,
    headers,
  };

  if (useProxy) {
    opts.agent = proxyAgent;
  }

  const proxyReq = transport(opts, (proxyRes) => {
    console.log(`<- ${proxyRes.statusCode} ${url}`);
    const { "set-cookie": _dropped, ...responseHeaders } = proxyRes.headers;
    res.writeHead(proxyRes.statusCode, responseHeaders);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", (err) => {
    console.error(`!! ${url} — ${err.message}`);
    reject(res, 502, "Upstream request failed");
  });

  req.pipe(proxyReq);
}

const server = createServer(async (req, res) => {
  if (!isAllowedHost(req.headers.host, ALLOWED_HOSTS)) {
    return reject(res, 421, "Unexpected Host header (set ALLOWED_HOSTS)");
  }
  if (req.url === "/api" || req.url.startsWith("/api/") || req.url.startsWith("/api?")) {
    return proxyToOry(req, res);
  }

  const urlPath = new URL(req.url, "http://localhost").pathname;
  const filePath = join(STATIC_DIR, urlPath === "/" ? "index.html" : urlPath);
  return serveStatic(req, res, filePath);
});

server.listen(PORT, HOST, () => {
  console.log("--- Permission Visualizer ---");
  console.log(`Listening:     http://${HOST}:${PORT}`);
  console.log(`Allowed hosts: ${ALLOWED_HOSTS.join(", ")}`);
  console.log(`Tuple delete:  ${ALLOW_TUPLE_DELETE ? "enabled" : "disabled (ALLOW_TUPLE_DELETE=1 to enable)"}`);
  console.log(`Static dir:    ${STATIC_DIR}`);
  console.log(`ORY_SDK_URL:   ${ORY_SDK_URL || "(not set — API proxy will return 502)"}`);
  console.log(`Access token:  ${ORY_ACCESS_TOKEN ? "set" : "(not set)"}`);
  console.log(`HTTPS_PROXY:   ${HTTPS_PROXY || "(not set — direct connections)"}`);
  if (HTTPS_PROXY) console.log(`NO_PROXY:      ${NO_PROXY || "(not set)"}`);
  console.log("-----------------------------");
});
