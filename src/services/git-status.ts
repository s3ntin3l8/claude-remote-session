import { spawn as spawnChild } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

// The repo's first `git` CLI shell-out (issue #76) — everything else that
// reads git state (git-remote.ts, git-branch.ts) is a pure filesystem read.
// `git status` genuinely needs git's own index/ignore-rule handling (a
// worktree, a submodule, a repo with a non-default `.git` layout — see
// git-branch.ts's resolveGitDir for the worktree case this can't just
// fs-parse around), so this can't follow those files' no-shell-out
// discipline. It still follows their *posture*: best-effort, never throws, a
// missing/non-repo cwd is exactly "nothing to show" (null), not an error.
//
// Always invoked with an argv array (`spawn`, never a shell string) — see
// routes/internal.ts's own comment on why: "spawn/stop always use an argv
// array, never a shell string" is this repo's standing injection guard for
// every child_process call, not just PtyManager's.

export type GitFileStatusCode = "M" | "A" | "D" | "U" | "?";

export interface GitFileStatus {
  path: string;
  status: GitFileStatusCode;
}

export interface GitStatus {
  branch: string;
  hash: string | null;
  ahead: number;
  behind: number;
  files: GitFileStatus[];
  isClean: boolean;
  hasConflicts: boolean;
}

const GIT_TIMEOUT_MS = 5_000;

/** Runs `git -C <cwd> status --porcelain=v2 --branch`, capturing stdout on
 * `'close'` (not `'exit'`) — the same stdout-delivery race documented in
 * pty-manager.ts's isMasterAlive and agent-detect.ts's probe(): `'exit'`
 * only guarantees the process ended, not that every stdout chunk has been
 * delivered. Resolves `null` on any non-zero exit, spawn error, or timeout
 * — "git failed" and "not a git repo" are both just "nothing to show" here. */
function runGitStatus(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    let stdout = "";
    let settled = false;
    const child = spawnChild("git", ["-C", cwd, "status", "--porcelain=v2", "--branch"], {
      stdio: ["ignore", "pipe", "ignore"],
    });

    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(null);
    }, GIT_TIMEOUT_MS);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.on("error", () => finish(null));
    child.on("close", (code) => finish(code === 0 ? stdout : null));
  });
}

// `--porcelain=v2 --branch` line shapes:
//   # branch.oid <sha>|(initial)
//   # branch.head <name>|(detached)
//   # branch.upstream <upstream>        (only when an upstream is set)
//   # branch.ab +<ahead> -<behind>      (only when an upstream is set)
//   1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>              (ordinary)
//   2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <score> <path>\t<orig>  (rename/copy)
//   u <XY> <sub> <m1> <m2> <m3> <mW> <hH> <hI> <hM> <path>    (unmerged)
//   ? <path>                                                   (untracked)
//   ! <path>                                                   (ignored — not emitted without --ignored)
function parsePorcelainV2(output: string): GitStatus {
  let branch = "HEAD";
  let hash: string | null = null;
  let ahead = 0;
  let behind = 0;
  const files: GitFileStatus[] = [];
  let hasConflicts = false;

  for (const line of output.split("\n")) {
    if (line === "") continue;
    if (line.startsWith("# branch.oid ")) {
      const oid = line.slice("# branch.oid ".length).trim();
      hash = oid === "(initial)" ? null : oid.slice(0, 7);
    } else if (line.startsWith("# branch.head ")) {
      branch = line.slice("# branch.head ".length).trim();
    } else if (line.startsWith("# branch.ab ")) {
      const match = line.match(/^# branch\.ab \+(\d+) -(\d+)/);
      if (match) {
        ahead = Number(match[1]);
        behind = Number(match[2]);
      }
    } else if (line.startsWith("1 ") || line.startsWith("2 ")) {
      const fields = line.split(" ");
      const xy = fields[1] ?? "..";
      const filePath = line.startsWith("2 ")
        ? (line.split("\t")[0]?.split(" ").slice(9).join(" ") ?? "")
        : (fields.slice(8).join(" ") ?? "");
      files.push({ path: filePath, status: classifyXY(xy) });
    } else if (line.startsWith("u ")) {
      hasConflicts = true;
      const fields = line.split(" ");
      files.push({ path: fields.slice(10).join(" "), status: "U" });
    } else if (line.startsWith("? ")) {
      files.push({ path: line.slice(2), status: "?" });
    }
  }

  // Detached HEAD: `branch.head` is the literal string "(detached)" rather
  // than a name — fall back to the short oid, matching git-branch.ts's own
  // short-SHA convention for a detached checkout.
  if (branch === "(detached)") branch = hash ?? "HEAD";

  return {
    branch,
    hash,
    ahead,
    behind,
    files,
    isClean: files.length === 0,
    hasConflicts,
  };
}

/** Collapses a two-char XY status code (staged, worktree) down to this
 * feature's simplified single-code taxonomy — prefers the worktree half
 * when both are set (that's the state most visibly "still needs attention"
 * to a user glancing at a badge), falls back to the staged half otherwise. */
function classifyXY(xy: string): GitFileStatusCode {
  const [staged, worktree] = [xy[0] ?? ".", xy[1] ?? "."];
  const active = worktree !== "." ? worktree : staged;
  switch (active) {
    case "A":
      return "A";
    case "D":
      return "D";
    case "M":
    case "R":
    case "C":
    case "T":
      return "M";
    default:
      return "M";
  }
}

/** In-memory `{ cwd → { ts, result } }` cache, mirroring
 * remote-host-client.ts's bulkLiveStatus cache shape — a ~3s TTL (issue
 * #76) so the sidebar's live-refresh poll and an open GitPanel don't each
 * pay for their own `git status` shell-out on every tick. Concurrent misses
 * on the same cwd (a poll tick landing mid-flight of another caller's
 * request) share one child process rather than each spawning their own,
 * same as bulkLiveStatus's in-flight dedup. */
const CACHE_TTL_MS = 3_000;
const cache = new Map<string, { ts: number; result: GitStatus | null }>();
const inFlight = new Map<string, Promise<GitStatus | null>>();

/**
 * Best-effort git status for `cwd`: branch, short hash, ahead/behind vs.
 * upstream, per-file status, and clean/conflict flags — or `null` when
 * `cwd` isn't a git repo (or `git` itself fails). Never throws. Cached for
 * `CACHE_TTL_MS`.
 */
export async function getGitStatus(cwd: string): Promise<GitStatus | null> {
  if (!path.isAbsolute(cwd) || path.normalize(cwd).split(path.sep).includes("..")) {
    return null;
  }
  // Fast, sync existence check — same "no repo, no point spawning git"
  // short-circuit git-branch.ts's own resolveGitDir effectively is, just
  // without needing gitdir resolution here (git itself handles the
  // worktree `.git`-file-vs-directory distinction once actually invoked).
  if (!existsSync(path.join(cwd, ".git"))) return null;

  const cached = cache.get(cwd);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.result;
  }
  const pending = inFlight.get(cwd);
  if (pending) return pending;

  const promise = runGitStatus(cwd)
    .then((output) => {
      const result = output === null ? null : parsePorcelainV2(output);
      cache.set(cwd, { ts: Date.now(), result });
      return result;
    })
    .finally(() => {
      inFlight.delete(cwd);
    });
  inFlight.set(cwd, promise);
  return promise;
}

/** Exported for tests only — production never needs to clear this. */
export function clearGitStatusCacheForTests(): void {
  cache.clear();
  inFlight.clear();
}
