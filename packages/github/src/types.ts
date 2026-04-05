/** Type definitions for GitHub API interactions */

export interface GitHubAppConfig {
  appId: string
  privateKey: string
  webhookSecret: string
}

export interface PullRequestInfo {
  number: number
  title: string
  author: string
  baseBranch: string
  headBranch: string
  htmlUrl: string
  diffUrl: string
  additions: number
  deletions: number
  changedFiles: number
}

export interface PullRequestFile {
  filename: string
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged'
  additions: number
  deletions: number
  patch?: string
  previousFilename?: string
}

export interface ReviewCommentPayload {
  path: string
  line: number
  side: 'RIGHT' | 'LEFT'
  body: string
}

export interface CreateReviewPayload {
  owner: string
  repo: string
  prNumber: number
  body: string
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'
  comments: ReviewCommentPayload[]
}

export interface WebhookPullRequestPayload {
  action: string
  number: number
  pull_request: {
    number: number
    title: string
    user: {
      login: string
    }
    base: {
      ref: string
      repo: {
        full_name: string
      }
    }
    head: {
      ref: string
      sha: string
    }
    html_url: string
    diff_url: string
    additions: number
    deletions: number
    changed_files: number
  }
  repository: {
    id: number
    full_name: string
    owner: {
      login: string
    }
    name: string
  }
  installation?: {
    id: number
  }
  sender: {
    login: string
  }
}
