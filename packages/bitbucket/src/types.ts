export interface BitbucketClientConfig {
  username: string
  appPassword: string
  baseUrl?: string
}

export interface BitbucketPRFile {
  path: string
  newPath: string
  oldPath: string
  linesAdded: number
  linesRemoved: number
  status: 'added' | 'modified' | 'removed' | 'renamed'
}

export interface BitbucketPR {
  id: number
  title: string
  author: { nickname: string }
  source: {
    commit: { hash: string }
    branch: { name: string }
    repository: { full_name: string }
  }
  destination: {
    branch: { name: string }
    repository: { full_name: string }
  }
  links: { html: { href: string } }
}

/** Webhook payload for pullrequest:created / pullrequest:updated events */
export interface BitbucketWebhookPayload {
  actor: { nickname: string; display_name: string }
  pullrequest: {
    id: number
    title: string
    source: {
      commit: { hash: string }
      branch: { name: string }
      repository: { full_name: string; uuid: string }
    }
    destination: {
      branch: { name: string }
      repository: { full_name: string }
    }
    links: { html: { href: string } }
  }
  repository: {
    uuid: string
    full_name: string // "workspace/repo_slug"
    scm: string
  }
}
