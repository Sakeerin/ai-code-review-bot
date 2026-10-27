import { auth, tasks, type TriggerOptions } from '@trigger.dev/sdk/v3'
import type { Env } from '../types.js'

/** Workers expose secrets through bindings rather than process.env. */
export async function triggerTask(
  env: Pick<Env, 'TRIGGER_SECRET_KEY'>,
  taskId: string,
  payload: Record<string, unknown>,
  options?: TriggerOptions,
): Promise<void> {
  if (!env.TRIGGER_SECRET_KEY) throw new Error('Trigger.dev secret key is not configured')
  await auth.withAuth({ accessToken: env.TRIGGER_SECRET_KEY }, () =>
    tasks.trigger(taskId, payload, options),
  )
}
