#!/usr/bin/env node
/**
 * Dependency audit gate: the CI wrapper around `npm audit`.
 *
 * Usage: node scripts/check-audit.mjs   (or: npm run check:audit)
 *
 * Fails on high/critical advisories unless the advisory id (GHSA-…) is waived
 * in the "Dependency vulnerabilities" table of SECURITY.md, with its scope and
 * reason. A vulnerable package is waived only when every advisory it can reach
 * through npm's `via` graph is waived, so a dependency cycle counts as waived
 * only when every advisory in the cycle is waived. Waivers are toolchain-only:
 * a waived advisory that appears in `npm audit --omit=dev` fails the gate.
 * Any failed or incomplete npm audit run fails the gate. Ported from rosview's gate,
 * which could not resolve cycles.
 *
 * This replaces `npm audit --audit-level=high`, which cannot express "this
 * advisory has no fix yet" and so stays red, hiding every later finding.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const WAIVER_SECTION = '## Dependency vulnerabilities';

/** Severities that never fail the gate; anything else (high, critical, unknown, missing) blocks. */
const NON_BLOCKING = new Set(['info', 'low', 'moderate']);
const blocking = (severity) => !NON_BLOCKING.has(severity);

const GHSA = /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i;

/** Canonical GHSA id: `GHSA-` plus the lowercase rest, as GitHub prints it. */
function canonical(id) {
  return `GHSA-${id.slice(5).toLowerCase()}`;
}

/**
 * Waivers from the SECURITY.md section: table rows whose first cell names a
 * GHSA id. Each row must give the scope and the reason (non-empty cells).
 * @param {string} markdown
 * @returns {Map<string, { scope: string, reason: string }>}
 */
export function readWaivers(markdown) {
  const start = markdown.indexOf(WAIVER_SECTION);
  if (start === -1) throw new Error(`"${WAIVER_SECTION}" section not found in SECURITY.md`);
  const end = markdown.indexOf('\n## ', start + WAIVER_SECTION.length);
  const section = markdown.slice(start, end === -1 ? undefined : end);
  const waivers = new Map();
  for (const line of section.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((cell) => cell.trim());
    const match = cells[0]?.match(GHSA)?.[0];
    const id = match ? canonical(match) : null;
    if (!id) continue;
    const [, scope = '', reason = ''] = cells;
    if (!scope || !reason) {
      throw new Error(`Waiver ${id} in SECURITY.md needs a scope and a reason`);
    }
    waivers.set(id, { scope, reason });
  }
  return waivers;
}

/** GHSA id of a `via` advisory object, or null. */
function advisoryId(entry) {
  const match = String(entry?.url ?? '').match(GHSA)?.[0];
  return match ? canonical(match) : null;
}

/**
 * Advisories reachable from `name` through `via` (cycles included), or null
 * when a `via` names a package missing from the report (cannot be judged).
 */
function reachableAdvisories(vulnerabilities, name) {
  const advisories = [];
  const seen = new Set();
  const stack = [name];
  while (stack.length > 0) {
    const current = stack.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    const node = vulnerabilities[current];
    if (!node) return null;
    for (const entry of node.via ?? []) {
      if (typeof entry === 'string') stack.push(entry);
      else advisories.push(entry);
    }
  }
  return advisories;
}

/**
 * Judge an `npm audit --json` report against the waivers.
 * @param {{ vulnerabilities?: Record<string, any> }} report
 * @param {Map<string, unknown> | Set<string>} waivers
 */
export function evaluateAudit(report, waivers) {
  const waived = new Set([...waivers.keys()].map(canonical));
  const vulnerabilities = report.vulnerabilities ?? {};
  const names = Object.keys(vulnerabilities);
  const rows = names
    .filter((name) => blocking(vulnerabilities[name].severity))
    .map((name) => {
      const node = vulnerabilities[name];
      const reachable = reachableAdvisories(vulnerabilities, name);
      // Moderate / low advisories along the chain never block. Waived means it
      // reaches at least one blocking advisory and every one of them is waived.
      const blockingAdvisories = (reachable ?? []).filter((entry) => blocking(entry.severity));
      const isWaived =
        reachable !== null &&
        blockingAdvisories.length > 0 &&
        blockingAdvisories.every((entry) => {
          const id = advisoryId(entry);
          return id !== null && waived.has(id);
        });
      return {
        name,
        severity: node.severity,
        range: node.range,
        advisories: (node.via ?? [])
          .filter((entry) => typeof entry === 'object')
          .map((entry) => ({ id: advisoryId(entry), title: entry.title, url: entry.url })),
        fixAvailable: node.fixAvailable,
        waived: isWaived,
      };
    });
  const used = new Set(
    names
      .flatMap((name) => vulnerabilities[name].via ?? [])
      .filter((entry) => typeof entry === 'object')
      .map(advisoryId)
      .filter(Boolean),
  );
  return {
    total: names.length,
    rows,
    failing: rows.filter((row) => !row.waived),
    staleWaivers: [...waived].filter((id) => !used.has(id)),
  };
}

/**
 * Parse `npm audit --json` output and refuse anything that is not a complete
 * report: npm prints `{ "error": … }` (registry unreachable, bad lockfile) and
 * exits 1, which must fail the gate, never pass it.
 * @param {string | undefined} stdout
 */
export function parseAuditReport(stdout) {
  if (!stdout || !stdout.trim()) throw new Error('npm audit printed no report');
  let report;
  try {
    report = JSON.parse(stdout);
  } catch {
    throw new Error('npm audit printed output that is not JSON');
  }
  if (report?.error) {
    const { code, summary } = report.error;
    throw new Error(`npm audit failed: ${[code, summary].filter(Boolean).join(': ') || 'error'}`);
  }
  if (
    !report?.vulnerabilities ||
    typeof report.vulnerabilities !== 'object' ||
    Array.isArray(report.vulnerabilities)
  ) {
    throw new Error('npm audit report has no vulnerability data');
  }
  return report;
}

/**
 * Waived advisory ids that appear in the production graph (`npm audit
 * --omit=dev`). A waiver covers toolchain-only findings; one that reaches
 * what ships must fail the gate.
 * @param {{ vulnerabilities?: Record<string, any> }} productionReport
 * @param {Map<string, unknown> | Set<string>} waivers
 */
export function waivedInProduction(productionReport, waivers) {
  const waived = new Set([...waivers.keys()].map(canonical));
  const ids = new Set(
    Object.values(productionReport.vulnerabilities ?? {})
      .flatMap((node) => node.via ?? [])
      .filter((entry) => typeof entry === 'object')
      .map(advisoryId)
      .filter((id) => id !== null && waived.has(id)),
  );
  return [...ids];
}

function runAudit(extraArgs = []) {
  let stdout;
  try {
    stdout = execFileSync('npm', ['audit', '--json', ...extraArgs], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    // npm exits non-zero when it finds anything, and when it fails; the
    // report (or the error object) is on stdout either way.
    stdout = error.stdout;
  }
  return parseAuditReport(stdout);
}

function main() {
  let result;
  try {
    // CHECK_AUDIT_POLICY: another policy file, for the gate's own tests.
    const policyPath = process.env.CHECK_AUDIT_POLICY || path.join(ROOT, 'SECURITY.md');
    const waivers = readWaivers(readFileSync(policyPath, 'utf8'));
    result = evaluateAudit(runAudit(), waivers);
    // Waivers are toolchain-only: none may appear in what ships.
    result.inProduction = waivedInProduction(runAudit(['--omit=dev']), waivers);
  } catch (error) {
    console.error(`check:audit cannot judge the dependencies: ${error.message}`);
    process.exit(1);
  }
  console.log(
    `npm audit: ${result.total} vulnerable packages, ${result.rows.length} at blocking level`,
  );
  for (const row of result.rows) {
    console.log(
      `\n${row.waived ? 'WAIVED' : 'BLOCKING'}  ${row.name}@${row.range} (${row.severity})`,
    );
    for (const advisory of row.advisories) {
      console.log(`  ${advisory.id ?? advisory.url}  ${advisory.title}`);
    }
  }
  // A stale waiver hides future findings under an id that matches nothing.
  for (const id of result.staleWaivers) {
    console.warn(`\nwarning: waiver ${id} in SECURITY.md matches no advisory; remove it`);
  }
  for (const id of result.inProduction) {
    console.error(
      `\nBLOCKING  waiver ${id} is reachable from production dependencies (npm audit --omit=dev); ` +
        'waivers cover the toolchain only. Fix it.',
    );
  }
  if (result.inProduction.length > 0) process.exit(1);
  if (result.failing.length > 0) {
    console.error(
      `\n${result.failing.length} blocking advisories. Fix them (upgrade or a narrow override), ` +
        `or waive them in SECURITY.md "${WAIVER_SECTION}" when no non-breaking fix exists.`,
    );
    process.exit(1);
  }
  console.log('\nok: no blocking advisories.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
