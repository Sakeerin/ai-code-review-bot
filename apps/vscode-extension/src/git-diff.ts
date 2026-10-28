import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { relative, dirname, basename, join } from 'node:path'
import { realpath } from 'node:fs/promises'
import { createTwoFilesPatch } from 'diff'

const execFileAsync = promisify(execFile)

export async function readGitDiff(
  filePath: string,
  cwd: string,
  bufferText?: string,
): Promise<string> {
  if (bufferText !== undefined) {
    if (Buffer.byteLength(bufferText) > 2 * 1024 * 1024)
      throw new Error('File exceeds the review size limit')
    const git = async (args: string[]) =>
      (
        await execFileAsync(
          'git',
          args[0] === 'check-ignore' ? args : ['--literal-pathspecs', ...args],
          {
            cwd,
            encoding: 'utf8',
            maxBuffer: 2 * 1024 * 1024,
            windowsHide: true,
          },
        )
      ).stdout
    const root = await realpath((await git(['rev-parse', '--show-toplevel'])).trim())
    const canonicalFile = join(await realpath(dirname(filePath)), basename(filePath))
    const path = relative(root, canonicalFile).replace(/\\/g, '/')
    if (path.startsWith('../') || path === '..') throw new Error('File is outside the repository')
    try {
      await git(['check-ignore', '--quiet', '--', path])
      return ''
    } catch (error) {
      if ((error as { code?: number }).code !== 1) throw error
    }
    let baseline = ''
    let hasHead = true
    try {
      await git(['rev-parse', '--verify', '--quiet', 'HEAD'])
    } catch (error) {
      if ((error as { code?: number }).code !== 1) throw error
      hasHead = false
    }
    const existsInHead =
      hasHead && Boolean((await git(['ls-tree', '--name-only', 'HEAD', '--', path])).trim())
    if (existsInHead) baseline = await git(['show', `HEAD:${path}`])
    baseline = baseline.replace(/\r\n/g, '\n')
    const current = bufferText.replace(/\r\n/g, '\n')
    if (baseline === current) return ''
    return createTwoFilesPatch(
      existsInHead ? `a/${path}` : '/dev/null',
      `b/${path}`,
      baseline,
      current,
    )
  }
  const { stdout } = await execFileAsync(
    'git',
    ['--literal-pathspecs', 'diff', 'HEAD', '--', filePath],
    {
      cwd,
      encoding: 'utf8',
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    },
  )
  return stdout
}
