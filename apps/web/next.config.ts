import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Container builds set NEXT_STANDALONE=1 (standalone needs symlink rights, which Windows dev boxes often lack).
  output: process.env.NEXT_STANDALONE === '1' ? 'standalone' : undefined,
  transpilePackages: ['@santha/shared-types'],
};

export default nextConfig;
