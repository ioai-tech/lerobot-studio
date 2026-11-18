import { describe, expect, it } from 'vitest';
// @ts-expect-error: plain ESM script without type declarations
import { evaluateAudit, readWaivers } from '../scripts/check-audit.mjs';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PICO = 'GHSA-fc5q-39xc-vjpf';
const OTHER = 'GHSA-aaaa-bbbb-cccc';
const advisory = (id: string, title = 'issue') => ({
  title,
  url: `https://github.com/advisories/${id}`,
  severity: 'high',
});
const node = (severity: string, via: unknown[]) => ({
  severity,
  range: '*',
  via,
  fixAvailable: false,
});

function policy(rows: string) {
  return `# Security\n\n## Dependency vulnerabilities\n\n| Advisory | Scope | Reason | Remove when |\n| --- | --- | --- | --- |\n${rows}\n\n## Scope\n\nGHSA-zzzz-zzzz-zzzz outside the section is ignored.\n`;
}

describe('check-audit gate', () => {
  it('reads waivers from the table in the section, with scope and reason', () => {
    const waivers = readWaivers(policy(`| ${PICO} (picomatch) | toolchain | no fix | patched |`));
    expect([...waivers.keys()]).toEqual([PICO]);
    expect(waivers.get(PICO)).toEqual({ scope: 'toolchain', reason: 'no fix' });
    expect(() => readWaivers(policy(`| ${PICO} |  | no fix | x |`))).toThrow(/scope and a reason/);
    expect(() => readWaivers('# none')).toThrow(/section not found/);
  });

  it('the repository policy waives picomatch', () => {
    const md = readFileSync(path.resolve(__dirname, '../SECURITY.md'), 'utf8');
    expect(readWaivers(md).has(PICO)).toBe(true);
  });

  it('a waived advisory and the packages reached only through it pass', () => {
    const report = {
      vulnerabilities: {
        picomatch: node('high', [advisory(PICO)]),
        tinyglobby: node('high', ['picomatch']),
        vite: node('high', ['tinyglobby', 'picomatch']),
      },
    };
    const result = evaluateAudit(report, new Set([PICO]));
    expect(result.rows.map((row: { waived: boolean }) => row.waived)).toEqual([true, true, true]);
    expect(result.failing).toEqual([]);
    expect(result.staleWaivers).toEqual([]);
  });

  it('an unwaived high advisory fails, also when reached through a waived one', () => {
    const report = {
      vulnerabilities: {
        picomatch: node('high', [advisory(PICO)]),
        zod: node('high', [advisory(OTHER)]),
        vite: node('high', ['picomatch', 'zod']),
        minimatch: node('moderate', [advisory('GHSA-mmmm-mmmm-mmmm')]),
      },
    };
    const result = evaluateAudit(report, new Set([PICO]));
    expect(result.failing.map((row: { name: string }) => row.name).sort()).toEqual(['vite', 'zod']);
    // Moderate findings never block.
    expect(result.rows.some((row: { name: string }) => row.name === 'minimatch')).toBe(false);
  });

  it('moderate advisories along a chain never block; ids match in any case', () => {
    const result = evaluateAudit(
      {
        vulnerabilities: {
          picomatch: node('high', [advisory(PICO)]),
          mocker: node('moderate', [{ ...advisory(OTHER), severity: 'moderate' }]),
          vitest: node('high', ['picomatch', 'mocker']),
        },
      },
      new Set([PICO.toUpperCase()]),
    );
    expect(result.failing).toEqual([]);
  });

  it('a cycle is waived only when every advisory in it is waived', () => {
    const cycle = (otherId: string) => ({
      vulnerabilities: {
        a: node('high', ['b', advisory(PICO)]),
        b: node('high', ['c']),
        c: node('high', ['a', advisory(otherId)]),
      },
    });
    const both = evaluateAudit(cycle(OTHER), new Set([PICO, OTHER]));
    expect(both.failing).toEqual([]);
    const one = evaluateAudit(cycle(OTHER), new Set([PICO]));
    expect(one.failing.map((row: { name: string }) => row.name).sort()).toEqual(['a', 'b', 'c']);
    // A cycle with no advisory at all cannot be judged: it blocks.
    const empty = evaluateAudit(
      { vulnerabilities: { a: node('high', ['b']), b: node('high', ['a']) } },
      new Set([PICO]),
    );
    expect(empty.failing).toHaveLength(2);
  });

  it('a via naming an unknown package blocks; a waiver matching nothing is reported stale', () => {
    const result = evaluateAudit(
      { vulnerabilities: { a: node('critical', ['missing']) } },
      new Set([PICO]),
    );
    expect(result.failing).toHaveLength(1);
    expect(result.staleWaivers).toEqual([PICO]);
  });
});
