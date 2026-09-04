import { describe, expect, it } from 'vitest';
import { scopeCssForTests } from '../scripts/vite/cssScopePlugin';

describe('cssScopePlugin portal token handling', () => {
  it('binds :root and .dark tokens onto .lerobot-root while scoping utility selectors', () => {
    const input = `
:root { --background: oklch(1 0 0); --chart-1: oklch(0.61 0.2 255); }
.dark { --background: oklch(0.145 0 0); }
.bg-background { background-color: var(--background); }
.bg-popover { background-color: var(--popover); }
    `;
    const out = scopeCssForTests(input);
    expect(out).toMatch(/:root\s*,\s*\.lerobot-root\s*\{/);
    expect(out).toMatch(/\.dark\s*,\s*\.lerobot-root\.dark\s*\{/);
    expect(out).toContain('--chart-1:');
    expect(out).toContain('.lerobot-root .bg-background');
    expect(out).toContain('.lerobot-root .bg-popover');
    expect(out).not.toContain('.lerobot-root:root');
    expect(out).not.toContain('.lerobot-root .dark');
  });
});
