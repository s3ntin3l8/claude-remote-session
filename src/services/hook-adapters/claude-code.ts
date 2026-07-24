import path from "node:path";
import type { HookAdapterContext, HookAgentAdapter, HookLaunchPlan } from "./types.js";

// Claude Code adapter (issue #174, gate hook added in issue #178). Registers
// four hooks: Notification, Stop, PostToolUse (mapped by the forwarder to
// hook-protocol `notification`/`progress:done`/`file_change` messages — see
// src/hooks/forwarder.mjs) and PreToolUse (the blocking review gate).
//
// PreToolUse is gated to `matcher: "Bash"` ONLY — deliberately narrower than
// "every tool call". Mullion's hook system is on by default (see the plan's
// "Decisions locked with the user"), so gating every tool call would by
// default pause every Claude Code session's normal edit-heavy workflow for
// up to GATE_HOOK_TIMEOUT_SECONDS on every single Write/Edit/Read, breaking
// the "autonomous dashboard" value prop this whole app exists for. Bash is
// the one tool whose blast radius (arbitrary shell execution) makes a
// human-in-the-loop pause worth that cost by default; file edits stay
// fire-and-forget via the existing PostToolUse observational hook. Making
// the gated tool set configurable is a natural follow-up, not built here —
// see this PR's description.
//
// Verified against Claude Code's own documented hooks JSON contract
// (PreToolUse's `hookSpecificOutput.permissionDecision` shape — see
// forwarder-core.mjs's mapClaudeCodePreToolUse/formatClaudeCodeGateDecision)
// — NOT verified against a live PreToolUse hook actually firing end-to-end
// in this PR (same "no live agent turn available in this sandbox" gap as
// PR6/PR7's own dialects); the forwarder-side round-trip is covered by
// forwarder.test.ts's fake-socket-server gating tests instead.
//
// Verified this session (see the plan's Context section): Claude Code has no
// env-var hook-config mechanism, so `--settings <file>` is the only way to
// inject hooks without writing into `~/.claude` or the target repo. That
// makes this adapter's `commandTransform` the ONE deliberate, narrow
// exception to CLAUDE.md's "the backend never parses a shell command line"
// invariant — scoped to appending one flag, and only once `matches()` has
// confirmed this is an unchained, literal `claude ...` invocation.

// Anchored at the start of the trimmed command, optionally path-qualified
// (`/usr/local/bin/claude`), followed by a space or end-of-string — same
// conservative "no partial/substring match" posture as agent-detect.ts's
// KNOWN_AGENTS probing. Combined with the shell-metacharacter check below,
// this is deliberately narrower than "the command contains claude somewhere"
// so `--settings` is only ever appended to a simple, unchained invocation.
const CLAUDE_COMMAND_RE = /^(?:\S*\/)?claude(?:\s|$)/;
// Any of these anywhere in the command means it's not a simple invocation
// (a pipeline, a chain, redirection, or a second command) — appending
// `--settings <path>` to the raw string in that case could attach the flag
// to the wrong part of the chain instead of to `claude` itself.
const SHELL_METACHARACTERS_RE = /[;&|<>]/;

// Issue #178 — a blocking gate needs long enough for an actual human to
// notice the amber review indicator and click Approve/Deny, not just enough
// to stop a wedged process (see the fire-and-forget hooks' timeout: 10
// below). Claude Code's own default PreToolUse hook timeout is confirmed
// (see the plan's PR9 timeout note) to be 600s and to fail CLOSED (block,
// not silently allow) on expiry — 300s here stays comfortably under that so
// Mullion's own server-side timeout (hooks.ts's GATE_TIMEOUT_MS) controls
// the fail-closed decision instead of leaving it to Claude Code's own,
// less-informative expiry behavior.
const GATE_HOOK_TIMEOUT_SECONDS = 300;

function hookEntry(
  execPath: string,
  forwarderPath: string,
  kind: string,
  timeoutSeconds: number = 10,
) {
  return {
    hooks: [
      {
        type: "command" as const,
        command: `${JSON.stringify(execPath)} ${JSON.stringify(forwarderPath)} claude-code ${kind}`,
        // Generous but bounded: these are fire-and-forget notifications, not
        // gates, so nothing downstream is waiting on this — the timeout only
        // exists to stop a wedged forwarder process from lingering forever.
        // (PreToolUse's own call site below overrides this with the much
        // longer GATE_HOOK_TIMEOUT_SECONDS.)
        timeout: timeoutSeconds,
      },
    ],
  };
}

/** Exported for tests. Builds the Claude Code `--settings` JSON contents —
 * pure, no I/O — see the file header for why PreToolUse is absent. */
export function buildClaudeHookSettings(
  forwarderPath: string,
  execPath: string = process.execPath,
) {
  return {
    hooks: {
      Notification: [hookEntry(execPath, forwarderPath, "Notification")],
      Stop: [hookEntry(execPath, forwarderPath, "Stop")],
      PostToolUse: [
        {
          // Restricted to the file-editing tools — the only ones the
          // forwarder maps to a `file_change` message (see forwarder-core's
          // mapPostToolUse). Other tools still run without a hook attached
          // at all, cheaper than invoking the forwarder just to no-op.
          matcher: "Write|Edit|MultiEdit|NotebookEdit",
          ...hookEntry(execPath, forwarderPath, "PostToolUse"),
        },
      ],
      PreToolUse: [
        {
          // Bash only — see this file's header comment for why.
          matcher: "Bash",
          ...hookEntry(execPath, forwarderPath, "PreToolUse", GATE_HOOK_TIMEOUT_SECONDS),
        },
      ],
    },
  };
}

function prepareLaunch(ctx: HookAdapterContext): HookLaunchPlan {
  const settingsPath = path.join(ctx.sessionsDir, `${ctx.sessionId}.hooks.json`);
  const settings = buildClaudeHookSettings(ctx.forwarderPath);
  return {
    settingsFiles: [{ path: settingsPath, contents: JSON.stringify(settings, null, 2) }],
    commandTransform: (command) => `${command} --settings ${JSON.stringify(settingsPath)}`,
  };
}

export const claudeCodeAdapter: HookAgentAdapter = {
  name: "claude-code",
  matches: (command) => {
    const trimmed = command.trim();
    return CLAUDE_COMMAND_RE.test(trimmed) && !SHELL_METACHARACTERS_RE.test(trimmed);
  },
  prepareLaunch,
};
