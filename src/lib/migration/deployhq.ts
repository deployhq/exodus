export interface DhqConfig {
  host: string;
  account: string;
  email: string;
  apiKey: string;
}

export class DhqError extends Error {
  status: number;
  body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export function dhqConfigFromEnv(): DhqConfig {
  const host = process.env.DEPLOYHQ_HOST || 'staging.deployhq.com';
  const account = process.env.DEPLOYHQ_ACCOUNT || '';
  const email = process.env.DEPLOYHQ_EMAIL || '';
  const apiKey = process.env.DEPLOYHQ_API_KEY || '';
  if (!account || !email || !apiKey) throw new Error('DEPLOYHQ_ACCOUNT, DEPLOYHQ_EMAIL and DEPLOYHQ_API_KEY must be set');
  return { host, account, email, apiKey };
}

export function dhqBase(cfg: DhqConfig): string {
  return `https://${cfg.account}.${cfg.host}`;
}

export async function dhq(cfg: DhqConfig, method: string, path: string, body?: unknown, timeoutMs = 60_000): Promise<any> {
  const auth = Buffer.from(`${cfg.email}:${cfg.apiKey}`).toString('base64');
  const res = await fetch(dhqBase(cfg) + path, {
    method,
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) {
    const safe = text.split(cfg.apiKey).join('***').slice(0, 500);
    throw new DhqError(`DeployHQ ${method} ${path} failed: HTTP ${res.status}: ${safe}`, res.status, safe);
  }
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

export function asList(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.records)) return data.records;
  return [];
}

/** Per-request timeout for poll GETs: short, so a hung request is retried instead of eating a minute. */
export const POLL_TIMEOUT_MS = 20_000;
const POLL_BACKOFF_MS = [3_000, 6_000, 10_000];

/** Timeouts/aborts, network errors, HTTP 5xx and 429 are worth retrying; other 4xx are not. */
export function isTransientError(e: any): boolean {
  if (e instanceof DhqError) return e.status === 429 || e.status >= 500;
  const name = e?.name ?? '';
  if (name === 'TimeoutError' || name === 'AbortError') return true;
  // fetch() network failures surface as TypeError("fetch failed") with a cause.
  if (e instanceof TypeError) return true;
  return false;
}

/**
 * Run a read-only poll request, retrying transient failures with backoff (3s, 6s, 10s, 10s...)
 * until `deadline` (epoch ms) passes. Never use it for POSTs: a retry could duplicate a resource.
 */
export async function retryPoll<T>(
  what: string,
  fn: () => Promise<T>,
  deadline: number,
  log: (line: string) => void,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      if (!isTransientError(e)) throw e;
      const wait = POLL_BACKOFF_MS[Math.min(attempt, POLL_BACKOFF_MS.length - 1)];
      if (Date.now() + wait > deadline) throw e;
      log(`${what}: transient error (${e?.message ?? e}); retrying in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
}
