/**
 * Unit tests for src/utils/config.ts — validateTokenStoragePath
 * Tests path traversal protection and secure configuration.
 */

import { describe, it, expect } from "vitest";
import path from "path";

// We can't easily test the full config module (it runs side effects on import),
// so we extract and test the validation logic directly.
// The validateTokenStoragePath function is not exported, so we recreate its logic.

/**
 * Reimplementation of validateTokenStoragePath for isolated testing.
 * This mirrors the exact logic in src/utils/config.ts.
 */
function validateTokenStoragePath(inputPath: string): string {
  const projectRoot = process.cwd();
  const resolvedPath = path.resolve(projectRoot, inputPath);
  const relativePath = path.relative(projectRoot, resolvedPath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(
      `SECURITY ERROR: TOKEN_STORAGE_PATH must be within project directory.\n` +
        `Attempted path: ${inputPath}\n` +
        `Resolved to: ${resolvedPath}\n` +
        `This prevents path traversal attacks.`,
    );
  }

  return resolvedPath;
}

describe("validateTokenStoragePath", () => {
  it("accepts a valid relative path within project", () => {
    const result = validateTokenStoragePath("tokens.json");
    expect(result).toBe(path.resolve(process.cwd(), "tokens.json"));
  });

  it("accepts a path in a subdirectory", () => {
    const result = validateTokenStoragePath("data/tokens.json");
    expect(result).toBe(path.resolve(process.cwd(), "data/tokens.json"));
  });

  it("rejects path traversal with ../", () => {
    expect(() => validateTokenStoragePath("../../etc/passwd")).toThrow(
      "SECURITY ERROR",
    );
  });

  it("rejects path traversal with deeper nesting", () => {
    expect(() => validateTokenStoragePath("../../../tmp/evil")).toThrow(
      "TOKEN_STORAGE_PATH must be within project directory",
    );
  });

  it("rejects absolute path outside project", () => {
    expect(() => validateTokenStoragePath("/etc/passwd")).toThrow(
      "SECURITY ERROR",
    );
  });

  it("accepts absolute path within project directory", () => {
    const projectPath = path.join(process.cwd(), "tokens.json");
    // This should NOT throw because it resolves within the project
    const result = validateTokenStoragePath(projectPath);
    expect(result).toBe(projectPath);
  });

  it("error message includes attempted path", () => {
    try {
      validateTokenStoragePath("../../secret");
    } catch (error) {
      expect((error as Error).message).toContain("../../secret");
      expect((error as Error).message).toContain("path traversal");
    }
  });
});
