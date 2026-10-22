/**
 * ViewsMenu
 *
 * "Views" dropdown for the applicants list: ready-made views (for example "To
 * review, best matches first"), plus views the user saved themselves. A view
 * bundles the status, scored and flag filters, search text and sort order.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildBuiltInViews,
  deleteView,
  loadSavedViews,
  saveView,
  type FlagFilter,
  type ListView,
  type ScoreFilter,
  type ViewSortColumn,
} from '../utils/savedViews';
import { Icon } from './icons/Icon';
import './ViewsMenu.css';

interface ViewsMenuProps {
  statuses: Array<{ id: number; label: string }>;
  current: {
    statusIds: number[];
    search: string;
    scoreFilter: ScoreFilter;
    flagFilter: FlagFilter;
    sortColumn: ViewSortColumn;
    sortDirection: 'asc' | 'desc';
  };
  onApply: (view: ListView) => void;
}

export function ViewsMenu({ statuses, current, onApply }: ViewsMenuProps): JSX.Element {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [savedViews, setSavedViews] = useState<ListView[]>(loadSavedViews);
  const [newName, setNewName] = useState<string>('');
  const containerRef = useRef<HTMLDivElement>(null);

  const builtInViews = useMemo(() => buildBuiltInViews(statuses), [statuses]);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const apply = useCallback(
    (view: ListView): void => {
      onApply(view);
      setIsOpen(false);
    },
    [onApply]
  );

  const handleSave = (): void => {
    if (newName.trim() === '') return;
    setSavedViews(saveView({ name: newName, ...current }));
    setNewName('');
  };

  return (
    <div className="views-menu" ref={containerRef}>
      <button
        type="button"
        className="views-menu-button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-haspopup="true"
        title="Switch to a ready-made or saved view of the list"
      >
        Views <Icon name="chevronDown" />
      </button>

      {isOpen && (
        <div className="views-menu-panel">
          <div className="views-menu-section">
            <div className="views-menu-heading">Ready-made</div>
            {builtInViews.map((view) => (
              <button key={view.id} type="button" className="views-menu-item" onClick={() => apply(view)}>
                {view.name}
              </button>
            ))}
          </div>

          <div className="views-menu-section">
            <div className="views-menu-heading">Your saved views</div>
            {savedViews.length === 0 && (
              <p className="views-menu-empty">None yet. Set up the list how you like it, then save it below.</p>
            )}
            {savedViews.map((view) => (
              <div key={view.id} className="views-menu-saved">
                <button type="button" className="views-menu-item" onClick={() => apply(view)}>
                  {view.name}
                </button>
                <button
                  type="button"
                  className="views-menu-delete"
                  onClick={() => setSavedViews(deleteView(view.id))}
                  aria-label={`Delete saved view ${view.name}`}
                  title="Delete this saved view"
                >
                  <Icon name="close" />
                </button>
              </div>
            ))}
          </div>

          <div className="views-menu-save">
            <label htmlFor="views-menu-name" className="views-menu-heading">
              Save the current list as a view
            </label>
            <div className="views-menu-save-row">
              <input
                id="views-menu-name"
                type="text"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleSave();
                }}
                placeholder="Name, for example Top picks"
              />
              <button type="button" onClick={handleSave} disabled={newName.trim() === ''}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
