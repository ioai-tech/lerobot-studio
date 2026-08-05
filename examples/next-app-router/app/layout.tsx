import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@ioai/lerobot-studio/style.css';
import './styles.css';

// Next.js requires route metadata to be exported from the layout module.
export const metadata: Metadata = {
  title: 'LeRobot Studio Next.js consumer',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
