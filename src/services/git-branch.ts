import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Cheap, always-on branch-name lookup (issue #96) — a pure `.git/HEAD` read,
// no `git` CLI shell-out, same "read-only, never throw, missing file is the
// normal case" philosophy as git-remote.ts (this is the second file in the
// repo that reads .git/* directly rather than shelling out). Deliberately
// separate from git-status.ts's fuller `git status` call: this is cheap
// enough to run on every GET /api/projects — the endpoint already polled by
// the live-refresh loop — while the richer dirty/ahead-behind/file-list view
// (git-status.ts) is reserved for the GitPanel and gated behind its own
// cache.

/**
 * Resolves a checkout's actual git directory. For an ordinary repo that's
 * just `<cwd>/.git`. For a `git worktree` checkout (issue #100 will start
 * creating these), `<cwd>/.git` is a *file* containing `gitdir: <path>`
 * pointing at `<main-repo>/.git/worktrees/<name>` — which has its own
 * independent HEAD, so this must be resolved rather than assumed to be a
 * directory, or every worktree session would silently report the main
 * checkout's branch instead of its own. Never throws; unreadable/malformed
 * is treated the same as "no repo here."
 */
function resolveGitDir(cwd: string): string | null {
  const dotGit = path.join(cwd, ".git");
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(dotGit);
  } catch {
    return null;
  }
  if (stat.isDirectory()) return dotGit;
  if (!stat.isFile()) return null;

  let content: string;
  try {
    content = readFileSync(dotGit, "utf8").trim();
  } catch {
    return null;
  }
  const match = content.match(/^gitdir:\s*(.+)$/);
  if (!match) return null;
  const gitdir = match[1].trim();
  return path.isAbsolute(gitdir) ? gitdir : path.join(cwd, gitdir);
}

/**
 * Reads a checkout's `HEAD` and returns the current branch name, a short
 * detached-HEAD SHA, or `null` when there's no readable branch (not a git
 * repo, unreadable HEAD, or a HEAD content this doesn't recognize). Never
 * throws — matches parseGitRemote's "missing/malformed is exactly 'no repo
 * here'" posture (git-remote.ts).
 */
export function readGitBranch(cwd: string): string | null {
  // Same guard as parseGitRemote (git-remote.ts:57-70) — `cwd` here is
  // always meant to be an already-resolved absolute directory (a project's
  // own `cwd` column, or an agent-side value already passed through
  // resolveWithinRoots), so a relative one is rejected outright rather than
  // resolved against this process's own cwd.
  if (!path.isAbsolute(cwd) || path.normalize(cwd).split(path.sep).includes("..")) {
    return null;
  }
  const gitDir = resolveGitDir(cwd);
  if (!gitDir) return null;
  const headPath = path.join(gitDir, "HEAD");
  if (!existsSync(headPath)) return null;

  let content: string;
  try {
    content = readFileSync(headPath, "utf8").trim();
  } catch {
    return null;
  }

  const refMatch = content.match(/^ref:\s*refs\/heads\/(.+)$/);
  if (refMatch) return refMatch[1];

  // Detached HEAD — `HEAD` holds the checked-out commit's full SHA directly
  // rather than a `ref: ...` line. Short-form (7 chars), matching what
  // `git status`/a terminal prompt would typically show.
  if (/^[0-9a-f]{40}$/i.test(content)) return content.slice(0, 7);

  return null;
}
