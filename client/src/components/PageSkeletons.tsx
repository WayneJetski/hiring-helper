/**
 * Skeletons of the applicant list and the applicant page. They reuse the real
 * layout classes, so the placeholders sit exactly where the content will.
 */

import { Skeleton, SkeletonLines } from './Skeleton';

const LIST_ROW_COUNT = 8;
// Varied widths so the rows read as real text rather than a stack of identical bars.
const NAME_WIDTHS = [150, 120, 170, 135, 160, 110, 145, 125];
const SUMMARY_WIDTHS = [78, 64, 85, 70, 80, 60, 74, 68];
const EMAIL_WIDTHS = [190, 160, 175, 150, 200, 140, 180, 165];
const COLUMN_LABELS = ['Name', 'Email', 'Stage', 'Applied Date', 'Match', 'Flags'];

export function ApplicantsListSkeleton(): JSX.Element {
  return (
    <div className="applicants-list" role="status" aria-busy="true" aria-label="Loading applicants">
      <div className="header">
        <div className="header-title">
          <h1>Job Applicants</h1>
          <Skeleton width={180} height="1rem" />
        </div>
        <div className="header-sync">
          <Skeleton width={190} height="2.9rem" />
        </div>
      </div>

      <div className="applicants-filters">
        <div className="filters-row">
          <Skeleton width={260} height="2.9rem" />
          <Skeleton width={130} height="2.9rem" />
          <Skeleton width="100%" height="2.9rem" className="skeleton-search" />
          <Skeleton width={220} height="2.9rem" />
        </div>
      </div>

      <div className="action-bar">
        <Skeleton width={210} height="2.75rem" />
        <Skeleton width={230} height="2.75rem" />
        <Skeleton width={150} height="2.75rem" />
      </div>

      <div className="table-container">
        <table className="applicants-table">
          <thead>
            <tr>
              {COLUMN_LABELS.map((label) => (
                <th key={label}>{label}</th>
              ))}
              <th className="row-actions-cell" />
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: LIST_ROW_COUNT }, (_, index) => (
              <tr key={index}>
                <td className="name-cell">
                  <span className="skeleton-table-name">
                    <Skeleton width={NAME_WIDTHS[index]} height="1rem" />
                    <Skeleton width={`${SUMMARY_WIDTHS[index]}%`} height="0.75rem" />
                  </span>
                </td>
                <td>
                  <Skeleton width={EMAIL_WIDTHS[index]} height="0.9rem" />
                </td>
                <td>
                  <Skeleton width={72} height="1.5rem" isPill />
                </td>
                <td>
                  <Skeleton width={90} height="0.9rem" />
                </td>
                <td>
                  <Skeleton width={64} height="1.5rem" isPill />
                </td>
                <td>
                  <Skeleton width={index % 3 === 0 ? 90 : 44} height="1.4rem" isPill />
                </td>
                <td className="row-actions-cell">
                  <span className="skeleton-row-actions">
                    <Skeleton width={24} height="1.5rem" />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SkeletonCardFields({ title, fieldCount }: { title: string; fieldCount: number }): JSX.Element {
  return (
    <section className="detail-section">
      <h2>{title}</h2>
      <div className="skeleton-card-fields">
        {Array.from({ length: fieldCount }, (_, index) => (
          <span key={index} className="skeleton-card-field">
            <Skeleton width={70} height="0.75rem" />
            <Skeleton width={index % 2 === 0 ? '80%' : '55%'} height="1rem" />
          </span>
        ))}
      </div>
    </section>
  );
}

export function ApplicantDetailSkeleton(): JSX.Element {
  return (
    <div className="applicant-detail" role="status" aria-busy="true" aria-label="Loading applicant">
      <div className="detail-topbar">
        <Skeleton width={320} height="1.1rem" />
        <Skeleton width={130} height="2rem" />
      </div>

      <div className="detail-container">
        <header className="detail-header">
          <div className="header-main">
            <Skeleton width={280} height="2.2rem" isOnDark />
            <Skeleton width={340} height="1rem" isOnDark />
            <span className="skeleton-header-badges">
              <Skeleton width={80} height="1.7rem" isPill isOnDark />
              <Skeleton width={110} height="1.7rem" isPill isOnDark />
              <Skeleton width={70} height="1.7rem" isPill isOnDark />
            </span>
          </div>
          <div className="skeleton-header-actions">
            <Skeleton width={150} height="2.6rem" isOnDark />
            <Skeleton width={320} height="2.2rem" isOnDark />
          </div>
        </header>

        <div className="detail-grid">
          <aside className="detail-sidebar">
            <SkeletonCardFields title="Contact Information" fieldCount={2} />
            <SkeletonCardFields title="Application Details" fieldCount={4} />
          </aside>
          <div className="detail-main">
            <div className="skeleton-assessment">
              <div className="skeleton-assessment-header">
                <Skeleton width={170} height="1.4rem" />
                <Skeleton width={150} height="2rem" isPill />
              </div>
              <SkeletonLines count={2} />
              <SkeletonLines count={5} />
              <SkeletonLines count={3} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
