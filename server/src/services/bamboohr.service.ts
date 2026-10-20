/**
 * BambooHR API Service
 * Handles all interactions with the BambooHR API
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { config, isBambooHRConfigured } from '../config/env.config.js';
import type {
  BambooHRApplication,
  BambooHRApplicationStatus,
  BambooHRApplicationsResponse,
  BambooHRJob,
} from '../types/bamboohr.types.js';

/** Raised when a BambooHR call is attempted before credentials are saved. */
export class BambooHRNotConfiguredError extends Error {
  constructor() {
    super('BambooHR is not connected yet. Open the app and complete the setup screen.');
  }
}

export class BambooHRService {
  private cachedClient: { signature: string; client: AxiosInstance } | null = null;

  /**
   * Axios client for the current credentials. Built on demand (and rebuilt when
   * the credentials change) so saving them from the setup screen takes effect
   * without restarting the server.
   */
  private get client(): AxiosInstance {
    if (!isBambooHRConfigured()) throw new BambooHRNotConfiguredError();

    const signature = `${config.bambooHR.subdomain}:${config.bambooHR.apiKey}`;
    if (this.cachedClient?.signature !== signature) {
      const authToken = Buffer.from(`${config.bambooHR.apiKey}:`).toString('base64');
      this.cachedClient = {
        signature,
        client: axios.create({
          baseURL: config.bambooHR.baseUrl,
          headers: {
            Authorization: `Basic ${authToken}`,
            Accept: 'application/json',
          },
          timeout: 30000,
        }),
      };
    }
    return this.cachedClient.client;
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
   * Change an application's status in BambooHR.
   *
   * This is the ONLY write this app makes to BambooHR. It sends the `status`
   * field and nothing else. BambooHR's status endpoint does not email or
   * otherwise notify the candidate, and this method deliberately calls no
   * email/disposition/notification endpoint. Do not add candidate-facing
   * notifications here.
   */
  async updateApplicationStatus(applicationId: number, statusId: number): Promise<void> {
    try {
      await this.client.post(`/applicant_tracking/applications/${applicationId}/status`, {
        status: statusId,
      });
    } catch (error) {
      this.handleError(error, `Failed to update status for application ${applicationId}`);
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

  /**
   * Handle API errors consistently
   */
  private handleError(error: unknown, message: string): never {
    if (error instanceof BambooHRNotConfiguredError) throw error;

    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      const status = axiosError.response?.status || 500;
      const details = axiosError.response?.data || axiosError.message;
      
      console.error(`BambooHR API Error: ${message}`, {
        status,
        details,
      });

      throw new Error(`${message}: ${JSON.stringify(details)}`);
    }

    console.error(`Unexpected error: ${message}`, error);
    throw new Error(message);
  }
}

