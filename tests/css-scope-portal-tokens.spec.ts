import { describe, expect, it } from 'vitest';
import { scopeCssForTests } from '../vite/cssScopePlugin';

describe('cssScopePlugin portal token handling', () => {
  it('keeps :root and .dark global while scoping each viewer by root class', () => {
    const input = `
:root { --background: oklch(1 0 0); }
.dark { --background: oklch(0.145 0 0); }
.bg-background { background-color: var(--background); }
.bg-popover { background-color: var(--popover); }
    `;
    const out = scopeCssForTests(input);
    expect(out).toContain(':root');
    expect(out).toMatch(/\.dark\s*\{/);
    expect(out).toContain('.lerobot-root .bg-background');
    expect(out).toContain('.lerobot-root .bg-popover');
    expect(out).not.toContain('.lerobot-root:root');
    expect(out).not.toContain('.lerobot-root .dark');
  });
});
