/**
 * BambooHR API Service
 * Handles all interactions with the BambooHR API
 */

import type { AxiosInstance } from 'axios';
import { BambooHRClientProvider, BambooHRNotConfiguredError, raiseBambooHRError } from './bamboohr-http.js';
import type {
  BambooHRApplication,
  BambooHRApplicationStatus,
  BambooHRApplicationsResponse,
  BambooHRJob,
} from '../types/bamboohr.types.js';

export { BambooHRNotConfiguredError };

/**
 * Read-only: its HTTP client refuses everything except GET (see bamboohr-http.ts).
 * Changing an application's status is a separate class, BambooHRStatusWriter, that
 * the MCP server never receives.
 */
export class BambooHRService {
  private readonly clientProvider = new BambooHRClientProvider('read-only');

  private get client(): AxiosInstance {
    return this.clientProvider.client;
  }

  /**
   * Get all job applications from BambooHR
   * @param page - Page number (1-indexed)
   * @param limit - Results per page (default 50, max 50)
   */
  async getApplications(
    page: number = 1,
    limit: number = 50,
    newSince?: string
  ): Promise<BambooHRApplication[]> {
    try {
      const params: Record<string, string | number> = {
        page,
        limit: Math.min(limit, 50), // BambooHR max is 50
      };

      // Add newSince parameter if provided (ISO datetime string)
      if (newSince) {
        params.newSince = newSince;
      }

      const response = await this.client.get<BambooHRApplicationsResponse>(
        '/applicant_tracking/applications',
        { params }
      );
      return response.data?.applications || [];
    } catch (error) {
      this.handleError(error, 'Failed to fetch applications');
    }
  }

  /**
   * Get a single application by ID
   */
  async getApplication(applicationId: number): Promise<BambooHRApplication> {
    try {
      const response = await this.client.get<BambooHRApplication>(
        `/applicant_tracking/applications/${applicationId}`
      );
      return response.data;
    } catch (error) {
      this.handleError(error, `Failed to fetch application ${applicationId}`);
    }
  }

  /**
   * Get job openings (metadata + posting URL; no posting body text).
   */
  async getJobs(): Promise<BambooHRJob[]> {
    try {
      const response = await this.client.get<BambooHRJob[]>('/applicant_tracking/jobs');
      return response.data || [];
    } catch (error) {
      this.handleError(error, 'Failed to fetch jobs');
    }
  }

  /**
   * Get application statuses (hiring pipeline stages)
   */
  async getApplicationStatuses(): Promise<BambooHRApplicationStatus[]> {
    try {
      const response = await this.client.get<BambooHRApplicationStatus[]>(
        '/applicant_tracking/statuses'
      );
      return response.data;
    } catch (error) {
      this.handleError(error, 'Failed to fetch application statuses');
    }
  }

  /**
   * Get resume file as buffer (no caching - cache happens after parsing)
   */
  async getResumeFile(applicationId: number, resumeFileId: number): Promise<Uint8Array> {
    try {
      // Always fetch the actual PDF from BambooHR
      // Caching of parsed text happens in the controller after parsing
      const response = await this.client.get<ArrayBuffer>(
        `/applicant_tracking/applications/${applicationId}/files/${resumeFileId}`,
        {
          responseType: 'arraybuffer',
        }
      );
      return Buffer.from(response.data);
    } catch (error) {
      this.handleError(error, `Failed to fetch resume file ${resumeFileId}`);
    }
  }

  private handleError(error: unknown, message: string): never {
    return raiseBambooHRError(error, message);
  }
}
