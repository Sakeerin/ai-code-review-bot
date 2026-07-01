/**
 * AI Review Bot — MCP Server
 *
 * Exposes review data and AI capabilities via the Model Context Protocol,
 * allowing Claude Desktop, Cursor, and other MCP-compatible IDEs to:
 *   - Query review history for a repository
 *   - Get detailed review comments for a specific PR
 *   - Generate a .reviewbot.yml convention profile from file samples
 *   - Run an on-demand diff review without opening a PR
 *
 * Run with: bun run apps/mcp-server/src/index.ts
 * Add to claude_desktop_config.json or cursor settings as a stdio MCP server.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'
import { createDb, repositories, reviews, eq, and, desc, gte, sql } from '@repo/db'
import { reviewDiff, parseReviewBotConfig, generateConventionProfile } from '@repo/ai'
import type { RepoFileSample } from '@repo/ai'

const server = new Server(
  { name: 'ai-review-bot', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

// ── Tool Definitions ──────────────────────────────────────────────

const TOOLS: Tool[] = [
  {
    name: 'list_reviews',
    description: 'List recent AI code reviews for a repository. Returns review summaries with scores and bug counts.',
    inputSchema: {
      type: 'object',
      properties: {
        repoFullName: { type: 'string', description: 'Repository full name, e.g. "owner/repo"' },
        limit: { type: 'number', description: 'Number of reviews to return (default 10, max 50)', default: 10 },
        since: { type: 'string', description: 'ISO date string to filter reviews after this date' },
      },
      required: ['repoFullName'],
    },
  },
  {
    name: 'get_review',
    description: 'Get full details of a specific review, including all inline comments.',
    inputSchema: {
      type: 'object',
      properties: {
        reviewId: { type: 'string', description: 'Review UUID from list_reviews' },
      },
      required: ['reviewId'],
    },
  },
  {
    name: 'generate_profile',
    description: 'Analyze code samples and generate a .reviewbot.yml convention profile for a repository.',
    inputSchema: {
      type: 'object',
      properties: {
        repoFullName: { type: 'string', description: 'Repository full name' },
        files: {
          type: 'array',
          description: 'Array of file samples to analyze',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              content: { type: 'string' },
            },
            required: ['path', 'content'],
          },
        },
      },
      required: ['repoFullName', 'files'],
    },
  },
  {
    name: 'review_diff',
    description: 'Run an AI code review on a diff string without opening a PR. Returns structured comments and a score.',
    inputSchema: {
      type: 'object',
      properties: {
        diff: { type: 'string', description: 'Unified diff string to review' },
        profile: { type: 'string', description: 'Convention profile: typescript, laravel, vue (default: typescript)', default: 'typescript' },
        language: { type: 'string', description: 'Language for comments: en or th (default: en)', default: 'en' },
      },
      required: ['diff'],
    },
  },
  {
    name: 'repo_stats',
    description: 'Get review statistics for a repository over a time period.',
    inputSchema: {
      type: 'object',
      properties: {
        repoFullName: { type: 'string', description: 'Repository full name' },
        days: { type: 'number', description: 'Number of days to look back (default 30)', default: 30 },
      },
      required: ['repoFullName'],
    },
  },
]

// ── Tool Handler ──────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params
  const db = createDb(undefined, 1)

  try {
    switch (name) {
      case 'list_reviews': {
        const { repoFullName, limit = 10, since } = args as {
          repoFullName: string; limit?: number; since?: string
        }
        const repo = await db.query.repositories.findFirst({
          where: eq(repositories.fullName, repoFullName),
        })
        if (!repo) return textResult(`Repository "${repoFullName}" not found in database.`)

        const conditions = [eq(reviews.repoId, repo.id), eq(reviews.status, 'completed')]
        if (since) conditions.push(gte(reviews.createdAt, new Date(since)))

        const rows = await db
          .select({
            id: reviews.id,
            prNumber: reviews.prNumber,
            prTitle: reviews.prTitle,
            prAuthor: reviews.prAuthor,
            score: reviews.score,
            bugsFound: reviews.bugsFound,
            commentsPosted: reviews.commentsPosted,
            summary: reviews.summary,
            createdAt: reviews.createdAt,
            reviewUrl: reviews.reviewUrl,
          })
          .from(reviews)
          .where(and(...conditions))
          .orderBy(desc(reviews.createdAt))
          .limit(Math.min(limit, 50))

        return jsonResult(rows)
      }

      case 'get_review': {
        const { reviewId } = args as { reviewId: string }
        const review = await db.query.reviews.findFirst({
          where: eq(reviews.id, reviewId),
          with: { comments: true },
        })
        if (!review) return textResult(`Review "${reviewId}" not found.`)
        return jsonResult(review)
      }

      case 'generate_profile': {
        const { repoFullName, files } = args as { repoFullName: string; files: RepoFileSample[] }
        const result = await generateConventionProfile(files, repoFullName)
        return textResult(result.yaml)
      }

      case 'review_diff': {
        const { diff, profile = 'typescript', language = 'en' } = args as {
          diff: string; profile?: string; language?: string
        }
        const config = parseReviewBotConfig(`profile: ${profile}\nlanguage: ${language}`)
        const result = await reviewDiff(diff, config)
        return jsonResult({
          score: result.score,
          summary: result.summary,
          comments: result.comments,
          tokensUsed: result.tokensInput + result.tokensOutput,
        })
      }

      case 'repo_stats': {
        const { repoFullName, days = 30 } = args as { repoFullName: string; days?: number }
        const repo = await db.query.repositories.findFirst({
          where: eq(repositories.fullName, repoFullName),
        })
        if (!repo) return textResult(`Repository "${repoFullName}" not found.`)

        const since = new Date()
        since.setDate(since.getDate() - days)

        const [stats] = await db
          .select({
            totalReviews: sql<number>`count(*)::int`,
            totalBugs: sql<number>`coalesce(sum(${reviews.bugsFound}), 0)::int`,
            avgScore: sql<number | null>`avg(${reviews.score})`,
            totalTokens: sql<number>`coalesce(sum(${reviews.tokensInput} + ${reviews.tokensOutput}), 0)::int`,
          })
          .from(reviews)
          .where(and(
            eq(reviews.repoId, repo.id),
            eq(reviews.status, 'completed'),
            gte(reviews.createdAt, since),
          ))

        return jsonResult({
          repository: repoFullName,
          periodDays: days,
          totalReviews: stats?.totalReviews ?? 0,
          totalBugsFound: stats?.totalBugs ?? 0,
          averageScore: stats?.avgScore ? Math.round(stats.avgScore) : null,
          totalTokensUsed: stats?.totalTokens ?? 0,
        })
      }

      default:
        return textResult(`Unknown tool: ${name}`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return textResult(`Error: ${message}`)
  }
})

// ── Helpers ───────────────────────────────────────────────────────

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] }
}

function jsonResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}

// ── Start ─────────────────────────────────────────────────────────

const transport = new StdioServerTransport()
await server.connect(transport)
console.error('AI Review Bot MCP server started (stdio)')
