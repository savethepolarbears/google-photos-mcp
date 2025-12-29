import { z } from 'zod';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

/**
 * Validates arguments against a Zod schema and converts validation errors to MCP errors.
 *
 * @param args - The arguments to validate (from MCP tool request)
 * @param schema - The Zod schema to validate against
 * @returns The validated and typed arguments
 * @throws McpError with InvalidParams error code if validation fails
 *
 * @example
 * ```typescript
 * const args = validateArgs(request.params.arguments, searchPhotosSchema);
 * // args is now type-safe with SearchPhotosArgs type
 * ```
 */
export function validateArgs<T>(
  args: unknown,
  schema: z.ZodSchema<T>
): T {
  try {
    return schema.parse(args);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.errors
        .map(e => `${e.path.join('.')}: ${e.message}`)
        .join(', ');

      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameters: ${issues}`
      );
    }
    throw new McpError(ErrorCode.InvalidParams, 'Invalid parameters');
  }
}
