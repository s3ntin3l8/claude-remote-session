# Mullion Roadmap — Central Command for AI-Driven Development

**Status:** Draft
**Last updated:** 2026-07-22
**Vision:** Mullion orchestrates the entire AI-driven development workflow. Describe a task, Mullion spawns the right agent(s), monitors progress, notifies when input is needed, presents diffs for review, and cycles through approval/resubmit — all from one dashboard, replacing the traditional IDE.

---

## Architecture Decisions (Cross-Cutting)

These decisions apply across multiple phases and are established here to avoid re-litigating them later.

| Decision            | Choice                                                                                                         | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Notification model  | In-memory event ring buffer per session, consumed by frontend                                                  | PTY output is already streaming; adding a DB write per event creates write amplification at no benefit for the primary use case (real-time display). DB persistence added later if needed for history/replay.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Agent communication | Two-channel: PTY-parsed (OSC/BEL, works today) + env-injected structured hooks (new)                           | Every agent works via Channel 1. Channel 2 adds rich metadata (progress, file changes, review gates) for agents that support hooks — no agent modification required for basic functionality.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Browser backend     | Playwright Chromium on host, streaming CDP screenshot frames to a `<canvas>`/`<img>` via WebSocket             | Full CDP access for DOM snapshotting, clicking, filling, JS evaluation — the existing `BrowserPanel.tsx` (see Phase 3 design notes) is iframe-based and can't do this; this is a genuinely new rendering path, not an extension of it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| API surface         | HTTP REST (existing) + Unix socket supplement                                                                  | Socket is an alternative transport for a subset of operations, not a separate API. Low-latency PTY I/O and local CLI integration.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Subagent detection  | Preferred: hook-based fork/join signals. Fallback: process-tree polling via `/proc`.                           | Hooks are clean and explicit. Process-tree polling is a no-agent-change-needed fallback. Both emit events into the same notification model.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Event persistence   | In-memory ring buffer for live feed (Phase 1); optional DB for history (Phase 4)                               | Timeline and history clients need queryable event storage. Configurable retention, off by default — no regression for Phase 1's in-memory model. **Gap:** sessions survive redeploys (dtach/systemd) but events don't — a pending 2.7 review gate is lost on restart even though the session it belongs to isn't. Worth pulling minimal persistence forward for gating events specifically; see Phase 2 design notes.                                                                                                                                                                                                                                                                                                     |
| Task source         | GitHub issues with configurable label, polled at interval (no webhooks)                                        | GitHub is the existing integration (issues, PRs, CI — see #102/#221/#222). Polling avoids public-endpoint requirement for webhooks. Task state is derived from issue labels + body; the issue is source of truth. This decision covers _task_ polling only — #221's proposed webhooks are scoped to per-PR CI status, a different endpoint, and don't reopen this decision.                                                                                                                                                                                                                                                                                                                                               |
| Security & trust    | Hook socket requires a per-session token, not just filesystem perms; inbound hook messages are untrusted input | An env-injected socket path is inherited by every child process a session spawns, so any subcommand could forge a `review_gate` or `file_change` event without a token. Same env-leak class that corrupted the repo 3× via leaked `GIT_*` vars (#205) — `buildSessionEnv()`/`git-env.ts` already scrub session env deliberately; the hook channel must not reopen that hole. Applies transitively to Phase 3 (browser cookie import needs scoping/allowlisting — real credential exfil risk if an agent drives the browser to an attacker URL) and Phase 6 (autonomous GitHub-write agents need per-task token scope, a cost/time budget, and a kill-switch beyond the single global `MULLION_TASK_MASTER_ENABLED` flag). |

---

## Phase 1: Richer Notifications

**Goal:** Replace the current `attention: boolean` + `activity: "working" | "idle"` with a full notification event system — structured, multi-channel, and extensible.

### Features

| #   | Feature                                                                                                                                                     | Effort | Depends On |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- |
| 1.1 | Notification event model (backend) — `PtyManager` emits structured events (`kind`, `timestamp`, `payload`) consumed by subscribers                          | M      | —          |
| 1.2 | Per-session status line in sidebar — last event text visible inline                                                                                         | S      | 1.1        |
| 1.3 | Session tab notification badges — count + type icon on workspace tabs                                                                                       | S      | 1.1        |
| 1.4 | Notification panel — slide-out sidebar/overlay listing recent events grouped by workspace                                                                   | L      | 1.1        |
| 1.5 | Desktop notifications via Browser Notification API — fire when tab is unfocused                                                                             | S      | 1.1        |
| 1.6 | Attention-clear heuristics — refine the current `ATTENTION_CLEAR_WINDOW_MS` logic to avoid false positives from rapid BEL/OSC sequences during heavy output | S      | 1.1        |
| 1.7 | Sidebar session row redesign — surface worktree/branch/PR info per session inline, alongside the notification status line from 1.2                          | L      | 1.1, 1.2   |
| 1.8 | Kanban board view — sessions grouped into columns (Running, Needs Attention, Exited) with drag-to-reorder and column counts                                 | M      | 1.1        |

### Design Notes

- Events are in-memory only (ring buffer per session, ~100 events). No DB persistence in Phase 1.
- 1.1 is smaller than it looks: session status today (`pty-manager.ts`'s `SessionInfo`) already carries `attention`, `activity`, `attentionAt`, `lastActivityAt`, and `lastTitle` as poll-derived fields — 1.1 formalizes these into a pushed event stream, it isn't starting from a bare boolean.
- The `kind` enum starts with `attention`, `status_change`, `title_change` and is extended in later phases.
- The frontend notification panel is a new component, not embedded in the existing sidebar. Accessible via a bell icon in the toolbar (existing) but opens a dedicated panel.
- The sidebar redesign (1.7) is the Phase 1 frontend flagship — the notification status line (1.2) and git/worktree/PR info make the session row the primary information surface. Backend work includes per-worktree git status polling, per-branch PR filtering, and branch/worktree enumeration endpoints (`git-refs`).
- Kanban (1.8) is a pure frontend view with no new backend work. Session state transitions from the event model drive card movement between columns. Exists alongside the list view; user toggles between them.

---

## Phase 2: Agent Hook System

**Goal:** Create a structured communication channel from agents to Mullion via environment-injected hooks — delivering rich metadata that PTY parsing alone cannot extract.

### Features

| #   | Feature                                                                                                                                             | Effort | Depends On    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------- |
| 2.1 | `MULLION_HOOK_SOCKET` env injection at session spawn time                                                                                           | M      | —             |
| 2.2 | Hook JSON protocol definition + server-side validation                                                                                              | S      | 2.1           |
| 2.3 | Claude Code hook integration — wire `MULLION_HOOK_SOCKET` into Claude Code's existing hook system                                                   | S      | 2.2           |
| 2.4 | OpenCode hook integration — same for OpenCode's hook system                                                                                         | S      | 2.2           |
| 2.5 | Hook messages routed into the notification event model (Phase 1.1)                                                                                  | S      | 1.1, 2.2      |
| 2.6 | File change events — agent reports modified files via hook, Mullion surfaces them in the sidebar                                                    | M      | 2.5           |
| 2.7 | Minimal review gate — agent emits a `review_gate` event, Mullion shows a pending-review indicator, user can approve/deny via the notification panel | M      | 2.5, 1.4      |
| 2.8 | Session timeline — chronological per-session detail panel showing agent output, file changes, branch switches, review gates, and attention state    | L      | 2.6, 2.7, 1.1 |

### Design Notes

- No filesystem modifications (no dotfile writes, no agent config changes). Everything is environment injection at spawn time.
- Agents that don't support hooks continue to work perfectly via PTY-parsed channel (Phase 1 covers those).
- Hook messages are JSON over a Unix socket (`MULLION_HOOK_SOCKET`) — the agent writes one JSON object per line. Mullion's socket listener is lightweight (single-threaded read loop, non-blocking).
- The review gate is the first step toward the long-term Task → Agent → Review loop vision.
- The session timeline (2.8) is the per-session detail view, complementing the notification panel (1.4) which is the condensed cross-session feed. Clicking a session opens its timeline.
- Worktree hook investigation: the hook protocol (2.2) should define optional `worktree` messages (`{"kind":"worktree","action":"create|switch","branch":"..."}`) so agents can signal worktree intent without Mullion managing worktrees itself. This exploration determines whether worktree tracking graduates to a Phase 5 feature or remains passive sidebar instrumentation (1.7).
- 2.3/2.4 are spikes, not confirmed-S work: Claude Code hooks are registered via `settings.json` (`PreToolUse`/`Stop`/`Notification`/…), not via environment variables — env-injecting `MULLION_HOOK_SOCKET` alone won't make Claude Code call it. 2.3 likely needs Mullion to write (and clean up) a hook config, which contradicts the "no agent config changes" note above; that contradiction needs resolving before scoping. 2.4 needs the same verification against OpenCode's actual hook surface before its effort estimate is trustworthy.
- Review-gate persistence: a `review_gate` event (2.7) is a pending user decision, not just a log line — unlike the rest of the Phase 1 event model, losing it on a server restart is a regression (the session it gates survives redeploys; the gate itself currently wouldn't). Consider a minimal persisted table for open gates only, ahead of Phase 4's general event history (4.7).

---

## Phase 2.5: Task Master — Thin Slice

**Goal:** Prove the core task→agent→review→PR loop end-to-end, behind the same flag as the full Task Master, before investing in Browser/Socket/Subagents. Pulled forward from Phase 6 specifically to de-risk the rest of the roadmap: if the loop doesn't feel right, better to learn that now than after three more phases.

**Gate:** `MULLION_TASK_MASTER_ENABLED=false` (default off) — the same flag Phase 6 uses. Turning it on gets you this slice; Phase 6 hardens it further behind the same switch, no new flag needed.

### Features

| #     | Feature                                                                                                                                                        | Effort | Depends On |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- |
| 2.5.1 | Task watcher (minimal) — background poller for issues with the task label (default `mullion-task`); every task requires manual claim, no auto-claim branch yet | S      | —          |
| 2.5.2 | Agent spawner (minimal) — creates a session with the issue title + body as the initial prompt, tagged with the source issue for cross-reference                | S/M    | 2.5.1      |
| 2.5.3 | Manual claim (minimal) — a claim action wired into existing UI (sidebar/dock), not a new dockview panel; invokes 2.5.2's spawner directly                      | S      | 2.5.2      |
| 2.5.4 | Review & manual PR — no new code: review the agent's work in the existing session/git/GitHub panels, open the PR by hand                                       | XS     | 2.5.3      |

### Design Notes

- Deliberately excludes the machinery Phase 6 adds later: no task state machine or `/api/tasks` REST surface (6.2), no GitHub label/comment sync automation (6.4), no dedicated Tasks panel (6.5), no automated Task → PR promotion (6.7). Those remain in Phase 6 as the hardening pass once the slice has validated the concept.
- Does **not** depend on Phase 2's review gate (2.7) or hook socket (2.1) — task-prompt injection here is a plain environment variable at spawn time, same mechanism the roadmap already uses elsewhere before hooks exist. This is what makes pulling it forward possible: it only needs Phase 1/2 to be _stable_, not for 2.7 specifically to have shipped.
- Issues #214, #216, #219 (previously Phase 6's 6.1/6.3/6.6) are retargeted into this slice as 2.5.1/2.5.2/2.5.3, moved to this milestone, and trimmed of their Phase-6-only dependencies (state machine, hook socket, Tasks panel). The 6.1/6.3/6.6 numbers are retired in Phase 6; the corresponding hardening work is folded into 6.2 (state machine formalizes 2.5.1's polling) and 6.5 (Tasks panel replaces 2.5.3's ad hoc claim UI).

---

## Phase 3: Controllable Browser

**Goal:** An in-app browser pane that agents can script — navigate, snapshot the DOM, click elements, fill forms, evaluate JavaScript — alongside terminal panes in the dockview layout. **Primary motivation:** let agents verify their own work (load a page, click through a flow, confirm a UI change) against a browser Mullion controls, instead of depending on the user's local machine and its browser to do that verification.

### Features

| #   | Feature                                                                                                                                        | Effort | Depends On |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- |
| 3.1 | Playwright browser manager (backend) — pool of Chromium processes, lifecycle management                                                        | L      | —          |
| 3.2 | WebSocket frame streaming — browser frames streamed from Playwright to frontend via WebSocket                                                  | M      | 3.1        |
| 3.3 | `BrowserPane` dockview component — CDP-frame-rendering panel with URL bar, back/forward, reload controls                                       | M      | 3.2        |
| 3.4 | Session-to-browser binding — associate a browser pane with a session, agents target their session's browser                                    | S      | 3.3, 3.1   |
| 3.5 | Agent browser automation API — `POST /api/sessions/:id/browser` with actions: `navigate`, `snapshot`, `click`, `fill`, `eval`, `screenshot`    | L      | 3.3, 3.1   |
| 3.6 | Cookie/session import — import cookies from the user's real browser (Chrome/Firefox profiles) so agent-controlled browser starts authenticated | M      | 3.5        |

### Design Notes

- Not greenfield: `frontend/src/BrowserPanel.tsx` already ships as an iframe-based preview pane, backed by a server-side proxy (`preview-host.ts`, `preview-registry.ts`, `http-proxy.ts`) for both the project's dev server and external URLs. Phase 3 is "add a CDP-controllable pane," not "add a browser pane" — decide whether `BrowserPanel` is replaced, or kept as the lightweight (non-agent-controlled) preview mode alongside the new `BrowserPane`.
- Issue #110 ("Browser panel not persisted in layout") is filed against the existing `BrowserPanel` and is a stated prerequisite for 3.3 — see the Phase 3 row in Pre-Existing Issues below.
- Playwright launches a Chromium instance per project (or per workspace, configurable). The instance persists across pane open/close — closing the pane doesn't kill the browser.
- Frame streaming: Playwright's CDP screenshots are pushed via WebSocket to the frontend at ~5fps (configurable) and rendered to a `<canvas>`/`<img>` — **not an iframe**; CDP screenshot frames are images, not DOM, so there's nothing for an iframe to host. User interactions (clicks on the canvas) are proxied back through the WebSocket to Playwright.
- The agent automation API is the bridge between the agent's chat context and the browser. When an agent says "I'll open the preview", it sends a `navigate` action via Mullion's API, and the browser pane updates.
- Combined with Phase 2 hooks: an agent could emit `{"kind":"browser_request","action":"navigate","url":"http://localhost:5173"}` via the hook socket, and Mullion opens the URL in the project's browser pane.

---

## Phase 4: Socket API

**Goal:** A local Unix socket for low-latency, programmatic control of Mullion — supplementing the existing HTTP REST API.

### Features

| #   | Feature                                                                                                 | Effort | Depends On |
| --- | ------------------------------------------------------------------------------------------------------- | ------ | ---------- |
| 4.1 | Unix socket transport — single socket at `$MULLION_SOCKET_PATH`, JSON message framing                   | M      | —          |
| 4.2 | PTY I/O over socket — subscribe to session output, write keystrokes                                     | M      | 4.1        |
| 4.3 | Session lifecycle over socket — create, kill, list, inspect sessions                                    | S      | 4.1        |
| 4.4 | Session status / notification events over socket — subscribe to real-time events from Phase 1           | S      | 4.1, 1.1   |
| 4.5 | Browser actions over socket — trigger navigate/snapshot/click on browser panes                          | S      | 4.1, 3.5   |
| 4.6 | CLI client — `mullion exec <command>` opens session, streams output to stdout, forwards stdin           | M      | 4.2, 4.3   |
| 4.7 | Unified session history — persistent event storage with search/filter; CLI queryable via `mullion logs` | L      | 4.1        |

### Design Notes

- Every socket operation has an HTTP equivalent. The socket is not a separate API — it's an alternative transport.
- Auth via filesystem permissions (`0600`) + optional embedded token from the parent process's environment.
- Message framing matches the existing WebSocket terminal protocol (JSON header with length prefix) so client code can be shared.
- The CLI client is the primary consumer (`mullion exec`, `mullion ps`, `mullion logs`).
- Event storage for history (4.7) is opt-in with configurable retention (default: off, matching Phase 1's in-memory model). When enabled, events are written to the existing SQLite DB in a new `session_events` table. The live event ring buffer (Phase 1) continues to operate independently regardless of persistence settings.

---

## Phase 5: Subagent / Fork Awareness

**Goal:** Detect when an agent spawns subprocesses (teammates, parallel tasks, subagents) and visualize them as distinct sessions with parent-child relationships.

### Features

| #   | Feature                                                                                                                                | Effort | Depends On |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- |
| 5.1 | Hook-based fork/join signals — agents emit `{"kind":"fork","childPid":1234}` and `{"kind":"join","childPid":1234}` via the hook socket | S      | 2.2        |
| 5.2 | Process-tree polling fallback — `/proc`-based detection of child processes under a session's PID (no agent hooks needed)               | M      | —          |
| 5.3 | Subagent session model — forked subagents get `Session` objects in `PtyManager`, linked to parent                                      | M      | 5.1, 5.2   |
| 5.4 | Automatic subagent layout — dockview auto-arranges child sessions alongside parent (grid layout)                                       | M      | 5.3        |
| 5.5 | Hierarchical sidebar view — sidebar toggle between flat (all independent) and hierarchical (parent/child grouped)                      | M      | 5.3, 1.4   |
| 5.6 | Individual subagent control — kill, monitor, review each subagent independently from the parent                                        | S      | 5.3        |

### Design Notes

- Subagents detected via hooks are preferred (explicit, reliable). Process-tree polling is a fallback for agents that don't emit hooks.
- Subagent sessions share the parent's project and working directory but get their own `Session` object, PTY, and dtach persistence.
- Layout strategy for multiple subagents: dockview's `addGroup` with automatic arrangement. The parent session retains its original position; children spread to fill available space.
- Closing a subagent pane kills only that subagent. Closing the parent offers a choice: kill all children, detach children as independent sessions, or prompt per-child.

---

## Phase 6: Task Master — Full

**Goal:** Harden the Phase 2.5 thin slice into the full autonomous loop: a real task state machine, GitHub issue state sync, a dedicated Tasks panel, and automated Task → PR promotion. Phase 2.5 proves the concept works; Phase 6 makes it production-grade and auto-claimable.

**Gate:** `MULLION_TASK_MASTER_ENABLED=false` (default off). When disabled, the task watcher is inert and no dashboard UI changes appear.

### Features

| #   | Feature                                                                                                                                                                  | Effort | Depends On                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------------------------------------------ |
| 6.2 | Task state machine + REST API — `GET /api/tasks`, `GET /api/tasks/:id`, `POST /api/tasks/:id/claim`; states: Pending → Claimed → In Progress → Reviewing → Done / Failed | M      | 2.5.1 (thin-slice watcher, being replaced) |
| 6.4 | GitHub issue state sync — auto-update labels (`mullion-claimed`, `mullion-done`), add progress comments, assign task to the agent's identity                             | S      | 2.5.1                                      |
| 6.5 | Tasks panel (frontend) — dockview panel listing tasks across all projects, grouped by status; each row shows title, status badge, linked session, agent name             | L      | 6.2                                        |
| 6.7 | Task → PR promotion — on user approval, create a PR from the agent's branch, add `mullion-done` label, close the issue; on rejection, return to In Progress              | M      | 6.2, 2.7 (review gate)                     |

_(6.1, 6.3, 6.6 retired — hardened into 2.5.1/2.5.2/2.5.3 and pulled forward into Phase 2.5.)_

### Design Notes

- Builds on Phase 2.5 (Thin Slice) rather than starting from scratch: the watcher, spawner, and claim mechanism already exist in minimal form (2.5.1/2.5.2/2.5.3). Phase 6 no longer has its own 6.1/6.3/6.6 — that hardening work is folded into 6.2 (state machine, formalizing the watcher) and 6.5 (Tasks panel, replacing the ad hoc claim UI).
- Tasks are **GitHub issues as the source of truth** — the issue is the authoritative record. Mullion's task state is a cache derived from the issue label + body fields.
- Task context injection: issue title becomes the instruction, body becomes the spec/context. Passed as initial prompt via `MULLION_HOOK_SOCKET` (Phase 2) or environment variable at session spawn.
- The `Manual: true` field in the issue body bypasses auto-claim — the task sits in Pending until a user clicks "Claim" in the dashboard.
- Phase 6 ties together the entire roadmap: notifications (Phase 1) for task state changes, hooks (Phase 2) for agent progress, the review gate (2.7) for approval, the timeline (2.8) for task detail, the socket API (Phase 4) for CLI task commands, and subagents (Phase 5) for complex multi-file tasks.
- No worktree management — the agent handles its own working directory. Mullion observes via worktree hook messages (Phase 2 design note).
- Polling only, matching the existing GitHub integration pattern. Webhook support is a future enhancement.
- Non-GitHub backends are out of scope for Phase 6.

---

## Long-Term: Post-Phase 6

Once the Task Master is operational, the remaining frontier is **team-scale orchestration**:

- Multi-user task queues — multiple developers submitting and reviewing tasks
- Task dependencies — a task blocks on another's completion
- Scheduled/recurring tasks — e.g. "run dependency update every Monday"
- Non-GitHub backends — GitLab, Bitbucket, Jira, Linear

These are not yet scoped into phases.

---

## Dependency Graph

```
Phase 1 (Notifications)
  ├── 1.8 (Kanban) — session state transitions from event model
  ├── Phase 2 (Hooks) — uses notification event model for hook message delivery
  │     ├── 2.8 (Timeline) — draws from file changes (2.6) + review gates (2.7)
  │     ├── Phase 2.5 (Task Master — Thin Slice) — needs Phase 1/2 stable, NOT the hook
  │     │     socket or review gate specifically (spawn-time env var, not hooks)
  │     │     └── Phase 6 (Task Master — Full) — hardens the thin slice: state machine,
  │     │           GitHub sync, Tasks panel, automated promotion (needs review gate 2.7)
  │     ├── Phase 3 (Browser) — hook system triggers browser actions
  │     ├── Phase 4 (Socket API) — notification events streamed over socket
  │     └── Phase 5 (Subagents) — hook system provides fork/join signals
  └── Phase 4 (Socket API) — notification events streamed over socket
        ├── 4.7 (History) — persistent event storage, CLI queryable
        └── Phase 5 (Subagents) — subagent events streamed over socket

Phase 2.5 (Thin Slice) requires: GitHub integration + Phase 1 + Phase 2 (stable, not specific features)
Phase 6 (Full) requires: Phase 2.5 (Thin Slice) + 2.7 (review gate)
Phase 6 benefits from but does NOT require: Phase 3 (Browser), Phase 5 (Subagents) — see Sequencing Rationale
```

Each phase is independently shippable. Later phases consume events produced by earlier ones but don't block them.

---

## Sequencing Rationale

Notifications first because:

1. It improves the existing UX immediately — no new agent integration needed
2. It creates the event model that every subsequent phase consumes
3. It's the smallest scope with the highest visibility impact

Hooks second because:

1. They feed richer data into the Phase 1 event model
2. They unlock the review gate (the core of the vision)
3. They're additive to the existing PTY-parsed channel — no regression risk

Task Master (Thin Slice) pulled forward to right after Hooks because:

1. It's the payoff the whole roadmap is building toward — proving it early, cheaply, validates every phase that follows before they're built
2. It only needs Phase 1/2 to be _stable_, not any specific Phase 2 feature (no hook socket, no review gate) — so it doesn't actually wait on anything Browser/Socket/Subagents would otherwise gate it behind
3. It ships behind the same flag as the full Task Master (Phase 6), so it's a no-regression, opt-in addition
4. If the core loop doesn't feel right, that's cheap to learn now and expensive to learn after three more phases of infrastructure investment

Browser third because:

1. Agents need to verify their own work — load a page, click through a flow, confirm a UI change — against a browser Mullion controls, not the user's local machine's browser; this is what actually closes the verification gap in the agent loop
2. It's the largest-scope phase and benefits most from having hooks in place
3. The hook system lets agents trigger browser actions without code changes
4. The frame-streaming infrastructure is independent of the notification model

Socket API fourth because:

1. The socket surface is defined by the features already built (notifications, hooks, browser)
2. It's primarily a transport/ergonomics improvement over existing REST endpoints
3. The CLI client unlocks scripting workflows

Subagents last because:

1. It depends on the hook protocol (Phase 2) for the clean implementation path
2. It's the most speculative — process-tree polling may need tuning against real agent behavior
3. The visualization decisions benefit from settled notification UI patterns (Phase 1)

Task Master (Full) last because:

1. The core loop already shipped early as the Phase 2.5 Thin Slice — Phase 6 is the hardening pass (state machine, GitHub sync, dedicated panel, automated promotion), not the first proof of the concept
2. It integrates every preceding phase — it's the workflow that makes them useful together
3. It depends on hooks (Phase 2) for agent progress reporting and the review gate (2.7) for automated approval
4. It's gated by the same flag as the Thin Slice, so it can ship as soon as it's ready without waiting for Phases 3-5

---

## Pre-Existing Issues Mapped to Roadmap

These open issues from before the roadmap was established map directly into specific phases. They've been updated with milestone + phase label assignments to reflect their place in the timeline.

### Phase 1

| Issue                                                                                                                    | How it fits                                                                                                                      | Status                         |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| [#98](https://github.com/s3ntin3l8/mullion-session-manager/issues/98) — Visual highlights for panels needing interaction | Core frontend design for attention-state visualization. Feeds into 1.1 (event model) and 1.4 (notification panel).               | Milestone + `phase-1` assigned |
| [#97](https://github.com/s3ntin3l8/mullion-session-manager/issues/97) — TUI activity detection false positives           | Root cause analysis and remaining fixes (1/2/4) map to 1.6 (attention-clear heuristics). Fix 3 (lastUserInputAt) already merged. | Closed — superseded by 1.6     |
| [#95](https://github.com/s3ntin3l8/mullion-session-manager/issues/95) — Mobile PWA push notifications                    | Uses Push API rather than Phase 1's browser Notification API. Parallel track — needs service worker infrastructure (#87) first.  | Kept open, unassigned          |
| [#211](https://github.com/s3ntin3l8/mullion-session-manager/issues/211) — Kanban board view (1.8)                        | Pure frontend alternative to list view, driven by event model state transitions.                                                 | Milestone + `phase-1` assigned |

### Phase 2

| Issue                                                                                            | How it fits                                                                                                           | Status                         |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| [#212](https://github.com/s3ntin3l8/mullion-session-manager/issues/212) — Session timeline (2.8) | Per-session detail panel fed by hook-sourced file changes and review gates. Complements the notification panel (1.4). | Milestone + `phase-2` assigned |

### Phase 2.5 (Task Master — Thin Slice)

Pulled forward from Phase 6 — see the Phase 2.5 section above and the Sequencing Rationale for why.

| Issue                                                                                                                            | How it fits                                                                                   | Status                                       |
| -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------- |
| [#214](https://github.com/s3ntin3l8/mullion-session-manager/issues/214) — 2.5.1: Task watcher service (minimal, thin slice)      | Retargeted from Phase 6's 6.1. Trimmed of the state-machine dependency for the thin slice.    | Retargeted, milestone + `phase-2.5` assigned |
| [#216](https://github.com/s3ntin3l8/mullion-session-manager/issues/216) — 2.5.2: Agent spawner (minimal, thin slice)             | Retargeted from Phase 6's 6.3. Trimmed of the hook-socket dependency; uses a plain env var.   | Retargeted, milestone + `phase-2.5` assigned |
| [#219](https://github.com/s3ntin3l8/mullion-session-manager/issues/219) — 2.5.3: Manual claim (minimal, thin slice)              | Retargeted from Phase 6's 6.6. Trimmed of the Tasks-panel dependency; wired into existing UI. | Retargeted, milestone + `phase-2.5` assigned |
| [#224](https://github.com/s3ntin3l8/mullion-session-manager/issues/224) — 2.5.4: Review & manual PR via existing UI (thin slice) | New. No code — validates the loop using existing session/git/GitHub panels.                   | Milestone + `phase-2.5` assigned             |

### Phase 3

| Issue                                                                                                           | How it fits                                                                                                                    | Status                         |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| [#110](https://github.com/s3ntin3l8/mullion-session-manager/issues/110) — Browser panel not persisted in layout | Must be fixed before or alongside 3.3 (BrowserPane component). Without layout persistence, browser panes don't survive reload. | Milestone + `phase-3` assigned |

### Phase 4

| Issue                                                                                                             | How it fits                                                                                                                                   | Status                         |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| [#134](https://github.com/s3ntin3l8/mullion-session-manager/issues/134) — mullion CLI, MCP server, auto-detection | CLI component maps directly to 4.6 (CLI client). MCP server extends the socket/API concept. Auto-detection is a Phase 2-adjacent enhancement. | Milestone + `phase-4` assigned |
| [#213](https://github.com/s3ntin3l8/mullion-session-manager/issues/213) — Unified session history (4.7)           | Persistent event storage, search/filter, CLI queryable via `mullion logs`. Opt-in with configurable retention.                                | Milestone + `phase-4` assigned |

### Phase 6

| Issue                                                                                                         | How it fits                                                                                                                                             | Status                         |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| [#215](https://github.com/s3ntin3l8/mullion-session-manager/issues/215) — Task state machine + REST API (6.2) | Task lifecycle: Pending → Claimed → In Progress → Reviewing → Done/Failed. REST endpoints for claim/approve/reject. Formalizes 2.5.1's minimal watcher. | Milestone + `phase-6` assigned |
| [#217](https://github.com/s3ntin3l8/mullion-session-manager/issues/217) — GitHub issue state sync (6.4)       | Updates labels, comments, assignee on the GitHub issue as task progresses.                                                                              | Milestone + `phase-6` assigned |
| [#218](https://github.com/s3ntin3l8/mullion-session-manager/issues/218) — Tasks panel frontend (6.5)          | Dockview panel listing tasks grouped by status. Detail view with embedded timeline and action buttons. Replaces 2.5.3's ad hoc claim UI.                | Milestone + `phase-6` assigned |
| [#220](https://github.com/s3ntin3l8/mullion-session-manager/issues/220) — Task → PR promotion (6.7)           | On approval, create PR from agent's branch, close issue with `mullion-done` label. On rejection, return to In Progress. Automates 2.5.4's manual step.  | Milestone + `phase-6` assigned |

_(6.1, 6.3, 6.6 — see #214/#216/#219, retargeted into Phase 2.5 above.)_

### Cross-Cutting / Standalone

| Issue                                                                                                                                            | How it fits                                                                                                                                                                                                                                                                                                                                                                                                           | Status                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| [#157](https://github.com/s3ntin3l8/mullion-session-manager/issues/157) — Secure Agent Lifecycle & Discovery                                     | Multi-host auth and HMAC-signed requests. Relevant when multi-host becomes a priority but not blocking any current phase.                                                                                                                                                                                                                                                                                             | Kept open, unassigned       |
| [#102](https://github.com/s3ntin3l8/mullion-session-manager/issues/102) — Per-PR CI/CD status — Phase 1: traffic light + expandable details      | Standalone GitHub-integration enhancement (existing `github.ts` REST client already fetches issues/PRs/CI — this extends it to per-PR runs with a server-side poller). Implemented in [PR #223](https://github.com/s3ntin3l8/mullion-session-manager/pull/223) (open). Relevant to Task Master as a readiness signal for 6.7 (Task → PR promotion) and the review gate (2.7), though not a hard dependency of either. | PR #223 open, merge pending |
| [#221](https://github.com/s3ntin3l8/mullion-session-manager/issues/221) — Per-PR CI/CD status — Phase 2: webhooks, job-level detail, inline logs | Follow-up to #102. Webhooks here are scoped to CI-status push delivery only — see the Task-source architecture decision above, which is unaffected.                                                                                                                                                                                                                                                                   | Kept open, unassigned       |
| [#222](https://github.com/s3ntin3l8/mullion-session-manager/issues/222) — Per-PR CI/CD status — Phase 1 follow-up: remote-hosted project support | Follow-up to #102; #102's Phase 1 skips remote-hosted projects (no local `.git/config` to resolve owner/repo from). Shares the "GitHub repo reference for remote-hosted projects" gap with the existing `/github` endpoint (#27).                                                                                                                                                                                     | Kept open, unassigned       |
| [#60](https://github.com/s3ntin3l8/mullion-session-manager/issues/60) — GitHub App investigation                                                 | Research task for webhooks vs. polling generally. Not blocking; #221 is a narrower, already-scoped instance of the same question for CI status specifically.                                                                                                                                                                                                                                                          | Kept open, unassigned       |

### Prod Bugs (fix regardless of roadmap timing)

| Issue                                                                                                                     | Priority |
| ------------------------------------------------------------------------------------------------------------------------- | -------- |
| [#162](https://github.com/s3ntin3l8/mullion-session-manager/issues/162) — Worktree staleness on long-open windows         | Medium   |
| [#122](https://github.com/s3ntin3l8/mullion-session-manager/issues/122) — Ctrl+V image paste broken on Linux/Windows      | Low      |
| [#121](https://github.com/s3ntin3l8/mullion-session-manager/issues/121) — Floating peek panels: no close, no drag-drop    | Low      |
| [#107](https://github.com/s3ntin3l8/mullion-session-manager/issues/107) — Claude Code TUI display: prompt lines disappear | Low      |
| [#94](https://github.com/s3ntin3l8/mullion-session-manager/issues/94) — Scrollbar thumb size/position off                 | Low      |
| [#91](https://github.com/s3ntin3l8/mullion-session-manager/issues/91) — Terminal pane visual border/theming               | Low      |
| [#85](https://github.com/s3ntin3l8/mullion-session-manager/issues/85) — Mobile UI loads desktop split view                | Low      |
