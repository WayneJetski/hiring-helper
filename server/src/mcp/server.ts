/**
 * Builds the Hiring Helper MCP server and registers its tools and prompts.
 * Dependencies are injected so the registrars stay decoupled from construction.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpDeps } from './deps.js';
import { registerReadTools } from './tools/read.tools.js';
import { registerWriteTools } from './tools/write.tools.js';
import { registerIngestTools } from './tools/ingest.tools.js';
import { registerEvaluateCandidatePrompt } from './prompts/evaluate-candidate.prompt.js';

export function createMcpServer(deps: McpDeps): McpServer {
  const server = new McpServer({
    name: 'hiring-helper',
    version: '2.0.0',
  });

  registerReadTools(server, deps);
  registerWriteTools(server, deps);
  registerIngestTools(server, deps);
  registerEvaluateCandidatePrompt(server, deps);

  return server;
}
