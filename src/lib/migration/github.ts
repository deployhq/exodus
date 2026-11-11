import { execFileSync, spawnSync } from 'node:child_process';

const API = 'https://api.github.com';

export function githubToken(): string {
  const env = process.env.GITHUB_TOKEN?.trim();
  if (env) return env;
  const out = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' });
  const tok = (out.stdout || '').trim();
  if (out.status !== 0 || !tok) throw new Error('No GitHub token: set GITHUB_TOKEN or run `gh auth login`');
  return tok;
}

export async function gh(token: string, method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'exodus-migration',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

function fail(method: string, path: string, status: number, data: unknown): never {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  throw new Error(`GitHub ${method} ${path} failed: HTTP ${status}: ${(body || '').slice(0, 500)}`);
}

/** Returns {repoUrl, created}. Reuses the repo when it already exists. */
export async function ensureRepo(token: string, owner: string, name: string): Promise<{ repoUrl: string; created: boolean }> {
  const existing = await gh(token, 'GET', `/repos/${owner}/${name}`);
  if (existing.status === 200) return { repoUrl: existing.data.html_url, created: false };
  if (existing.status !== 404) fail('GET', `/repos/${owner}/${name}`, existing.status, existing.data);

  const me = await gh(token, 'GET', '/user');
  if (me.status !== 200) fail('GET', '/user', me.status, me.data);
  const isUser = String(me.data.login).toLowerCase() === owner.toLowerCase();
  const path = isUser ? '/user/repos' : `/orgs/${owner}/repos`;
  const created = await gh(token, 'POST', path, { name, private: true, description: 'Migrated by Exodus' });
  if (created.status === 201) return { repoUrl: created.data.html_url, created: true };
  // Race / already exists: reuse.
  if (created.status === 422) {
    const again = await gh(token, 'GET', `/repos/${owner}/${name}`);
    if (again.status === 200) return { repoUrl: again.data.html_url, created: false };
  }
  fail('POST', path, created.status, created.data);
}

/** Commits everything in dir and force-pushes to main. Returns the commit sha. */
export function commitAndPush(dir: string, token: string, owner: string, name: string, message: string): string {
  const auth = Buffer.from(`x-access-token:${token}`).toString('base64');
  const run = (args: string[]) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  run(['init', '-q', '-b', 'main']);
  run(['add', '-A']);
  run(['-c', 'user.name=Exodus', '-c', 'user.email=exodus@deployhq.com', 'commit', '-q', '--allow-empty', '-m', message]);
  const sha = run(['rev-parse', 'HEAD']);
  try {
    run([
      '-c', `http.extraheader=AUTHORIZATION: basic ${auth}`,
      'push', '--force', '-q', `https://github.com/${owner}/${name}.git`, 'HEAD:refs/heads/main',
    ]);
  } catch (e: any) {
    const msg = String(e?.stderr || e?.message || e).split(auth).join('***').split(token).join('***');
    throw new Error(`git push to github.com/${owner}/${name} failed: ${msg.slice(0, 500)}`);
  }
  return sha;
}

/** Adds a read-only deploy key unless the same key is already present. Returns true when added. */
export async function ensureDeployKey(token: string, owner: string, name: string, title: string, key: string): Promise<boolean> {
  const path = `/repos/${owner}/${name}/keys`;
  const norm = (k: string) => k.trim().split(/\s+/).slice(0, 2).join(' ');
  const list = await gh(token, 'GET', `${path}?per_page=100`);
  if (list.status !== 200) fail('GET', path, list.status, list.data);
  if ((list.data as any[]).some((k) => norm(k.key) === norm(key))) return false;
  const res = await gh(token, 'POST', path, { title, key: key.trim(), read_only: true });
  if (res.status === 201) return true;
  if (res.status === 422 && JSON.stringify(res.data).includes('already in use')) return false;
  fail('POST', path, res.status, res.data);
}
