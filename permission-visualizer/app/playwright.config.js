import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:5173",
  },
  webServer: {
    command: "npm run dev -- --port 5173",
    port: 5173,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
