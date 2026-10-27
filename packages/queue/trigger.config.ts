import type { TriggerConfig } from '@trigger.dev/sdk/v3'

const projectId = process.env.TRIGGER_PROJECT_ID
if (!projectId)
  throw new Error('Set TRIGGER_PROJECT_ID in the root .env for your Trigger.dev project')

export const config: TriggerConfig = {
  project: projectId,
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      factor: 2,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 30000,
    },
  },
  dirs: ['./src/tasks'],
}

export default config
