// A minimal stdio MCP server for mcp-check tests. FAKE_TOOLS is a comma-separated tool list.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new McpServer({ name: 'fake', version: '0.0.0' });
for (const name of (process.env.FAKE_TOOLS ?? '').split(',').filter(Boolean)) {
  server.tool(name, async () => ({ content: [{ type: 'text', text: 'ok' }] }));
}
await server.connect(new StdioServerTransport());
