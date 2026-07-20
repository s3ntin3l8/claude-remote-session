import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  MAX_UPLOAD_BYTES,
  UPLOAD_SUBDIR,
  extensionForMime,
  saveSessionUpload,
} from "../../src/services/session-upload.js";

describe("session-upload", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(path.join(os.tmpdir(), "tessera-upload-test-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  describe("extensionForMime", () => {
    it("maps allow-listed image types", () => {
      expect(extensionForMime("image/png")).toBe(".png");
      expect(extensionForMime("image/jpeg")).toBe(".jpg");
      expect(extensionForMime("image/gif")).toBe(".gif");
      expect(extensionForMime("image/webp")).toBe(".webp");
    });

    it("returns null for anything not allow-listed", () => {
      expect(extensionForMime("image/svg+xml")).toBeNull();
      expect(extensionForMime("text/plain")).toBeNull();
      expect(extensionForMime("application/octet-stream")).toBeNull();
    });
  });

  describe("saveSessionUpload", () => {
    it("writes the buffer under <cwd>/.tessera-uploads and returns an absolute path", () => {
      const buffer = Buffer.from("fake png bytes");

      const filePath = saveSessionUpload(cwd, buffer, "image/png");

      expect(path.isAbsolute(filePath)).toBe(true);
      expect(path.dirname(filePath)).toBe(path.join(path.resolve(cwd), UPLOAD_SUBDIR));
      expect(filePath.endsWith(".png")).toBe(true);
      expect(readFileSync(filePath)).toEqual(buffer);
    });

    it("seeds a .gitignore on first use so uploads never clutter git status", () => {
      saveSessionUpload(cwd, Buffer.from("x"), "image/jpeg");

      const gitignorePath = path.join(path.resolve(cwd), UPLOAD_SUBDIR, ".gitignore");
      expect(existsSync(gitignorePath)).toBe(true);
      expect(readFileSync(gitignorePath, "utf8")).toBe("*\n");
    });

    it("does not re-seed .gitignore on a second upload", () => {
      saveSessionUpload(cwd, Buffer.from("first"), "image/png");
      const gitignorePath = path.join(path.resolve(cwd), UPLOAD_SUBDIR, ".gitignore");
      const firstStat = readFileSync(gitignorePath, "utf8");

      saveSessionUpload(cwd, Buffer.from("second"), "image/png");

      expect(readFileSync(gitignorePath, "utf8")).toBe(firstStat);
    });

    it("generates a distinct filename per call, never trusting caller input", () => {
      const first = saveSessionUpload(cwd, Buffer.from("a"), "image/png");
      const second = saveSessionUpload(cwd, Buffer.from("b"), "image/png");

      expect(first).not.toBe(second);
    });

    it("throws for a mime type not in the allow-list", () => {
      expect(() => saveSessionUpload(cwd, Buffer.from("x"), "image/svg+xml")).toThrow(
        /Unsupported image type/,
      );
    });

    it("stays within the upload subdirectory regardless of a relative cwd", () => {
      const filePath = saveSessionUpload(cwd, Buffer.from("x"), "image/gif");
      const resolvedUploadDir = path.join(path.resolve(cwd), UPLOAD_SUBDIR);

      expect(filePath.startsWith(resolvedUploadDir + path.sep)).toBe(true);
    });
  });

  it("exports a sane MAX_UPLOAD_BYTES ceiling", () => {
    expect(MAX_UPLOAD_BYTES).toBeGreaterThan(1024 * 1024);
    expect(MAX_UPLOAD_BYTES).toBeLessThanOrEqual(50 * 1024 * 1024);
  });
});
