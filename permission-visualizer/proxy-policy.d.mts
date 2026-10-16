// Types for proxy-policy.mjs (imported by app/vite.config.ts).
export declare const FORWARDED_REQUEST_HEADERS: string[];
export declare function allowedOryPath(
  method: string,
  rawUrl: string,
  options?: { allowDelete?: boolean },
): string | null;
export declare function isAllowedHost(hostHeader: string | undefined, allowedHosts: string[]): boolean;
export declare function isSameOriginWrite(
  method: string,
  originHeader: string | undefined,
  hostHeader: string | undefined,
): boolean;
export declare function parseAllowedHosts(value: string | undefined): string[];
