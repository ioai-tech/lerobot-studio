import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/ui/globals.css', import.meta.url), 'utf8');

function chartColors(themeSelector: ':root' | '.dark'): string[] {
  const selector = themeSelector.replace('.', '\\.');
  const block = css.match(new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '';
  return Array.from(block.matchAll(/--chart-[1-5]:\s*(oklch\([^)]+\))/g), ([, color]) => color);
}

describe('chart theme palette', () => {
  it.each([':root', '.dark'] as const)('%s uses five chromatic series colors', (themeSelector) => {
    const colors = chartColors(themeSelector);

    expect(colors).toHaveLength(5);
    expect(new Set(colors)).toHaveLength(5);
    for (const color of colors) {
      expect(color).toMatch(/^oklch\(\d+(?:\.\d+)?\s+0\.\d+\s+\d+\)$/);
    }
  });
});
