// Runs the hackathon-wp-static engine (scan -> copy -> translate to Astro) as a child process.
//
// NOTE: the engine always writes to <engineDir>/runs/<siteId>/ (its REPO_ROOT), whatever cwd
// it is spawned with. We still spawn with cwd = workDir, but read results from engineDir.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';

export interface EngineOptions {
  url: string;
  workDir: string;
  log: (line: string) => void;
  signal?: AbortSignal;
}

export interface EngineResult {
  siteId: string;
  runDir: string;
  astroSrcDir: string;
  summary: any;
  warnings: string[];
}

const DEFAULT_ALLOWED_HOSTS = ['websitedemos.net', 'wptavern.com', 'www.addsearch.com'];

// Same list as the engine's lib/common ALLOWED_ORIGIN_HOSTS, read at call time.
export function allowedHosts(): string[] {
  return [
    ...DEFAULT_ALLOWED_HOSTS,
    ...(process.env.WP_STATIC_ALLOW_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
  ];
}

export type UrlCheck = { ok: true; url: string } | { ok: false; status: 400 | 422; error: string };

export function validateUrl(input: unknown): UrlCheck {
  if (typeof input !== 'string' || !input.trim()) return { ok: false, status: 400, error: 'Missing "url" (a string).' };
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return { ok: false, status: 400, error: `Not a valid URL: ${input}` };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, status: 400, error: 'URL must be http(s).' };
  const hosts = allowedHosts();
  if (!hosts.includes(u.hostname.toLowerCase())) {
    return {
      ok: false,
      status: 422,
      error: `Host ${u.hostname} is not on the engine allowlist (${hosts.join(', ')}). Add it to WP_STATIC_ALLOW_HOSTS on the server.`,
    };
  }
  return { ok: true, url: u.toString() };
}

// Mirror of the engine's lib/common siteId().
export function siteId(input: string): string {
  const u = new URL(input);
  return `${u.hostname}${u.pathname}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function engineDir(): string {
  const dir = process.env.EXODUS_ENGINE_DIR
    ? path.resolve(process.env.EXODUS_ENGINE_DIR)
    : path.dirname(createRequire(import.meta.url).resolve('hackathon-wp-static/package.json'));
  return fs.realpathSync(dir);
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function readJson(file: string): any {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export async function runEngine(opts: EngineOptions): Promise<EngineResult> {
  const { url, workDir, log, signal } = opts;
  const dir = engineDir();
  const id = siteId(url);
  const runDir = path.join(dir, 'runs', id);
  const astroSrcDir = path.join(runDir, 'astro-src');
  const summaryFile = path.join(runDir, 'run-summary.json');
  fs.mkdirSync(workDir, { recursive: true });

  const port = await freePort();
  const args = [path.join(dir, 'bin', 'run.mjs'), url, '--port', String(port)];
  if (process.env.EXODUS_ENGINE_REUSE === '1' && fs.existsSync(path.join(runDir, 'site'))) {
    args.push('--skip-scan', '--skip-copy');
    log(`engine: reusing cached crawl in ${runDir}`);
  }

  // Same PATH shape as <engineDir>/tools/run.sh: this Node first, then the engine's .bin.
  // The installed dependency has its deps hoisted, so also add the parent node_modules/.bin.
  const binDirs = [path.dirname(process.execPath), path.join(dir, 'node_modules', '.bin')];
  if (path.basename(path.dirname(dir)) === 'node_modules') binDirs.push(path.join(dir, '..', '.bin'));
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: [...binDirs, process.env.PATH || ''].join(path.delimiter) };
  if (process.env.WP_STATIC_ALLOW_HOSTS) env.WP_STATIC_ALLOW_HOSTS = process.env.WP_STATIC_ALLOW_HOSTS;

  log(`engine: ${process.execPath} ${args.join(' ')}`);
  const spawnedAt = Date.now();
  const child = spawn(process.execPath, args, { cwd: workDir, env, stdio: ['ignore', 'pipe', 'pipe'] });

  const pipe = (stream: NodeJS.ReadableStream | null) => {
    if (!stream) return;
    let buf = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      buf += chunk;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? '';
      for (const l of lines) if (l.trim()) log(l);
    });
    stream.on('end', () => {
      if (buf.trim()) log(buf);
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);

  const onAbort = () => child.kill('SIGTERM');
  signal?.addEventListener('abort', onAbort, { once: true });
  const code: number | null = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (c) => resolve(c));
  });
  signal?.removeEventListener('abort', onAbort);
  if (signal?.aborted) throw new Error('engine aborted');

  const warnings: string[] = [];
  const st = fs.statSync(summaryFile, { throwIfNoEntry: false });
  // Guard against a stale summary from an earlier run (REUSE keeps the old one around).
  const summary = st && st.mtimeMs >= spawnedAt - 1000 ? readJson(summaryFile) : null;
  if (!summary) throw new Error(`engine exited ${code} without writing a fresh ${summaryFile}`);
  const t = summary?.stages?.translation;
  const built = t && !t.skipped && typeof t.buildMs === 'number';
  if (!built || !fs.existsSync(path.join(astroSrcDir, 'package.json'))) {
    throw new Error(`engine did not build the Astro translation (exit ${code})${t?.error ? `: ${t.error}` : t?.skipped ? `: skipped (${t.skipped})` : ''}`);
  }
  if (code !== 0) warnings.push(`engine exited ${code}: the strict copy-verify stage did not pass (the Astro translation built fine)`);
  if (t.error) warnings.push(`translation stage: ${t.error}`);
  if (t.quality?.verdict && t.quality.verdict !== 'pass') warnings.push(`Astro quality gate: ${t.quality.verdict}`);
  if (t.buildWarnings?.length) warnings.push(`Astro build warnings: ${t.buildWarnings.length}`);
  return { siteId: id, runDir, astroSrcDir, summary, warnings };
}
