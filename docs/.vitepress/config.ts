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
  markdown: {
    lineNumbers: true,
  },
  locales: {
    root: {
      label: 'English',
      lang: 'en-US',
      themeConfig: {
        nav: [
          { text: 'User guide', link: '/user-manual' },
          { text: 'Embed in React', link: '/embedding' },
          { text: 'API reference', link: '/api' },
          { text: 'Live demo', link: 'https://lerobot.studio' },
        ],
        sidebar: [
          {
            text: 'Start',
            items: [
              { text: 'Introduction', link: '/' },
              { text: 'Quick Start', link: '/quick-start' },
              { text: 'User guide', link: '/user-manual' },
            ],
          },
          {
            text: 'Use the app',
            items: [
              { text: 'Data formats', link: '/data-formats' },
              { text: 'CORS and Range', link: '/cors' },
              { text: 'Browser support', link: '/browser' },
              { text: 'Troubleshooting', link: '/troubleshooting' },
              { text: 'Privacy', link: '/privacy' },
            ],
          },
          {
            text: 'Integrate',
            items: [
              { text: 'Embed in React', link: '/embedding' },
              { text: 'API reference', link: '/api' },
              { text: 'Migration', link: '/migration' },
            ],
          },
          {
            text: 'Reference',
            collapsed: true,
            items: [
              { text: 'Supported versions and browsers', link: '/compatibility' },
              { text: 'Deprecation', link: '/deprecation' },
            ],
          },
          {
            text: 'Contribute and maintain',
            collapsed: true,
            items: [
              { text: 'Architecture', link: '/architecture' },
              { text: 'Development', link: '/development' },
              { text: 'Deployment', link: '/deployment' },
              { text: '1.0.0 test results', link: '/release-evidence-1.0.0' },
              { text: 'Publishing to GitHub', link: '/github-migration' },
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
          { text: '使用指南', link: '/zh-CN/user-manual' },
          { text: '嵌入 React', link: '/zh-CN/embedding' },
          { text: 'API 参考', link: '/zh-CN/api' },
          { text: '在线演示', link: 'https://lerobot.studio' },
        ],
        sidebar: [
          {
            text: '入门',
            items: [
              { text: '简介', link: '/zh-CN/' },
              { text: '快速开始', link: '/zh-CN/quick-start' },
              { text: '使用指南', link: '/zh-CN/user-manual' },
            ],
          },
          {
            text: '使用应用',
            items: [
              { text: '数据格式', link: '/zh-CN/data-formats' },
              { text: 'CORS 与 Range', link: '/zh-CN/cors' },
              { text: '浏览器支持', link: '/zh-CN/browser' },
              { text: '故障排查', link: '/zh-CN/troubleshooting' },
              { text: '隐私', link: '/zh-CN/privacy' },
            ],
          },
          {
            text: '集成到应用',
            items: [
              { text: '嵌入 React', link: '/zh-CN/embedding' },
              { text: 'API 参考', link: '/zh-CN/api' },
              { text: '迁移', link: '/zh-CN/migration' },
            ],
          },
          {
            text: '参考',
            collapsed: true,
            items: [
              { text: '支持的版本与浏览器', link: '/zh-CN/compatibility' },
              { text: '弃用策略', link: '/zh-CN/deprecation' },
            ],
          },
          {
            text: '开发与维护',
            collapsed: true,
            items: [
              { text: '架构', link: '/zh-CN/architecture' },
              { text: '开发', link: '/zh-CN/development' },
              { text: '部署', link: '/zh-CN/deployment' },
              { text: '1.0.0 测试结果', link: '/zh-CN/release-evidence-1.0.0' },
              { text: '发布到 GitHub', link: '/zh-CN/github-migration' },
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
