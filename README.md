# AI Review Bot

Framework-aware AI code reviews for GitHub & GitLab, powered by Claude.

AI Review Bot posts inline PR/MR comments that understand your stack — Laravel, Vue, TypeScript — and enforce your team's custom rules automatically. Built on Cloudflare Workers for sub-200ms webhook response.

---

## Features

- **Inline code review comments** — Claude reviews your diff and posts comments directly on the changed lines
- **Framework-aware profiles** — built-in conventions for Laravel, Vue.js, and TypeScript
- **Custom YAML rules** — define team-specific rules in `.reviewbot.yml` per repository
- **GitHub & GitLab support** — works with both Pull Requests and Merge Requests
- **Usage-based billing** — Free (50 PRs/mo), Team (500 PRs/mo + $0.05 overage), Business (unlimited)
- **Annual billing** — 20% discount on yearly plans
- **Slack notifications** — review summary posted to your channel on completion
- **Dashboard** — review history, token usage, PR score trends, and billing management
- **Rate limiting** — per-organization quota enforced at the edge via Cloudflare Workers KV

---

## Tech Stack

| Layer | Technology |
|---|---|
| Webhook endpoint | Hono.js on Cloudflare Workers |
| AI review engine | Claude (Anthropic) via Vercel AI SDK |
| Background jobs | Trigger.dev v3 |
| Database & ORM | PostgreSQL (Supabase) + Drizzle ORM |
| Dashboard | Next.js 15 App Router |
| Auth | Better Auth (GitHub OAuth) |
| Billing | Stripe (subscriptions + Billing Meter) |
| Observability | Sentry + Axiom |
| Monorepo | Turborepo + Bun workspaces |

---

## Repository Structure

```
ai-review-bot/
├── apps/
│   ├── webhook/          — Hono.js on Cloudflare Workers (webhook receiver)
│   ├── dashboard/        — Next.js 15 dashboard (auth, billing, history)
│   └── docs/             — Fumadocs documentation site
├── packages/
│   ├── ai/               — Claude integration, prompts, convention profiles
│   ├── github/           — GitHub App API client
│   ├── gitlab/           — GitLab API client
│   ├── db/               — Drizzle schema, migrations, shared client
│   ├── queue/            — Trigger.dev task definitions
│   └── ui/               — Shared shadcn/ui components
├── .env.example
└── turbo.json
```

---

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) >= 1.3.0
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (for webhook deployment)
- A [Supabase](https://supabase.com) project (PostgreSQL)
- A [GitHub App](https://docs.github.com/en/apps/creating-github-apps) with `pull_requests:write` and `contents:read` permissions
- An [Anthropic API key](https://console.anthropic.com)
- A [Trigger.dev](https://trigger.dev) project
- A [Stripe](https://stripe.com) account with products configured

### 1. Install dependencies

```bash
bun install
```

### 2. Configure environment variables

Copy `.env.example` to `.env.local` (dashboard) and set up Cloudflare secrets (webhook):

```bash
cp .env.example apps/dashboard/.env.local
```

Fill in all values — see [Environment Variables](#environment-variables) below.

### 3. Run database migrations

```bash
bun run db:migrate
```

### 4. Start development servers

```bash
# All apps in parallel
bun run dev

# Webhook only (Cloudflare Workers local)
cd apps/webhook && bunx wrangler dev

# Dashboard only
cd apps/dashboard && bun run dev
```

---

## Custom Rules (`.reviewbot.yml`)

Place a `.reviewbot.yml` file in the root of any repository to configure AI Review Bot for that repo:

```yaml
version: 1
profile: laravel-vue       # laravel | vue | typescript | laravel-vue
language: th               # en | th — comment language

rules:
  - id: no-raw-query
    severity: bug
    message: "ห้ามใช้ DB::statement() โดยตรง ใช้ Query Builder หรือ Eloquent แทน"
  - id: no-n-plus-one
    severity: bug
    message: "พบ N+1 query ให้ใช้ with() eager loading"

ignore:
  - "database/migrations/**"
  - "tests/**"

limits:
  max_file_size_lines: 500   # skip files larger than this
  max_files_per_pr: 20       # review at most this many files per PR
```

**Severity levels:** `bug` | `suggestion` | `nitpick` | `praise`

---

## Pricing

| Plan | Price | PR Reviews/mo | Repositories |
|---|---|---|---|
| Free | $0 | 50 | 1 |
| Team | $19/mo | 500 + $0.05 overage | Unlimited |
| Business | $49/mo | Unlimited | Unlimited |
| Enterprise | Custom | Unlimited | Unlimited + self-host |

Annual plans available at 20% discount.

---

## Deployment

### Webhook (Cloudflare Workers)

```bash
# Set secrets
wrangler secret put GITHUB_APP_ID
wrangler secret put GITHUB_APP_PRIVATE_KEY
wrangler secret put GITHUB_WEBHOOK_SECRET
wrangler secret put GITLAB_WEBHOOK_SECRET
wrangler secret put GITLAB_TOKEN
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put TRIGGER_SECRET_KEY
wrangler secret put DATABASE_URL

# Create KV namespace for rate limiting
wrangler kv namespace create RATE_LIMIT_KV
# Update the id in wrangler.toml

# Deploy
cd apps/webhook && bunx wrangler deploy
```

### Dashboard (Vercel)

```bash
cd apps/dashboard && vercel deploy
```

Set all environment variables in the Vercel project settings (see `.env.example`).

---

## Environment Variables

See [`.env.example`](.env.example) for the full list. Key variables:

| Variable | Description |
|---|---|
| `GITHUB_APP_ID` | GitHub App ID |
| `GITHUB_APP_PRIVATE_KEY` | GitHub App private key (PEM) |
| `GITHUB_WEBHOOK_SECRET` | GitHub webhook HMAC secret |
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude |
| `TRIGGER_SECRET_KEY` | Trigger.dev secret key |
| `DATABASE_URL` | Supabase PostgreSQL connection string |
| `BETTER_AUTH_SECRET` | Random secret for Better Auth sessions |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `STRIPE_METER_EVENT_NAME` | Stripe Billing Meter event name (e.g. `pr_review`) |
| `NEXT_PUBLIC_APP_URL` | Public URL of the dashboard |

---

## Development Commands

```bash
bun run dev          # start all apps
bun run build        # build all packages
bun run typecheck    # TypeScript check across monorepo
bun run lint         # lint all packages
bun run format       # format with Prettier
bun run db:generate  # generate Drizzle migrations
bun run db:migrate   # run migrations
bun run db:studio    # open Drizzle Studio
bun run clean        # remove all build artifacts and node_modules
```

---

## How It Works

```
GitHub / GitLab
    │  PR/MR opened or updated
    ▼
Cloudflare Workers (Hono.js)
    │  1. Verify HMAC signature
    │  2. Check rate limit (KV)
    │  3. Dispatch Trigger.dev task
    ▼
Trigger.dev background job
    │  1. Fetch PR diff
    │  2. Load .reviewbot.yml from repo
    │  3. Apply file filters and limits
    ▼
Claude (Anthropic)
    │  generateObject() → ReviewSchema
    │  (framework profile + custom rules in system prompt)
    ▼
Post inline comments
    │  GitHub Review API / GitLab MR Notes
    │  Save to PostgreSQL
    │  Report usage to Stripe Billing Meter
    └  Send Slack notification
```

---

## License

Private — all rights reserved.
