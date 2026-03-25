import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { URL } from "node:url";

const PORT = parseInt(process.env.PORT || "3000", 10);
const ORY_SDK_URL = process.env.ORY_SDK_URL || "";
const ORY_ACCESS_TOKEN =
  process.env.ORY_ACCESS_TOKEN || process.env.ORY_PROJECT_API_TOKEN || "";

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

function serveStatic(res, filePath) {
  return readFile(filePath)
    .then((data) => {
      const ext = extname(filePath);
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      res.end(data);
    })
    .catch(() => {
      // SPA fallback — serve index.html for any non-file route
      return readFile(join(STATIC_DIR, "index.html")).then((data) => {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(data);
      });
    });
}

function proxyToOry(req, res) {
  if (!ORY_SDK_URL) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "ORY_SDK_URL not configured" }));
    return;
  }

  const target = new URL(ORY_SDK_URL);
  // Strip /api prefix
  const path = req.url.replace(/^\/api/, "");

  const opts = {
    hostname: target.hostname,
    port: target.port || (target.protocol === "https:" ? 443 : 80),
    path,
    method: req.method,
    headers: {
      ...req.headers,
      host: target.host,
    },
  };

  if (ORY_ACCESS_TOKEN) {
    opts.headers["authorization"] = `Bearer ${ORY_ACCESS_TOKEN}`;
  }

  // Remove browser-specific headers that cause issues
  delete opts.headers["origin"];
  delete opts.headers["referer"];

  const transport = target.protocol === "https:" ? httpsRequest : httpRequest;

  const proxyReq = transport(opts, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", (err) => {
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
  return serveStatic(res, filePath);
});

server.listen(PORT, () => {
  console.log(`Permission Visualizer running on http://localhost:${PORT}`);
  if (ORY_SDK_URL) {
    console.log(`Proxying /api/* -> ${ORY_SDK_URL}`);
  } else {
    console.log("WARNING: ORY_SDK_URL not set — API proxy will return 502");
  }
});
