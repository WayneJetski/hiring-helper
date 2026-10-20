/**
 * Picks the applications an incremental sync would otherwise miss: those that
 * belong to a job we have never stored locally.
 *
 * Incremental sync only asks BambooHR for applications changed since the last
 * sync, so applicants who were already in a job before the API user was given
 * access to it (or before the job was first seen) never show up. The full
 * applications list is fetched on every sync anyway (to pull statuses), so this
 * selects, from that list, the not-yet-stored applications of unknown jobs.
 */

import type { BambooHRApplication } from '../types/bamboohr.types.js';

export function selectApplicationsForUnknownJobs(
  allApplications: BambooHRApplication[],
  knownJobIds: ReadonlySet<number>,
  storedApplicationIds: ReadonlySet<number>
): BambooHRApplication[] {
  return allApplications.filter(
    (application) =>
      !knownJobIds.has(application.job.id) && !storedApplicationIds.has(application.id)
  );
}
