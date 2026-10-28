import { schedules, tasks } from '@trigger.dev/sdk/v3'
import { createDb } from '@repo/db'
import { dispatchReviewJobs } from '@repo/db/review-dispatch'

export const retryReviewDispatchTask = schedules.task({
  id: 'retry-review-dispatch',
  cron: '* * * * *',
  run: async () =>
    dispatchReviewJobs(createDb(undefined, 2), (job) =>
      tasks.trigger(job.taskId, job.payload, job.options),
    ),
})
