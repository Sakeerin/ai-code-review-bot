import { PullRequestPayloadSchema } from '../handlers/pull-request.js'
import { MergeRequestPayloadSchema } from '../handlers/merge-request.js'
import { BitbucketPRPayloadSchema } from '../handlers/bitbucket-pr.js'
import type { ReviewJob } from '@repo/db/review-dispatch'

export function createReviewJob(provider: string, raw: unknown, reservationKey: string): ReviewJob {
  if (provider === 'github') {
    const { installation, repository, pull_request: pr } = PullRequestPayloadSchema.parse(raw)
    if (!installation) throw new Error('Missing installation')
    const key = `github:${installation.id}:${repository.id}:${pr.number}`
    return {
      taskId: 'review-pull-request',
      payload: {
        reservationKey,
        installationId: installation.id,
        githubRepoId: repository.id,
        repoFullName: repository.full_name,
        prNumber: pr.number,
        prTitle: pr.title,
        prAuthor: pr.user.login,
        headSha: pr.head.sha,
      },
      options: { concurrencyKey: key, idempotencyKey: `${key}:${pr.head.sha}` },
    }
  }
  if (provider === 'gitlab') {
    const p = MergeRequestPayloadSchema.parse(raw)
    const mr = p.object_attributes
    if (!mr.last_commit?.id) throw new Error('Missing head commit')
    const key = `gitlab:${p.project.id}:${mr.iid}`
    return {
      taskId: 'review-merge-request',
      payload: {
        reservationKey,
        projectId: p.project.id,
        projectPath: p.project.path_with_namespace,
        projectWebUrl: p.project.web_url,
        mergeRequestIid: mr.iid,
        headSha: mr.last_commit.id,
        mergeRequestTitle: mr.title,
        mergeRequestAuthor: p.user?.username ?? p.user?.name ?? 'unknown',
        rootNamespace: p.project.path_with_namespace.split('/')[0],
      },
      options: { concurrencyKey: key, idempotencyKey: `${key}:${mr.last_commit.id}` },
    }
  }
  const { repository, pullrequest: pr, actor } = BitbucketPRPayloadSchema.parse(raw)
  const [workspace, repoSlug] = repository.full_name.split('/')
  const key = `bitbucket:${repository.full_name}:${pr.id}`
  return {
    taskId: 'review-bitbucket-pull-request',
    payload: {
      reservationKey,
      workspace,
      repoSlug,
      repoFullName: repository.full_name,
      prId: pr.id,
      prTitle: pr.title,
      prAuthor: actor.nickname,
      headCommitHash: pr.source.commit.hash,
      prUrl: pr.links.html.href,
    },
    options: { concurrencyKey: key, idempotencyKey: `${key}:${pr.source.commit.hash}` },
  }
}
