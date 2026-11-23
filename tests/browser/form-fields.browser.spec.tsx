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

afterEach(() => {
  roots.forEach((root) => root.unmount());
  hosts.forEach((host) => host.remove());
  roots = [];
  hosts = [];
});

async function mountViewer(annotated: boolean) {
  const host = document.createElement('div');
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

/** Every form control on the page has an id or a name and a label; no id repeats. */
function expectNamedLabelledControls() {
  const controls = Array.from(document.querySelectorAll<HTMLElement>(CONTROLS));
  expect(controls.length).toBeGreaterThan(0);

  // Chrome: "A form field element should have an id or name attribute".
  const unnamed = controls.filter((control) => !control.id && !control.getAttribute('name'));
  expect(unnamed.map(describeControl)).toEqual([]);

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
    await userEvent.click(trigger);
    await expect
      .poll(() => host.querySelector('[data-filter-row="true"]'), { timeout: 10_000 })
      .not.toBeNull();
    const controls = expectNamedLabelledControls();
    expect(controls.some((control) => control.getAttribute('name') === 'filter-search')).toBe(true);
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
    const viewers = [await mountViewer(false), await mountViewer(false)];
    for (const host of viewers) {
      await expect
        .poll(() => host.querySelector('[aria-label^="Select Episode"]'), { timeout: 60_000 })
        .not.toBeNull();
      host.querySelector<HTMLButtonElement>('button[title="Advanced"]')!.click();
      await expect
        .poll(() => host.querySelector('input[name="episode-duration-max"]'), { timeout: 10_000 })
        .not.toBeNull();
      expect(host.querySelector('input[name="episode-search"]')).not.toBeNull();
      expect(host.querySelector('input[name="episode-duration-min"]')).not.toBeNull();
    }
    expectNamedLabelledControls();
    const label = (name: string) =>
      accessibleName(viewers[0]!.querySelector<HTMLElement>(`input[name="${name}"]`)!);
    // The two duration bounds are told apart.
    expect(label('episode-duration-min')).not.toBe(label('episode-duration-max'));
    for (const host of viewers) await checkFilterMenus(host);
  });

  it('the segment inspector with editable fields, in two viewers on one page', async () => {
    await page.viewport(1280, 1600);
    document.body.style.margin = '0';
    const viewers = [await mountViewer(true), await mountViewer(true)];
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
