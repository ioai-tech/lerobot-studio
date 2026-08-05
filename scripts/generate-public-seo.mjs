import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(process.cwd());
const publicDir = path.join(repoRoot, 'public');

const rawSiteUrl = process.env.VITE_SITE_URL || process.env.SITE_URL || 'https://lerobot.studio';
const siteUrl = String(rawSiteUrl).replace(/\/+$/, '');
const siteUrlWithSlash = siteUrl + '/';

if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });

const robots = `User-agent: *
Allow: /

Sitemap: ${siteUrlWithSlash}sitemap.xml
`;

const today = new Date().toISOString();
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${siteUrlWithSlash}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`;

fs.writeFileSync(path.join(publicDir, 'robots.txt'), robots, 'utf8');
fs.writeFileSync(path.join(publicDir, 'sitemap.xml'), sitemap, 'utf8');

console.log(`[seo] generated robots.txt + sitemap.xml (SITE_URL=${siteUrl})`);
