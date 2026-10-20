/**
 * MCP write tools: how Claude persists an evaluation back to the local store.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpDeps } from '../deps.js';
import { registerTool } from '../register.js';
import { jsonResult, errorResult } from '../result.js';

export function registerWriteTools(server: McpServer, deps: McpDeps): void {
  registerTool<{
    applicationId: number;
    confidence: number;
    brief: string;
    full: string;
    risks?: string;
    suggestedScreeningQuestions?: string[];
    flags?: ('studying' | 'no_exp' | 'name' | 'location' | 'tenure')[];
  }>(
    server,
    'save_evaluation',
    {
      title: 'Save candidate evaluation',
      description:
        'Persist an evaluation for an application: writes the 0-100 confidence score to the database and ' +
        'caches the written summary. Use after reading the resume and job description. Overwrites any existing evaluation. ' +
        'Set `flags` to the flags you observed (still give a real merit score; never adjust it for a flag, the app applies any configured flag penalty itself and returns the final score). ' +
        "Pass only flags your scoring instructions list under 'Flags to pass to save_evaluation': " +
        "'name' (improper name capitalization), 'location' (not confirmed to be in the role's area), " +
        "'studying' (still a student), 'no_exp' (no relevant experience), 'tenure' (a pattern of short tenures or unexplained gaps). " +
        'Pass every flag that applies, or [] for none. (Salary flags are managed separately and preserved.)',
      inputSchema: {
        applicationId: z.number().int().describe('The application ID being evaluated'),
        confidence: z.number().int().min(0).max(100).describe('Overall fit confidence, 0-100'),
        brief: z.string().describe('One or two sentence summary of the candidate'),
        full: z.string().describe('Detailed assessment of fit for the role'),
        risks: z.string().optional().describe('Potential concerns or gaps'),
        suggestedScreeningQuestions: z
          .array(z.string())
          .optional()
          .describe('Questions to ask in a screening call'),
        flags: z
          .array(z.enum(['studying', 'no_exp', 'name', 'location', 'tenure']))
          .optional()
          .describe(
            "Flags observed, only from the list in the scoring instructions: 'name', 'location', 'studying', 'no_exp', 'tenure'. Include all that apply."
          ),
      },
    },
    async (args) => {
      try {
        const summary = await deps.evaluation.saveEvaluation(args.applicationId, {
          confidence: args.confidence,
          brief: args.brief,
          full: args.full,
          risks: args.risks,
          suggestedScreeningQuestions: args.suggestedScreeningQuestions,
          flags: args.flags,
        });
        return jsonResult({ saved: true, applicationId: args.applicationId, summary });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    }
  );

  registerTool<{ jobId: number; description: string; postingUrl?: string }>(
    server,
    'save_job_posting',
    {
      title: 'Save job posting',
      description:
        'Store the job posting text (and optional URL) for a job. Scoring reads this posting via ' +
        'get_job_description and the evaluate_candidate prompt. Overwrites any existing posting; survives BambooHR syncs.',
      inputSchema: {
        jobId: z.number().int().describe('The job posting ID (see list_jobs)'),
        description: z.string().describe('Full job posting / description text'),
        postingUrl: z.string().optional().describe('Optional URL to the live posting'),
      },
    },
    async (args) => {
      try {
        const saved = deps.jobDescriptions.saveJobPosting(args.jobId, {
          description: args.description,
          postingUrl: args.postingUrl,
        });
        if (!saved) {
          return errorResult(`No job found with ID ${args.jobId}`);
        }
        return jsonResult({ saved: true, jobId: args.jobId });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    }
  );
}
