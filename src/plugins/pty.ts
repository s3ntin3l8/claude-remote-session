import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { getStoredSettings } from "../services/settings.js";
import { PtyManager } from "../services/pty-manager.js";
import { reconcileExitedSessions } from "../services/session-reconciler.js";

function readReconcileIntervalMs(app: FastifyInstance): number {
  return getStoredSettings(app.db).sessions.reconcileIntervalSeconds * 1000;
}

// Decorates app.pty with the session manager (see src/services/pty-manager.ts
// for what it actually does and why). Attach-clients it spawns are only
// killed on process shutdown here — never on browser disconnect, which is
// the whole point of the tool.
export const ptyPlugin = fp(async (app: FastifyInstance) => {
  const manager = new PtyManager({ sessionsDir: app.config.SESSIONS_DIR });

  app.decorate("pty", manager);

  let reconcileTimer: ReturnType<typeof setInterval> | null = null;

  // Re-armable: PATCH /api/settings calls this after a write that changes
  // sessions.reconcileIntervalSeconds, so the new interval takes effect
  // immediately rather than only after a process restart.
  function armReconcileTimer(intervalMs: number) {
    if (reconcileTimer) clearInterval(reconcileTimer);
    // unref() so this timer alone never keeps the process (or, in tests, a
    // fastify instance that's about to be closed) alive — reconciliation is
    // opportunistic housekeeping, not core request-serving work.
    reconcileTimer = setInterval(() => {
      reconcileExitedSessions(app).catch((err) => {
        app.log.error({ err }, "session reconciliation failed");
      });
    }, intervalMs);
    reconcileTimer.unref();
  }

  armReconcileTimer(readReconcileIntervalMs(app));
  app.decorate("reconfigureReconciler", (intervalSeconds: number) => {
    armReconcileTimer(intervalSeconds * 1000);
  });

  app.addHook("onClose", () => {
    if (reconcileTimer) clearInterval(reconcileTimer);
    manager.killAll();
  });
});

declare module "fastify" {
  interface FastifyInstance {
    pty: PtyManager;
    reconfigureReconciler: (intervalSeconds: number) => void;
  }
}
