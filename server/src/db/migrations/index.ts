/**
 * Every database migration, in order. Append new ones at the end with the next
 * version number; never edit or reorder one that has shipped.
 */

import type { Migration } from '../migrator.js';
import { baselineMigration } from './001-baseline.js';

export const MIGRATIONS: Migration[] = [baselineMigration];
