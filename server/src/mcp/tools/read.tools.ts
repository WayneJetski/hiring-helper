/**
 * MCP read tools: everything Claude needs to inspect candidates before scoring.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpDeps } from '../deps.js';
import { outOfScopeMessage } from '../application-scope.js';
import { registerTool } from '../register.js';
import { jsonResult, textResult, errorResult } from '../result.js';

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function registerReadTools(server: McpServer, deps: McpDeps): void {
  registerTool<{
    statusIds?: number[];
    jobId?: number;
    search?: string;
    activeOnly?: boolean;
    sortBy?: 'applied_date' | 'stage' | 'rating' | 'name' | 'email' | 'confidence';
    sortDirection?: 'asc' | 'desc';
    page?: number;
    limit?: number;
  }>(
    server,
    'list_applicants',
    {
      title: 'List applicants',
      description:
        'List candidates from the local database with optional filtering, sorting, and pagination. ' +
        'Returns list items including any existing AI confidence score. Defaults to active applications only. ' +
        'When jobId is omitted, results are scoped to the current job (most recent activity); the resolved jobId is returned.',
      inputSchema: {
        statusIds: z.array(z.number().int()).optional().describe('Filter by application status IDs'),
        jobId: z
          .number()
          .int()
          .optional()
          .describe('Filter by job posting ID (defaults to the current job when omitted)'),
        search: z.string().optional().describe('Search by candidate name or email'),
        activeOnly: z
          .boolean()
          .optional()
          .describe('Only active applications (default true). Pass false to include inactive.'),
        sortBy: z
          .enum(['applied_date', 'stage', 'rating', 'name', 'email', 'confidence'])
          .optional(),
        sortDirection: z.enum(['asc', 'desc']).optional(),
        page: z.number().int().positive().optional(),
        limit: z.number().int().positive().max(50).optional().describe('Page size (max 50)'),
      },
    },
    async (args) => {
      try {
        const jobId = args.jobId ?? deps.applicantQuery.resolveCurrentJobId() ?? undefined;
        const result = await deps.applicantQuery.listApplicants({
          statusIds: args.statusIds,
          jobId,
          search: args.search,
          activeOnly: args.activeOnly ?? true,
          sortBy: args.sortBy,
          sortDirection: args.sortDirection,
          page: args.page,
          limit: args.limit,
        });
        return jsonResult({ jobId: jobId ?? null, ...result });
      } catch (error) {
        return errorResult(toMessage(error));
      }
    }
  );

  registerTool<{ applicationId: number }>(
    server,
    'get_applicant',
    {
      title: 'Get applicant detail',
      description:
        'Get full detail for one application, including any cached AI summary and score.',
      inputSchema: {
        applicationId: z.number().int().describe('The application ID'),
      },
    },
    async ({ applicationId }) => {
      if (!deps.scope.allows(applicationId)) return errorResult(outOfScopeMessage(applicationId));
      try {
        const detail = await deps.applicantQuery.getApplicantDetail(applicationId);
        if (!detail) {
          return errorResult(`No application found with ID ${applicationId}`);
        }
        return jsonResult(detail);
      } catch (error) {
        return errorResult(toMessage(error));
      }
    }
  );

  registerTool<{ applicationId: number }>(
    server,
    'get_resume_text',
    {
      title: 'Get resume text',
      description:
        'Fetch and parse the resume for an application into plain text. This is the primary input for scoring. ' +
        'Returns a message if no resume file is on record.',
      inputSchema: {
        applicationId: z.number().int().describe('The application ID'),
      },
    },
    async ({ applicationId }) => {
      if (!deps.scope.allows(applicationId)) return errorResult(outOfScopeMessage(applicationId));
      try {
        const text = await deps.applicantQuery.getResumeText(applicationId);
        if (text === null) {
          return textResult(`No resume file is available for application ${applicationId}.`);
        }
        return textResult(text);
      } catch (error) {
        return errorResult(toMessage(error));
      }
    }
  );

  registerTool<{ jobId: number }>(
    server,
    'get_job_description',
    {
      title: 'Get job description',
      description:
        'Get the job description text for a job posting (from server/data/job-descriptions), if one exists.',
      inputSchema: {
        jobId: z.number().int().describe('The job posting ID'),
      },
    },
    async ({ jobId }) => {
      try {
        const description = await deps.jobDescriptions.getJobDescription(jobId);
        if (!description) {
          return textResult(`No job description on file for job ${jobId}.`);
        }
        return textResult(description);
      } catch (error) {
        return errorResult(toMessage(error));
      }
    }
  );

  registerTool<{ jobId: number }>(
    server,
    'get_system_prompt',
    {
      title: 'Get scoring system prompt',
      description:
        'Get the authoritative scoring rubric (system prompt) for a job: the per-job override if one ' +
        'is set, otherwise the global default. Use this as the rubric when scoring — it may be tailored ' +
        'per job. Contains {{JOB_TITLE}}/{{JOB_DESCRIPTION}} placeholders; substitute the job title and ' +
        'the get_job_description output.',
      inputSchema: {
        jobId: z.number().int().describe('The job posting ID'),
      },
    },
    async ({ jobId }) => {
      try {
        return textResult(await deps.jobDescriptions.getSystemPrompt(jobId));
      } catch (error) {
        return errorResult(toMessage(error));
      }
    }
  );

  registerTool<{ activeOnly?: boolean }>(
    server,
    'list_statuses',
    {
      title: 'List application statuses',
      description: 'List the hiring pipeline statuses (id + label) synced from BambooHR.',
      inputSchema: {
        activeOnly: z.boolean().optional().describe('Only active statuses'),
      },
    },
    async ({ activeOnly }) => {
      try {
        return jsonResult(deps.states.getAll(activeOnly));
      } catch (error) {
        return errorResult(toMessage(error));
      }
    }
  );

  registerTool(
    server,
    'list_jobs',
    {
      title: 'List jobs',
      description:
        'List job postings with application counts, latest activity, and whether a posting is stored. ' +
        'Ordered most-recent first, so the first entry is the current job. Use this to discover job IDs.',
      inputSchema: {},
    },
    async () => {
      try {
        const jobs = deps.applicantQuery.listJobs();
        return jsonResult({ currentJobId: deps.applicantQuery.resolveCurrentJobId(), jobs });
      } catch (error) {
        return errorResult(toMessage(error));
      }
    }
  );

  registerTool<{ jobId?: number }>(
    server,
    'list_unscored_applicants',
    {
      title: 'List unscored applicants',
      description:
        'List active applications that do not yet have an AI score. This is the work queue for scoring. ' +
        'When jobId is omitted, scoped to the current job (most recent activity); the resolved jobId is returned.',
      inputSchema: {
        jobId: z
          .number()
          .int()
          .optional()
          .describe('Restrict to a job posting (defaults to the current job when omitted)'),
      },
    },
    async ({ jobId: requestedJobId }) => {
      try {
        const jobId = requestedJobId ?? deps.applicantQuery.resolveCurrentJobId() ?? undefined;
        const unscored = deps.applicantQuery.findUnscoredApplicants(jobId);
        return jsonResult({ jobId: jobId ?? null, count: unscored.length, applicants: unscored });
      } catch (error) {
        return errorResult(toMessage(error));
      }
    }
  );

  registerTool(
    server,
    'get_sync_status',
    {
      title: 'Get sync status',
      description: 'Report the most recent BambooHR sync (timestamp, type, count).',
      inputSchema: {},
    },
    async () => {
      try {
        const lastSync = deps.sync.getLastSync();
        return jsonResult(lastSync ?? { message: 'No sync has been performed yet.' });
      } catch (error) {
        return errorResult(toMessage(error));
      }
    }
  );
}
