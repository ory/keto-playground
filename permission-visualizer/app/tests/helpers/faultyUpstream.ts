/**
 * A pass-through proxy in front of the real Keto that makes permission checks on
 * chosen objects fail: answered with 500, or never answered (to exercise the
 * client's check timeout). Every other request reaches Keto unchanged. Point a
 * dev server's ORY_SDK_URL at it.
 */
import { createServer, request as httpRequest } from "node:http";
import type { IncomingMessage, Server } from "node:http";

export interface FaultyUpstream {
  url: string;
  close(): Promise<void>;
}

export interface CheckFaults {
  /** Objects whose checks get a 500 from the proxy. */
  error: string[];
  /** Objects whose checks are never answered. */
  hang: string[];
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export async function startFaultyUpstream(target: string, faults: CheckFaults): Promise<FaultyUpstream> {
  const upstream = new URL(target);
  const server: Server = createServer(async (req, res) => {
    const body = await readBody(req);
    if (req.method === "POST" && req.url?.startsWith("/relation-tuples/check")) {
      const { object } = JSON.parse(body.toString() || "{}") as { object?: string };
      if (object && faults.hang.includes(object)) return;
      if (object && faults.error.includes(object)) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: 500, message: "injected check failure" } }));
        return;
      }
    }
    const forward = httpRequest(
      {
        hostname: upstream.hostname,
        port: upstream.port,
        method: req.method,
        path: req.url,
        headers: { ...req.headers, host: upstream.host },
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      },
    );
    forward.on("error", () => {
      res.writeHead(502);
      res.end();
    });
    forward.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
