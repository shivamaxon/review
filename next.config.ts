import type { NextConfig } from 'next';
// The standard PostCSS adapter works with both Next.js bundlers.
const nextConfig: NextConfig = { cacheComponents: false, distDir: process.env.NEXT_DIST_DIR ?? ".next" };
export default nextConfig;
