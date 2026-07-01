# คู่มือนักพัฒนา (Developer Guide) — AI Code Review Bot

> คู่มือสำหรับนักพัฒนาที่ต้องการนำโปรเจคนี้ไปรัน พัฒนาต่อ หรือ deploy เอง
> ครอบคลุมตั้งแต่การเตรียมเครื่อง การตั้งค่า การรัน local การทดสอบ flow ไปจนถึง deploy และแก้ปัญหา
>
> 📎 เอกสารที่เกี่ยวข้อง: [README.md](README.md) · [SETUP.md](SETUP.md) (ตั้งค่า service ภายนอกอย่างละเอียด) · [PHASE-SUMMARY.md](PHASE-SUMMARY.md) (สรุปฟีเจอร์) · [implementation-plan.md](implementation-plan.md)

---

## สารบัญ

1. [ก่อนเริ่ม: ความรู้และเครื่องมือที่ต้องมี](#1-ก่อนเริ่ม-ความรู้และเครื่องมือที่ต้องมี)
2. [โครงสร้างโปรเจค](#2-โครงสร้างโปรเจค)
3. [Quick Start (รัน local ใน 10 นาที)](#3-quick-start-รัน-local-ใน-10-นาที)
4. [Environment Variables ทั้งหมด](#4-environment-variables-ทั้งหมด)
5. [การรันแต่ละส่วน (apps/packages)](#5-การรันแต่ละส่วน-appspackages)
6. [Database & Migration](#6-database--migration)
7. [คำสั่งที่ใช้บ่อย (Command Cheat Sheet)](#7-คำสั่งที่ใช้บ่อย-command-cheat-sheet)
8. [ทดสอบ Flow แบบ End-to-End](#8-ทดสอบ-flow-แบบ-end-to-end)
9. [การ Deploy (Production)](#9-การ-deploy-production)
10. [Self-Hosted ด้วย Docker](#10-self-hosted-ด้วย-docker)
11. [คู่มือนักพัฒนาต่อยอด (เพิ่มฟีเจอร์)](#11-คู่มือนักพัฒนาต่อยอด-เพิ่มฟีเจอร์)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. ก่อนเริ่ม: ความรู้และเครื่องมือที่ต้องมี

### เครื่องมือที่ต้องติดตั้ง

| เครื่องมือ | เวอร์ชัน | ใช้ทำอะไร |
|---|---|---|
| [Bun](https://bun.sh) | ≥ 1.3.0 | runtime + package manager หลัก (กำหนดใน `packageManager`) |
| Node.js | ≥ 22.0.0 | บาง tool ต้องใช้ (กำหนดใน `engines`) |
| [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) | latest | dev/deploy Cloudflare Workers (webhook) |
| Git | — | version control |
| Docker + Docker Compose | (ทางเลือก) | สำหรับ self-hosted / Postgres local |

```bash
# ติดตั้ง Bun
curl -fsSL https://bun.sh/install | bash

# ติดตั้ง Wrangler (global)
bun add -g wrangler && wrangler login
```

### พื้นความรู้ที่ควรมี
TypeScript · React/Next.js (App Router) · Hono · Drizzle ORM · พื้นฐาน webhook & HMAC · พื้นฐาน Stripe billing

### บัญชี service ภายนอกที่ต้องสมัคร
Anthropic (Claude API) · Supabase หรือ PostgreSQL · Trigger.dev · GitHub App + OAuth App · (ทางเลือก) GitLab/Bitbucket · Stripe · Cloudflare · Vercel · Sentry/Axiom/Slack/Resend

> 🔧 ขั้นตอนสมัครและตั้งค่า service แต่ละตัวแบบละเอียด อยู่ใน [SETUP.md](SETUP.md) — คู่มือนี้เน้นการ "รันและพัฒนา"

---

## 2. โครงสร้างโปรเจค

Monorepo ใช้ **Turborepo + Bun workspaces** (`workspaces: ["apps/*", "packages/*"]`)

```
ai-review-bot/
├── apps/
│   ├── webhook/          → Hono บน Cloudflare Workers (รับ webhook, ตรวจ signature, rate limit)
│   ├── dashboard/        → Next.js 15 App Router (auth, billing, ประวัติ, ตั้งค่า)
│   ├── docs/             → Fumadocs (เว็บเอกสาร)
│   ├── mcp-server/       → MCP server (ให้ IDE เข้าถึง review)  [V2]
│   └── vscode-extension/ → ส่วนขยาย VS Code (review ก่อน push) [V2]
├── packages/
│   ├── ai/               → เชื่อม Claude, prompt, config parser, profile generator
│   ├── github/           → GitHub App API client
│   ├── gitlab/           → GitLab API client
│   ├── bitbucket/        → Bitbucket API client [V2]
│   ├── db/               → Drizzle schema + client + Better Auth config
│   ├── queue/            → Trigger.dev tasks (review jobs)
│   └── ui/               → shared shadcn/ui components
├── Dockerfile.webhook / Dockerfile.dashboard / docker-compose.yml
├── turbo.json            → pipeline config (build/dev/typecheck/lint)
├── .env.example          → ตัวอย่าง env ทั้งหมด
└── package.json          → root scripts + workspaces
```

**Workspace package names:** `@repo/ai`, `@repo/github`, `@repo/gitlab`, `@repo/bitbucket`, `@repo/db`, `@repo/queue`, `@repo/ui`

---

## 3. Quick Start (รัน local ใน 10 นาที)

> เป้าหมาย: ให้ dashboard + webhook + queue รันบนเครื่องได้ และเชื่อม Claude review ทำงานจริง

```bash
# 1) clone และติดตั้ง dependencies ทั้ง monorepo
git clone <repo-url> ai-review-bot
cd ai-review-bot
bun install

# 2) สร้างไฟล์ env จากตัวอย่าง
cp .env.example .env
cp .env.example apps/dashboard/.env.local   # dashboard อ่านจาก .env.local

# 3) เตรียม database (เลือกอย่างใดอย่างหนึ่ง)
#    ก) ใช้ Supabase/Postgres ของจริง → ใส่ DATABASE_URL ใน .env
#    ข) ใช้ Postgres local ด้วย Docker:
docker compose up -d postgres
# แล้วตั้ง DATABASE_URL=postgresql://reviewbot:reviewbot_secret@localhost:5432/reviewbot

# 4) สร้างตารางใน database
bun run db:migrate

# 5) ใส่ค่า env ขั้นต่ำที่จำเป็น (ดูหัวข้อ 4)
#    - DATABASE_URL, BETTER_AUTH_SECRET, GITHUB_CLIENT_ID/SECRET
#    - AI provider อย่างน้อย 1 เจ้า: OPENAI_API_KEY หรือ ANTHROPIC_API_KEY หรือ GEMINI_API_KEY

# 6) รันทุก app พร้อมกัน
bun run dev
```

หลังจากนี้:
- Dashboard → http://localhost:3000 (Next.js dev)
- Webhook (Wrangler dev) → ดูพอร์ตที่ terminal แสดง (ปกติ http://localhost:8787)

> 💡 **ค่า env ขั้นต่ำสำหรับ dev:** ไม่จำเป็นต้องครบทุกตัว — Stripe, Slack, Sentry, Axiom, GitLab, Bitbucket จะ skip เองอย่างนุ่มนวลถ้าไม่ได้ตั้งค่า (โค้ดเช็ค env ก่อนทำงานเสมอ) ตัวที่ "ต้องมี" จริง ๆ คือ `DATABASE_URL` + AI provider อย่างน้อย 1 เจ้า + auth (`BETTER_AUTH_SECRET`, GitHub OAuth)

> 🤖 **รองรับหลาย AI provider พร้อม fallback อัตโนมัติ:** ตั้งค่าได้หลายเจ้า (Anthropic / OpenAI / Gemini) ระบบจะเลือกใช้ตามลำดับใน `AI_PROVIDER_ORDER` และ **ข้ามไปเจ้าถัดไปอัตโนมัติ** เมื่อเจ้าปัจจุบันไม่ได้ตั้งค่า / โควตาเต็ม / rate limit / error ดูรายละเอียดหัวข้อ [4.1](#41-multi-provider-ai--fallback)

---

## 4. Environment Variables ทั้งหมด

มีไฟล์ env 2 จุด:
- **`.env`** (root) → ใช้โดย webhook (local/Docker) และ queue
- **`apps/dashboard/.env.local`** → ใช้โดย Next.js dashboard

### กลุ่ม Webhook / Queue (root `.env`)

| ตัวแปร | จำเป็น | คำอธิบาย |
|---|---|---|
| `DATABASE_URL` | ✅ | connection string ของ PostgreSQL |
| `OPENAI_API_KEY` | ✅† | OpenAI key (`sk-...`) — provider หลัก (default) |
| `ANTHROPIC_API_KEY` | ⬜† | Claude API key (`sk-ant-...`) — fallback |
| `GEMINI_API_KEY` | ⬜† | Google Gemini key — fallback (รองรับ `GOOGLE_GENERATIVE_AI_API_KEY` ด้วย) |
| `AI_PROVIDER_ORDER` | ⬜ | ลำดับ provider (default `openai,anthropic,gemini`) |
| `OPENAI_MODEL` / `ANTHROPIC_MODEL` / `GEMINI_MODEL` | ⬜ | override ชื่อ model แต่ละเจ้า |
| `TRIGGER_SECRET_KEY` | ✅* | Trigger.dev secret (`tr_...`) — จำเป็นถ้าจะให้ job รันบน cloud |
| `GITHUB_APP_ID` | ✅** | App ID (ตัวเลข) |
| `GITHUB_APP_PRIVATE_KEY` | ✅** | PEM key แบบ single-line (`\n`) |
| `GITHUB_WEBHOOK_SECRET` | ✅** | secret สำหรับ verify HMAC |
| `GITLAB_TOKEN` / `GITLAB_WEBHOOK_SECRET` / `GITLAB_API_URL` | ⬜ | สำหรับรองรับ GitLab |
| `BITBUCKET_WEBHOOK_SECRET` / `BITBUCKET_USERNAME` / `BITBUCKET_APP_PASSWORD` | ⬜ | สำหรับรองรับ Bitbucket |
| `SENTRY_DSN` | ⬜ | error tracking |
| `POSTGRES_PASSWORD` / `WEBHOOK_PORT` / `DASHBOARD_PORT` | ⬜ | สำหรับ Docker self-hosted |

<sub>\* ถ้าไม่ตั้ง Trigger.dev job จะ trigger ไม่ได้ &nbsp; \*\* จำเป็นเมื่อต้องการรองรับ GitHub จริง &nbsp; † ต้องมี AI provider **อย่างน้อย 1 เจ้า** (ตั้งหลายเจ้าได้เพื่อ fallback)</sub>

---

### 4.1 Multi-Provider AI + Fallback

ระบบรองรับ AI หลายเจ้า และ **เลือกใช้ + fallback อัตโนมัติ** (โค้ดอยู่ที่ [packages/ai/src/providers.ts](packages/ai/src/providers.ts))

**หลักการทำงาน:**
1. อ่านลำดับจาก `AI_PROVIDER_ORDER` (default `openai,anthropic,gemini`)
2. **เลือกเฉพาะเจ้าที่ตั้ง API key ไว้** — เจ้าที่ไม่ได้ตั้งค่าจะถูกข้ามอัตโนมัติ
3. เรียกเจ้าแรกก่อน ถ้า **ล้มเหลว** จะ fallback ไปเจ้าถัดไปตามกรณี:

| กรณี error | fallback ไปเจ้าถัดไป? | retry job ภายหลัง? (ถ้าเป็นเจ้าสุดท้าย) |
|---|---|---|
| โควตาเต็ม / rate limit (429, "quota", "exceeded") | ✅ | ✅ |
| auth ผิด (401/403, "api key", "unauthorized") | ✅ | ❌ |
| server error (5xx) | ✅ | ✅ |
| schema/request ผิด (400) | ❌ (ผิดเหมือนกันทุกเจ้า) | ❌ |
| network/timeout | ✅ | ✅ |

4. ถ้าทุกเจ้าล้มเหลว → โยน `ReviewError` (retryable ตามสาเหตุสุดท้าย)
5. ผลลัพธ์ที่คืนมามี field `provider` บอกว่าเจ้าไหนเป็นคนตอบ (บันทึกใน review ด้วย)

**ตัวอย่างการตั้งค่า:**
```bash
# ค่าเริ่มต้น: ใช้ OpenAI เป็นหลัก, มี Anthropic + Gemini สำรองเมื่อโควตาเต็ม
AI_PROVIDER_ORDER=openai,anthropic,gemini
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=AI...

# หรือใช้ Gemini เป็นหลัก (ราคาถูกกว่า) แล้ว fallback ไป OpenAI
AI_PROVIDER_ORDER=gemini,openai
GEMINI_API_KEY=AI...
OPENAI_API_KEY=sk-...
```

**ตรวจสอบว่า provider ไหนพร้อมใช้งาน** — เรียก health endpoint:
```bash
curl http://localhost:3000/api/health/ai
# {
#   "ok": true,
#   "order": "openai,anthropic,gemini",
#   "activeProvider": "openai",
#   "providers": [
#     { "name": "openai", "envVar": "OPENAI_API_KEY", "configured": true },
#     { "name": "anthropic", "envVar": "ANTHROPIC_API_KEY", "configured": false },
#     { "name": "gemini", "envVar": "...", "configured": false }
#   ]
# }
```

> ⚠️ อย่าลืมตั้ง key เหล่านี้ใน **Trigger.dev dashboard** ด้วย เพราะ review job รันบน Trigger.dev cloud (ไม่ใช่บน webhook)

### กลุ่ม Dashboard (`apps/dashboard/.env.local`)

| ตัวแปร | จำเป็น | คำอธิบาย |
|---|---|---|
| `DATABASE_URL` | ✅ | ชี้ไป DB เดียวกับ webhook |
| `BETTER_AUTH_SECRET` | ✅ | สุ่มด้วย `openssl rand -hex 32` |
| `NEXT_PUBLIC_APP_URL` | ✅ | URL ของ dashboard (เช่น `http://localhost:3000`) |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | ✅ | OAuth App สำหรับล็อกอิน |
| `GITHUB_APP_SLUG` | ⬜ | slug ของ GitHub App (ใช้ในลิงก์ install) |
| `STRIPE_SECRET_KEY` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | ⬜ | billing (test mode ใช้ `sk_test_`/`pk_test_`) |
| `STRIPE_WEBHOOK_SECRET` | ⬜ | verify Stripe webhook (`whsec_...`) |
| `STRIPE_METER_ID` / `STRIPE_METER_EVENT_NAME` | ⬜ | usage-based metering (event name เช่น `pr_review`) |
| `STRIPE_TEAM_PRICE_ID` / `STRIPE_BUSINESS_PRICE_ID` | ⬜ | price รายเดือน |
| `STRIPE_TEAM_ANNUAL_PRICE_ID` / `STRIPE_BUSINESS_ANNUAL_PRICE_ID` | ⬜ | price รายปี (ลด 20%) |
| `STRIPE_OVERAGE_PRICE_ID` | ⬜ | price overage ($0.05/PR) |
| `SLACK_WEBHOOK_URL` | ⬜ | fallback Slack webhook (org สามารถตั้งเองได้) |
| `RESEND_API_KEY` / `EMAIL_FROM` | ⬜ | weekly email report |
| `SUPPORT_EMAIL` | ⬜ | รับ enterprise lead |
| `AXIOM_TOKEN` / `SENTRY_DSN` | ⬜ | observability |
| `REVIEW_API_KEY` | ⬜ | Bearer token ปกป้อง endpoint `/api/review/diff` (ใช้กับ VS Code ext / MCP) |

> ตัวอย่างค่าทั้งหมดดูได้ที่ [.env.example](.env.example)

---

## 5. การรันแต่ละส่วน (apps/packages)

### รันทั้งหมดพร้อมกัน
```bash
bun run dev          # turbo run dev — รันทุก app ที่มี dev script
```

### รันแยกเฉพาะส่วน

**Dashboard (Next.js):**
```bash
cd apps/dashboard && bun run dev      # → http://localhost:3000
```

**Webhook (Cloudflare Workers local):**
```bash
cd apps/webhook && bunx wrangler dev  # → http://localhost:8787
# health check:
curl http://localhost:8787/health     # {"status":"ok"}
```

**Queue (Trigger.dev tasks) — โหมด dev:**
```bash
cd packages/queue && bunx trigger.dev dev
# จะ connect ไป Trigger.dev cloud และรัน task บนเครื่อง (hot reload)
```

**Docs (Fumadocs):**
```bash
cd apps/docs && bun run dev
```

**MCP Server (V2):**
```bash
cd apps/mcp-server && bun run src/index.ts
```

**VS Code Extension (V2):**
เปิดโฟลเดอร์ `apps/vscode-extension` ใน VS Code แล้วกด `F5` (Run Extension)
ต้องตั้งค่า `reviewbot.apiUrl` + `reviewbot.apiKey` ใน settings ให้ชี้ไป dashboard ที่รัน `/api/review/diff`

---

## 6. Database & Migration

ORM: **Drizzle** (schema อยู่ที่ [packages/db/src/schema.ts](packages/db/src/schema.ts))

```bash
# สร้างไฟล์ migration จากการแก้ schema
bun run db:generate

# รัน migration เข้า DB
bun run db:migrate

# push schema ตรง ๆ (dev เร็ว ๆ ไม่สร้างไฟล์ migration)
bun run db:push

# เปิด Drizzle Studio (GUI ดู/แก้ข้อมูล)
bun run db:studio
```

> หลังแก้ `schema.ts` ทุกครั้ง: รัน `db:generate` แล้ว `db:migrate` (หรือใช้ `db:push` ตอน dev)
> ตารางหลัก: `organizations`, `repositories`, `reviews`, `reviewComments`, `userOrganizations`, `rateLimits`, `stripeWebhookEvents` + ตาราง Better Auth (`user`, `session`, `account`, `verification`)

---

## 7. คำสั่งที่ใช้บ่อย (Command Cheat Sheet)

```bash
# ─── ติดตั้ง / dev ───
bun install                  # ติดตั้ง dependencies ทั้ง monorepo
bun run dev                  # รันทุก app
bun run build                # build ทุก app (turbo)
bun run typecheck            # ตรวจ type ทั้ง monorepo
bun run lint                 # lint ทั้ง monorepo
bun run format               # prettier จัดรูปแบบ

# ─── database ───
bun run db:generate          # สร้าง migration
bun run db:migrate           # รัน migration
bun run db:push              # push schema (dev)
bun run db:studio            # GUI

# ─── deploy ───
cd apps/webhook && bunx wrangler deploy        # deploy webhook
cd packages/queue && bunx trigger.dev deploy   # deploy jobs
cd apps/dashboard && vercel deploy --prod      # deploy dashboard

# ─── cleanup ───
bun run clean                # ลบ build + node_modules
```

> รันคำสั่งเฉพาะ workspace: `bun run --filter @repo/db <script>`

---

## 8. ทดสอบ Flow แบบ End-to-End

### วิธีที่ 1: ทดสอบ AI review โดยตรง (ไม่ต้องตั้ง webhook)
ใช้ endpoint `POST /api/review/diff` (ต้องตั้ง `REVIEW_API_KEY`) ส่ง unified diff เข้าไป:

```bash
curl -X POST http://localhost:3000/api/review/diff \
  -H "Authorization: Bearer $REVIEW_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "diff": "diff --git a/x.ts b/x.ts\n@@ -0,0 +1 @@\n+const x: any = 1\n",
    "profile": "typescript",
    "language": "th"
  }'
# คืน: { score, summary, comments[], tokensUsed }
```
นี่คือวิธีเร็วที่สุดในการยืนยันว่า AI provider (เช่น `OPENAI_API_KEY`) + prompt + schema ทำงาน

### วิธีที่ 2: ทดสอบ GitHub webhook เต็มรูปแบบ
1. ใช้ `wrangler dev` รัน webhook + `trigger.dev dev` รัน queue
2. เปิด tunnel ให้ GitHub ยิง webhook เข้าเครื่องได้ (เช่น `cloudflared tunnel` หรือ ngrok)
3. ตั้ง Webhook URL ของ GitHub App ให้ชี้มา tunnel `.../webhook/github`
4. เปิด/อัปเดต PR ใน repo ที่ติดตั้ง App
5. ตรวจสอบ:
   - terminal webhook: เห็น `status: accepted`
   - Trigger.dev dashboard: task `review-pull-request` รัน
   - บน PR: มี inline comment ปรากฏ
   - DB (`db:studio`): มี record ใน `reviews` + `reviewComments`

### วิธีที่ 3: ทดสอบ Stripe webhook (local)
```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
# ใช้ STRIPE_WEBHOOK_SECRET ที่ stripe listen แสดงให้
```

---

## 9. การ Deploy (Production)

ระบบ deploy แยกเป็น 4 ส่วน:

| ส่วน | ไป deploy ที่ | คำสั่ง |
|---|---|---|
| Webhook | Cloudflare Workers | `cd apps/webhook && bunx wrangler deploy` |
| Queue (jobs) | Trigger.dev Cloud | `cd packages/queue && bunx trigger.dev deploy` |
| Dashboard | Vercel | `cd apps/dashboard && vercel deploy --prod` |
| Database | Supabase (managed) | `bun run db:migrate` |

### ขั้นตอนหลักก่อน deploy
1. **Cloudflare KV:** `wrangler kv namespace create RATE_LIMIT_KV` แล้วใส่ `id` ใน [apps/webhook/wrangler.toml](apps/webhook/wrangler.toml)
2. **Secrets ของ Worker:** ตั้งด้วย `wrangler secret put <KEY>` (ดูรายการใน wrangler.toml: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `GITLAB_*`, AI keys เช่น `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`GEMINI_API_KEY`, `TRIGGER_SECRET_KEY`, `DATABASE_URL`)
3. **Trigger.dev env:** ตั้ง env ทั้งหมดใน Trigger.dev dashboard ด้วย (เพราะ task รันบน cloud)
4. **Vercel env:** ใส่ env กลุ่ม dashboard ใน Project Settings
5. **อัปเดต callback URLs:** GitHub OAuth callback + Stripe webhook endpoint ให้ชี้ domain production

> รายละเอียดทุกขั้นตอน + checklist ก่อน launch อยู่ใน [SETUP.md](SETUP.md) (หัวข้อ 8–13)

---

## 10. Self-Hosted ด้วย Docker

สำหรับลูกค้า Enterprise ที่ต้องการรันในเครื่องตัวเอง (V2) — มี [Dockerfile.webhook](Dockerfile.webhook), [Dockerfile.dashboard](Dockerfile.dashboard), [docker-compose.yml](docker-compose.yml)

```bash
# 1) เตรียม env
cp .env.example .env
#    ตั้งค่าอย่างน้อย: GITHUB_APP_*, OPENAI_API_KEY (หรือ AI provider อื่น), TRIGGER_SECRET_KEY,
#    BETTER_AUTH_SECRET, GITHUB_CLIENT_ID/SECRET, POSTGRES_PASSWORD

# 2) build + run ทั้ง stack (postgres + webhook + dashboard + migrate)
docker compose up -d --build

# service ที่ได้:
#   postgres   → localhost:5432
#   webhook    → localhost:3000  (Bun server จาก apps/webhook/src/server.ts)
#   dashboard  → localhost:3001
#   migrate    → รัน db migrate ครั้งเดียวแล้วจบ
```

จุดสำคัญของโหมด self-hosted:
- webhook ใช้ [apps/webhook/src/server.ts](apps/webhook/src/server.ts) ที่จำลอง Cloudflare KV ด้วย in-memory cache (`createMemoryKV`)
- database เป็น Postgres ใน container (`DATABASE_URL` ชี้ไป service `postgres`)
- service `migrate` รัน `bun run --cwd packages/db migrate` อัตโนมัติเมื่อ DB พร้อม

---

## 11. คู่มือนักพัฒนาต่อยอด (เพิ่มฟีเจอร์)

### เพิ่ม Convention Profile ใหม่ (เช่น React, Django)
แก้ [packages/ai/src/prompts.ts](packages/ai/src/prompts.ts) ในฟังก์ชัน `buildSystemPrompt()` — เพิ่ม block convention ของ framework ใหม่ตาม `config.profile`

### เพิ่ม custom rule ต่อ repo
ผู้ใช้วางไฟล์ `.reviewbot.yml` ใน root ของ repo — parse โดย `parseReviewBotConfig()` ใน [packages/ai/src/config.ts](packages/ai/src/config.ts) โครงสร้าง: `profile`, `language`, `rules[]`, `ignore[]`, `limits`

### เพิ่มแพลตฟอร์มใหม่ (เช่น Gitea)
ทำตามรูปแบบเดิม 4 จุด:
1. สร้าง `packages/<platform>/` (client + types) เลียนแบบ `packages/gitlab`
2. เพิ่ม handler ใน `apps/webhook/src/handlers/` + middleware ตรวจ signature
3. เพิ่ม route ใน [apps/webhook/src/index.ts](apps/webhook/src/index.ts)
4. เพิ่ม task ใน `packages/queue/src/tasks/` + export ใน [packages/queue/src/index.ts](packages/queue/src/index.ts)
5. ขยาย `provider` enum + เพิ่มคอลัมน์ id ใน [packages/db/src/schema.ts](packages/db/src/schema.ts)

### ปรับ logic การ review (กรองไฟล์/limit)
อยู่ในแต่ละ task เช่น [packages/queue/src/tasks/review-pr.ts](packages/queue/src/tasks/review-pr.ts) — ส่วนกรองไฟล์ (skip ไฟล์ลบ, เกิน max lines, ตรง ignore pattern) และ `max_files_per_pr`

### แก้ schema ของผลลัพธ์ Claude
แก้ `ReviewSchema` (Zod) ใน [packages/ai/src/index.ts](packages/ai/src/index.ts) — มีผลทั้ง structured output, DB และ UI

---

## 12. Troubleshooting

| อาการ | สาเหตุที่พบบ่อย | วิธีแก้ |
|---|---|---|
| `bun install` ล้มเหลว | Bun เวอร์ชันต่ำกว่า 1.3.0 | `bun upgrade` |
| webhook คืน 401 | signature ไม่ตรง — `GITHUB_WEBHOOK_SECRET` ไม่ตรงกับที่ตั้งใน GitHub App | ตั้ง secret ให้ตรงทั้งสองฝั่ง |
| webhook คืน 429 | ติด rate limit (free plan 50/เดือน) | upgrade plan หรือเช็คตาราง `rateLimits` |
| AI review ไม่ทำงาน | ไม่ได้ตั้ง AI key เลย / key ผิด / โควตาเต็มทุกเจ้า | เช็ค `GET /api/health/ai` ว่ามี provider พร้อมใช้งาน (default หลักคือ `OPENAI_API_KEY`) |
| job ไม่รัน | `TRIGGER_SECRET_KEY` ไม่ตั้ง หรือ `trigger.dev dev`/deploy ไม่ได้รัน | ตั้ง key + รัน task runner |
| inline comment ไม่ปรากฏ แต่ job สำเร็จ | line number map ไม่ตรง diff | ดู `getModifiedLines()` ใน [packages/ai/src/patch.ts](packages/ai/src/patch.ts) |
| ล็อกอินไม่ได้ | OAuth callback URL ไม่ตรง / `BETTER_AUTH_SECRET` ไม่ตั้ง | ตั้ง callback `.../api/auth/callback/github` |
| Stripe webhook ไม่เข้า | signature ไม่ตรง | ใช้ secret จาก `stripe listen` (local) |
| migration error | `DATABASE_URL` ผิด / DB ไม่ขึ้น | เช็ค connection / `docker compose up -d postgres` |
| typecheck fail หลังแก้ schema | type ไม่ตรงหลังแก้ schema | `bun run db:generate` แล้ว `bun run typecheck` |

### เคล็ดลับ debug
- ดู log job แบบ realtime ได้ที่ Trigger.dev dashboard
- ใช้ `bun run db:studio` ดูข้อมูลใน DB
- error ที่ production ดูที่ Sentry (ถ้าตั้ง `SENTRY_DSN`)
- โค้ดส่วนใหญ่เช็ค env ก่อนทำงาน — ถ้าฟีเจอร์หนึ่ง "เงียบ" ไม่ทำงาน ให้เช็คว่าตั้ง env ครบหรือยัง

---

*คู่มือนี้สร้างจากการอ่าน config และโค้ดจริงของโปรเจค หากแก้โครงสร้างหรือ env ควรอัปเดตเอกสารนี้ให้ตรงกัน*
