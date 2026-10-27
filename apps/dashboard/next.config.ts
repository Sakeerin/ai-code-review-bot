import type { NextConfig } from 'next'
import { withSentryConfig } from '@sentry/nextjs'
import { fileURLToPath } from 'node:url'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: process.env.BUILD_STANDALONE === '1' ? 'standalone' : undefined,
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  transpilePackages: ['@repo/ui', '@repo/db', '@repo/ai', '@repo/github'],
}

export default withSentryConfig(nextConfig, {
  silent: true,
  org: "ai-review-bot",
  project: "dashboard",
})
