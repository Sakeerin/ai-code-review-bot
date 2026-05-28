import * as vscode from 'vscode'

interface ReviewComment {
  file: string
  line: number
  severity: 'bug' | 'suggestion' | 'nitpick' | 'praise'
  message: string
  suggestion?: string
}

interface ReviewResult {
  score: number
  summary: string
  comments: ReviewComment[]
}

const DIAGNOSTIC_SOURCE = 'AI Review Bot'

/** Maps severity to VS Code DiagnosticSeverity */
function toDiagnosticSeverity(severity: ReviewComment['severity']): vscode.DiagnosticSeverity {
  switch (severity) {
    case 'bug': return vscode.DiagnosticSeverity.Error
    case 'suggestion': return vscode.DiagnosticSeverity.Warning
    case 'nitpick': return vscode.DiagnosticSeverity.Information
    case 'praise': return vscode.DiagnosticSeverity.Hint
  }
}

async function callReviewApi(
  diff: string,
  config: vscode.WorkspaceConfiguration,
): Promise<ReviewResult> {
  const apiUrl = config.get<string>('apiUrl') ?? 'https://reviewbot.app'
  const apiKey = config.get<string>('apiKey') ?? ''
  const profile = config.get<string>('profile') ?? 'typescript'
  const language = config.get<string>('language') ?? 'en'

  if (!apiKey) {
    throw new Error('API key not configured. Run "AI Review Bot: Configure Settings" to set it up.')
  }

  const res = await fetch(`${apiUrl}/api/review/diff`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ diff, profile, language }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`Review API error ${res.status}: ${text}`)
  }

  return res.json() as Promise<ReviewResult>
}

/** Build a unified diff from the current file's content vs. git HEAD */
async function buildFileDiff(document: vscode.TextDocument): Promise<string | null> {
  const { exec } = await import('child_process')
  const { promisify } = await import('util')
  const execAsync = promisify(exec)

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)
  if (!workspaceFolder) return null

  try {
    const filePath = document.uri.fsPath
    const { stdout } = await execAsync(`git diff HEAD -- "${filePath}"`, {
      cwd: workspaceFolder.uri.fsPath,
    })
    if (stdout.trim()) return stdout

    // File is new (not tracked) — generate a synthetic diff from scratch
    const content = document.getText()
    const lines = content.split('\n')
    const addedLines = lines.map((l) => `+${l}`).join('\n')
    return `--- /dev/null\n+++ b/${vscode.workspace.asRelativePath(document.uri)}\n@@ -0,0 +1,${lines.length} @@\n${addedLines}`
  } catch {
    return null
  }
}

/** Build a synthetic diff from selected text */
function buildSelectionDiff(
  document: vscode.TextDocument,
  selection: vscode.Selection,
): string {
  const text = document.getText(selection)
  const relPath = vscode.workspace.asRelativePath(document.uri)
  const startLine = selection.start.line + 1
  const lines = text.split('\n')
  const addedLines = lines.map((l) => `+${l}`).join('\n')
  return `--- a/${relPath}\n+++ b/${relPath}\n@@ -${startLine},0 +${startLine},${lines.length} @@\n${addedLines}`
}

export function activate(context: vscode.ExtensionContext) {
  const diagnosticCollection = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_SOURCE)
  context.subscriptions.push(diagnosticCollection)

  // ── Review File Command ──────────────────────────────────────────

  const reviewFileCmd = vscode.commands.registerCommand('reviewbot.reviewFile', async () => {
    const editor = vscode.window.activeTextEditor
    if (!editor) {
      vscode.window.showWarningMessage('No active editor to review.')
      return
    }

    const config = vscode.workspace.getConfiguration('reviewbot')
    const document = editor.document

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'AI Review Bot: Reviewing file...',
        cancellable: false,
      },
      async () => {
        try {
          const diff = await buildFileDiff(document)
          if (!diff) {
            vscode.window.showInformationMessage('No changes detected to review (git diff is empty).')
            return
          }

          const result = await callReviewApi(diff, config)
          applyDiagnostics(diagnosticCollection, document, result)

          const bugCount = result.comments.filter((c) => c.severity === 'bug').length
          vscode.window.showInformationMessage(
            `Review complete: Score ${result.score}/100 · ${bugCount} bug(s) found`,
          )
        } catch (err) {
          vscode.window.showErrorMessage(`AI Review Bot: ${(err as Error).message}`)
        }
      },
    )
  })

  // ── Review Selection Command ─────────────────────────────────────

  const reviewSelectionCmd = vscode.commands.registerCommand('reviewbot.reviewSelection', async () => {
    const editor = vscode.window.activeTextEditor
    if (!editor || editor.selection.isEmpty) {
      vscode.window.showWarningMessage('Select code to review first.')
      return
    }

    const config = vscode.workspace.getConfiguration('reviewbot')
    const document = editor.document
    const diff = buildSelectionDiff(document, editor.selection)

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'AI Review Bot: Reviewing selection...',
        cancellable: false,
      },
      async () => {
        try {
          const result = await callReviewApi(diff, config)
          applyDiagnostics(diagnosticCollection, document, result)

          vscode.window.showInformationMessage(
            `Review complete: Score ${result.score}/100`,
          )
        } catch (err) {
          vscode.window.showErrorMessage(`AI Review Bot: ${(err as Error).message}`)
        }
      },
    )
  })

  // ── Clear Diagnostics Command ────────────────────────────────────

  const clearCmd = vscode.commands.registerCommand('reviewbot.clearDiagnostics', () => {
    diagnosticCollection.clear()
    vscode.window.showInformationMessage('AI Review Bot: Review comments cleared.')
  })

  // ── Configure Command ────────────────────────────────────────────

  const configureCmd = vscode.commands.registerCommand('reviewbot.configure', () => {
    vscode.commands.executeCommand('workbench.action.openSettings', 'reviewbot')
  })

  // ── Auto-review on save ──────────────────────────────────────────

  const onSaveListener = vscode.workspace.onDidSaveTextDocument(async (document) => {
    const config = vscode.workspace.getConfiguration('reviewbot')
    if (!config.get<boolean>('showOnSave')) return
    if (!config.get<string>('apiKey')) return

    const diff = await buildFileDiff(document)
    if (!diff) return

    try {
      const result = await callReviewApi(diff, config)
      applyDiagnostics(diagnosticCollection, document, result)
    } catch {
      // Silent failure on save — don't interrupt the save workflow
    }
  })

  context.subscriptions.push(reviewFileCmd, reviewSelectionCmd, clearCmd, configureCmd, onSaveListener)
}

export function deactivate() {}

// ── Helpers ───────────────────────────────────────────────────────

function applyDiagnostics(
  collection: vscode.DiagnosticCollection,
  document: vscode.TextDocument,
  result: ReviewResult,
): void {
  const diagnostics: vscode.Diagnostic[] = result.comments.map((comment) => {
    const lineIndex = Math.max(0, comment.line - 1)
    const lineText = document.lineAt(Math.min(lineIndex, document.lineCount - 1))
    const range = new vscode.Range(
      lineIndex,
      lineText.firstNonWhitespaceCharacterIndex,
      lineIndex,
      lineText.text.length,
    )

    const diag = new vscode.Diagnostic(
      range,
      `[${comment.severity.toUpperCase()}] ${comment.message}${comment.suggestion ? `\n\nSuggested fix:\n${comment.suggestion}` : ''}`,
      toDiagnosticSeverity(comment.severity),
    )
    diag.source = DIAGNOSTIC_SOURCE
    return diag
  })

  collection.set(document.uri, diagnostics)
}
