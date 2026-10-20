/**
 * Update Controller
 * Reports whether a newer version exists and applies it on request. See UpdateService.
 */

import { execFile, spawn } from 'node:child_process';
import { promises as fs, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Request, Response } from 'express';
import { UpdateService, commandEnvironment, type CommandRunner } from '../services/update.service.js';
import { scoringService } from '../services/scoring-runtime.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const IS_WINDOWS = process.platform === 'win32';
const CHECK_CACHE_MS = 5 * 60_000;

/** Runs git and npm (see commandEnvironment for what they are and are not given). */
const runCommand: CommandRunner = (command, args, { cwd, timeoutMs }) =>
  new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 20 * 1024 * 1024,
        env: commandEnvironment(process.env),
        shell: IS_WINDOWS && command === 'npm', // npm is npm.cmd on Windows
        windowsHide: true,
      },
      (error, stdout, stderr) => resolve({ ok: error === null, stdout: String(stdout), stderr: String(stderr) })
    );
  });

function readVersion(): string {
  try {
    const parsed = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8')) as { version?: string };
    return parsed.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** The CLI stops this process and starts a fresh one, so it must outlive us (detached). */
function startDetachedRestart(): Promise<void> {
  return new Promise((resolve, reject) => {
    const cli = join(REPO_ROOT, 'bin', IS_WINDOWS ? 'hiring-helper.cmd' : 'hiring-helper');
    const child = spawn(cli, ['restart', '--no-open'], {
      cwd: REPO_ROOT,
      detached: true,
      stdio: 'ignore',
      shell: IS_WINDOWS,
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

const updateService = new UpdateService({
  repoRoot: REPO_ROOT,
  run: runCommand,
  isManagedInstall: process.env.HIRING_HELPER_MANAGED === '1',
  readVersion,
  restart: startDetachedRestart,
  writeBuildStamp: async () => {
    const runtimeDir = join(REPO_ROOT, '.runtime');
    await fs.mkdir(runtimeDir, { recursive: true });
    await fs.writeFile(join(runtimeDir, 'build.stamp'), new Date().toISOString());
  },
  now: Date.now,
  checkCacheMs: CHECK_CACHE_MS,
});

export class UpdateController {
  /** GET /api/update/status[?refresh=1] - version, whether an update exists, and update progress */
  async getStatus(req: Request, res: Response): Promise<void> {
    res.json(await updateService.getStatus({ refresh: req.query.refresh === '1' }));
  }

  /** POST /api/update/apply - start updating in the background (poll the status for progress) */
  async apply(_req: Request, res: Response): Promise<void> {
    const result = await updateService.startUpdate(scoringService.getStatus().running);
    if (!result.ok) {
      res.status(result.code === 'not_managed' ? 400 : 409).json({
        error: 'Update not started',
        code: result.code,
        message: result.message,
      });
      return;
    }
    res.status(202).json(await updateService.getStatus());
  }
}
