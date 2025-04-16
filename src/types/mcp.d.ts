declare module '@modelcontextprotocol/sdk' {
  export class McpServer {
    constructor(options: { name: string; version: string });
    registerTool(name: string, options: any, handler: Function): void;
    tool(name: string, schema: any, handler: Function, options?: any): void;
  }
  
  export function stdioTransport(server: McpServer): Promise<void>;
  export function sseTransport(server: McpServer): any;
} 