/**
 * Shared dependency bundle injected into the MCP tool/prompt registrars.
 * Keeping this separate avoids a circular import between server.ts and the
 * individual registration modules.
 */

import type { ApplicantQueryService } from '../services/applicant-query.service.js';
import type { EvaluationService } from '../services/evaluation.service.js';
import type { BambooHRSyncService } from '../services/bamboohr-sync.service.js';
import type { JobDescriptionService } from '../services/job-description.service.js';
import type { ApplicationStatesRepository } from '../repositories/application-states.repository.js';

export interface McpDeps {
  applicantQuery: ApplicantQueryService;
  evaluation: EvaluationService;
  sync: BambooHRSyncService;
  jobDescriptions: JobDescriptionService;
  states: ApplicationStatesRepository;
}
