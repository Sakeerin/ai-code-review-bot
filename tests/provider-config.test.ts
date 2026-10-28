import { expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { buildYaml } from '../packages/ai/src/profile-generator'
import { ReviewBotConfigSchema } from '../packages/ai/src/config'
import { GitHubClient } from '../packages/github/src/client'
import { GitLabClient } from '../packages/gitlab/src/client'
import { BitbucketClient } from '../packages/bitbucket/src/client'
import { generateObjectWithFallback } from '../packages/ai/src/providers'

const { parse } = await import(Bun.resolveSync('yaml', resolve(import.meta.dir, '../packages/ai')))

test('the upgraded AI SDK validates structured output and preserves token usage', async () => {
  const { z } = await import(Bun.resolveSync('zod', resolve(import.meta.dir, '../packages/ai')))
  const previousFetch = globalThis.fetch
  const previousOrder = process.env.AI_PROVIDER_ORDER
  const previousKey = process.env.GEMINI_API_KEY
  try {
    process.env.AI_PROVIDER_ORDER = 'gemini'
    process.env.GEMINI_API_KEY = 'test-only-key'
    globalThis.fetch = (async (input) => {
      expect(String(input)).toContain('generativelanguage.googleapis.com')
      return Response.json({
        candidates: [
          {
            content: { role: 'model', parts: [{ text: '{"summary":"Example"}' }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
      })
    }) as typeof fetch
    const result = await generateObjectWithFallback({
      schema: z.object({ summary: z.string() }),
      system: 'Test',
      prompt: 'Test',
    })
    expect(result.object).toEqual({ summary: 'Example' })
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5 })
  } finally {
    globalThis.fetch = previousFetch
    if (previousOrder === undefined) delete process.env.AI_PROVIDER_ORDER
    else process.env.AI_PROVIDER_ORDER = previousOrder
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = previousKey
  }
})

test('generated convention YAML preserves regexes, quotes, newlines and special scalars', () => {
  const profile = {
    profile: 'typescript',
    language: 'th',
    rules: [
      {
        id: 'regex: rule',
        severity: 'suggestion' as const,
        message: 'Use \\w+ and "quotes"\nnext line',
      },
    ],
    ignore: ['**/generated/**', 'a"b', 'a\\b', 'null'],
    limits: { max_file_size_lines: 500, max_files_per_pr: 20 },
    reasoning: 'Example',
  }
  const config = ReviewBotConfigSchema.parse(parse(buildYaml(profile)))
  expect(config.rules).toEqual(profile.rules)
  expect(config.ignore).toEqual(profile.ignore)
})

for (const status of [401, 403, 429, 503])
  test(`config downloads fail closed on HTTP ${status}`, async () => {
    const previous = globalThis.fetch
    try {
      globalThis.fetch = (async () => new Response('Unavailable', { status })) as typeof fetch
      const github = new GitHubClient({
        rest: {
          repos: {
            getContent: async () => {
              throw Object.assign(new Error('Unavailable'), { status })
            },
          },
        },
      } as never)
      await expect(github.getFileContent('org', 'repo', '.reviewbot.yml')).rejects.toThrow()
      await expect(
        new GitLabClient({ baseUrl: 'https://gitlab.com/api/v4', token: 'test' }).getFileContent(
          1,
          '.reviewbot.yml',
          'head',
        ),
      ).rejects.toThrow()
      await expect(
        new BitbucketClient({ apiToken: 'test' }).getFileContent(
          'org',
          'repo',
          '.reviewbot.yml',
          'head',
        ),
      ).rejects.toThrow()
    } finally {
      globalThis.fetch = previous
    }
  })

test('only missing config files use default rules', async () => {
  const previous = globalThis.fetch
  try {
    globalThis.fetch = (async () => new Response('', { status: 404 })) as typeof fetch
    const github = new GitHubClient({
      rest: {
        repos: {
          getContent: async () => {
            throw Object.assign(new Error('Not found'), { status: 404 })
          },
        },
      },
    } as never)
    expect(await github.getFileContent('org', 'repo', '.reviewbot.yml')).toBeNull()
    expect(
      await new GitLabClient({
        baseUrl: 'https://gitlab.com/api/v4',
        token: 'test',
      }).getFileContent(1, '.reviewbot.yml', 'head'),
    ).toBeNull()
    expect(
      await new BitbucketClient({ apiToken: 'test' }).getFileContent(
        'org',
        'repo',
        '.reviewbot.yml',
        'head',
      ),
    ).toBeNull()
  } finally {
    globalThis.fetch = previous
  }
})

test('Bitbucket follows diffstat pagination with Bearer tokens', async () => {
  const previous = globalThis.fetch
  let requests = 0
  try {
    globalThis.fetch = (async (_input, init) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-token')
      requests++
      return Response.json({
        values: [
          { status: 'modified', new: { path: `${requests}.ts` }, lines_added: 1, lines_removed: 0 },
        ],
        ...(requests === 1 ? { next: 'https://api.bitbucket.org/2.0/page-two' } : {}),
      })
    }) as typeof fetch
    const files = await new BitbucketClient({ apiToken: 'test-token' }).getPullRequestFiles(
      'org',
      'repo',
      1,
    )
    expect(files.map((file) => file.path)).toEqual(['1.ts', '2.ts'])
  } finally {
    globalThis.fetch = previous
  }
})

test('Bitbucket never forwards credentials to a foreign pagination host', async () => {
  const previous = globalThis.fetch
  let requests = 0
  try {
    globalThis.fetch = (async () => {
      requests++
      return Response.json({ values: [], next: 'https://attacker.invalid/2.0/steal' })
    }) as typeof fetch
    await expect(
      new BitbucketClient({ apiToken: 'test' }).getPullRequestFiles('org', 'repo', 1),
    ).rejects.toThrow('pagination URL')
    expect(requests).toBe(1)
  } finally {
    globalThis.fetch = previous
  }
})
