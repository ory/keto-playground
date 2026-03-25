import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig(({ mode }) => {
  // Load .env from project root (one level up from app/)
  const env = loadEnv(mode, path.resolve(__dirname, ".."), "");

  const oryToken = env.ORY_ACCESS_TOKEN || env.ORY_PROJECT_API_TOKEN || "";
  const oryApiUrl = env.ORY_SDK_URL || env.ORY_TUNNEL_URL || "http://localhost:4000";

  return {
    plugins: [react()],
    server: {
      proxy: {
        "/api": {
          target: oryApiUrl,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api/, ""),
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              if (oryToken) {
                proxyReq.setHeader(
                  "Authorization",
                  `Bearer ${oryToken}`
                );
              }
            });
          },
        },
      },
    },
  };
});
