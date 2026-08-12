import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // This app is standalone inside the Emberkeep repo, which has its own
  // lockfile — pin the root so Turbopack does not guess the parent.
  turbopack: { root: import.meta.dirname },
  // Single-tenant desk tool: everything renders client-side off local state,
  // so there is nothing to revalidate and no images to optimise remotely.
  images: { unoptimized: true },
};

export default nextConfig;
