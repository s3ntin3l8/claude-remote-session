// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { GitPanel } from "./GitPanel.js";
import type { GitStatus } from "./api.js";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const CLEAN_STATUS: GitStatus = {
  branch: "main",
  hash: "abc1234",
  ahead: 0,
  behind: 0,
  files: [],
  isClean: true,
  hasConflicts: false,
};

describe("GitPanel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the branch, hash, and a clean-tree message once loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse(200, CLEAN_STATUS))),
    );
    render(<GitPanel params={{ projectId: 1 }} />);

    expect(await screen.findByText("main")).toBeInTheDocument();
    expect(screen.getByText("abc1234")).toBeInTheDocument();
    expect(screen.getByText("Working tree clean")).toBeInTheDocument();
    expect(screen.getByText("Clean")).toBeInTheDocument();
  });

  it("shows a not-applicable message on a 204 response, without listing anything", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
    );
    render(<GitPanel params={{ projectId: 2 }} />);

    expect(await screen.findByText(/Not a git repository/)).toBeInTheDocument();
  });

  it("degrades to the not-applicable message on a fetch error too", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network down"))),
    );
    render(<GitPanel params={{ projectId: 3 }} />);

    expect(await screen.findByText(/Not a git repository/)).toBeInTheDocument();
  });

  it("lists changed files with their status code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          jsonResponse(200, {
            ...CLEAN_STATUS,
            isClean: false,
            files: [
              { path: "src/a.ts", status: "M" },
              { path: "src/new.ts", status: "?" },
            ],
          }),
        ),
      ),
    );
    render(<GitPanel params={{ projectId: 4 }} />);

    expect(await screen.findByText("Changes (2)")).toBeInTheDocument();
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    expect(screen.getByText("src/new.ts")).toBeInTheDocument();
  });

  it("shows ahead/behind counts when they differ from zero", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse(200, { ...CLEAN_STATUS, ahead: 2, behind: 1 }))),
    );
    render(<GitPanel params={{ projectId: 5 }} />);

    expect(await screen.findByText("↑2 ↓1")).toBeInTheDocument();
  });

  it("shows a conflict callout when hasConflicts is true", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          jsonResponse(200, {
            ...CLEAN_STATUS,
            isClean: false,
            hasConflicts: true,
            files: [{ path: "src/a.ts", status: "U" }],
          }),
        ),
      ),
    );
    render(<GitPanel params={{ projectId: 6 }} />);

    expect(await screen.findByText(/unresolved merge conflicts/)).toBeInTheDocument();
  });
});
