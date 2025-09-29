declare module '@modelcontextprotocol/sdk' {
  export interface ToolOptions {
    inputSchema?: unknown;
    description?: string;
    [key: string]: unknown;
  }

  export type ToolHandler = (...args: unknown[]) => unknown | Promise<unknown>;

  export class McpServer {
    constructor(options: { name: string; version: string });
    registerTool(name: string, options: ToolOptions, handler: ToolHandler): void;
    tool(name: string, schema: unknown, handler: ToolHandler, options?: ToolOptions): void;
  }

  export function stdioTransport(server: McpServer): Promise<void>;
  export function sseTransport(server: McpServer): unknown;
}
