// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import type { Theme } from "./store.js";
import { useDashboardStore } from "./store.js";

interface FakeSocket {
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  binaryType: string;
  _openHandlers: Array<() => void>;
}

let fakeSocket: FakeSocket;
let fakeWsSend: ReturnType<typeof vi.fn>;

function oscRegex() {
  const ESC = String.fromCharCode(27);
  const BEL = String.fromCharCode(7);
  return new RegExp(`^${ESC}\\]10;#[\\da-f]{6}${BEL}${ESC}\\]11;#[\\da-f]{6}${BEL}$`, "i");
}

vi.mock("@xterm/xterm", () => {
  function createDisposable() {
    return { dispose: vi.fn() };
  }
  const Terminal = vi.fn(() => ({
    options: {} as Record<string, unknown>,
    unicode: {
      _v: "",
      set activeVersion(v: string) {
        this._v = v;
      },
      get activeVersion() {
        return this._v;
      },
    },
    cols: 80,
    rows: 24,
    open: vi.fn(),
    loadAddon: vi.fn(),
    dispose: vi.fn(),
    write: vi.fn(),
    hasSelection: vi.fn(() => false),
    getSelection: vi.fn(() => ""),
    paste: vi.fn(),
    onData: vi.fn(() => createDisposable()),
    onTitleChange: vi.fn(() => createDisposable()),
    onSelectionChange: vi.fn(() => createDisposable()),
    attachCustomKeyEventHandler: vi.fn(),
  }));
  return { Terminal };
});

vi.mock("@xterm/addon-fit", () => ({ FitAddon: vi.fn(() => ({ fit: vi.fn() })) }));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: vi.fn(() => ({ clearTextureAtlas: vi.fn() })),
}));
vi.mock("@xterm/addon-unicode11", () => ({ Unicode11Addon: vi.fn() }));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: vi.fn() }));

function makeFakeSocket(): FakeSocket {
  const openHandlers: Array<() => void> = [];
  const socket = {
    readyState: 0,
    send: vi.fn(),
    addEventListener: vi.fn((event: string, handler: () => void) => {
      if (event === "open") openHandlers.push(handler);
    }),
    close: vi.fn(),
    binaryType: "",
    _openHandlers: openHandlers,
  };
  return socket;
}

function stubFakeWebSocket(openImmediately: boolean) {
  fakeSocket = makeFakeSocket();
  fakeWsSend = fakeSocket.send;
  if (openImmediately) {
    fakeSocket.readyState = 1;
  }
  vi.stubGlobal(
    "WebSocket",
    vi.fn(() => fakeSocket),
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

async function renderPane() {
  useDashboardStore.setState({
    settings: {
      theme: "dark",
      terminal: {
        fontFamily: "Geist Mono",
        fontSize: 14,
        colorScheme: "default",
        cursorStyle: "block",
        cursorBlink: true,
        scrollback: 1000,
        copyOnSelect: false,
        pasteOnRightClick: false,
        reconnect: { enabled: false, maxAttempts: 0 },
        keyCapture: { ctrlR: true, ctrlL: true, ctrlK: true },
      },
      sidebarDensity: "comfortable",
      projectRoots: [],
      launchers: { defaultShell: "bash", defaultAgent: "claude" },
      notifications: {
        attentionAlerts: false,
        channels: { browser: false, sound: false },
        soundName: "blip" as const,
        idleThresholdSeconds: 300,
        exitedAlerts: false,
      },
      sessions: {
        namePattern: "",
        confirmBeforeKill: false,
        hideEndedSessions: false,
        reconcileIntervalSeconds: 30,
      },
    },
    theme: "dark" as Theme,
    settingsLoaded: true,
    projects: [],
    sessions: [],
    hosts: [],
    workspaces: [],
    groups: [],
  });
  const { TerminalPane } = await import("./TerminalPane.js");
  render(<TerminalPane params={{ sessionId: 1 }} />);
}

describe("TerminalPane OSC push", () => {
  it("sends OSC 10/11 bytes on theme toggle when socket is OPEN", async () => {
    stubFakeWebSocket(true);
    await renderPane();

    await waitFor(() => expect(fakeSocket.readyState).toBe(1));

    useDashboardStore.setState({ theme: "light" as Theme });

    await waitFor(() => {
      expect(fakeWsSend).toHaveBeenCalled();
    });
    const sent = fakeWsSend.mock.calls[0][0];
    expect(sent).toBeInstanceOf(Uint8Array);
    const decoded = new TextDecoder().decode(sent);
    expect(decoded).toMatch(oscRegex());
  });

  it("does NOT send when socket is CLOSED, but sends on open", async () => {
    stubFakeWebSocket(false);
    await renderPane();

    useDashboardStore.setState({ theme: "light" as Theme });

    expect(fakeWsSend).not.toHaveBeenCalled();

    fakeSocket.readyState = 1;
    for (const handler of fakeSocket._openHandlers) handler();

    await waitFor(() => {
      expect(fakeWsSend).toHaveBeenCalled();
    });
    const sent = fakeWsSend.mock.calls[0][0];
    expect(sent).toBeInstanceOf(Uint8Array);
    const decoded = new TextDecoder().decode(sent);
    expect(decoded).toMatch(oscRegex());
  });

  it("does not send on unrelated pref changes (cursor blink)", async () => {
    stubFakeWebSocket(true);
    await renderPane();

    await waitFor(() => expect(fakeSocket.readyState).toBe(1));

    useDashboardStore.setState((s) => ({
      settings: { ...s.settings, terminal: { ...s.settings.terminal, cursorBlink: false } },
    }));

    await vi.waitFor(() => {
      expect(fakeWsSend).not.toHaveBeenCalled();
    });
  });
});
