declare module '@modelcontextprotocol/sdk' {
  export class McpServer {
    constructor(options: { name: string; version: string });
    registerTool(name: string, options: any, handler: (...args: unknown[]) => unknown): void;
    tool(name: string, schema: any, handler: (...args: unknown[]) => unknown, options?: any): void;
  }
  
  export function stdioTransport(server: McpServer): Promise<void>;
  export function sseTransport(server: McpServer): any;
} 
