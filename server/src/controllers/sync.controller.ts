/**
 * Sync Controller
 * Handles HTTP requests for data synchronization endpoints
 */

import type { Request, Response } from 'express';
import { respondWithError } from '../errors/respond-with-error.js';
import { BambooHRSyncService } from '../services/bamboohr-sync.service.js';

const syncService = new BambooHRSyncService();

export class SyncController {
  /**
   * POST /api/sync
   * Trigger manual sync from BambooHR
   */
  async syncApplications(
    req: Request<unknown, unknown, { force?: boolean }>,
    res: Response
  ): Promise<void> {
    try {
      const forceFull = req.body?.force === true || req.query.force === 'true';

      console.info(`🔄 Manual sync triggered (force: ${forceFull})`);
      const { syncedCount, statusUpdatesPulled } =
        await syncService.syncApplicationsWithDetails(forceFull);

      // Check if sync was rate limited
      const lastSync = syncService.getLastSync();
      if (lastSync && lastSync.syncType === 'rate_limited') {
        res.json({
          success: true,
          rateLimited: true,
          message: 'BambooHR API rate limit reached. Using cached local data. Please try again later.',
          syncedCount: 0,
        });
        return;
      }

      const parts: string[] = [];
      if (syncedCount > 0) {
        parts.push(`Synced ${syncedCount} application${syncedCount !== 1 ? 's' : ''}`);
      }
      if (statusUpdatesPulled > 0) {
        parts.push(
          `pulled ${statusUpdatesPulled} status update${statusUpdatesPulled !== 1 ? 's' : ''} from BambooHR`
        );
      }
      res.json({
        success: true,
        message: parts.length > 0 ? parts.join('; ') : 'Up to date — no new applications or status changes',
        syncedCount,
        statusUpdatesPulled,
      });
    } catch (error) {
      console.error('Sync failed:', error);
      respondWithError(res, error, 'Sync failed');
    }
  }

  /**
   * GET /api/sync/history
   * Get sync history
   */
  async getSyncHistory(
    req: Request<unknown, unknown, unknown, { limit?: string }>,
    res: Response
  ): Promise<void> {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
      const history = syncService.getSyncHistory(limit);

      res.json({
        data: history,
        count: history.length,
      });
    } catch (error) {
      console.error('Failed to get sync history:', error);
      respondWithError(res, error, 'Failed to fetch sync history');
    }
  }

  /**
   * GET /api/sync/status
   * Get last sync status
   */
  async getSyncStatus(
    _req: Request,
    res: Response
  ): Promise<void> {
    try {
      const lastSync = syncService.getLastSync();
      const isSyncing = syncService.isSyncing();

      if (!lastSync) {
        res.json({
          message: 'No sync has been performed yet',
          isSyncing,
          lastSync: null,
        });
        return;
      }

      res.json({
        isSyncing,
        lastSync: {
          timestamp: lastSync.timestamp,
          syncType: lastSync.syncType,
          applicationsSynced: lastSync.applicationsSynced,
          notes: lastSync.notes,
        },
      });
    } catch (error) {
      console.error('Failed to get sync status:', error);
      respondWithError(res, error, 'Failed to fetch sync status');
    }
  }
}

