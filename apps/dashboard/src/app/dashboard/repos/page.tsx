import Link from "next/link"
import { auth } from "@repo/db/auth"
import { db } from "@repo/db/client"
import { repositories } from "@repo/db/schema"
import { eq } from "@repo/db"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { getUserOrg } from "@/lib/org"

export default async function RepositoriesPage() {
  const requestHeaders = await headers()
  const session = await auth.api.getSession({ headers: requestHeaders })

  if (!session?.user) {
    redirect("/")
  }

  const org = await getUserOrg(session.user.id)

  const repos = org
    ? await db.query.repositories.findMany({
        where: eq(repositories.orgId, org.id),
        orderBy: (r, { desc }) => [desc(r.createdAt)],
      })
    : []

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Repositories</h1>
          {org && (
            <p className="text-sm text-muted-foreground mt-1">
              {org.name} ยท {repos.length} repo{repos.length !== 1 ? "s" : ""}
            </p>
          )}
        </div>
      </div>

      {!org ? (
        <div className="border border-border border-dashed rounded-xl p-12 text-center space-y-4">
          <p className="text-muted-foreground">You haven&apos;t linked a GitHub App installation yet.</p>
          <a
            href={`https://github.com/apps/${process.env.GITHUB_APP_SLUG ?? "ai-review-bot"}/installations/new`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
          >
            Install GitHub App
          </a>
        </div>
      ) : repos.length === 0 ? (
        <div className="border border-border border-dashed rounded-xl p-12 text-center">
          <p className="text-muted-foreground">
            No repositories found. Make sure your GitHub App or GitLab webhook integration is active.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {repos.map((repo) => (
            <div
              key={repo.id}
              className="border border-border rounded-xl p-6 bg-card text-card-foreground shadow-sm flex flex-col justify-between"
            >
              <div>
                <h3 className="font-semibold text-lg">{repo.fullName}</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Profile:{" "}
                  {repo.conventionProfile ? (
                    <span className="font-mono text-xs bg-secondary px-1 py-0.5 rounded">
                      {repo.conventionProfile.substring(0, 40)}
                      {repo.conventionProfile.length > 40 ? "..." : ""}
                    </span>
                  ) : (
                    "Default"
                  )}
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  Platform: <span className="capitalize">{repo.provider}</span>
                </p>
              </div>
              <div className="mt-4 flex items-center justify-between">
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                    repo.isActive ? "bg-green-100 text-green-800" : "bg-secondary text-muted-foreground"
                  }`}
                >
                  {repo.isActive ? "Active" : "Inactive"}
                </span>
                <div className="flex items-center gap-3">
                  <Link
                    href={`/dashboard/repos/${repo.id}`}
                    className="text-sm text-muted-foreground hover:text-foreground hover:underline"
                  >
                    Settings
                  </Link>
                  <a
                    href={
                      repo.webUrl ??
                      (repo.provider === "gitlab"
                        ? `https://gitlab.com/${repo.fullName}`
                        : `https://github.com/${repo.fullName}`)
                    }
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-muted-foreground hover:text-foreground hover:underline"
                  >
                    View Repository →
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
