import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, '..');
const packageDir = root;
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'lerobot-studio-consumer-'));

try {
  const { stdout } = await execFileAsync('npm', ['pack', '--json', '--pack-destination', tempDir], {
    cwd: packageDir,
  });
  const [{ filename }] = JSON.parse(stdout);
  const tarball = path.join(tempDir, filename);

  await writeFile(
    path.join(tempDir, 'package.json'),
    JSON.stringify({ private: true, type: 'module' }, null, 2),
  );
  await execFileAsync(
    'npm',
    ['install', '--ignore-scripts', tarball, 'typescript', '@types/react', '@types/react-dom'],
    { cwd: tempDir, maxBuffer: 10 * 1024 * 1024 },
  );
  await writeFile(
    path.join(tempDir, 'index.ts'),
    [
      "import { DirectoryDataSource, LeRobotStudioProvider } from '@ioai/lerobot-studio';",
      "import type { DataSource, EpisodeMetadata } from '@ioai/lerobot-studio';",
      'const source: DataSource | null = null;',
      'const episodes: EpisodeMetadata[] = [];',
      'void source;',
      'void episodes;',
      'void DirectoryDataSource;',
      'void LeRobotStudioProvider;',
      '',
    ].join('\n'),
  );
  await writeFile(
    path.join(tempDir, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          module: 'ESNext',
          moduleResolution: 'bundler',
          target: 'ES2022',
          strict: true,
          skipLibCheck: false,
          noEmit: true,
        },
        include: ['index.ts'],
      },
      null,
      2,
    ),
  );
  await execFileAsync('npx', ['tsc', '--project', 'tsconfig.json'], { cwd: tempDir });
  console.log('npm consumer typecheck passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
