// Run the migration pipeline in the foreground: node scripts/migrate.ts <url>
// (npm run migrate -- <url>). Loads .env if present. Exit 0 on success.
import fs from 'node:fs';
import { startMigration } from '../src/lib/migration/pipeline.ts';

try {
  process.loadEnvFile('.env');
} catch {}

const url = process.argv[2];
if (!url) {
  console.error('usage: node scripts/migrate.ts <wordpress-url>');
  process.exit(2);
}

let started;
try {
  started = startMigration(url);
} catch (e: any) {
  console.error(`error (${e?.status ?? 'unknown'}): ${e?.message ?? e}`);
  process.exit(2);
}
const { job, done } = started;
console.log(`job ${job.id} slug ${job.slug} -> .exodus/jobs/${job.id}.json`);

const seen = new Map<string, string>();
let logged = 0;
const verbose = process.env.EXODUS_VERBOSE === '1';
const report = () => {
  for (const s of job.steps) {
    const key = `${s.status}|${s.detail ?? ''}`;
    if (seen.get(s.name) !== key) {
      seen.set(s.name, key);
      if (s.status !== 'pending') console.log(`[${new Date().toISOString().slice(11, 19)}] ${s.phase}/${s.name}: ${s.status}${s.detail ? ` - ${s.detail}` : ''}`);
    }
  }
  if (verbose) {
    const total = job.log.length;
    for (const l of job.log.slice(Math.max(0, total - (total - logged)))) console.log(`  | ${l}`);
    logged = total;
  }
};
const t = setInterval(report, 1000);
const final = await done;
clearInterval(t);
report();
if (final.warnings.length) console.log(`warnings:\n  - ${final.warnings.join('\n  - ')}`);
if (final.status === 'succeeded') {
  console.log(`SUCCEEDED\n${JSON.stringify(final.result, null, 2)}`);
  process.exit(0);
}
console.log(`FAILED: ${final.error}\nlast log lines:\n${final.log.slice(-20).join('\n')}`);
process.exit(1);
