import { describe, expect, it } from 'vitest';
// @ts-expect-error: plain ESM script without type declarations
import { htmlAssetPaths, initialScriptReferences } from '../scripts/check-bundle-size.mjs';

// The head Vite writes for the web app: the entry is a module script and is
// also listed as a modulepreload.
const VITE_INDEX = `<!doctype html><html><head>
<script type="application/ld+json" id="seo-jsonld-app">{"@context":"https://schema.org"}</script>
<script type="module" crossorigin src="/assets/index-UUovXWEg.js"></script>
<link rel="modulepreload" crossorigin href="/assets/rolldown-runtime-B0Z9INg1.js">
<link rel="modulepreload" crossorigin href="/assets/vendor-CTRz_hBz.js">
<link rel="modulepreload" crossorigin href="/assets/index-UUovXWEg.js">
<link rel="stylesheet" crossorigin href="/assets/index-BMOXp5KZ.css">
</head><body></body></html>`;

describe('check-bundle-size initial JS', () => {
  it('counts the entry once although it is both the module script and a modulepreload', () => {
    const references = initialScriptReferences(VITE_INDEX) as string[];
    expect(references).toEqual([
      '/assets/index-UUovXWEg.js',
      '/assets/rolldown-runtime-B0Z9INg1.js',
      '/assets/vendor-CTRz_hBz.js',
    ]);
    expect(references.filter((reference) => reference.includes('index-'))).toHaveLength(1);
  });

  it('keeps stylesheets and inline scripts out of the JS list', () => {
    expect(initialScriptReferences(VITE_INDEX)).not.toContain('/assets/index-BMOXp5KZ.css');
    expect(htmlAssetPaths(VITE_INDEX, 'stylesheet')).toEqual(['/assets/index-BMOXp5KZ.css']);
  });
});
