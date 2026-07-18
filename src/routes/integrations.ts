import type { FastifyInstance } from "fastify";
import {
  disconnect,
  getIntegration,
  InvalidTokenError,
  setPat,
} from "../services/github-integration.js";
import {
  DeviceFlowError,
  getDeviceFlowStatus,
  startDeviceFlow,
} from "../services/github-device-flow.js";

interface SetTokenBody {
  token: string;
}

const setTokenSchema = {
  body: {
    type: "object",
    required: ["token"],
    additionalProperties: false,
    properties: {
      token: { type: "string", minLength: 1 },
    },
  },
};

// No auth hook here, same app-wide gateway-auth assumption as every other
// route (settings.ts, hosts.ts, projects.ts) — see settings.ts's comment.
// This is exactly why the summary this route returns never includes the
// token itself, only `connected`/`login`/`scopes` — see
// GitHubIntegrationSummary in services/github-integration.ts.
export async function integrationsRoute(app: FastifyInstance) {
  // No explicit reply.type() here (unlike settings.ts's GET/PATCH) —
  // Fastify already serializes a returned plain object as
  // application/json on its own, and hosts.ts/projects.ts don't set it
  // either. settings.ts's explicit call guards a genuinely free-form
  // string (the session-name pattern); the one free-form-ish field here,
  // `login`, is a GitHub username GitHub itself restricts to
  // alphanumeric/hyphen, not arbitrary user input (Hermes review, PR #38).
  app.get("/api/integrations/github", async () => {
    return getIntegration(app);
  });

  // Rate-limited like GET /api/projects/discover (src/routes/projects.ts) —
  // this also reaches out to api.github.com, so it shouldn't be hammerable.
  app.put<{ Body: SetTokenBody }>(
    "/api/integrations/github/token",
    { schema: setTokenSchema, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      try {
        return await setPat(app, request.body.token);
      } catch (err) {
        if (err instanceof InvalidTokenError) {
          return reply.badRequest(err.message);
        }
        throw err;
      }
    },
  );

  app.delete("/api/integrations/github", async (_request, reply) => {
    disconnect(app);
    reply.code(204);
  });

  // Kicks off the device authorization grant (Phase 4) — 400s when no
  // GitHub OAuth App client id is configured, same "not available" signal
  // getIntegration()'s deviceFlowAvailable already tells the frontend to
  // hide the button for. Rate-limited like the PAT route above (also
  // reaches out to github.com).
  app.post(
    "/api/integrations/github/device/start",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (_request, reply) => {
      try {
        return await startDeviceFlow(app);
      } catch (err) {
        if (err instanceof DeviceFlowError) {
          return reply.badRequest(err.message);
        }
        throw err;
      }
    },
  );

  // Polled by the frontend purely to refresh its own UI — decoupled from
  // the actual GitHub polling cadence, which github-device-flow.ts drives
  // on its own schedule server-side. 404 means no attempt is in progress
  // (never started, or already connected/expired and superseded).
  app.get("/api/integrations/github/device/status", async (_request, reply) => {
    const status = getDeviceFlowStatus();
    if (!status) return reply.notFound();
    return status;
  });
}
