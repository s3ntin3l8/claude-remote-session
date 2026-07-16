import type { FastifyInstance } from "fastify";
import { settings } from "../db/schema.js";
import { deepMerge, getStoredSettings, type AppSettings } from "../services/settings.js";

// The whole preferences blob is one JSON body — additionalProperties: true
// (rather than a strict per-field schema) because `mergeSettings` already
// deep-merges whatever shape a partial patch happens to have over the
// current defaults, the same "accept an opaque object, never inspect it
// structurally" pattern PATCH /api/workspaces uses for `layout`. Fastify
// still rejects a non-object body via `type: "object"`.
const patchSettingsSchema = {
  body: {
    type: "object",
    additionalProperties: true,
  },
};

const SETTINGS_ROW_ID = 1;

export async function settingsRoute(app: FastifyInstance) {
  app.get("/api/settings", async () => {
    return getStoredSettings(app.db);
  });

  app.patch<{ Body: Record<string, unknown> }>(
    "/api/settings",
    { schema: patchSettingsSchema },
    async (request) => {
      // Merge the partial patch onto the *current* stored settings (already
      // fully-defaulted by getStoredSettings) — deepMerge is the same helper
      // mergeSettings uses to layer a stored blob over DEFAULT_SETTINGS.
      const previous = getStoredSettings(app.db);
      const next: AppSettings = deepMerge(previous, request.body);
      const data = JSON.stringify(next);

      // Upsert the singleton row — SQLite's ON CONFLICT DO UPDATE, matching
      // how a settings row simply doesn't exist until the first write.
      app.db
        .insert(settings)
        .values({ id: SETTINGS_ROW_ID, data })
        .onConflictDoUpdate({ target: settings.id, set: { data, updatedAt: new Date() } })
        .run();

      // Live-reconfigure the reconciler timer (see plugins/pty.ts) rather
      // than only picking up the new interval on next process restart.
      if (next.sessions.reconcileIntervalSeconds !== previous.sessions.reconcileIntervalSeconds) {
        app.reconfigureReconciler(next.sessions.reconcileIntervalSeconds);
      }

      return next;
    },
  );
}
