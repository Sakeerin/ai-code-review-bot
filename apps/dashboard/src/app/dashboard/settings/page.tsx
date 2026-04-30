import { auth } from "@repo/db/auth"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { getUserOrg } from "@/lib/org"
import { SlackSettingsForm } from "@/components/settings-form"

export default async function SettingsPage() {
  const requestHeaders = await headers()
  const session = await auth.api.getSession({ headers: requestHeaders })

  if (!session?.user) {
    redirect("/")
  }

  const org = await getUserOrg(session.user.id)
  const webhookBase = process.env.WEBHOOK_BASE_URL ?? process.env.NEXT_PUBLIC_WEBHOOK_URL ?? "<your-cloudflare-workers-url>"

  return (
    <div className="space-y-10 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        {org && (
          <p className="text-sm text-muted-foreground mt-1">{org.name}</p>
        )}
      </div>

      {/* ── Slack ───────────────────────────────────────────────── */}
      <section className="border border-border rounded-xl p-6 bg-card shadow-sm space-y-5">
        <div>
          <h2 className="text-lg font-semibold">Slack Notifications</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Receive a Slack message for every completed AI review. Per-org setting —
            takes priority over the global environment variable.
          </p>
        </div>

        {!org ? (
          <p className="text-sm text-muted-foreground">
            Install the GitHub App first to configure notifications.
          </p>
        ) : (
          <SlackSettingsForm currentUrl={org.slackWebhookUrl ?? null} />
        )}
      </section>

      {/* ── GitLab ──────────────────────────────────────────────── */}
      <section className="border border-border rounded-xl p-6 bg-card shadow-sm space-y-5">
        <div>
          <h2 className="text-lg font-semibold">GitLab Webhook Setup</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Connect GitLab by adding a webhook to each project or group.
            No OAuth app is needed — the bot authenticates via a GitLab token.
          </p>
        </div>

        <ol className="space-y-4 text-sm">
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">1</span>
            <div>
              <p className="font-medium">Add a GitLab webhook to your project or group</p>
              <p className="text-muted-foreground mt-0.5">
                Go to your GitLab project → <strong>Settings → Webhooks → Add new webhook</strong>
              </p>
            </div>
          </li>

          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">2</span>
            <div>
              <p className="font-medium">Set the webhook URL</p>
              <div className="mt-1.5 flex items-center gap-2">
                <code className="rounded bg-secondary px-2 py-1 text-xs font-mono break-all">
                  {webhookBase}/webhook/gitlab
                </code>
              </div>
            </div>
          </li>

          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">3</span>
            <div>
              <p className="font-medium">Set the Secret Token</p>
              <p className="text-muted-foreground mt-0.5">
                Use the value of your <code className="bg-secondary rounded px-1 text-xs">GITLAB_WEBHOOK_SECRET</code> env var.
              </p>
            </div>
          </li>

          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">4</span>
            <div>
              <p className="font-medium">Enable Merge Request events</p>
              <p className="text-muted-foreground mt-0.5">
                Check <strong>Merge request events</strong> only. Leave all other triggers off.
              </p>
            </div>
          </li>

          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">5</span>
            <div>
              <p className="font-medium">Add a .reviewbot.yml to your repo (optional)</p>
              <p className="text-muted-foreground mt-0.5">
                See{" "}
                <a href="/docs" className="underline hover:text-foreground">
                  the docs
                </a>{" "}
                for configuration options. Without it the bot uses default settings.
              </p>
            </div>
          </li>
        </ol>

        <div className="rounded-lg bg-secondary/50 p-4 text-xs text-muted-foreground">
          Once you open or update a Merge Request, the bot will automatically appear as a
          repository in your <a href="/dashboard/repos" className="underline hover:text-foreground">Repositories</a> list
          after the first review completes.
        </div>
      </section>
    </div>
  )
}
