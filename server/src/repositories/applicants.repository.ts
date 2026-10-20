/**
 * Repository for managing applicant records in the database
 */

import { getDatabase } from '../db/database.js';
import type Database from 'better-sqlite3';

export interface Applicant {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  source?: string;
  phoneNumber?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  country?: string;
  linkedInUrl?: string;
  availableStartDate?: string;
  education?: string;
  createdAt: string;
  updatedAt: string;
}

interface ApplicantRow {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  source: string | null;
  phone_number: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  zipcode: string | null;
  country: string | null;
  linkedin_url: string | null;
  available_start_date: string | null;
  education: string | null;
  created_at: string;
  updated_at: string;
}

export class ApplicantsRepository {
  private get db(): Database.Database {
    return getDatabase();
  }

  /**
   * Convert database row to Applicant object
   */
  private rowToApplicant(row: ApplicantRow): Applicant {
    return {
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email,
      source: row.source || undefined,
      phoneNumber: row.phone_number || undefined,
      addressLine1: row.address_line1 || undefined,
      addressLine2: row.address_line2 || undefined,
      city: row.city || undefined,
      state: row.state || undefined,
      zipcode: row.zipcode || undefined,
      country: row.country || undefined,
      linkedInUrl: row.linkedin_url || undefined,
      availableStartDate: row.available_start_date || undefined,
      education: row.education || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Get applicant by ID
   */
  getById(id: number): Applicant | null {
    const row = this.db
      .prepare<[number], ApplicantRow>('SELECT * FROM applicants WHERE id = ?')
      .get(id);
    return row ? this.rowToApplicant(row) : null;
  }

  /**
   * Get applicant by email
   */
  getByEmail(email: string): Applicant | null {
    const row = this.db
      .prepare<[string], ApplicantRow>('SELECT * FROM applicants WHERE email = ?')
      .get(email);
    return row ? this.rowToApplicant(row) : null;
  }

  /**
   * Upsert (insert or update) an applicant
   */
  upsert(applicant: {
    id: number;
    firstName: string;
    lastName: string;
    email: string;
    source?: string;
    phoneNumber?: string;
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    state?: string;
    zipcode?: string;
    country?: string;
    linkedInUrl?: string;
    availableStartDate?: string;
    education?: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO applicants (
          id, first_name, last_name, email, source, phone_number,
          address_line1, address_line2, city, state, zipcode, country,
          linkedin_url, available_start_date, education, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          first_name = excluded.first_name,
          last_name = excluded.last_name,
          email = excluded.email,
          source = excluded.source,
          phone_number = excluded.phone_number,
          address_line1 = excluded.address_line1,
          address_line2 = excluded.address_line2,
          city = excluded.city,
          state = excluded.state,
          zipcode = excluded.zipcode,
          country = excluded.country,
          linkedin_url = excluded.linkedin_url,
          available_start_date = excluded.available_start_date,
          education = excluded.education,
          updated_at = datetime('now')`
      )
      .run(
        applicant.id,
        applicant.firstName,
        applicant.lastName,
        applicant.email,
        applicant.source || null,
        applicant.phoneNumber || null,
        applicant.addressLine1 || null,
        applicant.addressLine2 || null,
        applicant.city || null,
        applicant.state || null,
        applicant.zipcode || null,
        applicant.country || null,
        applicant.linkedInUrl || null,
        applicant.availableStartDate || null,
        applicant.education || null
      );
  }

  /**
   * Delete applicant by ID
   */
  delete(id: number): void {
    this.db.prepare('DELETE FROM applicants WHERE id = ?').run(id);
  }
}

