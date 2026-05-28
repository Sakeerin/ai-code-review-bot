import type { BitbucketClientConfig, BitbucketPRFile, BitbucketPR } from './types.js'

export class BitbucketClient {
  private readonly baseUrl: string
  private readonly authHeader: string

  constructor(config: BitbucketClientConfig) {
    this.baseUrl = config.baseUrl ?? 'https://api.bitbucket.org/2.0'
    const encoded = Buffer.from(`${config.username}:${config.appPassword}`).toString('base64')
    this.authHeader = `Basic ${encoded}`
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`
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
      throw new Error(`Bitbucket API ${res.status} ${res.statusText}: ${body}`)
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

  async getPullRequestFiles(workspace: string, repoSlug: string, prId: number): Promise<BitbucketPRFile[]> {
    interface DiffstatEntry {
      status: 'added' | 'modified' | 'removed' | 'renamed'
      lines_added: number
      lines_removed: number
      new?: { path: string }
      old?: { path: string }
    }
    interface DiffstatResponse { values: DiffstatEntry[] }

    const data = await this.request<DiffstatResponse>(
      `/repositories/${workspace}/${repoSlug}/pullrequests/${prId}/diffstat`,
    )
    return data.values.map((f) => ({
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
    try {
      const url = `${this.baseUrl}/repositories/${workspace}/${repoSlug}/src/${commitHash}/${filePath}`
      const res = await fetch(url, { headers: { Authorization: this.authHeader } })
      if (!res.ok) return null
      return res.text()
    } catch {
      return null
    }
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
