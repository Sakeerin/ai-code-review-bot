import type { BitbucketClientConfig, BitbucketPRFile, BitbucketPR } from './types.js'

export class BitbucketClient {
  private readonly baseUrl: string
  private readonly authHeader: string

  constructor(config: BitbucketClientConfig) {
    this.baseUrl = (config.baseUrl ?? 'https://api.bitbucket.org/2.0').replace(/\/$/, '')
    if (config.apiToken) this.authHeader = `Bearer ${config.apiToken}`
    else if (config.username && config.appPassword)
      this.authHeader = `Basic ${Buffer.from(`${config.username}:${config.appPassword}`).toString('base64')}`
    else throw new Error('Bitbucket API token is not configured')
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = new URL(path.startsWith('/') ? `${this.baseUrl}${path}` : path)
    const base = new URL(this.baseUrl)
    if (url.origin !== base.origin || !url.pathname.startsWith(`${base.pathname}/`))
      throw new Error('Invalid Bitbucket pagination URL')
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(options.headers as Record<string, string> | undefined),
      },
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '(no body)')
      throw Object.assign(new Error(`Bitbucket API ${res.status} ${res.statusText}: ${body}`), {
        status: res.status,
      })
    }
    return res.json() as Promise<T>
  }

  async getPullRequest(workspace: string, repoSlug: string, prId: number): Promise<BitbucketPR> {
    return this.request(`/repositories/${workspace}/${repoSlug}/pullrequests/${prId}`)
  }

  /** Returns the unified diff as a plain-text string */
  async getPullRequestDiff(workspace: string, repoSlug: string, prId: number): Promise<string> {
    const url = `${this.baseUrl}/repositories/${workspace}/${repoSlug}/pullrequests/${prId}/diff`
    const res = await fetch(url, {
      headers: { Authorization: this.authHeader, Accept: 'text/plain' },
    })
    if (!res.ok) {
      throw new Error(`Bitbucket diff error ${res.status}: ${await res.text()}`)
    }
    return res.text()
  }

  async getPullRequestFiles(
    workspace: string,
    repoSlug: string,
    prId: number,
  ): Promise<BitbucketPRFile[]> {
    interface DiffstatEntry {
      status: 'added' | 'modified' | 'removed' | 'renamed'
      lines_added: number
      lines_removed: number
      new?: { path: string }
      old?: { path: string }
    }
    interface DiffstatResponse {
      values: DiffstatEntry[]
      next?: string
    }

    const entries: DiffstatEntry[] = []
    let next: string | undefined =
      `/repositories/${workspace}/${repoSlug}/pullrequests/${prId}/diffstat`
    const visited = new Set<string>()
    while (next) {
      if (visited.has(next) || visited.size >= 100)
        throw new Error('Bitbucket pagination limit exceeded')
      visited.add(next)
      const data: DiffstatResponse = await this.request<DiffstatResponse>(next)
      entries.push(...data.values)
      next = data.next
    }
    return entries.map((f) => ({
      path: f.new?.path ?? f.old?.path ?? '',
      newPath: f.new?.path ?? '',
      oldPath: f.old?.path ?? '',
      linesAdded: f.lines_added,
      linesRemoved: f.lines_removed,
      status: f.status,
    }))
  }

  async getFileContent(
    workspace: string,
    repoSlug: string,
    filePath: string,
    commitHash: string,
  ): Promise<string | null> {
    const url = `${this.baseUrl}/repositories/${workspace}/${repoSlug}/src/${commitHash}/${filePath}`
    const res = await fetch(url, { headers: { Authorization: this.authHeader } })
    if (res.status === 404) return null
    if (!res.ok)
      throw Object.assign(new Error(`Bitbucket file download failed (${res.status})`), {
        status: res.status,
      })
    return res.text()
  }

  async createPRComment(
    workspace: string,
    repoSlug: string,
    prId: number,
    body: string,
  ): Promise<void> {
    await this.request(`/repositories/${workspace}/${repoSlug}/pullrequests/${prId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content: { raw: body } }),
    })
  }

  async getCommentBodies(workspace: string, repoSlug: string, prId: number): Promise<string[]> {
    const bodies: string[] = []
    for (let page = 1; ; page++) {
      const data = await this.request<{
        values: Array<{ deleted?: boolean; content?: { raw?: string } }>
        next?: string
      }>(
        `/repositories/${workspace}/${repoSlug}/pullrequests/${prId}/comments?pagelen=100&page=${page}`,
      )
      bodies.push(
        ...data.values
          .filter((comment) => !comment.deleted)
          .map((comment) => comment.content?.raw ?? ''),
      )
      if (!data.next) return bodies
    }
  }

  async createInlineComment(
    workspace: string,
    repoSlug: string,
    prId: number,
    body: string,
    filePath: string,
    line: number,
  ): Promise<void> {
    await this.request(`/repositories/${workspace}/${repoSlug}/pullrequests/${prId}/comments`, {
      method: 'POST',
      body: JSON.stringify({
        content: { raw: body },
        inline: { path: filePath, to: line },
      }),
    })
  }
}
