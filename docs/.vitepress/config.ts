import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitepress';

const docsDir = fileURLToPath(new URL('..', import.meta.url));

/** Map same-directory `*.zh-CN.md` sources to VitePress `zh-CN/` routes. */
function collectZhRewrites(): Record<string, string> {
  const rewrites: Record<string, string> = {};

  /** @param {string} dir */
  function walk(dir: string) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name === '.vitepress') continue;
        walk(full);
        continue;
      }
      if (!name.endsWith('.zh-CN.md')) continue;

      const rel = relative(docsDir, full).replace(/\\/g, '/');
      const slug = rel.replace(/\.zh-CN\.md$/, '');
      const source = `${slug}.zh-CN.md`;
      const route = slug === 'index' ? 'zh-CN/index.md' : `zh-CN/${slug}.md`;
      rewrites[source] = route;
    }
  }

  walk(docsDir);
  return rewrites;
}

const outline = { level: [2, 3] as [number, number] };

export default defineConfig({
  title: 'LeRobot Studio',
  description: 'Browser-based viewer and React library for LeRobot datasets',
  lang: 'en-US',
  base: process.env.DOCS_BASE ?? '/',
  cleanUrls: true,
  lastUpdated: true,
  rewrites: collectZhRewrites(),
  // Language switchers link to sibling *.zh-CN.md files for GitHub browsing.
  // Those sources are rewritten to /zh-CN/* routes and are not resolvable as
  // relative page paths during the VitePress dead-link pass.
  ignoreDeadLinks: [/\.zh-CN(\.md)?$/],
  markdown: {
    lineNumbers: true,
  },
  locales: {
    root: {
      label: 'English',
      lang: 'en-US',
      themeConfig: {
        nav: [
          { text: 'Guide', link: '/quick-start' },
          { text: 'API', link: '/api' },
          { text: 'Data formats', link: '/data-formats' },
          { text: 'Operations', link: '/deployment' },
          { text: 'Live demo', link: 'https://lerobot.studio' },
        ],
        sidebar: [
          {
            text: 'Start',
            items: [
              { text: 'Introduction', link: '/' },
              { text: 'Quick Start', link: '/quick-start' },
              { text: 'API', link: '/api' },
            ],
          },
          {
            text: 'Compatibility',
            items: [
              { text: 'Data formats', link: '/data-formats' },
              { text: 'CORS and Range', link: '/cors' },
              { text: 'Browser support', link: '/browser' },
              { text: 'Release gates', link: '/compatibility' },
            ],
          },
          {
            text: 'Guides',
            items: [
              { text: 'Privacy', link: '/privacy' },
              { text: 'Troubleshooting', link: '/troubleshooting' },
              { text: 'Migration', link: '/migration' },
              { text: 'Deprecation policy', link: '/deprecation' },
            ],
          },
          {
            text: 'Project',
            collapsed: true,
            items: [
              { text: 'Architecture', link: '/architecture' },
              { text: 'Development', link: '/development' },
              { text: 'Deployment', link: '/deployment' },
              { text: 'GitHub migration', link: '/github-migration' },
            ],
          },
        ],
        search: { provider: 'local' },
        outline,
        footer: {
          message: 'Released under the MIT License.',
          copyright: 'Copyright © 2026 IO-AI.TECH',
        },
      },
    },
    'zh-CN': {
      label: '简体中文',
      lang: 'zh-CN',
      link: '/zh-CN/',
      title: 'LeRobot Studio',
      description: '在浏览器中查看 LeRobot 数据集的 React 库与可视化应用',
      markdown: {
        container: {
          tipLabel: '提示',
          warningLabel: '警告',
          dangerLabel: '危险',
          infoLabel: '信息',
          detailsLabel: '详细信息',
        },
      },
      themeConfig: {
        nav: [
          { text: '指南', link: '/quick-start' },
          { text: 'API', link: '/api' },
          { text: '数据格式', link: '/data-formats' },
          { text: '运维', link: '/deployment' },
          { text: '在线演示', link: 'https://lerobot.studio' },
        ],
        sidebar: [
          {
            text: '入门',
            items: [
              { text: '简介', link: '/' },
              { text: '快速开始', link: '/quick-start' },
              { text: 'API', link: '/api' },
            ],
          },
          {
            text: '兼容性',
            items: [
              { text: '数据格式', link: '/data-formats' },
              { text: 'CORS 与 Range', link: '/cors' },
              { text: '浏览器支持', link: '/browser' },
              { text: '发布门禁', link: '/compatibility' },
            ],
          },
          {
            text: '指南',
            items: [
              { text: '隐私', link: '/privacy' },
              { text: '故障排查', link: '/troubleshooting' },
              { text: '迁移', link: '/migration' },
              { text: '弃用策略', link: '/deprecation' },
            ],
          },
          {
            text: '项目',
            collapsed: true,
            items: [
              { text: '架构', link: '/architecture' },
              { text: '开发', link: '/development' },
              { text: '部署', link: '/deployment' },
              { text: 'GitHub 迁移', link: '/github-migration' },
            ],
          },
        ],
        search: { provider: 'local' },
        outline,
        footer: {
          message: '基于 MIT 许可证发布。',
          copyright: 'Copyright © 2026 IO-AI.TECH',
        },
      },
    },
  },
});
