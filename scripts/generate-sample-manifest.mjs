import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Generate a sample-datasets.manifest.json for deployment hosts.
 *
 * Sample archives are NOT shipped in this repository. Run this on a machine
 * that holds authorized sample assets, then host the manifest + files behind
 * VITE_SAMPLE_DATASETS_MANIFEST_URL.
 *
 * Usage:
 *   node scripts/generate-sample-manifest.mjs \
 *     --dir ./storage \
 *     --baseUrl https://examples.example.com/samples/ \
 *     --out ./temp/sample-datasets.manifest.json
 */

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const key = k.slice(2);
    const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    args[key] = val;
  }
  return args;
}

function stripPrefix(name) {
  return name.startsWith('lerobot_dataset_') ? name.slice('lerobot_dataset_'.length) : name;
}

function prettifyTitle(rawId) {
  // rawId 形如：rm75_picknplace / dualairbot_fold
  const parts = String(rawId).split('_');
  const robot = parts[0] || rawId;
  const action = parts.slice(1).join('_') || '';

  const robotMap = {
    dualairbot: 'DualAirbot',
    dualpiper: 'DualPiper',
    franka: 'Franka',
    human: 'Human',
    rm75: 'RM75',
  };
  const actionMap = {
    fold: 'Folding',
    pulling: 'Pulling',
    stack: 'Stacking',
    picknplace: 'Pick and Place',
    move: 'Moving',
  };

  const robotName = robotMap[robot] || robot;
  const actionName = actionMap[action] || (action ? action.replaceAll('_', ' ') : '');

  return actionName ? `${robotName} ${actionName}` : `${robotName}`;
}

async function main() {
  const args = parseArgs(process.argv);
  const dir = args.dir || './storage';
  const out = args.out || './temp/sample-datasets.manifest.json';
  const baseUrl = (args.baseUrl || '').trim() || undefined;

  const absDir = path.resolve(process.cwd(), dir);
  const entries = await fs.readdir(absDir);

  const tars = new Map();
  const covers = new Map();

  for (const file of entries) {
    if (file.endsWith('.tar')) tars.set(file.slice(0, -4), file);
    if (file.endsWith('.webp')) covers.set(file.slice(0, -5), file);
  }

  const keys = Array.from(new Set([...tars.keys(), ...covers.keys()])).sort();
  const datasets = [];

  for (const base of keys) {
    const tar = tars.get(base);
    const webp = covers.get(base);
    if (!tar || !webp) continue; // 必须成对存在
    const rawId = stripPrefix(base);
    datasets.push({
      id: rawId,
      title: prettifyTitle(rawId),
      archiveFile: tar,
      coverImageFile: webp,
    });
  }

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ...(baseUrl ? { baseUrl: baseUrl.endsWith('/') ? baseUrl : baseUrl + '/' } : {}),
    datasets,
  };

  const absOut = path.resolve(process.cwd(), out);
  await fs.mkdir(path.dirname(absOut), { recursive: true });
  await fs.writeFile(absOut, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

  console.log(`Wrote ${datasets.length} datasets -> ${absOut}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
