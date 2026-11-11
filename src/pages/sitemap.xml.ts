import type { APIRoute } from 'astro';

// Indexable pages only. Add new public pages here; never list app or API routes.
const paths = ['/'];

export const GET: APIRoute = ({ site }) => {
	const urls = site ? paths.map((path) => `  <url><loc>${new URL(path, site).href}</loc></url>`) : [];
	const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`;
	return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
