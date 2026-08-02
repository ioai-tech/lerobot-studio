import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outputRoot = process.argv[2] ? path.resolve(process.argv[2]) : null;

if (!outputRoot) {
  throw new Error('Usage: node rewrite-declaration-imports.mjs <package-output-directory>');
}

const targets = {
  core: path.join(outputRoot, 'types/core/src/index.js'),
  platform: path.join(outputRoot, 'types/platform/src/index.js'),
  ui: path.join(outputRoot, 'types/ui/src/index.js'),
};

async function declarationFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return declarationFiles(entryPath);
      return entry.name.endsWith('.d.ts') ? [entryPath] : [];
    }),
  );
  return nested.flat();
}

for (const filePath of await declarationFiles(outputRoot)) {
  const source = await readFile(filePath, 'utf8');
  const rewritten = source.replace(
    /(['"])(?:@ioai\/lerobot-studio-|(?:\.\.\/)+(?:packages\/)?)(core|platform|ui)(?:\/src)?\1/g,
    (_, quote, packageName) => {
      const target = targets[packageName];
      let relative = path.relative(path.dirname(filePath), target).replaceAll(path.sep, '/');
      if (!relative.startsWith('.')) relative = `./${relative}`;
      return `${quote}${relative}${quote}`;
    },
  );
  if (rewritten !== source) await writeFile(filePath, rewritten);
}
