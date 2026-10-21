/**
 * Keeps the API usable only by this computer's own browser and tools.
 *
 * The server listens on 127.0.0.1 and has no login, so two web tricks matter:
 *  - DNS rebinding: a hostile page points its own domain name at 127.0.0.1 and then
 *    reads the API as if it were same-site. Its requests still carry the hostile
 *    name in the Host header, so any Host that is not local is refused.
 *  - Cross-site requests: a page on another site can make the browser send a write
 *    (POST, PATCH, DELETE) here. Browsers label those with an Origin header, so a
 *    write whose Origin is not this app's own page is refused. That includes a page
 *    served from some other localhost port (another dev server, a hostile page that
 *    got onto localhost), so only this server's port and the Vite dev server's port
 *    are accepted. Requests with no Origin (curl, the maintenance scripts) are not
 *    browser cross-site requests and are allowed here; the few routes that act on
 *    BambooHR, the credentials or the install also use `requireBrowserOrigin`.
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

/** The page origins allowed to make changes: this server's port, plus the dev client's port outside production. */
export function allowedOriginsFor(
  serverPort: number,
  clientUrl: string,
  isProduction = false
): Set<string> {
  const ports = new Set<string>([String(serverPort)]);
  try {
    // An installed copy serves its own page; only a development checkout has a separate
    // client port, and trusting it in production would trust whatever else listens there.
    if (isProduction) throw new Error('no dev client in production');
    const clientPort = new URL(clientUrl).port;
    if (clientPort !== '') ports.add(clientPort);
  } catch {
    // An unusable CLIENT_URL just leaves the server's own port allowed.
  }

  const origins = new Set<string>();
  for (const hostname of LOCAL_HOSTNAMES) {
    for (const port of ports) origins.add(`http://${hostname}:${port}`);
  }
  return origins;
}

export function createLocalOnlyGuard(allowedOrigins: ReadonlySet<string>) {
  return function localOnlyGuard(req: Request, res: Response, next: NextFunction): void {
    if (!isLocalHostHeader(req.headers.host)) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'Hiring Helper only answers requests addressed to localhost.',
      });
      return;
    }

    const origin = req.headers.origin;
    if (!READ_ONLY_METHODS.has(req.method) && origin !== undefined && !allowedOrigins.has(origin)) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'Hiring Helper does not accept changes from other websites.',
      });
      return;
    }

    next();
  };
}

/**
 * For actions that must come from a person using the web page: sending changes to
 * BambooHR, saving the API key, signing in to Claude, applying an update.
 *
 * A browser always labels such a request with an Origin (checked against the allowed
 * pages by the guard above) and a Sec-Fetch-Site of "same-origin". A script or a
 * command-line tool sends neither unless it deliberately fakes them, so this keeps
 * these actions from happening as a side effect of anything that merely has shell
 * access, such as a tool-using assistant that was handed a hostile résumé.
 */
export function requireBrowserOrigin(req: Request, res: Response, next: NextFunction): void {
  const fetchSite = req.headers['sec-fetch-site'];
  const isFromThePage =
    req.headers.origin !== undefined && (fetchSite === undefined || fetchSite === 'same-origin');

  if (!isFromThePage) {
    res.status(403).json({
      error: 'Forbidden',
      message: 'This action can only be started from the Hiring Helper web page.',
    });
    return;
  }

  next();
}
