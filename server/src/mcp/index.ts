/**
 * Hiring Helper MCP server entry point (stdio transport).
 *
 * Exposes the local candidate store to Claude: read tools to inspect
 * candidates, a write tool to persist evaluations, an ingest tool to sync from
 * BambooHR, and an `evaluate_candidate` prompt. Register it in a Claude Code /
 * Claude Desktop config (see .mcp.json / MCP.md).
 */

// Must be first: reroute stdout logging to stderr before anything else runs.
import './stdio-logging.js';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { initializeDatabase, closeDatabase } from '../db/database.js';
import { ApplicantQueryService } from '../services/applicant-query.service.js';
import { EvaluationService } from '../services/evaluation.service.js';
import { BambooHRSyncService } from '../services/bamboohr-sync.service.js';
import { JobDescriptionService } from '../services/job-description.service.js';
import { ApplicationStatesRepository } from '../repositories/application-states.repository.js';
import { createMcpServer } from './server.js';

async function main(): Promise<void> {
  await initializeDatabase();

  const server = createMcpServer({
    applicantQuery: new ApplicantQueryService(),
    evaluation: new EvaluationService(),
    sync: new BambooHRSyncService(),
    jobDescriptions: new JobDescriptionService(),
    states: new ApplicationStatesRepository(),
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr; stdout is the protocol channel.
  console.error('Hiring Helper MCP server running on stdio');

  const shutdown = (): void => {
    closeDatabase();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
