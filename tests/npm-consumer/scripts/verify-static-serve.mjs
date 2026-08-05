import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const [viteDistArg, nextDistArg] = process.argv.slice(2);
if (!viteDistArg || !nextDistArg) {
  console.error('Usage: node verify-static-serve.mjs <vite-dist> <next-dist>');
  process.exit(1);
}

const viteDist = path.resolve(viteDistArg);
const nextDist = path.resolve(nextDistArg);
const mountPath = '/arbitrary/npm-consumer/';

async function collectFiles(directory) {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...(await collectFiles(filePath)));
    else results.push(filePath);
  }
  return results;
}

async function serve(directory, mount) {
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
      const normalizedMount = `/${mount.replace(/^\/+|\/+$/g, '')}/`;
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
  if (!address || typeof address === 'string') throw new Error('Failed to start static server');
  return {
    baseUrl: `http://127.0.0.1:${address.port}${mount.replace(/\/?$/, '/')}`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

function extractAssetUrls(html, baseUrl) {
  const urls = new Set();
  for (const match of html.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)) {
    const value = match[1];
    if (value.startsWith('data:') || value.startsWith('http')) continue;
    urls.add(new URL(value, baseUrl).href);
  }
  return [...urls];
}

async function verifyViteStaticServe() {
  const files = await collectFiles(viteDist);
  const indexPath = path.join(viteDist, 'index.html');
  if (!files.includes(indexPath)) throw new Error('Vite dist is missing index.html');

  const hasJavaScript = files.some((file) => file.endsWith('.js'));
  const hasCss = files.some((file) => file.endsWith('.css'));
  if (!hasJavaScript || !hasCss) {
    throw new Error('Vite dist is missing built JavaScript or CSS artifacts');
  }

  const server = await serve(viteDist, mountPath);
  try {
    const indexResponse = await fetch(`${server.baseUrl}index.html`);
    if (!indexResponse.ok) {
      throw new Error(`index.html returned ${indexResponse.status} under mount path`);
    }
    const html = await indexResponse.text();
    if (!html.includes('root')) throw new Error('index.html does not contain the app mount node');

    const assetUrls = extractAssetUrls(html, server.baseUrl);
    if (assetUrls.length === 0) throw new Error('index.html references no static assets');

    const failures = [];
    for (const assetUrl of assetUrls) {
      const response = await fetch(assetUrl);
      if (!response.ok) failures.push(`${assetUrl} -> ${response.status}`);
    }
    if (failures.length) {
      throw new Error(`Static asset fetch failures: ${failures.join(', ')}`);
    }

    const bundledJavaScript = (
      await Promise.all(
        files.filter((file) => file.endsWith('.js')).map((file) => readFile(file, 'utf8')),
      )
    ).join('\n');
    if (/new Worker\s*\(\s*["'`]\/assets\//i.test(bundledJavaScript)) {
      throw new Error('Vite consumer bundle regressed to an absolute /assets worker URL');
    }
  } finally {
    await server.close();
  }
}

async function verifyNextBuildOutput() {
  const buildIdPath = path.join(nextDist, 'BUILD_ID');
  const staticDir = path.join(nextDist, 'static');
  try {
    await stat(buildIdPath);
  } catch {
    throw new Error('Next consumer build is missing .next/BUILD_ID');
  }
  try {
    const staticStat = await stat(staticDir);
    if (!staticStat.isDirectory()) throw new Error('Missing .next/static directory');
  } catch {
    throw new Error('Next consumer build is missing .next/static');
  }

  const staticFiles = await collectFiles(staticDir);
  const hasJs = staticFiles.some((file) => file.endsWith('.js'));
  if (!hasJs) throw new Error('Next consumer build produced no static JavaScript chunks');
}

await verifyViteStaticServe();
await verifyNextBuildOutput();
console.log('npm consumer Docker test: Vite static serve and Next build artifacts verified');
