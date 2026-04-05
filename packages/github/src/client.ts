import type { Octokit } from 'octokit'
import type {
  PullRequestInfo,
  PullRequestFile,
  ReviewCommentPayload,
} from './types.js'

/**
 * GitHub API client for PR review operations.
 * Requires an Octokit instance authenticated as an installation.
 */
export class GitHubClient {
  constructor(private octokit: Octokit) {}

  /**
   * Get pull request metadata.
   */
  async getPullRequest(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<PullRequestInfo> {
    const { data } = await this.octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    })

    return {
      number: data.number,
      title: data.title,
      author: data.user?.login ?? 'unknown',
      baseBranch: data.base.ref,
      headBranch: data.head.ref,
      htmlUrl: data.html_url,
      diffUrl: data.diff_url,
      additions: data.additions,
      deletions: data.deletions,
      changedFiles: data.changed_files,
    }
  }

  /**
   * Fetch the raw unified diff for a pull request.
   */
  async getPullRequestDiff(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<string> {
    const { data } = await this.octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
      mediaType: {
        format: 'diff',
      },
    })

    // When using diff format, data is returned as a string
    return data as unknown as string
  }

  /**
   * List all files changed in a pull request with patch data.
   */
  async getPullRequestFiles(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<PullRequestFile[]> {
    const files: PullRequestFile[] = []
    let page = 1

    // Paginate through all files (GitHub returns max 30 per page by default)
    while (true) {
      const { data } = await this.octokit.rest.pulls.listFiles({
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100,
        page,
      })

      if (data.length === 0) break

      for (const file of data) {
        files.push({
          filename: file.filename,
          status: file.status as PullRequestFile['status'],
          additions: file.additions,
          deletions: file.deletions,
          patch: file.patch,
          previousFilename: file.previous_filename,
        })
      }

      if (data.length < 100) break
      page++
    }

    return files
  }

  /**
   * Submit a pull request review with inline comments.
   * This creates a single review with multiple comments,
   * which is the preferred approach over individual comments.
   */
  async createReview(
    owner: string,
    repo: string,
    prNumber: number,
    body: string,
    event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT',
    comments: ReviewCommentPayload[],
  ): Promise<number> {
    const { data } = await this.octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: prNumber,
      body,
      event,
      comments: comments.map((c) => ({
        path: c.path,
        line: c.line,
        side: c.side,
        body: c.body,
      })),
    })

    return data.id
  }

  /**
   * Post a single comment on a pull request (not inline, just on the PR itself).
   * Useful for summary comments.
   */
  async createPRComment(
    owner: string,
    repo: string,
    prNumber: number,
    body: string,
  ): Promise<void> {
    await this.octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body,
    })
  }

  /**
   * Get the content of a file from the repository at a specific ref.
   * Useful for fetching .reviewbot.yml config.
   */
  async getFileContent(
    owner: string,
    repo: string,
    path: string,
    ref?: string,
  ): Promise<string | null> {
    try {
      const { data } = await this.octokit.rest.repos.getContent({
        owner,
        repo,
        path,
        ref,
      })

      if ('content' in data && data.encoding === 'base64') {
        return Buffer.from(data.content, 'base64').toString('utf-8')
      }

      return null
    } catch {
      // File not found — this is expected for repos without .reviewbot.yml
      return null
    }
  }
}
