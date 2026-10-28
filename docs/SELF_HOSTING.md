# Self-hosting AI Review Bot

The code is available under the [MIT License](../LICENSE). You run the application
and supply your own database, AI keys, Git provider credentials, and infrastructure.
Third-party services may have separate fees and terms.

## 1. Install and configure

Install Git, Node.js 22+, and Bun 1.4.4, then clone and install:

```bash
git clone https://github.com/Sakeerin/ai-code-review-bot.git
cd ai-code-review-bot
bun install --frozen-lockfile
cp .env.example .env
cp .env.example apps/dashboard/.env.local
```

In PowerShell, use `Copy-Item .env.example .env` and
`Copy-Item .env.example apps/dashboard/.env.local` instead of `cp` if needed.
Keep both files private; change the example database password before deployment.

For a local dashboard, set these values in `apps/dashboard/.env.local`:

| Variable                                   | Value                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------- |
| `DATABASE_URL`                             | Your PostgreSQL connection string                                     |
| `BETTER_AUTH_SECRET`                       | A long random secret; generate one with `openssl rand -hex 32`        |
| `NEXT_PUBLIC_APP_URL`                      | `http://localhost:3000` for local dashboard development               |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Your GitHub OAuth App credentials                                     |
| At least one AI provider key               | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GEMINI_API_KEY`            |
| `REVIEW_API_KEY`                           | A separate random shared key for `/api/review/diff` and the extension |

Register the OAuth callback as
`http://localhost:3000/api/auth/callback/github` for local development. Set
`DATABASE_URL` in the root `.env` too, because migration commands read that file.
The local diff-review API can be used with `REVIEW_API_KEY` before configuring
automatic PR reviews.

You can run just PostgreSQL with Docker:

```bash
docker compose up -d postgres
bun run db:migrate
bun run --cwd apps/dashboard dev
```

The local connection string for the Compose database is
`postgresql://reviewbot:YOUR_PASSWORD@localhost:5432/reviewbot`. Set
`POSTGRES_PASSWORD` before starting it. For a clean checkout without real service
credentials, run `bun test tests` instead.

## 2. Configure automatic reviews

1. Create your own Trigger.dev project. Set `TRIGGER_PROJECT_ID` and
   `TRIGGER_SECRET_KEY` in the root `.env`; use the development key for local work
   and the production key for deployed webhook receivers.
2. Configure your Git provider's webhook URL and a strong signing secret. GitHub
   uses `GITHUB_WEBHOOK_SECRET`; GitLab uses `GITLAB_WEBHOOK_SECRET`; Bitbucket
   uses `BITBUCKET_WEBHOOK_SECRET`.
3. For GitHub, configure `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` in both the
   webhook/worker environment and dashboard. Give the App repository contents read
   access and pull requests/issues write access, and subscribe it to pull request
   events. The dashboard also needs OAuth credentials to verify installation ownership.
4. For GitLab, set `GITLAB_TOKEN` and optionally `GITLAB_API_URL`. For Bitbucket,
   set `BITBUCKET_API_TOKEN` in the worker environment. Use a scoped Bitbucket API
   token with repository read and pull request read/write permissions. The client
   sends it as a Bearer token; retired App Passwords are not supported. See
   [Atlassian's API token documentation](https://support.atlassian.com/bitbucket-cloud/docs/using-api-tokens/).
5. Give the workers `DATABASE_URL`, the AI provider keys and model settings, and
   the Git provider credentials they need. Configure the same database as the
   webhook receiver/dashboard. Cloud workers cannot use a Compose-only hostname
   such as `postgres` or your machine's `localhost`.

When upgrading an existing deployment, run `bun run db:migrate` before updating
the webhook receiver, then deploy the queue with `bun run --cwd packages/queue deploy`.
Migration 0008 adds the durable dispatch outbox and keeps only the oldest active
repository enabled for each Free organization. Administrators can change that choice
on the Repositories page. Paid organizations keep their active repositories.

Deploy the `retry-review-dispatch` scheduled task (every minute) together with the
review workers. It retries pending jobs with the original idempotency key after a
Trigger outage or lost acknowledgement. Monitor undelivered rows and their age in
`review_dispatch_outbox`; quota stays reserved until the job finishes or fails.

Paid subscription changes use a signed, ten-minute invoice preview and Stripe pending
updates. Access changes only after Stripe confirms payment through the webhook.
An existing monthly meter is retained when moving from Team to Business so delayed
Team overage events can still be billed; Business reviews do not emit new usage events.
Configure `BETTER_AUTH_SECRET` on the dashboard to sign these previews.

Run the queue's development runner with credentials from the root `.env`:

```bash
bun run --cwd packages/queue dev
```

For a local Bun webhook receiver, run this from the repository root:

```bash
bun run apps/webhook/src/server.ts
```

It listens on port 3000 by default. Set a different `PORT` in its environment,
such as `PORT=3002`, if the dashboard is already on port 3000. Set
`WEBHOOK_BASE_URL` in the dashboard environment to the public URL of the receiver.
Use your own HTTPS tunnel for local webhook delivery.

Cloudflare deployments use `apps/webhook/wrangler.toml`. Replace its KV namespace
placeholder, give the Worker its secrets with Wrangler, and deploy from that
workspace. Do not put secrets into `[vars]` in the committed file.

## 3. Deploy with Docker

Set root `.env` values for the database, auth, OAuth, GitHub App, AI providers,
and Trigger.dev. Use `NEXT_PUBLIC_APP_URL=http://localhost:3001` for local Docker
testing, or your actual HTTPS dashboard origin in production. The dashboard URL
is also a build argument, so rebuild the image after changing it. Update the OAuth
callback to that origin followed by `/api/auth/callback/github`.

```bash
docker compose config --quiet
docker compose up -d --build
```

Compose exposes the webhook on `3000`, dashboard on `3001`, and PostgreSQL on
`127.0.0.1:5432` by default. It runs database migrations before starting the
dashboard and webhook. Put an HTTPS reverse proxy in front of public endpoints.
Use `WEBHOOK_BASE_URL` to make dashboard setup instructions point at your receiver.

Docker runs the dashboard, webhook receiver, PostgreSQL, and migration job. It
does not start a Trigger.dev server or background review workers. Deploy the
queue separately:

```bash
bun run --cwd packages/queue deploy
```

Set worker secrets in your Trigger.dev environment as well. Include the scheduled
`retry-notifications` task, which delivers pending Stripe/Slack outbox records.
For a privately hosted worker service, provision Trigger.dev separately according
to its upstream documentation; this repository does not bundle that deployment.

## 4. Optional integrations and quotas

- Stripe can stay unconfigured for Free-plan testing. The application still
  enforces default plan quotas; the MIT license does not change runtime limits.
- Team checkout requires both a base price and a monthly USD $0.05 metered price
  linked to the configured meter event name. Annual Team uses flexible billing.
  Existing subscriptions need the metered item attached before overage is billed.
- Slack accepts official HTTPS incoming webhook URLs on `hooks.slack.com` and
  `hooks.slack-gov.com`. Configure them per organization or with `SLACK_WEBHOOK_URL`
  in the worker environment.
- Weekly email reports require `RESEND_API_KEY`, `EMAIL_FROM`, and recipients
  configured for the organization.
- Sentry/Axiom are optional. Review the data they receive before enabling them.

## Upgrading and operations

Read the Developer Guide in [English](../DEVELOPER-GUIDE.md) or
[Thai](../DEVELOPER-GUIDE.th.md) for migrations and current retry behavior.
Let old review jobs finish, stop old workers, back up your database,
apply migrations, and deploy compatible webhook/dashboard/workers together.

Retries for a PR/commit use the same review result and remote comment markers.
Duplicate webhooks do not use another quota slot. After a task has finished or
exhausted retries, push a new commit to start another review through a webhook.

Notification delivery retries up to ten times. Inspect failed
`notification_outbox` rows after fixing credentials or configuration. Stripe uses
stable event identifiers; Slack delivery is at least once and may duplicate when
an acknowledgement is lost.

See [SECURITY.md](../SECURITY.md) for data handling, credential practices, and
private vulnerability reporting. Maintainers do not operate your deployment or
provide a support SLA.
