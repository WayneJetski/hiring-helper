/**
 * Backfill Resume and Cover Letter File IDs Script
 * Updates existing applications with resume and cover letter file IDs by fetching individual application details from BambooHR
 * 
 * Run: npx tsx scripts/backfill-resume-file-ids.ts
 */

import { initializeDatabase, closeDatabase } from '../server/src/db/database.js';
import { BambooHRService } from '../server/src/services/bamboohr.service.js';
import { ApplicationsRepository } from '../server/src/repositories/applications.repository.js';

async function backfillResumeFileIds(): Promise<void> {
  console.log('🔄 Starting resume and cover letter file ID backfill...\n');

  try {
    // Initialize database and services
    await initializeDatabase();
    const bambooHRService = new BambooHRService();
    const applicationsRepo = new ApplicationsRepository();

    // Get all applications
    const allApplications = applicationsRepo.getAll();
    console.log(`📊 Found ${allApplications.length} total applications\n`);

    // Filter applications that don't have a resume file ID or cover letter file ID
    const applicationsToUpdate = allApplications.filter(app => !app.resumeFileId || !app.coverLetterFileId);
    console.log(`📝 ${applicationsToUpdate.length} applications missing resume or cover letter file IDs\n`);

    if (applicationsToUpdate.length === 0) {
      console.log('✅ All applications already have resume and cover letter file IDs!');
      return;
    }

    let resumeUpdated = 0;
    let coverLetterUpdated = 0;
    let skipped = 0;
    let failed = 0;

    console.log('Starting backfill...\n');

    for (let i = 0; i < applicationsToUpdate.length; i++) {
      const application = applicationsToUpdate[i];
      const progress = `[${i + 1}/${applicationsToUpdate.length}]`;

      try {
        console.log(`${progress} Fetching details for application ${application.id}...`);
        
        // Fetch full application details from BambooHR
        const fullApplication = await bambooHRService.getApplication(application.id);

        const hasResumeUpdate = fullApplication.resumeFileId && !application.resumeFileId;
        const hasCoverLetterUpdate = fullApplication.coverLetterFileId && !application.coverLetterFileId;

        if (hasResumeUpdate || hasCoverLetterUpdate) {
          // Update the application with the file IDs
          applicationsRepo.upsert({
            id: application.id,
            appliedDate: application.appliedDate,
            statusId: application.statusId,
            rating: application.rating,
            applicantId: application.applicantId,
            jobId: application.jobId,
            resumeFileId: fullApplication.resumeFileId || application.resumeFileId,
            coverLetterFileId: fullApplication.coverLetterFileId || application.coverLetterFileId,
            referredBy: application.referredBy,
          });

          const updates: string[] = [];
          if (hasResumeUpdate) {
            updates.push(`resume file ID ${fullApplication.resumeFileId}`);
            resumeUpdated++;
          }
          if (hasCoverLetterUpdate) {
            updates.push(`cover letter file ID ${fullApplication.coverLetterFileId}`);
            coverLetterUpdated++;
          }
          console.log(`  ✅ Updated application ${application.id} with ${updates.join(' and ')}`);
        } else {
          console.log(`  ⚠️  Application ${application.id} has no new file IDs to update`);
          skipped++;
        }

        // Add a small delay to avoid rate limiting (100ms between requests)
        if (i < applicationsToUpdate.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (error) {
        console.error(`  ❌ Failed to update application ${application.id}:`, error instanceof Error ? error.message : error);
        failed++;
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('Backfill Complete!');
    console.log('='.repeat(60));
    console.log(`✅ Resumes updated: ${resumeUpdated}`);
    console.log(`✅ Cover letters updated: ${coverLetterUpdated}`);
    console.log(`⚠️  Skipped (no updates): ${skipped}`);
    console.log(`❌ Failed: ${failed}`);
    console.log('='.repeat(60));
  } catch (error) {
    console.error('\n❌ Backfill failed:', error);
    process.exit(1);
  } finally {
    closeDatabase();
  }
}

// Run the backfill
backfillResumeFileIds();

