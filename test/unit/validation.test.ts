/**
 * Unit tests for src/utils/validation.ts
 * Tests Zod schema validation → McpError conversion bridge.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { validateArgs } from "../../src/utils/validation.js";

const testSchema = z.object({
  name: z.string().min(1),
  age: z.number().int().min(0).optional(),
});

describe("validateArgs", () => {
  it("returns typed result for valid input", () => {
    const result = validateArgs({ name: "Alice", age: 30 }, testSchema);
    expect(result).toEqual({ name: "Alice", age: 30 });
  });

  it("returns typed result when optional fields are omitted", () => {
    const result = validateArgs({ name: "Bob" }, testSchema);
    expect(result).toEqual({ name: "Bob" });
  });

  it("throws McpError with InvalidParams for missing required field", () => {
    expect(() => validateArgs({}, testSchema)).toThrow(McpError);

    try {
      validateArgs({}, testSchema);
    } catch (error) {
      const mcpError = error as McpError;
      expect(mcpError.code).toBe(ErrorCode.InvalidParams);
      expect(mcpError.message).toContain("Invalid parameters");
      expect(mcpError.message).toContain("name");
    }
  });

  it("throws McpError for wrong type", () => {
    expect(() => validateArgs({ name: 123 }, testSchema)).toThrow(McpError);
  });

  it("throws McpError for constraint violation", () => {
    expect(() => validateArgs({ name: "" }, testSchema)).toThrow(McpError);
  });

  it("throws McpError for invalid optional field", () => {
    expect(() => validateArgs({ name: "Test", age: -1 }, testSchema)).toThrow(
      McpError,
    );
  });

  it("includes field path in error message", () => {
    try {
      validateArgs({ name: "" }, testSchema);
    } catch (error) {
      expect((error as McpError).message).toContain("name");
    }
  });

  it("handles null/undefined input", () => {
    expect(() => validateArgs(null, testSchema)).toThrow(McpError);
    expect(() => validateArgs(undefined, testSchema)).toThrow(McpError);
  });
});
