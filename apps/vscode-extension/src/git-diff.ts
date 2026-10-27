import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export async function readGitDiff(filePath: string, cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['diff', 'HEAD', '--', filePath], {
    cwd, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, windowsHide: true,
  })
  return stdout
}
