import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { LeRobotViewer } from '@/components/LeRobotViewer';
import type { AnnotationDocument, AnnotationField, Segment } from '@/core';
import { FetchDataSource } from './fixtures';
import '../../src/react/index.css';

globalThis.IS_REACT_ACT_ENVIRONMENT = false;

// Committed, not generated: 360 frames at 30 fps, two frame-coded cameras.
const FRAME_CODED = '/tests/fixtures/static/frame-coded-v3';

const fields: AnnotationField[] = [
  { id: 'note', label: 'Note', kind: 'text' },
  { id: 'tags', label: 'Tags', kind: 'tags', suggestions: ['clean'] },
];

function seg(id: string, startFrame: number, endFrame: number): Segment {
  return {
    id,
    startFrame,
    endFrame,
    task: null,
    subtasks: [],
    values: {},
    review: 'to_review',
    origin: { kind: 'manual' },
  };
}

const DOC: AnnotationDocument = {
  episodes: { 0: { segments: [seg('a', 0, 179), seg('b', 180, 359)] } },
};

const CONTROLS = 'input:not([type="hidden"]), select, textarea';
const DURATION_MIN = 'input[aria-label="Minimum duration (s)"]';
const DURATION_MAX = 'input[aria-label="Maximum duration (s)"]';

/** The accessible name a screen reader announces for a form control (no placeholder). */
function accessibleName(control: HTMLElement): string {
  const labelledBy = control.getAttribute('aria-labelledby');
  if (labelledBy) {
    return labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ')
      .trim();
  }
  const ariaLabel = control.getAttribute('aria-label')?.trim();
  if (ariaLabel) return ariaLabel;
  const labels = (control as HTMLInputElement).labels;
  const fromLabels = labels
    ? Array.from(labels)
        .map((label) => label.textContent ?? '')
        .join(' ')
        .trim()
    : '';
  return fromLabels || (control.getAttribute('title')?.trim() ?? '');
}

const describeControl = (control: Element) => control.outerHTML.slice(0, 160);

let roots: Root[] = [];
let hosts: HTMLElement[] = [];
/** Submissions of a host `<form>` the viewer is mounted in; a viewer click never makes one. */
let submits = 0;

afterEach(() => {
  roots.forEach((root) => root.unmount());
  hosts.forEach((host) => host.remove());
  roots = [];
  hosts = [];
  submits = 0;
});

/** Mount a viewer; `inForm` mounts it inside a host page's `<form>`. */
async function mountViewer(annotated: boolean, inForm = false) {
  const host = document.createElement(inForm ? 'form' : 'div');
  host.addEventListener('submit', (event) => {
    event.preventDefault();
    submits += 1;
  });
  host.style.cssText = 'width:1280px;height:800px';
  document.body.append(host);
  const root = createRoot(host);
  root.render(
    <LeRobotViewer
      dataSource={new FetchDataSource(FRAME_CODED)}
      language="en"
      {...(annotated
        ? {
            fields,
            annotation: { value: DOC, onChange: () => {} },
            initialSelection: { segmentId: 'b', timeS: 7 },
          }
        : {})}
    />,
  );
  hosts.push(host);
  roots.push(root);
  return host;
}

/**
 * Every form control on the page has an id and a label; no id repeats; no
 * control has a `name`, so a host `<form>` around the viewer submits nothing of it.
 */
function expectNamedLabelledControls() {
  const controls = Array.from(document.querySelectorAll<HTMLElement>(CONTROLS));
  expect(controls.length).toBeGreaterThan(0);

  // Chrome: "A form field element should have an id or name attribute".
  const withoutId = controls.filter((control) => !control.id);
  expect(withoutId.map(describeControl)).toEqual([]);
  const named = controls.filter((control) => control.hasAttribute('name'));
  expect(named.map(describeControl)).toEqual([]);
  for (const form of document.querySelectorAll('form')) {
    expect([...new FormData(form).keys()]).toEqual([]);
  }
  expect(submits).toBe(0);

  // A label for every control a screen reader reaches.
  const exposed = controls.filter((control) => !control.closest('[aria-hidden="true"]'));
  const unlabelled = exposed.filter((control) => accessibleName(control) === '');
  expect(unlabelled.map(describeControl)).toEqual([]);

  // Two viewers on one page never share an id.
  const ids = Array.from(document.querySelectorAll('[id]'), (element) => element.id);
  const repeated = ids.filter((id, index) => ids.indexOf(id) !== index);
  expect(repeated).toEqual([]);
  return controls;
}

const filterTriggers = (host: HTMLElement) =>
  Array.from(host.querySelectorAll('.lucide-list-filter'), (icon) => icon.closest('button')!);

/** Open each panel filter menu (chart joints, raw features) in turn and check the page while it is open. */
async function checkFilterMenus(host: HTMLElement) {
  await expect.poll(() => filterTriggers(host).length, { timeout: 60_000 }).toBe(2);
  for (const trigger of filterTriggers(host)) {
    const closedCount = document.querySelectorAll(CONTROLS).length;
    // Dispatched on the element: `userEvent.click` resolves a locator, which two
    // viewers' identically named triggers make ambiguous. A menu opens on pointerdown.
    trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    await expect
      .poll(() => host.querySelector('[data-filter-row="true"]'), { timeout: 10_000 })
      .not.toBeNull();
    const controls = expectNamedLabelledControls();
    // The menu's search field is one of the checked controls.
    expect(controls.length).toBeGreaterThan(closedCount);
    // Each row is a toggle button that owns its state; no control is nested in it.
    const rows = Array.from(host.querySelectorAll('[data-filter-row="true"]'));
    expect(
      rows.every((row) =>
        ['true', 'false', 'mixed'].includes(row.getAttribute('aria-pressed') ?? ''),
      ),
    ).toBe(true);
    expect(rows.filter((row) => row.querySelector(CONTROLS)).length).toBe(0);
    // A row is a native button (Enter and Space activate it); activating it flips
    // the state it announces, and again restores it.
    const lastRow = () => Array.from(host.querySelectorAll('[data-filter-row="true"]')).at(-1)!;
    expect(rows.every((row) => row.tagName === 'BUTTON')).toBe(true);
    const before = lastRow().getAttribute('aria-pressed');
    (lastRow() as HTMLButtonElement).click();
    await expect.poll(() => lastRow().getAttribute('aria-pressed')).not.toBe(before);
    (lastRow() as HTMLButtonElement).click();
    await expect.poll(() => lastRow().getAttribute('aria-pressed')).toBe(before);
    await userEvent.keyboard('{Escape}');
    await expect
      .poll(() => host.querySelector('[data-filter-row="true"]'), { timeout: 10_000 })
      .toBeNull();
  }
}

describe('browser: form fields', () => {
  it('the episode sidebar with its filters open, in two viewers on one page', async () => {
    await page.viewport(1280, 1600);
    document.body.style.margin = '0';
    const viewers = [await mountViewer(false), await mountViewer(false, true)];
    for (const host of viewers) {
      await expect
        .poll(() => host.querySelector('[aria-label^="Select Episode"]'), { timeout: 60_000 })
        .not.toBeNull();
      host.querySelector<HTMLButtonElement>('button[title="Advanced"]')!.click();
      await expect.poll(() => host.querySelector(DURATION_MAX), { timeout: 10_000 }).not.toBeNull();
      expect(host.querySelector('input[aria-label="Search..."]')).not.toBeNull();
      // The two duration bounds are told apart.
      expect(host.querySelector(DURATION_MIN)).not.toBeNull();
    }
    expectNamedLabelledControls();
    for (const host of viewers) await checkFilterMenus(host);
  });

  it('the segment inspector with editable fields, in two viewers on one page', async () => {
    await page.viewport(1280, 1600);
    document.body.style.margin = '0';
    const viewers = [await mountViewer(true), await mountViewer(true, true)];
    for (const host of viewers) {
      await expect
        .poll(
          () =>
            host.querySelectorAll('[data-testid="lerobot-segment-inspector"] input[type="text"]')
              .length,
          { timeout: 60_000 },
        )
        .toBeGreaterThanOrEqual(4);
    }
    expectNamedLabelledControls();
    for (const host of viewers) await checkFilterMenus(host);
  });
});
