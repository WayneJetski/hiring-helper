/**
 * Reads each check made while an update is running and decides what the banner
 * should do next. Pure, so the sequence (including the gap while the server
 * restarts) is testable.
 */

import type { UpdateStatus } from '../types/applicant.types';

/** How long to wait for the restarted server before telling the person to step in. */
export const RESTART_WAIT_LIMIT_MS = 3 * 60_000;

export interface UpdatePollInput {
  /** The commit this copy was on when the update began. */
  startCommit: string | null;
  /** The server's answer, or null when it could not be reached (it is restarting). */
  status: UpdateStatus | null;
  /** The server was unreachable at some point since the update began. */
  sawServerDown: boolean;
  /** How long it has been restarting (0 until it starts). */
  waitingForRestartMs: number;
}

export type UpdatePollOutcome =
  | { kind: 'reload' }
  | { kind: 'failed'; message: string }
  | { kind: 'stuck' }
  | { kind: 'working'; text: string };

export function interpretUpdatePoll(input: UpdatePollInput): UpdatePollOutcome {
  const { status, startCommit, sawServerDown, waitingForRestartMs } = input;
  const isOverdue = waitingForRestartMs > RESTART_WAIT_LIMIT_MS;

  if (status === null) {
    return isOverdue ? { kind: 'stuck' } : { kind: 'working', text: 'Restarting Hiring Helper…' };
  }

  if (status.apply.state === 'failed') {
    return { kind: 'failed', message: status.apply.error ?? 'The update did not finish.' };
  }

  if (status.apply.state === 'idle') {
    // A server that answers as idle with a different version, or after a gap, is the new one.
    const hasNewVersion = status.currentCommit !== null && status.currentCommit !== startCommit;
    if (hasNewVersion || sawServerDown) return { kind: 'reload' };
    return isOverdue ? { kind: 'stuck' } : { kind: 'working', text: 'Starting the update…' };
  }

  if (status.apply.state === 'restarting') {
    return isOverdue ? { kind: 'stuck' } : { kind: 'working', text: 'Restarting Hiring Helper…' };
  }

  return { kind: 'working', text: `${status.apply.step ?? 'Updating'}…` };
}
