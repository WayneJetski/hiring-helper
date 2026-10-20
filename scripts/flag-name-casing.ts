/**
 * Reconcile the `name` flag from the RAW applicant name only.
 *
 * The name flag reflects how the candidate typed their own name in the separate
 * BambooHR Name field (first/last) — NOT how the name appears inside the résumé.
 * A name PART of length >= 2 that is entirely upper- or entirely lower-case
 * ("JOHN smith", "jane DOE", "mary jane") is improper casing; single-character
 * parts (e.g. an abbreviated "A"/"O") are ignored.
 *
 * This is a fix pass: it ADDS the `name` flag to candidates whose raw name is
 * badly cased and CLEARS it from candidates whose raw name is correctly cased.
 * Flag only — it does NOT change match scores, and other flags are preserved.
 * Local; no BambooHR writes.
 *
 * Usage:
 *   npx tsx scripts/flag-name-casing.ts            # all active candidates
 *   npx tsx scripts/flag-name-casing.ts 45         # one job
 */

import { config as loadEnv } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { initializeDatabase, getDatabase, closeDatabase } from '../server/src/db/database.js';
import { ApplicationFlagsRepository } from '../server/src/repositories/application-flags.repository.js';
import type { ApplicationFlag } from '../server/src/types/flags.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, '../.env') });

/** A multi-character name part that is entirely one case is improperly cased. */
function partBadlyCased(part: string): boolean {
  return part.length >= 2 && (part === part.toUpperCase() || part === part.toLowerCase());
}

/** True if any part of the raw first/last name is improperly cased. */
export function nameBadlyCased(firstName: string, lastName: string): boolean {
  const parts = `${firstName ?? ''} ${lastName ?? ''}`.split(/\s+/).filter(Boolean);
  return parts.some(partBadlyCased);
}

interface Row {
  id: number;
  first_name: string;
  last_name: string;
}

async function main(): Promise<void> {
  const jobArg = process.argv[2];
  const jobId = jobArg !== undefined ? Number(jobArg) : undefined;
  if (jobId !== undefined && Number.isNaN(jobId)) {
    throw new Error(`jobId must be numeric; got "${jobArg}"`);
  }

  await initializeDatabase();
  const db = getDatabase();
  const flagsRepo = new ApplicationFlagsRepository();

  const where = jobId !== undefined ? 'a.job_id = ? AND a.active = 1' : 'a.active = 1';
  const rows = db
    .prepare<number[], Row>(
      `SELECT a.id AS id, ap.first_name, ap.last_name
       FROM applications a INNER JOIN applicants ap ON a.applicant_id = ap.id
       WHERE ${where}`
    )
    .all(...(jobId !== undefined ? [jobId] : []));

  let added = 0;
  let cleared = 0;
  for (const row of rows) {
    const bad = nameBadlyCased(row.first_name, row.last_name);
    const flags = new Set<ApplicationFlag>(flagsRepo.getFlags(row.id));
    const has = flags.has('name');
    if (bad && !has) {
      flags.add('name');
      flagsRepo.setFlags(row.id, [...flags]);
      added += 1;
    } else if (!bad && has) {
      flags.delete('name');
      flagsRepo.setFlags(row.id, [...flags]);
      cleared += 1;
    }
  }

  console.log(
    `Reconciled name flag over ${rows.length} candidate(s) (${jobId !== undefined ? `job ${jobId}` : 'all active'}): ` +
      `+${added} added, -${cleared} cleared.`
  );
  closeDatabase();
}

main().catch((error) => {
  console.error('flag-name-casing failed:', error);
  process.exit(1);
});
