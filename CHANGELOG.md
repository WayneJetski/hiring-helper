# Changelog

All notable changes to the Hiring Helper project will be documented in this file.

## [2.0.0] - 2025-11-11

### 🎉 Major Changes - Database Architecture

#### Added
- **SQLite Database**: Local data persistence with 5 tables (jobs, applicants, applications, application_scores, content_updates)
- **Automatic Data Sync**: Server automatically syncs from BambooHR API on startup
- **Incremental Sync**: Uses `newSince` parameter to only fetch updated applications
- **Manual Sync API**: POST `/api/sync` endpoint to manually trigger data refresh
- **Sync Status API**: GET `/api/sync/status` to check last sync information
- **Sync History API**: GET `/api/sync/history` to view sync history
- **Database Repositories**: Clean data access layer for each table
  - `JobsRepository`
  - `ApplicantsRepository`
  - `ApplicationsRepository`
  - `ScoresRepository` (migrated from JSON file)
  - `ContentUpdatesRepository`

#### Changed
- **Scores Storage**: Migrated from `data/scores.json` to SQLite `application_scores` table
- **Data Flow**: Applicant list and detail views now read from local database instead of BambooHR API
- **Controller Logic**: Completely rewritten `ApplicantsController` to use repository pattern
- **Server Startup**: Added database initialization and initial sync routine

#### Performance Improvements
- **Faster Queries**: All listing and filtering now uses local database
- **Reduced API Calls**: Only sync new data, not every request
- **Offline Capability**: Can view synced data even when BambooHR API is unavailable

#### Documentation
- **DATABASE.md**: Comprehensive database architecture and schema documentation
- **CHANGELOG.md**: This file, tracking all notable changes

### 🎨 Feature Enhancements

#### Added
- **Suggested Screening Questions**: AI summaries now include 2-3 suggested screening questions
  - Questions are tailored to each candidate
  - Designed for HR to ask in phone screenings
  - Displayed in a dedicated section on the applicant detail page

#### Changed
- **AI Prompt Updates**: 
  - Increased token limits (Gemini: 5000 tokens, Anthropic: 10000 tokens)
  - Refined confidence scoring instructions
  - Added screening questions generation
  - Improved prompt clarity and brevity
- **Type Definitions**: Updated `ApplicantSummary` interface across client and server to include `suggestedScreeningQuestions?: string[]`

### 🐛 Bug Fixes
- Fixed SQL quote syntax in database test script

### 🔧 Technical Details

#### Dependencies Added
- `better-sqlite3@^11.x` - Fast, synchronous SQLite3 bindings
- `@types/better-sqlite3` - TypeScript definitions

#### Files Changed
- `server/src/index.ts` - Added database initialization and sync on startup
- `server/src/controllers/applicants.controller.ts` - Rewritten to use repositories
- `server/src/repositories/scores.repository.ts` - Migrated from file-based to database
- `server/src/services/bamboohr.service.ts` - Added `newSince` parameter support
- `server/src/services/ai-summary.service.ts` - Added screening questions to prompt and parsing
- `server/src/types/summary.types.ts` - Added `suggestedScreeningQuestions` field
- `client/src/types/applicant.types.ts` - Added `suggestedScreeningQuestions` field
- `client/src/components/AISummaryCard.tsx` - Added UI for screening questions
- `client/src/components/AISummaryCard.css` - Styled screening questions section
- `.gitignore` - Excluded `*.db` files from version control

#### Files Added
- `server/src/db/schema.sql` - Database schema definition
- `server/src/db/database.ts` - Database connection and initialization
- `server/src/repositories/jobs.repository.ts` - Jobs data access layer
- `server/src/repositories/applicants.repository.ts` - Applicants data access layer
- `server/src/repositories/applications.repository.ts` - Applications data access layer
- `server/src/repositories/content-updates.repository.ts` - Sync history data access layer
- `server/src/services/bamboohr-sync.service.ts` - Data synchronization service
- `server/src/routes/sync.routes.ts` - Sync API routes
- `server/src/controllers/sync.controller.ts` - Sync API controller
- `DATABASE.md` - Database documentation
- `CHANGELOG.md` - This changelog

---

## [1.0.0] - 2025-11-10

### Initial Release
- React + Vite frontend
- Node.js + Express + TypeScript backend
- BambooHR API integration
- Applicant listing with sorting, filtering, and pagination
- Applicant detail view
- AI-powered candidate assessment (OpenAI, Anthropic, Gemini, Ollama)
- File-based caching for AI summaries and parsed resumes
- PDF resume parsing
- Job description matching
- Confidence score tracking
- Branded color scheme

