/**
 * Error handling middleware
 * Catches and formats all errors consistently
 */

import type { Request, Response, NextFunction } from 'express';
import { UpstreamServiceError } from '../errors/upstream-error.js';

export interface HttpError extends Error {
  statusCode?: number;
  status?: number;
}

export function errorHandler(
  err: HttpError,
  req: Request,
  res: Response,
  // Express identifies error handlers by their 4-argument arity, so this
  // parameter must stay even though it is unused.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  // The body parser's own error for an oversized request (only the import route allows large ones).
  if ((err as { type?: string }).type === 'entity.too.large') {
    res.status(413).json({
      error: 'File too large',
      message: 'That file is too large to import. The limit is 50 MB.',
      statusCode: 413,
    });
    return;
  }

  const statusCode =
    err instanceof UpstreamServiceError ? err.responseStatus : err.statusCode || err.status || 500;
  const message = err.message || 'Internal Server Error';

  console.error('Error occurred:', {
    statusCode,
    message,
    path: req.path,
    method: req.method,
    stack: err.stack,
  });

  res.status(statusCode).json({
    error: err.name || 'Error',
    message,
    statusCode,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: 'NotFound',
    message: `Route ${req.method} ${req.path} not found`,
    statusCode: 404,
  });
}

