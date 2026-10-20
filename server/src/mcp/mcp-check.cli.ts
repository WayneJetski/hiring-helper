/**
 * `hiring-helper doctor` / `npm run mcp:check --workspace=server`: runs the MCP self-check
 * against this checkout's .mcp.json and exits non-zero when scoring would not work.
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  MCP_SERVER_NAME,
  checkMcpServer,
  isServerPreApproved,
  parseMcpLaunchConfig,
} from './mcp-check.js';

// server/src/mcp and server/dist/mcp are both three levels below the repo root.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

async function main(): Promise<number> {
  let config;
  try {
    config = parseMcpLaunchConfig(readFileSync(join(REPO_ROOT, '.mcp.json'), 'utf-8'));
  } catch (error) {
    console.error(`Scoring will not work: ${error instanceof Error ? error.message : error}`);
    return 1;
  }

  const result = await checkMcpServer(config, { workingDirectory: REPO_ROOT });
  if (!result.isReady) {
    console.error(`Scoring will not work: ${result.failureReason}`);
    if (result.serverLogTail) console.error(`\nWhat the server said:\n${result.serverLogTail}`);
    return 1;
  }
  console.log(`MCP server "${MCP_SERVER_NAME}" is ready (${result.toolNames.length} tools).`);

  let settingsText = '';
  try {
    settingsText = readFileSync(join(REPO_ROOT, '.claude', 'settings.json'), 'utf-8');
  } catch {
    // Missing file is reported below as "not pre-approved".
  }
  if (!isServerPreApproved(settingsText)) {
    console.error(
      `Warning: .claude/settings.json does not pre-approve "${MCP_SERVER_NAME}", ` +
        'so scoring from the web app would wait for an approval prompt.'
    );
    return 1;
  }
  return 0;
}

main().then((exitCode) => process.exit(exitCode));
