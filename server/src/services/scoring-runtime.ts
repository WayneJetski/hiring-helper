/**
 * The one scoring service for this process, shared by the scoring routes and by
 * anything that must know whether a run is in progress (such as the updater).
 */

import { ScoringService } from './scoring.service.js';

export const scoringService = new ScoringService();
