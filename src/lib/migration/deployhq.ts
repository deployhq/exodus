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
