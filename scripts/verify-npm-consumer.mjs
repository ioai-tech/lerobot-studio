import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { cp, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { chromium } from 'playwright';

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, '..');
const packageDir = root;
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'lerobot-studio-consumer-'));
const runNext = process.env.VERIFY_NEXT_EXAMPLE !== '0';

async function run(command, args, options = {}) {
  try {
    return await execFileAsync(command, args, {
      maxBuffer: 20 * 1024 * 1024,
      ...options,
    });
  } catch (error) {
    const details = [error.stdout, error.stderr].filter(Boolean).join('\n');
    throw new Error(`${command} ${args.join(' ')} failed\n${details}`, { cause: error });
  }
}

async function collectFiles(directory) {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...(await collectFiles(filePath)));
    else results.push(filePath);
  }
  return results;
}

function runtimeExportsFromApiReport(report) {
  return Array.from(
    report.matchAll(/^export (?:abstract )?(?:class|const|enum|function|namespace|var) ([\w$]+)/gm),
    (match) => match[1],
  ).sort();
}

async function serve(directory, mountPath = '/') {
  const contentTypes = {
    '.css': 'text/css',
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.map': 'application/json',
    '.svg': 'image/svg+xml',
    '.wasm': 'application/wasm',
  };
  const server = createServer(async (request, response) => {
    try {
      const urlPath = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
      const normalizedMount = `/${mountPath.replace(/^\/+|\/+$/g, '')}/`;
      if (!urlPath.startsWith(normalizedMount)) throw new Error('Outside mount path');
      const mountedPath = urlPath.slice(normalizedMount.length);
      const relativePath = mountedPath === '' ? 'index.html' : mountedPath;
      const filePath = path.resolve(directory, relativePath);
      if (!filePath.startsWith(`${path.resolve(directory)}${path.sep}`)) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      if (!(await stat(filePath)).isFile()) throw new Error('Not a file');
      response.setHeader(
        'content-type',
        contentTypes[path.extname(filePath)] ?? 'application/octet-stream',
      );
      response.end(await readFile(filePath));
    } catch {
      response.writeHead(404).end('Not found');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to start consumer server');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

try {
  const { stdout } = await run('npm', ['pack', '--json', '--pack-destination', tempDir], {
    cwd: packageDir,
  });
  const [{ filename, files }] = JSON.parse(stdout);
  const tarball = path.join(tempDir, filename);
  const packedPaths = new Set(files.map((file) => file.path));
  const requiredPaths = [
    'package.json',
    'README.md',
    'LICENSE',
    'NOTICE',
    'CHANGELOG.md',
    'dist-lib/lerobot.es.js',
    'dist-lib/lerobot-studio.css',
    'dist-lib/lerobot.d.ts',
  ];

  for (const requiredPath of requiredPaths) {
    if (!packedPaths.has(requiredPath)) {
      throw new Error(`npm package is missing required file: ${requiredPath}`);
    }
  }
  const workerPaths = files.filter((file) =>
    /^dist-lib\/assets\/.*\.worker-.*\.js$/.test(file.path),
  );
  if (workerPaths.length !== 2) {
    throw new Error(
      `npm package must contain two external Worker assets; found ${workerPaths.length}`,
    );
  }
  const lazyWasmPaths = files.filter((file) => /^dist-lib\/wasmUrl-.*\.js$/.test(file.path));
  if (lazyWasmPaths.length !== 1) {
    throw new Error(`npm package must contain one lazy WASM chunk; found ${lazyWasmPaths.length}`);
  }

  const forbiddenPath = files.find(
    (file) =>
      file.path.startsWith('src/') ||
      file.path.startsWith('tests/') ||
      file.path.startsWith('.github/'),
  );
  if (forbiddenPath) {
    throw new Error(`npm package contains repository-only file: ${forbiddenPath.path}`);
  }

  const packedJavaScript = (
    await Promise.all(
      files
        .filter((file) => file.path.endsWith('.js'))
        .map((file) => readFile(path.join(packageDir, file.path), 'utf8')),
    )
  ).join('\n');
  if (
    /new Worker\s*\(\s*["'`]\/assets\//i.test(packedJavaScript) ||
    /["'`]\/assets\/[^"'`]*(?:worker|wasm)[^"'`]*["'`]/i.test(packedJavaScript)
  ) {
    throw new Error('npm package contains an absolute /assets worker or WASM URL');
  }
  const packedWorkerJavaScript = (
    await Promise.all(
      files
        .filter((file) => /worker/i.test(file.path) && file.path.endsWith('.js'))
        .map((file) => readFile(path.join(packageDir, file.path), 'utf8')),
    )
  ).join('\n');
  if (/data:application\/wasm/i.test(packedWorkerJavaScript)) {
    throw new Error('npm package Worker artifacts contain an inline WASM payload');
  }

  await writeFile(
    path.join(tempDir, 'package.json'),
    JSON.stringify({ private: true, type: 'module' }, null, 2),
  );
  const installPackages = [
    tarball,
    'typescript',
    'react@^19',
    'react-dom@^19',
    '@types/react@^19',
    '@types/react-dom@^19',
    'vite',
    '@vitejs/plugin-react',
  ];
  if (runNext) installPackages.push('next');
  await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', ...installPackages], {
    cwd: tempDir,
  });
  await writeFile(
    path.join(tempDir, 'index.ts'),
    [
      "import { LeRobotViewer, createArchiveDataSourceFromFile, createArchiveDataSourceFromUrl, createRemoteManifestDataSource } from '@ioai/lerobot-studio';",
      "import type { DataSource, LeRobotViewerProps, RemoteFileEntry } from '@ioai/lerobot-studio';",
      'const source: DataSource | null = null;',
      "const props: LeRobotViewerProps = { dataSource: 'https://example.com/dataset.zip' };",
      'const files: RemoteFileEntry[] = [];',
      'void source;',
      'void props;',
      'void files;',
      'void LeRobotViewer;',
      'void createArchiveDataSourceFromFile;',
      'void createArchiveDataSourceFromUrl;',
      'void createRemoteManifestDataSource;',
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
  await run(path.join(tempDir, 'node_modules/.bin/tsc'), ['--project', 'tsconfig.json'], {
    cwd: tempDir,
  });
  const apiReport = await readFile(path.join(root, 'etc/lerobot-studio.api.md'), 'utf8');
  const expectedRuntimeExports = runtimeExportsFromApiReport(apiReport);
  await writeFile(
    path.join(tempDir, 'runtime.mjs'),
    [
      "const module = await import('@ioai/lerobot-studio');",
      `const expected = ${JSON.stringify(expectedRuntimeExports)};`,
      'const actual = Object.keys(module).sort();',
      'if (JSON.stringify(actual) !== JSON.stringify(expected)) {',
      "  throw new Error(`Runtime exports (${actual.join(', ')}) differ from API report values (${expected.join(', ')})`);",
      '}',
      '',
    ].join('\n'),
  );
  await run(process.execPath, ['runtime.mjs'], { cwd: tempDir });

  const viteExample = path.join(tempDir, 'vite-react');
  await cp(path.join(root, 'examples/vite-react'), viteExample, { recursive: true });
  await run(path.join(tempDir, 'node_modules/.bin/tsc'), ['--project', 'tsconfig.json'], {
    cwd: viteExample,
  });
  await run(path.join(tempDir, 'node_modules/.bin/vite'), ['build'], { cwd: viteExample });

  const builtAssets = await collectFiles(path.join(viteExample, 'dist'));
  const builtJavaScript = (
    await Promise.all(
      builtAssets.filter((file) => file.endsWith('.js')).map((file) => readFile(file, 'utf8')),
    )
  ).join('\n');
  if (
    /new Worker\s*\(\s*["'`]\/assets\//i.test(builtJavaScript) ||
    /["'`]\/assets\/[^"'`]*(?:worker|wasm)[^"'`]*["'`]/i.test(builtJavaScript)
  ) {
    throw new Error('Vite consumer build regressed to an absolute /assets worker or WASM URL');
  }

  const consumerMount = '/arbitrary/root/npm-consumer/';
  const staticServer = await serve(path.join(viteExample, 'dist'), consumerMount);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const badResponses = [];
    const requestFailures = [];
    const requestedResources = [];
    const pageErrors = [];
    page.on('response', (response) => {
      requestedResources.push(`${response.status()} ${response.url()}`);
      if (response.status() === 404) badResponses.push(response.url());
    });
    page.on('requestfailed', (request) => {
      requestFailures.push(`${request.url()}: ${request.failure()?.errorText ?? 'failed'}`);
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(`${staticServer.url}${consumerMount}`, { waitUntil: 'networkidle' });
    await page.locator('[data-npm-consumer-mounted="true"]').waitFor();
    try {
      await page.waitForFunction(
        () =>
          window.__LEROBOT_CONSUMER__?.infoRead === true &&
          window.__LEROBOT_CONSUMER__?.wasmFetched === true,
      );
    } catch (error) {
      const marker = await page.evaluate(() => window.__LEROBOT_CONSUMER__);
      throw new Error(
        `Chromium Worker/WASM readiness timed out: ${JSON.stringify({
          marker,
          badResponses,
          requestFailures,
          pageErrors,
          requestedResources,
          builtAssets: builtAssets.map((file) =>
            path.relative(path.join(viteExample, 'dist'), file),
          ),
        })}`,
        { cause: error },
      );
    }
    const browserResult = await page.evaluate(() => {
      const root = document.querySelector('.lerobot-root');
      const cssLoaded = Array.from(document.styleSheets).some((sheet) => {
        try {
          return (sheet.cssRules?.length ?? 0) > 0;
        } catch {
          return false;
        }
      });
      return {
        cssLoaded,
        hasViewerRoot: Boolean(root),
        marker: window.__LEROBOT_CONSUMER__,
      };
    });
    if (!browserResult.hasViewerRoot) throw new Error('Chromium did not mount LeRobotViewer');
    if (!browserResult.cssLoaded) throw new Error('Chromium loaded no consumer CSS rules');
    if (!browserResult.marker?.workerConstructed) {
      throw new Error('Chromium did not construct the library Worker');
    }
    if (!browserResult.marker?.wasmFetched) {
      throw new Error('Chromium did not fetch the library WASM asset');
    }
    if (badResponses.length || requestFailures.length) {
      throw new Error(
        `Chromium resource failures: ${[...badResponses, ...requestFailures].join(', ')}`,
      );
    }
  } finally {
    await browser.close();
    await staticServer.close();
  }

  if (runNext) {
    const nextExample = path.join(tempDir, 'next-app-router');
    await cp(path.join(root, 'examples/next-app-router'), nextExample, { recursive: true });
    await run(process.execPath, [path.join(tempDir, 'node_modules/next/dist/bin/next'), 'build'], {
      cwd: nextExample,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    });
  } else {
    console.warn('Next App Router build skipped because VERIFY_NEXT_EXAMPLE=0');
  }

  console.log(
    `npm tarball passed package, API, type, Vite build, Chromium, CSS, Worker/WASM, and ${
      runNext ? 'Next build' : 'Next static-only'
    } checks (${files.length} packed files)`,
  );
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
