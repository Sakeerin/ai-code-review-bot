import { auth, tasks, type TriggerOptions } from '@trigger.dev/sdk/v3'
import type { Env } from '../types.js'
import { createDb } from '@repo/db'
import { dispatchReviewJobs } from '@repo/db/review-dispatch'

/** Workers expose secrets through bindings rather than process.env. */
export async function triggerTask(
  env: Pick<Env, 'TRIGGER_SECRET_KEY' | 'DATABASE_URL'>,
  taskId: string,
  payload: Record<string, unknown>,
  options?: TriggerOptions,
): Promise<void> {
  const send = async (id: string, data: Record<string, unknown>, settings?: TriggerOptions) => {
    if (!env.TRIGGER_SECRET_KEY) throw new Error('Trigger.dev secret key is not configured')
    return auth.withAuth({ accessToken: env.TRIGGER_SECRET_KEY }, () =>
      tasks.trigger(id, data, settings),
    )
  }
  if (typeof payload.reservationKey === 'string') {
    const database = createDb(env.DATABASE_URL, 1)
    try {
      await dispatchReviewJobs(
        database,
        (job) => send(job.taskId, job.payload, job.options),
        payload.reservationKey,
      )
    } finally {
      await database.$client.end?.({ timeout: 1 })
    }
  } else await send(taskId, payload, options)
}
