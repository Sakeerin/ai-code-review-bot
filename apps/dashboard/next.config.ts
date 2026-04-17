import type { NextConfig } from 'next'
import { withSentryConfig } from '@sentry/nextjs'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@repo/ui', '@repo/db'],
}

export default withSentryConfig(nextConfig, {
  silent: true,
  org: "ai-review-bot",
  project: "dashboard",
})
