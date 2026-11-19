// `NEXT_BASE_PATH=/docs/viewer next build` serves the app under a sub-path;
// the package's worker and WASM URLs follow it.
const basePath = process.env.NEXT_BASE_PATH || undefined;

/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath,
  env: { NEXT_PUBLIC_BASE_PATH: basePath ?? '' },
};

export default nextConfig;
