/**
 * MCP ingest tool: pull the latest candidate data from BambooHR into the local store.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpDeps } from '../deps.js';
import { registerTool } from '../register.js';
import { jsonResult, errorResult } from '../result.js';

export function registerIngestTools(server: McpServer, deps: McpDeps): void {
  registerTool<{ force?: boolean }>(
    server,
    'sync_from_bamboohr',
    {
      title: 'Sync from BambooHR',
      description:
        'Pull applications from BambooHR into the local database. Incremental by default (only new/updated ' +
        'since the last sync); pass force=true for a full sync that also marks applications no longer in BambooHR inactive.',
      inputSchema: {
        force: z.boolean().optional().describe('Full sync when true (default incremental)'),
      },
    },
    async ({ force }) => {
      try {
        const syncedCount = await deps.sync.syncApplications(force ?? false);
        return jsonResult({ syncedCount, lastSync: deps.sync.getLastSync() });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    }
  );
}
