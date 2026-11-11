import type { APIRoute } from 'astro';
import { startMigration } from '../../../lib/migration/pipeline.ts';
import { defaultStore } from '../../../lib/migration/jobs.ts';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// POST /api/jobs {url} -> 202 {id, statusUrl, eventsUrl, job}
export const POST: APIRoute = async ({ request }) => {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Body must be JSON: {"url": "https://..."}' }, 400);
  }
  try {
    const { job } = startMigration(body?.url);
    return json({ id: job.id, statusUrl: `/api/jobs/${job.id}`, eventsUrl: `/api/jobs/${job.id}/events`, job }, 202);
  } catch (e: any) {
    return json({ error: e?.message ?? String(e) }, e?.status ?? 500);
  }
};

// GET /api/jobs -> jobs, newest first
export const GET: APIRoute = async () => json(defaultStore().list());
