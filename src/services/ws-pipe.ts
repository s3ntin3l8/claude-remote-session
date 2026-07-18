import type { FastifyInstance } from "fastify";
import { WebSocket as NodeWebSocket } from "ws";

// Shared by both hops of a preview HMR websocket (issue #28): the primary's
// own preview-proxy.ts (browser <-> dev server, or browser <-> owning
// agent) and the agent's own internal.ts (agent <-> its own loopback dev
// server, issue #28 phase 6). Mirrors terminal.ts's own
// proxyToRemoteAttach() backpressure/lifecycle handling frame-for-frame
// (same drop threshold, unconditional message-handler registration so
// frames sent before the upstream opens aren't silently dropped, close/
// error propagation both ways) rather than reusing it directly — that
// function is PtyManager-attach-specific, not a generic two-socket pipe.

export const WS_BACKPRESSURE_MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

/** http(s) -> ws(s), everything else about the URL untouched. */
export function toWsUrl(url: URL): URL {
  const wsUrl = new URL(url.href);
  wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
  return wsUrl;
}

/**
 * Pipes frames between an already-accepted `nearSocket` (the browser's
 * connection at the primary, or the primary's own connection at the agent)
 * and an `upstream` socket this function does not own the lifecycle of
 * before calling. `logContext` is attached to every warn/error log line so
 * both callers' logs stay attributable to their own resolution context
 * (a preview slug at the primary, a port at the agent).
 */
export function pipeWsFrames(
  app: FastifyInstance,
  nearSocket: NodeWebSocket,
  upstream: NodeWebSocket,
  logContext: Record<string, unknown>,
): void {
  const closeNear = () => {
    if (nearSocket.readyState === NodeWebSocket.OPEN) nearSocket.close();
  };
  const closeUpstream = () => {
    // A CLOSING upstream (already mid-close-handshake from some other
    // trigger) is left alone rather than closed again. In the rare case
    // the near side closes at that exact moment, the upstream simply
    // finishes its own close on its own timeline rather than erroring on a
    // double-close.
    if (
      upstream.readyState === NodeWebSocket.OPEN ||
      upstream.readyState === NodeWebSocket.CONNECTING
    ) {
      upstream.close();
    }
  };

  // Unconditional, not nested in upstream's "open" handler: the upstream
  // connect isn't instant, and gating this on "open" would silently drop
  // any frame the near side sends during that window.
  nearSocket.on("message", (data, isBinary) => {
    if (upstream.readyState !== NodeWebSocket.OPEN) return;
    if (upstream.bufferedAmount > WS_BACKPRESSURE_MAX_BUFFERED_BYTES) return;
    upstream.send(data, { binary: isBinary });
  });
  nearSocket.on("close", closeUpstream);

  upstream.on("close", closeNear);
  upstream.on("error", (err) => {
    app.log.warn({ err, ...logContext }, "ws pipe: upstream error");
    closeNear();
  });

  upstream.once("open", () => {
    upstream.on("message", (data, isBinary) => {
      if (nearSocket.readyState !== NodeWebSocket.OPEN) return;
      if (nearSocket.bufferedAmount > WS_BACKPRESSURE_MAX_BUFFERED_BYTES) return;
      nearSocket.send(data, { binary: isBinary });
    });
  });
  upstream.once("unexpected-response", (_req, res) => {
    app.log.warn(
      { statusCode: res.statusCode, ...logContext },
      "ws pipe: upstream rejected upgrade",
    );
    closeNear();
  });
}
