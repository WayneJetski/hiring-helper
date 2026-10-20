/**
 * Modal
 *
 * A centered dialog with a title bar and close button. Closes on Escape or a
 * click on the backdrop, keeps keyboard focus inside, and restores focus on
 * close (see useDialogBehavior).
 */

import { useRef, type ReactNode } from 'react';
import { useDialogBehavior } from '../hooks/useDialogBehavior';
import { Icon } from './icons/Icon';
import './Modal.css';

interface ModalProps {
  title: string;
  onClose: () => void;
  /** `wide` for content that needs room, such as editors with a side menu. */
  size?: 'default' | 'wide';
  children: ReactNode;
}

export function Modal({ title, onClose, size = 'default', children }: ModalProps): JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogBehavior(dialogRef, onClose);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className={`modal-dialog${size === 'wide' ? ' is-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="modal-close" onClick={onClose} autoFocus>
            <Icon name="close" /> Close
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
