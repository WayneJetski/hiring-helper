/**
 * Which applications an MCP session may read or write.
 *
 * An unattended scoring run is started for a fixed batch of applications. While it
 * reads a résumé, hostile text in that résumé could try to make the AI read or
 * re-score someone else, so the app passes the batch to the MCP server it launches
 * and the server refuses every other application. A session started by a person
 * from Claude Code (no variable set) is not limited.
 */

export const SCORING_SCOPE_VARIABLE = 'HIRING_HELPER_SCORING_SCOPE';

export interface ApplicationScope {
  allows(applicationId: number): boolean;
}

export const UNRESTRICTED_SCOPE: ApplicationScope = { allows: () => true };

/**
 * Reads a comma-separated list of application ids. A variable that is set but empty
 * or malformed allows nothing: a broken scope must not fall back to everything.
 */
export function scopeFromEnvironment(environment: NodeJS.ProcessEnv = process.env): ApplicationScope {
  const raw = environment[SCORING_SCOPE_VARIABLE];
  if (raw === undefined) return UNRESTRICTED_SCOPE;

  const parts = raw.split(',').map((part) => part.trim());
  const allowedIds = new Set<number>();
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return { allows: () => false };
    allowedIds.add(Number(part));
  }
  return { allows: (applicationId) => allowedIds.has(applicationId) };
}

/** The message a tool returns for an application outside its scope. */
export function outOfScopeMessage(applicationId: number): string {
  return `Application ${applicationId} is not part of this scoring run. Only the applications you were asked to score can be read or saved.`;
}
