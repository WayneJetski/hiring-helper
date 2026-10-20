/**
 * What the top bar's BambooHR badge says. Pure, so the wording is testable.
 */

import type { BambooHRConnection } from '../types/applicant.types';

export type ConnectionState = 'checking' | 'online' | 'offline';

export interface ConnectionStatus {
  state: ConnectionState;
  /** Why it is offline (or a short confirmation), shown as the badge's tooltip. */
  message: string;
}

export const CHECKING_STATUS: ConnectionStatus = {
  state: 'checking',
  message: 'Checking the BambooHR connection…',
};

export const NO_INTERNET_STATUS: ConnectionStatus = {
  state: 'offline',
  message: 'This computer appears to be offline.',
};

/** The result of testing the saved BambooHR credentials. */
export function statusFromConnection(connection: BambooHRConnection): ConnectionStatus {
  if (connection.ok === true) return { state: 'online', message: connection.message };
  return { state: 'offline', message: connection.message || 'Could not reach BambooHR.' };
}

/** The check itself failed, so Hiring Helper's own server could not be asked. */
export function statusFromError(error: unknown): ConnectionStatus {
  const detail = error instanceof Error && error.message ? ` (${error.message})` : '';
  return { state: 'offline', message: `Could not check the BambooHR connection${detail}.` };
}

export function describeConnection(status: ConnectionStatus, subdomain: string): string {
  const address = `${subdomain}.bamboohr.com`;
  if (status.state === 'online') return `Connected to ${address}`;
  if (status.state === 'offline') return `Not connected to ${address}`;
  return `Checking ${address}…`;
}
