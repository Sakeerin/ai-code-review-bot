# Developer Guide — AI Code Review Bot

Language: **English** | [ภาษาไทย](DEVELOPER-GUIDE.th.md)

Both editions cover the same topics. Update both languages when changing commands,
environment variables, or procedures. The project uses the [MIT License](LICENSE)
and can be self-hosted with infrastructure and service accounts you provide.

## Review access and job reliability updates

Migration `0008` adds a durable dispatch outbox and enforces the Free plan's one
active repository limit on existing installations. Deploy the queue's
`retry-review-dispatch` schedule alongside the workers after migrating. Failed
dispatches retain their quota reservation and retry with the same idempotency key.
GitHub administration rights are checked again when accessing an organization;
use the dashboard's Organization selector to switch between installations.

Use Bun **1.4.4** or newer for the updated lockfile; the CI and Docker images use
1.4.4. Run `bun run audit:security` to reject high/critical dependency advisories.

For Bitbucket, configure `BITBUCKET_API_TOKEN` on the worker using a scoped API
token with repository read and pull request read/write permissions. New jobs do
not include API credentials in their payloads. App Passwords have been retired.

Existing paid plans can change plan or billing interval through an invoice
preview and confirmation. Quotes expire after ten minutes. Stripe confirms the
payment before the webhook grants new access. A previously configured monthly
usage meter remains attached for delayed Team usage; Business reviews do not
generate new meter events. Payment recovery remains available on the Free plan.

Before starting this version of the dashboard, webhook receiver, and queue, run
`bun install` and `bun run db:migrate` against the intended database. Migration
`0006` adds GitLab/Bitbucket organization identifiers and durable AI results for
resuming retried tasks. Stop old workers before switching deployments so different
versions do not process the same work concurrently.

- The dashboard needs `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` to verify an
  installation. The person connecting it must own the personal account or have
  active administrator membership in the GitHub organization. Existing users may
  need to sign in and authorize GitHub again if their token lacks `read:org`.
- Set `BITBUCKET_WEBHOOK_SECRET` when using Bitbucket. Without it, the endpoint
  returns `503` and does not accept unverified requests.
- Reviews use a concurrency key per PR and an idempotency key per commit. Tasks
  check markers on already-published comments before retrying and persist AI
  results before posting comments.
- Namespace backfills only apply to existing organizations with one unambiguous
  provider and namespace. Mixed legacy organizations require a separate ownership
  and historical-data review.

Run `bun run test` for regression tests backed by in-memory PostgreSQL (PGlite).
They do not connect to a real database or external services. Run
`bun run typecheck` to check TypeScript.

Run `bun run test:postgres` to check the real PostgreSQL driver, concurrent locks,
dispatch leases, and monthly usage accounting. Set `POSTGRES_TEST_URL` to a
disposable PostgreSQL server using a role with `CREATEDB` rights. The suite creates
and removes its own database and never falls back to `DATABASE_URL`. CI runs this
suite against PostgreSQL 16; Stripe and Slack delivery stay disabled.

### Billing, quota, and notification updates

- Migration `0007` adds subscription state, reservations per PR/commit, and
  `notification_outbox`. It also reconciles old counters with completed reviews.
  Let old tasks finish and stop workers before applying the migration.
- Monthly quota uses UTC calendar months and includes reserved work in the queue.
  Skipped work and exhausted failures release their reservations. Duplicate
  webhooks for a commit use the same reservation. The dashboard shows quota usage
  including queued work. Once a task has finished or exhausted retries, duplicate
  webhooks do not create another job or quota reservation; push a new commit to
  start another review through a webhook.
- Team includes 500 completed reviews per month. Only reviews above 500 generate
  meter events, at $0.05 each. Business does not generate meter events. Team
  checkout requires `STRIPE_OVERAGE_PRICE_ID` to reference an active monthly
  metered USD 5-cent price linked to the meter matching `STRIPE_METER_EVENT_NAME`.
  Annual Team uses flexible billing to combine an annual base price with monthly
  overage. Subscriptions created before the metered item was added must be updated
  in Stripe before overage can be billed.
- `active`, `trialing`, and `past_due` subscriptions retain paid access during
  payment retries. `unpaid`, `paused`, `canceled`, `incomplete`, and
  `incomplete_expired` use Free. The webhook reads current Stripe state to avoid
  applying stale events out of order.
- Deploy the `retry-notifications` task on Trigger.dev. It retries pending
  Stripe/Slack deliveries every five minutes, up to ten attempts. Inspect rows
  with `status = 'failed'` in `notification_outbox`. After fixing configuration,
  reset `status = 'pending'`, `attempts = 0`, `next_attempt_at = now()`, and
  `locked_until = NULL` to retry delivery. Stripe uses stable identifiers. Slack
  delivery is at least once and can duplicate if an acknowledgement is lost.
- Slack URLs must use HTTPS on `hooks.slack.com` or `hooks.slack-gov.com`, with a
  `/services/...` path. Delivery does not follow redirects. Ignore rules support
  glob patterns such as `**/*.test.ts` and `dist/**`.
- Before merging, run `bun run lint`, `bun run typecheck`, `bun test tests`, and
  the dashboard build. CI runs those checks and builds both Docker images.
- Run `bun run billing:verify` to verify invoice previews in Stripe sandbox.
  Configure a test key and monthly/annual Team and Business price IDs, including
  overage. The command rejects live keys, creates test customers without payment
  methods or email addresses, checks previews, and deletes the customers afterward.
  It does not collect real payments. It contacts Stripe and is separate from the
  offline regression tests.
- Docker runs migrations before starting the dashboard/webhook receiver. The
  queue uses Trigger.dev separately; deploy its tasks and configure a
  `DATABASE_URL` that the workers can reach.

> This guide covers prerequisites, configuration, local development, testing,
> deployment, and troubleshooting for developers running or extending the project.
>
> Related documentation: [README](README.md), [service setup](SETUP.md) (Thai),
> [self-hosting guide](docs/SELF_HOSTING.md), and [local guide](RUN-LOCAL.md) (Thai).

## Contents

1. [Prerequisites](#1-prerequisites)
2. [Repository structure](#2-repository-structure)
3. [Quick start](#3-quick-start)
4. [Environment variables](#4-environment-variables)
5. [Running apps and packages](#5-running-apps-and-packages)
6. [Database and migrations](#6-database-and-migrations)
7. [Command reference](#7-command-reference)
8. [End-to-end testing](#8-end-to-end-testing)
9. [Production deployment](#9-production-deployment)
10. [Self-hosting with Docker](#10-self-hosting-with-docker)
11. [Extending the project](#11-extending-the-project)
12. [Troubleshooting](#12-troubleshooting)

## 1. Prerequisites

### Tools

| Tool                      | Version                   | Purpose                                                             |
| ------------------------- | ------------------------- | ------------------------------------------------------------------- |
| [Bun](https://bun.sh)     | 1.4.4 to match CI         | Main runtime and package manager, declared in `packageManager`      |
| Node.js                   | 22.0.0 or newer           | Required by some tools, declared in `engines`                       |
| Wrangler CLI              | Version from the lockfile | Available through the `apps/webhook` scripts for Cloudflare Workers |
| Git                       | —                         | Version control                                                     |
| Docker and Docker Compose | Optional                  | Self-hosting and a local PostgreSQL database                        |

```bash
# Install Bun.
curl -fsSL https://bun.sh/install | bash

# After installing repository dependencies, use the workspace's Wrangler.
cd apps/webhook
bunx wrangler login
```

### Background knowledge

TypeScript, React/Next.js App Router, Hono, Drizzle ORM, webhooks/HMAC, and basic
Stripe billing concepts are useful when working on the corresponding components.

### External accounts

The dashboard uses PostgreSQL and GitHub OAuth. Real reviews need at least one AI
provider. Automatic PR/MR reviews also need Trigger.dev and credentials for the Git
provider you use. Stripe, Slack, Resend, Sentry, and Axiom are only needed for the
integrations you enable. Cloudflare and Vercel are deployment options, not
requirements for running the Docker deployment.

See [SETUP.md](SETUP.md) (Thai) for service-account configuration and
[Self-hosting](docs/SELF_HOSTING.md) for an English setup walkthrough.

## 2. Repository structure

The monorepo uses Turborepo and Bun workspaces: `apps/*` and `packages/*`.

```text
ai-code-review-bot/
├── apps/
│   ├── webhook/          Cloudflare Workers/Bun receiver, signatures, quotas
│   ├── dashboard/        Next.js 15, auth, billing, history, settings
│   ├── docs/             Fumadocs site
│   ├── mcp-server/       MCP tools for IDE clients
│   └── vscode-extension/ VS Code reviews before pushing
├── packages/
│   ├── ai/               AI providers, prompts, config, profile generation
│   ├── github/           GitHub App API client
│   ├── gitlab/           GitLab API client
│   ├── bitbucket/        Bitbucket API client
│   ├── db/               Drizzle schema/client and Better Auth configuration
│   └── queue/            Trigger.dev review and scheduled tasks
├── Dockerfile.webhook / Dockerfile.dashboard / docker-compose.yml
├── turbo.json            Build, development, and validation pipelines
├── .env.example          Example environment variables
└── package.json          Root scripts and workspaces
```

Shared workspace names include `@repo/ai`, `@repo/github`, `@repo/gitlab`,
`@repo/bitbucket`, `@repo/db`, and `@repo/queue`.

## 3. Quick start

Start with the dashboard and an on-demand AI review. Add webhook processing and
the queue in [section 5](#5-running-apps-and-packages).

Run the following from the repository root after cloning:

```bash
# 1. Clone and install the entire monorepo.
git clone https://github.com/Sakeerin/ai-code-review-bot.git
cd ai-code-review-bot
bun install --frozen-lockfile

# 2. Create private environment files.
cp .env.example .env
cp .env.example apps/dashboard/.env.local

# 3. Fill in both files before running migrations; see section 4.
#    DATABASE_URL, BETTER_AUTH_SECRET, NEXT_PUBLIC_APP_URL, GitHub OAuth credentials
#    At least one AI provider key for real reviews
#    REVIEW_API_KEY for the on-demand review endpoint

# 4. Use an existing PostgreSQL database or start the local Compose database.
docker compose up -d postgres
# Choose POSTGRES_PASSWORD and point DATABASE_URL in both files at this database.

# 5. Apply database migrations.
bun run db:migrate

# 6. Start the dashboard.
bun run --cwd apps/dashboard dev
```

The dashboard runs at `http://localhost:3000`. Start the webhook receiver and queue
separately after configuring provider credentials and Trigger.dev.

For tests without external accounts, run `bun test tests`. The tests use an
in-memory database and replace external service calls. Unconfigured features are
unavailable: for example, webhooks reject missing signing secrets, and checkout
is unavailable without the required Stripe configuration.

You can configure multiple AI providers for automatic fallback; see
[section 4.1](#41-multi-provider-ai--fallback).

## 4. Environment variables

Environment files have distinct consumers:

- Root `.env`: Bun webhook server, migrations, Docker Compose, and queue scripts.
- `apps/dashboard/.env.local`: Next.js dashboard.
- `apps/webhook/.dev.vars`: local Wrangler bindings. Copy the root `.env` and
  review the values needed by the receiver.
- Deployed Workers and tasks: configure secrets separately in their service
  environments.

### Webhook and queue variables

| Variable                                                  | Required             | Description                                                  |
| --------------------------------------------------------- | -------------------- | ------------------------------------------------------------ |
| `DATABASE_URL`                                            | Yes                  | PostgreSQL connection string                                 |
| `OPENAI_API_KEY`                                          | At least one AI key  | OpenAI key; OpenAI is first in the default order             |
| `ANTHROPIC_API_KEY`                                       | At least one AI key  | Anthropic/Claude key                                         |
| `GEMINI_API_KEY`                                          | At least one AI key  | Gemini key; `GOOGLE_GENERATIVE_AI_API_KEY` is also supported |
| `AI_PROVIDER_ORDER`                                       | Optional             | Default: `openai,anthropic,gemini`                           |
| `OPENAI_MODEL`, `ANTHROPIC_MODEL`, `GEMINI_MODEL`         | Optional             | Per-provider model overrides                                 |
| `TRIGGER_SECRET_KEY`                                      | For dispatching jobs | Trigger.dev secret for the intended environment              |
| `TRIGGER_PROJECT_ID`                                      | For queue dev/deploy | Your own Trigger.dev project reference                       |
| `GITHUB_APP_ID`                                           | For GitHub           | Numeric App ID                                               |
| `GITHUB_APP_PRIVATE_KEY`                                  | For GitHub           | PEM key; escaped newlines can be represented as `\n`         |
| `GITHUB_WEBHOOK_SECRET`                                   | For GitHub           | Webhook HMAC signing secret                                  |
| `GITLAB_TOKEN`, `GITLAB_WEBHOOK_SECRET`, `GITLAB_API_URL` | For GitLab           | API credentials, signing secret, and optional API URL        |
| `BITBUCKET_WEBHOOK_SECRET`, `BITBUCKET_API_TOKEN`         | For Bitbucket        | Signing secret on receiver; scoped API token on worker       |
| `SENTRY_DSN`                                              | Optional             | Error tracking                                               |
| `POSTGRES_PASSWORD`, `WEBHOOK_PORT`, `DASHBOARD_PORT`     | For Docker           | Local database credentials and exposed ports                 |

No single AI provider is mandatory, but at least one key is required for real
reviews. Jobs cannot be dispatched without the Trigger.dev secret. GitHub App
credentials are required when using the GitHub integration.

### 4.1 Multi-Provider AI + Fallback

The implementation is in
[packages/ai/src/providers.ts](packages/ai/src/providers.ts).

1. Read provider order from `AI_PROVIDER_ORDER`, defaulting to
   `openai,anthropic,gemini`.
2. Include only providers with configured API keys.
3. Try the first configured provider, then apply the following fallback behavior:

| Failure                                                      | Try the next provider? | Retry the job later if this is the last provider? |
| ------------------------------------------------------------ | ---------------------- | ------------------------------------------------- |
| Quota/rate limit: 429 or matching quota messages             | Yes                    | Yes                                               |
| Authentication/permission: 401/403 or matching auth messages | Yes                    | No                                                |
| Server error: 5xx                                            | Yes                    | Yes                                               |
| Invalid schema/request: 400                                  | No                     | No                                                |
| Network/timeout                                              | Yes                    | Yes                                               |

4. If providers fail, throw `ReviewError`, with retryability determined by the
   final failure classification.
5. The fallback helper returns a `provider` field identifying the AI provider.
   The `provider` column in the `reviews` table identifies the Git provider.

Example configuration:

```bash
# OpenAI first, with Anthropic and Gemini as fallback providers.
AI_PROVIDER_ORDER=openai,anthropic,gemini
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=AI...

# Alternatively, try Gemini before OpenAI.
AI_PROVIDER_ORDER=gemini,openai
GEMINI_API_KEY=AI...
OPENAI_API_KEY=sk-...
```

Check which providers are configured:

```bash
curl http://localhost:3000/api/health/ai
```

Example response:

```json
{
  "ok": true,
  "order": "openai,anthropic,gemini",
  "activeProvider": "openai",
  "providers": [
    { "name": "openai", "envVar": "OPENAI_API_KEY", "configured": true },
    { "name": "anthropic", "envVar": "ANTHROPIC_API_KEY", "configured": false },
    {
      "name": "gemini",
      "envVar": "GEMINI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY",
      "configured": false
    }
  ]
}
```

Configure these keys in the Trigger.dev environment as well: deployed review
jobs run in workers, not inside the webhook receiver.

### Dashboard variables

| Variable                                                         | Required                       | Description                                                                               |
| ---------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                   | Yes                            | Same database as the webhook receiver                                                     |
| `BETTER_AUTH_SECRET`                                             | Yes                            | Generate with `openssl rand -hex 32`                                                      |
| `NEXT_PUBLIC_APP_URL`                                            | Yes                            | Dashboard origin, such as `http://localhost:3000`                                         |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`                       | For sign-in                    | GitHub OAuth App credentials                                                              |
| `GITHUB_APP_SLUG`                                                | Optional                       | App slug used in installation links                                                       |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`                        | For connecting installations   | Dashboard installation ownership verification                                             |
| `WEBHOOK_BASE_URL`                                               | Optional                       | Public receiver URL shown in setup instructions                                           |
| `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`        | For billing                    | Use test-mode keys for development                                                        |
| `STRIPE_WEBHOOK_SECRET`                                          | For billing webhooks           | Stripe signing secret                                                                     |
| `STRIPE_METER_ID`, `STRIPE_METER_EVENT_NAME`                     | For metering                   | Meter configuration; for example, event name `pr_review`                                  |
| `STRIPE_TEAM_PRICE_ID`, `STRIPE_BUSINESS_PRICE_ID`               | For monthly checkout           | Monthly base prices                                                                       |
| `STRIPE_TEAM_ANNUAL_PRICE_ID`, `STRIPE_BUSINESS_ANNUAL_PRICE_ID` | For annual checkout            | Annual base prices                                                                        |
| `STRIPE_OVERAGE_PRICE_ID`                                        | For Team checkout              | $0.05-per-review monthly metered price                                                    |
| `SLACK_WEBHOOK_URL`                                              | Optional; configure in workers | Fallback URL; organizations can configure their own                                       |
| `RESEND_API_KEY`, `EMAIL_FROM`                                   | Optional; configure in workers | Weekly email reports                                                                      |
| `SUPPORT_EMAIL`                                                  | Reserved for future use        | The current enterprise endpoint logs leads but does not email them                        |
| `AXIOM_TOKEN`, `SENTRY_DSN`                                      | Optional                       | Observability settings                                                                    |
| `REVIEW_API_KEY`                                                 | For on-demand diff review      | Shared Bearer key for `/api/review/diff` and the extension; MCP uses credentials directly |

See [.env.example](.env.example) for the complete example configuration.

## 5. Running apps and packages

### All development scripts

```bash
bun run dev
```

This runs the workspace `dev` scripts through Turbo. Configure the services those
scripts require before using it, including the queue's Trigger.dev project.

### Individual components

Run these examples from the repository root unless a command changes directory.

**Dashboard:**

```bash
cd apps/dashboard && bun run dev
# http://localhost:3000
```

**Webhook receiver with local Cloudflare Workers:**

```bash
cp .env apps/webhook/.dev.vars
bun run --cwd apps/webhook dev
curl http://localhost:8787/health
# {"status":"ok"}
```

Check the Wrangler terminal output for the actual port.

**Queue in development:**

```bash
bun run --cwd packages/queue dev
```

The script loads the root `.env`, connects to Trigger.dev, and runs local tasks
with hot reload. Configure `TRIGGER_PROJECT_ID` and the development secret first.

**Documentation site:**

```bash
cd apps/docs && bun run dev
```

The current script uses port `3001`.

**MCP server:**

```bash
bun run --cwd apps/mcp-server dev
```

**VS Code extension:**

Compile the extension, open `apps/vscode-extension` in VS Code, and press `F5` to
run the extension:

```bash
bun run --cwd apps/vscode-extension compile
```

Set `reviewbot.apiUrl` and `reviewbot.apiKey` to your dashboard and its
`/api/review/diff` shared key. The default URL is `http://localhost:3000`.

**Bun webhook server:**

Run `bun run apps/webhook/src/server.ts` from the root. Set `PORT` in that
process's environment to an unused port, such as `3002`, if the dashboard already
uses port `3000`. The docs site uses `3001` in its current script.

## 6. Database and migrations

The project uses Drizzle. The schema is in
[packages/db/src/schema.ts](packages/db/src/schema.ts).

```bash
# Generate a migration after changing the schema.
bun run db:generate

# Apply migrations to the configured database.
bun run db:migrate

# Push the schema directly to a disposable development database.
bun run db:push

# Open the database GUI.
bun run db:studio
```

After changing `schema.ts`, generate and apply a migration. `db:push` is an option
for disposable development databases. Commit migrations and snapshots; do not
rewrite migrations that have already been published.

Main SQL tables include `organizations`, `repositories`, `reviews`,
`review_comments`, `user_organizations`, `rate_limits`, `stripe_webhook_events`,
`review_runs`, `review_reservations`, and `notification_outbox`. Better Auth uses
`user`, `session`, `account`, and `verification`.

## 7. Command reference

```bash
# Installation and development
bun install                   # Install workspace dependencies.
bun run dev                   # Run development scripts.
bun run build                 # Run workspace build scripts through Turbo.
bun run typecheck             # Check workspace TypeScript.
bun run lint                  # Lint the repository.
bun test tests                # Run offline regression tests.
bun run billing:verify        # Verify sandbox invoices with Stripe test credentials.
bun run format                # Format with Prettier.

# Database
bun run db:generate           # Generate a migration.
bun run db:migrate            # Apply migrations.
bun run db:push               # Push schema to a development database.
bun run db:studio             # Open the GUI.

# Deployment: run each example from the repository root.
cd apps/webhook && bunx wrangler deploy
bun run --cwd packages/queue deploy
cd apps/dashboard && vercel deploy --prod

# Cleanup
bun run clean                 # Remove build artifacts and node_modules.
```

Run a script for one workspace with `bun run --filter @repo/db <script>`.

## 8. End-to-end testing

### Method 1: Review a diff directly

Configure `REVIEW_API_KEY` and send a unified diff to `POST /api/review/diff`.
The shell variable in this example must contain the same key as the server:

```bash
curl -X POST http://localhost:3000/api/review/diff \
  -H "Authorization: Bearer $REVIEW_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "diff": "diff --git a/x.ts b/x.ts\n@@ -0,0 +1 @@\n+const x: any = 1\n",
    "profile": "typescript",
    "language": "en"
  }'
# Returns: { score, summary, comments[], tokensUsed }
```

This is the shortest path to checking the configured AI provider, prompt, and
structured output without setting up a webhook.

### Method 2: Exercise the GitHub webhook flow

1. Start the webhook receiver as described in section 5 and run the queue with
   `bun run --cwd packages/queue dev`.
2. Expose the receiver through an HTTPS tunnel, such as Cloudflare Tunnel or ngrok.
3. Set the GitHub App webhook URL to the tunnel's `/webhook/github` endpoint.
4. Open or update a PR in a repository where the App is installed.
5. Check the receiver's accepted response, the `review-pull-request` task in
   Trigger.dev, inline PR comments, and `reviews`/`review_comments` records in
   Drizzle Studio.

### Method 3: Receive Stripe webhooks locally

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

Use the signing secret printed by `stripe listen` as the local
`STRIPE_WEBHOOK_SECRET`.

## 9. Production deployment

The deployment has four independently configured components:

| Component        | Example target                       | Command                                     |
| ---------------- | ------------------------------------ | ------------------------------------------- |
| Webhook receiver | Cloudflare Workers                   | `cd apps/webhook && bunx wrangler deploy`   |
| Queue            | Trigger.dev Cloud                    | `bun run --cwd packages/queue deploy`       |
| Dashboard        | Vercel                               | `cd apps/dashboard && vercel deploy --prod` |
| Database         | Managed PostgreSQL, such as Supabase | `bun run db:migrate`                        |

### Before deployment

1. Create the Cloudflare KV namespace with
   `wrangler kv namespace create RATE_LIMIT_KV` and replace its placeholder ID in
   [apps/webhook/wrangler.toml](apps/webhook/wrangler.toml).
2. Configure Worker secrets using `wrangler secret put <KEY>` from the webhook
   workspace. Use the bindings required for the selected Git provider,
   `TRIGGER_SECRET_KEY`, and `DATABASE_URL`; see `wrangler.toml`.
3. Set `TRIGGER_PROJECT_ID` before deploying the queue, and configure the
   credentials its tasks use in the Trigger.dev environment. Workers must be able
   to reach the database.
4. Configure dashboard environment variables in the hosting project's settings.
5. Update GitHub OAuth callbacks and the Stripe webhook endpoint to production
   URLs.

See sections 8–13 of [SETUP.md](SETUP.md) (Thai) for service configuration and
the launch checklist.

## 10. Self-hosting with Docker

Anyone can self-host under the [MIT License](LICENSE). The repository includes
[Dockerfile.webhook](Dockerfile.webhook),
[Dockerfile.dashboard](Dockerfile.dashboard), and
[docker-compose.yml](docker-compose.yml).

```bash
# 1. Configure environment variables.
cp .env.example .env
# Set the GitHub App/auth credentials, AI provider, Trigger.dev secret,
# BETTER_AUTH_SECRET, OAuth credentials, and POSTGRES_PASSWORD as needed.
# For local Docker, set NEXT_PUBLIC_APP_URL=http://localhost:3001.

# 2. Build and start PostgreSQL, receiver, dashboard, and migrations.
docker compose up -d --build
```

Default services:

| Service          | Endpoint or behavior                          |
| ---------------- | --------------------------------------------- |
| PostgreSQL       | `127.0.0.1:5432`                              |
| Webhook receiver | `http://localhost:3000`, using the Bun server |
| Dashboard        | `http://localhost:3001`                       |
| Migrations       | Runs once when the database is ready          |

Details of the self-hosted deployment:

- The receiver uses [apps/webhook/src/server.ts](apps/webhook/src/server.ts),
  whose `createMemoryKV` supplies an in-memory KV-compatible cache.
- PostgreSQL runs in a container; application database URLs inside Compose use
  the `postgres` service hostname.
- The migration service runs `drizzle-kit migrate` in `packages/db` after the
  database is healthy and before starting the receiver/dashboard.
- Trigger.dev runs separately. Deploy the tasks and configure a database URL
  reachable from those workers.
- Docker does not include a Trigger.dev server or AI model. Selected review
  code is sent to the configured AI providers.
- The application's default plans and quotas remain enabled. MIT licensing
  does not automatically disable runtime quotas.

## 11. Extending the project

### Add a convention profile

Update `buildSystemPrompt()` in
[packages/ai/src/prompts.ts](packages/ai/src/prompts.ts). Add conventions selected
by `config.profile`, for example for React or Django.

### Add repository-specific rules

Users place `.reviewbot.yml` at the root of the repository being reviewed.
`parseReviewBotConfig()` in [packages/ai/src/config.ts](packages/ai/src/config.ts)
parses `profile`, `language`, `rules`, `ignore`, and `limits`.

### Add another Git platform

Follow the existing integration pattern in five places:

1. Add `packages/<platform>` with a client and types, following `packages/gitlab`.
2. Add a webhook handler and signature middleware under `apps/webhook/src`.
3. Register a route in [apps/webhook/src/index.ts](apps/webhook/src/index.ts).
4. Add a task in `packages/queue/src/tasks` and export it from
   [packages/queue/src/index.ts](packages/queue/src/index.ts).
5. Extend the provider enum and external identity columns in
   [packages/db/src/schema.ts](packages/db/src/schema.ts).

### Change review filtering and limits

Filtering lives in each review task, for example
[packages/queue/src/tasks/review-pr.ts](packages/queue/src/tasks/review-pr.ts).
Review the deleted-file check, changed-line limit, ignore patterns, and
`max_files_per_pr`.

### Change AI output structure

Update the Zod `ReviewSchema` in
[packages/ai/src/index.ts](packages/ai/src/index.ts). Consider its effects on
structured output, persistence, and the UI.

## 12. Troubleshooting

| Symptom                                     | Common cause                                                             | Action                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `bun install` fails                         | Older Bun version                                                        | Use the repository's Bun version; upgrade if necessary                               |
| Webhook returns 401                         | Signing secret differs between provider and receiver                     | Match secrets on both sides                                                          |
| Webhook returns 429                         | Free monthly quota reached                                               | Check `rate_limits` and the organization's plan                                      |
| AI review does not run                      | Missing/invalid AI keys or exhausted provider quota                      | Check `/api/health/ai`; OpenAI is first by default                                   |
| Job does not run                            | Missing `TRIGGER_PROJECT_ID`/`TRIGGER_SECRET_KEY`, runner, or deployment | Configure project/key and use queue dev/deploy scripts                               |
| Webhook returns 503                         | Missing signing secret or unavailable quota database                     | Check provider secret and database connectivity                                      |
| Checkout returns 503                        | Missing or invalid Stripe price/meter configuration                      | Verify base and metered prices against the billing requirements                      |
| Notification remains pending/failed         | Service outage or incorrect credentials                                  | Inspect `notification_outbox` and `retry-notifications`                              |
| No inline comment despite a successful task | Comment line does not map to the diff                                    | Inspect `getModifiedLines()` in [packages/ai/src/patch.ts](packages/ai/src/patch.ts) |
| Sign-in fails                               | Incorrect OAuth callback or missing auth secret                          | Configure the origin's `/api/auth/callback/github` callback                          |
| Stripe webhook is rejected                  | Signing secret mismatch                                                  | Use the local secret printed by `stripe listen`                                      |
| Migration fails                             | Incorrect database URL or unavailable PostgreSQL                         | Check connectivity and start the Compose database if needed                          |
| Typecheck fails after a schema change       | Types no longer match the schema                                         | Generate/review the migration and fix the affected types                             |

### Debugging tips

- Read task logs in the Trigger.dev dashboard.
- Inspect database records with `bun run db:studio`.
- Check Sentry for production errors if configured.
- Verify the environment variables required by the specific component. Optional
  integrations have different behavior when unconfigured; do not assume every
  feature silently skips missing credentials.

This guide follows the repository's configuration and code. Keep the
[Thai edition](DEVELOPER-GUIDE.th.md) in sync when changing the structure or
environment variables.
