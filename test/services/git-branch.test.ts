import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { readGitBranch } from "../../src/services/git-branch.js";

function writeHead(gitDir: string, content: string) {
  fs.mkdirSync(gitDir, { recursive: true });
  fs.writeFileSync(path.join(gitDir, "HEAD"), content);
}

describe("readGitBranch", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-branch-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads a branch name off a symbolic HEAD", () => {
    writeHead(path.join(tmpDir, ".git"), "ref: refs/heads/main\n");
    expect(readGitBranch(tmpDir)).toBe("main");
  });

  it("reads a slashed branch name (e.g. feature/foo)", () => {
    writeHead(path.join(tmpDir, ".git"), "ref: refs/heads/feature/foo\n");
    expect(readGitBranch(tmpDir)).toBe("feature/foo");
  });

  it("returns a short SHA for a detached HEAD", () => {
    writeHead(path.join(tmpDir, ".git"), "abcdef0123456789abcdef0123456789abcdef01\n");
    expect(readGitBranch(tmpDir)).toBe("abcdef0");
  });

  it("returns null for unrecognized HEAD content", () => {
    writeHead(path.join(tmpDir, ".git"), "not a real HEAD file\n");
    expect(readGitBranch(tmpDir)).toBeNull();
  });

  it("returns null when .git/HEAD doesn't exist", () => {
    fs.mkdirSync(path.join(tmpDir, ".git"), { recursive: true });
    expect(readGitBranch(tmpDir)).toBeNull();
  });

  it("returns null when cwd isn't a git repo at all", () => {
    expect(readGitBranch(tmpDir)).toBeNull();
  });

  it("returns null for a relative cwd, even one that would otherwise resolve correctly", () => {
    writeHead(path.join(tmpDir, ".git"), "ref: refs/heads/main\n");
    expect(readGitBranch(path.relative(process.cwd(), tmpDir))).toBeNull();
  });

  it("follows a worktree's .git file to its own gitdir and reads that HEAD", () => {
    // A `git worktree` checkout's `.git` is a *file* containing
    // `gitdir: <path>`, pointing at the main repo's
    // `.git/worktrees/<name>` — which has its own independent HEAD (issue
    // #100's future worktree sessions rely on this resolving correctly).
    const worktreeGitDir = path.join(tmpDir, "main-repo", ".git", "worktrees", "feature");
    fs.mkdirSync(worktreeGitDir, { recursive: true });
    fs.writeFileSync(path.join(worktreeGitDir, "HEAD"), "ref: refs/heads/feature-branch\n");

    const worktreeCheckout = path.join(tmpDir, "feature-checkout");
    fs.mkdirSync(worktreeCheckout, { recursive: true });
    fs.writeFileSync(path.join(worktreeCheckout, ".git"), `gitdir: ${worktreeGitDir}\n`);

    expect(readGitBranch(worktreeCheckout)).toBe("feature-branch");
  });

  it("returns null for a worktree .git file with an unreadable gitdir target", () => {
    const worktreeCheckout = path.join(tmpDir, "broken-worktree");
    fs.mkdirSync(worktreeCheckout, { recursive: true });
    fs.writeFileSync(
      path.join(worktreeCheckout, ".git"),
      `gitdir: ${path.join(tmpDir, "does-not-exist")}\n`,
    );
    expect(readGitBranch(worktreeCheckout)).toBeNull();
  });
});
