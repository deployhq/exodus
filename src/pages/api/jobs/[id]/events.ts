import type { APIRoute } from 'astro';
import { defaultStore } from '../../../../lib/migration/jobs.ts';

export const prerender = false;

// GET /api/jobs/:id/events -> Server-Sent Events.
// `event: job` with the full job JSON whenever it changes (checked every 1 s),
// a `: ping` comment every 15 s, and the stream ends after succeeded or failed.
export const GET: APIRoute = async ({ params, request }) => {
  const store = defaultStore();
  const id = String(params.id);
  if (!store.get(id)) {
    return new Response(JSON.stringify({ error: 'Job not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
  }
  const enc = new TextEncoder();
  let tick: ReturnType<typeof setInterval> | undefined;
  let ping: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    clearInterval(tick);
    clearInterval(ping);
  };
  const stream = new ReadableStream({
    start(controller) {
      let last = '';
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        stop();
        try {
          controller.close();
        } catch {}
      };
      const send = (s: string) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(s));
        } catch {
          close();
        }
      };
      const check = () => {
        const job = store.get(id);
        if (!job) return close();
        const marker = `${job.updatedAt}|${job.status}|${job.log.length}`;
        if (marker !== last) {
          last = marker;
          send(`event: job\ndata: ${JSON.stringify(job)}\n\n`);
        }
        if (job.status === 'succeeded' || job.status === 'failed') close();
      };
      send('retry: 2000\n\n');
      check();
      tick = setInterval(check, 1000);
      ping = setInterval(() => send(': ping\n\n'), 15000);
      request.signal?.addEventListener('abort', close);
    },
    cancel() {
      stop();
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' },
  });
};
