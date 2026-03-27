import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { URL } from "node:url";

const PORT = parseInt(process.env.PORT || "3000", 10);
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
      return readFile(join(STATIC_DIR, "index.html")).then((data) => {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(data);
      });
    });
}

function shouldProxy(hostname) {
  if (!NO_PROXY) return true;
  return !NO_PROXY.split(",")
    .map((h) => h.trim().toLowerCase())
    .some((h) => hostname.toLowerCase() === h || hostname.toLowerCase().endsWith(`.${h}`));
}

function proxyToOry(req, res) {
  if (!ORY_SDK_URL) {
    console.error(`!! ${req.method} ${req.url} — ORY_SDK_URL not configured`);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "ORY_SDK_URL not configured" }));
    return;
  }

  const target = new URL(ORY_SDK_URL);
  const path = req.url.replace(/^\/api/, "");
  const url = `${target.origin}${path}`;

  const headers = { ...req.headers, host: target.host };
  if (ORY_ACCESS_TOKEN) headers["authorization"] = `Bearer ${ORY_ACCESS_TOKEN}`;
  delete headers["origin"];
  delete headers["referer"];
  delete headers["connection"];
  delete headers["transfer-encoding"];

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
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", (err) => {
    console.error(`!! ${url} — ${err.message}`);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  });

  req.pipe(proxyReq);
}

const server = createServer(async (req, res) => {
  if (req.url.startsWith("/api")) {
    return proxyToOry(req, res);
  }

  const urlPath = new URL(req.url, "http://localhost").pathname;
  const filePath = join(STATIC_DIR, urlPath === "/" ? "index.html" : urlPath);
  return serveStatic(req, res, filePath);
});

server.listen(PORT, () => {
  console.log("--- Permission Visualizer ---");
  console.log(`Listening:     http://localhost:${PORT}`);
  console.log(`Static dir:    ${STATIC_DIR}`);
  console.log(`ORY_SDK_URL:   ${ORY_SDK_URL || "(not set — API proxy will return 502)"}`);
  console.log(`Access token:  ${ORY_ACCESS_TOKEN ? ORY_ACCESS_TOKEN.slice(0, 12) + "..." : "(not set)"}`);
  console.log(`HTTPS_PROXY:   ${HTTPS_PROXY || "(not set — direct connections)"}`);
  if (HTTPS_PROXY) console.log(`NO_PROXY:      ${NO_PROXY || "(not set)"}`);
  console.log("-----------------------------");
});
