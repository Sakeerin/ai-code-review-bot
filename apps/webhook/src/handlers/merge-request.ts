import type { Context } from 'hono'
import { tasks } from '@trigger.dev/sdk/v3'
import type { GitLabAppEnv } from '../middleware/verify-gitlab-signature.js'

const REVIEWABLE_ACTIONS = ['open', 'reopen', 'update']

export async function handleMergeRequest(c: Context<GitLabAppEnv>): Promise<Response> {
  const rawBody = c.get('rawBody')
  const payload = JSON.parse(rawBody) as {
    object_kind: string
    project: {
      id: number
      path_with_namespace: string
      web_url: string
    }
    object_attributes: {
      iid: number
      title: string
      action?: string
      last_commit?: { id?: string }
      url?: string
    }
    user?: {
      username?: string
      name?: string
    }
    project_namespace?: string
    group?: {
      name?: string
      path?: string
    }
  }

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
