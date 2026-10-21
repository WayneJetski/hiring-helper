/**
 * Links built from text that someone else wrote (an applicant's LinkedIn field, a
 * posting address) must never become `javascript:` or `data:` links: clicking one
 * would run the attacker's script inside this app's own page, which can call the
 * app's API with the person's authority. Only plain web addresses are linked.
 */

/** The address as a normalized http(s) URL, or null when it is not one. */
export function toSafeWebUrl(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  if (trimmed === '') return null;

  // Applicants often type "linkedin.com/in/name" without a scheme.
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed.replace(/^\/+/, '')}`;

  try {
    const url = new URL(candidate);
    const isWebAddress = url.protocol === 'https:' || url.protocol === 'http:';
    const hasHost = url.hostname !== '';
    const hasEmbeddedLogin = url.username !== '' || url.password !== '';
    return isWebAddress && hasHost && !hasEmbeddedLogin ? url.toString() : null;
  } catch {
    return null;
  }
}
