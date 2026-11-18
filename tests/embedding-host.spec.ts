import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  episodeTimeDomain,
  frameAtFraction,
  frameAtSeconds,
  frameRangeFractions,
  frameStartFraction,
  hasSegmentIssue,
  markersOfEpisode,
  matchesSegmentFilter,
  overlaySegmentsOfEpisode,
  pendingSelectionEpisode,
  pendingSelectionFrame,
  segmentIssueMarkers,
  type EpisodeMetadata,
  type Segment,
  type TimelineMarker,
} from '@/core';
import { I18nProvider } from '../src/react/i18n/core';
import { TooltipProvider } from '../src/ui';
import { HostChrome } from '../src/react/components/Host/HostChrome';
import { OverlayBand } from '../src/react/components/Timeline/OverlayBand';
import { MarkerLane } from '../src/react/components/Timeline/MarkerLane';
import { themeTokenProperties } from '../src/react/contexts/themeTokens';
import { coerceLocale, loadMessages } from '../src/react/i18n/messages';
import type { LeRobotExtension } from '../src/react/contexts/hostTypes';

// zh and ja are separate chunks; once loaded, a provider renders them on the
// first (here: static) render.
beforeAll(async () => {
  await Promise.all([loadMessages('zh'), loadMessages('ja')]);
});

const noop = () => {};

function render(element: React.ReactElement, language = 'en', messages?: Record<string, string>) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      { forcedLanguage: language, messages },
      React.createElement(TooltipProvider, null, element),
    ),
  );
}

function seg(id: string, startFrame: number, endFrame: number, extra: Partial<Segment> = {}) {
  return {
    id,
    startFrame,
    endFrame,
    task: null,
    subtasks: [],
    values: {},
    review: 'to_review',
    origin: { kind: 'manual' },
    ...extra,
  } as Segment;
}

function marker(
  id: string,
  startFrame: number,
  endFrame: number,
  severity: TimelineMarker['severity'],
  episodeIndex = 0,
): TimelineMarker {
  return { id, episodeIndex, startFrame, endFrame, severity, label: `check ${id}` };
}

describe('one time axis', () => {
  it('places frame k at k / N and a range up to the end of its last frame', () => {
    expect(frameStartFraction(0, 300)).toBe(0);
    expect(frameStartFraction(150, 300)).toBe(0.5);
    expect(frameRangeFractions(0, 299, 300)).toEqual({ left: 0, width: 1 });
    const { left, width } = frameRangeFractions(30, 59, 300);
    expect(left).toBeCloseTo(0.1);
    expect(width).toBeCloseTo(0.1);
    // A one-frame range still has the width of one frame.
    expect(frameRangeFractions(10, 10, 100).width).toBeCloseTo(0.01);
  });

  it('maps a position back to the frame whose time span contains it', () => {
    expect(frameAtFraction(0, 300)).toBe(0);
    expect(frameAtFraction(0.5, 300)).toBe(150);
    expect(frameAtFraction(1, 300)).toBe(299);
    expect(frameAtFraction(-1, 300)).toBe(0);
    for (let frame = 0; frame < 300; frame++) {
      expect(frameAtFraction(frameStartFraction(frame, 300), 300)).toBe(frame);
    }
  });

  it("puts a chart's playhead at the slider's fraction (frame k at time k / fps)", () => {
    const [from, to] = episodeTimeDomain(0, 300, 30);
    expect([from, to]).toEqual([0, 10]);
    for (const frame of [0, 1, 77, 150, 299]) {
      const chartFraction = (frame / 30 - from) / (to - from);
      expect(chartFraction).toBeCloseTo(frameStartFraction(frame, 300), 12);
    }
  });
});

describe('markers feed the Issues filter', () => {
  const markers = [
    marker('late', 80, 90, 'fail'),
    marker('info', 0, 10, 'info'),
    marker('warn', 40, 45, 'warn'),
    marker('other-episode', 0, 99, 'fail', 1),
  ];

  it('keeps one episode, in time order, without invalid ranges', () => {
    expect(
      markersOfEpisode([...markers, marker('bad', 9, 3, 'fail')], 0).map((item) => item.id),
    ).toEqual(['info', 'warn', 'late']);
    expect(markersOfEpisode(markers, null)).toEqual([]);
  });

  it('a segment overlapping a warn or fail marker has an issue; info never makes one', () => {
    const episodeMarkers = markersOfEpisode(markers, 0);
    expect(hasSegmentIssue(seg('a', 0, 20), episodeMarkers)).toBe(false);
    expect(hasSegmentIssue(seg('b', 45, 60), episodeMarkers)).toBe(true);
    expect(hasSegmentIssue(seg('c', 46, 79), episodeMarkers)).toBe(false);
    expect(segmentIssueMarkers(seg('d', 40, 99), episodeMarkers).map((item) => item.id)).toEqual([
      'warn',
      'late',
    ]);
    expect(matchesSegmentFilter(seg('b', 45, 60), 'issues', episodeMarkers)).toBe(true);
    expect(matchesSegmentFilter(seg('c', 46, 79), 'issues', episodeMarkers)).toBe(false);
    // The host badge still counts on its own.
    expect(hasSegmentIssue(seg('e', 0, 1, { status: { severity: 'warn', label: 'x' } }), [])).toBe(
      true,
    );
  });

  it('draws one labelled button per marker with severity and time, one tab stop', () => {
    const html = render(
      React.createElement(MarkerLane, {
        markers: markersOfEpisode(markers, 0),
        totalFrames: 100,
        fps: 10,
        onSeek: noop,
      }),
    );
    expect(html).toContain('aria-label="Markers"');
    expect(html).toContain('aria-label="check late, Failure, 0:08.00–0:09.10"');
    expect(html).toContain('data-severity="warn"');
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html).toContain('left:80.0000%');
  });
});

describe('overlay band', () => {
  const groups = [
    {
      episodeIndex: 0,
      segments: [
        {
          id: 'p2',
          startFrame: 50,
          endFrame: 99,
          task: null,
          origin: { kind: 'suggested' as const },
        },
        {
          id: 'p1',
          startFrame: 0,
          endFrame: 49,
          task: 'Fold',
          origin: { kind: 'suggested' as const, confidence: 0.82 },
        },
      ],
    },
    { episodeIndex: 1, segments: [] },
  ];

  it('keeps one episode, sorted', () => {
    expect(overlaySegmentsOfEpisode(groups, 0).map((item) => item.id)).toEqual(['p1', 'p2']);
    expect(overlaySegmentsOfEpisode(groups, 2)).toEqual([]);
  });

  it('has a legend from messages, in every language, and a host may rename it', () => {
    const band = React.createElement(OverlayBand, {
      segments: overlaySegmentsOfEpisode(groups, 0),
      totalFrames: 100,
      fps: 10,
      onSeek: noop,
    });
    expect(render(band)).toContain('Suggestions (read-only)');
    expect(render(band, 'zh-CN')).toContain('建议（只读）');
    expect(render(band, 'en', { 'overlay.legend': 'AI proposals' })).toContain(
      'aria-label="AI proposals"',
    );
    expect(render(band)).toContain('aria-label="Suggestion 1, 0:00.00–0:05.00, Fold"');
  });
});

describe('host chrome', () => {
  const extensions: LeRobotExtension[] = [
    {
      id: 'host',
      toolbar: [
        {
          kind: 'button',
          id: 'propose',
          label: 'Propose',
          icon: 'sparkles',
          variant: 'primary',
          onSelect: noop,
        },
        {
          kind: 'button',
          id: 'rerun',
          label: 'Re-run',
          disabled: true,
          disabledReason: 'A run is in progress',
          onSelect: noop,
        },
        {
          kind: 'toggle',
          id: 'rendition',
          label: 'Frames',
          options: [
            { value: 'original', label: 'Original' },
            { value: 'anonymized', label: 'Anonymized' },
          ],
          value: 'anonymized',
          onChange: noop,
        },
        { kind: 'link', id: 'report', label: 'Report', href: '/r', external: true },
      ],
      notices: [
        { id: 'job', severity: 'info', text: 'Proposing…', progress: 'indeterminate' },
        { id: 'half', severity: 'warn', text: 'Half done', progress: 0.5 },
        {
          id: 'bad',
          severity: 'error',
          text: 'Failed',
          action: { label: 'Retry', onSelect: noop },
        },
      ],
    },
  ];

  it('renders toolbar items and notices in order, in the viewer style', () => {
    const html = render(React.createElement(HostChrome, { extensions }));
    expect(html.indexOf('Propose')).toBeLessThan(html.indexOf('Re-run'));
    expect(html).toContain('role="group" aria-label="Actions"');
    expect(html).toContain('role="radiogroup" aria-label="Frames"');
    expect(html).toMatch(/aria-checked="true"[^>]*>Anonymized</);
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
    expect(html).toContain('(opens in a new tab)');
    expect(html).toContain('role="status"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-valuenow="50"');
    expect(html).toContain('>Retry<');
  });

  it('a disabled button with a reason stays focusable and is described by its reason', () => {
    const html = render(React.createElement(HostChrome, { extensions }));
    const button = html.match(/<button[^>]*data-host-item="rerun"[^>]*>/)?.[0] ?? '';
    expect(button).toContain('aria-disabled="true"');
    expect(button).not.toMatch(/\sdisabled=""/);
    const describedBy = button.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(describedBy).toBeTruthy();
    expect(html).toContain(`id="${describedBy}" hidden="">A run is in progress</span>`);
  });

  it('a busy button stays focusable (aria-disabled, never natively disabled)', () => {
    const html = render(
      React.createElement(HostChrome, {
        extensions: [
          {
            id: 'host',
            toolbar: [{ kind: 'button', id: 'run', label: 'Run', busy: true, onSelect: noop }],
          },
        ],
      }),
    );
    const button = html.match(/<button[^>]*data-host-item="run"[^>]*>/)?.[0] ?? '';
    expect(button).toContain('aria-disabled="true"');
    expect(button).toContain('aria-busy="true"');
    expect(button).not.toMatch(/\sdisabled=""/);
  });

  it('renders nothing without contributions', () => {
    expect(render(React.createElement(HostChrome, { extensions: [] }))).toBe('');
    expect(render(React.createElement(HostChrome, { extensions: [{ id: 'x' }] }))).toBe('');
  });
});

describe('selection', () => {
  const episodes: EpisodeMetadata[] = [
    { episode_index: 0, length: 300, tasks: [] },
    { episode_index: 4, length: 120, tasks: [] },
  ];

  it('a deep link opens its episode, or the segment episode, and lands on the frame of timeS', () => {
    expect(pendingSelectionEpisode({ episodeIndex: 4 }, episodes, new Set(), null)).toBe(4);
    expect(pendingSelectionEpisode({ segmentId: 's' }, episodes, new Set(), 4)).toBe(4);
    expect(pendingSelectionEpisode({ timeS: 1 }, episodes, new Set([0]), null)).toBe(4);
    expect(pendingSelectionEpisode({ episodeIndex: 9 }, episodes, new Set(), null)).toBeNull();
    expect(pendingSelectionFrame({ timeS: 2.5 }, null, 30, 300)).toBe(75);
    // An exact frame time lands on that frame despite float error.
    expect(frameAtSeconds(7 / 30, 30, 300)).toBe(7);
    expect(pendingSelectionFrame({ timeS: 99 }, null, 30, 300)).toBe(299);
    expect(pendingSelectionFrame({ segmentId: 's' }, 40, 30, 300)).toBe(40);
    expect(pendingSelectionFrame({ segmentId: 's', timeS: 2 }, 40, 30, 300)).toBe(60);
  });

  it('a swap keeps the selection only on the same timeline', () => {
    const carried = { episodeIndex: 4, frame: 50, requireLength: 120 };
    expect(pendingSelectionEpisode(carried, episodes, new Set(), null)).toBe(4);
    expect(
      pendingSelectionEpisode({ ...carried, requireLength: 121 }, episodes, new Set(), null),
    ).toBeNull();
    expect(pendingSelectionFrame(carried, 0, 30, 120)).toBe(50);
  });
});

describe('theme tokens', () => {
  it('map to the root CSS variables; dark overrides apply only in the dark scheme', () => {
    const tokens = {
      primary: '#1d4ed8',
      primaryForeground: '#fff',
      radius: '0.5rem',
      fontFamily: 'Inter, sans-serif',
      dark: { primary: '#93c5fd' },
    };
    expect(themeTokenProperties(tokens, 'light')).toEqual({
      '--primary': '#1d4ed8',
      '--primary-foreground': '#fff',
      '--radius': '0.5rem',
      'font-family': 'Inter, sans-serif',
    });
    expect(themeTokenProperties(tokens, 'dark')['--primary']).toBe('#93c5fd');
    expect(themeTokenProperties(tokens, 'dark')['--radius']).toBe('0.5rem');
    expect(themeTokenProperties({ primary: '  ' }, 'light')).toEqual({});
    expect(themeTokenProperties(undefined, 'dark')).toEqual({});
  });
});

describe('language', () => {
  it('accepts BCP 47 tags and falls back to English', () => {
    expect(coerceLocale('zh-CN')).toBe('zh');
    expect(coerceLocale('zh')).toBe('zh');
    expect(coerceLocale('en-GB')).toBe('en');
    expect(coerceLocale('ja-JP')).toBe('ja');
    expect(coerceLocale('fr-FR')).toBe('en');
    expect(coerceLocale('')).toBe('en');
  });
});
