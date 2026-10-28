import { auth } from '@repo/db/auth'
import { db } from '@repo/db/client'
import { organizations, userOrganizations } from '@repo/db/schema'
import { eq, and } from '@repo/db'
import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { getGitHubAccessToken, verifyInstallationOwner } from '@/lib/github-installation'

export default async function GithubAppSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  const installationId = params.installation_id

  if (!installationId) {
    redirect('/dashboard')
  }
  if (
    typeof installationId !== 'string' ||
    !/^[1-9]\d*$/.test(installationId) ||
    !Number.isSafeInteger(Number(installationId))
  )
    notFound()

  const requestHeaders = await headers()
  const session = await auth.api.getSession({ headers: requestHeaders })

  if (!session?.user) {
    redirect('/')
  }

  const accessToken = await getGitHubAccessToken(session.user.id, requestHeaders)
  if (!accessToken) notFound()
  const installation = await verifyInstallationOwner(accessToken, Number(installationId))
  if (!installation) notFound()

  // Upsert the organization record for this installation
  let org = await db.query.organizations.findFirst({
    where: eq(organizations.githubInstallationId, installationId),
  })

  if (!org) {
    const [newOrg] = await db
      .insert(organizations)
      .values({
        githubInstallationId: installationId,
        name: installation.login,
        plan: 'free',
      })
      .onConflictDoUpdate({
        target: organizations.githubInstallationId,
        set: { name: installation.login },
      })
      .returning()
    org = newOrg
  }

  // Link user → org if not already linked
  if (org) {
    const existing = await db.query.userOrganizations.findFirst({
      where: and(
        eq(userOrganizations.userId, session.user.id),
        eq(userOrganizations.orgId, org.id),
      ),
    })

    if (!existing) {
      await db
        .insert(userOrganizations)
        .values({
          userId: session.user.id,
          orgId: org.id,
          role: 'owner',
        })
        .onConflictDoNothing()
    }
  }

  return (
    <div className="max-w-md mx-auto mt-20 p-8 border border-border rounded-xl bg-card text-center shadow-sm space-y-4">
      <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto text-2xl">
        ✓
      </div>
      <h2 className="text-xl font-bold tracking-tight">GitHub App Installed!</h2>
      <p className="text-muted-foreground text-sm">
        Installation <span className="font-mono font-medium">#{installationId}</span> is now linked
        to your account. Repositories will appear automatically once the app has access.
      </p>
      <a
        href="/dashboard"
        className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        Go to Dashboard
      </a>
    </div>
  )
}
