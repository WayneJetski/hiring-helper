/**
 * Self-check for the MCP server: starts it exactly the way Claude Code does (the command
 * from the project's .mcp.json), asks for its tools, and confirms the ones scoring needs.
 *
 * Scoring only works through this server, so an install where it cannot start looks fine
 * until the first "Score new applicants" click. This turns that into a message at install
 * and start time (`hiring-helper doctor`, CI).
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export const MCP_SERVER_NAME = 'hiring-helper';

/** The tools the /score-candidates flow cannot do without. */
export const REQUIRED_TOOL_NAMES = [
  'list_unscored_applicants',
  'get_resume_text',
  'get_system_prompt',
  'save_evaluation',
] as const;

const DEFAULT_TIMEOUT_MS = 30_000;
const LOG_TAIL_CHARACTERS = 1_500;

export interface McpLaunchConfig {
  command: string;
  args: string[];
  /** Extra environment for the server; the SDK otherwise passes only a safe default set. */
  env?: Record<string, string>;
}

export interface McpCheckOptions {
  /** Where to start the server from. Claude Code uses the repo root. */
  workingDirectory: string;
  requiredToolNames?: readonly string[];
  timeoutMs?: number;
}

export interface McpCheckResult {
  isReady: boolean;
  toolNames: string[];
  /** Plain-language reason, set when `isReady` is false. */
  failureReason?: string;
  /** The tail of what the server wrote to stderr, to show next to a failure. */
  serverLogTail: string;
}

/** Reads one server's launch command out of the text of a `.mcp.json` file. */
export function parseMcpLaunchConfig(
  mcpJsonText: string,
  serverName: string = MCP_SERVER_NAME
): McpLaunchConfig {
  let parsed: { mcpServers?: Record<string, { command?: unknown; args?: unknown }> };
  try {
    parsed = JSON.parse(mcpJsonText);
  } catch {
    throw new Error('.mcp.json is not valid JSON.');
  }
  const entry = parsed.mcpServers?.[serverName];
  if (!entry) {
    throw new Error(`.mcp.json has no "${serverName}" server, so Claude Code cannot score.`);
  }
  if (typeof entry.command !== 'string' || entry.command === '') {
    throw new Error(`The "${serverName}" entry in .mcp.json has no command.`);
  }
  const args = Array.isArray(entry.args) ? entry.args.map(String) : [];
  return { command: entry.command, args };
}

/**
 * Headless runs only use a server the project's .claude/settings.json pre-approves;
 * otherwise Claude Code waits for a prompt nobody can answer.
 */
export function isServerPreApproved(
  settingsJsonText: string,
  serverName: string = MCP_SERVER_NAME
): boolean {
  try {
    const settings = JSON.parse(settingsJsonText) as { enabledMcpjsonServers?: unknown };
    return (
      Array.isArray(settings.enabledMcpjsonServers) &&
      settings.enabledMcpjsonServers.includes(serverName)
    );
  } catch {
    return false;
  }
}

/**
 * Turns the server's own error output into advice, for the failures people can fix.
 * The raw message ("compiled against a different Node.js version") does not say that two
 * Node.js installs are involved, or what to do about it.
 */
export function diagnoseServerLog(serverLog: string): string | undefined {
  if (serverLog.includes('NODE_MODULE_VERSION')) {
    return (
      'The app was installed with a different Node.js than the one Claude Code starts. ' +
      'Run "npm rebuild better-sqlite3" from the app folder in a terminal where `node` is the ' +
      'one you want to use, or make sure only one Node.js comes first on your PATH.'
    );
  }
  return undefined;
}

export async function checkMcpServer(
  config: McpLaunchConfig,
  options: McpCheckOptions
): Promise<McpCheckResult> {
  const requiredToolNames = options.requiredToolNames ?? REQUIRED_TOOL_NAMES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: config.env,
    cwd: options.workingDirectory,
    stderr: 'pipe',
  });
  let serverLog = '';
  transport.stderr?.on('data', (chunk) => {
    serverLog += chunk.toString();
  });

  const client = new Client({ name: 'hiring-helper-check', version: '1.0.0' });
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`The MCP server did not answer within ${timeoutMs / 1000} seconds.`)),
      timeoutMs
    );
  });

  const finish = (partial: Omit<McpCheckResult, 'serverLogTail'>): McpCheckResult => ({
    ...partial,
    serverLogTail: serverLog.trim().slice(-LOG_TAIL_CHARACTERS),
  });

  try {
    const { tools } = await Promise.race([
      client.connect(transport).then(() => client.listTools()),
      timeout,
    ]);
    const toolNames = tools.map((tool) => tool.name);
    const missingToolNames = requiredToolNames.filter((name) => !toolNames.includes(name));
    if (missingToolNames.length > 0) {
      return finish({
        isReady: false,
        toolNames,
        failureReason: `The MCP server started but is missing tools: ${missingToolNames.join(', ')}.`,
      });
    }
    return finish({ isReady: true, toolNames });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const advice = diagnoseServerLog(serverLog);
    return finish({
      isReady: false,
      toolNames: [],
      failureReason: `The MCP server could not be started (${reason}).${advice ? ` ${advice}` : ''}`,
    });
  } finally {
    clearTimeout(timer);
    await client.close().catch(() => undefined);
  }
}
