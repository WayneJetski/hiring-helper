/** Shapes of the export/import preview returned by /api/transfer/import/preview. */

export type SettingAction = 'none' | 'fill' | 'same' | 'conflict';

export interface ScoreConflict {
  applicationId: number;
  name: string;
  currentScore: number;
  importedScore: number;
}

export interface JobImportPlan {
  jobId: number;
  title: string;
  isSynced: boolean;
  description: SettingAction;
  criteria: SettingAction;
  scores: {
    fill: number[];
    conflicts: ScoreConflict[];
    same: number;
    notFound: number;
  };
}

export interface ImportPlan {
  jobs: JobImportPlan[];
}

export interface ImportDecisions {
  replaceSettingsJobIds: number[];
  replaceScoreApplicationIds: number[];
}

export interface ImportResult {
  jobsUpdated: number;
  scoresFilled: number;
  scoresReplaced: number;
  scoresFailed: number;
}
