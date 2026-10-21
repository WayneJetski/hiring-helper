/**
 * How the app launches Claude Code for work that reads applicant-supplied text.
 *
 * A résumé is written by a stranger and can contain instructions aimed at whatever
 * AI reads it. The protection is that the AI in these runs has nothing dangerous to
 * reach for: no shell, no file or web tools, no other MCP servers, and only the
 * handful of hiring-helper tools the task needs. (A prompt that says "ignore
 * previous instructions" then has nothing to act on.) None of those tools can write
 * to BambooHR; see bamboohr-write-isolation.test.ts.
 *
 * Why the tools are listed explicitly instead of trusting `--allowedTools` alone:
 * that flag only pre-approves tools. Everything else follows the user's own Claude
 * Code settings, and many people run with permissive ones. `--tools` removes the
 * built-in tools from the run entirely, and `--strict-mcp-config` stops the user's
 * other MCP servers (Slack, Jira, ...) from being loaded.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCORING_SCOPE_VARIABLE } from '../mcp/application-scope.js';

/** The only built-in tool a scoring run keeps: the skill that drives the flow. */
export const SCORING_BUILTIN_TOOLS = ['Skill'];

/** The hiring-helper tools `/score-candidates` needs in an unattended run. */
const SCORING_TOOL_NAMES = [
  'list_jobs',
  'get_job_description',
  'get_system_prompt',
  'list_unscored_applicants',
  'get_applicant',
  'get_resume_text',
  'save_evaluation',
];

/**
 * The rest of the server's tools, removed from the run. `save_job_posting` matters
 * most: a hostile résumé must not rewrite the posting every later candidate is judged
 * against. A test requires every registered tool to be in one list or the other, so a
 * new tool has to be classified on purpose.
 */
const WITHHELD_TOOL_NAMES = [
  'save_job_posting',
  'sync_from_bamboohr',
  'list_applicants',
  'list_statuses',
  'get_sync_status',
];

const mcpToolId = (toolName: string): string => `mcp__hiring-helper__${toolName}`;

export const SCORING_MCP_TOOLS = SCORING_TOOL_NAMES.map(mcpToolId);
export const WITHHELD_MCP_TOOLS = WITHHELD_TOOL_NAMES.map(mcpToolId);

/**
 * The project's MCP config with the batch of applications this run may touch added to
 * the hiring-helper server's environment. Returns the config as JSON text, which
 * `--mcp-config` accepts in place of a file path.
 */
export function scopedMcpConfig(repoRoot: string, applicationIds: number[]): string {
  const config = JSON.parse(readFileSync(join(repoRoot, '.mcp.json'), 'utf-8')) as {
    mcpServers: Record<string, { env?: Record<string, string> }>;
  };
  const server = config.mcpServers['hiring-helper'];
  server.env = { ...server.env, [SCORING_SCOPE_VARIABLE]: applicationIds.join(',') };
  return JSON.stringify(config);
}

/**
 * Arguments for a run that may use the hiring-helper scoring tools and nothing else.
 * Given the batch's application ids, the MCP server also refuses any other application.
 */
export function scoringSandboxArguments(repoRoot: string, applicationIds?: number[]): string[] {
  const hasBatch = applicationIds !== undefined && applicationIds.length > 0;
  return [
    '--tools',
    ...SCORING_BUILTIN_TOOLS,
    '--strict-mcp-config',
    '--mcp-config',
    hasBatch ? scopedMcpConfig(repoRoot, applicationIds) : join(repoRoot, '.mcp.json'),
    '--disallowedTools',
    ...WITHHELD_MCP_TOOLS,
    // --allowedTools is variadic, so keep it last.
    '--allowedTools',
    ...SCORING_BUILTIN_TOOLS,
    ...SCORING_MCP_TOOLS,
  ];
}

/** Arguments for a run that only answers with text: no tools, no MCP servers. */
export const TEXT_ONLY_SANDBOX_ARGUMENTS = ['--tools', '', '--strict-mcp-config'];

/**
 * The environment a Claude Code child process gets: ours without the BambooHR key.
 * The scoring MCP server reads the key from `.env` itself, and Claude has no need to
 * hold it.
 */
export function claudeChildEnvironment(parent: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const environment = { ...parent };
  delete environment.BAMBOOHR_API_KEY;
  return environment;
}
