import Link from "next/link"
import { auth } from "@repo/db/auth"
import { db } from "@repo/db/client"
import { repositories, reviews } from "@repo/db/schema"
import { desc, eq } from "@repo/db"
import { headers } from "next/headers"
import { notFound, redirect } from "next/navigation"
import { getUserOrg } from "@/lib/org"
import { RepoToggle } from "@/components/repo-toggle"

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-muted-foreground">—</span>
  const color = score >= 80 ? "text-green-700" : score >= 60 ? "text-yellow-700" : "text-red-700"
  return <span className={`font-bold tabular-nums ${color}`}>{score}</span>
}

function formatDate(date: Date | null) {
  if (!date) return "—"
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date)
}

export default async function RepoDetailPage({
  params,
}: {
  params: Promise<{ repoId: string }>
}) {
  const { repoId } = await params
  const requestHeaders = await headers()
  const session = await auth.api.getSession({ headers: requestHeaders })

  if (!session?.user) {
    redirect("/")
  }

  const org = await getUserOrg(session.user.id)
  if (!org) {
    notFound()
  }

  const repo = await db.query.repositories.findFirst({
    where: eq(repositories.id, repoId),
  })

  if (!repo || repo.orgId !== org.id) {
    notFound()
  }

  const recentReviews = await db
    .select()
    .from(reviews)
    .where(eq(reviews.repoId, repoId))
    .orderBy(desc(reviews.createdAt))
    .limit(10)

  const externalUrl =
    repo.webUrl ??
    (repo.provider === "gitlab"
      ? `https://gitlab.com/${repo.fullName}`
      : `https://github.com/${repo.fullName}`)

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/dashboard/repos" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
            ← Back to repositories
          </Link>
          <h1 className="text-3xl font-bold tracking-tight mt-2 font-mono">{repo.fullName}</h1>
          <div className="flex items-center gap-3 mt-2">
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${repo.provider === "gitlab" ? "bg-orange-100 text-orange-800" : "bg-slate-100 text-slate-800"}`}>
              {repo.provider}
            </span>
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${repo.isActive ? "bg-green-100 text-green-800" : "bg-secondary text-muted-foreground"}`}>
              {repo.isActive ? "Active" : "Inactive"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <a
            href={externalUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center justify-center rounded-md border border-border px-4 text-sm font-medium hover:bg-accent transition-colors"
          >
            View Repo →
          </a>
          <RepoToggle repoId={repo.id} isActive={repo.isActive ?? true} />
        </div>
      </div>

      {/* ── Convention Profile ────────────────────────────────── */}
      <section className="border border-border rounded-xl p-6 bg-card shadow-sm space-y-3">
        <div>
          <h2 className="font-semibold">Convention Profile (.reviewbot.yml)</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Stored from the last review. Edit the file directly in your repository.
          </p>
        </div>
        {repo.conventionProfile ? (
          <pre className="overflow-x-auto rounded-lg bg-secondary/50 p-4 text-xs leading-5 font-mono whitespace-pre-wrap">
            {repo.conventionProfile}
          </pre>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            No .reviewbot.yml found — using default settings.
          </p>
        )}
      </section>

      {/* ── Recent Reviews ────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="font-semibold">Recent Reviews</h2>
        {recentReviews.length === 0 ? (
          <div className="border border-border border-dashed rounded-xl p-8 text-sm text-muted-foreground text-center">
            No reviews yet for this repository.
          </div>
        ) : (
          <div className="border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">PR / MR</th>
                  <th className="text-center px-4 py-3 font-medium text-muted-foreground">Score</th>
                  <th className="text-center px-4 py-3 font-medium text-muted-foreground">Bugs</th>
                  <th className="text-center px-4 py-3 font-medium text-muted-foreground">Status</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recentReviews.map((review) => (
                  <tr key={review.id} className="hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium">#{review.prNumber}</div>
                      {review.prTitle && (
                        <div className="text-xs text-muted-foreground truncate max-w-[200px]">{review.prTitle}</div>
                      )}
                      <Link href={`/dashboard/history/${review.id}`} className="text-xs text-muted-foreground hover:text-foreground hover:underline">
                        Open replay
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <ScoreBadge score={review.score} />
                    </td>
                    <td className="px-4 py-3 text-center tabular-nums">{review.bugsFound ?? 0}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        review.status === "completed" ? "bg-green-100 text-green-800" :
                        review.status === "failed" ? "bg-red-100 text-red-800" :
                        "bg-secondary text-muted-foreground"
                      }`}>
                        {review.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-muted-foreground whitespace-nowrap">
                      {formatDate(review.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
