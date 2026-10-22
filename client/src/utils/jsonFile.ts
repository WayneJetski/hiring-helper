/**
 * Saving and reading a JSON file in the browser (used by the export and import buttons).
 */

/** Offer `data` to the person as a downloaded .json file. */
export function saveJsonFile(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Read a chosen file as JSON, or throw an error with a message fit to show the person. */
export async function readJsonFile(file: File): Promise<unknown> {
  const text = await file.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON. Choose a file exported from Hiring Helper.');
  }
}

/** For example hiring-helper-export-2026-10-22.json */
export function exportFilename(now: Date = new Date()): string {
  return `hiring-helper-export-${now.toISOString().slice(0, 10)}.json`;
}
