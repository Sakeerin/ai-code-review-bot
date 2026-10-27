import { createHash } from 'node:crypto'
import { type Database, reviews, reviewRuns, eq } from '@repo/db'
import { ReviewSchema, type ReviewResult, type ReviewTokenUsage } from '@repo/ai'

export function makeReviewKey(provider: string, repoId: string, prNumber: number, headSha: string) {
  return createHash('sha256')
    .update(JSON.stringify([provider, repoId, prNumber, headSha]))
    .digest('hex')
}

export function reviewMarker(key: string, step = 'summary') {
  return `<!-- reviewbot:${key}:${step} -->`
}

export async function reviewIsCompleted(db: Database, reviewKey: string) {
  return !!(await db.query.reviews.findFirst({ where: eq(reviews.reviewKey, reviewKey) }))
}

/** Called inside a Trigger queue serialized by PR, including task retries. */
export async function cachedReview(
  db: Database,
  reviewKey: string,
  repoId: string,
  generate: () => Promise<ReviewResult & ReviewTokenUsage>,
): Promise<ReviewResult & ReviewTokenUsage> {
  const previous = await db.query.reviewRuns.findFirst({
    where: eq(reviewRuns.reviewKey, reviewKey),
  })
  if (previous) {
    const result = previous.result as ReviewResult & ReviewTokenUsage
    return {
      ...ReviewSchema.parse(result),
      tokensInput: result.tokensInput,
      tokensOutput: result.tokensOutput,
    }
  }
  const result = await generate()
  // Commit the inference before performing any remote write.
  await db.insert(reviewRuns).values({ reviewKey, repoId, result }).onConflictDoNothing()
  return result
}
