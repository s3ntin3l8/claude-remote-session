import type { FastifyRequest, FastifyReply } from "fastify";
import { Readable } from "node:stream";

// Shared by both hops of a preview proxy request (issue #28): the primary's
// own preview-proxy.ts (browser -> dev server, or browser -> owning agent)
// and the agent's own internal.ts (agent -> its own loopback dev server,
// issue #28 phase 6). Header/body plumbing is identical at both hops — only
// where the fetch() actually goes differs.

// Hop-by-hop or request-scoped headers that must never pass through
// unchanged: "host" specifically has to become the *upstream's* host (see
// buildUpstreamRequestHeaders) or dev servers with a Host allowlist (e.g.
// Vite's `server.allowedHosts`) 403 every request, since the browser sent
// "preview-<slug>.<baseHost>", not what the dev server expects to be
// reached as.
const HOP_BY_HOP_REQUEST_HEADERS = new Set(["host", "connection", "content-length"]);

/**
 * Builds the outgoing request headers for one proxy hop: copies everything
 * except the hop-by-hop set above and `extraExcluded` (case-insensitive),
 * then forces "host" to `upstreamHost`. `extraExcluded` exists for the
 * agent's own onward hop to its loopback dev server, which must strip the
 * `authorization` bearer token it was just authenticated with — that
 * secret must never reach arbitrary project dev-server code (see
 * internal.ts). The primary's own hop has no such secret in the browser's
 * request headers, so it calls this with no extra exclusions.
 */
export function buildUpstreamRequestHeaders(
  request: FastifyRequest,
  upstreamHost: string,
  extraExcluded: string[] = [],
): Headers {
  const excluded = new Set([
    ...HOP_BY_HOP_REQUEST_HEADERS,
    ...extraExcluded.map((h) => h.toLowerCase()),
  ]);
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined || excluded.has(key.toLowerCase())) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.set(key, value);
    }
  }
  headers.set("host", upstreamHost);
  return headers;
}

// Headers that would either defeat this whole feature (the target's own
// X-Frame-Options/CSP would block the dashboard from framing it) or are
// simply wrong once re-served through fetch()/Fastify rather than passed
// through a raw socket: fetch() already transparently decompressed the
// body, so forwarding the upstream's own content-encoding/content-length
// would describe bytes we're no longer sending; Fastify recomputes
// framing/length headers itself once the response is actually sent. Applies
// at both hops — an agent's own reply to the primary needs the same
// stripping for the same reasons (its own fetch() to the loopback dev
// server already decompressed the body too), and stripping x-frame-options/
// CSP twice is harmless.
const STRIPPED_RESPONSE_HEADERS = new Set([
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
]);

/**
 * Relays a fetch() Response onto a Fastify reply: status, headers (minus
 * the stripped set above, grouped by name so a multi-value header —
 * Set-Cookie is the realistic case — round-trips as every value rather than
 * only the last one reply.header() would otherwise overwrite with), and
 * body (streamed, not buffered).
 */
export function relayFetchResponse(
  reply: FastifyReply,
  method: string,
  upstreamResponse: Response,
) {
  reply.code(upstreamResponse.status);

  // Explicit removal, not just "don't copy the upstream's own value": if
  // this hop runs behind helmet's own onRequest hook (the primary's own
  // registration order), helmet has already staged its own
  // x-frame-options/CSP on this reply by the time this runs. `reply.raw`
  // (Node's own ServerResponse), not just `reply`, needs clearing too:
  // @fastify/helmet sets its headers by calling the `helmet` npm package's
  // middleware directly against `reply.raw`, bypassing Fastify's
  // `reply.header()` API — and `reply.removeHeader()` only clears
  // Fastify's own internal header map, never `reply.raw`'s.
  for (const name of STRIPPED_RESPONSE_HEADERS) {
    reply.removeHeader(name);
    if (reply.raw.hasHeader(name)) reply.raw.removeHeader(name);
  }

  const headersToSend = new Map<string, string[]>();
  for (const [key, value] of upstreamResponse.headers) {
    const lower = key.toLowerCase();
    if (STRIPPED_RESPONSE_HEADERS.has(lower)) continue;
    const existing = headersToSend.get(lower);
    if (existing) existing.push(value);
    else headersToSend.set(lower, [value]);
  }
  for (const [key, values] of headersToSend) {
    reply.header(key, values.length === 1 ? values[0] : values);
  }

  if (method === "HEAD" || upstreamResponse.body === null) {
    return reply.send();
  }
  return reply.send(Readable.fromWeb(upstreamResponse.body));
}
