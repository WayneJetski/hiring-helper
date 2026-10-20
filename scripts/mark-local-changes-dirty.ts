/**
 * Manage which local status changes are pending a push to BambooHR.
 *
 * Background: the bamboo_status_id migration backfilled bamboo_status_id =
 * status_id, treating the existing local state as already reconciled with
 * BambooHR. But triage done BEFORE the push feature existed lives only locally
 * and was never pushed, so it should count as pending.
 *
 * Two modes (neither touches status_id, neither calls BambooHR — nothing is
 * pushed; this only populates or clears the pending queue for review):
 *
 *   default    Mark local changes dirty. Rule (per the user): a status of
 *              "New" is the BambooHR baseline (not a change); every other status
 *              is a local change. Sets bamboo_status_id to the "New" id for each
 *              active application whose working status is NOT "New", so they show
 *              as pending ("New -> <their status>"). Rows in New stay reconciled.
 *
 *   --reconcile  The inverse: clear pending in scope by setting
 *              bamboo_status_id = status_id, so those rows no longer show as
 *              pending (e.g. a finished job you do not want to push).
 *
 * Usage:
 *   npx tsx scripts/mark-local-changes-dirty.ts                  # mark all jobs
 *   npx tsx scripts/mark-local-changes-dirty.ts --job 45         # mark one job
 *   npx tsx scripts/mark-local-changes-dirty.ts --job 36 --reconcile  # clear one job
 *   npx tsx scripts/mark-local-changes-dirty.ts --dry-run        # report only
 */

import { config as loadEnv } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { initializeDatabase, getDatabase, closeDatabase } from '../server/src/db/database.js';
import { ApplicationStatesRepository } from '../server/src/repositories/application-states.repository.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, '../.env') });

function parseArgs(): { jobId?: number; dryRun: boolean; reconcile: boolean } {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const reconcile = args.includes('--reconcile');
  const jobFlag = args.indexOf('--job');
  const jobId = jobFlag !== -1 ? Number(args[jobFlag + 1]) : undefined;
  if (jobId !== undefined && Number.isNaN(jobId)) {
    throw new Error('--job must be followed by a numeric job id');
  }
  return { jobId, dryRun, reconcile };
}

async function main(): Promise<void> {
  const { jobId, dryRun, reconcile } = parseArgs();

  await initializeDatabase();
  const db = getDatabase();

  const newStatus = new ApplicationStatesRepository().getByStatus('New');
  if (!newStatus) {
    throw new Error('No "New" status found in application_states; cannot determine the baseline.');
  }
  const newId = newStatus.id;

  const jobClause = jobId !== undefined ? 'AND a.job_id = ?' : '';
  const jobParams = jobId !== undefined ? [jobId] : [];
  const scope = jobId !== undefined ? `job ${jobId}` : 'all jobs';

  if (reconcile) {
    // Inverse: report and clear currently-pending rows in scope.
    const breakdown = db
      .prepare<number[], { status: string; n: number }>(
        `SELECT COALESCE(st.status, '(none)') AS status, COUNT(*) AS n
         FROM applications a
         LEFT JOIN application_states st ON a.status_id = st.id
         WHERE a.active = 1 AND a.status_id IS NOT NULL AND a.status_id IS NOT a.bamboo_status_id ${jobClause}
         GROUP BY st.status ORDER BY n DESC`
      )
      .all(...jobParams);
    const total = breakdown.reduce((sum, row) => sum + row.n, 0);
    console.log(`Reconcile (clear pending) scope: ${scope}${dryRun ? ' (dry run)' : ''}`);
    console.log(`Pending changes to clear: ${total}`);
    for (const row of breakdown) console.log(`  ${row.n.toString().padStart(4)}  ${row.status}`);

    if (dryRun) {
      console.log('\nDry run: no changes written.');
      closeDatabase();
      return;
    }
    const result = db
      .prepare(
        `UPDATE applications AS a
         SET bamboo_status_id = status_id
         WHERE a.active = 1 AND a.status_id IS NOT NULL AND a.status_id IS NOT a.bamboo_status_id ${jobClause}`
      )
      .run(...jobParams);
    console.log(`\nCleared ${result.changes} pending change(s); they will no longer show as pending.`);
    closeDatabase();
    return;
  }

  // Default: mark non-New local changes as pending.
  const breakdown = db
    .prepare<number[], { status: string; n: number }>(
      `SELECT COALESCE(st.status, '(none)') AS status, COUNT(*) AS n
       FROM applications a
       LEFT JOIN application_states st ON a.status_id = st.id
       WHERE a.active = 1 AND a.status_id IS NOT NULL AND a.status_id <> ? ${jobClause}
       GROUP BY st.status ORDER BY n DESC`
    )
    .all(newId, ...jobParams);

  const total = breakdown.reduce((sum, row) => sum + row.n, 0);
  console.log(`Mark dirty scope: ${scope}${dryRun ? ' (dry run)' : ''}`);
  console.log(`Baseline status: "New" (id ${newId}) — treated as not-a-change.`);
  console.log(`Local changes to mark pending: ${total}`);
  for (const row of breakdown) console.log(`  ${row.n.toString().padStart(4)}  New -> ${row.status}`);

  if (dryRun) {
    console.log('\nDry run: no changes written.');
    closeDatabase();
    return;
  }

  const result = db
    .prepare(
      `UPDATE applications AS a
       SET bamboo_status_id = ?
       WHERE a.active = 1 AND a.status_id IS NOT NULL AND a.status_id <> ? ${jobClause}`
    )
    .run(newId, newId, ...jobParams);

  console.log(`\nMarked ${result.changes} application(s) as pending a push to BambooHR.`);
  console.log('Review them via the "Push to BambooHR" button (nothing has been pushed).');
  closeDatabase();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
