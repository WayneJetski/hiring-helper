/**
 * Logging utilities
 * Provides structured logging for the application
 */

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: unknown;
}

class Logger {
  /**
   * Format log entry as JSON
   */
  private formatLog(level: LogLevel, message: string, data?: unknown): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(data ? { data } : {}),
    };
  }

  /**
   * Log info message
   */
  info(message: string, data?: unknown): void {
    const log = this.formatLog('info', message, data);
    console.info(JSON.stringify(log));
  }

  /**
   * Log warning message
   */
  warn(message: string, data?: unknown): void {
    const log = this.formatLog('warn', message, data);
    console.warn(JSON.stringify(log));
  }

  /**
   * Log error message
   */
  error(message: string, error?: unknown): void {
    const data = error instanceof Error
      ? { message: error.message, stack: error.stack }
      : error;
    
    const log = this.formatLog('error', message, data);
    console.error(JSON.stringify(log));
  }

  /**
   * Log debug message (only in development)
   */
  debug(message: string, data?: unknown): void {
    if (process.env.NODE_ENV === 'development') {
      const log = this.formatLog('debug', message, data);
      console.debug(JSON.stringify(log));
    }
  }
}

export const logger = new Logger();

