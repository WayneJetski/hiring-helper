/**
 * Plain-language durations and "time ago" text for status messages.
 */

/**
 * Parse a timestamp from the server. SQLite's `datetime('now')` yields
 * "YYYY-MM-DD HH:MM:SS" in UTC with no zone marker, which `Date` would read as
 * local time, so normalize it to ISO UTC first.
 */
export function parseServerTimestamp(timestamp: string): Date {
  const isSqliteUtc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(timestamp);
  return new Date(isSqliteUtc ? `${timestamp.replace(' ', 'T')}Z` : timestamp);
}

/** "just now", "5 min ago", "3 hours ago", "2 days ago". */
export function formatTimeAgo(then: Date, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days !== 1 ? 's' : ''} ago`;
}

/** "under a minute", "about 3 min", "about 2 hours". */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return 'under a minute';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `about ${hours} hour${hours !== 1 ? 's' : ''}`;
}
