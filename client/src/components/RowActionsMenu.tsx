/**
 * RowActionsMenu
 *
 * The "⋮" menu at the end of an applicant row with quick actions. The menu is
 * rendered in a portal at fixed coordinates because the table clips overflow;
 * it closes on outside click, Escape, scroll or resize, and supports arrow keys.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './icons/Icon';
import './RowActionsMenu.css';

export interface RowAction {
  label: string;
  icon: IconName;
  onSelect: () => void;
  isDanger?: boolean;
  /** Opens outside this app (a new tab); shows an external-link icon on the right. */
  isExternal?: boolean;
}

interface RowActionsMenuProps {
  applicantName: string;
  /** Groups of actions; a divider is drawn between groups. */
  actionGroups: RowAction[][];
}

const MENU_WIDTH_PX = 220;
const MENU_GAP_PX = 6;

export function RowActionsMenu({ applicantName, actionGroups }: RowActionsMenuProps): JSX.Element {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback((shouldRestoreFocus: boolean): void => {
    setIsOpen(false);
    if (shouldRestoreFocus) buttonRef.current?.focus();
  }, []);

  // Place the menu under the button, right-aligned to it, flipping above when
  // there is no room below.
  useLayoutEffect(() => {
    if (!isOpen || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const menuHeight = menuRef.current?.offsetHeight ?? 0;
    const hasRoomBelow = rect.bottom + MENU_GAP_PX + menuHeight <= window.innerHeight;
    setPosition({
      top: hasRoomBelow ? rect.bottom + MENU_GAP_PX : Math.max(8, rect.top - MENU_GAP_PX - menuHeight),
      left: Math.max(8, Math.min(rect.right - MENU_WIDTH_PX, window.innerWidth - MENU_WIDTH_PX - 8)),
    });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();

    const handlePointerDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) close(false);
    };
    const handleDismiss = (): void => close(false);
    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('scroll', handleDismiss, true);
    window.addEventListener('resize', handleDismiss);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('scroll', handleDismiss, true);
      window.removeEventListener('resize', handleDismiss);
    };
  }, [isOpen, close]);

  const handleMenuKeyDown = (event: React.KeyboardEvent): void => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []
    );
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(index + 1) % items.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    } else if (event.key === 'Tab') {
      close(false);
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="row-actions-button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={`Actions for ${applicantName}`}
        title="Actions"
        onClick={() => setIsOpen((open) => !open)}
      >
        <Icon name="moreVertical" size={20} />
      </button>

      {isOpen &&
        createPortal(
          // React events bubble through portals, so stop them here or a click on
          // an item would also open the row's detail page.
          <div
            ref={menuRef}
            className="row-actions-menu"
            role="menu"
            aria-label={`Actions for ${applicantName}`}
            style={{
              top: position?.top ?? 0,
              left: position?.left ?? 0,
              width: MENU_WIDTH_PX,
              visibility: position ? 'visible' : 'hidden',
            }}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation();
              handleMenuKeyDown(event);
            }}
          >
            {actionGroups.map((group, groupIndex) => (
              <div key={group.map((action) => action.label).join('|')} role="group">
                {groupIndex > 0 && <div className="row-actions-divider" role="separator" />}
                {group.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    role="menuitem"
                    className={`row-actions-item${action.isDanger ? ' is-danger' : ''}`}
                    title={action.isExternal ? 'Opens in a new tab' : undefined}
                    onClick={() => {
                      close(false);
                      action.onSelect();
                    }}
                  >
                    <Icon name={action.icon} /> {action.label}
                    {action.isExternal && (
                      <Icon name="externalLink" size={14} className="row-actions-external" />
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
