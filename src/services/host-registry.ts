import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { hosts, projects } from "../db/schema.js";

export const LOCAL_HOST_ID = "local";

// Never includes the encrypted token — see listHosts/toSummary below. `id`
// is the stable identifier every project.hostId and session-backend lookup
// keys off; `local` is seeded by the migration and is the only host id
// that resolves to the in-process PtyManager (session-backend.ts) rather
// than a RemoteHostClient.
export interface HostSummary {
  id: string;
  name: string;
  baseUrl: string | null;
  isLocal: boolean;
  hasToken: boolean;
  createdAt: Date;
}

export interface CreateHostInput {
  name: string;
  baseUrl: string;
  token: string;
}

export interface UpdateHostInput {
  name?: string;
  baseUrl?: string;
  /** Omit to leave the stored token untouched; pass a new value to rotate it. */
  token?: string;
}

export class UnknownHostError extends Error {
  constructor(hostId: string) {
    super(`Unknown host ${hostId}`);
    this.name = "UnknownHostError";
  }
}

export class HostHasProjectsError extends Error {
  constructor(
    hostId: string,
    public readonly projectCount: number,
  ) {
    super(`Host ${hostId} still has ${projectCount} project(s)`);
    this.name = "HostHasProjectsError";
  }
}

type HostRow = typeof hosts.$inferSelect;

function toSummary(row: HostRow): HostSummary {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    isLocal: row.id === LOCAL_HOST_ID,
    hasToken: row.authTokenEnc !== null && row.authTokenEnc !== "",
    createdAt: row.createdAt,
  };
}

export function listHosts(app: FastifyInstance): HostSummary[] {
  return app.db.select().from(hosts).all().map(toSummary);
}

/** Internal use only (session-backend.ts, remote-host-client.ts) — includes
 * the encrypted token. Never send this row shape back over the API. */
export function getHostRow(app: FastifyInstance, id: string): HostRow | undefined {
  const [row] = app.db.select().from(hosts).where(eq(hosts.id, id)).all();
  return row;
}

export function getHostSummary(app: FastifyInstance, id: string): HostSummary | undefined {
  const row = getHostRow(app, id);
  return row ? toSummary(row) : undefined;
}

export function decryptToken(app: FastifyInstance, row: HostRow): string {
  if (!row.authTokenEnc) return "";
  return app.encryption.decryptString(row.authTokenEnc);
}

export function createHost(app: FastifyInstance, input: CreateHostInput): HostSummary {
  const [created] = app.db
    .insert(hosts)
    .values({
      id: crypto.randomUUID(),
      name: input.name,
      baseUrl: input.baseUrl,
      authTokenEnc: app.encryption.encryptString(input.token),
    })
    .returning()
    .all();
  return toSummary(created);
}

export function updateHost(
  app: FastifyInstance,
  id: string,
  input: UpdateHostInput,
): HostSummary | undefined {
  const updated = app.db
    .update(hosts)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
      ...(input.token !== undefined
        ? { authTokenEnc: app.encryption.encryptString(input.token) }
        : {}),
    })
    .where(eq(hosts.id, id))
    .returning()
    .all();
  return updated.length > 0 ? toSummary(updated[0]) : undefined;
}

export function countProjectsForHost(app: FastifyInstance, hostId: string): number {
  return app.db.select().from(projects).where(eq(projects.hostId, hostId)).all().length;
}

/**
 * Delete a host row. Refuses to delete `local` (the primary is always a
 * host to itself). Refuses a remote host that still owns projects unless
 * `cascade` is true, in which case the caller (routes/hosts.ts) is
 * responsible for having already best-effort-terminated every live session
 * on it — this function only ever touches DB rows, never app.pty or a
 * RemoteHostClient, to keep this module free of a session-backend.ts
 * dependency.
 */
export function deleteHost(app: FastifyInstance, id: string, opts: { cascade?: boolean } = {}) {
  if (id === LOCAL_HOST_ID) {
    throw new Error("cannot delete the local host");
  }
  const projectCount = countProjectsForHost(app, id);
  if (projectCount > 0 && !opts.cascade) {
    throw new HostHasProjectsError(id, projectCount);
  }
  const deleted = app.db.delete(hosts).where(eq(hosts.id, id)).returning().all();
  if (deleted.length === 0) throw new UnknownHostError(id);
}
