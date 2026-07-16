import { describe, it, expect } from "vitest";
import { detectAttentionSignals } from "../../src/services/attention-detect.js";

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
