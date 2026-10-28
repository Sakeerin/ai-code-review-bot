# คู่มือนักพัฒนา (Developer Guide) — AI Code Review Bot

ภาษา: **ไทย** | [English](DEVELOPER-GUIDE.md)

คู่มือสองฉบับครอบคลุมหัวข้อเดียวกัน เมื่อแก้คำสั่ง ตัวแปร หรือขั้นตอน ให้ปรับทั้งสองภาษาควบคู่กัน
โปรเจคใช้ [MIT License](LICENSE) และเปิดให้ self-host ได้ โดยผู้ใช้งานเตรียม infrastructure และบัญชีบริการภายนอกเอง

## การอัปเดตด้านสิทธิ์และความทนทานของงานรีวิว

Migration `0008` เพิ่ม outbox สำหรับส่งงานเข้า queue และจำกัดแผน Free ให้เปิดใช้
repository ได้หนึ่งรายการ รวมถึง installation เดิม หลัง migrate ให้ deploy schedule
`retry-review-dispatch` พร้อม worker งานที่ส่งไม่สำเร็จจะเก็บการจองโควตาไว้และส่งซ้ำ
ด้วย idempotency key เดิม ระบบตรวจสิทธิ์ผู้ดูแล GitHub ซ้ำเมื่อเข้าใช้องค์กร และเลือก
installation ที่ต้องการได้จากช่อง Organization บน dashboard

ใช้ Bun **1.4.4** ขึ้นไปสำหรับ lockfile ชุดใหม่ โดย CI และ Docker ใช้ 1.4.4
ตรวจ dependency ด้วย `bun run audit:security` ซึ่งจะไม่ผ่านเมื่อพบระดับ high/critical

สำหรับ Bitbucket ให้ตั้ง `BITBUCKET_API_TOKEN` บน worker โดยใช้ scoped API token
ที่มีสิทธิ์อ่าน repository และอ่าน/เขียน pull request งานใหม่จะไม่แนบ API credentials
ลงใน payload และไม่ใช้ App Password ที่เลิกให้บริการแล้ว

แพ็กเกจที่ชำระเงินแล้วเปลี่ยนแผนหรือรอบบิลได้ผ่านการดูยอดปรับและยืนยัน ใบเสนอราคา
หมดอายุในสิบนาที ระบบรอ Stripe ยืนยันการชำระเงินก่อนให้สิทธิ์ใหม่ผ่าน webhook
meter รายเดือนเดิมจะคงอยู่เพื่อรับ usage ของ Team ที่ส่งล่าช้า ส่วนรีวิวของ Business
จะไม่ส่ง meter event ใหม่ ลูกค้าที่ถูกลดเป็น Free ยังเข้า Portal เพื่อแก้การชำระเงินได้

ก่อนเริ่ม dashboard, webhook และ queue เวอร์ชันนี้ ให้รัน `bun install` และ
`bun run db:migrate` กับฐานข้อมูลที่ต้องการใช้งาน Migration `0006` เพิ่มตัวระบุองค์กร
ของ GitLab/Bitbucket และตารางเก็บผล AI สำหรับทำงานต่อเมื่อ task ต้อง retry
ให้หยุด worker เวอร์ชันเก่าก่อนสลับ deployment เพื่อไม่ให้รับงานเดียวกันด้วยโค้ดคนละเวอร์ชัน

- Dashboard ต้องมี `GITHUB_APP_ID` และ `GITHUB_APP_PRIVATE_KEY` เพื่อตรวจ installation
  ผู้เชื่อม installation ต้องเป็นเจ้าของบัญชีส่วนตัวหรือแอดมินองค์กรที่ยังมีสถานะ active
  สำหรับบัญชีเดิม ให้ลงชื่อเข้าใช้และอนุญาต GitHub อีกครั้งหาก token ยังไม่มี scope `read:org`
- ตั้ง `BITBUCKET_WEBHOOK_SECRET` เมื่อใช้ Bitbucket หากไม่ตั้ง endpoint จะตอบ `503`
  และไม่รับงานที่ไม่มีการตรวจลายเซ็น
- งานรีวิวใช้ concurrency key ต่อ PR และ idempotency key ต่อ commit พร้อมตรวจ marker
  บนคอมเมนต์ที่โพสต์แล้วก่อน retry และเก็บผล AI ในฐานข้อมูลก่อนโพสต์
- Migration เติม namespace ให้เฉพาะองค์กรเดิมที่มี provider และ namespace เดียวอย่างชัดเจน
  ข้อมูลเก่าที่ปะปนข้าม provider ต้องตรวจสอบสิทธิ์และข้อมูลย้อนหลังแยกต่างหาก

รัน `bun run test` เพื่อตรวจ regression tests ซึ่งใช้ PostgreSQL ในหน่วยความจำ (PGlite)
โดยไม่เชื่อมฐานข้อมูลจริงหรือเรียกบริการภายนอก และรัน `bun run typecheck` เพื่อตรวจ TypeScript

รัน `bun run test:postgres` เพื่อตรวจไดรเวอร์ PostgreSQL จริง การล็อกเมื่อมีงานพร้อมกัน
lease ของ dispatch และการนับ usage รายเดือน โดยตั้ง `POSTGRES_TEST_URL` ให้ชี้ไปยัง
PostgreSQL สำหรับทดสอบด้วย role ที่มีสิทธิ์ `CREATEDB` ชุดทดสอบจะสร้างและลบฐานข้อมูล
ของตัวเอง และไม่ใช้ `DATABASE_URL` แทนหากไม่ได้ตั้งค่า CI รันชุดนี้บน PostgreSQL 16
โดยปิดการส่งข้อมูลไป Stripe และ Slack

### การอัปเดต billing, quota และ notification

- Migration `0007` เพิ่มสถานะ subscription, reservation ต่อ PR/commit และ `notification_outbox`
  รวมทั้งปรับ counter เก่าให้ตรงกับรีวิวที่สำเร็จ ให้รอ task เก่าจบและหยุด worker ก่อน migrate
- โควตารายเดือนนับ UTC calendar month รวมงานที่จองไว้ในคิว งานที่ข้ามหรือหมด retry จะคืนโควตา
  webhook ซ้ำของ commit เดิมใช้ reservation เดิม Dashboard แสดง quota รวมงานที่รออยู่
  เมื่อ task จบหรือหมด retry แล้ว webhook ซ้ำจะไม่สร้างงานหรือจองโควตาเพิ่ม ให้ push commit ใหม่เพื่อเริ่มรีวิวรอบใหม่
- Team รวม 500 รีวิวสำเร็จต่อเดือน ส่ง meter เฉพาะรีวิวที่เกิน 500 รายการ ราคา $0.05 ต่อรายการ
  Business ไม่ส่ง meter Checkout ของ Team ต้องมี `STRIPE_OVERAGE_PRICE_ID` เป็น USD 5 cents,
  monthly, metered และผูก meter ที่ตรงกับ `STRIPE_METER_EVENT_NAME`
  Team รายปีใช้ flexible billing เพื่อรวม base รายปีกับ overage รายเดือน
  Subscription เดิมที่สร้างก่อนเพิ่ม metered item ต้องปรับผ่าน Stripe ก่อนคิด overage จริง
- สถานะ active/trialing/past_due คงสิทธิ์ paid ระหว่างช่วง retry ชำระเงิน ส่วน unpaid/paused/canceled/
  incomplete/incomplete_expired จะใช้ free โดย webhook อ่านสถานะล่าสุดจาก Stripe เพื่อป้องกัน event ย้อนลำดับ
- Deploy task `retry-notifications` บน Trigger.dev ด้วย ระบบจะส่ง Stripe/Slack ที่ค้างทุก 5 นาที
  retry สูงสุด 10 ครั้ง ดูรายการ `status = 'failed'` ใน `notification_outbox` เพื่อแก้ config แล้ว
  reset `status = 'pending'`, `attempts = 0`, `next_attempt_at = now()`, `locked_until = NULL` สำหรับส่งใหม่
  Stripe ใช้ identifier เดิม ส่วน Slack เป็น at-least-once และอาจซ้ำได้หาก response หายหลังรับข้อความ
- Slack URL รับเฉพาะ HTTPS บน `hooks.slack.com` หรือ `hooks.slack-gov.com` เส้นทาง `/services/...`
  และไม่ตาม redirect ส่วน config ignore รองรับ glob เช่น `**/*.test.ts` และ `dist/**`
- รัน `bun run lint`, `bun run typecheck`, `bun test tests` และ dashboard build ก่อน merge
  CI จะตรวจรายการเหล่านี้และ build Docker ทั้งสอง image
- ตรวจ invoice กับ Stripe sandbox ด้วย `bun run billing:verify` โดยตั้ง test key และ price IDs
  ทั้ง monthly/annual ของ Team/Business รวม overage ก่อน คำสั่งปฏิเสธ live key สร้างลูกค้าทดสอบ
  แบบไม่มี payment method/email ตรวจ invoice preview และลบลูกค้าหลังจบ (ไม่มีการเรียกเก็บเงินจริง)
  คำสั่งนี้ยังต้องเรียก Stripe จริง จึงไม่รวมใน offline regression tests
- Docker จะรัน migration ก่อนเปิด dashboard/webhook แต่ queue ยังคงใช้ Trigger.dev แยกต่างหาก
  ต้อง deploy tasks และตั้ง `DATABASE_URL` ที่ worker บน Trigger.dev เข้าถึงได้ด้วย

> คู่มือสำหรับนักพัฒนาที่ต้องการนำโปรเจคนี้ไปรัน พัฒนาต่อ หรือ deploy เอง
> ครอบคลุมตั้งแต่การเตรียมเครื่อง การตั้งค่า การรัน local การทดสอบ flow ไปจนถึง deploy และแก้ปัญหา
>
> 📎 เอกสารที่เกี่ยวข้อง: [README.md](README.md) · [SETUP.md](SETUP.md) (ตั้งค่า service ภายนอกอย่างละเอียด) · [คู่มือ self-host](docs/SELF_HOSTING.md) · [คู่มือรัน local](RUN-LOCAL.md)

---

## สารบัญ

1. [ก่อนเริ่ม: ความรู้และเครื่องมือที่ต้องมี](#1-ก่อนเริ่ม-ความรู้และเครื่องมือที่ต้องมี)
2. [โครงสร้างโปรเจค](#2-โครงสร้างโปรเจค)
3. [Quick Start (รัน local)](#3-quick-start-รัน-local)
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

| เครื่องมือ              | เวอร์ชัน                  | ใช้ทำอะไร                                                         |
| ----------------------- | ------------------------- | ----------------------------------------------------------------- |
| [Bun](https://bun.sh)   | 1.4.4 สำหรับตรวจเหมือน CI | runtime + package manager หลัก (กำหนดใน `packageManager`)         |
| Node.js                 | ≥ 22.0.0                  | บาง tool ต้องใช้ (กำหนดใน `engines`)                              |
| Wrangler CLI            | เวอร์ชันใน lockfile       | ใช้ผ่าน script ของ `apps/webhook` เมื่อต้องการ Cloudflare Workers |
| Git                     | —                         | version control                                                   |
| Docker + Docker Compose | (ทางเลือก)                | สำหรับ self-hosted / Postgres local                               |

```bash
# ติดตั้ง Bun
curl -fsSL https://bun.sh/install | bash

# หลังติดตั้ง dependency ให้ใช้ Wrangler ของ workspace
cd apps/webhook
bunx wrangler login
```

### พื้นความรู้ที่ควรมี

TypeScript · React/Next.js (App Router) · Hono · Drizzle ORM · พื้นฐาน webhook & HMAC · พื้นฐาน Stripe billing

### บัญชี service ภายนอกที่ต้องสมัคร

สำหรับ dashboard ใช้ PostgreSQL และ GitHub OAuth ส่วนรีวิวจริงต้องมี AI provider อย่างน้อยหนึ่งเจ้า
รีวิว PR/MR อัตโนมัติต้องมี Trigger.dev และ credentials ของ Git provider ที่ใช้
Stripe, Slack, Resend, Sentry และ Axiom ใช้เฉพาะเมื่อต้องการ integration นั้น
Cloudflare/Vercel เป็นตัวเลือกสำหรับ deploy ไม่ได้จำเป็นกับการรันผ่าน Docker

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
│   ├── ai/               → AI หลาย provider, prompt, config parser, profile generator
│   ├── github/           → GitHub App API client
│   ├── gitlab/           → GitLab API client
│   ├── bitbucket/        → Bitbucket API client [V2]
│   ├── db/               → Drizzle schema + client + Better Auth config
│   └── queue/            → Trigger.dev tasks (review jobs)
├── Dockerfile.webhook / Dockerfile.dashboard / docker-compose.yml
├── turbo.json            → pipeline config (build/dev/typecheck/lint)
├── .env.example          → ตัวอย่าง env ทั้งหมด
└── package.json          → root scripts + workspaces
```

**Workspace package names:** `@repo/ai`, `@repo/github`, `@repo/gitlab`, `@repo/bitbucket`, `@repo/db`, `@repo/queue`

---

## 3. Quick Start (รัน local)

> เป้าหมาย: รัน dashboard และทดสอบ AI review โดยตรงก่อน แล้วค่อยต่อ webhook/queue ในหัวข้อ 5

```bash
# 1) clone และติดตั้ง dependencies ทั้ง monorepo
git clone https://github.com/Sakeerin/ai-code-review-bot.git
cd ai-code-review-bot
bun install --frozen-lockfile

# 2) สร้างไฟล์ env จากตัวอย่าง
cp .env.example .env
cp .env.example apps/dashboard/.env.local   # dashboard อ่านจาก .env.local

# 3) กรอก env ทั้งสองไฟล์ก่อนรัน migration (ดูหัวข้อ 4)
#    - DATABASE_URL, BETTER_AUTH_SECRET, NEXT_PUBLIC_APP_URL, GITHUB_CLIENT_ID/SECRET
#    - AI provider อย่างน้อยหนึ่งเจ้า สำหรับรีวิวจริง
#    - REVIEW_API_KEY สำหรับ endpoint review โดยตรง

# 4) ใช้ PostgreSQL ที่มีอยู่ หรือเริ่มเฉพาะ database ด้วย Docker
docker compose up -d postgres
# ตั้ง POSTGRES_PASSWORD ของตัวเองและให้ DATABASE_URL ทั้งสองไฟล์ชี้ฐานข้อมูลนี้

# 5) สร้างตารางใน database
bun run db:migrate

# 6) เริ่ม dashboard
bun run --cwd apps/dashboard dev
```

หลังจากนี้:

- Dashboard → http://localhost:3000 (Next.js dev)
- Webhook และ queue → เริ่มแยกตามหัวข้อ 5 เมื่อกำหนด provider credentials และ Trigger.dev แล้ว

> การทดสอบโดยไม่ใช้บัญชีภายนอกให้รัน `bun test tests` ซึ่งใช้ฐานข้อมูลในหน่วยความจำและจำลอง service ภายนอก
> ฟีเจอร์ที่ยังไม่ได้ตั้งค่าใช้งานไม่ได้ เช่น webhook ที่ขาด signing secret จะปฏิเสธคำขอ และ checkout ที่ขาด Stripe config จะไม่พร้อมใช้งาน

> 🤖 **รองรับหลาย AI provider พร้อม fallback อัตโนมัติ:** ตั้งค่าได้หลายเจ้า (Anthropic / OpenAI / Gemini) ระบบจะเลือกใช้ตามลำดับใน `AI_PROVIDER_ORDER` และ **ข้ามไปเจ้าถัดไปอัตโนมัติ** เมื่อเจ้าปัจจุบันไม่ได้ตั้งค่า / โควตาเต็ม / rate limit / error ดูรายละเอียดหัวข้อ [4.1](#41-multi-provider-ai--fallback)

---

## 4. Environment Variables ทั้งหมด

ไฟล์สำหรับตั้งค่า environment:

- **`.env`** (root) → ใช้โดย Bun webhook, migration, Docker Compose และ script ของ queue
- **`apps/dashboard/.env.local`** → ใช้โดย Next.js dashboard
- **`apps/webhook/.dev.vars`** → bindings สำหรับ Wrangler local; คัดลอกจาก root `.env` แล้วตรวจค่าที่ต้องใช้
- Worker และ task ที่ deploy แล้วต้องตั้ง secrets ใน environment ของบริการนั้นแยกต่างหาก

### กลุ่ม Webhook / Queue (root `.env`)

| ตัวแปร                                                      | จำเป็น | คำอธิบาย                                                                  |
| ----------------------------------------------------------- | ------ | ------------------------------------------------------------------------- |
| `DATABASE_URL`                                              | ✅     | connection string ของ PostgreSQL                                          |
| `OPENAI_API_KEY`                                            | ✅†    | OpenAI key (`sk-...`) — provider หลัก (default)                           |
| `ANTHROPIC_API_KEY`                                         | ⬜†    | Claude API key (`sk-ant-...`) — fallback                                  |
| `GEMINI_API_KEY`                                            | ⬜†    | Google Gemini key — fallback (รองรับ `GOOGLE_GENERATIVE_AI_API_KEY` ด้วย) |
| `AI_PROVIDER_ORDER`                                         | ⬜     | ลำดับ provider (default `openai,anthropic,gemini`)                        |
| `OPENAI_MODEL` / `ANTHROPIC_MODEL` / `GEMINI_MODEL`         | ⬜     | override ชื่อ model แต่ละเจ้า                                             |
| `TRIGGER_SECRET_KEY`                                        | ✅\*   | Trigger.dev secret (`tr_...`) — จำเป็นถ้าจะให้ job รันบน cloud            |
| `TRIGGER_PROJECT_ID`                                        | ✅\*   | project reference ของตัวเอง สำหรับ script dev/deploy ของ queue            |
| `GITHUB_APP_ID`                                             | ✅\*\* | App ID (ตัวเลข)                                                           |
| `GITHUB_APP_PRIVATE_KEY`                                    | ✅\*\* | PEM key แบบ single-line (`\n`)                                            |
| `GITHUB_WEBHOOK_SECRET`                                     | ✅\*\* | secret สำหรับ verify HMAC                                                 |
| `GITLAB_TOKEN` / `GITLAB_WEBHOOK_SECRET` / `GITLAB_API_URL` | ⬜     | สำหรับรองรับ GitLab                                                       |
| `BITBUCKET_WEBHOOK_SECRET` / `BITBUCKET_API_TOKEN`          | ⬜     | Signing secret บน webhook และ API token บน worker สำหรับ Bitbucket        |
| `SENTRY_DSN`                                                | ⬜     | error tracking                                                            |
| `POSTGRES_PASSWORD` / `WEBHOOK_PORT` / `DASHBOARD_PORT`     | ⬜     | สำหรับ Docker self-hosted                                                 |

<sub>\* ถ้าไม่ตั้ง Trigger.dev job จะ trigger ไม่ได้ &nbsp; \*\* จำเป็นเมื่อต้องการรองรับ GitHub จริง &nbsp; † ต้องมี AI provider **อย่างน้อย 1 เจ้า** (ตั้งหลายเจ้าได้เพื่อ fallback)</sub>

---

### 4.1 Multi-Provider AI + Fallback

ระบบรองรับ AI หลายเจ้า และ **เลือกใช้ + fallback อัตโนมัติ** (โค้ดอยู่ที่ [packages/ai/src/providers.ts](packages/ai/src/providers.ts))

**หลักการทำงาน:**

1. อ่านลำดับจาก `AI_PROVIDER_ORDER` (default `openai,anthropic,gemini`)
2. **เลือกเฉพาะเจ้าที่ตั้ง API key ไว้** — เจ้าที่ไม่ได้ตั้งค่าจะถูกข้ามอัตโนมัติ
3. เรียกเจ้าแรกก่อน ถ้า **ล้มเหลว** จะ fallback ไปเจ้าถัดไปตามกรณี:

| กรณี error                                        | fallback ไปเจ้าถัดไป?    | retry job ภายหลัง? (ถ้าเป็นเจ้าสุดท้าย) |
| ------------------------------------------------- | ------------------------ | --------------------------------------- |
| โควตาเต็ม / rate limit (429, "quota", "exceeded") | ✅                       | ✅                                      |
| auth ผิด (401/403, "api key", "unauthorized")     | ✅                       | ❌                                      |
| server error (5xx)                                | ✅                       | ✅                                      |
| schema/request ผิด (400)                          | ❌ (ผิดเหมือนกันทุกเจ้า) | ❌                                      |
| network/timeout                                   | ✅                       | ✅                                      |

4. ถ้าทุกเจ้าล้มเหลว → โยน `ReviewError` (retryable ตามสาเหตุสุดท้าย)
5. helper สำหรับ fallback ส่งคืน field `provider` บอกว่า AI เจ้าไหนตอบ ส่วน field `provider` ในตาราง `reviews` หมายถึง Git provider

**ตัวอย่างการตั้งค่า:**

```bash
# ค่าเริ่มต้น: ใช้ OpenAI เป็นหลัก, มี Anthropic + Gemini สำรองเมื่อโควตาเต็ม
AI_PROVIDER_ORDER=openai,anthropic,gemini
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=AI...

# หรือเลือกใช้ Gemini เป็นหลัก แล้ว fallback ไป OpenAI
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

| ตัวแปร                                                            | จำเป็น                       | คำอธิบาย                                                                                        |
| ----------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                    | ✅                           | ชี้ไป DB เดียวกับ webhook                                                                       |
| `BETTER_AUTH_SECRET`                                              | ✅                           | สุ่มด้วย `openssl rand -hex 32`                                                                 |
| `NEXT_PUBLIC_APP_URL`                                             | ✅                           | URL ของ dashboard (เช่น `http://localhost:3000`)                                                |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`                       | ✅                           | OAuth App สำหรับล็อกอิน                                                                         |
| `GITHUB_APP_SLUG`                                                 | ⬜                           | slug ของ GitHub App (ใช้ในลิงก์ install)                                                        |
| `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY`                        | ✅ สำหรับเชื่อม installation | dashboard ใช้ตรวจสิทธิ์กับ GitHub App                                                           |
| `WEBHOOK_BASE_URL`                                                | ⬜                           | public URL ของ webhook receiver ที่แสดงในหน้าตั้งค่า                                            |
| `STRIPE_SECRET_KEY` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`        | ⬜                           | billing (test mode ใช้ `sk_test_`/`pk_test_`)                                                   |
| `STRIPE_WEBHOOK_SECRET`                                           | ⬜                           | verify Stripe webhook (`whsec_...`)                                                             |
| `STRIPE_METER_ID` / `STRIPE_METER_EVENT_NAME`                     | ⬜                           | usage-based metering (event name เช่น `pr_review`)                                              |
| `STRIPE_TEAM_PRICE_ID` / `STRIPE_BUSINESS_PRICE_ID`               | ⬜                           | price รายเดือน                                                                                  |
| `STRIPE_TEAM_ANNUAL_PRICE_ID` / `STRIPE_BUSINESS_ANNUAL_PRICE_ID` | ⬜                           | price รายปี                                                                                     |
| `STRIPE_OVERAGE_PRICE_ID`                                         | ⬜                           | price overage ($0.05/PR)                                                                        |
| `SLACK_WEBHOOK_URL`                                               | ⬜                           | ตั้งใน worker environment สำหรับ fallback Slack webhook (org ตั้งเองได้)                        |
| `RESEND_API_KEY` / `EMAIL_FROM`                                   | ⬜                           | ตั้งใน worker environment สำหรับ weekly email report                                            |
| `SUPPORT_EMAIL`                                                   | ⬜                           | ตัวแปรเตรียมไว้สำหรับ enterprise lead; endpoint ปัจจุบันบันทึก log แต่ยังไม่ส่ง email           |
| `AXIOM_TOKEN` / `SENTRY_DSN`                                      | ⬜                           | observability                                                                                   |
| `REVIEW_API_KEY`                                                  | ⬜                           | shared Bearer token ของ `/api/review/diff` ใช้กับ VS Code extension; MCP ใช้ credentials โดยตรง |

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
cp .env apps/webhook/.dev.vars
bun run --cwd apps/webhook dev       # → http://localhost:8787
# health check:
curl http://localhost:8787/health     # {"status":"ok"}
```

**Queue (Trigger.dev tasks) — โหมด dev:**

```bash
bun run --cwd packages/queue dev
# จะ connect ไป Trigger.dev cloud และรัน task บนเครื่อง (hot reload)
```

**Docs (Fumadocs):**

```bash
cd apps/docs && bun run dev
```

**MCP Server (V2):**

```bash
bun run --cwd apps/mcp-server dev
```

**VS Code Extension (V2):**
เปิดโฟลเดอร์ `apps/vscode-extension` ใน VS Code แล้วกด `F5` (Run Extension)
ต้อง compile ด้วย `bun run --cwd apps/vscode-extension compile` และตั้งค่า `reviewbot.apiUrl` + `reviewbot.apiKey`
ให้ชี้ไป dashboard ที่รัน `/api/review/diff` ค่าเริ่มต้นของ URL คือ `http://localhost:3000`

**Webhook แบบ Bun:** รัน `bun run apps/webhook/src/server.ts` จาก root โดยกำหนด `PORT` ใน environment ของ process
เป็นพอร์ตที่ไม่ชน dashboard เช่น `3002` ส่วน docs ใช้พอร์ต `3001` ตาม script ปัจจุบัน

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
> ตารางหลัก: `organizations`, `repositories`, `reviews`, `review_comments`, `user_organizations`, `rate_limits`,
> `stripe_webhook_events`, `review_runs`, `review_reservations`, `notification_outbox` + ตาราง Better Auth (`user`, `session`, `account`, `verification`)
> เก็บไฟล์ migration และ snapshot ไว้ใน Git และไม่แก้ migration ที่เผยแพร่แล้ว ใช้ `db:push` เฉพาะฐานข้อมูล dev ที่ทิ้งได้

---

## 7. คำสั่งที่ใช้บ่อย (Command Cheat Sheet)

```bash
# ─── ติดตั้ง / dev ───
bun install                  # ติดตั้ง dependencies ทั้ง monorepo
bun run dev                  # รันทุก app
bun run build                # build ทุก app (turbo)
bun run typecheck            # ตรวจ type ทั้ง monorepo
bun run lint                 # lint ทั้ง monorepo
bun test tests               # regression tests แบบไม่เรียก service จริง
bun run billing:verify       # ตรวจ invoice กับ Stripe sandbox (ต้องมี test credentials)
bun run format               # prettier จัดรูปแบบ

# ─── database ───
bun run db:generate          # สร้าง migration
bun run db:migrate           # รัน migration
bun run db:push              # push schema (dev)
bun run db:studio            # GUI

# ─── deploy ───
cd apps/webhook && bunx wrangler deploy        # deploy webhook
bun run --cwd packages/queue deploy            # deploy jobs
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

1. รัน webhook ตามหัวข้อ 5 และใช้ `bun run --cwd packages/queue dev` รัน queue
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

| ส่วน         | ไป deploy ที่      | คำสั่ง                                      |
| ------------ | ------------------ | ------------------------------------------- |
| Webhook      | Cloudflare Workers | `cd apps/webhook && bunx wrangler deploy`   |
| Queue (jobs) | Trigger.dev Cloud  | `bun run --cwd packages/queue deploy`       |
| Dashboard    | Vercel             | `cd apps/dashboard && vercel deploy --prod` |
| Database     | Supabase (managed) | `bun run db:migrate`                        |

### ขั้นตอนหลักก่อน deploy

1. **Cloudflare KV:** `wrangler kv namespace create RATE_LIMIT_KV` แล้วใส่ `id` ใน [apps/webhook/wrangler.toml](apps/webhook/wrangler.toml)
2. **Secrets ของ Worker:** ตั้งด้วย `wrangler secret put <KEY>` (ดูรายการใน wrangler.toml: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `GITLAB_*`, AI keys เช่น `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`GEMINI_API_KEY`, `TRIGGER_SECRET_KEY`, `DATABASE_URL`)
3. **Trigger.dev env:** ตั้ง `TRIGGER_PROJECT_ID` ก่อน deploy และตั้ง credentials ที่ task ต้องใช้ใน Trigger.dev dashboard ด้วย ฐานข้อมูลต้องเข้าถึงได้จาก worker
4. **Vercel env:** ใส่ env กลุ่ม dashboard ใน Project Settings
5. **อัปเดต callback URLs:** GitHub OAuth callback + Stripe webhook endpoint ให้ชี้ domain production

> รายละเอียดทุกขั้นตอน + checklist ก่อน launch อยู่ใน [SETUP.md](SETUP.md) (หัวข้อ 8–13)

---

## 10. Self-Hosted ด้วย Docker

ทุกคนสามารถ self-host ภายใต้ [MIT License](LICENSE) ได้ โดยใช้ [Dockerfile.webhook](Dockerfile.webhook), [Dockerfile.dashboard](Dockerfile.dashboard), [docker-compose.yml](docker-compose.yml)

```bash
# 1) เตรียม env
cp .env.example .env
#    ตั้งค่าอย่างน้อย: GITHUB_APP_*, OPENAI_API_KEY (หรือ AI provider อื่น), TRIGGER_SECRET_KEY,
#    BETTER_AUTH_SECRET, GITHUB_CLIENT_ID/SECRET, POSTGRES_PASSWORD
#    กำหนด NEXT_PUBLIC_APP_URL=http://localhost:3001 สำหรับ Docker local

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
- service `migrate` เรียก `drizzle-kit migrate` ใน `packages/db` เมื่อ DB พร้อม ก่อนเปิด dashboard/webhook
- queue ใช้ Trigger.dev แยกต่างหาก ต้อง deploy tasks และตั้ง DB URL ที่ worker เข้าถึงได้
- Docker ไม่ได้รวม Trigger.dev server หรือ AI model; source code ที่เลือกรีวิวจะถูกส่งให้ AI provider ที่ตั้งไว้
- ค่าเริ่มต้นของ plan และโควตายังทำงานตามโค้ด การใช้ MIT ไม่ได้ปิด quota อัตโนมัติ

---

## 11. คู่มือนักพัฒนาต่อยอด (เพิ่มฟีเจอร์)

### เพิ่ม Convention Profile ใหม่ (เช่น React, Django)

แก้ [packages/ai/src/prompts.ts](packages/ai/src/prompts.ts) ในฟังก์ชัน `buildSystemPrompt()` — เพิ่ม block convention ของ framework ใหม่ตาม `config.profile`

### เพิ่ม custom rule ต่อ repo

ผู้ใช้วางไฟล์ `.reviewbot.yml` ใน root ของ repo — parse โดย `parseReviewBotConfig()` ใน [packages/ai/src/config.ts](packages/ai/src/config.ts) โครงสร้าง: `profile`, `language`, `rules[]`, `ignore[]`, `limits`

### เพิ่มแพลตฟอร์มใหม่ (เช่น Gitea)

ทำตามรูปแบบเดิม 5 จุด:

1. สร้าง `packages/<platform>/` (client + types) เลียนแบบ `packages/gitlab`
2. เพิ่ม handler ใน `apps/webhook/src/handlers/` + middleware ตรวจ signature
3. เพิ่ม route ใน [apps/webhook/src/index.ts](apps/webhook/src/index.ts)
4. เพิ่ม task ใน `packages/queue/src/tasks/` + export ใน [packages/queue/src/index.ts](packages/queue/src/index.ts)
5. ขยาย `provider` enum + เพิ่มคอลัมน์ id ใน [packages/db/src/schema.ts](packages/db/src/schema.ts)

### ปรับ logic การ review (กรองไฟล์/limit)

อยู่ในแต่ละ task เช่น [packages/queue/src/tasks/review-pr.ts](packages/queue/src/tasks/review-pr.ts) — ส่วนกรองไฟล์ (skip ไฟล์ลบ, เกิน max lines, ตรง ignore pattern) และ `max_files_per_pr`

### แก้ schema ของผลลัพธ์ AI

แก้ `ReviewSchema` (Zod) ใน [packages/ai/src/index.ts](packages/ai/src/index.ts) — มีผลทั้ง structured output, DB และ UI

---

## 12. Troubleshooting

| อาการ                                  | สาเหตุที่พบบ่อย                                                                     | วิธีแก้                                                                                 |
| -------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `bun install` ล้มเหลว                  | Bun เวอร์ชันต่ำกว่า 1.4.4                                                           | `bun upgrade`                                                                           |
| webhook คืน 401                        | signature ไม่ตรง — `GITHUB_WEBHOOK_SECRET` ไม่ตรงกับที่ตั้งใน GitHub App            | ตั้ง secret ให้ตรงทั้งสองฝั่ง                                                           |
| webhook คืน 429                        | ติด rate limit (free plan 50/เดือน)                                                 | upgrade plan หรือเช็คตาราง `rateLimits`                                                 |
| AI review ไม่ทำงาน                     | ไม่ได้ตั้ง AI key เลย / key ผิด / โควตาเต็มทุกเจ้า                                  | เช็ค `GET /api/health/ai` ว่ามี provider พร้อมใช้งาน (default หลักคือ `OPENAI_API_KEY`) |
| job ไม่รัน                             | `TRIGGER_PROJECT_ID`/`TRIGGER_SECRET_KEY` ไม่ตั้ง หรือ task runner/deploy ไม่ได้รัน | ตั้ง project/key และใช้ script dev/deploy ของ queue                                     |
| webhook คืน 503                        | signing secret ไม่ครบ หรือ DB ตรวจ quota ไม่ได้                                     | ตรวจ secret ของ provider และ connection ฐานข้อมูล                                       |
| checkout คืน 503                       | Stripe price/meter config ไม่ครบหรือไม่ตรงเงื่อนไข                                  | ตรวจ base price และ metered overage ตามหัวข้อ billing                                   |
| notification ค้าง                      | Stripe/Slack ขัดข้องหรือ credentials ไม่ถูกต้อง                                     | ตรวจ `notification_outbox` และ task `retry-notifications`                               |
| inline comment ไม่ปรากฏ แต่ job สำเร็จ | line number map ไม่ตรง diff                                                         | ดู `getModifiedLines()` ใน [packages/ai/src/patch.ts](packages/ai/src/patch.ts)         |
| ล็อกอินไม่ได้                          | OAuth callback URL ไม่ตรง / `BETTER_AUTH_SECRET` ไม่ตั้ง                            | ตั้ง callback `.../api/auth/callback/github`                                            |
| Stripe webhook ไม่เข้า                 | signature ไม่ตรง                                                                    | ใช้ secret จาก `stripe listen` (local)                                                  |
| migration error                        | `DATABASE_URL` ผิด / DB ไม่ขึ้น                                                     | เช็ค connection / `docker compose up -d postgres`                                       |
| typecheck fail หลังแก้ schema          | type ไม่ตรงหลังแก้ schema                                                           | `bun run db:generate` แล้ว `bun run typecheck`                                          |

### เคล็ดลับ debug

- ดู log job แบบ realtime ได้ที่ Trigger.dev dashboard
- ใช้ `bun run db:studio` ดูข้อมูลใน DB
- error ที่ production ดูที่ Sentry (ถ้าตั้ง `SENTRY_DSN`)
- โค้ดส่วนใหญ่เช็ค env ก่อนทำงาน — ถ้าฟีเจอร์หนึ่ง "เงียบ" ไม่ทำงาน ให้เช็คว่าตั้ง env ครบหรือยัง

---

_คู่มือนี้อ้างอิง config และโค้ดของโปรเจค เมื่อแก้โครงสร้างหรือ env ให้ปรับ [ฉบับอังกฤษ](DEVELOPER-GUIDE.md) ควบคู่กัน_
