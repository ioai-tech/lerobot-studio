'use client';

import dynamic from 'next/dynamic';

const ViewerCanvas = dynamic(() => import('./ViewerCanvas'), {
  ssr: false,
  loading: () => <p>Loading LeRobot Studio…</p>,
});

export function ViewerClient() {
  return <ViewerCanvas />;
}
