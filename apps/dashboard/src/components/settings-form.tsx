"use client"

import { useState } from "react"

export function SlackSettingsForm({ currentUrl }: { currentUrl: string | null }) {
  const [url, setUrl] = useState(currentUrl ?? "")
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [errorMsg, setErrorMsg] = useState("")

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setStatus("saving")
    setErrorMsg("")

    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slackWebhookUrl: url }),
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        throw new Error(data.error ?? "Failed to save")
      }
      setStatus("saved")
      setTimeout(() => setStatus("idle"), 3000)
    } catch (err) {
      setStatus("error")
      setErrorMsg(err instanceof Error ? err.message : "Unexpected error")
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-4">
      <div>
        <label htmlFor="slack-url" className="block text-sm font-medium mb-1.5">
          Slack Incoming Webhook URL
        </label>
        <input
          id="slack-url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://hooks.slack.com/services/..."
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <p className="text-xs text-muted-foreground mt-1.5">
          Leave blank to disable Slack notifications.{" "}
          <a
            href="https://api.slack.com/messaging/webhooks"
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-foreground"
          >
            How to create an Incoming Webhook
          </a>
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={status === "saving"}
          className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {status === "saving" ? "Saving…" : "Save"}
        </button>
        {status === "saved" && (
          <span className="text-sm text-green-600">Saved!</span>
        )}
        {status === "error" && (
          <span className="text-sm text-red-600">{errorMsg}</span>
        )}
      </div>
    </form>
  )
}
