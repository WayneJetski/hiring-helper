/**
 * Keeps the API usable only by this computer's own browser and tools.
 *
 * The server listens on 127.0.0.1 and has no login, so two web tricks matter:
 *  - DNS rebinding: a hostile page points its own domain name at 127.0.0.1 and then
 *    reads the API as if it were same-site. Its requests still carry the hostile
 *    name in the Host header, so any Host that is not local is refused.
 *  - Cross-site requests: a page on another site can make the browser send a write
 *    (POST, PATCH, DELETE) here. Browsers label those with an Origin header, so a
 *    write whose Origin is not local is refused. Requests with no Origin (curl, the
 *    maintenance scripts) are not browser cross-site requests and are allowed.
 */

import type { NextFunction, Request, Response } from 'express';

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The host name in a Host header or an origin ("localhost:3000" -> "localhost"). */
export function hostnameOf(hostOrUrl: string): string {
  const withoutScheme = hostOrUrl.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const authority = withoutScheme.split('/')[0];
  // An IPv6 literal is bracketed: [::1]:3000
  if (authority.startsWith('[')) return authority.slice(0, authority.indexOf(']') + 1).toLowerCase();
  return authority.split(':')[0].toLowerCase();
}

export function isLocalHostHeader(hostHeader: string | undefined): boolean {
  return hostHeader !== undefined && LOCAL_HOSTNAMES.has(hostnameOf(hostHeader));
}

export function isLocalOrigin(origin: string): boolean {
  return LOCAL_HOSTNAMES.has(hostnameOf(origin));
}

export function localOnlyGuard(req: Request, res: Response, next: NextFunction): void {
  if (!isLocalHostHeader(req.headers.host)) {
    res.status(403).json({
      error: 'Forbidden',
      message: 'Hiring Helper only answers requests addressed to localhost.',
    });
    return;
  }

  const origin = req.headers.origin;
  if (!READ_ONLY_METHODS.has(req.method) && origin !== undefined && !isLocalOrigin(origin)) {
    res.status(403).json({
      error: 'Forbidden',
      message: 'Hiring Helper does not accept changes from other websites.',
    });
    return;
  }

  next();
}
