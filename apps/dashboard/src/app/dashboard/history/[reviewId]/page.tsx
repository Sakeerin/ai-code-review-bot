import Link from "next/link"
import { auth } from "@repo/db/auth"
import { db } from "@repo/db/client"
import { repositories, reviewComments, reviews } from "@repo/db/schema"
import { asc, eq } from "@repo/db"
import { headers } from "next/headers"
import { notFound, redirect } from "next/navigation"
import { getUserOrg } from "@/lib/org"

function formatDate(date: Date | null) {
  if (!date) return "—"
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

function SeverityBadge({ severity }: { severity: string }) {
  const styles: Record<string, string> = {
    bug: "bg-red-100 text-red-800",
    suggestion: "bg-blue-100 text-blue-800",
    nitpick: "bg-yellow-100 text-yellow-800",
    praise: "bg-green-100 text-green-800",
  }

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[severity] ?? "bg-secondary text-muted-foreground"}`}>
      {severity}
    </span>
  )
}

export default async function ReviewReplayPage({
  params,
}: {
  params: Promise<{ reviewId: string }>
}) {
  const { reviewId } = await params
  const requestHeaders = await headers()
  const session = await auth.api.getSession({ headers: requestHeaders })

  if (!session?.user) {
    redirect("/")
  }

  const org = await getUserOrg(session.user.id)
  if (!org) {
    notFound()
  }

  const row = await db
    .select({
      review: reviews,
      repo: repositories,
    })
    .from(reviews)
    .innerJoin(repositories, eq(reviews.repoId, repositories.id))
    .where(eq(reviews.id, reviewId))
    .limit(1)
    .then((rows) => rows[0])

  if (!row || row.repo.orgId !== org.id) {
    notFound()
  }

  const comments = await db
    .select()
    .from(reviewComments)
    .where(eq(reviewComments.reviewId, reviewId))
    .orderBy(asc(reviewComments.file), asc(reviewComments.line))

  const commentsByFile = comments.reduce<Map<string, typeof comments>>((map, comment) => {
    const group = map.get(comment.file) ?? []
    group.push(comment)
    map.set(comment.file, group)
    return map
  }, new Map())

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link href="/dashboard/history" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
            ← Back to history
          </Link>
          <h1 className="text-3xl font-bold tracking-tight mt-2">Review Replay</h1>
          <p className="text-muted-foreground mt-1">
            {row.repo.fullName} · {row.review.provider} #{row.review.prNumber}
          </p>
        </div>
        {row.review.reviewUrl ? (
          <a
            href={row.review.reviewUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center justify-center rounded-md border border-border px-4 text-sm font-medium hover:bg-accent transition-colors"
          >
            Open source review
          </a>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="border border-border rounded-xl p-5 bg-card shadow-sm">
          <div className="text-sm text-muted-foreground">Score</div>
          <div className="text-2xl font-bold mt-2">{row.review.score ?? "—"}</div>
        </div>
        <div className="border border-border rounded-xl p-5 bg-card shadow-sm">
          <div className="text-sm text-muted-foreground">Comments</div>
          <div className="text-2xl font-bold mt-2">{row.review.commentsPosted}</div>
        </div>
        <div className="border border-border rounded-xl p-5 bg-card shadow-sm">
          <div className="text-sm text-muted-foreground">Bugs Found</div>
          <div className="text-2xl font-bold mt-2">{row.review.bugsFound ?? 0}</div>
        </div>
        <div className="border border-border rounded-xl p-5 bg-card shadow-sm">
          <div className="text-sm text-muted-foreground">Completed</div>
          <div className="text-sm font-medium mt-2">{formatDate(row.review.completedAt ?? row.review.createdAt)}</div>
        </div>
      </div>

      <div className="border border-border rounded-xl p-6 bg-card shadow-sm space-y-3">
        <div>
          <h2 className="font-semibold">Review Summary</h2>
          <p className="text-sm text-muted-foreground mt-1">{row.review.prTitle ?? `Review #${row.review.prNumber}`}</p>
        </div>
        <p className="whitespace-pre-wrap text-sm leading-6 text-foreground/90">
          {row.review.summary ?? "No summary was stored for this review."}
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <h2 className="font-semibold">Inline Comments</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Replay currently shows the saved AI comments and metadata for this review.
          </p>
        </div>

        {commentsByFile.size === 0 ? (
          <div className="border border-border border-dashed rounded-xl p-8 text-sm text-muted-foreground">
            No inline comments were saved for this review.
          </div>
        ) : (
          Array.from(commentsByFile.entries()).map(([file, fileComments]) => (
            <div key={file} className="border border-border rounded-xl overflow-hidden bg-card shadow-sm">
              <div className="px-5 py-4 border-b border-border bg-secondary/30">
                <div className="font-mono text-sm">{file}</div>
                <div className="text-xs text-muted-foreground mt-1">{fileComments.length} comment{fileComments.length !== 1 ? "s" : ""}</div>
              </div>
              <div className="divide-y divide-border">
                {fileComments.map((comment) => (
                  <div key={comment.id} className="p-5 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <SeverityBadge severity={comment.severity} />
                        <span className="text-xs text-muted-foreground">Line {comment.line}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{formatDate(comment.createdAt)}</span>
                    </div>
                    <p className="text-sm leading-6">{comment.message}</p>
                    {comment.suggestion ? (
                      <pre className="overflow-x-auto rounded-lg bg-secondary/50 p-4 text-xs leading-6">
                        <code>{comment.suggestion}</code>
                      </pre>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
