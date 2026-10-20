/**
 * Serves the built React client from the REST server, so a packaged install
 * runs as one process on one port (no Vite dev server needed).
 */

import express, { type Express } from 'express';
import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Registers static serving plus a single-page-app fallback (so deep links like
 * /applicants/42 and /setup load the client). `/api/*` requests are left alone
 * so unknown API paths still 404 as JSON.
 *
 * Call after the API routes and before the 404 handler.
 * Returns false (and registers nothing) when the client has not been built.
 */
export function registerClientAssets(app: Express, clientDistDir: string): boolean {
  const indexHtmlPath = join(clientDistDir, 'index.html');
  if (!existsSync(indexHtmlPath)) {
    return false;
  }

  app.use(express.static(clientDistDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path === '/health') {
      next();
      return;
    }
    res.sendFile(indexHtmlPath);
  });
  return true;
}
