/**
 * Access to browser storage that never throws: a missing, blocked or
 * non-browser (test) environment yields null so callers can fall back to
 * defaults.
 */

export function getLocalStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function getSessionStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}
