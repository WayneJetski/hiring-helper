/**
 * Main server entry point
 * Configures and starts the Express application
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { config, isBambooHRConfigured } from './config/env.config.js';
import applicantsRoutes from './routes/applicants.routes.js';
import jobsRoutes from './routes/jobs.routes.js';
import syncRoutes from './routes/sync.routes.js';
import scoringRoutes from './routes/scoring.routes.js';
import setupRoutes from './routes/setup.routes.js';
import updateRoutes from './routes/update.routes.js';
import { errorHandler, notFoundHandler } from './middleware/error.middleware.js';
import { requestLogger } from './middleware/logger.middleware.js';
import { allowedOriginsFor, createLocalOnlyGuard } from './middleware/local-only.middleware.js';
import { initializeDatabase, closeDatabase } from './db/database.js';
import { BambooHRSyncService } from './services/bamboohr-sync.service.js';
import { registerClientAssets } from './utils/client-assets.js';

/** The only address the API listens on (see startServer). */
const LOOPBACK_HOST = '127.0.0.1';
/** The built React client (`npm run build`); same relative depth from src/ and dist/. */
const CLIENT_DIST_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../client/dist');
const app = express();

// Security middleware
app.use(helmet());

// Only this computer's own browser and tools may use the API (see the middleware for why).
app.use(createLocalOnlyGuard(allowedOriginsFor(config.server.port, config.client.url)));

// CORS configuration
app.use(
  cors({
    origin: config.client.url,
    credentials: true,
  })
);

// Rate limiting - Apply only to expensive operations, not to read endpoints
// This ensures the app remains accessible even during heavy background processing
const expensiveOpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // Generous limit for normal usage
  message: 'Too many requests from this IP, please try again later.',
  // Skip rate limiting for GET requests (read-only operations)
  skip: (req) => req.method === 'GET',
});

// Body parsing
// The API speaks JSON only; accepting HTML form posts would only widen the cross-site surface.
app.use(express.json({ limit: '1mb' }));

// Request logging
app.use(requestLogger);

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: config.server.nodeEnv,
  });
});

// API routes
app.use('/api/applicants', expensiveOpLimiter, applicantsRoutes);
app.use('/api/jobs', expensiveOpLimiter, jobsRoutes);
app.use('/api/sync', expensiveOpLimiter, syncRoutes);
app.use('/api/score', expensiveOpLimiter, scoringRoutes);
app.use('/api/setup', expensiveOpLimiter, setupRoutes);
app.use('/api/update', expensiveOpLimiter, updateRoutes);

// Built web app (packaged installs run everything from this one server)
if (registerClientAssets(app, CLIENT_DIST_DIR)) {
  console.info('🖥️  Serving the built web app');
}

// 404 handler
app.use(notFoundHandler);

// Error handler (must be last)
app.use(errorHandler);

/**
 * Initialize database and start server
 */
async function startServer(): Promise<void> {
  try {
    // Initialize database
    console.info('📦 Initializing database...');
    await initializeDatabase();

    // Perform initial sync from BambooHR (skipped until credentials are saved
    // from the setup screen, which starts the first sync itself).
    if (!isBambooHRConfigured()) {
      console.warn('⚠️  BambooHR is not connected yet. Open the app to finish setup.');
    } else {
      console.info('🔄 Performing initial sync from BambooHR...');
      const syncService = new BambooHRSyncService();
      try {
        const syncedCount = await syncService.syncApplications();
        if (syncedCount === 0) {
          const lastSync = syncService.getLastSync();
          if (lastSync?.syncType === 'rate_limited') {
            console.warn('⚠️  BambooHR API rate limit reached. Using cached local data.');
            console.warn('Sync will be automatically retried on next manual sync.');
          } else {
            console.info(`✅ Initial sync complete: No new applications to sync`);
          }
        } else {
          console.info(`✅ Initial sync complete: ${syncedCount} applications synced`);
        }
      } catch (syncError) {
        console.warn('⚠️  Initial sync failed, but server will continue:', syncError);
        console.warn('You can manually trigger sync via POST /api/sync');
      }
    }

    // Bind to loopback only: the API has no authentication and exposes applicant
    // PII, so it must not be reachable from other machines on the network.
    const server = app.listen(config.server.port, LOOPBACK_HOST, () => {
      console.info(`🚀 Server running on http://${LOOPBACK_HOST}:${config.server.port}`);
      console.info(`Environment: ${config.server.nodeEnv}`);
      console.info(`BambooHR subdomain: ${config.bambooHR.subdomain || '(not connected yet)'}`);
    });

    // Graceful shutdown
    const shutdown = async (signal: string): Promise<void> => {
      console.info(`${signal} received, shutting down gracefully`);
      
      // Close server
      server.close(() => {
        console.info('Server closed');
      });

      // Close database
      closeDatabase();
      
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

export default app;

