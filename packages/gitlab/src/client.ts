import type {
  GitLabClientConfig,
  GitLabInlineCommentPayload,
  GitLabMergeRequestChange,
  GitLabMergeRequestInfo,
} from './types.js'

export class GitLabClient {
  private readonly apiBaseUrl: string
  private readonly token: string

  constructor(config: GitLabClientConfig) {
    this.apiBaseUrl = config.baseUrl.replace(/\/$/, '')
    this.token = config.token
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'PRIVATE-TOKEN': this.token,
        ...(init?.headers ?? {}),
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`GitLab API request failed (${response.status}): ${errorText}`)
    }

    if (response.status === 204) {
      return undefined as T
    }

    return response.json() as Promise<T>
  }

  async getMergeRequest(projectId: number, mergeRequestIid: number): Promise<GitLabMergeRequestInfo> {
    const data = await this.request<{
      iid: number
      title: string
      web_url: string
      source_branch: string
      target_branch: string
      author?: { username?: string; name?: string }
      diff_refs?: { base_sha: string; head_sha: string; start_sha: string }
    }>(`/projects/${projectId}/merge_requests/${mergeRequestIid}`)

    if (!data.diff_refs?.base_sha || !data.diff_refs.head_sha || !data.diff_refs.start_sha) {
      throw new Error('GitLab merge request is missing diff refs required for inline comments')
    }

    return {
      iid: data.iid,
      title: data.title,
      author: data.author?.username ?? data.author?.name ?? 'unknown',
      webUrl: data.web_url,
      sourceBranch: data.source_branch,
      targetBranch: data.target_branch,
      diffRefs: {
        baseSha: data.diff_refs.base_sha,
        headSha: data.diff_refs.head_sha,
        startSha: data.diff_refs.start_sha,
      },
    }
  }

  async getMergeRequestChanges(
    projectId: number,
    mergeRequestIid: number,
  ): Promise<GitLabMergeRequestChange[]> {
    const data = await this.request<{
      changes: Array<{
        old_path: string
        new_path: string
        diff?: string
        deleted_file: boolean
        new_file: boolean
        renamed_file: boolean
      }>
    }>(`/projects/${projectId}/merge_requests/${mergeRequestIid}/changes`)

    return data.changes.map((change) => ({
      oldPath: change.old_path,
      newPath: change.new_path,
      diff: change.diff,
      deletedFile: change.deleted_file,
      newFile: change.new_file,
      renamedFile: change.renamed_file,
    }))
  }

  async getFileContent(projectId: number, path: string, ref: string): Promise<string | null> {
    const encodedPath = encodeURIComponent(path)

    try {
      const data = await this.request<{ content: string; encoding: string }>(
        `/projects/${projectId}/repository/files/${encodedPath}?ref=${encodeURIComponent(ref)}`,
      )

      if (data.encoding !== 'base64') {
        return null
      }

      return Buffer.from(data.content, 'base64').toString('utf-8')
    } catch {
      return null
    }
  }

  async createMergeRequestNote(projectId: number, mergeRequestIid: number, body: string): Promise<void> {
    await this.request(`/projects/${projectId}/merge_requests/${mergeRequestIid}/notes`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    })
  }

  async createInlineDiscussion(
    projectId: number,
    mergeRequestIid: number,
    payload: GitLabInlineCommentPayload,
  ): Promise<void> {
    await this.request(`/projects/${projectId}/merge_requests/${mergeRequestIid}/discussions`, {
      method: 'POST',
      body: JSON.stringify({
        body: payload.body,
        position: {
          position_type: 'text',
          base_sha: payload.baseSha,
          start_sha: payload.startSha,
          head_sha: payload.headSha,
          old_path: payload.oldPath,
          new_path: payload.newPath,
          new_line: payload.newLine,
        },
      }),
    })
  }
}
