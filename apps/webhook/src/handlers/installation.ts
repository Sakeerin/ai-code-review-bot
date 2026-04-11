import type { Context } from 'hono'
import type { AppEnv } from '../middleware/verify-signature.js'
import { tasks } from '@trigger.dev/sdk/v3'
import type { SyncInstallationPayload } from '@repo/queue'

/**
 * Handle installation webhook events from GitHub.
 *
 * Dispatches a Trigger.dev task to sync org/repo state to the database.
 * The webhook itself only queues the job (must respond within 10s).
 */
export async function handleInstallation(c: Context<AppEnv>): Promise<Response> {
  const rawBody = c.get('rawBody')
  const payload = JSON.parse(rawBody) as {
    action: string
    installation: {
      id: number
      account: { login: string; id: number; type: string }
      app_id: number
    }
    repositories?: Array<{ id: number; full_name: string; private: boolean }>
  }

  const { action, installation, repositories } = payload

  console.log(
    `🔧 Installation event: ${action} — ${installation.account.login} (ID: ${installation.id})`,
  )

  const syncPayload: SyncInstallationPayload = {
    action: action as SyncInstallationPayload['action'],
    installationId: installation.id,
    accountLogin: installation.account.login,
    repos: repositories,
  }

  switch (action) {
    case 'created':
    case 'deleted':
      await tasks.trigger('sync-installation', syncPayload)
      console.log(`🚀 Dispatched sync-installation task (${action})`)
      break

    case 'suspend':
    case 'unsuspend':
      console.log(`ℹ️ Installation ${action} — no DB sync needed`)
      break

    default:
      console.log(`ℹ️ Unhandled installation action: ${action}`)
  }

  return c.json({
    status: 'ok',
    action,
    installationId: installation.id,
    account: installation.account.login,
  })
}
