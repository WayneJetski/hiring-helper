/**
 * Backfill desired_salary + commuting_answer on existing applications.
 *
 * These answers are captured going forward by the sync (processApplication), but
 * existing rows synced before the columns existed are empty. This fetches the
 * BambooHR application detail (sequential, 429-aware) for active applications in
 * a job and writes only those two columns — it does NOT touch status, active, or
 * flags, and never writes to BambooHR.
 *
 * Usage:
 *   npx tsx scripts/backfill-application-answers.ts --job <jobId>
 *   npx tsx scripts/backfill-application-answers.ts --job <jobId> --input answers.json
 */

import { config as loadEnv } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';
import { initializeDatabase, getDatabase, closeDatabase } from '../server/src/db/database.js';
import { BambooHRService } from '../server/src/services/bamboohr.service.js';
import { isBambooRateLimitError } from '../server/src/utils/rate-limit.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, '../.env') });

const COMMUTE_Q = 'commuting distance';
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Answer {
  id: number;
  desiredSalary: string | null;
  commuting: string | null;
}

function parseArgs(): { jobId: number; input?: string } {
  const args = process.argv.slice(2);
  const jobFlag = args.indexOf('--job');
  const jobId = jobFlag !== -1 ? Number(args[jobFlag + 1]) : Number.NaN;
  const inputFlag = args.indexOf('--input');
  const input = inputFlag !== -1 ? args[inputFlag + 1] : undefined;
  if (Number.isNaN(jobId)) throw new Error('--job <jobId> is required and must be numeric');
  return { jobId, input };
}

async function fetchAnswers(jobId: number): Promise<Answer[]> {
  const db = getDatabase();
  const ids = db
    .prepare<[number], { id: number }>(
      'SELECT id FROM applications WHERE job_id = ? AND active = 1 ORDER BY id'
    )
    .all(jobId)
    .map((r) => r.id);
  const svc = new BambooHRService();
  const out: Answer[] = [];
  for (const id of ids) {
    let attempt = 0;
    for (;;) {
      try {
        const app = (await svc.getApplication(id)) as unknown as {
          desiredSalary?: string;
          questionsAndAnswers?: Array<{ question?: { label?: string }; answer?: { label?: string } }>;
        };
        const qa = (app.questionsAndAnswers || []).find((q) =>
          (q.question?.label || '').toLowerCase().includes(COMMUTE_Q)
        );
        out.push({ id, desiredSalary: app.desiredSalary ?? null, commuting: qa?.answer?.label ?? null });
        break;
      } catch (error) {
        if (isBambooRateLimitError(error) && attempt < 5) {
          attempt++;
          await sleep(3000 * attempt);
          continue;
        }
        console.log(`  fetch error on ${id}: ${error instanceof Error ? error.message.slice(0, 80) : error}`);
        break;
      }
    }
    if (out.length % 25 === 0) console.log(`  ...fetched ${out.length}/${ids.length}`);
    await sleep(180);
  }
  return out;
}

async function main(): Promise<void> {
  const { jobId, input } = parseArgs();
  await initializeDatabase();
  const db = getDatabase();

  const answers: Answer[] = input
    ? JSON.parse(readFileSync(existsSync(input) ? input : resolve(__dirname, '..', input), 'utf-8'))
    : await fetchAnswers(jobId);

  const update = db.prepare(
    'UPDATE applications SET desired_salary = ?, commuting_answer = ? WHERE id = ?'
  );
  let updated = 0;
  const tx = db.transaction((rows: Answer[]): void => {
    for (const a of rows) {
      if (a.desiredSalary === null && a.commuting === null) continue;
      update.run(a.desiredSalary, a.commuting, a.id);
      updated++;
    }
  });
  tx(answers);

  console.log(`Backfilled desired_salary / commuting_answer on ${updated} application(s).`);
  closeDatabase();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
