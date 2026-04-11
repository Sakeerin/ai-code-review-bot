import { auth } from "@repo/db/auth"
import { db } from "@repo/db/client"
import { repositories, reviews } from "@repo/db/schema"
import { desc, eq } from "@repo/db"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { getUserOrg } from "@/lib/org"

const STATUS_STYLES: Record<string, string> = {
  completed:  "bg-green-100 text-green-800",
  processing: "bg-blue-100 text-blue-800",
  pending:    "bg-yellow-100 text-yellow-800",
  failed:     "bg-red-100 text-red-800",
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-muted-foreground">—</span>
  const color =
    score >= 80 ? "text-green-700" :
    score >= 60 ? "text-yellow-700" :
    "text-red-700"
  return <span className={`font-bold tabular-nums ${color}`}>{score}</span>
}

function formatDate(date: Date | null) {
  if (!date) return "—"
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

export default async function ReviewHistoryPage() {
  const requestHeaders = await headers()
  const session = await auth.api.getSession({ headers: requestHeaders })

  if (!session?.user) {
    redirect("/")
  }

  const org = await getUserOrg(session.user.id)

  // Fetch last 50 reviews across all org repos
  const rows = org
    ? await db
        .select({
          review: reviews,
          repoFullName: repositories.fullName,
        })
        .from(reviews)
        .innerJoin(repositories, eq(reviews.repoId, repositories.id))
        .where(eq(repositories.orgId, org.id))
        .orderBy(desc(reviews.createdAt))
        .limit(50)
    : []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Review History</h1>
        <p className="text-muted-foreground mt-1">Last {rows.length} PR reviews</p>
      </div>

      {rows.length === 0 ? (
        <div className="border border-border border-dashed rounded-xl p-12 text-center">
          <p className="text-muted-foreground">
            {org
              ? "No reviews yet. Open a pull request in a connected repository to trigger your first review."
              : "Install the GitHub App first to start reviewing pull requests."}
          </p>
        </div>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Repository</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">PR</th>
                <th className="text-center px-4 py-3 font-medium text-muted-foreground">Score</th>
                <th className="text-center px-4 py-3 font-medium text-muted-foreground">Bugs</th>
                <th className="text-center px-4 py-3 font-medium text-muted-foreground">Comments</th>
                <th className="text-center px-4 py-3 font-medium text-muted-foreground">Status</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(({ review, repoFullName }) => (
                <tr key={review.id} className="hover:bg-secondary/30 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {repoFullName}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">#{review.prNumber}</div>
                    {review.prTitle && (
                      <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                        {review.prTitle}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <ScoreBadge score={review.score} />
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums">
                    {review.bugsFound ?? 0}
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums">
                    {review.commentsPosted}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[review.status] ?? "bg-secondary text-muted-foreground"}`}
                    >
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
    </div>
  )
}
