#!/usr/bin/env node
/**
 * Rewrite stale relative/@ imports after workspace migration.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = process.cwd();

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'dist-lib') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(p);
  }
  return out;
}

function rewriteFile(file) {
  let text = readFileSync(file, 'utf8');
  const orig = text;
  const rel = relative(ROOT, file).replaceAll('\\', '/');

  const inCore = rel.startsWith('packages/core/');
  const inPlatform = rel.startsWith('packages/platform/');
  const inUi = rel.startsWith('packages/ui/');
  const inReact = rel.startsWith('packages/react/');
  const inWeb = rel.startsWith('apps/web/');
  const inTests = rel.startsWith('tests/');

  // UI: @/lib/utils -> relative utils
  if (inUi) {
    text = text.replaceAll("from '@/lib/utils'", "from '../utils'");
    text = text.replaceAll('from "@/lib/utils"', "from '../utils'");
  }

  // Generic path remaps (order matters — longer/more specific first)
  const remaps = [
    // Old service paths → packages
    [/from ['"](\.\.\/)+services\/versioning(\/index)?['"]/g, "from '@ioai/lerobot-studio-core'"],
    [/from ['"](\.\.\/)+services\/versioning\/([^'"]+)['"]/g, "from '@ioai/lerobot-studio-core'"],
    [/from ['"](\.\.\/)+services\/export\/ExportAdapter['"]/g, "from '@ioai/lerobot-studio-core'"],
    [/from ['"](\.\.\/)+services\/export\/types['"]/g, "from '@ioai/lerobot-studio-core'"],
    [
      /from ['"](\.\.\/)+services\/export\/MetadataExporter['"]/g,
      "from '@ioai/lerobot-studio-core'",
    ],
    [
      /from ['"](\.\.\/)+services\/export\/ExportService['"]/g,
      "from '@ioai/lerobot-studio-platform'",
    ],
    [
      /from ['"](\.\.\/)+services\/export\/WebExportAdapter['"]/g,
      "from '@ioai/lerobot-studio-platform'",
    ],
    [/from ['"](\.\.\/)+services\/export\/([^'"]+)['"]/g, "from '@ioai/lerobot-studio-platform'"],
    [/from ['"](\.\.\/)+services\/export['"]/g, "from '@ioai/lerobot-studio-platform'"],
    [/from ['"](\.\.\/)+services\/analysis\/StatsService['"]/g, "from '@ioai/lerobot-studio-core'"],
    [/from ['"](\.\.\/)+services\/analysis\/SplitService['"]/g, "from '@ioai/lerobot-studio-core'"],
    [/from ['"](\.\.\/)+services\/dataSources['"]/g, "from '@ioai/lerobot-studio-platform'"],
    [
      /from ['"](\.\.\/)+services\/ArchiveDataSourceFactory['"]/g,
      "from '@ioai/lerobot-studio-platform'",
    ],
    [
      /from ['"](\.\.\/)+services\/RemoteManifestDataSource['"]/g,
      "from '@ioai/lerobot-studio-platform'",
    ],
    [/from ['"](\.\.\/)+services\/remotePreflight['"]/g, "from '@ioai/lerobot-studio-platform'"],
    [/from ['"](\.\.\/)+services\/sampleDatasets['"]/g, "from '@ioai/lerobot-studio-platform'"],
    [/from ['"](\.\.\/)+services\/LeRobotDataLoader['"]/g, "from '@ioai/lerobot-studio-platform'"],
    [
      /from ['"](\.\.\/)+services\/ParquetImageService['"]/g,
      "from '@ioai/lerobot-studio-platform'",
    ],
    [/from ['"](\.\.\/)+services\/platformDetector['"]/g, "from '@ioai/lerobot-studio-platform'"],
    [/from ['"](\.\.\/)+services\/mediaCopy['"]/g, "from '@ioai/lerobot-studio-platform'"],
    [/from ['"](\.\.\/)+services\/SourceController['"]/g, "from '../services/SourceController'"],
    [/from ['"](\.\.\/)+types\/lerobot['"]/g, "from '@ioai/lerobot-studio-core'"],
    [/from ['"](\.\.\/)+contexts\/episodeLoadPlan['"]/g, "from '@ioai/lerobot-studio-core'"],
    [/from ['"](\.\.\/)+utils\/MediaCache['"]/g, "from '@ioai/lerobot-studio-platform'"],
    [/from ['"](\.\.\/)+utils\/handleStore['"]/g, "from '@ioai/lerobot-studio-platform'"],
    [/from ['"](\.\.\/)+utils\/fsPermissions['"]/g, "from '@ioai/lerobot-studio-platform'"],
    [/from ['"](\.\.\/)+utils\/storage['"]/g, "from '@ioai/lerobot-studio-platform'"],
    [/from ['"](\.\.\/)+utils\/featureUtils['"]/g, "from '@ioai/lerobot-studio-core'"],
    [/from ['"](\.\.\/)+utils\/datasetDisplayName['"]/g, "from '@ioai/lerobot-studio-core'"],
    [/from ['"](\.\.\/)+utils\/mediaFeatureMetadata['"]/g, "from '@ioai/lerobot-studio-core'"],
    [
      /from ['"](\.\.\/)+utils\/sourceUrl['"]/g,
      inWeb ? "from '../utils/sourceUrl'" : "from '../../apps/web/src/utils/sourceUrl'",
    ],
    [/from ['"](\.\.\/)+workers\/workerManager['"]/g, "from '@ioai/lerobot-studio-platform'"],
    [/from ['"](\.\.\/)+workers\/types['"]/g, "from '@ioai/lerobot-studio-core'"],
    [/from ['"](\.\.\/)+workers\/imageColumns['"]/g, "from '@ioai/lerobot-studio-core'"],
    [/from ['"](\.\.\/)+lib\/utils['"]/g, "from '@ioai/lerobot-studio-ui'"],
    [/from ['"](\.\.\/)+lib\/chartTooltipPlacement['"]/g, "from '@ioai/lerobot-studio-core'"],

    // @/ aliases
    [/from ['"]@\/lib\/utils['"]/g, "from '@ioai/lerobot-studio-ui'"],
    [/from ['"]@\/lib\/chartTheme['"]/g, "from '../lib/chartTheme'"],
    [/from ['"]@\/workers\/wasmUrl['"]/g, "from '../workers/wasmUrl'"],
    [/from ['"]@\/components\/ui\/([^'"]+)['"]/g, "from '@ioai/lerobot-studio-ui'"],
    [
      /from ['"]@\/([^'"]+)['"]/g,
      (m, p1) => {
        // fallback: leave for manual fix if unknown
        return m;
      },
    ],
  ];

  for (const [re, repl] of remaps) {
    if (typeof repl === 'function') text = text.replace(re, repl);
    else text = text.replace(re, repl);
  }

  // React: UI component relative imports -> package
  if (inReact || inWeb) {
    text = text.replace(
      /from ['"](\.\.\/)*ui\/(button|badge|card|dialog|dropdown-menu|input|pagination|scroll-area|separator|sheet|slider|tabs|textarea|toast|tooltip|aspect-ratio|app-tooltip)['"]/g,
      "from '@ioai/lerobot-studio-ui'",
    );
    text = text.replace(
      /from ['"]\.\/ui\/(button|badge|card|dialog|dropdown-menu|input|pagination|scroll-area|separator|sheet|slider|tabs|textarea|toast|tooltip|aspect-ratio|app-tooltip)['"]/g,
      "from '@ioai/lerobot-studio-ui'",
    );
    // toaster stays local
    text = text.replace(/from ['"](\.\.\/)*ui\/toaster['"]/g, (m) => m); // no-op keep
    text = text.replace(/from ['"]\.\/ui\/toaster['"]/g, "from './ui/toaster'");
  }

  // React panel helpers moved to core
  if (inReact) {
    text = text.replace(
      /from ['"]\.\/chartFeatureSelection['"]/g,
      "from '@ioai/lerobot-studio-core'",
    );
    text = text.replace(
      /from ['"]\.\/chartFilterGrouping['"]/g,
      "from '@ioai/lerobot-studio-core'",
    );
    text = text.replace(
      /from ['"]\.\/imagePanelLoadGuards['"]/g,
      "from '@ioai/lerobot-studio-core'",
    );
    text = text.replace(
      /from ['"]\.\/imagePanelRequestUtils['"]/g,
      "from '@ioai/lerobot-studio-core'",
    );
    text = text.replace(
      /from ['"]\.\.\/Common\/filters\/selectionModel['"]/g,
      "from '@ioai/lerobot-studio-core'",
    );
    text = text.replace(
      /from ['"]\.\.\/Common\/filters\/filterGrouping['"]/g,
      "from '@ioai/lerobot-studio-core'",
    );
    text = text.replace(
      /from ['"]\.\/filters\/selectionModel['"]/g,
      "from '@ioai/lerobot-studio-core'",
    );
    text = text.replace(
      /from ['"]\.\/filters\/filterGrouping['"]/g,
      "from '@ioai/lerobot-studio-core'",
    );
    text = text.replace(
      /from ['"]\.\/Split\/splitChartConstants['"]/g,
      "from '@ioai/lerobot-studio-core'",
    );
    text = text.replace(
      /from ['"]\.\.\/Playback\/playbackAutoplay['"]/g,
      "from '@ioai/lerobot-studio-core'",
    );
    text = text.replace(/from ['"]\.\/keyboard['"]/g, "from '@ioai/lerobot-studio-core'");
  }

  // Platform internal fixes
  if (inPlatform) {
    text = text.replace(
      /from ['"]\.\.\/\.\.\/types\/lerobot['"]/g,
      "from '@ioai/lerobot-studio-core'",
    );
    text = text.replace(/from ['"]\.\/ExportAdapter['"]/g, "from '@ioai/lerobot-studio-core'");
    text = text.replace(/from ['"]\.\/types['"]/g, "from '@ioai/lerobot-studio-core'");
    text = text.replace(/from ['"]\.\/MetadataExporter['"]/g, "from '@ioai/lerobot-studio-core'");
    text = text.replace(
      /from ['"]\.\.\/analysis\/StatsService['"]/g,
      "from '@ioai/lerobot-studio-core'",
    );
    text = text.replace(
      /from ['"]\.\.\/LeRobotDataLoader['"]/g,
      "from '../services/LeRobotDataLoader'",
    );
    // workers
    text = text.replace(/from ['"]\.\/types['"]/g, (m) =>
      rel.includes('/workers/') ? "from '@ioai/lerobot-studio-core'" : m,
    );
    text = text.replace(/from ['"]\.\/imageColumns['"]/g, "from '@ioai/lerobot-studio-core'");
    text = text.replace(/from ['"]\.\.\/utils\/MediaCache['"]/g, "from '../utils/MediaCache'");
    text = text.replace(
      /from ['"]\.\.\/workers\/workerManager['"]/g,
      "from '../workers/workerManager'",
    );
    text = text.replace(/from ['"]\.\.\/workers\/types['"]/g, "from '@ioai/lerobot-studio-core'");
    text = text.replace(/from ['"]\.\/versioning['"]/g, "from '@ioai/lerobot-studio-core'");
    text = text.replace(/from ['"]\.\/dataSources['"]/g, "from './dataSources'");
    // LeRobotDataLoader numerical types from core
    if (rel.endsWith('LeRobotDataLoader.ts')) {
      text = text.replace(
        /export interface NumericalColumnData \{[\s\S]*?export type NumericalColumnMap = Record<string, NumericalColumnData>;\n/,
        `import type { NumericalColumnData, NumericalColumnMap } from '@ioai/lerobot-studio-core';\nexport type { NumericalColumnData, NumericalColumnMap };\n`,
      );
      text = text.replace(/from ['"]\.\.\/types\/lerobot['"]/g, "from '@ioai/lerobot-studio-core'");
      text = text.replace(/from ['"]\.\/dataSources['"]/g, "from '../datasource/dataSources'");
      text = text.replace(/from ['"]\.\/versioning['"]/g, "from '@ioai/lerobot-studio-core'");
      text = text.replace(/from ['"]\.\.\/utils\/MediaCache['"]/g, "from '../utils/MediaCache'");
      text = text.replace(
        /from ['"]\.\.\/workers\/workerManager['"]/g,
        "from '../workers/workerManager'",
      );
      text = text.replace(/from ['"]\.\.\/workers\/types['"]/g, "from '@ioai/lerobot-studio-core'");
    }
  }

  // Tests
  if (inTests) {
    text = text.replace(/from ['"]\.\.\/src\/([^'"]+)['"]/g, (m, p1) => {
      const map = {
        'services/dataSources': '@ioai/lerobot-studio-platform',
        'services/LeRobotDataLoader': '@ioai/lerobot-studio-platform',
        'services/ArchiveDataSourceFactory': '@ioai/lerobot-studio-platform',
        'services/ParquetImageService': '@ioai/lerobot-studio-platform',
        'services/SourceController': '../apps/web/src/services/SourceController',
        'services/platformDetector': '@ioai/lerobot-studio-platform',
        'services/mediaCopy': '@ioai/lerobot-studio-platform',
        'services/remotePreflight': '@ioai/lerobot-studio-platform',
        'services/sampleDatasets': '@ioai/lerobot-studio-platform',
        'services/RemoteManifestDataSource': '@ioai/lerobot-studio-platform',
        'utils/MediaCache': '@ioai/lerobot-studio-platform',
        'utils/handleStore': '@ioai/lerobot-studio-platform',
        'utils/fsPermissions': '@ioai/lerobot-studio-platform',
        'utils/sourceUrl': '../apps/web/src/utils/sourceUrl',
        'utils/featureUtils': '@ioai/lerobot-studio-core',
        'utils/mediaFeatureMetadata': '@ioai/lerobot-studio-core',
        'utils/historyNavigation': '@ioai/lerobot-studio-react/utils/historyNavigation',
        'types/lerobot': '@ioai/lerobot-studio-core',
        'contexts/episodeLoadPlan': '@ioai/lerobot-studio-core',
        'workers/imageColumns': '@ioai/lerobot-studio-core',
        'workers/types': '@ioai/lerobot-studio-core',
      };
      for (const [k, v] of Object.entries(map)) {
        if (p1 === k || p1.startsWith(k + '/')) return `from '${v}'`;
      }
      if (p1.startsWith('services/export')) return "from '@ioai/lerobot-studio-platform'";
      if (p1.startsWith('services/versioning')) return "from '@ioai/lerobot-studio-core'";
      if (p1.startsWith('services/analysis')) return "from '@ioai/lerobot-studio-core'";
      if (p1.startsWith('components/'))
        return `from '@ioai/lerobot-studio/${p1.slice('components/'.length)}'`;
      return m;
    });
  }

  if (text !== orig) {
    writeFileSync(file, text);
    return true;
  }
  return false;
}

const roots = ['packages', 'apps/web', 'tests'].map((d) => join(ROOT, d));
let changed = 0;
for (const root of roots) {
  try {
    for (const file of walk(root)) {
      if (rewriteFile(file)) {
        changed++;
        console.log('rewrote', relative(ROOT, file));
      }
    }
  } catch (e) {
    console.warn('skip', root, e.message);
  }
}
console.log('changed files:', changed);
