import type { Context } from 'hono'
import { tasks } from '@trigger.dev/sdk/v3'
import type { GitLabAppEnv } from '../middleware/verify-gitlab-signature.js'
import { z } from 'zod'

const REVIEWABLE_ACTIONS = ['open', 'reopen', 'update']

const MergeRequestPayloadSchema = z.object({
  object_kind: z.string(),
  project: z.object({
    id: z.number(),
    path_with_namespace: z.string(),
    web_url: z.string().optional(),
  }),
  object_attributes: z.object({
    iid: z.number(),
    title: z.string(),
    action: z.string().optional(),
  }),
  user: z.object({
    username: z.string().optional(),
    name: z.string().optional(),
  }).optional(),
  project_namespace: z.string().optional(),
  group: z.object({
    name: z.string().optional(),
    path: z.string().optional(),
  }).optional(),
})

export async function handleMergeRequest(c: Context<GitLabAppEnv>): Promise<Response> {
  const rawBody = c.get('rawBody')

  const parsed = MergeRequestPayloadSchema.safeParse(JSON.parse(rawBody))
  if (!parsed.success) {
    console.error('❌ Invalid merge_request payload:', parsed.error.flatten())
    return c.json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400)
  }
  const payload = parsed.data

  const action = payload.object_attributes.action ?? 'update'
  if (!REVIEWABLE_ACTIONS.includes(action)) {
    return c.json({
      status: 'skipped',
      reason: `Action "${action}" is not reviewable`,
    })
  }

  const jobPayload = {
    projectId: payload.project.id,
    projectPath: payload.project.path_with_namespace,
    projectWebUrl: payload.project.web_url,
    mergeRequestIid: payload.object_attributes.iid,
    mergeRequestTitle: payload.object_attributes.title,
    mergeRequestAuthor: payload.user?.username ?? payload.user?.name ?? 'unknown',
    rootNamespace:
      payload.group?.path ?? payload.project_namespace ?? payload.project.path_with_namespace.split('/')[0],
  }

  await tasks.trigger('review-merge-request', jobPayload)

  return c.json({
    status: 'accepted',
    message: `Review job dispatched for ${payload.project.path_with_namespace}!${payload.object_attributes.iid}`,
    job: jobPayload,
  })
}
