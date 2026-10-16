/**
 * Start an extra Vite dev server with its own environment, for tests that need
 * the /api proxy configured differently from the shared server on :5173
 * (tuple deletion disabled, Keto unreachable, ...).
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const APP_DIR = fileURLToPath(new URL("../..", import.meta.url));
const VITE_BIN = fileURLToPath(new URL("../../node_modules/vite/bin/vite.js", import.meta.url));

export interface DevServer {
  url: string;
  stop(): Promise<void>;
}

/** A TCP port nothing listens on right now. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Start `vite` on a free port. Values in `env` override the test process's
 * environment; Vite's loadEnv prefers process.env over .env files, so an empty
 * string turns a setting off.
 */
export async function startDevServer(env: Record<string, string>): Promise<DevServer> {
  const port = await freePort();
  const child = spawn(process.execPath, [VITE_BIN, "--port", String(port), "--strictPort"], {
    cwd: APP_DIR,
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`vite did not start on :${port}\n${output}`)), 30_000);
    const onData = (chunk: Buffer) => {
      // eslint-disable-next-line no-control-regex
      output += chunk.toString().replace(/\x1b\[[0-9;]*m/g, "");
      if (output.includes(`:${port}/`)) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`vite exited with ${code}\n${output}`));
    });
  });
  return {
    url: `http://localhost:${port}`,
    stop: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once("exit", () => resolve());
        child.kill("SIGTERM");
      }),
  };
}
