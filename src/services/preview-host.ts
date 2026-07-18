function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Matches "preview-<slug>.<PREVIEW_BASE_HOST>" — anchored on the literal
// "preview-" prefix and the exact configured base host (including its
// port, if the operator's PREVIEW_BASE_HOST includes one — see
// .env.example), so neither the dashboard's own Host header nor an
// unrelated one can ever match.
//
// This is deliberately NOT used as a Fastify route `constraints: { host }`
// value. find-my-way's "host" constraint strategy sets
// `mustMatchWhenDerived: false` (see its own strategies/accept-host.js), so
// an *unconstrained* route registered at the same path (e.g. rootRoute's
// exact "/") always remains a valid match candidate regardless of the
// derived Host header, and find-my-way never backtracks away from a node
// whose handler search already succeeded to try a constrained wildcard
// instead — verified by reading find-my-way's handler-storage.js and
// reproduced empirically (a constrained wildcard "*" route never won
// against rootRoute's exact "/", no matter the Host header). Since the
// preview's own root document is exactly "/", that's not a tolerable gap.
// preview-proxy.ts instead checks the Host header in a global `onRequest`
// hook, ahead of Fastify's own path-based routing entirely.
export function buildPreviewHostPattern(baseHost: string): RegExp {
  return new RegExp(`^preview-([a-z0-9-]+)\\.${escapeRegExp(baseHost)}$`, "i");
}

export function extractPreviewSlug(host: string | undefined, pattern: RegExp): string | null {
  if (!host) return null;
  const match = pattern.exec(host);
  return match ? match[1] : null;
}

export function isPreviewHost(host: string | undefined, pattern: RegExp): boolean {
  return extractPreviewSlug(host, pattern) !== null;
}
