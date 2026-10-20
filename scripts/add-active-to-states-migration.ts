/**
 * Migration Script: Add 'active' column to application_states table
 * 
 * Adds a boolean 'active' column (stored as INTEGER) to the application_states table.
 * Defaults to TRUE (1) and is NOT NULL.
 */

import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { initializeDatabase, getDatabase, closeDatabase } from '../server/src/db/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
config({ path: resolve(__dirname, '../.env') });

async function runMigration(): Promise<void> {
  console.log('\n🔄 Starting migration: Add active column to application_states table\n');

  try {
    // Initialize database
    console.log('📊 Initializing database...');
    await initializeDatabase();
    const db = getDatabase();

    // Check if column already exists
    console.log('🔍 Checking if active column already exists...');
    const tableInfo = db.prepare('PRAGMA table_info(application_states)').all() as Array<{
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }>;
    
    const activeColumnExists = tableInfo.some(col => col.name === 'active');
    
    if (activeColumnExists) {
      console.log('✅ Column "active" already exists. No migration needed.');
      return;
    }

    // Add the active column
    console.log('➕ Adding "active" column to application_states table...');
    db.prepare('ALTER TABLE application_states ADD COLUMN active INTEGER NOT NULL DEFAULT 1').run();
    
    console.log('✅ Column "active" added successfully');

    // Verify the column was added
    const updatedTableInfo = db.prepare('PRAGMA table_info(application_states)').all() as Array<{
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }>;
    
    const verifyColumn = updatedTableInfo.find(col => col.name === 'active');
    
    if (verifyColumn) {
      console.log('\n📋 Column details:');
      console.log(`   Name: ${verifyColumn.name}`);
      console.log(`   Type: ${verifyColumn.type}`);
      console.log(`   Not Null: ${verifyColumn.notnull === 1 ? 'Yes' : 'No'}`);
      console.log(`   Default: ${verifyColumn.dflt_value || '1'}`);
      
      // Count application states
      const count = db.prepare('SELECT COUNT(*) as count FROM application_states').get() as { count: number };
      console.log(`\n✅ All ${count.count} existing application state(s) now have active = TRUE (1)`);
    } else {
      throw new Error('Failed to verify column was added');
    }

    console.log('\n✅ Migration completed successfully!\n');

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    throw error;
  } finally {
    closeDatabase();
  }
}

// Run the migration
runMigration()
  .then(() => {
    console.log('✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });

