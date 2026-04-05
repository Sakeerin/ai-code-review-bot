import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@repo/ui', '@repo/db'],
}

export default nextConfig
