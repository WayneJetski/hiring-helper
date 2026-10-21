/**
 * Wording for the result of scoring a single applicant.
 */

import type { Notice } from '../components/icons/StatusIcon';
import type { ScoringStatus } from '../types/applicant.types';

/** Turn a finished scoring run into the message shown to the person. */
export function describeSingleScoreOutcome(status: ScoringStatus, applicantName: string): Notice {
  if (status.cancelled) {
    return { tone: 'warning', text: `Scoring ${applicantName} was cancelled.` };
  }
  if (!status.ok) {
    return { tone: 'error', text: status.error ?? `Could not score ${applicantName}.` };
  }
  // The run can end cleanly without saving anything, for example when the résumé is missing.
  if (status.scored === 0) {
    return {
      tone: 'warning',
      text: `${applicantName} was not scored. Check that they have a résumé, then try again.`,
    };
  }
  return { tone: 'success', text: `${applicantName} has been scored.` };
}

/**
 * Message for a finished run over many applicants. A run can end cleanly without
 * saving anything (Claude could not reach its tools, or BambooHR would not hand over
 * the résumés), which must not read as a success.
 */
export function describeBatchOutcome(status: ScoringStatus): Notice {
  if (status.cancelled) {
    const count = status.scored;
    return {
      tone: 'warning',
      text: `Scoring was cancelled. ${count} applicant${count !== 1 ? 's were' : ' was'} scored before it stopped.`,
    };
  }
  if (!status.ok) return { tone: 'error', text: status.error ?? 'Scoring failed.' };
  if (status.scored === 0 && (status.total ?? 1) > 0) {
    return {
      tone: 'warning',
      text:
        'Scoring finished, but nobody was scored. Résumés may not have downloaded from BambooHR, ' +
        'or Claude could not reach its tools. Try again in a few minutes.',
    };
  }
  return { tone: 'success', text: `Scoring finished: ${status.scored} scored.` };
}
