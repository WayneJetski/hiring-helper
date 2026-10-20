/**
 * Type definitions for BambooHR API responses
 */

import type { ApplicationFlag } from './flags.js';

export interface BambooHRStatusObject {
  id: number;
  label: string;
}

export interface BambooHRJobTitle {
  id: number | null;
  label: string;
}

export interface BambooHRAddress {
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  country?: string;
}

export interface BambooHRApplicantInfo {
  id: number;
  firstName: string;
  lastName: string;
  avatar?: string;
  email: string;
  source?: string;
  phoneNumber?: string;
  address?: BambooHRAddress; // object; only present on the detail endpoint
  linkedinUrl?: string;
  linkedInUrl?: string;
  websiteUrl?: string;
  availableStartDate?: string;
  education?: string;
}

export interface BambooHRJobInfo {
  id: number;
  title: BambooHRJobTitle;
}

export interface BambooHRApplication {
  id: number;
  appliedDate: string;
  status: BambooHRStatusObject;
  rating: number | null;
  applicant: BambooHRApplicantInfo;
  job: BambooHRJobInfo;
  coverLetter?: string;
  resumeFileId?: number;
  coverLetterFileId?: number;
  createdDate?: string;
  modifiedDate?: string;
  desiredSalary?: string; // free-text "Desired Pay" (detail endpoint only)
  questionsAndAnswers?: BambooHRQuestionAnswer[]; // application questions (detail endpoint only)
}

export interface BambooHRQuestionAnswer {
  question?: { id?: number; label?: string };
  answer?: { id?: number; label?: string };
}

export interface BambooHRApplicationStatus {
  id: number;
  name: string;
  enabled: boolean;
}

/**
 * A job opening from GET /applicant_tracking/jobs. BambooHR does not return the
 * posting body text here — only metadata and the public posting URL.
 */
export interface BambooHRJob {
  id: number;
  title: BambooHRJobTitle;
  postedDate?: string;
  status?: BambooHRStatusObject;
  postingUrl?: string;
}

export interface BambooHRApplicationsResponse {
  applications: BambooHRApplication[];
}

export interface ApplicantListItem {
  id: number;
  name: string;
  email: string;
  stage: string;
  appliedDate: string;
  rating?: number;
  confidence?: number; // AI-generated confidence score (0-100)
  summaryBrief?: string; // one-paragraph AI summary shown under the name in the list
  applicantId?: number; // BambooHR's id for the person (its "candidate"), used to link into BambooHR
  flags?: ApplicationFlag[]; // structured triage flags (location/name/studying/no_exp/tenure)
}

export interface ApplicantDetail extends ApplicantListItem {
  /** The job this application is for. */
  jobId: number;
  jobTitle: string;
  phoneNumber?: string;
  address?: {
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    state?: string;
    zipcode?: string;
    country?: string;
  };
  source?: string;
  linkedInUrl?: string;
  websiteUrl?: string;
  coverLetter?: string;
  resumeFileId?: number;
  aiSummary?: {
    confidence: number;
    brief: string;
    full: string;
    risks: string;
    suggestedScreeningQuestions?: string[];
    generatedAt: string;
    jobTitle?: string;
    jobId?: number;
  };
  createdDate: string;
  modifiedDate?: string;
  availableStartDate?: string;
  desiredSalary?: string;
  commutingAnswer?: string;
}

export interface ParsedResume {
  text: string;
  metadata?: {
    pages?: number;
    info?: Record<string, unknown>;
  };
}

export interface ApiErrorResponse {
  error: string;
  message: string;
  statusCode: number;
}

