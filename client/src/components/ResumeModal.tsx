/**
 * ResumeModal
 *
 * Large modal that shows an applicant's résumé PDF inline (served by
 * GET /api/applicants/:id/resume/file) instead of opening a new tab. Optionally
 * steps to the previous/next applicant (arrow keys too) and hosts action
 * buttons in a footer, so a list can be screened without leaving the viewer.
 * Closes on Escape, backdrop click, or the close button; keeps keyboard focus
 * inside while open and returns it to where it was on close.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { useDialogBehavior } from '../hooks/useDialogBehavior';
import { Icon } from './icons/Icon';
import './ResumeModal.css';

interface ResumeModalProps {
  applicationId: number;
  applicantName: string;
  /** "3 of 25"-style position, shown when stepping through a list. */
  position?: { current: number; total: number };
  onPrevious?: () => void;
  onNext?: () => void;
  onClose: () => void;
  /** Action controls rendered in a footer under the PDF. */
  children?: ReactNode;
}

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return !!element && ['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName);
}

export function ResumeModal({
  applicationId,
  applicantName,
  position,
  onPrevious,
  onNext,
  onClose,
  children,
}: ResumeModalProps): JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);
  const resumeUrl = `/api/applicants/${applicationId}/resume/file`;

  // Latest handlers in refs so the key listener is attached once.
  const handlersRef = useRef({ onPrevious, onNext });
  handlersRef.current = { onPrevious, onNext };

  useDialogBehavior(dialogRef, onClose);

  // Arrow keys step between applicants (unless the user is typing in a field).
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const { onPrevious: previous, onNext: next } = handlersRef.current;
      if (event.key === 'ArrowLeft' && previous && !isTypingTarget(event.target)) previous();
      if (event.key === 'ArrowRight' && next && !isTypingTarget(event.target)) next();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="resume-modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="resume-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Résumé for ${applicantName}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="resume-modal-header">
          <div className="resume-modal-title">
            {(onPrevious || onNext) && (
              <div className="resume-modal-steps">
                <button
                  type="button"
                  className="resume-modal-step"
                  onClick={onPrevious}
                  disabled={!onPrevious}
                  aria-label="Previous applicant"
                  title="Previous applicant (left arrow key)"
                >
                  <Icon name="arrowLeft" />
                </button>
                <button
                  type="button"
                  className="resume-modal-step"
                  onClick={onNext}
                  disabled={!onNext}
                  aria-label="Next applicant"
                  title="Next applicant (right arrow key)"
                >
                  <Icon name="arrowRight" />
                </button>
              </div>
            )}
            <h3>Résumé: {applicantName}</h3>
            {position && (
              <span className="resume-modal-position">
                {position.current} of {position.total}
              </span>
            )}
          </div>
          <div className="resume-modal-actions">
            <a href={resumeUrl} target="_blank" rel="noopener noreferrer">
              Open in new tab <Icon name="externalLink" />
            </a>
            <button type="button" className="resume-modal-close" onClick={onClose} autoFocus>
              <Icon name="close" /> Close
            </button>
          </div>
        </div>
        <iframe
          key={applicationId}
          className="resume-modal-frame"
          src={resumeUrl}
          title={`Résumé for ${applicantName}`}
        />
        {children && <div className="resume-modal-footer">{children}</div>}
      </div>
    </div>
  );
}
