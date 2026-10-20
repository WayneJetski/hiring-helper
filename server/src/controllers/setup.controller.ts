/**
 * Setup Controller
 * First-run setup: connection status, credential test, and save. See SetupService.
 */

import type { Request, Response } from 'express';
import { SetupService } from '../services/setup.service.js';
import { BambooHRSyncService } from '../services/bamboohr-sync.service.js';

const setupService = new SetupService();
const syncService = new BambooHRSyncService();

interface CredentialsBody {
  apiKey?: unknown;
  subdomain?: unknown;
}

export class SetupController {
  /** GET /api/setup/status */
  async getStatus(_req: Request, res: Response): Promise<void> {
    res.json(await setupService.getStatus());
  }

  /** POST /api/setup/claude/signin  { sso? } - opens Claude Code's sign-in in the browser */
  async startClaudeSignIn(req: Request<unknown, unknown, { sso?: unknown }>, res: Response): Promise<void> {
    setupService.startClaudeSignIn(req.body?.sso === true);
    res.json(await setupService.getStatus());
  }

  /** POST /api/setup/claude/signin/cancel */
  async cancelClaudeSignIn(_req: Request, res: Response): Promise<void> {
    setupService.cancelClaudeSignIn();
    res.json(await setupService.getStatus());
  }

  /** GET /api/setup/bamboohr/connection - tests the SAVED credentials (cached for a minute) */
  async getSavedConnection(_req: Request, res: Response): Promise<void> {
    res.json(await setupService.checkSavedConnection());
  }

  /** POST /api/setup/bamboohr/test  { apiKey, subdomain } - tests without saving */
  async testBambooHR(req: Request<unknown, unknown, CredentialsBody>, res: Response): Promise<void> {
    const invalid = setupService.validateCredentials(req.body?.apiKey, req.body?.subdomain);
    if (invalid) {
      res.status(400).json({ ok: false, message: invalid });
      return;
    }
    const apiKey = (req.body.apiKey as string).trim();
    const subdomain = (req.body.subdomain as string).trim();
    res.json(await setupService.testConnection(apiKey, subdomain));
  }

  /**
   * POST /api/setup/bamboohr  { apiKey, subdomain }
   * Tests, saves, then starts the first sync in the background.
   */
  async saveBambooHR(req: Request<unknown, unknown, CredentialsBody>, res: Response): Promise<void> {
    const invalid = setupService.validateCredentials(req.body?.apiKey, req.body?.subdomain);
    if (invalid) {
      res.status(400).json({ ok: false, message: invalid });
      return;
    }
    const apiKey = (req.body.apiKey as string).trim();
    const subdomain = (req.body.subdomain as string).trim();

    const test = await setupService.testConnection(apiKey, subdomain);
    if (!test.ok) {
      res.status(400).json(test);
      return;
    }

    try {
      await setupService.saveCredentials(apiKey, subdomain);
    } catch (error) {
      console.error('Failed to save BambooHR credentials:', error instanceof Error ? error.message : error);
      res.status(500).json({ ok: false, message: 'Connected, but the settings could not be saved to the .env file.' });
      return;
    }

    syncService
      .syncApplications()
      .catch((error) => console.warn('First sync after setup failed:', error));
    res.json({ ok: true, message: 'Connected. Loading your applicants now.' });
  }
}
