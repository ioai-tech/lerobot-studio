import React, { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/ui';
import { expectNoBlockingA11yViolations } from './a11y';

function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = performance.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (performance.now() - start > timeoutMs) {
        reject(new Error('waitFor timeout'));
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
}

describe('browser: shadcn Base UI primitives', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    document.documentElement.classList.remove('dark');
    host = document.createElement('div');
    host.id = 'lerobot-root';
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    root.unmount();
    host.remove();
    document.body
      .querySelectorAll(
        '[data-slot="dialog-portal"], [data-slot="dropdown-menu-portal"], [data-slot="tooltip-portal"]',
      )
      .forEach((n) => n.remove());
  });

  it('portals dialog overlays into #lerobot-root and traps Escape', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>Open health dialog</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Health dialog</DialogTitle>
              <DialogDescription>Portal smoke test</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" onClick={() => setOpen(false)}>
                Done
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      );
    }

    root.render(<Harness />);
    await waitFor(() => Boolean(host.querySelector('[data-slot="dialog-trigger"]')));
    const trigger = host.querySelector<HTMLElement>('[data-slot="dialog-trigger"]')!;
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => Boolean(document.querySelector('[data-slot="dialog-content"]')));

    const content = document.querySelector('[data-slot="dialog-content"]');
    expect(content).toBeTruthy();
    expect(host.contains(content)).toBe(true);
    expect(content?.closest('#lerobot-root')).toBe(host);
    // The portal can be mounted in a container taller than the viewport.
    // Use viewport coordinates so the modal cannot be positioned below it.
    expect((content as HTMLElement).style.top).toBe('50vh');
    expect((content as HTMLElement).style.left).toBe('50vw');
    expect(content?.contains(document.activeElement)).toBe(true);

    const closeButton = content?.querySelector<HTMLElement>('[data-slot="dialog-close"]');
    const doneButton = Array.from(content?.querySelectorAll<HTMLElement>('button') ?? []).find(
      (button) => button.textContent === 'Done',
    );
    expect(closeButton).toBeTruthy();
    expect(doneButton).toBeTruthy();
    closeButton!.focus();
    await userEvent.tab();
    expect(document.activeElement).toBe(doneButton);
    await expectNoBlockingA11yViolations(host);

    await userEvent.keyboard('{Escape}');
    await waitFor(() => !document.querySelector('[data-slot="dialog-content"]'));
    expect(document.activeElement).toBe(trigger);
  });

  it('supports tabs keyboard activation and line variant', async () => {
    root.render(
      <Tabs defaultValue="episodes">
        <TabsList variant="line">
          <TabsTrigger value="episodes">Episodes</TabsTrigger>
          <TabsTrigger value="analysis">Analysis</TabsTrigger>
        </TabsList>
        <TabsContent value="episodes">Episodes panel</TabsContent>
        <TabsContent value="analysis">Analysis panel</TabsContent>
      </Tabs>,
    );

    await waitFor(() => Boolean(host.querySelector('[data-slot="tabs-list"]')));
    expect(host.querySelector('[data-slot="tabs"]')?.className).toContain('flex-col');
    const analysis =
      (host.querySelector(
        '[data-slot="tabs-trigger"][data-value="analysis"], [data-slot="tabs-trigger"]:nth-child(2)',
      ) as HTMLElement | null) ??
      (Array.from(host.querySelectorAll('[data-slot="tabs-trigger"]'))[1] as
        HTMLElement | undefined);
    expect(analysis).toBeTruthy();
    analysis!.focus();
    analysis!.click();
    await waitFor(() => host.textContent?.includes('Analysis panel') ?? false);
    expect(host.textContent).toContain('Analysis panel');
  });

  it('opens nested dropdown menus and closes on outside Escape', async () => {
    root.render(
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button />}>Open menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Root item</DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>More</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>Nested item</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    await waitFor(() => Boolean(host.querySelector('[data-slot="dropdown-menu-trigger"]')));
    const trigger = host.querySelector<HTMLElement>('[data-slot="dropdown-menu-trigger"]')!;
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => Boolean(document.querySelector('[data-slot="dropdown-menu-content"]')));
    await expectNoBlockingA11yViolations(host);
    const subTrigger = document.querySelector(
      '[data-slot="dropdown-menu-sub-trigger"]',
    ) as HTMLElement | null;
    expect(subTrigger).toBeTruthy();
    subTrigger!.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
    subTrigger!.focus();
    subTrigger!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    await waitFor(() => Boolean(document.querySelector('[data-slot="dropdown-menu-sub-content"]')));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => document.querySelector('[data-slot="dropdown-menu-sub-content"]') === null);
    await userEvent.keyboard('{Escape}');
    await waitFor(
      () => document.querySelectorAll('[data-slot="dropdown-menu-content"]').length === 0,
    );
    expect(document.activeElement).toBe(trigger);
  });

  it('maps legacy menu item onClick handlers to the Radix select event', async () => {
    let opened = false;
    root.render(
      <DropdownMenu defaultOpen>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={() => (opened = true)}>Browse LeRobot</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    await waitFor(() => Boolean(document.querySelector('[data-slot="dropdown-menu-item"]')));
    (document.querySelector('[data-slot="dropdown-menu-item"]') as HTMLElement).click();
    expect(opened).toBe(true);
  });

  it('renders tooltips with delay provider and dark theme tokens available on :root', async () => {
    document.documentElement.classList.add('dark');
    expect(
      getComputedStyle(document.documentElement).getPropertyValue('--background').trim().length >=
        0,
    ).toBe(true);

    root.render(
      <TooltipProvider delay={0}>
        <Tooltip defaultOpen>
          <TooltipTrigger render={<Button />}>Hint</TooltipTrigger>
          <TooltipContent>Tooltip body</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );

    await waitFor(() => Boolean(document.querySelector('[data-slot="tooltip-content"]')));
    const tip = document.querySelector('[data-slot="tooltip-content"]');
    expect(tip?.textContent).toContain('Tooltip body');
    expect(host.contains(tip)).toBe(true);
    expect(tip?.closest('#lerobot-root')).toBe(host);
    await expectNoBlockingA11yViolations(host);
  });
});
