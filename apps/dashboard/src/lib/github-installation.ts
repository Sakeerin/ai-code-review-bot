import { createAppOctokit } from '@repo/github'
import { auth } from '@repo/db/auth'
import { db } from '@repo/db/client'
import { account } from '@repo/db/schema'
import { and, eq } from '@repo/db'

/** Better Auth 1.7 selects accounts by their internal ID, scoped to the session user. */
export async function getGitHubAccessToken(userId: string, requestHeaders: Headers) {
  const github = await db.query.account.findFirst({
    where: and(eq(account.userId, userId), eq(account.providerId, 'github')),
  })
  if (!github) return null
  const { accessToken } = await auth.api.getAccessToken({
    headers: requestHeaders,
    body: { accountId: github.id },
  })
  return accessToken ?? null
}

/** Verify administrative access, not merely access to one repository in an org. */
export async function verifyInstallationOwner(accessToken: string, installationId: number) {
  const appId = process.env.GITHUB_APP_ID
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY
  if (!appId || !privateKey) throw new Error('GitHub App credentials are not configured')

  const app = createAppOctokit({ appId, privateKey, webhookSecret: '' })
  let installation
  try {
    ;({ data: installation } = await app.rest.apps.getInstallation({
      installation_id: installationId,
    }))
  } catch (error) {
    if ((error as { status?: number }).status === 404) return null
    throw error
  }
  if (String(installation.app_id) !== appId || installation.suspended_at || !installation.account)
    return null

  const request = async (path: string) => {
    const response = await fetch(`https://api.github.com${path}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' },
      cache: 'no-store',
    })
    if ([401, 403, 404].includes(response.status)) return null
    if (!response.ok) throw new Error(`GitHub ownership check failed (${response.status})`)
    return response.json()
  }

  const githubUser = (await request('/user')) as { id: number } | null
  if (!githubUser) return null
  const account = installation.account
  if (!('login' in account)) return null
  if (installation.target_type === 'User') {
    return account.id === githubUser.id ? { login: account.login } : null
  }
  if (installation.target_type !== 'Organization') return null
  const membership = (await request(
    `/user/memberships/orgs/${encodeURIComponent(account.login)}`,
  )) as {
    role: string
    state: string
  } | null
  return membership?.role === 'admin' && membership.state === 'active'
    ? { login: account.login }
    : null
}
