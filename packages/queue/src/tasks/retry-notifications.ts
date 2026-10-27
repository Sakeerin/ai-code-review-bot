import { schedules } from '@trigger.dev/sdk/v3'
import { createDb } from '@repo/db'
import { drainNotificationOutbox } from '../lib/notification-outbox.js'

export const retryNotificationsTask = schedules.task({
  id: 'retry-notifications',
  cron: '*/5 * * * *',
  run: async () => drainNotificationOutbox(createDb(undefined, 2)),
})
