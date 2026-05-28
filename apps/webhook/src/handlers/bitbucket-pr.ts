import type { Context } from 'hono'
import type { AppEnv } from '../middleware/verify-signature.js'
import { tasks } from '@trigger.dev/sdk/v3'
import { z } from 'zod'

const BitbucketPRPayloadSchema = z.object({
  pullrequest: z.object({
    id: z.number(),
    title: z.string(),
    source: z.object({
      commit: z.object({ hash: z.string() }),
      branch: z.object({ name: z.string() }),
      repository: z.object({ full_name: z.string() }),
    }),
    destination: z.object({
      branch: z.object({ name: z.string() }),
      repository: z.object({ full_name: z.string() }),
    }),
    links: z.object({ html: z.object({ href: z.string() }) }),
  }),
  actor: z.object({ nickname: z.string() }),
  repository: z.object({
    full_name: z.string(),
    uuid: z.string().optional(),
  }),
})

export async function handleBitbucketPR(c: Context<AppEnv>): Promise<Response> {
  const rawBody = c.get('rawBody')

  let rawPayload: unknown
  try {
    rawPayload = JSON.parse(rawBody)
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const parsed = BitbucketPRPayloadSchema.safeParse(rawPayload)
  if (!parsed.success) {
    console.error('Invalid Bitbucket PR payload:', parsed.error.flatten())
    return c.json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400)
  }

  const { pullrequest: pr, actor, repository } = parsed.data
  const [workspace, repoSlug] = repository.full_name.split('/')

  if (!workspace || !repoSlug) {
    return c.json({ error: 'Invalid repository full_name' }, 400)
  }

  const jobPayload = {
    workspace,
    repoSlug,
    repoFullName: repository.full_name,
    prId: pr.id,
    prTitle: pr.title,
    prAuthor: actor.nickname,
    headCommitHash: pr.source.commit.hash,
    prUrl: pr.links.html.href,
    bitbucketUsername: c.env.BITBUCKET_USERNAME,
    bitbucketAppPassword: c.env.BITBUCKET_APP_PASSWORD,
  }

  console.log(`Bitbucket PR event: ${repository.full_name}#${pr.id} "${pr.title}"`)

  await tasks.trigger('review-bitbucket-pull-request', jobPayload)

  return c.json({
    status: 'accepted',
    message: `Review job dispatched for ${repository.full_name}#${pr.id}`,
  })
}
