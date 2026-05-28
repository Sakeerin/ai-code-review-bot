interface WeeklyReportData {
  orgName: string
  weekStart: string  // ISO date string
  weekEnd: string
  totalReviews: number
  totalBugsFound: number
  avgScore: number | null
  topRepos: Array<{
    fullName: string
    reviewCount: number
    avgScore: number | null
    bugsFound: number
  }>
  recipients: string[]
}

interface ResendEmailPayload {
  from: string
  to: string[]
  subject: string
  html: string
}

/**
 * Send the weekly PR review report via Resend.
 * Falls back silently if RESEND_API_KEY is not configured.
 */
export async function sendWeeklyReport(data: WeeklyReportData): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.log('RESEND_API_KEY not set — skipping weekly email report')
    return
  }

  const from = process.env.EMAIL_FROM ?? 'noreply@reviewbot.app'

  const payload: ResendEmailPayload = {
    from,
    to: data.recipients,
    subject: `[AI Review Bot] Weekly Report for ${data.orgName} — ${data.weekStart}`,
    html: buildWeeklyReportHtml(data),
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Resend API error ${res.status}: ${body}`)
  }
}

function buildWeeklyReportHtml(data: WeeklyReportData): string {
  const scoreText = data.avgScore !== null ? `${Math.round(data.avgScore)}/100` : 'N/A'

  const repoRows = data.topRepos
    .map(
      (r) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${r.fullName}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center">${r.reviewCount}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center">${r.bugsFound}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center">${r.avgScore !== null ? `${Math.round(r.avgScore)}/100` : 'N/A'}</td>
      </tr>`,
    )
    .join('')

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:600px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1)">
    <!-- Header -->
    <div style="background:#111827;padding:32px;text-align:center">
      <h1 style="color:#fff;margin:0;font-size:22px">AI Review Bot</h1>
      <p style="color:#9ca3af;margin:8px 0 0;font-size:14px">Weekly Report · ${data.weekStart} to ${data.weekEnd}</p>
    </div>

    <!-- Org title -->
    <div style="padding:24px 32px 0">
      <h2 style="margin:0;font-size:18px;color:#111827">${data.orgName}</h2>
    </div>

    <!-- Stats -->
    <div style="display:flex;gap:16px;padding:20px 32px">
      ${statCard('Reviews', String(data.totalReviews))}
      ${statCard('Bugs Found', String(data.totalBugsFound))}
      ${statCard('Avg Score', scoreText)}
    </div>

    <!-- Top repos table -->
    ${data.topRepos.length > 0 ? `
    <div style="padding:0 32px 24px">
      <h3 style="font-size:15px;color:#374151;margin:0 0 12px">Repository Breakdown</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead>
          <tr style="background:#f3f4f6">
            <th style="padding:8px 12px;text-align:left;color:#6b7280;font-weight:500">Repository</th>
            <th style="padding:8px 12px;text-align:center;color:#6b7280;font-weight:500">Reviews</th>
            <th style="padding:8px 12px;text-align:center;color:#6b7280;font-weight:500">Bugs</th>
            <th style="padding:8px 12px;text-align:center;color:#6b7280;font-weight:500">Score</th>
          </tr>
        </thead>
        <tbody>${repoRows}</tbody>
      </table>
    </div>` : ''}

    <!-- Footer -->
    <div style="background:#f9fafb;padding:20px 32px;text-align:center;border-top:1px solid #e5e7eb">
      <p style="margin:0;font-size:12px;color:#9ca3af">
        You're receiving this because weekly reports are enabled for ${data.orgName}.<br>
        <a href="${process.env.NEXT_PUBLIC_APP_URL ?? 'https://reviewbot.app'}/dashboard/settings" style="color:#6366f1">Manage email preferences</a>
      </p>
    </div>
  </div>
</body>
</html>`
}

function statCard(label: string, value: string): string {
  return `<div style="flex:1;background:#f3f4f6;border-radius:8px;padding:16px;text-align:center">
    <div style="font-size:24px;font-weight:700;color:#111827">${value}</div>
    <div style="font-size:12px;color:#6b7280;margin-top:4px">${label}</div>
  </div>`
}
