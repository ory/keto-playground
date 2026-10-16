import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

import { allowedOryPath, isSameOriginWrite } from "../proxy-policy.mjs";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  // Load .env from project root (one level up from app/)
  const env = loadEnv(mode, path.resolve(dirname, ".."), "");

  const oryToken = env.ORY_ACCESS_TOKEN || env.ORY_PROJECT_API_TOKEN || "";
  const oryApiUrl = env.ORY_SDK_URL || env.ORY_TUNNEL_URL || "http://localhost:4000";
  const allowDelete = env.ALLOW_TUPLE_DELETE === "1";

  return {
    plugins: [react()],
    server: {
      proxy: {
        "/api": {
          target: oryApiUrl,
          changeOrigin: true,
          // The proxy adds the project API key, which reaches every admin API of the
          // project: only let through the requests the visualizer makes (see proxy-policy.mjs).
          bypass: (req, res) => {
            const method = req.method ?? "GET";
            const allowedPath = allowedOryPath(method, req.url ?? "", { allowDelete });
            if (allowedPath !== null && isSameOriginWrite(method, req.headers.origin, req.headers.host)) {
              // Forward the normalised path the policy approved, not the raw URL.
              req.url = `/api${allowedPath}`;
              return undefined;
            }
            if (!res) return undefined;
            const disabledDelete = method === "DELETE" && !allowDelete;
            res.writeHead(disabledDelete ? 403 : 404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              error: disabledDelete
                ? "Tuple deletion is disabled (set ALLOW_TUPLE_DELETE=1 to enable)"
                : "Not an allowed Ory API request",
            }));
            return req.url;
          },
          rewrite: (p) => p.replace(/^\/api/, ""),
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              proxyReq.removeHeader("cookie");
              if (oryToken) {
                proxyReq.setHeader("Authorization", `Bearer ${oryToken}`);
              }
            });
            proxy.on("proxyRes", (proxyRes) => {
              delete proxyRes.headers["set-cookie"];
            });
          },
        },
      },
    },
  };
});
