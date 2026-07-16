import { eq } from "drizzle-orm";
import { settings as settingsTable } from "../db/schema.js";
import type { getDb } from "../db/client.js";

// Shared shape + defaults for the server-persisted Settings blob (the
// Settings modal's "Everything wired now" rework). One JSON blob, same
// "backend stores/replays an opaque value" philosophy as
// `workspaces.layout` / `sessions.command` — this service is the only place
// that actually understands its structure; src/routes/settings.ts,
// src/routes/projects.ts, src/routes/sessions.ts, and src/plugins/pty.ts all
// read it through `getStoredSettings` below rather than each re-implementing
// "read the singleton row and merge over defaults."
//
// Deliberately a single flat-ish object rather than one DB column per pref:
// new settings get added here (and to DEFAULT_SETTINGS) without a schema
// migration, and `mergeSettings` deep-merges a stored (possibly older,
// missing-keys) blob over these defaults so a fresh key introduced by a
// later release always resolves instead of coming back `undefined`.

export type Theme = "dark" | "light" | "system";
export type CursorStyle = "block" | "bar" | "underline";
export type SidebarDensity = "comfortable" | "compact";
export type SoundName = "ping" | "chime" | "blip";

export interface AppSettings {
  theme: Theme;
  terminal: {
    fontFamily: string;
    fontSize: number;
    colorScheme: string;
    cursorStyle: CursorStyle;
    cursorBlink: boolean;
    scrollback: number;
    copyOnSelect: boolean;
    pasteOnRightClick: boolean;
    reconnect: {
      enabled: boolean;
      maxAttempts: number;
    };
    keyCapture: {
      ctrlR: boolean;
      ctrlL: boolean;
      ctrlK: boolean;
    };
  };
  sidebarDensity: SidebarDensity;
  // Editable project-scan roots (Settings -> Projects & discovery). Empty
  // array = "use the PROJECTS_ROOTS env var" (see routes/projects.ts) —
  // this lets a fresh deploy keep working from its env config until someone
  // actually edits roots from the UI, at which point the DB value wins.
  projectRoots: string[];
  launchers: {
    defaultShell: string;
    defaultAgent: string;
  };
  notifications: {
    attentionAlerts: boolean;
    channels: {
      browser: boolean;
      sound: boolean;
    };
    soundName: SoundName;
    idleThresholdSeconds: number;
    exitedAlerts: boolean;
  };
  sessions: {
    // Tokens: {agent} {project} {n} — expanded client-side at launch time
    // (see frontend/src/CommandPalette.tsx).
    namePattern: string;
    confirmBeforeKill: boolean;
    hideEndedSessions: boolean;
    reconcileIntervalSeconds: number;
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "dark",
  terminal: {
    fontFamily: "Geist Mono",
    fontSize: 14,
    colorScheme: "default",
    cursorStyle: "block",
    cursorBlink: true,
    scrollback: 1000,
    copyOnSelect: true,
    pasteOnRightClick: false,
    reconnect: {
      enabled: true,
      maxAttempts: 8,
    },
    keyCapture: {
      ctrlR: true,
      ctrlL: true,
      ctrlK: false,
    },
  },
  sidebarDensity: "comfortable",
  projectRoots: [],
  launchers: {
    defaultShell: "zsh",
    defaultAgent: "claude",
  },
  notifications: {
    attentionAlerts: false,
    channels: {
      browser: true,
      sound: false,
    },
    soundName: "ping",
    idleThresholdSeconds: 30,
    exitedAlerts: false,
  },
  sessions: {
    namePattern: "{agent} · {project}",
    confirmBeforeKill: true,
    hideEndedSessions: false,
    reconcileIntervalSeconds: 30,
  },
};

// Plain-object-aware deep merge: `patch` values win, arrays and any
// non-plain-object value (including null) replace outright rather than
// merging element-wise — a `projectRoots: []` patch should empty the list,
// not no-op against defaults.
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(patch)) return base;
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) {
    const baseValue = (base as Record<string, unknown>)[key];
    result[key] =
      isPlainObject(baseValue) && isPlainObject(value) ? deepMerge(baseValue, value) : value;
  }
  return result as T;
}

/** Deep-merges a possibly-partial/older stored blob over the current defaults. */
export function mergeSettings(stored: unknown): AppSettings {
  return deepMerge(DEFAULT_SETTINGS, stored);
}

// Singleton row id — see db/schema.ts's `settings` table doc comment.
const SETTINGS_ROW_ID = 1;

// Shared "read the settings row and merge over defaults" used by every
// consumer (the settings route itself, project-roots resolution, the
// reconcile-interval boot read, and per-request idle-threshold lookups).
export function getStoredSettings(db: ReturnType<typeof getDb>): AppSettings {
  const [row] = db.select().from(settingsTable).where(eq(settingsTable.id, SETTINGS_ROW_ID)).all();
  if (!row) return DEFAULT_SETTINGS;
  try {
    return mergeSettings(JSON.parse(row.data));
  } catch {
    return DEFAULT_SETTINGS;
  }
}
