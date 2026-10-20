/**
 * Regenerate All Summaries Script
 * 
 * This script:
 * 1. Deletes all existing scores from the database
 * 2. Deletes all cached summaries
 * 3. Triggers background scoring to regenerate all summaries with the new prompt
 */

import { config } from 'dotenv';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readdir, unlink } from 'fs/promises';
import { initializeDatabase, getDatabase, closeDatabase } from '../server/src/db/database.js';
import { BackgroundScoringService } from '../server/src/services/background-scoring.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
config({ path: resolve(__dirname, '../.env') });

async function deleteAllScores(): Promise<number> {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM application_scores').run();
  return result.changes;
}

async function deleteAllCachedSummaries(): Promise<number> {
  const cacheDir = join(__dirname, '../server/data/cache/application/summary');
  let deletedCount = 0;

  try {
    const files = await readdir(cacheDir);
    for (const file of files) {
      if (file.endsWith('.json')) {
        await unlink(join(cacheDir, file));
        deletedCount++;
      }
    }
  } catch (error) {
    console.warn('⚠️  Cache directory may not exist or is empty:', (error as Error).message);
  }

  return deletedCount;
}

async function regenerateAll(): Promise<void> {
  console.log('\n🔄 Starting summary regeneration process...\n');

  try {
    // Initialize database
    console.log('📊 Initializing database...');
    await initializeDatabase();
    console.log('✅ Database initialized');

    // Step 1: Delete all existing scores
    console.log('\n🗑️  Deleting all existing scores from database...');
    const deletedScores = await deleteAllScores();
    console.log(`✅ Deleted ${deletedScores} score(s)`);

    // Step 2: Delete all cached summaries
    console.log('\n🗑️  Deleting all cached summaries...');
    const deletedSummaries = await deleteAllCachedSummaries();
    console.log(`✅ Deleted ${deletedSummaries} cached summary file(s)`);

    // Step 3: Find all applications that now need scoring
    console.log('\n🔍 Finding applications to score...');
    const scoringService = new BackgroundScoringService();
    const applicationsToScore = scoringService.findApplicationsWithoutScores();
    console.log(`📝 Found ${applicationsToScore.length} application(s) to score`);

    if (applicationsToScore.length === 0) {
      console.log('\n✅ No applications to score. Done!');
      return;
    }

    // Step 4: Score all applications with 2 second delay between each
    console.log('\n🤖 Starting AI scoring process...');
    console.log('⏱️  Using 1 second delay between requests to avoid rate limiting\n');

    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < applicationsToScore.length; i++) {
      const appId = applicationsToScore[i];
      console.log(`[${i + 1}/${applicationsToScore.length}] Processing application ${appId}...`);
      
      try {
        const success = await scoringService.scoreApplication(appId);
        if (success) {
          successCount++;
          console.log(`  ✅ Score generated successfully`);
        } else {
          failureCount++;
          console.log(`  ⚠️  Score generation failed (see warnings above)`);
        }
      } catch (error) {
        failureCount++;
        console.error(`  ❌ Error scoring application ${appId}:`, (error as Error).message);
      }

      // Wait 2 seconds before next request (except for last one)
      if (i < applicationsToScore.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total applications processed: ${applicationsToScore.length}`);
    console.log(`✅ Successful: ${successCount}`);
    console.log(`❌ Failed: ${failureCount}`);
    console.log('='.repeat(60) + '\n');

    if (successCount > 0) {
      console.log('🎉 Summary regeneration complete!');
      console.log('💡 Refresh your browser to see the updated scores and summaries.\n');
    }

  } catch (error) {
    console.error('\n❌ Error during regeneration:', error);
    throw error;
  } finally {
    closeDatabase();
  }
}

// Run the script
regenerateAll()
  .then(() => {
    console.log('✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });

