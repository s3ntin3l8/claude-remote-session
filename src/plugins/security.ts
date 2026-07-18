import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import cors from "@fastify/cors";
import { buildPreviewHostPattern, isPreviewHost } from "../services/preview-host.js";

export const securityPlugin = fp(async (app: FastifyInstance) => {
  const previewBaseHost = app.config.PREVIEW_BASE_HOST.trim();
  const previewHostPattern =
    previewBaseHost !== "" ? buildPreviewHostPattern(previewBaseHost) : null;

  // Security headers (CSP, HSTS, etc.).
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        // Helmet's default directives include upgrade-insecure-requests,
        // which tells the browser to silently rewrite every same-origin
        // http:// subresource request to https:// — including behind a
        // reverse proxy (Traefik) that terminates TLS and talks plain HTTP
        // to this app internally, which is exactly this app's deployment
        // model (see the plan). With it on, every asset request 404s/503s
        // against a port that never speaks TLS; this cost real time to
        // diagnose (looked identical to a blank/broken terminal). Disabled
        // by setting the directive to null, helmet's documented way to
        // drop a default directive.
        upgradeInsecureRequests: null,
        // Helmet's defaults set no frame-src at all, so it falls back to
        // default-src 'self' — which blocks the dashboard's own pages from
        // embedding a preview pane's <iframe> at
        // "preview-<slug>.PREVIEW_BASE_HOST", a *different* origin (issue
        // #28's whole reason for existing: a same-origin subdomain proxy,
        // not a same-origin path, is what lets the target see "/" as its
        // own root — see the plan). Only added when the preview feature is
        // actually configured (see plugins/preview-proxy.ts's identical
        // opt-in gate); both schemes are listed since local dev runs plain
        // http while production terminates TLS at Traefik.
        ...(previewBaseHost !== ""
          ? {
              frameSrc: ["'self'", `http://*.${previewBaseHost}`, `https://*.${previewBaseHost}`],
            }
          : {}),
      },
    },
  });

  // Basic abuse protection. Tune via RATE_LIMIT_MAX / RATE_LIMIT_WINDOW.
  await app.register(rateLimit, {
    max: app.config.RATE_LIMIT_MAX,
    timeWindow: app.config.RATE_LIMIT_WINDOW,
    // A single preview page load fans out into dozens of subresource
    // requests (issue #28) — the app-wide default (100/min) would 429
    // partway through the very first paint. This plugin's own onRequest
    // hook (registered before preview-proxy.ts's, since securityPlugin
    // registers first) would otherwise count and gate every one of them,
    // regardless of what preview-proxy.ts does downstream — allowList is
    // rate-limit's own supported way to exempt requests by predicate,
    // checked from inside its hook, so registration order doesn't matter.
    allowList: previewHostPattern
      ? (request) => isPreviewHost(request.headers.host, previewHostPattern)
      : undefined,
  });

  // CORS is disabled by default. Set CORS_ORIGIN to a comma-separated allowlist
  // (e.g. "https://app.example.com,https://admin.example.com") to enable it.
  const allowlist = app.config.CORS_ORIGIN.split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);

  await app.register(cors, {
    origin: allowlist.length > 0 ? allowlist : false,
  });
});
