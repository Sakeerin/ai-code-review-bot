const SLACK_HOSTS = new Set(['hooks.slack.com', 'hooks.slack-gov.com'])

export function isSlackWebhookUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && SLACK_HOSTS.has(url.hostname) &&
      !url.port && !url.username && !url.password && !url.search && !url.hash &&
      /^\/services\/[A-Za-z0-9]+\/[A-Za-z0-9]+\/[A-Za-z0-9]+$/.test(url.pathname)
  } catch {
    return false
  }
}
