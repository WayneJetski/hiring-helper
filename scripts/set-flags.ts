/**
 * Add an application flag to one or more applications (local only).
 * Preserves any existing flags. Usage:
 *   npx tsx scripts/set-flags.ts <flag> <applicationId...>
 *   e.g. npx tsx scripts/set-flags.ts studying 101 102 103
 */

import { config as loadEnv } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { initializeDatabase, closeDatabase } from '../server/src/db/database.js';
import { ApplicationFlagsRepository } from '../server/src/repositories/application-flags.repository.js';
import { isApplicationFlag } from '../server/src/types/flags.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, '../.env') });

async function main(): Promise<void> {
  const flag = process.argv[2];
  const ids = process.argv.slice(3).map(Number).filter((n) => !Number.isNaN(n));
  if (!flag || !isApplicationFlag(flag)) {
    throw new Error(`First arg must be a valid flag (location|name|studying|no_exp|tenure); got "${flag}"`);
  }
  if (ids.length === 0) {
    throw new Error('Provide at least one application id');
  }

  await initializeDatabase();
  const repo = new ApplicationFlagsRepository();
  for (const id of ids) {
    const current = repo.getFlags(id);
    if (!current.includes(flag)) {
      repo.setFlags(id, [...current, flag]);
      console.log(`  +${flag} -> application ${id} (now: ${[...current, flag].join(', ')})`);
    } else {
      console.log(`  =${flag} already on application ${id}`);
    }
  }
  console.log(`Done. Added '${flag}' to ${ids.length} application(s).`);
  closeDatabase();
}

main().catch((error) => {
  console.error('set-flags failed:', error);
  process.exit(1);
});
