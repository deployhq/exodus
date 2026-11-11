// URL -> short, DNS-safe slug used for the GitHub repo, DeployHQ project and hostnames.
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'ac', 'gov']);
const MAX = 40;

export function deriveSlug(input: string): string {
  const u = new URL(input);
  let labels = u.hostname.toLowerCase().replace(/^www\./, '').split('.').filter(Boolean);
  if (labels.length > 1) labels = labels.slice(0, -1); // drop TLD
  if (labels.length >= 2 && SECOND_LEVEL.has(labels[labels.length - 1]) && u.hostname.split('.').length >= 3) {
    labels = labels.slice(0, -1); // example.co.uk -> example
  }
  const segments = u.pathname.split('/').filter(Boolean);
  let slug = [...labels, ...segments]
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length > MAX) {
    const cut = slug.slice(0, MAX + 1);
    const at = cut.lastIndexOf('-');
    slug = (at > 0 ? cut.slice(0, at) : slug.slice(0, MAX)).replace(/-+$/g, '');
  }
  return slug || 'site';
}

export function previewHosts(slug: string): { staging: string; customDomain: string } {
  return { staging: `${slug}-staging.deployhq-sites.com`, customDomain: `${slug}.dropsite.dev` };
}
