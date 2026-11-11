// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

// Pages stay static by default. The migration API routes opt out with
// `export const prerender = false` and run on the Node server.
export default defineConfig({
  adapter: node({ mode: 'standalone' }),
});
