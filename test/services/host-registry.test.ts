import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { buildApp } from "../../src/app.js";
import { closeDb } from "../../src/db/client.js";
import {
  LOCAL_HOST_ID,
  createHost,
  decryptToken,
  deleteHost,
  getHostRow,
  HostHasProjectsError,
  listHosts,
  UnknownHostError,
  updateHost,
} from "../../src/services/host-registry.js";

const tmpDb = path.join(os.tmpdir(), `host-registry-test-${process.pid}.db`);

describe("host-registry", () => {
  beforeAll(() => {
    fs.rmSync(tmpDb, { force: true });
    process.env.DATABASE_URL = `file:${tmpDb}`;
  });

  afterAll(() => {
    closeDb();
    fs.rmSync(tmpDb, { force: true });
    delete process.env.DATABASE_URL;
  });

  it("seeds exactly the local host on a fresh DB", async () => {
    const app = await buildApp();
    expect(listHosts(app)).toEqual([
      expect.objectContaining({ id: LOCAL_HOST_ID, isLocal: true, hasToken: false }),
    ]);
    await app.close();
  });

  it("round-trips a token through createHost/decryptToken", async () => {
    const app = await buildApp();
    const summary = createHost(app, { name: "a", baseUrl: "http://a:1", token: "s3cr3t" });
    const row = getHostRow(app, summary.id);
    expect(row).toBeDefined();
    expect(decryptToken(app, row!)).toBe("s3cr3t");
    await app.close();
  });

  it("stores the token opaque to EncryptionService (encrypted when DB_ENCRYPTION_KEY is set)", async () => {
    process.env.DB_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64url");
    const app = await buildApp();
    const summary = createHost(app, { name: "enc", baseUrl: "http://enc:1", token: "s3cr3t" });
    const row = getHostRow(app, summary.id)!;
    expect(row.authTokenEnc).not.toBe("s3cr3t");
    expect(decryptToken(app, row)).toBe("s3cr3t");
    await app.close();
    delete process.env.DB_ENCRYPTION_KEY;
  });

  it("updateHost rotates the token and re-encrypts it", async () => {
    const app = await buildApp();
    const summary = createHost(app, { name: "b", baseUrl: "http://b:1", token: "first" });
    updateHost(app, summary.id, { token: "second" });
    const row = getHostRow(app, summary.id)!;
    expect(decryptToken(app, row)).toBe("second");
    await app.close();
  });

  it("updateHost returns undefined for an unknown id", async () => {
    const app = await buildApp();
    expect(updateHost(app, "nope", { name: "x" })).toBeUndefined();
    await app.close();
  });

  it("deleteHost refuses to delete the local host", async () => {
    const app = await buildApp();
    expect(() => deleteHost(app, LOCAL_HOST_ID)).toThrow(/local host/);
    await app.close();
  });

  it("deleteHost throws UnknownHostError for a missing id", async () => {
    const app = await buildApp();
    expect(() => deleteHost(app, "does-not-exist")).toThrow(UnknownHostError);
    await app.close();
  });

  it("deleteHost throws HostHasProjectsError when a remote host still owns projects", async () => {
    const app = await buildApp();
    const summary = createHost(app, { name: "c", baseUrl: "http://c:1", token: "t" });
    await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: "p", cwd: "/x", hostId: summary.id },
    });
    expect(() => deleteHost(app, summary.id)).toThrow(HostHasProjectsError);
    await app.close();
  });

  it("deleteHost succeeds for a remote host with no projects", async () => {
    const app = await buildApp();
    const summary = createHost(app, { name: "d", baseUrl: "http://d:1", token: "t" });
    expect(() => deleteHost(app, summary.id)).not.toThrow();
    expect(getHostRow(app, summary.id)).toBeUndefined();
    await app.close();
  });
});
