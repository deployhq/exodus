// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  // Public origin, used for canonical URLs, robots.txt and the sitemap. Unset locally.
  site: process.env.SITE_URL || undefined,
});
