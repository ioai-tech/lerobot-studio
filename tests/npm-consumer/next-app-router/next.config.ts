import type { NextConfig } from 'next';

// Next 16 builds with Turbopack: the package needs no bundler configuration
// (its workers and WASM are `new URL(..., import.meta.url)` assets).
const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
