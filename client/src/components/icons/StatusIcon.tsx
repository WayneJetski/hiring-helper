/**
 * StatusIcon
 *
 * Maps a notice tone to its flat icon, so success/warning/error messages share
 * one visual vocabulary instead of per-message emoji prefixes.
 */

import { Icon, type IconName } from './Icon';

export type NoticeTone = 'success' | 'warning' | 'error' | 'info';

export interface Notice {
  tone: NoticeTone;
  text: string;
}

const TONE_ICON: Record<NoticeTone, IconName> = {
  success: 'checkCircle',
  warning: 'alertTriangle',
  error: 'xCircle',
  info: 'info',
};

export function StatusIcon({ tone }: { tone: NoticeTone }): JSX.Element {
  return <Icon name={TONE_ICON[tone]} />;
}
