import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import net from 'node:net';
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
// A real LeRobot v3 dataset the consumers open: their charts are decoded from
// its Parquet by the package's workers, so a WASM that does not load fails.
const fixtureDataset = path.join(root, 'tests/fixtures/datasets/lerobotv3');
const NEXT_BASE_PATH = '/sub/path';
// The packaged parquet WASM: one hashed file, never inlined.
const PACKED_WASM = /^dist-lib\/assets\/parquet_wasm_bg-[\w-]{6,}\.wasm$/;
// Base64 of a WASM module ("\0asm..."): a payload inlined into JavaScript.
const INLINE_WASM = /AGFzbQ[A-Za-z0-9+/=]{200,}/;

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

/** Copy the dataset the consumers open, and a self-hosted copy of the WASM, into a static root. */
async function addConsumerFiles(staticRoot, packedWasmPath) {
  await cp(fixtureDataset, path.join(staticRoot, 'dataset'), { recursive: true });
  await cp(
    path.join(packageDir, packedWasmPath),
    path.join(staticRoot, 'self-hosted/parquet.wasm'),
  );
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function startNext(nextBin, cwd, env) {
  const port = await freePort();
  const child = spawn(process.execPath, [nextBin, 'start', '-p', String(port), '-H', '127.0.0.1'], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 120_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`next start exited\n${output}`);
    const ready = await fetch(`${url}${env.NEXT_BASE_PATH}`).then(
      (response) => response.ok,
      () => false,
    );
    if (ready) break;
    if (Date.now() > deadline) {
      child.kill();
      throw new Error(`next start did not answer within 120 s\n${output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return {
    url,
    close: () =>
      new Promise((resolve) => {
        child.once('exit', resolve);
        child.kill();
      }),
  };
}

/**
 * Open a consumer page in a fresh browser context and check that the dataset
 * opens (a chart drawn from Parquet the workers decoded), that the WASM came
 * from exactly the expected URL as one `application/wasm` download, and that
 * the page itself compiled no WebAssembly.
 */
async function openConsumer(browser, url, { label, wasmPath }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => {
    window.__PAGE_WASM_CALLS__ = 0;
    for (const name of ['compile', 'compileStreaming', 'instantiate', 'instantiateStreaming']) {
      const original = WebAssembly[name];
      WebAssembly[name] = function (...args) {
        window.__PAGE_WASM_CALLS__ += 1;
        return original.apply(this, args);
      };
    }
  });
  const page = await context.newPage();
  const wasmResponses = [];
  const failures = [];
  const pageErrors = [];
  page.on('response', (response) => {
    const responseUrl = response.url();
    if (responseUrl.startsWith('data:')) {
      if (/^data:application\/wasm/i.test(responseUrl)) wasmResponses.push({ url: 'data:' });
      return;
    }
    if (response.status() >= 400) failures.push(`${response.status()} ${responseUrl}`);
    if (new URL(responseUrl).pathname.endsWith('.wasm')) {
      wasmResponses.push({
        pathname: new URL(responseUrl).pathname,
        status: response.status(),
        type: response.headers()['content-type'],
      });
    }
  });
  page.on('requestfailed', (request) => {
    const errorText = request.failure()?.errorText ?? 'failed';
    // A video element cancels its own reads as it seeks; that is not a failure.
    if (request.resourceType() === 'media' && errorText === 'net::ERR_ABORTED') return;
    failures.push(`${request.url()}: ${errorText}`);
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await page.goto(url);
    try {
      await page.locator('.uplot canvas').first().waitFor({ timeout: 60_000 });
    } catch (error) {
      throw new Error(
        `${label}: no chart drawn from the dataset: ${JSON.stringify({
          url,
          wasmResponses,
          failures,
          pageErrors,
          text: (await page.locator('body').innerText()).slice(0, 400),
        })}`,
        { cause: error },
      );
    }
    const state = await page.evaluate(() => ({
      pageWasmCalls: window.__PAGE_WASM_CALLS__,
      marker: window.__LEROBOT_CONSUMER__,
      cssLoaded: Array.from(document.styleSheets).some((sheet) => {
        try {
          return (sheet.cssRules?.length ?? 0) > 0;
        } catch {
          return false;
        }
      }),
    }));
    const problems = [];
    if (state.pageWasmCalls !== 0) {
      problems.push(`the page compiled WebAssembly ${state.pageWasmCalls} time(s)`);
    }
    if (
      wasmResponses.length !== 1 ||
      !wasmPath(wasmResponses[0].pathname ?? '') ||
      wasmResponses[0].status !== 200 ||
      !/^application\/wasm\b/.test(wasmResponses[0].type ?? '')
    ) {
      problems.push(`expected one application/wasm download from the expected URL`);
    }
    if (failures.length) problems.push(`resource failures`);
    if (pageErrors.length) problems.push(`page errors`);
    if (problems.length) {
      throw new Error(
        `${label}: ${problems.join('; ')}: ${JSON.stringify({ url, wasmResponses, failures, pageErrors })}`,
      );
    }
    return state;
  } finally {
    await context.close();
  }
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
    '.json': 'application/json',
    '.map': 'application/json',
    '.mp4': 'video/mp4',
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
      const body = await readFile(filePath);
      // Byte ranges, as any static host serves them (the video panels seek).
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '');
      if (range) {
        const start = Number(range[1]);
        const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
        response.writeHead(206, {
          'content-range': `bytes ${start}-${end}/${body.length}`,
          'accept-ranges': 'bytes',
        });
        response.end(body.subarray(start, end + 1));
        return;
      }
      response.setHeader('accept-ranges', 'bytes');
      response.end(body);
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
  const wasmPaths = files.filter((file) => PACKED_WASM.test(file.path));
  if (wasmPaths.length !== 1) {
    throw new Error(
      `npm package must contain exactly one hashed dist-lib/assets/parquet_wasm_bg-<hash>.wasm; found ${wasmPaths.map((file) => file.path).join(', ') || 'none'}`,
    );
  }
  const wasmChunks = files.filter((file) => /^dist-lib\/wasmUrl-.*\.js$/.test(file.path));
  if (wasmChunks.length) {
    throw new Error(`npm package regressed to a WASM data: URL chunk: ${wasmChunks[0].path}`);
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
  if (INLINE_WASM.test(packedJavaScript)) {
    throw new Error('npm package JavaScript contains an inline (base64) WASM payload');
  }
  // Bundlers (Vite, webpack, Turbopack, Rollup) rewrite exactly this form.
  const wasmFileName = path.posix.basename(wasmPaths[0].path);
  const wasmReferences = packedJavaScript.match(
    /new URL\(\s*["'`]assets\/parquet_wasm_bg-[\w-]+\.wasm["'`]\s*,\s*import\.meta\.url\s*\)/g,
  );
  if (wasmReferences?.length !== 1 || !wasmReferences[0].includes(wasmFileName)) {
    throw new Error(
      `npm package must reference ${wasmFileName} once as new URL("assets/…", import.meta.url); found ${JSON.stringify(wasmReferences)}`,
    );
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
  if (runNext) installPackages.push('next@^16');
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

  if (INLINE_WASM.test(builtJavaScript)) {
    throw new Error('Vite consumer build inlined the WASM into JavaScript');
  }
  const viteDist = path.join(viteExample, 'dist');
  const viteWasm = builtAssets.filter((file) => /parquet_wasm_bg[^/\\]*\.wasm$/.test(file));
  if (viteWasm.length !== 1) {
    throw new Error(
      `Vite consumer build must emit one parquet WASM file; found ${viteWasm.length}`,
    );
  }
  await addConsumerFiles(viteDist, wasmPaths[0].path);

  const consumerMount = '/arbitrary/root/npm-consumer/';
  const staticServer = await serve(viteDist, consumerMount);
  const browser = await chromium.launch({ headless: true });
  try {
    const viteUrl = `${staticServer.url}${consumerMount}`;
    const result = await openConsumer(browser, viteUrl, {
      label: 'Vite consumer',
      wasmPath: (pathname) =>
        pathname.startsWith(consumerMount) && /\/parquet_wasm_bg[^/]*\.wasm$/.test(pathname),
    });
    if (!result.marker?.workerConstructed) {
      throw new Error('Vite consumer did not construct the library Worker');
    }
    if (!result.marker?.infoRead) throw new Error('Vite consumer did not read meta/info.json');
    if (!result.cssLoaded) throw new Error('Vite consumer loaded no CSS rules');
    await openConsumer(browser, `${viteUrl}?wasm=self-hosted`, {
      label: 'Vite consumer with setParquetWasmUrl',
      wasmPath: (pathname) => pathname === `${consumerMount}self-hosted/parquet.wasm`,
    });

    if (runNext) {
      const nextExample = path.join(tempDir, 'next-app-router');
      await cp(path.join(root, 'examples/next-app-router'), nextExample, { recursive: true });
      await addConsumerFiles(path.join(nextExample, 'public'), wasmPaths[0].path);
      const nextBin = path.join(tempDir, 'node_modules/next/dist/bin/next');
      const nextEnv = {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: '1',
        NEXT_BASE_PATH,
      };
      // Turbopack (Next 16's default) with the override run, then webpack 5.
      const nextBuilds = [
        { bundler: 'Turbopack', args: ['build'], override: true },
        { bundler: 'webpack', args: ['build', '--webpack'], override: false },
      ];
      for (const build of nextBuilds) {
        await rm(path.join(nextExample, '.next'), { recursive: true, force: true });
        await run(process.execPath, [nextBin, ...build.args], { cwd: nextExample, env: nextEnv });
        const nextMedia = await collectFiles(path.join(nextExample, '.next/static'));
        const nextWasm = nextMedia.filter((file) => /parquet_wasm_bg[^/\\]*\.wasm$/.test(file));
        if (nextWasm.length !== 1) {
          throw new Error(
            `Next ${build.bundler} build must emit one parquet WASM file; found ${nextWasm.length}`,
          );
        }
        const nextServer = await startNext(nextBin, nextExample, nextEnv);
        try {
          await openConsumer(browser, `${nextServer.url}${NEXT_BASE_PATH}`, {
            label: `Next consumer (${build.bundler}: next build + next start, basePath)`,
            wasmPath: (pathname) =>
              pathname.startsWith(`${NEXT_BASE_PATH}/_next/static/`) &&
              /\/parquet_wasm_bg[^/]*\.wasm$/.test(pathname),
          });
          if (build.override) {
            await openConsumer(browser, `${nextServer.url}${NEXT_BASE_PATH}?wasm=self-hosted`, {
              label: 'Next consumer with setParquetWasmUrl',
              wasmPath: (pathname) => pathname === `${NEXT_BASE_PATH}/self-hosted/parquet.wasm`,
            });
          }
        } finally {
          await nextServer.close();
        }
      }
    } else {
      console.warn('Next App Router consumer skipped because VERIFY_NEXT_EXAMPLE=0');
    }
  } finally {
    await browser.close();
    await staticServer.close();
  }

  console.log(
    `npm tarball passed package, API, type, Vite build + browser, Worker/WASM, setParquetWasmUrl and ${
      runNext ? 'Next Turbopack and webpack build + start (basePath)' : 'no Next'
    } checks (${files.length} packed files)`,
  );
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
