import { describe, it, expect } from "vitest";
import {
  detectAttentionSignals,
  classifyActivityFromTitle,
  applyMouseModeChanges,
  INITIAL_MOUSE_TRACKING_STATE,
  type MouseTrackingState,
} from "../../src/services/attention-detect.js";

const ESC = "\x1b";
const BEL = "\x07";
const ST = `${ESC}\\`;

describe("detectAttentionSignals", () => {
  it("returns all-clear for plain output with no escape sequences", () => {
    expect(detectAttentionSignals("just some regular output\n")).toEqual({
      bell: false,
      notification: false,
      titleChange: null,
    });
  });

  it("detects a bare bell byte", () => {
    expect(detectAttentionSignals(`done${BEL}`)).toEqual({
      bell: true,
      notification: false,
      titleChange: null,
    });
  });

  it("detects an OSC 9 notification terminated with BEL, without counting the terminator as a bare bell", () => {
    const chunk = `${ESC}]9;Build finished${BEL}`;
    const result = detectAttentionSignals(chunk);
    expect(result.notification).toBe(true);
    expect(result.bell).toBe(false); // BEL is just the OSC terminator here, not a bare bell
  });

  it("detects an OSC 777 notification terminated with ST", () => {
    const chunk = `${ESC}]777;notify;Title;Body${ST}`;
    const result = detectAttentionSignals(chunk);
    expect(result.notification).toBe(true);
    expect(result.bell).toBe(false); // ST terminator, no bare BEL byte
  });

  it("extracts the payload of an OSC 2 title-change sequence", () => {
    const chunk = `${ESC}]2;my-session — waiting${BEL}`;
    const result = detectAttentionSignals(chunk);
    expect(result.titleChange).toBe("my-session — waiting");
    expect(result.notification).toBe(false);
  });

  it("extracts the payload of an OSC 0 icon+title sequence", () => {
    const chunk = `${ESC}]0;claude: done${ST}`;
    expect(detectAttentionSignals(chunk).titleChange).toBe("claude: done");
  });

  it("keeps the LAST title when multiple OSC 0/2 sequences appear in one chunk", () => {
    const chunk = `${ESC}]2;first${BEL}${ESC}]2;second${BEL}`;
    expect(detectAttentionSignals(chunk).titleChange).toBe("second");
  });

  it("ignores OSC codes that aren't 0/2/9/777, and doesn't count their BEL terminator as a bell", () => {
    const chunk = `${ESC}]4;1;rgb:00/00/00${BEL}`; // OSC 4 = palette color
    expect(detectAttentionSignals(chunk)).toEqual({
      bell: false,
      notification: false,
      titleChange: null,
    });
  });

  it("still detects a bare bell alongside OSC-terminator BELs in the same chunk", () => {
    const chunk = `some output${ESC}]2;title${BEL}more output${BEL}${ESC}]9;notify${BEL}`;
    const result = detectAttentionSignals(chunk);
    expect(result.bell).toBe(true); // the standalone BEL between "more output" and the OSC 9 sequence
    expect(result.notification).toBe(true);
    expect(result.titleChange).toBe("title");
  });

  it("does not treat a title/notification OSC sequence's BEL terminator as a bare bell", () => {
    const chunk = `some output${ESC}]2;title${BEL}more output${ESC}]9;notify${BEL}`;
    const result = detectAttentionSignals(chunk);
    expect(result.bell).toBe(false);
    expect(result.notification).toBe(true);
    expect(result.titleChange).toBe("title");
  });
});

describe("classifyActivityFromTitle", () => {
  it("reads 'working' from an explicit status word", () => {
    expect(classifyActivityFromTitle("Thinking…", "claude")).toBe("working");
    expect(classifyActivityFromTitle("opencode: Generating", "opencode")).toBe("working");
  });

  it("reads 'working' from a trailing ellipsis", () => {
    expect(classifyActivityFromTitle("Compiling...", "make")).toBe("working");
  });

  it("reads 'idle' from an explicit status word", () => {
    expect(classifyActivityFromTitle("Waiting for input", "claude")).toBe("idle");
    expect(classifyActivityFromTitle("Ready", "opencode")).toBe("idle");
  });

  it("returns null for a plain shell title, leaving the caller's own heuristic to decide", () => {
    // Bash/zsh write `user@host:cwd` into the title on every prompt draw —
    // no status word, so this must NOT be misread as "idle" or "working".
    expect(classifyActivityFromTitle("bjoern@host:~/projects/tessera", "bash")).toBeNull();
  });

  it("returns null when there is no title yet", () => {
    expect(classifyActivityFromTitle(null, "bash")).toBeNull();
  });

  it("prefers 'idle' over a trailing ellipsis when a title contains both", () => {
    // "Waiting..." matches both the idle word "Waiting" and the working
    // pattern's trailing ellipsis — the idle word must win.
    expect(classifyActivityFromTitle("Waiting...", "opencode")).toBe("idle");
  });
});

describe("applyMouseModeChanges", () => {
  it("returns the same reference (not just an equal value) for plain output with no mode switches", () => {
    const prev: MouseTrackingState = { protocol: "ANY", encoding: "SGR" };
    expect(applyMouseModeChanges("just some regular output\n", prev)).toBe(prev);
  });

  it("tracks a single protocol enable", () => {
    expect(applyMouseModeChanges(`${ESC}[?1003h`, INITIAL_MOUSE_TRACKING_STATE)).toEqual({
      protocol: "ANY",
      encoding: "DEFAULT",
    });
  });

  it("tracks a single encoding enable", () => {
    expect(applyMouseModeChanges(`${ESC}[?1006h`, INITIAL_MOUSE_TRACKING_STATE)).toEqual({
      protocol: "NONE",
      encoding: "SGR",
    });
  });

  it("tracks the confirmed #93 bug sequence: protocol and encoding enabled together", () => {
    expect(
      applyMouseModeChanges(`${ESC}[?1003h${ESC}[?1006h`, INITIAL_MOUSE_TRACKING_STATE),
    ).toEqual({ protocol: "ANY", encoding: "SGR" });
  });

  it("last-set-wins across separate calls", () => {
    let state = applyMouseModeChanges(`${ESC}[?1000h`, INITIAL_MOUSE_TRACKING_STATE);
    expect(state.protocol).toBe("VT200");
    state = applyMouseModeChanges(`${ESC}[?1003h`, state);
    expect(state.protocol).toBe("ANY");
  });

  it("resets the whole protocol axis to NONE on DECRST for any protocol code, not just the one last set (xterm's own fall-through)", () => {
    // ?1000l reset arrives while ?1003 (ANY) is the active protocol — real
    // xterm.js still collapses to NONE here (InputHandler's DECRST case
    // block falls through 9/1000/1002/1003 into one assignment), which is
    // exactly why this reducer tracks a derived enum rather than a raw
    // per-code on/off map.
    let state = applyMouseModeChanges(`${ESC}[?1003h`, INITIAL_MOUSE_TRACKING_STATE);
    expect(state.protocol).toBe("ANY");
    state = applyMouseModeChanges(`${ESC}[?1000l`, state);
    expect(state.protocol).toBe("NONE");
  });

  it("returns to the initial state on matching disable", () => {
    let state = applyMouseModeChanges(`${ESC}[?1003h${ESC}[?1006h`, INITIAL_MOUSE_TRACKING_STATE);
    state = applyMouseModeChanges(`${ESC}[?1003l${ESC}[?1006l`, state);
    expect(state).toEqual(INITIAL_MOUSE_TRACKING_STATE);
  });

  it("tracks the SGR_PIXELS encoding", () => {
    let state = applyMouseModeChanges(`${ESC}[?1016h`, INITIAL_MOUSE_TRACKING_STATE);
    expect(state.encoding).toBe("SGR_PIXELS");
    state = applyMouseModeChanges(`${ESC}[?1016l`, state);
    expect(state.encoding).toBe("DEFAULT");
  });

  it("treats 1005/1015 DECSET as a no-op but honors their DECRST as a courtesy reset to DEFAULT", () => {
    // xterm.js no longer implements 1005 (utf8 ext mode)/1015 (urxvt ext
    // mode) — DECSET for either is a no-op there, so tracking a DECSET for
    // them would silently diverge from what a real xterm.js ends up with.
    let state = applyMouseModeChanges(`${ESC}[?1006h`, INITIAL_MOUSE_TRACKING_STATE);
    state = applyMouseModeChanges(`${ESC}[?1005h`, state);
    expect(state.encoding).toBe("SGR"); // 1005h is a no-op, SGR from 1006h is untouched
    state = applyMouseModeChanges(`${ESC}[?1005l`, state);
    expect(state.encoding).toBe("DEFAULT"); // 1005l still courtesy-resets encoding
  });

  it("ignores unrelated DECSET modes (alt-screen, bracketed paste, application cursor keys)", () => {
    const prev: MouseTrackingState = { protocol: "ANY", encoding: "SGR" };
    const chunk = `${ESC}[?1049h${ESC}[?2004h${ESC}[?1h`;
    expect(applyMouseModeChanges(chunk, prev)).toBe(prev);
  });
});
