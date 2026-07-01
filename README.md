# AI Review Bot

Framework-aware AI code reviews for GitHub, GitLab & Bitbucket — powered by Claude, GPT & Gemini.

AI Review Bot posts inline PR/MR comments that understand your stack — Laravel, Vue, TypeScript — and enforce your team's custom rules automatically. Built on Cloudflare Workers for sub-200ms webhook response, with automatic fallback across multiple AI providers.

> 📚 **Docs:** [Developer Guide](DEVELOPER-GUIDE.md) (setup & run) · [Setup Guide](SETUP.md) (external services) · [Phase Summary](PHASE-SUMMARY.md) (feature/file breakdown) · [Implementation Plan](implementation-plan.md)

---

## Features

- **Inline code review comments** — the AI reviews your diff and posts comments directly on the changed lines
- **Multi-provider AI with automatic fallback** — OpenAI GPT (default), Anthropic Claude, and Google Gemini; falls back to the next provider when one is unconfigured, out of quota, or failing
- **Framework-aware profiles** — built-in conventions for Laravel, Vue.js, and TypeScript
- **AI profile generator** — analyzes a repo and generates a tailored `.reviewbot.yml`
- **Custom YAML rules** — define team-specific rules in `.reviewbot.yml` per repository
- **GitHub, GitLab & Bitbucket support** — works with Pull Requests and Merge Requests
- **Usage-based billing** — Free (50 PRs/mo), Team (500 PRs/mo + $0.05 overage), Business (unlimited)
- **Annual billing** — 20% discount on yearly plans
- **Slack notifications** — review summary posted to your channel on completion
- **Weekly email reports** — per-org digest of reviews, bugs found, and average score
- **Dashboard** — review history, token usage, PR score trends, and billing management
- **Rate limiting** — per-organization quota enforced with atomic DB counters
- **IDE integrations** — MCP server + VS Code extension to review code before you push
- **Self-hosted option** — Docker Compose stack for privacy-sensitive teams

---

## Tech Stack

| Layer | Technology |
|---|---|
| Webhook endpoint | Hono.js on Cloudflare Workers (or Bun for self-hosted) |
| AI review engine | GPT (OpenAI, default), Claude (Anthropic), Gemini (Google) via Vercel AI SDK |
| Background jobs | Trigger.dev v3 |
| Database & ORM | PostgreSQL (Supabase) + Drizzle ORM |
| Dashboard | Next.js 15 App Router |
| Auth | Better Auth (GitHub OAuth) |
| Billing | Stripe (subscriptions + Billing Meter) |
| Email reports | Resend |
| IDE integration | MCP server + VS Code extension |
| Observability | Sentry + Axiom |
| Monorepo | Turborepo + Bun workspaces |

---

## Repository Structure

```
ai-review-bot/
├── apps/
│   ├── webhook/          — Hono.js on Cloudflare Workers / Bun (webhook receiver)
│   ├── dashboard/        — Next.js 15 dashboard (auth, billing, history)
│   ├── docs/             — Fumadocs documentation site
│   ├── mcp-server/       — MCP server (expose reviews & AI to IDEs)
│   └── vscode-extension/ — VS Code extension (review before push)
├── packages/
│   ├── ai/               — Multi-provider AI, prompts, profiles, fallback
│   ├── github/           — GitHub App API client
│   ├── gitlab/           — GitLab API client
│   ├── bitbucket/        — Bitbucket API client
│   ├── db/               — Drizzle schema, migrations, shared client
│   ├── queue/            — Trigger.dev task definitions
│   └── ui/               — Shared shadcn/ui components
├── Dockerfile.webhook / Dockerfile.dashboard / docker-compose.yml
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
- **At least one AI provider key** — [Anthropic](https://console.anthropic.com), [OpenAI](https://platform.openai.com), or [Google Gemini](https://aistudio.google.com/app/apikey) (configure several for automatic fallback)
- A [Trigger.dev](https://trigger.dev) project
- A [Stripe](https://stripe.com) account with products configured

### 1. Install dependencies

```bash
bun install
```

### 2. Configure environment variables

Copy `.env.example` to both the root (`.env`, used by webhook/queue) and the dashboard (`.env.local`):

```bash
cp .env.example .env
cp .env.example apps/dashboard/.env.local
```

At minimum set `DATABASE_URL`, one AI provider key (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY`), `BETTER_AUTH_SECRET`, and GitHub OAuth credentials. Fill in the rest — see [Environment Variables](#environment-variables) below and the [Developer Guide](DEVELOPER-GUIDE.md).

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

## Multi-Provider AI & Fallback

Configure one or more AI providers. The pipeline tries them in the order set by `AI_PROVIDER_ORDER` and **automatically falls back** to the next provider when one is unconfigured, out of quota, rate limited, or erroring.

```bash
AI_PROVIDER_ORDER=openai,anthropic,gemini   # priority order (default)
OPENAI_API_KEY=sk-...                       # primary
ANTHROPIC_API_KEY=sk-ant-...                # fallback 1
GEMINI_API_KEY=AI...                        # fallback 2
# optional model overrides:
OPENAI_MODEL=gpt-4o
ANTHROPIC_MODEL=claude-sonnet-4-6
GEMINI_MODEL=gemini-2.0-flash
```

| Error on a provider | Falls back to next? | Retries job later (if last)? |
|---|---|---|
| Quota / rate limit (429) | ✅ | ✅ |
| Auth error (401 / 403) | ✅ | ❌ |
| Server error (5xx) | ✅ | ✅ |
| Schema / bad request (400) | ❌ | ❌ |
| Network / timeout | ✅ | ✅ |

Check which providers are active (keys are never exposed):

```bash
curl http://localhost:3000/api/health/ai
# { "ok": true, "order": "openai,anthropic,gemini", "activeProvider": "openai", "providers": [...] }
```

> Review jobs run on Trigger.dev Cloud — set these keys in the Trigger.dev dashboard too. See [Developer Guide §4.1](DEVELOPER-GUIDE.md#41-multi-provider-ai--fallback).

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
wrangler secret put ANTHROPIC_API_KEY   # + OPENAI_API_KEY / GEMINI_API_KEY as needed
wrangler secret put TRIGGER_SECRET_KEY
wrangler secret put DATABASE_URL

# Create KV namespace for rate limiting
wrangler kv namespace create RATE_LIMIT_KV
# Update the id in wrangler.toml

# Deploy
cd apps/webhook && bunx wrangler deploy
```

> Review jobs run on Trigger.dev — deploy them and set the same secrets in the Trigger.dev dashboard: `cd packages/queue && bunx trigger.dev deploy`

### Dashboard (Vercel)

```bash
cd apps/dashboard && vercel deploy
```

Set all environment variables in the Vercel project settings (see `.env.example`).

### Self-hosted (Docker)

Run the full stack (PostgreSQL + webhook + dashboard + migrations) locally or on your own infra:

```bash
cp .env.example .env   # fill in AI keys, GitHub App, auth, etc.
docker compose up -d --build
# webhook → :3000   dashboard → :3001   postgres → :5432
```

---

## Environment Variables

See [`.env.example`](.env.example) for the full list. Key variables:

| Variable | Description |
|---|---|
| `GITHUB_APP_ID` | GitHub App ID |
| `GITHUB_APP_PRIVATE_KEY` | GitHub App private key (PEM) |
| `GITHUB_WEBHOOK_SECRET` | GitHub webhook HMAC secret |
| `AI_PROVIDER_ORDER` | Provider priority, default `openai,anthropic,gemini` (optional) |
| `OPENAI_API_KEY` | OpenAI API key for GPT (primary provider) |
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude (fallback, optional) |
| `GEMINI_API_KEY` | Google Gemini API key (fallback, optional) |
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
GitHub / GitLab / Bitbucket
    │  PR/MR opened or updated
    ▼
Cloudflare Workers (Hono.js)
    │  1. Verify HMAC signature
    │  2. Check rate limit (atomic DB counter)
    │  3. Dispatch Trigger.dev task
    ▼
Trigger.dev background job
    │  1. Fetch PR diff
    │  2. Load .reviewbot.yml from repo
    │  3. Apply file filters and limits
    ▼
AI provider (GPT → Claude → Gemini, with fallback)
    │  generateObject() → ReviewSchema
    │  (framework profile + custom rules in system prompt)
    ▼
Post inline comments
    │  GitHub Review API / GitLab MR Notes / Bitbucket Comments
    │  Save to PostgreSQL
    │  Report usage to Stripe Billing Meter
    └  Send Slack notification
```

---

## License

Private — all rights reserved.
