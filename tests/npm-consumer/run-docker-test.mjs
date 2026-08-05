import { execFile, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, '../..');
const consumerDir = path.join(root, 'tests/npm-consumer');
const dockerfile = path.join(consumerDir, 'Dockerfile');

function dockerAvailable() {
  const result = spawnSync('docker', ['info'], { stdio: 'ignore' });
  return result.status === 0;
}

function assertDockerfileSyntax() {
  const dockerfileContents = readFileSync(dockerfile, 'utf8');
  if (
    !/^FROM node:24-bookworm-slim(?:@sha256:[a-f0-9]{64})? AS pack-builder$/m.test(
      dockerfileContents,
    )
  ) {
    throw new Error('npm-consumer Dockerfile is missing the pack-builder stage');
  }
  if (!/^FROM node:24-bookworm-slim(?:@sha256:[a-f0-9]{64})? AS test$/m.test(dockerfileContents)) {
    throw new Error('npm-consumer Dockerfile is missing the test stage');
  }
  if (!dockerfileContents.includes('--from=lerobot')) {
    throw new Error('npm-consumer Dockerfile must copy the repo via the lerobot build context');
  }
}

async function runDockerBuild() {
  await execFileAsync(
    'docker',
    [
      'build',
      '--build-context',
      `lerobot=${root}`,
      '-f',
      dockerfile,
      '--target',
      'test',
      consumerDir,
    ],
    { cwd: root, maxBuffer: 20 * 1024 * 1024 },
  );
}

async function fallbackWithoutDocker() {
  assertDockerfileSyntax();
  console.warn(
    'Docker is unavailable; validating Dockerfile structure and running verify:npm-consumer',
  );
  await execFileAsync('npm', ['run', 'verify:npm-consumer'], {
    cwd: root,
    maxBuffer: 20 * 1024 * 1024,
  });
}

try {
  if (dockerAvailable()) {
    await runDockerBuild();
    console.log('npm consumer Docker image passed build --target test');
  } else {
    await fallbackWithoutDocker();
  }
} catch (error) {
  const details = [error.stdout, error.stderr].filter(Boolean).join('\n');
  throw new Error(details || error.message, { cause: error });
}
