#!/usr/bin/env node
/**
 * Ensures every repository-owned English Markdown file has a `.zh-CN.md` pair
 * or an explicit entry in scripts/docs-i18n-exceptions.json.
 */
import { readFileSync, existsSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const repoRoot = join(import.meta.dirname, '..');
const exceptionsPath = join(repoRoot, 'scripts/docs-i18n-exceptions.json');

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'dist-lib',
  '.git',
  '.vitepress',
  'coverage',
  'temp',
  '.changeset',
]);

/** @type {{ exceptions: Array<{ path: string; zhEntry?: string | null }>; skipScanDirs?: Array<{ dir: string }> }} */
const manifest = JSON.parse(readFileSync(exceptionsPath, 'utf8'));
const { exceptions, skipScanDirs = [] } = manifest;
const exceptionByPath = new Map(exceptions.map((entry) => [entry.path, entry]));
const skipScanDirNames = new Set(skipScanDirs.map((entry) => entry.dir));

/** @param {string} dir */
function walkMarkdown(dir) {
  /** @type {string[]} */
  const files = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(repoRoot, full).split(sep).join('/');
    if (statSync(full).isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      files.push(...walkMarkdown(full));
      continue;
    }
    if (name.endsWith('.md')) {
      files.push(rel);
    }
  }
  return files;
}

/** @param {string} relPath */
function zhPairPath(relPath) {
  return relPath.replace(/\.md$/, '.zh-CN.md');
}

/** @param {string} relPath */
function isUnderSkipScanDir(relPath) {
  const top = relPath.split('/')[0];
  return skipScanDirNames.has(top);
}

/** @type {string[]} */
const errors = [];
const markdownFiles = walkMarkdown(repoRoot);

for (const entry of exceptions) {
  if (isUnderSkipScanDir(entry.path)) {
    errors.push(
      `Exception for ${entry.path} is redundant: paths under skipScanDirs are not scanned; remove the exception or stop skipping the directory.`,
    );
    continue;
  }
  if (!markdownFiles.includes(entry.path)) {
    errors.push(`Exception references missing Markdown file: ${entry.path}`);
  }
  if (entry.zhEntry && !existsSync(join(repoRoot, entry.zhEntry))) {
    errors.push(`Exception for ${entry.path} references missing zhEntry: ${entry.zhEntry}`);
  }
}

for (const relPath of markdownFiles.sort()) {
  if (relPath.endsWith('.zh-CN.md')) {
    continue;
  }

  const exception = exceptionByPath.get(relPath);
  if (exception) {
    continue;
  }

  const pair = zhPairPath(relPath);
  if (!existsSync(join(repoRoot, pair))) {
    errors.push(`Missing Chinese pair: expected ${pair} for ${relPath}`);
  }
}

for (const relPath of markdownFiles.filter((file) => file.endsWith('.zh-CN.md'))) {
  const source = relPath.replace(/\.zh-CN\.md$/, '.md');
  if (!existsSync(join(repoRoot, source)) && !exceptionByPath.has(source)) {
    errors.push(`Orphan Chinese doc without English source: ${relPath}`);
  }
}

if (errors.length > 0) {
  console.error('Documentation i18n check failed:\n');
  for (const error of errors) {
    console.error(`  - ${error}`);
  }
  console.error(
    `\nAdd a sibling \`.zh-CN.md\` file or register an exception in scripts/docs-i18n-exceptions.json.`,
  );
  process.exit(1);
}

const englishCount = markdownFiles.filter((f) => !f.endsWith('.zh-CN.md')).length;
console.log(
  `Documentation i18n check passed (${englishCount} English files, ${exceptions.length} exceptions, ${skipScanDirs.length} skip-scan dirs).`,
);
