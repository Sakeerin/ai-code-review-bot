export interface SlackReviewNotificationPayload {
  provider: 'github' | 'gitlab'
  repository: string
  reviewNumber: number
  title: string | null
  author: string | null
  score: number | null
  bugsFound: number
  commentsPosted: number
  reviewUrl: string | null
  summary: string
}

export async function sendSlackReviewNotification(
  payload: SlackReviewNotificationPayload,
  orgWebhookUrl?: string | null,
): Promise<void> {
  const webhookUrl = orgWebhookUrl ?? process.env.SLACK_WEBHOOK_URL
  if (!webhookUrl) return

  const reviewLabel = payload.provider === 'gitlab' ? 'Merge Request' : 'Pull Request'
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: `AI review completed for ${payload.repository}`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `AI review completed: ${payload.repository}#${payload.reviewNumber}`,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${payload.title ?? `${reviewLabel} #${payload.reviewNumber}`}*\n${reviewLabel}: *#${payload.reviewNumber}*\nAuthor: *${payload.author ?? 'unknown'}*`,
          },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Platform*\n${payload.provider}` },
            { type: 'mrkdwn', text: `*Score*\n${payload.score === null ? 'n/a' : `${payload.score}/100`}` },
            { type: 'mrkdwn', text: `*Bugs Found*\n${payload.bugsFound}` },
            { type: 'mrkdwn', text: `*Comments*\n${payload.commentsPosted}` },
          ],
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Summary*\n${payload.summary.slice(0, 2500)}`,
          },
        },
        ...(payload.reviewUrl
          ? [
              {
                type: 'actions',
                elements: [
                  {
                    type: 'button',
                    text: { type: 'plain_text', text: 'Open Review' },
                    url: payload.reviewUrl,
                  },
                ],
              },
            ]
          : []),
      ],
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Slack webhook failed (${response.status}): ${errorText}`)
  }
}
