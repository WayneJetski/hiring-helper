/**
 * A closed job is read-only: applicants can be read, searched and opened, but not
 * scored, moved or rejected. The server refuses these too; these are the reasons the
 * disabled controls give.
 */

export const CLOSED_JOB_SCORING_REASON =
  'This job is closed, so its applicants can no longer be scored.';

export const CLOSED_JOB_CHANGES_REASON =
  'This job is closed, so its applicants can no longer be moved or rejected.';
