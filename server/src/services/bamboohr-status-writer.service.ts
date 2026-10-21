/**
 * BambooHR Status Writer
 *
 * The ONLY code in this app that writes to BambooHR, and it can do exactly one
 * thing: set an application's status. It sends the `status` field and nothing else.
 * BambooHR's status endpoint does not email or otherwise notify the candidate, and
 * no email/disposition/notification endpoint is called anywhere. Do not add one.
 *
 * Isolation from applicant-supplied content: this class is constructed only for the
 * REST push route (a person's click in the web app). The MCP server, which is what
 * Claude uses while it reads résumés, never imports it; an architecture test
 * (`bamboohr-write-isolation.test.ts`) fails if that changes. Its HTTP client also
 * refuses any request except a POST to an application's status path.
 */

import type { AxiosInstance } from 'axios';
import { BambooHRClientProvider, raiseBambooHRError } from './bamboohr-http.js';

/** What the push service needs from a writer (so tests can supply a fake). */
export interface ApplicationStatusWriter {
  updateApplicationStatus(applicationId: number, statusId: number): Promise<void>;
}

export class BambooHRStatusWriter implements ApplicationStatusWriter {
  private readonly clientProvider = new BambooHRClientProvider('status-write');

  private get client(): AxiosInstance {
    return this.clientProvider.client;
  }

  async updateApplicationStatus(applicationId: number, statusId: number): Promise<void> {
    if (!Number.isInteger(applicationId) || !Number.isInteger(statusId)) {
      throw new Error('Application and status ids must be whole numbers.');
    }
    try {
      await this.client.post(`/applicant_tracking/applications/${applicationId}/status`, {
        status: statusId,
      });
    } catch (error) {
      raiseBambooHRError(error, `Failed to update status for application ${applicationId}`);
    }
  }
}
