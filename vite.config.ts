import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import type { Plugin } from 'vite';

function trimTrailingSlash(input: string) {
  return input.replace(/\/+$/, '');
}

function ensureLeadingSlash(input: string) {
  return input.startsWith('/') ? input : `/${input}`;
}

function normalizeSiteUrl(input?: string) {
  const raw = (input ?? '').trim();
  if (!raw) return 'https://lerobot.studio';
  return trimTrailingSlash(raw);
}

function normalizeBase(input?: string) {
  const raw = (input ?? '').trim();
  if (!raw) return '/';
  if (raw === './' || raw.startsWith('./')) return './';
  let v = raw;
  if (!v.startsWith('/')) v = `/${v}`;
  if (!v.endsWith('/')) v = `${v}/`;
  return v;
}

function wasmPreloadPlugin(): Plugin {
  let configBase = '/';
  return {
    name: 'wasm-preload',
    configResolved(config) {
      configBase = config.base;
    },
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        if (!ctx.bundle) return;
        return Object.keys(ctx.bundle)
          .filter((f) => f.endsWith('.wasm'))
          .map((fileName) => ({
            tag: 'link',
            attrs: {
              rel: 'preload',
              as: 'fetch',
              crossorigin: 'anonymous',
              href: `${configBase}${fileName}`,
            },
            injectTo: 'head' as const,
          }));
      },
    },
  };
}

function htmlEnvPlugin(replacements: Record<string, string>): Plugin {
  return {
    name: 'html-env-plugin',
    transformIndexHtml(html) {
      return Object.entries(replacements).reduce(
        (acc, [key, value]) => acc.replaceAll(`%${key}%`, value),
        html,
      );
    },
  };
}

export default defineConfig(() => {
  const base = normalizeBase(process.env.BASE_PATH ?? process.env.VITE_BASE);
  const siteUrl = normalizeSiteUrl(process.env.SITE_URL ?? process.env.VITE_SITE_URL);
  const siteRoot = `${siteUrl}/`;
  const basePath = base === './' ? '/' : ensureLeadingSlash(base);
  const canonicalUrl = new URL(basePath, siteRoot).toString();
  const ogImageUrl = (process.env.OG_IMAGE_URL ?? process.env.VITE_OG_IMAGE_URL)?.trim()
    ? trimTrailingSlash((process.env.OG_IMAGE_URL ?? process.env.VITE_OG_IMAGE_URL) as string)
    : new URL('og-image-1200x630.png', canonicalUrl).toString();
  const sitemapUrl = new URL('sitemap.xml', canonicalUrl).toString();
  const twitterSite = (process.env.TWITTER_SITE ?? process.env.VITE_TWITTER_SITE ?? '').trim();

  return {
    base,
    plugins: [
      wasmPreloadPlugin(),
      htmlEnvPlugin({
        SITE_URL: siteUrl,
        BASE_PATH: basePath,
        CANONICAL_URL: canonicalUrl,
        OG_IMAGE_URL: ogImageUrl,
        SITEMAP_URL: sitemapUrl,
        TWITTER_SITE: twitterSite,
      }),
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: [
        {
          find: 'react-i18next',
          replacement: path.resolve(__dirname, './src/react/i18n/reactI18nextCompat.ts'),
        },
        {
          find: /^@\/workers\/workerManager$/,
          replacement: path.resolve(__dirname, './src/platform/workers/workerManager.ts'),
        },
        {
          find: /^@\/workers\/wasmUrl$/,
          replacement: path.resolve(__dirname, './src/platform/workers/wasmUrl.ts'),
        },
        { find: /^@\/core(?:\/|$)/, replacement: path.resolve(__dirname, './src/core') },
        { find: /^@\/platform(?:\/|$)/, replacement: path.resolve(__dirname, './src/platform') },
        { find: /^@\/ui(?:\/|$)/, replacement: path.resolve(__dirname, './src/ui') },
        { find: /^@\/web(?:\/|$)/, replacement: path.resolve(__dirname, './src/web') },
        { find: /^@$/, replacement: path.resolve(__dirname, './src/react/internal.ts') },
        { find: /^@\//, replacement: path.resolve(__dirname, './src/react') + '/' },
      ],
    },
    build: {
      target: 'esnext',
      outDir: 'dist',
      emptyOutDir: true,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              {
                test: /node_modules[\\/](dockview-react|dockview-core|dockview)([\\/]|$)/,
                name: 'dockview',
              },
              { test: /node_modules[\\/]uplot([\\/]|$)/, name: 'uplot' },
              { test: /node_modules[\\/]apache-arrow([\\/]|$)/, name: 'apache-arrow' },
              { test: /node_modules[\\/]parquet-wasm([\\/]|$)/, name: 'parquet-wasm' },
              { test: /node_modules[\\/](@zip\.js[\\/]zip\.js|zip\.js)([\\/]|$)/, name: 'zip' },
              { test: /node_modules/, name: 'vendor' },
            ],
          },
        },
      },
    },
  };
});
