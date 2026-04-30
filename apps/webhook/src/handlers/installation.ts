import type { Context } from 'hono'
import type { AppEnv } from '../middleware/verify-signature.js'
import { tasks } from '@trigger.dev/sdk/v3'
import { z } from 'zod'

const InstallationPayloadSchema = z.object({
  action: z.string(),
  installation: z.object({
    id: z.number(),
    account: z.object({
      login: z.string(),
      id: z.number(),
      type: z.string(),
    }),
    app_id: z.number(),
  }),
  repositories: z.array(z.object({
    id: z.number(),
    full_name: z.string(),
    private: z.boolean(),
  })).optional(),
})

export async function handleInstallation(c: Context<AppEnv>): Promise<Response> {
  const rawBody = c.get('rawBody')

  let rawPayload: unknown
  try {
    rawPayload = JSON.parse(rawBody)
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const parsed = InstallationPayloadSchema.safeParse(rawPayload)
  if (!parsed.success) {
    console.error('❌ Invalid installation payload:', parsed.error.flatten())
    return c.json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400)
  }
  const payload = parsed.data

  const { action, installation, repositories } = payload

  console.log(
    `🔧 Installation event: ${action} — ${installation.account.login} (ID: ${installation.id})`,
  )

  switch (action) {
    case 'created':
    case 'deleted':
      await tasks.trigger('sync-installation', {
        action,
        installationId: installation.id,
        accountLogin: installation.account.login,
        repos: repositories,
      })
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
