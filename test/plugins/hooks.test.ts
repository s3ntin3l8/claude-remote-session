import { describe, it, expect, afterEach } from "vitest";
import net from "node:net";
import { EventEmitter } from "node:events";
import type * as ChildProcess from "node:child_process";
import { vi } from "vitest";

// Real integration test against the actual listening Unix socket — same
// "app.inject() can't drive this, so build a real app and connect a real
// client" reasoning as test/routes/terminal.test.ts / test/routes/events.test.ts,
// just over net.createConnection() instead of a WebSocket. node-pty and the
// systemd-run/dtach bootstrap child_process are faked the same way
// test/services/pty-manager.test.ts fakes them, so this exercises the real
// hooksPlugin listener (handshake, token validation, line framing) without
// depending on a real systemd --user session.
class FakePty {
  dataListeners: Array<(data: string) => void> = [];
  exitListeners: Array<() => void> = [];
  onData(cb: (data: string) => void) {
    this.dataListeners.push(cb);
    return { dispose: () => {} };
  }
  onExit(cb: () => void) {
    this.exitListeners.push(cb);
    return { dispose: () => {} };
  }
  write() {}
  resize() {}
  kill() {}
}

vi.mock("node-pty", () => ({
  spawn: vi.fn(() => new FakePty()),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcess>();
  return {
    ...actual,
    spawn: vi.fn(() => {
      const ee = new EventEmitter() as EventEmitter & { stdout?: EventEmitter };
      setImmediate(() => ee.emit("exit", 0));
      return ee;
    }),
  };
});

const { buildApp } = await import("../../src/app.js");

/** Connects a raw net socket to `path`, resolving once actually connected. */
function connect(path: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(path);
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

/** Resolves once `socket` closes (server-initiated destroy, in every test
 * below) — the thing every "was this connection rejected" assertion here
 * actually waits on. */
function waitForClose(socket: net.Socket): Promise<void> {
  return new Promise((resolve) => {
    if (socket.destroyed) {
      resolve();
      return;
    }
    socket.once("close", () => resolve());
  });
}

describe("hooksPlugin (issue #172)", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | null = null;

  afterEach(async () => {
    if (app) await app.close();
    app = null;
  });

  it("listens on app.pty.hookSocketPath once ready", async () => {
    app = await buildApp();
    await app.ready();

    const socket = await connect(app.pty.hookSocketPath);
    socket.destroy();
  });

  it("keeps a connection open once a valid session token handshakes", async () => {
    app = await buildApp();
    await app.ready();
    const session = app.pty.getOrCreate({
      id: "1",
      cwd: "/tmp",
      command: "bash",
      cols: 80,
      rows: 24,
    });

    const socket = await connect(app.pty.hookSocketPath);
    socket.write(`${JSON.stringify({ token: session.hookToken })}\n`);

    // No close event fires for a valid handshake — assert the connection is
    // still alive after giving the (mocked, synchronous-ish) server loop a
    // moment to have destroyed it if it were going to.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(socket.destroyed).toBe(false);
    socket.destroy();
  });

  it("closes the connection on an unknown/forged token", async () => {
    app = await buildApp();
    await app.ready();

    const socket = await connect(app.pty.hookSocketPath);
    socket.write(`${JSON.stringify({ token: "forged-token" })}\n`);

    await waitForClose(socket);
    expect(socket.destroyed).toBe(true);
  });

  it("closes the connection on a malformed (non-JSON) handshake line", async () => {
    app = await buildApp();
    await app.ready();

    const socket = await connect(app.pty.hookSocketPath);
    socket.write("not json at all\n");

    await waitForClose(socket);
    expect(socket.destroyed).toBe(true);
  });

  it("closes the connection on a handshake object with no string token field", async () => {
    app = await buildApp();
    await app.ready();

    const socket = await connect(app.pty.hookSocketPath);
    socket.write(`${JSON.stringify({ notToken: 123 })}\n`);

    await waitForClose(socket);
    expect(socket.destroyed).toBe(true);
  });

  it("closes the connection on an oversized line with no terminator", async () => {
    app = await buildApp();
    await app.ready();

    const socket = await connect(app.pty.hookSocketPath);
    // No trailing newline — deliberately never completes a line, so this
    // only ever hits the byte-cap guard, not JSON parsing.
    socket.write("a".repeat(70_000));

    await waitForClose(socket);
    expect(socket.destroyed).toBe(true);
  });

  it("a token stops resolving (and a fresh connection using it is closed) once its session is killed", async () => {
    app = await buildApp();
    await app.ready();
    const session = app.pty.getOrCreate({
      id: "1",
      cwd: "/tmp",
      command: "bash",
      cols: 80,
      rows: 24,
    });
    const token = session.hookToken;
    app.pty.kill("1");

    const socket = await connect(app.pty.hookSocketPath);
    socket.write(`${JSON.stringify({ token })}\n`);

    await waitForClose(socket);
    expect(socket.destroyed).toBe(true);
  });

  it("unlinks the socket file on close (onClose cleanup)", async () => {
    app = await buildApp();
    await app.ready();
    const socketPath = app.pty.hookSocketPath;

    await app.close();
    app = null;

    // A fresh app can bind the same path again — proof the file was
    // actually removed, not just that the server stopped accepting.
    const second = await buildApp();
    try {
      await second.ready();
      expect(second.pty.hookSocketPath).toBe(socketPath);
      const socket = await connect(socketPath);
      socket.destroy();
    } finally {
      await second.close();
    }
  });
});
