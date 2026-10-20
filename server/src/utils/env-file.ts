/**
 * Pure helper for editing a dotenv-style file's text: replaces the given keys
 * in place (keeping comments, ordering and unrelated lines) and appends any key
 * that is missing.
 */

const SAFE_VALUE = /^[^\s"'#\\\r\n]*$/;

export function upsertEnvLines(existing: string, updates: Record<string, string>): string {
  for (const [key, value] of Object.entries(updates)) {
    if (/[\r\n]/.test(value)) {
      throw new Error(`Value for ${key} must be a single line`);
    }
  }

  const format = (key: string, value: string): string =>
    `${key}=${SAFE_VALUE.test(value) ? value : JSON.stringify(value)}`;

  const remaining = new Map(Object.entries(updates));
  const lines = existing === '' ? [] : existing.replace(/\n$/, '').split('\n');
  const rewritten = lines.map((line) => {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (match && remaining.has(match[1])) {
      const value = remaining.get(match[1]) as string;
      remaining.delete(match[1]);
      return format(match[1], value);
    }
    return line;
  });

  for (const [key, value] of remaining) rewritten.push(format(key, value));
  return rewritten.join('\n') + '\n';
}
