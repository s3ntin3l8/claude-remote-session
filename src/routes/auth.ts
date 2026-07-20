import type { FastifyInstance } from "fastify";
import {
  createSessionCookieValue,
  isAuthEnabled,
  isRequestAuthenticated,
  isValidLoginToken,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from "../services/auth.js";

const loginSchema = {
  body: {
    type: "object",
    required: ["token"],
    properties: {
      token: { type: "string" },
    },
  },
};

// Both routes below perform an authorization check (isValidLoginToken /
// isRequestAuthenticated) reachable with no credential at all — CodeQL's
// js/missing-rate-limiting flagged them prior to this: the app-wide default
// (security.ts's RATE_LIMIT_MAX, tuned for a browser's normal UI traffic —
// dozens of calls per page load) isn't a *dedicated* bound on login
// attempts specifically, so a request that only ever hits this one route
// could still exhaust most of that budget guessing tokens. Much stricter
// ceilings here, independent of RATE_LIMIT_MAX, same
// `{ config: { rateLimit } }` per-route override mechanism internal.ts's own
// INTERNAL_RATE_LIMIT uses.
// Kept as bare rateLimit option objects, not pre-wrapped in `{ config: {...} }`
// — CodeQL's js/missing-rate-limiting query couldn't trace `config.rateLimit`
// through an object-spread (`...LOGIN_RATE_LIMIT`) at the route-registration
// call site, only a literal `config: { rateLimit }` there directly (compare:
// the `me` route below, registered the literal way, cleared the same alert;
// `login` spread this same shape and stayed flagged even after being
// genuinely rate-limited at runtime — a static-analysis limitation, not a
// behavior difference, but literal is what satisfies it).
const LOGIN_RATE_LIMIT = { max: 10, timeWindow: "1 minute" };
const ME_RATE_LIMIT = { max: 30, timeWindow: "1 minute" };

// All three routes live under /api/auth/ — src/plugins/auth.ts's onRequest
// gate deliberately exempts that whole prefix (see its own comment), since
// a request can't authenticate itself against a gate that also blocks the
// one endpoint that authenticates it. GET /api/auth/me is what the frontend
// polls on load to decide whether to render the dashboard or a login view
// (see App.tsx) — reachable unauthenticated by design.
export async function authRoute(app: FastifyInstance) {
  app.post<{ Body: { token: string } }>(
    "/api/auth/login",
    { schema: loginSchema, config: { rateLimit: LOGIN_RATE_LIMIT } },
    async (request, reply) => {
      if (!isValidLoginToken(request.body.token, app.config)) {
        return reply.unauthorized("invalid token");
      }

      reply.setCookie(
        SESSION_COOKIE_NAME,
        createSessionCookieValue(app.config.TESSERA_SESSION_SECRET),
        {
          httpOnly: true,
          sameSite: "lax",
          // Traefik terminates TLS and talks plain HTTP to this process
          // internally (see src/plugins/security.ts's own CSP comment on the
          // same deployment model) — Secure governs what the *browser* sends
          // based on the origin it sees (https, once Traefik is in front), not
          // this internal hop, so it's safe to require in production. In dev
          // (plain http://localhost) requiring it would silently drop the
          // cookie, so it's off outside production.
          secure: app.config.NODE_ENV === "production",
          path: "/",
          maxAge: SESSION_MAX_AGE_SECONDS,
        },
      );
      reply.code(204);
    },
  );

  app.post("/api/auth/logout", async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    reply.code(204);
  });

  app.get("/api/auth/me", { config: { rateLimit: ME_RATE_LIMIT } }, async (request) => {
    const enabled = isAuthEnabled(app.config);
    return {
      authMode: enabled ? "token" : "none",
      // With auth disabled there's no credential to check — the frontend
      // never needs to gate on this, but reporting `true` (rather than
      // running isRequestAuthenticated against a config that can never
      // match) keeps the shape simple for callers that only branch on this
      // field and ignore authMode entirely.
      authenticated: enabled ? isRequestAuthenticated(request.headers, app.config) : true,
    };
  });
}
