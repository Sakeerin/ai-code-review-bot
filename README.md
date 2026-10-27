# AI Review Bot

[![CI](https://github.com/Sakeerin/ai-code-review-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/Sakeerin/ai-code-review-bot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Open-source AI code reviews for GitHub, GitLab, and Bitbucket. Review pull requests
and merge requests with framework profiles, custom rules, and inline comments.

Use, modify, and self-host the code under the [MIT License](LICENSE), including for
commercial use. You supply your own infrastructure and service credentials; AI
providers and other services may charge separately. This repository does not
include access to a hosted service.

The project is in early development. Contributions, bug reports, and documentation
improvements are welcome in English or Thai.

## Features

- Inline review comments on GitHub PRs, GitLab MRs, and Bitbucket PRs.
- OpenAI, Anthropic, and Google Gemini integrations with configurable fallback.
- TypeScript, Laravel, Vue, and Laravel/Vue convention profiles.
- Repository-specific `.reviewbot.yml` rules, glob ignores, and review limits.
- Dashboard for review history, repository settings, usage, and analytics.
- Commit deduplication, cached AI results, quota reservations, and retryable jobs.
- Optional Slack notifications, email reports, and Stripe subscription billing.
- MCP server and VS Code extension for reviews from your editor.
- Docker deployment for the dashboard, webhook receiver, database, and migrations.

## Try the contributor workflow

You need Git, Node.js 22+, and Bun 1.3.0. These checks use synthetic data and an
in-memory PostgreSQL database; no API keys or external services are required.

```bash
git clone https://github.com/Sakeerin/ai-code-review-bot.git
cd ai-code-review-bot
bun install --frozen-lockfile
bun test tests
bun run lint
bun run typecheck
```

## Run with real services

Follow the English [self-hosting guide](docs/SELF_HOSTING.md) for local setup,
Docker, worker configuration, and deployment. For Thai instructions, start with
[RUN-LOCAL.md](RUN-LOCAL.md).

| Component                           | Required services                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Dashboard and on-demand diff review | PostgreSQL, GitHub OAuth for sign-in, an AI provider for real reviews                                               |
| Automatic PR/MR reviews             | Dashboard/database setup, provider webhook credentials, a GitHub App or GitLab/Bitbucket token, Trigger.dev workers |
| Billing and notifications           | Stripe, Slack, and Resend only for the integrations you enable                                                      |

Docker does not include a Trigger.dev server or an AI model. Background review
tasks still need a separately running Trigger.dev environment. Cloud workers must
be able to reach your database.

The application includes SaaS billing code and default plan quotas (Free: 50
reviews/month; Team: 500 plus metered overage; Business: unlimited). Those are
application defaults, separate from the MIT license. Stripe is optional for
testing the Free plan; self-hosting does not automatically disable quotas. Review
or adapt the plan logic for your deployment.

## Data handling

Selected diffs and code samples are sent to the AI providers you configure. When
fallback is enabled, more than one provider may receive the same input. Trigger.dev
workers process review data, PostgreSQL stores reviews and comments, and enabled
Slack/email integrations receive summaries. Review [SECURITY.md](SECURITY.md) and
your providers' policies before using confidential repositories.

## Repository configuration

Add `.reviewbot.yml` to the repository you want the bot to review:

```yaml
version: 1
profile: typescript # typescript | laravel | vue | laravel-vue
language: en # en | th
rules:
  - id: avoid-unsafe-queries
    severity: bug
    message: Use parameterized database queries for untrusted input.
ignore:
  - '**/*.test.ts'
  - 'dist/**'
limits:
  max_file_size_lines: 500
  max_files_per_pr: 20
```

Severity values are `bug`, `suggestion`, `nitpick`, and `praise`. File limits must
be positive integers: at most 2,000 changed lines per file and 50 files per review.
Invalid configuration falls back to defaults. The line limit measures added or
modified lines on the new side of the diff.

## Architecture

```text
GitHub / GitLab / Bitbucket webhook
  → Hono receiver: verify signature, reserve quota, dispatch job
  → Trigger.dev task: fetch diff, load rules, call an AI provider
  → Publish and reconcile inline review comments through provider APIs
  → PostgreSQL: persist review and notification outbox
  → Stripe / Slack: deliver notifications with scheduled retries
```

| Path                                                       | Purpose                                                                 |
| ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| `apps/dashboard`                                           | Next.js dashboard, Better Auth, API routes, and optional Stripe billing |
| `apps/webhook`                                             | Hono receiver for Cloudflare Workers or Bun                             |
| `apps/docs`                                                | Fumadocs site                                                           |
| `apps/mcp-server`                                          | MCP tools for trusted local clients                                     |
| `apps/vscode-extension`                                    | VS Code integration                                                     |
| `packages/ai`                                              | AI providers, prompts, profiles, and configuration                      |
| `packages/github`, `packages/gitlab`, `packages/bitbucket` | Provider clients                                                        |
| `packages/db`                                              | PostgreSQL schema, migrations, and auth                                 |
| `packages/queue`                                           | Trigger.dev tasks and durable notification delivery                     |
| `packages/ui`                                              | Shared UI package                                                       |

## Development commands

```bash
bun test tests                    # offline regression tests
bun run lint                      # ESLint across the repository
bun run typecheck                 # workspace TypeScript checks
bun run --cwd apps/dashboard dev  # dashboard on port 3000
bun run --cwd apps/dashboard build
bun run db:generate               # generate a migration after a schema change
bun run db:migrate                # apply migrations to DATABASE_URL
bun run billing:verify            # opt-in Stripe sandbox invoice verification
```

For billing verification, use Stripe test credentials and the configured monthly,
annual, and metered prices. This command contacts Stripe, creates temporary test
customers, verifies invoice previews, and removes those customers afterward.

## Documentation and community

- [Contributing](CONTRIBUTING.md): development workflow and pull request expectations.
- [Code of Conduct](CODE_OF_CONDUCT.md): community expectations.
- [Security](SECURITY.md): private vulnerability reporting and data handling.
- [Self-hosting](docs/SELF_HOSTING.md): English deployment guide.
- Developer Guide: [English](DEVELOPER-GUIDE.md) · [ภาษาไทย](DEVELOPER-GUIDE.th.md).
- [Local setup](RUN-LOCAL.md) and [external service setup](SETUP.md): Thai guides.
- [Issues](https://github.com/Sakeerin/ai-code-review-bot/issues): bug reports and
  feature requests. Search existing issues before opening a new one.

## License

[MIT](LICENSE). Copyright (c) 2026 Sakeerin and contributors. Third-party
dependencies retain their own licenses and notices.
