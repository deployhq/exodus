import type { APIRoute } from 'astro';
import { defaultStore } from '../../../lib/migration/jobs.ts';

export const prerender = false;

// GET /api/jobs/:id -> job (poll every 2 s as a fallback to the SSE stream)
export const GET: APIRoute = async ({ params }) => {
  const job = defaultStore().get(String(params.id));
  if (!job) return new Response(JSON.stringify({ error: 'Job not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
  return new Response(JSON.stringify(job), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
};
