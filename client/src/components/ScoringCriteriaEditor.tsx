/**
 * ScoringCriteriaEditor
 *
 * The only part of the scoring instructions a user edits: the weighted
 * evaluation areas and which red flags are on (location with its own place).
 * Each red flag tags an applicant and can carry a score penalty (a slider, none by default).
 * Everything else in the instructions sent to Claude (safety rules, scoring
 * rules, the output format) is managed for them and never shown here.
 */

import { useState, type ReactNode } from 'react';
import type { FlagPenalty, ScoringConfig, ScoringDimension } from '../types/applicant.types';
import {
  FLAG_PENALTY_LEVELS,
  MAX_DIMENSIONS,
  createDimension,
  describePointsTotal,
  moveDimension,
  totalPoints,
} from '../utils/scoringConfig';
import { Icon } from './icons/Icon';
import './ScoringCriteriaEditor.css';

interface ScoringCriteriaEditorProps {
  value: ScoringConfig;
  onChange: (next: ScoringConfig) => void;
  isDisabled?: boolean;
  /** Shown under the "Evaluation framework" heading (for example the AI suggestion card). */
  frameworkTopContent?: ReactNode;
}

type FlagKey = keyof ScoringConfig['redFlags'];
type EditorSection = 'framework' | 'flags';

const FLAG_ROWS: Array<{ key: FlagKey; title: string; description: string }> = [
  {
    key: 'nameCapitalization',
    title: 'Name capitalization',
    description:
      'The applicant typed their name in ALL CAPS, all lowercase, or with uneven capitals (for example "JOHN smith").',
  },
  {
    key: 'location',
    title: 'Location',
    description: 'The applicant is not in the area where this role is based.',
  },
  {
    key: 'studying',
    title: 'Still studying',
    description: 'The applicant is a current student with little professional experience.',
  },
  {
    key: 'noExperience',
    title: 'No relevant experience',
    description: 'The applicant has no relevant professional experience for this role.',
  },
  {
    key: 'tenureGaps',
    title: 'Short tenures or gaps',
    description:
      'A pattern of short jobs, or unexplained gaps between jobs. Internships, placements and contract roles are not counted as short.',
  },
  {
    key: 'salaryLow',
    title: 'Desired pay too low',
    description:
      'Checked from the pay the applicant entered on their application, not from the résumé. Hourly or unclear answers are ignored.',
  },
  {
    key: 'salaryHigh',
    title: 'Desired pay too high',
    description:
      'Checked from the pay the applicant entered on their application, not from the résumé. Hourly or unclear answers are ignored.',
  },
];

interface PenaltySliderProps {
  flagTitle: string;
  penalty: FlagPenalty;
  onChange: (penalty: FlagPenalty) => void;
  isDisabled: boolean;
}

/** None / A bit / A lot / Dealbreaker, as a four-step slider with its effect spelled out. */
function PenaltySlider({ flagTitle, penalty, onChange, isDisabled }: PenaltySliderProps): JSX.Element {
  const stepIndex = FLAG_PENALTY_LEVELS.findIndex((level) => level.value === penalty);
  const current = FLAG_PENALTY_LEVELS[stepIndex] ?? FLAG_PENALTY_LEVELS[0];

  return (
    <div className="criteria-penalty">
      <span className="criteria-penalty-heading">Score penalty</span>
      <input
        type="range"
        className={`criteria-penalty-slider level-${current.value}`}
        min={0}
        max={FLAG_PENALTY_LEVELS.length - 1}
        step={1}
        value={Math.max(0, stepIndex)}
        onChange={(event) => onChange(FLAG_PENALTY_LEVELS[Number(event.target.value)].value)}
        disabled={isDisabled}
        aria-label={`Score penalty for ${flagTitle}`}
        aria-valuetext={`${current.label}. ${current.effect}`}
      />
      <div className="criteria-penalty-steps" aria-hidden="true">
        {FLAG_PENALTY_LEVELS.map((level) => (
          <span key={level.value} className={level.value === current.value ? 'is-current' : undefined}>
            {level.label}
          </span>
        ))}
      </div>
      <span className="criteria-hint criteria-penalty-effect">{current.effect}</span>
    </div>
  );
}

export function ScoringCriteriaEditor({
  value,
  onChange,
  isDisabled = false,
  frameworkTopContent,
}: ScoringCriteriaEditorProps): JSX.Element {
  const total = totalPoints(value.dimensions);
  const totalSummary = describePointsTotal(total);

  const [activeSection, setActiveSection] = useState<EditorSection>('framework');

  const flagsOn = Object.values(value.redFlags).filter((flag) => flag.enabled).length;
  const flagsTotal = Object.keys(value.redFlags).length;
  const sections: Array<{ id: EditorSection; label: string; summary: string; hasProblem: boolean }> = [
    {
      id: 'framework',
      label: 'Evaluation framework',
      summary: totalSummary.isValid ? `${value.dimensions.length} areas, 100 points` : totalSummary.text,
      hasProblem: !totalSummary.isValid,
    },
    {
      id: 'flags',
      label: 'Red flags',
      summary: `${flagsOn} of ${flagsTotal} on`,
      hasProblem: false,
    },
  ];

  const handleNavKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    setActiveSection((current) => (current === 'framework' ? 'flags' : 'framework'));
  };

  const updateDimension = (index: number, changes: Partial<ScoringDimension>): void => {
    onChange({
      ...value,
      dimensions: value.dimensions.map((dimension, i) =>
        i === index ? { ...dimension, ...changes } : dimension
      ),
    });
  };

  const removeDimension = (index: number): void => {
    onChange({ ...value, dimensions: value.dimensions.filter((_, i) => i !== index) });
  };

  const setFlagEnabled = (key: FlagKey, enabled: boolean): void => {
    onChange({ ...value, redFlags: { ...value.redFlags, [key]: { ...value.redFlags[key], enabled } } });
  };

  const setFlagPenalty = (key: FlagKey, penalty: FlagPenalty): void => {
    onChange({ ...value, redFlags: { ...value.redFlags, [key]: { ...value.redFlags[key], penalty } } });
  };

  const setSalaryThreshold = (key: 'salaryLow' | 'salaryHigh', text: string): void => {
    const digits = text.replace(/\D/g, '');
    const threshold = digits === '' ? null : Number(digits);
    onChange({
      ...value,
      redFlags: { ...value.redFlags, [key]: { ...value.redFlags[key], threshold } },
    });
  };

  const setLocale = (locale: string): void => {
    onChange({
      ...value,
      redFlags: { ...value.redFlags, location: { ...value.redFlags.location, locale } },
    });
  };

  return (
    <div className="criteria-editor">
      <div className="criteria-layout">
      <nav
        className="criteria-nav"
        role="tablist"
        aria-orientation="vertical"
        aria-label="Scoring criteria sections"
        onKeyDown={handleNavKeyDown}
      >
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            role="tab"
            id={`criteria-tab-${section.id}`}
            aria-selected={activeSection === section.id}
            aria-controls={`criteria-panel-${section.id}`}
            tabIndex={activeSection === section.id ? 0 : -1}
            className={`criteria-nav-item${activeSection === section.id ? ' is-active' : ''}${section.hasProblem ? ' has-problem' : ''}`}
            onClick={() => setActiveSection(section.id)}
          >
            <span className="criteria-nav-label">
              {section.label}
              {section.hasProblem && <Icon name="alertTriangle" size={14} />}
            </span>
            <span className="criteria-nav-summary">{section.summary}</span>
          </button>
        ))}
      </nav>

      <div className="criteria-content">
      {activeSection === 'framework' && (
      <section
        role="tabpanel"
        id="criteria-panel-framework"
        aria-labelledby="criteria-framework-heading"
      >
        <h3 id="criteria-framework-heading">Evaluation framework</h3>
        {frameworkTopContent}
        <p className="criteria-hint">
          Hiring Helper scores each applicant from 0 to 100 by adding up points in these areas. Give more
          points to what matters most for this role. The points must total exactly 100.
        </p>

        <ol className="criteria-areas">
          {value.dimensions.map((dimension, index) => (
            <li key={dimension.id} className="criteria-area">
              <div className="criteria-area-top">
                <input
                  type="text"
                  className="criteria-name"
                  value={dimension.name}
                  onChange={(event) => updateDimension(index, { name: event.target.value })}
                  placeholder="Area name, for example Technical Skills"
                  aria-label={`Name of area ${index + 1}`}
                  disabled={isDisabled}
                  maxLength={80}
                />
                <label className="criteria-points">
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={Number.isFinite(dimension.maxPoints) ? dimension.maxPoints : ''}
                    onChange={(event) =>
                      updateDimension(index, {
                        maxPoints: event.target.value === '' ? Number.NaN : Number(event.target.value),
                      })
                    }
                    aria-label={`Points for ${dimension.name || `area ${index + 1}`}`}
                    disabled={isDisabled}
                  />
                  <span>points</span>
                </label>
                <div className="criteria-area-tools">
                  <button
                    type="button"
                    onClick={() => onChange({ ...value, dimensions: moveDimension(value.dimensions, index, -1) })}
                    disabled={isDisabled || index === 0}
                    aria-label={`Move ${dimension.name || `area ${index + 1}`} up`}
                    title="Move up"
                  >
                    <Icon name="arrowUp" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onChange({ ...value, dimensions: moveDimension(value.dimensions, index, 1) })}
                    disabled={isDisabled || index === value.dimensions.length - 1}
                    aria-label={`Move ${dimension.name || `area ${index + 1}`} down`}
                    title="Move down"
                  >
                    <Icon name="arrowDown" />
                  </button>
                  <button
                    type="button"
                    className="criteria-remove"
                    onClick={() => removeDimension(index)}
                    disabled={isDisabled || value.dimensions.length === 1}
                    aria-label={`Remove ${dimension.name || `area ${index + 1}`}`}
                    title="Remove this area"
                  >
                    <Icon name="close" />
                  </button>
                </div>
              </div>
              <label className="criteria-guidance">
                <span>What to look for (one point per line)</span>
                <textarea
                  rows={3}
                  value={dimension.guidance}
                  onChange={(event) => updateDimension(index, { guidance: event.target.value })}
                  disabled={isDisabled}
                  maxLength={1500}
                />
              </label>
            </li>
          ))}
        </ol>

        <div className="criteria-framework-footer">
          <button
            type="button"
            className="criteria-add"
            onClick={() => onChange({ ...value, dimensions: [...value.dimensions, createDimension()] })}
            disabled={isDisabled || value.dimensions.length >= MAX_DIMENSIONS}
          >
            + Add area
          </button>
          <span
            className={`criteria-total ${totalSummary.isValid ? 'is-valid' : 'is-invalid'}`}
            role="status"
          >
            <Icon name={totalSummary.isValid ? 'checkCircle' : 'alertTriangle'} /> {totalSummary.text}
          </span>
        </div>
      </section>
      )}

      {activeSection === 'flags' && (
      <section
        role="tabpanel"
        id="criteria-panel-flags"
        aria-labelledby="criteria-flags-heading"
      >
        <h3 id="criteria-flags-heading">Red flags</h3>
        <p className="criteria-hint">
          A red flag tags an applicant for a closer look. Turn on the ones you want applied to this
          job (location and desired pay also need a value). Each one can also lower the Match score: drag its slider
          from None up to Dealbreaker. Every penalty starts at None.
          It applies to applicants scored from now on; use Re-score to update the others.
        </p>

        <ul className="criteria-flags">
          {FLAG_ROWS.map((row) => {
            const flag = value.redFlags[row.key];
            const inputId = `criteria-flag-${row.key}`;
            return (
              <li key={row.key} className="criteria-flag">
                <label className="criteria-flag-toggle" htmlFor={inputId}>
                  <input
                    id={inputId}
                    type="checkbox"
                    checked={flag.enabled}
                    onChange={(event) => setFlagEnabled(row.key, event.target.checked)}
                    disabled={isDisabled}
                  />
                  <span className="criteria-flag-text">
                    <span className="criteria-flag-title">{row.title}</span>
                    <span className="criteria-flag-description">{row.description}</span>
                  </span>
                </label>

                {flag.enabled && (
                  <PenaltySlider
                    flagTitle={row.title}
                    penalty={flag.penalty}
                    onChange={(penalty) => setFlagPenalty(row.key, penalty)}
                    isDisabled={isDisabled}
                  />
                )}

                {(row.key === 'salaryLow' || row.key === 'salaryHigh') && flag.enabled && (
                  <label className="criteria-locale">
                    <span>
                      {row.key === 'salaryLow'
                        ? 'Flag when desired pay is below (per year)'
                        : 'Flag when desired pay is above (per year)'}
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      className="criteria-salary-input"
                      value={
                        value.redFlags[row.key].threshold === null
                          ? ''
                          : value.redFlags[row.key].threshold!.toLocaleString('en-US')
                      }
                      onChange={(event) => setSalaryThreshold(row.key as 'salaryLow' | 'salaryHigh', event.target.value)}
                      placeholder="For example: 100,000"
                      disabled={isDisabled}
                      maxLength={12}
                    />
                  </label>
                )}

                {row.key === 'location' && value.redFlags.location.enabled && (
                  <label className="criteria-locale">
                    <span>Applicants should be in</span>
                    <input
                      type="text"
                      value={value.redFlags.location.locale}
                      onChange={(event) => setLocale(event.target.value)}
                      placeholder="For example: Colorado, USA"
                      disabled={isDisabled}
                      maxLength={150}
                    />
                    <span className="criteria-hint">
                      Anyone Hiring Helper cannot place in this area is flagged. Use a city, region or
                      country. Set the penalty above to also lower their score.
                    </span>
                  </label>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      )}

      <p className="criteria-footnote">
        Safety instructions, scoring rules and the output format are managed for you, so they cannot
        be broken by an edit here.
      </p>
      </div>
      </div>
    </div>
  );
}
