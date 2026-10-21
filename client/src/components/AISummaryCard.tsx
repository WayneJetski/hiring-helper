/**
 * AI Summary Card Component
 * Displays the AI-generated candidate assessment (read-only).
 * Assessments are produced by Claude through the MCP `save_evaluation` tool.
 */

import type { ApplicantSummary } from '../types/applicant.types';
import { Icon } from './icons/Icon';
import './AISummaryCard.css';

interface AISummaryCardProps {
  summary?: ApplicantSummary;
}

const getConfidenceColor = (confidence: number): string => {
  if (confidence >= 75) return 'high';
  if (confidence >= 60) return 'medium';
  return 'low';
};

const getConfidenceLabel = (confidence: number): string => {
  if (confidence >= 75) return 'Strong Match';
  if (confidence >= 60) return 'Good Match';
  return 'Possible Match';
};

const FLAG_LABELS: Record<string, string> = {
  name: 'name capitalization',
  location: 'location',
  studying: 'still studying',
  no_exp: 'no relevant experience',
  tenure: 'short tenures or gaps',
  'salary-low': 'low desired pay',
  'salary-high': 'high desired pay',
};

const PENALTY_LABELS = { bit: 'a bit', lot: 'a lot', dealbreaker: 'dealbreaker' } as const;

export function AISummaryCard({ summary }: AISummaryCardProps): JSX.Element {
  if (!summary) {
    return (
      <div className="ai-summary-card empty-state">
        <h3 className="summary-title" data-help="assessment">
          <Icon name="sparkles" size={20} />
          AI Assessment
        </h3>
        <p>This candidate has not been assessed yet.</p>
        <p className="hint">
          Use <strong>Score applicant</strong> at the top of this page to assess this candidate. To
          score everyone who has no score yet, use <strong>Score new applicants</strong> on the Job
          Applicants page.
        </p>
      </div>
    );
  }

  return (
    <div className="ai-summary-card">
      <div className="summary-header" data-help="assessment">
        <h3 className="summary-title">
          <Icon name="sparkles" size={20} />
          AI Assessment
        </h3>
        <div className={`confidence-badge ${getConfidenceColor(summary.confidence)}`}>
          {summary.confidence}% · {getConfidenceLabel(summary.confidence)}
        </div>
      </div>

      {summary.scoreAdjustment && (
        <p className="summary-adjustment">
          Score lowered from {summary.scoreAdjustment.meritScore} to {summary.confidence} because of red-flag
          penalties:{' '}
          {summary.scoreAdjustment.penalties
            .map((penalty) => `${FLAG_LABELS[penalty.flag] ?? penalty.flag} (${PENALTY_LABELS[penalty.penalty]})`)
            .join(', ')}
          .
        </p>
      )}

      <div className="summary-brief">
        <h4>Quick Summary</h4>
        <p>{summary.brief}</p>
      </div>

      <div className="summary-full">
        <h4>Detailed Assessment</h4>
        <p>{summary.full}</p>
      </div>

      {summary.areaScores && summary.areaScores.length > 0 && (
        <div className="summary-areas">
          <h4>Score Breakdown</h4>
          <ul className="area-score-list">
            {summary.areaScores.map((area) => (
              <li key={area.name} className="area-score">
                <span className="area-score-name">{area.name}</span>
                <span className="area-score-points">
                  {area.points} / {area.maxPoints}
                </span>
                <span className="area-score-bar" aria-hidden="true">
                  <span
                    className="area-score-fill"
                    style={{ width: `${Math.round((area.points / area.maxPoints) * 100)}%` }}
                  />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary.risks && (
        <div className="summary-risks">
          <h4 className="summary-heading">
            <Icon name="alertTriangle" />
            Potential Concerns
          </h4>
          <p>{summary.risks}</p>
        </div>
      )}

      {summary.suggestedScreeningQuestions && summary.suggestedScreeningQuestions.length > 0 && (
        <div className="summary-questions">
          <h4 className="summary-heading">
            <Icon name="clipboardList" />
            Suggested Screening Questions
          </h4>
          <ol className="questions-list">
            {summary.suggestedScreeningQuestions.map((question, index) => (
              <li key={index}>{question}</li>
            ))}
          </ol>
        </div>
      )}

      <div className="summary-footer">
        <span className="generated-time">
          Generated {new Date(summary.generatedAt).toLocaleString()}
        </span>
      </div>
    </div>
  );
}
