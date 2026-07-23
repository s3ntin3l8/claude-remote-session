// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionRow } from "./Sidebar.js";
import type { NotificationEvent, Session } from "./api.js";

// ConfirmButton checks settings.sessions.confirmBeforeKill from the store —
// default it to false so the test doesn't need a full store hydrate. `events`
// is a `let` (not inlined into the factory) so individual tests can reassign
// it before rendering — mirrors PaneTab.test.tsx's own mutable-mock-state
// pattern for this same store mock shape.
let events: Record<number, NotificationEvent[]>;
vi.mock("./store.js", () => ({
  useDashboardStore: (selector: (s: unknown) => unknown) =>
    selector({
      settings: { sessions: { confirmBeforeKill: false } },
      theme: "dark",
      events,
    }),
}));

function makeSession(overrides: Partial<Session>): Session {
  return {
    id: 1,
    projectId: 1,
    name: null,
    nameLocked: false,
    command: "claude code",
    cwd: null,
    kind: "terminal",
    status: "active",
    createdAt: "",
    lastAttachedAt: null,
    alive: true,
    subscriberCount: 0,
    activity: "working",
    lastActivityAt: Date.now(),
    attention: false,
    attentionAt: null,
    lastTitle: null,
    ...overrides,
  };
}

// jsdom doesn't implement DataTransfer/DragEvent; provide minimal stubs.
function createDataTransfer(): DataTransfer {
  const map = new Map<string, string>();
  return {
    setData(type, val) {
      map.set(type, val);
    },
    getData(type) {
      return map.get(type) ?? "";
    },
    get types() {
      return Array.from(map.keys());
    },
    effectAllowed: "none" as DataTransfer["effectAllowed"],
    dropEffect: "none" as DataTransfer["dropEffect"],
    clearData(format) {
      if (format) map.delete(format);
      else map.clear();
    },
    setDragImage() {},
    items: {} as DataTransfer["items"],
    files: {} as FileList,
  } as DataTransfer;
}

function createDragEvent(type: string, dataTransfer: DataTransfer): DragEvent {
  const event = new Event(type, { bubbles: true }) as unknown as DragEvent;
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  return event;
}

const SESSION: Session = {
  id: 42,
  projectId: 1,
  name: null,
  nameLocked: false,
  command: "claude code",
  cwd: null,
  kind: "terminal",
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
  lastAttachedAt: "2026-01-01T00:00:00.000Z",
  alive: true,
  subscriberCount: 1,
  activity: "working",
  lastActivityAt: Date.now(),
  attention: false,
  attentionAt: null,
  lastTitle: null,
};

beforeEach(() => {
  events = {};
});

describe("SessionRow", () => {
  it("sets application/x-mullion-session on drag start", () => {
    const onOpen = vi.fn();
    const onEnd = vi.fn();

    render(<SessionRow session={SESSION} onOpen={onOpen} onEnd={onEnd} />);

    const row = screen.getByText("claude code").closest(".session-item")!;

    const dataTransfer = createDataTransfer();
    row.dispatchEvent(createDragEvent("dragstart", dataTransfer));

    expect(dataTransfer.getData("application/x-mullion-session")).toBe("42");
    expect(dataTransfer.getData("text/plain")).toBe("claude code");
    expect(dataTransfer.effectAllowed).toBe("move");
  });

  it("fires onClick on a plain click (not a drag)", async () => {
    const onOpen = vi.fn();
    const onEnd = vi.fn();
    const user = userEvent.setup();

    render(<SessionRow session={SESSION} onOpen={onOpen} onEnd={onEnd} />);

    const row = screen.getByText("claude code").closest(".session-item")!;
    await user.click(row);

    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe("SessionRow title display", () => {
  it("shows command when no name and no lastTitle", () => {
    render(
      <SessionRow
        session={makeSession({ command: "npm run build" })}
        onOpen={vi.fn()}
        onEnd={vi.fn()}
      />,
    );
    expect(screen.getByText("npm run build")).toBeTruthy();
  });

  it("shows lastTitle when present and not locked", () => {
    render(
      <SessionRow
        session={makeSession({
          name: "Claude Code · my-project",
          command: "claude -p 'fix bug'",
          lastTitle: "fixing the bug",
        })}
        onOpen={vi.fn()}
        onEnd={vi.fn()}
      />,
    );
    expect(screen.getByText("fixing the bug")).toBeTruthy();
    expect(screen.queryByText("Claude Code · my-project")).toBeNull();
    expect(screen.queryByText("claude -p 'fix bug'")).toBeNull();
  });

  it("shows session.name when nameLocked even with lastTitle present", () => {
    render(
      <SessionRow
        session={makeSession({
          name: "my custom session",
          nameLocked: true,
          command: "claude",
          lastTitle: "ignored osc title",
        })}
        onOpen={vi.fn()}
        onEnd={vi.fn()}
      />,
    );
    expect(screen.getByText("my custom session")).toBeTruthy();
    expect(screen.queryByText("ignored osc title")).toBeNull();
  });

  it("shows monospace class for command fallback, not for lastTitle", () => {
    const { container: cmdContainer } = render(
      <SessionRow
        session={makeSession({ command: "npm test", lastTitle: null })}
        onOpen={vi.fn()}
        onEnd={vi.fn()}
      />,
    );
    expect(cmdContainer.querySelector(".session-name.mono")).toBeTruthy();

    const { container: oscContainer } = render(
      <SessionRow
        session={makeSession({ command: "npm test", lastTitle: "running tests" })}
        onOpen={vi.fn()}
        onEnd={vi.fn()}
      />,
    );
    expect(oscContainer.querySelector(".session-name.mono")).toBeNull();
  });
});

describe("SessionRow status line (issue #167)", () => {
  it("renders no status line when the session has no events yet", () => {
    const { container } = render(
      <SessionRow session={makeSession({})} onOpen={vi.fn()} onEnd={vi.fn()} />,
    );
    expect(container.querySelector(".session-event-line")).toBeNull();
  });

  it("shows the latest event's text, uncolored, for an idle-ish event", () => {
    events = {
      1: [
        {
          seq: 1,
          sessionId: 1,
          kind: "title_change",
          ts: Date.now(),
          payload: { title: "running tests" },
        },
      ],
    };
    const { container } = render(
      <SessionRow session={makeSession({})} onOpen={vi.fn()} onEnd={vi.fn()} />,
    );
    const line = container.querySelector(".session-event-line");
    expect(line?.textContent).toBe("running tests");
    expect(line?.classList.contains("attention")).toBe(false);
  });

  it("shows the latest event's text, colored, for an attention event", () => {
    events = {
      1: [
        {
          seq: 1,
          sessionId: 1,
          kind: "attention",
          ts: Date.now(),
          payload: { attention: true, signal: "bell" },
        },
      ],
    };
    const { container } = render(
      <SessionRow session={makeSession({})} onOpen={vi.fn()} onEnd={vi.fn()} />,
    );
    const line = container.querySelector(".session-event-line");
    expect(line?.textContent).toBe("Bell");
    expect(line?.classList.contains("attention")).toBe(true);
  });

  it("falls back to an earlier describable event when the latest event's shape isn't recognized", () => {
    events = {
      1: [
        {
          seq: 1,
          sessionId: 1,
          kind: "title_change",
          ts: Date.now(),
          payload: { title: "running tests" },
        },
        {
          // A status_change with neither "exited" nor a recognized screen
          // value describeEvent() returns null for — the line should still
          // show the earlier title_change rather than going blank.
          seq: 2,
          sessionId: 1,
          kind: "status_change",
          ts: Date.now(),
          payload: { reason: "something-not-yet-taught" },
        },
      ],
    };
    const { container } = render(
      <SessionRow session={makeSession({})} onOpen={vi.fn()} onEnd={vi.fn()} />,
    );
    const line = container.querySelector(".session-event-line");
    expect(line?.textContent).toBe("running tests");
    expect(line?.classList.contains("attention")).toBe(false);
  });

  it("picks the highest-seq event when several are buffered for a session", () => {
    events = {
      1: [
        {
          seq: 1,
          sessionId: 1,
          kind: "title_change",
          ts: Date.now() - 1000,
          payload: { title: "older title" },
        },
        {
          seq: 2,
          sessionId: 1,
          kind: "status_change",
          ts: Date.now(),
          payload: { reason: "exited" },
        },
      ],
    };
    const { container } = render(
      <SessionRow session={makeSession({})} onOpen={vi.fn()} onEnd={vi.fn()} />,
    );
    expect(container.querySelector(".session-event-line")?.textContent).toBe("Exited");
  });
});
