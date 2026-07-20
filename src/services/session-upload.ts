import crypto from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

// Issue #68: a pasted/attached image can't travel down the terminal's own
// byte stream (no Sixel/Kitty/iTerm2 support, and the CLI running in the PTY
// couldn't read inline image bytes off stdin even if it could parse them
// anyway) — the only thing that actually gets an image "into" a CLI like
// Claude Code is a file it can open by path. This writes the upload into the
// session's own cwd so it's already inside the CLI's workspace (no
// out-of-workspace read prompt) and returns that path for the frontend to
// inject into the terminal, exactly like a text paste.

// Allow-listed, not sniffed from bytes — the browser-supplied Content-Type on
// a clipboard/file-picker image blob is trustworthy enough here (this only
// ever picks a filename extension; it never affects how the bytes are
// written or interpreted).
const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

// Generous enough for a screenshot or camera photo, small enough to keep a
// misbehaving/malicious client from parking an arbitrarily large body on
// disk — mirrors the spirit of websocket.ts's own maxPayload comment.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const UPLOAD_SUBDIR = ".tessera-uploads";

export function extensionForMime(mime: string): string | null {
  return MIME_EXTENSIONS[mime] ?? null;
}

/**
 * Writes `buffer` into `<cwd>/.tessera-uploads/<random>.<ext>` and returns
 * the absolute path. `mime` must be one of MIME_EXTENSIONS' keys (callers
 * reject anything else before this runs). The filename is always
 * server-generated — never derived from caller input — so there's nothing
 * for a traversal attempt to reach outside the fixed upload subdirectory.
 */
export function saveSessionUpload(cwd: string, buffer: Buffer, mime: string): string {
  const ext = extensionForMime(mime);
  if (!ext) throw new Error(`Unsupported image type: ${mime}`);

  const uploadDir = path.join(path.resolve(cwd), UPLOAD_SUBDIR);
  const isNewDir = !existsSync(uploadDir);
  mkdirSync(uploadDir, { recursive: true });
  if (isNewDir) {
    // Keeps a project's own git status clean of pasted-image litter — an
    // upload is transient input to the CLI, not a file the user meant to add
    // to their repo.
    writeFileSync(path.join(uploadDir, ".gitignore"), "*\n");
  }

  const filename = `${crypto.randomUUID()}${ext}`;
  const filePath = path.join(uploadDir, filename);
  writeFileSync(filePath, buffer);
  return filePath;
}
