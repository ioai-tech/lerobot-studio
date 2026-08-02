import { useEffect, useState } from 'react';
import type { SampleDataset } from '@ioai/lerobot-studio-platform';
import { loadSampleDatasets } from '@ioai/lerobot-studio-platform';

export function useSampleDatasets(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const [samples, setSamples] = useState<SampleDataset[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let mounted = true;
    setLoading(true);
    setError(null);
    loadSampleDatasets()
      .then((list) => {
        if (!mounted) return;
        setSamples(list);
        setLoading(false);
      })
      .catch((e) => {
        if (!mounted) return;
        setSamples([]);
        setLoading(false);
        setError((e as Error)?.message || String(e));
      });
    return () => {
      mounted = false;
    };
  }, [enabled]);

  return { samples, loading, error };
}
