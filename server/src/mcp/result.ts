/**
 * Helpers for building MCP tool results.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * Wrap structured data as a pretty-printed JSON text result.
 */
export function jsonResult(data: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

/**
 * Wrap plain text as a result.
 */
export function textResult(text: string): CallToolResult {
  return {
    content: [{ type: 'text', text }],
  };
}

/**
 * Build an error result the host will surface to the model.
 */
export function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
}
