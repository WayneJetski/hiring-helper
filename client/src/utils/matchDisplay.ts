/**
 * How a Match score, a flag and a phone number are shown. Shared by the applicant
 * list and the applicant page so both read the same way.
 */

import type { IconName } from '../components/icons/Icon';

export function getConfidenceBadge(confidence?: number): string {
  if (confidence === undefined) return '—';
  return `${confidence}%`;
}

export function getConfidenceClass(confidence?: number): string {
  if (confidence === undefined) return '';
  if (confidence >= 75) return 'confidence-high';
  if (confidence >= 60) return 'confidence-medium';
  return 'confidence-low';
}

/** Text label alongside the colour so the score never depends on colour alone. */
export function getConfidenceLevel(confidence?: number): string {
  if (confidence === undefined) return 'Not scored yet';
  if (confidence >= 75) return 'Strong';
  if (confidence >= 60) return 'Maybe';
  return 'Weak';
}

export const FLAG_DISPLAY: Record<string, { icon: IconName; label: string }> = {
  location: { icon: 'mapPin', label: 'Location' },
  name: { icon: 'user', label: 'Name' },
  studying: { icon: 'graduationCap', label: 'Studying' },
  no_exp: { icon: 'alertTriangle', label: 'No Exp' },
  tenure: { icon: 'clock', label: 'Tenure / Gaps' },
  'salary-low': { icon: 'trendingDown', label: 'Salary Low' },
  'salary-high': { icon: 'trendingUp', label: 'Salary High' },
};

/**
 * A North American number as (343) 209-1360, for reading. Anything that is not
 * 10 digits (optionally after a leading 1) is returned as typed.
 */
export function formatPhoneNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (national.length !== 10 || /[^\d\s().+-]/.test(raw)) return raw;
  return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
}
