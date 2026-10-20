/**
 * Job Posting Fetcher
 *
 * BambooHR's authenticated API returns job metadata but not the posting body.
 * The company's public careers site does expose it as JSON
 * (`/careers/<jobId>/detail`), with the description as HTML. This fetches that
 * and converts it to the plain text the scoring rubric and the editor use.
 *
 * Closed or unpublished postings return 404; callers treat that as "no posting
 * available" rather than an error.
 */

/** Injectable fetch signature (so tests can supply a fake). */
export type FetchFn = (url: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

const FETCH_TIMEOUT_MS = 15000;
const SUBDOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*$/i;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  bull: '•',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith('#')) {
      const isHex = body[1].toLowerCase() === 'x';
      const codePoint = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isNaN(codePoint) ? match : String.fromCodePoint(codePoint);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** Convert a posting's HTML to readable plain text (paragraphs, bullets, entities). */
export function htmlToPlainText(html: string): string {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|ul|ol)>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '');

  return decodeEntities(withBreaks)
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Fetch a job's public posting text. Returns null when the posting is not
 * public (404) or has no description. Throws on network errors or an invalid
 * subdomain, so callers can report why nothing was fetched.
 */
export async function fetchPostingText(
  subdomain: string,
  jobId: number,
  fetchFn: FetchFn = fetch as unknown as FetchFn
): Promise<string | null> {
  if (!SUBDOMAIN_PATTERN.test(subdomain)) {
    throw new Error(`Invalid BambooHR subdomain: "${subdomain}"`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchFn(`https://${subdomain}.bamboohr.com/careers/${jobId}/detail`, {
      signal: controller.signal,
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`BambooHR careers site returned HTTP ${response.status}`);
    }
    const body = (await response.json()) as {
      result?: { jobOpening?: { description?: unknown } };
    };
    const description = body?.result?.jobOpening?.description;
    if (typeof description !== 'string') return null;
    const text = htmlToPlainText(description);
    return text === '' ? null : text;
  } finally {
    clearTimeout(timer);
  }
}
