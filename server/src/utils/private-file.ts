/**
 * Writes a file only its owner can read (0600), even when the file already existed
 * with looser permissions. Used for `.env`, which holds the BambooHR API key.
 * (`writeFile`'s `mode` option applies only when the file is created, so an `.env`
 * copied from `.env.example` would otherwise stay world-readable. Windows ignores
 * the mode bits.)
 */

import { chmodSync, promises as fs, writeFileSync } from 'node:fs';

export async function writePrivateFile(filePath: string, content: string): Promise<void> {
  await fs.writeFile(filePath, content, { encoding: 'utf-8', mode: 0o600 });
  await fs.chmod(filePath, 0o600);
}

/** Same as writePrivateFile, for start-up code that cannot await. */
export function writePrivateFileSync(filePath: string, content: string): void {
  writeFileSync(filePath, content, { encoding: 'utf-8', mode: 0o600 });
  chmodSync(filePath, 0o600);
}
