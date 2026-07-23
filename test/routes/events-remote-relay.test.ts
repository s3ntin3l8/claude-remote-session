import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "@fastify/websocket";

// Focused unit coverage for relayRemoteEventsHost's browser<->upstream
// wiring (issue #166's multi-host twin) — mirrors
// test/routes/terminal-remote-proxy.test.ts's own MockSocket approach for
// proxyToRemoteAttach exactly, for the same reason: a real end-to-end
// multi-host WS test needs two full listening servers for proportionally
// much less coverage than driving this function directly against fake
// EventEmitter-based sockets.

class MockSocket extends EventEmitter {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly CONNECTING = MockSocket.CONNECTING;
  readonly OPEN = MockSocket.OPEN;
  readonly CLOSING = MockSocket.CLOSING;
  readonly CLOSED = MockSocket.CLOSED;

  readyState = MockSocket.CONNECTING;
  bufferedAmount = 0;
  sendSpy = vi.fn();
  closeSpy = vi.fn();

  send(data: unknown, opts?: unknown) {
    this.sendSpy(data, opts);
  }

  close() {
    this.closeSpy();
    this.readyState = MockSocket.CLOSED;
    this.emit("close");
  }

  open() {
    this.readyState = MockSocket.OPEN;
    this.emit("open");
  }
}

const openEventsStreamMock = vi.fn();

vi.mock("../../src/services/remote-host-client.js", () => ({
  getRemoteHostClient: vi.fn(() => ({ openEventsStream: openEventsStreamMock })),
}));

const { relayRemoteEventsHost } = await import("../../src/routes/events.js");

function fakeApp(): FastifyInstance {
  return { log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } } as unknown as FastifyInstance;
}

describe("relayRemoteEventsHost (issue #166's multi-host twin)", () => {
  beforeEach(() => {
    openEventsStreamMock.mockReset();
  });

  it("relays an upstream event message into the browser socket", () => {
    const browserSocket = new MockSocket();
    browserSocket.readyState = MockSocket.OPEN;
    const upstream = new MockSocket();
    openEventsStreamMock.mockReturnValue(upstream);

    const returned = relayRemoteEventsHost(
      fakeApp(),
      browserSocket as unknown as WebSocket,
      "remote-host",
    );
    expect(returned).toBe(upstream);

    const wireEvent = JSON.stringify({
      seq: 1,
      sessionId: 5,
      kind: "attention",
      ts: 0,
      payload: {},
    });
    upstream.emit("message", wireEvent);

    expect(browserSocket.sendSpy.mock.calls[0][0]).toBe(wireEvent);
  });

  it("drops an upstream event once the browser socket's own send buffer is over the backpressure threshold", () => {
    const browserSocket = new MockSocket();
    browserSocket.readyState = MockSocket.OPEN;
    browserSocket.bufferedAmount = 4 * 1024 * 1024 + 1;
    const upstream = new MockSocket();
    openEventsStreamMock.mockReturnValue(upstream);

    relayRemoteEventsHost(fakeApp(), browserSocket as unknown as WebSocket, "remote-host");
    upstream.emit("message", "{}");

    expect(browserSocket.sendSpy).not.toHaveBeenCalled();
  });

  it("does not forward an upstream message once the browser socket has closed", () => {
    const browserSocket = new MockSocket();
    browserSocket.readyState = MockSocket.CLOSED;
    const upstream = new MockSocket();
    openEventsStreamMock.mockReturnValue(upstream);

    relayRemoteEventsHost(fakeApp(), browserSocket as unknown as WebSocket, "remote-host");
    upstream.emit("message", "{}");

    expect(browserSocket.sendSpy).not.toHaveBeenCalled();
  });

  it("returns null and logs, without throwing, when opening the upstream fails synchronously", () => {
    const browserSocket = new MockSocket();
    browserSocket.readyState = MockSocket.OPEN;
    openEventsStreamMock.mockImplementation(() => {
      throw new Error("no baseUrl configured");
    });
    const app = fakeApp();

    const returned = relayRemoteEventsHost(
      app,
      browserSocket as unknown as WebSocket,
      "remote-host",
    );

    expect(returned).toBeNull();
    expect(app.log.error).toHaveBeenCalledWith(
      expect.objectContaining({ hostId: "remote-host" }),
      "failed to open remote events stream",
    );
  });

  it("logs, without closing the browser socket, when the upstream itself errors", () => {
    const browserSocket = new MockSocket();
    browserSocket.readyState = MockSocket.OPEN;
    const upstream = new MockSocket();
    openEventsStreamMock.mockReturnValue(upstream);
    const app = fakeApp();

    relayRemoteEventsHost(app, browserSocket as unknown as WebSocket, "remote-host");
    upstream.emit("error", new Error("connection reset"));

    // Unlike proxyToRemoteAttach (a 1:1 relationship where one host's
    // failure legitimately ends the browser's single-session socket), this
    // is an aggregated multi-host stream — one host's upstream erroring
    // must never close the browser's own /ws/events socket, since other
    // hosts' (and local) events must keep flowing.
    expect(browserSocket.closeSpy).not.toHaveBeenCalled();
    expect(app.log.error).toHaveBeenCalledWith(
      expect.objectContaining({ hostId: "remote-host" }),
      "remote events ws upstream error",
    );
  });
});
