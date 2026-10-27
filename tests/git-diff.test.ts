import { expect, test } from 'bun:test'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { readGitDiff } from '../apps/vscode-extension/src/git-diff'

const execFileAsync = promisify(execFile)

test('Git diff treats shell metacharacters in a filename as literal data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'reviewbot-git-test-'))
  if (dirname(resolve(directory)) !== resolve(tmpdir())) throw new Error('Unexpected fixture path')
  try {
    const git = (args: string[]) =>
      execFileAsync('git', args, { cwd: directory, windowsHide: true })
    await git(['init', '--quiet'])
    const filename = 'file&echo injected&.ts'
    await writeFile(join(directory, filename), 'before\n')
    await git(['add', '--', filename])
    await git([
      '-c',
      'user.name=Regression',
      '-c',
      'user.email=local@example.invalid',
      '-c',
      'core.hooksPath=',
      'commit',
      '--quiet',
      '--no-gpg-sign',
      '-m',
      'fixture',
    ])
    await writeFile(join(directory, filename), 'after\n')
    const diff = await readGitDiff(join(directory, filename), directory)
    expect(diff).toContain('-before')
    expect(diff).toContain('+after')
    expect(diff).toContain(filename)
  } finally {
    // Only remove the isolated fixture created by this test.
    await rm(directory, { recursive: true, force: true })
  }
})
