// Fail closed on registry errors and known high/critical advisories, including dev dependencies.
const audit = Bun.spawn([process.execPath, 'audit', '--json'], { stdout: 'pipe', stderr: 'pipe' })
const [output, errors, code] = await Promise.all([
  new Response(audit.stdout).text(),
  new Response(audit.stderr).text(),
  audit.exited,
])
type Advisory = { url: string; severity: 'low' | 'moderate' | 'high' | 'critical' }
let packages: Record<string, Advisory[]>
try {
  if (code !== 0 && code !== 1) throw new Error('Audit command failed')
  packages = JSON.parse(output)
  if (!packages || typeof packages !== 'object' || Array.isArray(packages))
    throw new Error('Invalid audit response')
} catch {
  console.error('Dependency audit unavailable. Retry when the registry is reachable.', errors)
  process.exit(1)
}
const unique = new Map<string, Advisory>()
for (const [name, advisories] of Object.entries(packages)) {
  if (!Array.isArray(advisories)) throw new Error('Unexpected audit response')
  for (const advisory of advisories) {
    if (!['low', 'moderate', 'high', 'critical'].includes(advisory.severity) || !advisory.url)
      throw new Error('Unexpected advisory')
    unique.set(advisory.url, advisory)
    console.log(`${advisory.severity}: ${name} — ${advisory.url}`)
  }
}
const severe = [...unique.values()].filter((advisory) =>
  ['high', 'critical'].includes(advisory.severity),
)
if (code !== 0 && unique.size === 0) throw new Error('Audit failed without advisory results')
console.log(`${unique.size} unique advisories; ${severe.length} high/critical`)
if (severe.length) process.exit(1)
