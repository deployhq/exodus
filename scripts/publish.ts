import { resolve } from 'node:path';
import { publish } from '../src/lib/migration/publish.ts';

const [astroSrcDir, slug] = process.argv.slice(2);
if (!astroSrcDir || !slug) {
  console.error('usage: node scripts/publish.ts <astroSrcDir> <slug>');
  process.exit(2);
}

const t0 = Date.now();
const stamp = () => `[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s]`;
try {
  const result = await publish({
    slug,
    astroSrcDir,
    workDir: resolve('.exodus/work', `cli-${slug}`),
    log: (line) => console.log(`${stamp()}   ${line}`),
    onStep: (step, status, detail) => console.log(`${stamp()} [${step}] ${status}${detail ? ` ${detail}` : ''}`),
  });
  console.log('\nRESULT ' + JSON.stringify(result, null, 2));
} catch (e: any) {
  console.error(`\nFAILED: ${e?.message ?? e}`);
  process.exit(1);
}
