# คู่มือการตั้งค่า AI Review Bot

เอกสารนี้อธิบายขั้นตอนการตั้งค่าทุกบริการที่จำเป็นตั้งแต่ต้นจนสามารถ deploy ได้จริง

---

## สารบัญ

1. [สิ่งที่ต้องเตรียม](#1-สิ่งที่ต้องเตรียม)
2. [GitHub App](#2-github-app)
3. [GitLab Integration](#3-gitlab-integration)
4. [Anthropic API Key](#4-anthropic-api-key)
5. [Supabase (Database)](#5-supabase-database)
6. [Trigger.dev](#6-triggerdev)
7. [Stripe (Billing)](#7-stripe-billing)
8. [Cloudflare Workers (Webhook)](#8-cloudflare-workers-webhook)
9. [Sentry (Error Tracking)](#9-sentry-error-tracking)
10. [Axiom (Logging)](#10-axiom-logging)
11. [Slack Notifications](#11-slack-notifications)
12. [Dashboard (Vercel)](#12-dashboard-vercel)
13. [ไฟล์ Environment Variables สรุป](#13-ไฟล์-environment-variables-สรุป)

---

## 1. สิ่งที่ต้องเตรียม

| เครื่องมือ | เวอร์ชัน | หมายเหตุ |
|---|---|---|
| [Bun](https://bun.sh) | >= 1.3.0 | runtime หลัก |
| [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) | latest | deploy Cloudflare Workers |
| บัญชี Cloudflare | — | Workers + KV |
| บัญชี Supabase | — | PostgreSQL |
| บัญชี Anthropic | — | Claude API |
| บัญชี Trigger.dev | — | background jobs |
| บัญชี Stripe | — | billing |
| บัญชี Vercel | — | host dashboard |

ติดตั้ง Bun และ Wrangler:

```bash
# Bun
curl -fsSL https://bun.sh/install | bash

# Wrangler
bun add -g wrangler
wrangler login
```

---

## 2. GitHub App

GitHub App ทำหน้าที่รับ webhook event และโพสต์ review comment บน Pull Request

### 2.1 สร้าง GitHub App

1. ไปที่ **GitHub → Settings → Developer settings → GitHub Apps → New GitHub App**
2. ตั้งค่าดังนี้:

| ฟิลด์ | ค่า |
|---|---|
| GitHub App name | `AI Review Bot` (หรือชื่อที่ต้องการ) |
| Homepage URL | URL ของ dashboard เช่น `https://reviewbot.app` |
| Webhook URL | URL ของ Cloudflare Workers เช่น `https://ai-review-bot-webhook.workers.dev/webhook/github` |
| Webhook secret | สุ่มสตริงยาว ๆ เช่น `openssl rand -hex 32` |

3. **Repository permissions:**
   - `Contents` → Read
   - `Pull requests` → Read & Write
   - `Metadata` → Read

4. **Subscribe to events:**
   - `Pull request`
   - `Installation`

5. กด **Create GitHub App**

### 2.2 สร้าง Private Key

1. เข้าหน้า App ที่เพิ่งสร้าง → **General → Private keys → Generate a private key**
2. บันทึกไฟล์ `.pem` ที่ดาวน์โหลดมา
3. แปลงเป็น single-line สำหรับใส่ใน env:

```bash
# แปลง newline เป็น \n
awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' your-app.private-key.pem
```

### 2.3 สร้าง OAuth App (สำหรับ Dashboard Login)

1. ไปที่ **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**
2. ตั้งค่า:
   - **Authorization callback URL:** `https://your-dashboard.vercel.app/api/auth/callback/github`
3. คัดลอก **Client ID** และ **Client Secret**

### 2.4 Environment Variables ที่ได้

```bash
GITHUB_APP_ID=          # App ID (ตัวเลข)
GITHUB_APP_PRIVATE_KEY= # PEM key แบบ single-line (มี \n)
GITHUB_WEBHOOK_SECRET=  # Webhook secret ที่ตั้งไว้
GITHUB_APP_SLUG=        # Slug จาก URL ของ App เช่น ai-review-bot
GITHUB_CLIENT_ID=       # OAuth App Client ID
GITHUB_CLIENT_SECRET=   # OAuth App Client Secret
```

---

## 3. GitLab Integration

### 3.1 สร้าง GitLab Personal Access Token หรือ Group Access Token

1. ไปที่ **GitLab → User Settings → Access Tokens**
2. สร้าง token ด้วย scope: `api`, `read_repository`
3. คัดลอก token

### 3.2 ตั้งค่า Webhook บน GitLab Group/Project

1. ไปที่ **Group หรือ Project → Settings → Webhooks**
2. ตั้งค่า:
   - **URL:** `https://ai-review-bot-webhook.workers.dev/webhook/gitlab`
   - **Secret token:** สุ่มสตริง
   - **Trigger:** เลือก `Merge request events`
3. กด **Add webhook**

### 3.3 Environment Variables ที่ได้

```bash
GITLAB_TOKEN=           # Personal/Group Access Token
GITLAB_WEBHOOK_SECRET=  # Secret token ที่ตั้งไว้
GITLAB_API_URL=https://gitlab.com/api/v4  # เปลี่ยนถ้าเป็น self-hosted
```

---

## 4. Anthropic API Key

1. ไปที่ [console.anthropic.com](https://console.anthropic.com)
2. **API Keys → Create Key**
3. คัดลอก key

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

---

## 5. Supabase (Database)

### 5.1 สร้างโปรเจค

1. ไปที่ [supabase.com](https://supabase.com) → **New project**
2. เลือก region ที่ใกล้ที่สุด (แนะนำ Singapore)
3. ตั้ง Database Password ที่แข็งแกร่ง

### 5.2 คัดลอก Connection String

1. ไปที่ **Project Settings → Database → Connection string → URI**
2. คัดลอก connection string (แบบ `postgresql://...`)

### 5.3 รัน Migration

```bash
bun run db:migrate
```

### 5.4 Environment Variables ที่ได้

```bash
DATABASE_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT].supabase.co:5432/postgres
```

---

## 6. Trigger.dev

### 6.1 สร้างโปรเจค

1. ไปที่ [trigger.dev](https://trigger.dev) → **New project**
2. เลือก **Background workers**

### 6.2 คัดลอก Secret Key

1. ไปที่ **Project → API Keys**
2. คัดลอก **Secret key** (ขึ้นต้นด้วย `tr_`)

### 6.3 Deploy Tasks

```bash
cd packages/queue
bunx trigger.dev deploy
```

### 6.4 Environment Variables ที่ได้

```bash
TRIGGER_SECRET_KEY=tr_...
```

> **หมายเหตุ:** ต้องตั้ง environment variables ทั้งหมดใน Trigger.dev dashboard ด้วย (Database URL, GitHub App credentials, Anthropic API key) เพราะ tasks รันบน Trigger.dev cloud

---

## 7. Stripe (Billing)

### 7.1 สร้าง Products และ Prices

ไปที่ [dashboard.stripe.com](https://dashboard.stripe.com) → **Products → Add product**

สร้าง 4 prices:

| ชื่อ | ราคา | Interval | Env var |
|---|---|---|---|
| Team Monthly | $19.00 | Monthly | `STRIPE_TEAM_PRICE_ID` |
| Team Annual | $180.00 | Yearly | `STRIPE_TEAM_ANNUAL_PRICE_ID` |
| Business Monthly | $49.00 | Monthly | `STRIPE_BUSINESS_PRICE_ID` |
| Business Annual | $468.00 | Yearly | `STRIPE_BUSINESS_ANNUAL_PRICE_ID` |

### 7.2 สร้าง Billing Meter (Overage)

1. ไปที่ **Billing → Meters → Create meter**
2. ตั้งค่า:
   - **Display name:** `PR Reviews`
   - **Event name:** `pr_review` (ต้องตรงกับ `STRIPE_METER_EVENT_NAME`)
   - **Aggregation:** Sum
3. คัดลอก **Meter ID** (`mtr_...`)

### 7.3 สร้าง Overage Price

1. สร้าง product ชื่อ `PR Review Overage`
2. เพิ่ม price แบบ **Usage-based**:
   - **Billing meter:** เลือก meter ที่สร้างไว้
   - **Price:** $0.05 per unit
3. คัดลอก Price ID → `STRIPE_OVERAGE_PRICE_ID`

### 7.4 ตั้งค่า Stripe Webhook

1. ไปที่ **Developers → Webhooks → Add endpoint**
2. **Endpoint URL:** `https://your-dashboard.vercel.app/api/webhooks/stripe`
3. **Events to listen:**
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. คัดลอก **Signing secret** (`whsec_...`)

### 7.5 Environment Variables ที่ได้

```bash
STRIPE_SECRET_KEY=sk_live_...          # หรือ sk_test_... สำหรับ dev
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_METER_ID=mtr_...
STRIPE_METER_EVENT_NAME=pr_review
STRIPE_TEAM_PRICE_ID=price_...
STRIPE_BUSINESS_PRICE_ID=price_...
STRIPE_TEAM_ANNUAL_PRICE_ID=price_...
STRIPE_BUSINESS_ANNUAL_PRICE_ID=price_...
STRIPE_OVERAGE_PRICE_ID=price_...
```

> **Test mode:** ระหว่าง development ใช้ `sk_test_` และ `pk_test_` และรัน `stripe listen --forward-to localhost:3000/api/webhooks/stripe` เพื่อทดสอบ webhook

---

## 8. Cloudflare Workers (Webhook)

### 8.1 สร้าง KV Namespace

```bash
wrangler kv namespace create RATE_LIMIT_KV
```

คัดลอก `id` ที่ได้ และแก้ไข `apps/webhook/wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "RATE_LIMIT_KV"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"  # ใส่ ID จริง
```

### 8.2 ตั้งค่า Secrets

```bash
cd apps/webhook

wrangler secret put GITHUB_APP_ID
wrangler secret put GITHUB_APP_PRIVATE_KEY
wrangler secret put GITHUB_WEBHOOK_SECRET
wrangler secret put GITLAB_WEBHOOK_SECRET
wrangler secret put GITLAB_TOKEN
wrangler secret put GITLAB_API_URL
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put TRIGGER_SECRET_KEY
wrangler secret put DATABASE_URL
```

### 8.3 Deploy

```bash
cd apps/webhook
bunx wrangler deploy
```

Worker URL จะเป็น: `https://ai-review-bot-webhook.[your-account].workers.dev`

> อัปเดต Webhook URL ใน GitHub App และ GitLab ให้ตรงกับ URL นี้

---

## 9. Sentry (Error Tracking)

1. ไปที่ [sentry.io](https://sentry.io) → **New Project**
2. เลือก **Next.js** สำหรับ dashboard และ **Node.js** สำหรับ webhook
3. คัดลอก **DSN**

```bash
SENTRY_DSN=https://xxxxxxxx@oxxxxxxx.ingest.sentry.io/xxxxxxx
```

---

## 10. Axiom (Logging)

1. ไปที่ [axiom.co](https://axiom.co) → **Settings → API Tokens → New API Token**
2. ให้ permission `ingest` บน dataset ที่ต้องการ
3. คัดลอก token

```bash
AXIOM_TOKEN=xaat-...
```

---

## 11. Slack Notifications

1. ไปที่ [api.slack.com/apps](https://api.slack.com/apps) → **Create New App → From scratch**
2. ไปที่ **Incoming Webhooks → Activate**
3. กด **Add New Webhook to Workspace** → เลือก channel
4. คัดลอก Webhook URL

```bash
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T.../B.../...
```

---

## 12. Dashboard (Vercel)

### 12.1 Deploy

```bash
cd apps/dashboard
vercel deploy --prod
```

### 12.2 ตั้งค่า Environment Variables ใน Vercel

ไปที่ **Project → Settings → Environment Variables** และเพิ่มทุกตัวแปรในหัวข้อถัดไป

### 12.3 อัปเดต Callback URLs

หลัง deploy เสร็จ ให้อัปเดต:
- **GitHub OAuth App** → Authorization callback URL: `https://your-app.vercel.app/api/auth/callback/github`
- **Stripe Webhook** → Endpoint URL: `https://your-app.vercel.app/api/webhooks/stripe`

---

## 13. ไฟล์ Environment Variables สรุป

### Cloudflare Workers (`wrangler secret put`)

```bash
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY=          # PEM แบบ single-line
GITHUB_WEBHOOK_SECRET=
GITLAB_WEBHOOK_SECRET=
GITLAB_TOKEN=
GITLAB_API_URL=https://gitlab.com/api/v4
ANTHROPIC_API_KEY=
TRIGGER_SECRET_KEY=
DATABASE_URL=
```

### Next.js Dashboard (`.env.local` หรือ Vercel)

```bash
NEXT_PUBLIC_APP_URL=https://your-app.vercel.app
BETTER_AUTH_SECRET=              # รัน: openssl rand -hex 32

# GitHub
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_APP_SLUG=ai-review-bot

# Stripe
STRIPE_SECRET_KEY=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_METER_ID=
STRIPE_METER_EVENT_NAME=pr_review
STRIPE_TEAM_PRICE_ID=
STRIPE_BUSINESS_PRICE_ID=
STRIPE_TEAM_ANNUAL_PRICE_ID=
STRIPE_BUSINESS_ANNUAL_PRICE_ID=
STRIPE_OVERAGE_PRICE_ID=

# Database
DATABASE_URL=

# Notifications
SLACK_WEBHOOK_URL=
SUPPORT_EMAIL=

# Observability
AXIOM_TOKEN=
SENTRY_DSN=
```

---

## Checklist ก่อน Launch

- [ ] GitHub App สร้างและตั้งค่า Webhook URL แล้ว
- [ ] Private key ถูก set บน Cloudflare Workers แล้ว
- [ ] KV namespace สร้างและใส่ ID ใน `wrangler.toml` แล้ว
- [ ] Supabase migration รันสำเร็จ (`bun run db:migrate`)
- [ ] Trigger.dev tasks deploy แล้ว (`bunx trigger.dev deploy`)
- [ ] Stripe products, prices, meter, และ webhook ครบ
- [ ] Cloudflare Workers deploy แล้ว
- [ ] Dashboard deploy บน Vercel แล้ว
- [ ] GitHub OAuth callback URL อัปเดตแล้ว
- [ ] Stripe Webhook URL อัปเดตแล้ว
- [ ] ทดสอบ end-to-end: เปิด test PR → รอ inline comment
