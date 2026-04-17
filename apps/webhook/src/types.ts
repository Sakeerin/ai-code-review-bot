/** Environment bindings for the Cloudflare Worker */
export interface Env {
  // GitHub App secrets
  GITHUB_APP_ID: string
  GITHUB_APP_PRIVATE_KEY: string
  GITHUB_WEBHOOK_SECRET: string

  // GitLab integration
  GITLAB_WEBHOOK_SECRET: string
  GITLAB_TOKEN: string
  GITLAB_API_URL: string

  // Trigger.dev
  TRIGGER_SECRET_KEY: string

  // Database
  DATABASE_URL: string

  // KV
  RATE_LIMIT_KV: KVNamespace

  // Observability
  SENTRY_DSN: string

  // Worker env
  ENVIRONMENT: string
}

/** Supported GitHub webhook event types */
export type GitHubEventType =
  | 'pull_request'
  | 'installation'
  | 'ping'
  | string

export type GitLabEventType =
  | 'Merge Request Hook'
  | 'System Hook'
  | string

/** Pull request webhook payload (simplified) */
export interface PullRequestWebhookPayload {
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
        owner: {
          login: string
        }
        name: string
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

/** Installation webhook payload */
export interface InstallationWebhookPayload {
  action: 'created' | 'deleted' | 'suspend' | 'unsuspend' | 'new_permissions_accepted'
  installation: {
    id: number
    account: {
      login: string
      id: number
      type: string
    }
    app_id: number
    target_type: string
  }
  repositories?: Array<{
    id: number
    full_name: string
    private: boolean
  }>
  sender: {
    login: string
  }
}
