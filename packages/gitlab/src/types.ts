export interface GitLabClientConfig {
  baseUrl: string
  token: string
}

export interface GitLabMergeRequestInfo {
  iid: number
  title: string
  author: string
  webUrl: string
  sourceBranch: string
  targetBranch: string
  diffRefs: {
    baseSha: string
    headSha: string
    startSha: string
  }
}

export interface GitLabMergeRequestChange {
  oldPath: string
  newPath: string
  diff?: string
  deletedFile: boolean
  newFile: boolean
  renamedFile: boolean
}

export interface GitLabInlineCommentPayload {
  body: string
  oldPath: string
  newPath: string
  newLine: number
  baseSha: string
  startSha: string
  headSha: string
}
