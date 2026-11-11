// Keeps generated preview sites out of search engines. Call these on the generated
// site's files before they are pushed, so previews never get indexed as clones of
// the original WordPress site.

export const PREVIEW_ROBOTS_TXT = 'User-agent: *\nDisallow: /\n';

const ROBOTS_META = '<meta name="robots" content="noindex, nofollow">';
const ROBOTS_META_PATTERN = /<meta\s+name=["']robots["'][^>]*>/gi;

/** Adds a noindex robots meta to an HTML document, replacing any existing robots meta. */
export function injectNoindex(html: string): string {
	const stripped = html.replace(ROBOTS_META_PATTERN, '');
	if (/<head[^>]*>/i.test(stripped)) {
		return stripped.replace(/<head[^>]*>/i, (head) => `${head}${ROBOTS_META}`);
	}
	return `${ROBOTS_META}${stripped}`;
}
