import type { ITheme } from "@xterm/xterm";
import type { Theme } from "./store.js";

// xterm's `theme` option is passed straight to the renderer (canvas fillStyle
// for the DOM renderer, a texture atlas for the WebGL renderer) — unlike CSS,
// it does NOT resolve custom properties on its own, so every color has to be
// a literal resolved at call time. Historically only `background` was set
// here, which left `foreground` (and the whole 16-color ANSI palette) on
// xterm's built-in default — including a default foreground of white, which
// is invisible against the light theme's white `--term` background (bug: zsh/
// bash prompt text disappearing in light mode).
//
// The ANSI colors below are NOT a 1:1 reuse of the UI accent tokens in
// styles.css (--g/--r/--b/--c/--y/--p) for every slot — those are tuned for
// small UI chrome accents, not as a full readable-on-either-background ANSI
// palette. Where a UI accent token is a reasonable fit it's read directly
// (via getComputedStyle, the same pattern the old background-only version
// used); black/white/bright-* slots are hand-picked to stay readable against
// both the dark and light `--term` backgrounds.
function readVar(container: Element, name: string, fallback: string): string {
  const value = getComputedStyle(container).getPropertyValue(name).trim();
  return value || fallback;
}

export function buildXtermTheme(container: Element, theme: Theme): ITheme {
  const background = readVar(container, "--term", theme === "light" ? "#ffffff" : "#0d0d0d");
  const foreground = readVar(container, "--fg", theme === "light" ? "#171717" : "#ededed");
  const red = readVar(container, "--r", theme === "light" ? "#cf222e" : "#e5575a");
  const green = readVar(container, "--g", theme === "light" ? "#1a7f37" : "#5ec27a");
  const yellow = readVar(container, "--y", theme === "light" ? "#9a6700" : "#d7b06a");
  const blue = readVar(container, "--b", theme === "light" ? "#0969da" : "#5c9bf5");
  const magenta = readVar(container, "--p", theme === "light" ? "#8250df" : "#b884db");
  const cyan = readVar(container, "--c", theme === "light" ? "#0e7490" : "#43c1c1");

  if (theme === "light") {
    return {
      background,
      foreground,
      cursor: foreground,
      cursorAccent: background,
      selectionBackground: "#b4d5fe80",
      black: "#24292f",
      red,
      green,
      yellow,
      blue,
      magenta,
      cyan,
      white: "#8c8c8c",
      brightBlack: "#57606a",
      brightRed: "#c4392f",
      brightGreen: "#116329",
      brightYellow: "#7d4e00",
      brightBlue: "#0550ae",
      brightMagenta: "#6639ba",
      brightCyan: "#0b5566",
      brightWhite: "#1c1c1e",
    };
  }

  return {
    background,
    foreground,
    cursor: foreground,
    cursorAccent: background,
    selectionBackground: "#3b6cf580",
    black: "#1c1c1e",
    red,
    green,
    yellow,
    blue,
    magenta,
    cyan,
    white: "#c7c7cc",
    brightBlack: "#666670",
    brightRed: "#f28b8d",
    brightGreen: "#8ed9a4",
    brightYellow: "#e8cd97",
    brightBlue: "#8fbdfb",
    brightMagenta: "#d3aeeb",
    brightCyan: "#7ddede",
    brightWhite: "#ffffff",
  };
}
