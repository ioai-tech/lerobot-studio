/** Client for scripts/vite/wasmTestControlPlugin.ts (the dev server's WASM and worker answers). */
export interface WasmControlState {
  mode: string;
  wasmRequests: number;
  selfHostedRequests: number;
}

export type WasmControlMode = 'normal' | 'corrupt' | 'missing' | 'worker-csp';

export async function wasmControl(
  options: { mode?: WasmControlMode; reset?: boolean } = {},
): Promise<WasmControlState> {
  const query = new URLSearchParams();
  if (options.mode) query.set('mode', options.mode);
  if (options.reset) query.set('reset', '1');
  const response = await fetch(`/__wasm-test?${query}`, { cache: 'no-store' });
  return (await response.json()) as WasmControlState;
}

/** Count WebAssembly compiles and instantiations on this page (workers are not counted). */
export function spyOnPageWasm(): { calls: () => number; restore: () => void } {
  const names = ['compile', 'compileStreaming', 'instantiate', 'instantiateStreaming'] as const;
  const originals = names.map((name) => WebAssembly[name]);
  let calls = 0;
  names.forEach((name, index) => {
    const original = originals[index] as (...args: unknown[]) => unknown;
    (WebAssembly as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
      calls += 1;
      return original.apply(WebAssembly, args);
    };
  });
  return {
    calls: () => calls,
    restore: () =>
      names.forEach((name, index) => {
        (WebAssembly as unknown as Record<string, unknown>)[name] = originals[index];
      }),
  };
}

/** Record the workers this page constructs (their script URLs). */
export function recordWorkers(): { scripts: string[]; restore: () => void } {
  const Real = window.Worker;
  const scripts: string[] = [];
  window.Worker = class extends Real {
    constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options);
      scripts.push(String(url));
    }
  };
  return { scripts, restore: () => void (window.Worker = Real) };
}
