// What the /api proxy may forward to Ory. The proxy adds the project API key, which
// reaches every admin API of the project (identities, OAuth2 clients, ...), so only
// the requests the visualizer itself makes are let through. Used by server.js and
// the Vite dev proxy (app/vite.config.ts).

const READ_REQUESTS = new Set([
  "GET /namespaces",
  "GET /relation-tuples",
  "POST /relation-tuples/check",
  "POST /relation-tuples/check/openapi",
]);
const DELETE_REQUEST = "DELETE /admin/relation-tuples";

/** Request headers worth forwarding upstream (never cookies or the browser's auth). */
export const FORWARDED_REQUEST_HEADERS = ["accept", "content-type", "content-length"];

/**
 * The upstream path ("/relation-tuples?...") for an allowed /api request, or null.
 * Paths must match exactly after URL normalisation, so `//host`, dot segments and
 * encoded slashes never reach another endpoint.
 */
export function allowedOryPath(method, rawUrl, { allowDelete = false } = {}) {
  let url;
  try {
    url = new URL(rawUrl, "http://proxy.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "http://proxy.invalid" || !url.pathname.startsWith("/api/")) return null;
  const path = url.pathname.slice("/api".length);
  const request = `${method.toUpperCase()} ${path}`;
  if (READ_REQUESTS.has(request) || (allowDelete && request === DELETE_REQUEST)) {
    return path + url.search;
  }
  return null;
}

/** Host header check against DNS rebinding: only the hosts the app is served on. */
export function isAllowedHost(hostHeader, allowedHosts) {
  if (!hostHeader) return false;
  const hostname = hostHeader.replace(/:\d+$/, "").toLowerCase();
  return allowedHosts.includes(hostname);
}

/** Writes must come from the app's own origin; browsers always send Origin on them. */
export function isSameOriginWrite(method, originHeader, hostHeader) {
  if (method === "GET" || method === "HEAD" || !originHeader) return true;
  try {
    return new URL(originHeader).host === hostHeader;
  } catch {
    return false;
  }
}

export function parseAllowedHosts(value) {
  return (value || "localhost,127.0.0.1,[::1]")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}
