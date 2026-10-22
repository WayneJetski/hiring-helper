/**
 * JobPage
 *
 * One job: a breadcrumb back to the jobs list, and two tabs, its applicants and its
 * settings (posting text and scoring criteria). The job comes from the address, so a
 * page can be bookmarked and survives a reload.
 */

import { useCallback } from 'react';
import { Link, NavLink, useParams } from 'react-router-dom';
import { useJobs } from '../hooks/useJobs';
import type { SetupStatus } from '../types/applicant.types';
import { ApplicantsList } from './ApplicantsList';
import { ApplicantsListSkeleton } from './PageSkeletons';
import { JobConfig } from './JobConfig';
import './JobPage.css';

interface JobPageProps {
  tab: 'applicants' | 'settings';
  bambooHRSubdomain: string | null;
  claude: SetupStatus['claude'];
}

export function JobPage({ tab, bambooHRSubdomain, claude }: JobPageProps): JSX.Element {
  const { jobId: jobIdParam } = useParams<{ jobId: string }>();
  const jobId = Number(jobIdParam);
  const { jobs, isLoading, loadError, reloadJobs } = useJobs();
  const job = jobs.find((candidate) => candidate.id === jobId);

  const handleSettingsSaved = useCallback((): void => void reloadJobs(), [reloadJobs]);

  if (isLoading) return <ApplicantsListSkeleton />;

  if (!job) {
    return (
      <div className="applicants-list job-page">
        <div className="load-error" role="alert">
          {loadError ?? 'That job could not be found. It may have been removed.'}
        </div>
        <Link to="/" className="clear-filters-button job-page-back">
          Back to jobs
        </Link>
      </div>
    );
  }

  return (
    <div className="applicants-list job-page">
      <nav className="crumbs job-crumbs" aria-label="Breadcrumb" data-help="breadcrumb">
        <ol>
          <li>
            <Link to="/" className="crumb-link">
              Jobs
            </Link>
          </li>
          <li className="crumb-current" aria-current="page">
            {job.title}
            {job.isClosed && <span className="job-closed-pill job-crumb-pill">Closed</span>}
          </li>
        </ol>
      </nav>

      <div className="job-tabs" role="navigation" aria-label="Job sections">
        <NavLink to={`/jobs/${job.id}`} end className="job-tab">
          Applicants <span className="job-tab-count">{job.activeCount}</span>
        </NavLink>
        <NavLink to={`/jobs/${job.id}/settings`} className="job-tab" data-help="job-settings">
          Settings
          {!job.isReadyToScore && <span className="setup-needed-pill">Setup needed</span>}
        </NavLink>
      </div>

      {tab === 'settings' ? (
        <JobConfig key={job.id} jobId={job.id} onSaved={handleSettingsSaved} />
      ) : (
        <ApplicantsList
          key={job.id}
          job={job}
          jobs={jobs}
          reloadJobs={reloadJobs}
          bambooHRSubdomain={bambooHRSubdomain}
          claude={claude}
        />
      )}
    </div>
  );
}
