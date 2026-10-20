/**
 * ApplicantDetail Component
 * Displays detailed information about a single applicant
 */

import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApplicant } from '../hooks/useApplicant';
import { apiService } from '../services/api.service';
import { AISummaryCard } from './AISummaryCard';
import { ResumeModal } from './ResumeModal';
import { StageMover } from './StageMover';
import { ApplicantDetailSkeleton } from './PageSkeletons';
import { Icon } from './icons/Icon';
import { RatingStars } from './icons/RatingStars';
import type { Status } from '../types/applicant.types';
import { getNeighbors, loadNavigationIds } from '../utils/applicantNavigation';
import { buildCandidateLink } from '../utils/bamboohrLinks';
import { saveSelectedJobId } from '../utils/filterStorage';
import {
  FLAG_DISPLAY,
  formatPhoneNumber,
  getConfidenceClass,
  getConfidenceLevel,
} from '../utils/matchDisplay';
import './ApplicantDetail.css';

interface ApplicantDetailProps {
  bambooHRSubdomain: string | null;
}

export function ApplicantDetail({ bambooHRSubdomain }: ApplicantDetailProps): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const applicantId = id ? parseInt(id, 10) : null;

  const { applicant, loading, error, refetch } = useApplicant(applicantId);

  const [statuses, setStatuses] = useState<Status[]>([]);
  const [isResumeOpen, setIsResumeOpen] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    apiService
      .getStatuses()
      .then((fetched) => {
        if (!cancelled) setStatuses(fetched);
      })
      .catch((err) => console.error('Failed to load statuses:', err));
    return () => {
      cancelled = true;
    };
  }, []);

  const handleBack = (): void => {
    navigate('/');
  };

  // Open the list on this applicant's job (the list remembers its job selection).
  const handleOpenJob = (jobId: number): void => {
    saveSelectedJobId(jobId);
    navigate('/');
  };

  const neighbors = useMemo(
    () => (applicantId !== null ? getNeighbors(loadNavigationIds(), applicantId) : null),
    [applicantId]
  );

  const goToApplicant = (nextId: number | null): void => {
    if (nextId !== null) navigate(`/applicants/${nextId}`);
  };

  // Rendered in every state (loading/error/loaded) so stepping between
  // applicants does not flash the modal closed while the next one loads.
  const resumeModal =
    isResumeOpen && applicantId !== null ? (
      <ResumeModal
        applicationId={applicantId}
        applicantName={applicant?.name ?? 'Applicant'}
        position={neighbors ? { current: neighbors.position, total: neighbors.total } : undefined}
        onPrevious={neighbors?.previousId != null ? () => goToApplicant(neighbors.previousId) : undefined}
        onNext={neighbors?.nextId != null ? () => goToApplicant(neighbors.nextId) : undefined}
        onClose={() => setIsResumeOpen(false)}
      >
        {applicant && (
          <StageMover
            key={applicant.id}
            applicantId={applicant.id}
            statuses={statuses}
            hasRejectShortcut
            onMoved={async () => {
              await refetch();
              if (neighbors?.nextId != null) goToApplicant(neighbors.nextId);
            }}
          />
        )}
      </ResumeModal>
    ) : null;

  const formatDate = (dateString: string): string => {
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return dateString;
    }
  };

  if (loading) {
    return (
      <>
        <ApplicantDetailSkeleton />
        {resumeModal}
      </>
    );
  }

  if (error) {
    return (
      <div className="applicant-detail">
        <button onClick={handleBack} className="back-button">
          <Icon name="arrowLeft" /> Back to list
        </button>
        <div className="error">Error: {error}</div>
        {resumeModal}
      </div>
    );
  }

  if (!applicant) {
    return (
      <div className="applicant-detail">
        <button onClick={handleBack} className="back-button">
          <Icon name="arrowLeft" /> Back to list
        </button>
        <div className="error">Applicant not found</div>
      </div>
    );
  }

  // Null until BambooHR is connected and synced, in which case the button is not shown.
  const bambooHRLink = buildCandidateLink(bambooHRSubdomain, applicant.id);

  return (
    <div className="applicant-detail">
      <div className="detail-topbar">
        <nav className="crumbs" aria-label="Breadcrumb" data-help="back">
          <ol>
            <li>
              <button type="button" className="crumb-link" onClick={handleBack}>
                <Icon name="arrowLeft" size={16} /> Job Applicants
              </button>
            </li>
            <li>
              <button type="button" className="crumb-link" onClick={() => handleOpenJob(applicant.jobId)}>
                {applicant.jobTitle}
              </button>
            </li>
            <li className="crumb-current" aria-current="page">
              {applicant.name}
            </li>
          </ol>
        </nav>

        {neighbors && (
          <div className="stepper" data-help="stepper">
            <button
              type="button"
              aria-label="Previous applicant"
              disabled={neighbors.previousId === null}
              onClick={() => goToApplicant(neighbors.previousId)}
            >
              <Icon name="arrowLeft" size={16} />
            </button>
            <span>
              {neighbors.position} of {neighbors.total}
            </span>
            <button
              type="button"
              aria-label="Next applicant"
              disabled={neighbors.nextId === null}
              onClick={() => goToApplicant(neighbors.nextId)}
            >
              <Icon name="arrowRight" size={16} />
            </button>
          </div>
        )}
      </div>

      <div className="detail-container">
        <header className="detail-header">
          <div className="header-main">
            <h1>{applicant.name}</h1>
            <p className="header-subtitle">
              {applicant.jobTitle} · Applied {formatDate(applicant.appliedDate)}
            </p>
            <div className="header-badges">
              <span className="stage-badge">{applicant.stage}</span>
              {applicant.confidence !== undefined ? (
                <span
                  className={`confidence-badge ${getConfidenceClass(applicant.confidence)}`}
                  data-help="match"
                >
                  {applicant.confidence}% · {getConfidenceLevel(applicant.confidence)}
                </span>
              ) : (
                <span className="not-scored-badge" data-help="match">
                  Not scored yet
                </span>
              )}
              {applicant.flags?.map((flag) => (
                <span key={flag} className={`flag-badge flag-${flag}`}>
                  {FLAG_DISPLAY[flag] ? (
                    <>
                      <Icon name={FLAG_DISPLAY[flag].icon} size={13} />
                      {FLAG_DISPLAY[flag].label}
                    </>
                  ) : (
                    flag
                  )}
                </span>
              ))}
            </div>
          </div>

          <div className="header-actions">
            <div className="header-buttons">
              {applicant.resumeFileId && (
                <button
                  type="button"
                  className="resume-button"
                  onClick={() => setIsResumeOpen(true)}
                  data-help="resume"
                >
                  <Icon name="fileText" /> View résumé
                </button>
              )}
              {bambooHRLink && (
                <a
                  className="resume-button"
                  href={bambooHRLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Opens in a new tab"
                  data-help="bamboohr"
                >
                  <Icon name="externalLink" /> Open in BambooHR
                </a>
              )}
            </div>
            <StageMover
              key={applicant.id}
              applicantId={applicant.id}
              statuses={statuses}
              variant="onDark"
              onMoved={() => refetch()}
            />
          </div>
        </header>

        <div className="detail-grid">
          <aside className="detail-sidebar">
            <section className="detail-section">
              <h2>Contact Information</h2>
              <div className="info-grid">
                <div className="info-item">
                  <span className="info-label">Email:</span>
                  <a href={`mailto:${applicant.email}`} className="info-value link">
                    {applicant.email}
                  </a>
                </div>
                {applicant.phoneNumber && (
                  <div className="info-item">
                    <span className="info-label">Phone:</span>
                    <a href={`tel:${applicant.phoneNumber}`} className="info-value link">
                      {formatPhoneNumber(applicant.phoneNumber)}
                    </a>
                  </div>
                )}
                {applicant.address && (
                  <div className="info-item">
                    <span className="info-label">Address:</span>
                    {applicant.address.addressLine1 && (
                      <span className="info-value">{applicant.address.addressLine1}</span>
                    )}
                    {applicant.address.addressLine2 && (
                      <span className="info-value">{applicant.address.addressLine2}</span>
                    )}
                    {[applicant.address.city, applicant.address.state, applicant.address.zipcode]
                      .filter(Boolean)
                      .join(', ') && (
                      <span className="info-value">
                        {[applicant.address.city, applicant.address.state, applicant.address.zipcode]
                          .filter(Boolean)
                          .join(', ')}
                      </span>
                    )}
                    {applicant.address.country && (
                      <span className="info-value">{applicant.address.country}</span>
                    )}
                  </div>
                )}
              </div>
            </section>

            <section className="detail-section">
              <h2>Application Details</h2>
              <div className="info-grid">
                <div className="info-item">
                  <span className="info-label">Applied Date:</span>
                  <span className="info-value">{formatDate(applicant.appliedDate)}</span>
                </div>
                <div className="info-item">
                  <span className="info-label">Rating:</span>
                  <span className="info-value rating-stars">
                    <RatingStars rating={applicant.rating} />
                  </span>
                </div>
                {applicant.source && (
                  <div className="info-item">
                    <span className="info-label">Source:</span>
                    <span className="info-value">{applicant.source}</span>
                  </div>
                )}
                {applicant.availableStartDate && (
                  <div className="info-item">
                    <span className="info-label">Available Start Date:</span>
                    <span className="info-value">{formatDate(applicant.availableStartDate)}</span>
                  </div>
                )}
                {applicant.desiredSalary && (
                  <div className="info-item">
                    <span className="info-label">Desired Pay:</span>
                    <span className="info-value">{applicant.desiredSalary}</span>
                  </div>
                )}
                {applicant.commutingAnswer && (
                  <div className="info-item">
                    <span className="info-label">Within commuting distance?</span>
                    <span className="info-value">{applicant.commutingAnswer}</span>
                  </div>
                )}
              </div>
            </section>

            {(applicant.linkedInUrl || applicant.websiteUrl) && (
              <section className="detail-section">
                <h2>Online Presence</h2>
                <div className="info-grid">
                  {applicant.linkedInUrl && (
                    <div className="info-item">
                      <span className="info-label">LinkedIn:</span>
                      <a
                        href={applicant.linkedInUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="info-value link"
                      >
                        <Icon name="linkedin" /> View profile
                      </a>
                    </div>
                  )}
                  {applicant.websiteUrl && (
                    <div className="info-item">
                      <span className="info-label">Website:</span>
                      <a
                        href={applicant.websiteUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="info-value link"
                      >
                        <Icon name="globe" /> Visit website
                      </a>
                    </div>
                  )}
                </div>
              </section>
            )}

          </aside>

          <div className="detail-main">
            <AISummaryCard summary={applicant.aiSummary} />
            {applicant.coverLetter && (
              <section className="detail-section">
                <h2>Cover Letter</h2>
                <div className="cover-letter">{applicant.coverLetter}</div>
              </section>
            )}

          </div>
        </div>
      </div>

      {resumeModal}
    </div>
  );
}

