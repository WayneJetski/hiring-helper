/**
 * JobsPage
 *
 * The landing page: pick the job to work on. Everything else (applicants, scoring,
 * settings) hangs off a job, so there is no cross-job view.
 */

import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { useBambooHRSync } from '../hooks/useBambooHRSync';
import { useJobs } from '../hooks/useJobs';
import type { JobSummary } from '../types/applicant.types';
import { formatDate } from '../utils/formatting';
import { Icon } from './icons/Icon';
import { StatusIcon } from './icons/StatusIcon';
import { SyncControls } from './SyncControls';
import './JobsPage.css';

function JobCards({ jobs }: { jobs: JobSummary[] }): JSX.Element {
  return (
    <ul className="job-cards">
      {jobs.map((job) => (
        <li key={job.id}>
          <Link to={`/jobs/${job.id}`} className={`job-card${job.isClosed ? ' is-closed' : ''}`}>
            <span className="job-card-title">{job.title}</span>
            <span className="job-card-stats">
              <strong>{job.activeCount}</strong> applicant{job.activeCount !== 1 ? 's' : ''}
              {job.latestAppliedDate && <> · latest {formatDate(job.latestAppliedDate)}</>}
            </span>
            <span className="job-card-badges">
              {job.isClosed && <span className="job-closed-pill">Closed</span>}
              {!job.isClosed && !job.isReadyToScore && (
                <span className="setup-needed-pill">Setup needed</span>
              )}
              {!job.isClosed && job.isReadyToScore && job.unscoredCount > 0 && (
                <span className="job-card-unscored">{job.unscoredCount} to score</span>
              )}
            </span>
            <Icon name="chevronRight" className="job-card-arrow" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function JobsPage(): JSX.Element {
  const { jobs, isLoading, loadError, reloadJobs } = useJobs();
  const [dataVersion, setDataVersion] = useState<number>(0);

  const handleSynced = useCallback((): void => setDataVersion((version) => version + 1), []);
  const { isSyncing, notice, sync } = useBambooHRSync({ jobs, reloadJobs, onSynced: handleSynced });

  // With no jobs the page itself offers the sync, so the header does not repeat it.
  const isShowingEmptyHero = !isLoading && loadError === null && jobs.length === 0;

  const renderBody = (): JSX.Element => {
    if (isLoading) {
      return (
        <p className="jobs-page-empty" role="status">
          Loading jobs…
        </p>
      );
    }
    if (loadError) {
      return (
        <div className="jobs-page-empty" role="alert">
          <p>Could not load jobs: {loadError}</p>
          <button type="button" className="clear-filters-button" onClick={() => void reloadJobs()}>
            Try again
          </button>
        </div>
      );
    }
    if (jobs.length === 0) {
      return (
        <section className="jobs-empty-hero" aria-labelledby="jobs-empty-title">
          <Icon name="refresh" size={40} className="jobs-empty-icon" />
          <h2 id="jobs-empty-title">No jobs yet</h2>
          <p>
            Hiring Helper has not loaded any jobs from BambooHR. Sync to bring in your job
            postings and their applicants, then pick one to start scoring.
          </p>
          <button
            type="button"
            className="sync-button jobs-empty-cta"
            data-help="sync"
            onClick={() => void sync()}
            disabled={isSyncing}
          >
            <Icon name="refresh" isSpinning={isSyncing} />{' '}
            {isSyncing ? 'Syncing…' : 'Sync with BambooHR'}
          </button>
          <p className="jobs-empty-hint">
            Just connected? The first sync may already be running, and it can take a minute. If
            nothing appears after a sync, check that your BambooHR account has open jobs.
          </p>
        </section>
      );
    }
    const openJobs = jobs.filter((job) => !job.isClosed);
    const closedJobs = jobs.filter((job) => job.isClosed);
    return (
      <>
        {openJobs.length > 0 ? (
          <JobCards jobs={openJobs} />
        ) : (
          <p className="jobs-page-empty">All of your jobs are closed.</p>
        )}
        {closedJobs.length > 0 && (
          <details className="closed-jobs" open={openJobs.length === 0}>
            <summary>Closed jobs ({closedJobs.length})</summary>
            <JobCards jobs={closedJobs} />
          </details>
        )}
      </>
    );
  };

  return (
    <div className="applicants-list jobs-page">
      <div className="header">
        <div className="header-title">
          <h1>Jobs</h1>
          <p className="total-count">Pick a job to see its applicants and settings.</p>
        </div>
        {!isShowingEmptyHero && (
          <SyncControls isSyncing={isSyncing} onSync={() => void sync()} dataVersion={dataVersion} />
        )}
      </div>

      {notice && (
        <div className={`sync-message ${notice.tone}`} role="status">
          <StatusIcon tone={notice.tone} />
          <span>{notice.text}</span>
        </div>
      )}

      {renderBody()}
    </div>
  );
}
