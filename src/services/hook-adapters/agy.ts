import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { HookAdapterContext, HookAgentAdapter, HookLaunchPlan } from "./types.js";

// agy (Antigravity CLI) adapter (issue #253). Verified against the
// installed `agy` CLI's own bundled documentation during this PR (the
// `agy-customizations` skill's `docs/hooks.md`, ground truth rather than
// the plan's earlier guesswork):
//
// - Config location: a global `hooks.json` under `~/.gemini/config/`
//   (confirmed via the same customization-root convention agy's own
//   `plugins.json`/`skills.json` use, at `~/.gemini/config/plugins/` — the
//   plan's guess of `~/.gemini/antigravity-cli/hooks.json` was wrong).
// - Schema: DIFFERENT from Claude Code/Codex — top-level keys are
//   arbitrary HOOK NAMES (not a `"hooks"` wrapper), each mapping directly
//   to its event arrays; `Stop`/`PreInvocation`/`PostInvocation` are FLAT
//   arrays of handler objects, while `PreToolUse`/`PostToolUse` use the
//   Claude-Code-style `{matcher, hooks: [...]}` grouped form.
// - No documented hook-trust gate (unlike Codex) — a managed merge here
//   auto-fires with no interactive step required.
//
// Only `Stop` is registered (→ `progress: done`, same as every other
// adapter's turn-end signal). `PostToolUse` (→ `file_change`) is
// DELIBERATELY OMITTED, unlike Claude Code/Codex/OpenCode: the docs'
// PostToolUse payload example only shows `{stepIdx, error, ...common}` —
// no tool name or args field is documented at all, so there is no verified
// field to extract a file path from. Inventing one would mean shipping a
// guess with zero evidence (Codex's apply_patch header format, by
// contrast, is a well-known public format this PR could at least ground
// the parser in). Left for a follow-up once the real payload shape is
// confirmed against a live hook firing (see docs/agent-hooks.md).
// `PreToolUse`/`PermissionRequest`-equivalent gating is deferred to issue
// #178, same reasoning as every other adapter.
//
// Every hook command here runs via `sh -c` as a child of the `agy`
// process (per its own docs) — env-var inheritance down to that
// subprocess is assumed, not verified live (same accepted risk as Codex's
// adapter); if agy's hook subprocess doesn't inherit
// $MULLION_HOOK_SOCKET/$MULLION_HOOK_TOKEN, the forwarder just silently
// no-ops (safe failure mode, not a security or correctness bug).

const AGY_COMMAND_RE = /^(?:\S*\/)?agy(?:\s|$)/;
const MULLION_HOOK_NAME = "mullion-hook-forwarder";

interface AgyHandler {
  type?: string;
  command?: unknown;
  [key: string]: unknown;
}

interface AgyHooksFile {
  [hookName: string]: { Stop?: AgyHandler[]; [key: string]: unknown } | unknown;
}

function resolveAgyHooksPath(): string {
  return path.join(os.homedir(), ".gemini", "config", "hooks.json");
}

function mergeAgyHooks(ctx: HookAdapterContext, hooksPath = resolveAgyHooksPath()): void {
  let existing: AgyHooksFile = {};
  try {
    existing = JSON.parse(readFileSync(hooksPath, "utf8")) as AgyHooksFile;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      // Same posture as codex.ts: a file we can't parse is a file we must
      // not blindly overwrite.
      throw new Error(`cannot parse existing ${hooksPath}, leaving it untouched`, { cause: err });
    }
  }

  const merged: AgyHooksFile = {
    ...existing,
    [MULLION_HOOK_NAME]: {
      Stop: [
        {
          type: "command",
          command: `${JSON.stringify(process.execPath)} ${JSON.stringify(ctx.forwarderPath)} agy Stop`,
          timeout: 10,
        },
      ],
    },
  };

  mkdirSync(path.dirname(hooksPath), { recursive: true });
  writeFileSync(hooksPath, `${JSON.stringify(merged, null, 2)}\n`);
}

function prepareLaunch(ctx: HookAdapterContext): HookLaunchPlan {
  return {
    // async, not a plain wrapper — see codex.ts's identical note: a
    // synchronous throw from mergeAgyHooks must become a rejected promise
    // here, not an exception out of this call itself.
    managedInstall: async () => mergeAgyHooks(ctx),
  };
}

export const agyAdapter: HookAgentAdapter = {
  name: "agy",
  matches: (command) => AGY_COMMAND_RE.test(command.trim()),
  prepareLaunch,
};

/** Exported for tests only — production always uses the real, default
 * `~/.gemini/config/hooks.json` (agy has no documented env var to relocate
 * it, unlike Codex's `CODEX_HOME`). */
export const __testing = { mergeAgyHooks, resolveAgyHooksPath, MULLION_HOOK_NAME };
