import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'LeRobot Studio',
  description: 'Browser-based viewer and React library for LeRobot datasets',
  lang: 'en-US',
  base: process.env.DOCS_BASE ?? '/',
  cleanUrls: true,
  lastUpdated: true,
  markdown: {
    lineNumbers: true,
  },
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
    search: {
      provider: 'local',
    },
    outline: {
      level: [2, 3],
    },
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026 IO-AI.TECH',
    },
  },
});
