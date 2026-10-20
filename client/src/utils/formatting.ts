/**
 * Formatting utilities for the frontend
 */

/**
 * Format a date string to a readable format
 */
export function formatDate(
  dateString: string,
  options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }
): string {
  try {
    return new Date(dateString).toLocaleDateString('en-US', options);
  } catch {
    return dateString;
  }
}

/**
 * Format a date string to a short format
 */
export function formatDateShort(dateString: string): string {
  return formatDate(dateString, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Truncate text to a maximum length
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

