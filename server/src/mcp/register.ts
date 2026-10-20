/**
 * Typed wrapper over McpServer.registerTool.
 *
 * The SDK infers a tool handler's argument type from its Zod raw shape. On our
 * larger input schemas that inference trips TS2589 ("excessively deep and
 * possibly infinite type instantiation") under this project's strict config.
 * Registering through this wrapper erases that inference in one contained place;
 * each handler declares its own args type instead, which still mirrors the Zod
 * schema that validates at runtime.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import type { ZodRawShape } from 'zod';

export interface ToolDefinition {
  title: string;
  description: string;
  inputSchema?: ZodRawShape;
}

export function registerTool<Args = Record<string, unknown>>(
  server: McpServer,
  name: string,
  definition: ToolDefinition,
  handler: (args: Args) => Promise<CallToolResult>
): void {
  // `as never` stops the SDK's generic argument inference (the source of
  // TS2589). The real objects are passed through unchanged at runtime.
  server.registerTool(name, definition as never, handler as never);
}

export interface PromptDefinition {
  title: string;
  description: string;
  argsSchema?: ZodRawShape;
}

export function registerPrompt<Args = Record<string, string>>(
  server: McpServer,
  name: string,
  definition: PromptDefinition,
  handler: (args: Args) => GetPromptResult | Promise<GetPromptResult>
): void {
  // Same TS2589 workaround as registerTool; see above.
  server.registerPrompt(name, definition as never, handler as never);
}
