import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const ROOT = process.cwd();
const LIB_DIR = path.join(ROOT, 'dist-lib');
const WEB_DIR = path.join(ROOT, 'dist');
const scale = Number(process.env.BUNDLE_SIZE_BUDGET_SCALE ?? '1');

if (!Number.isFinite(scale) || scale <= 0 || scale > 1) {
  console.error('BUNDLE_SIZE_BUDGET_SCALE must be greater than 0 and at most 1.');
  process.exit(2);
}

// These hard limits are approximately 5% above the measured 2026-08-04 baseline.
// Raising one requires an explicit review of the generated artifacts.
const budgets = {
  libEntry: { raw: 330_300, gzip: 107_300 },
  libCss: { raw: 354_200, gzip: 108_500 },
  webInitialJs: { raw: 2_664_000, gzip: 715_000 },
  webInitialCss: { raw: 192_000, gzip: 24_400 },
  libDataLoader: { raw: 272_100, gzip: 56_200 },
  webDataLoader: { raw: 33_500, gzip: 9_300 },
  libDockview: { raw: 670_900, gzip: 158_700 },
  webDockview: { raw: 91_500, gzip: 26_900 },
  libWorkerWasm: { raw: 9_100_000, gzip: 2_940_000 },
  libWorkers: { raw: 461_000, gzip: 106_000 },
  webWorkerWasm: { raw: 6_819_000, gzip: 2_014_000 },
  webWorkers: { raw: 461_000, gzip: 106_000 },
  largestLibJs: { raw: 670_900, gzip: 158_700 },
  largestWebJs: { raw: 1_108_200, gzip: 313_400 },
  npmTarball: { raw: 11_554_000, gzip: 3_444_000 },
};

const failures = [];

async function walkFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    failures.push(`Missing build output directory: ${path.relative(ROOT, directory)}/`);
    return [];
  }

  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(absolute)));
    } else if (entry.isFile()) {
      files.push(absolute);
    }
  }
  return files;
}

function oneFile(files, pattern, description) {
  const matches = files.filter((file) => pattern.test(path.basename(file)));
  if (matches.length !== 1) {
    failures.push(
      `Expected exactly one ${description}; found ${matches.length}: ${
        matches.map((file) => path.relative(ROOT, file)).join(', ') || 'none'
      }`,
    );
  }
  return matches;
}

async function measureFiles(files) {
  let raw = 0;
  let gzip = 0;
  for (const file of files) {
    try {
      const contents = await readFile(file);
      raw += contents.byteLength;
      gzip += gzipSync(contents, { level: 9 }).byteLength;
    } catch (error) {
      failures.push(`Cannot read artifact ${path.relative(ROOT, file)}: ${error.message}`);
    }
  }
  return { raw, gzip };
}

function budgetFor(key) {
  return {
    raw: Math.floor(budgets[key].raw * scale),
    gzip: Math.floor(budgets[key].gzip * scale),
  };
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 ** 2).toFixed(2)} MiB`;
}

const rows = [];

async function checkGroup(label, key, files) {
  const actual = await measureFiles(files);
  const limit = budgetFor(key);
  rows.push({ label, actual, limit });
  for (const encoding of ['raw', 'gzip']) {
    if (actual[encoding] > limit[encoding]) {
      failures.push(
        `${label} ${encoding} is ${formatBytes(actual[encoding])}; limit is ${formatBytes(limit[encoding])}.`,
      );
    }
  }
}

async function checkLargestChunk(label, key, files) {
  const measured = await Promise.all(
    files.map(async (file) => ({ file, ...(await measureFiles([file])) })),
  );
  const largestRaw = measured.toSorted((a, b) => b.raw - a.raw)[0] ?? { raw: 0, gzip: 0 };
  const largestGzip = measured.toSorted((a, b) => b.gzip - a.gzip)[0] ?? {
    raw: 0,
    gzip: 0,
  };
  const actual = { raw: largestRaw.raw, gzip: largestGzip.gzip };
  const limit = budgetFor(key);
  rows.push({ label, actual, limit });

  for (const item of measured) {
    if (item.raw > limit.raw || item.gzip > limit.gzip) {
      failures.push(
        `Unexpected huge chunk ${path.relative(ROOT, item.file)} is ${formatBytes(item.raw)} raw / ${formatBytes(item.gzip)} gzip; per-chunk limit is ${formatBytes(limit.raw)} raw / ${formatBytes(limit.gzip)} gzip.`,
      );
    }
  }
}

function htmlAssetPaths(html, relation) {
  const matches = [];
  const tagPattern = relation === 'script' ? /<script\b[^>]*>/gi : /<link\b[^>]*>/gi;
  for (const tag of html.match(tagPattern) ?? []) {
    const rel = tag.match(/\brel=["']([^"']+)["']/i)?.[1];
    const attribute = relation === 'script' ? 'src' : 'href';
    if (
      relation !== 'script' &&
      !rel
        ?.split(/\s+/)
        .map((value) => value.toLowerCase())
        .includes(relation)
    ) {
      continue;
    }
    const value = tag.match(new RegExp(`\\b${attribute}=["']([^"']+)["']`, 'i'))?.[1];
    if (value) matches.push(value);
  }
  return matches;
}

function resolveWebAssets(references, description) {
  if (references.length === 0)
    failures.push(`No ${description} references found in dist/index.html.`);
  return references.map((reference) => path.join(WEB_DIR, reference.replace(/^\/+/, '')));
}

function readPackMetadata() {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    failures.push(`npm pack --dry-run failed:\n${result.stderr || result.stdout}`);
    return null;
  }
  try {
    const metadata = JSON.parse(result.stdout);
    if (!Array.isArray(metadata) || metadata.length !== 1) throw new Error('unexpected result');
    return metadata[0];
  } catch (error) {
    failures.push(`Could not parse npm pack metadata: ${error.message}`);
    return null;
  }
}

const [libFiles, webFiles] = await Promise.all([walkFiles(LIB_DIR), walkFiles(WEB_DIR)]);
const libEntry = oneFile(libFiles, /^lerobot\.es\.js$/, 'stable library entry');
const libCss = oneFile(libFiles, /^lerobot-studio\.css$/, 'library CSS artifact');
const libDataLoader = oneFile(
  libFiles,
  /^LeRobotDataLoader-[\w-]+\.js$/,
  'library DataLoader chunk',
);
const libDockview = oneFile(libFiles, /^DockviewLayout-[\w-]+\.js$/, 'library Dockview chunk');
const libWorkers = libFiles.filter((file) => /\.worker-[\w-]+\.js$/i.test(path.basename(file)));
const libWorkerWasm = libFiles.filter(
  (file) => /wasm/i.test(path.basename(file)) && !libWorkers.includes(file),
);

if (libWorkerWasm.length === 0) failures.push('No library Worker/WASM artifacts found.');
if (libWorkers.length !== 2)
  failures.push(`Expected two library Workers; found ${libWorkers.length}.`);

let webInitialJs = [];
let webInitialCss = [];
try {
  const html = await readFile(path.join(WEB_DIR, 'index.html'), 'utf8');
  webInitialJs = resolveWebAssets(
    [...htmlAssetPaths(html, 'script'), ...htmlAssetPaths(html, 'modulepreload')],
    'initial JS',
  );
  webInitialCss = resolveWebAssets(htmlAssetPaths(html, 'stylesheet'), 'initial CSS');
} catch (error) {
  failures.push(`Missing or unreadable dist/index.html: ${error.message}`);
}

const webDataLoader = oneFile(webFiles, /^LeRobotDataLoader-[\w-]+\.js$/, 'web DataLoader chunk');
const webDockview = oneFile(webFiles, /^DockviewLayout-[\w-]+\.js$/, 'web Dockview chunk');
const webWorkers = webFiles.filter((file) => /\.worker-[\w-]+\.js$/i.test(path.basename(file)));
const webWorkerWasm = webFiles.filter(
  (file) => /wasm/i.test(path.basename(file)) && !webWorkers.includes(file),
);

if (webWorkerWasm.length === 0) failures.push('No web Worker/WASM artifacts found.');
if (webWorkers.length !== 2) failures.push(`Expected two web Workers; found ${webWorkers.length}.`);

await checkGroup('Library stable entry', 'libEntry', libEntry);
await checkGroup('Library CSS', 'libCss', libCss);
await checkGroup('Web initial synchronous JS', 'webInitialJs', webInitialJs);
await checkGroup('Web initial CSS', 'webInitialCss', webInitialCss);
await checkGroup('Library lazy DataLoader', 'libDataLoader', libDataLoader);
await checkGroup('Web lazy DataLoader', 'webDataLoader', webDataLoader);
await checkGroup('Library lazy Dockview', 'libDockview', libDockview);
await checkGroup('Web lazy Dockview', 'webDockview', webDockview);
await checkGroup('Library Worker/WASM', 'libWorkerWasm', libWorkerWasm);
await checkGroup('Library external Workers', 'libWorkers', libWorkers);
await checkGroup('Web Worker/WASM', 'webWorkerWasm', webWorkerWasm);
await checkGroup('Web external Workers', 'webWorkers', webWorkers);
await checkLargestChunk(
  'Largest library JS chunk',
  'largestLibJs',
  libFiles.filter((file) => file.endsWith('.js') && !libWorkerWasm.includes(file)),
);
await checkLargestChunk(
  'Largest web JS chunk',
  'largestWebJs',
  webFiles.filter((file) => file.endsWith('.js') && !webWorkerWasm.includes(file)),
);

const pack = readPackMetadata();
if (pack) {
  const actual = { raw: pack.unpackedSize, gzip: pack.size };
  const limit = budgetFor('npmTarball');
  rows.push({ label: 'npm tarball (unpacked / .tgz)', actual, limit });
  if (actual.raw > limit.raw) {
    failures.push(
      `npm tarball unpacked size is ${formatBytes(actual.raw)}; limit is ${formatBytes(limit.raw)}.`,
    );
  }
  if (actual.gzip > limit.gzip) {
    failures.push(
      `npm tarball .tgz size is ${formatBytes(actual.gzip)}; limit is ${formatBytes(limit.gzip)}.`,
    );
  }
}

const labelWidth = Math.max(...rows.map((row) => row.label.length), 24);
console.log('\nBundle size report (raw and gzip):');
console.log(
  `${'Artifact'.padEnd(labelWidth)}  ${'Raw / limit'.padEnd(25)}  ${'Gzip / limit'.padEnd(25)}`,
);
for (const row of rows) {
  const raw = `${formatBytes(row.actual.raw)} / ${formatBytes(row.limit.raw)}`;
  const gzip = `${formatBytes(row.actual.gzip)} / ${formatBytes(row.limit.gzip)}`;
  console.log(`${row.label.padEnd(labelWidth)}  ${raw.padEnd(25)}  ${gzip.padEnd(25)}`);
}

console.log('\nNote: library Workers are external and share one lazy package-local WASM payload.');

if (failures.length > 0) {
  console.error(`\nBundle size gate failed with ${failures.length} problem(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('\nBundle size gate passed.');
