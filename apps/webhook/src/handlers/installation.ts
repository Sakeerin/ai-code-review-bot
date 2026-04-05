import type { Context } from 'hono'
import type { AppEnv } from '../middleware/verify-signature.js'

/**
 * Handle installation webhook events from GitHub.
 *
 * Tracks when orgs install/uninstall the GitHub App.
 * In Phase 1, we just log the events.
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

  switch (action) {
    case 'created': {
      console.log(
        `✅ App installed by ${installation.account.login}`,
        `Repos: ${repositories?.map((r) => r.full_name).join(', ') ?? 'none'}`,
      )
      // TODO: Create organization + repositories in DB
      break
    }

    case 'deleted': {
      console.log(`❌ App uninstalled by ${installation.account.login}`)
      // TODO: Deactivate organization in DB
      break
    }

    case 'suspend': {
      console.log(`⏸️ App suspended by ${installation.account.login}`)
      break
    }

    case 'unsuspend': {
      console.log(`▶️ App unsuspended by ${installation.account.login}`)
      break
    }

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
