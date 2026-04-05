# แผนพัฒนา AI Code Review Bot (Modern Stack 2026)

> **สถานะ:** Planning Phase  
> **เวอร์ชัน:** 1.0  
> **อัปเดตล่าสุด:** เมษายน 2026  
> **Stack philosophy:** Edge-first · Type-safe end-to-end · AI-native

---

## สารบัญ

1. [ภาพรวมโปรเจค](#1-ภาพรวมโปรเจค)
2. [Modern Tech Stack](#2-modern-tech-stack)
3. [สถาปัตยกรรมระบบ](#3-สถาปัตยกรรมระบบ)
4. [Database Schema](#4-database-schema)
5. [Feature Roadmap](#5-feature-roadmap)
6. [Timeline (10 สัปดาห์)](#6-timeline-10-สัปดาห์)
7. [Monetization & Pricing](#7-monetization--pricing)
8. [Go-to-Market Strategy](#8-go-to-market-strategy)
9. [Risk Assessment](#9-risk-assessment)
10. [Definition of Done](#10-definition-of-done)

---

## 1. ภาพรวมโปรเจค

### Vision
GitHub/GitLab App ที่ใช้ Claude วิเคราะห์ Pull Request แบบ inline comment อัตโนมัติ รู้จัก convention ของแต่ละทีม (Laravel, Vue, TypeScript) โดยเฉพาะ ไม่ใช่ generic AI review

### จุดต่างจาก GitHub Copilot Review
| Feature | Copilot Review | AI Review Bot |
|---|---|---|
| Framework-aware | ✗ generic | ✓ Laravel / Vue / TS profiles |
| Custom team rules | ✗ | ✓ YAML config per repo |
| Self-hosted option | ✗ | ✓ Docker image |
| Cost transparency | bundled | ✓ per-PR usage dashboard |
| GitLab support | ✗ | ✓ Phase 2 |

### Target Users
- Dev team 3–20 คนที่ทำ code review ช้าเพราะคนน้อย
- Agency ที่รับงาน client หลายเจ้า อยากมี quality gate อัตโนมัติ
- Thai tech company ที่ใช้ Laravel/Vue stack

---

## 2. Modern Tech Stack

### Runtime & Framework

```
Bun 1.x                  — runtime หลัก (Node.js drop-in แต่เร็วกว่า 3–4x)
Hono.js                  — edge-ready HTTP framework, ultra-lightweight
TypeScript 5.x           — strict mode, end-to-end type safety
```

> **ทำไม Hono แทน Express:** Hono รัน native บน Cloudflare Workers, Bun, Deno ได้เลย — deploy edge ได้โดยไม่ต้องแก้ code และเร็วกว่า Express ~10x ใน benchmark

### AI Layer

```
Anthropic Claude claude-sonnet-4-6    — review engine หลัก
Vercel AI SDK 4.x        — streaming, structured output, tool calling
ai/rsc                   — AI-native React Server Components (dashboard)
Zod                      — schema validation สำหรับ Claude structured output
```

```typescript
import { generateObject } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'

const ReviewSchema = z.object({
  comments: z.array(z.object({
    file: z.string(),
    line: z.number(),
    severity: z.enum(['bug', 'suggestion', 'nitpick', 'praise']),
    message: z.string(),
    suggestion: z.string().optional(),
  })),
  summary: z.string(),
  score: z.number().min(0).max(100),
})

const { object } = await generateObject({
  model: anthropic('claude-sonnet-4-6'),
  schema: ReviewSchema,
  system: conventionProfile,
  prompt: `Review this diff:\n\n${diff}`,
})
```

### Queue & Background Jobs

```
Trigger.dev v3           — type-safe background jobs, built-in retries, realtime logs
                           ไม่ต้องดูแล queue infrastructure เอง
```

```typescript
import { task } from '@trigger.dev/sdk/v3'

export const reviewPRTask = task({
  id: 'review-pull-request',
  retry: { maxAttempts: 3, backoffFactor: 2 },
  run: async (payload: { prId: string; repoId: string }) => {
    const diff = await fetchPRDiff(payload.prId)
    const review = await runClaudeReview(diff)
    await postGitHubComments(payload.prId, review)
  },
})
```

> **ทำไม Trigger.dev แทน BullMQ:** ไม่ต้องดูแล Redis + worker เอง, มี dashboard monitoring ในตัว, type-safe payload ตั้งแต่ trigger ถึง handler, dev experience ดีกว่ามาก

### Database & ORM

```
PostgreSQL 16            — primary database (Supabase managed)
Drizzle ORM              — type-safe SQL, zero magic, migration เป็น TypeScript
Supabase                 — hosted Postgres + realtime + auth ฟรีใน tier ต่ำ
```

```typescript
import { pgTable, uuid, text, integer, timestamp } from 'drizzle-orm/pg-core'

export const reviews = pgTable('reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: text('pr_id').notNull(),
  repoId: text('repo_id').notNull(),
  tokensUsed: integer('tokens_used').notNull(),
  score: integer('score'),
  createdAt: timestamp('created_at').defaultNow(),
})
```

> **ทำไม Drizzle แทน Prisma:** SQL-first ไม่มี magic, bundle size เล็กกว่า 10x, inference type แม่นยำกว่า, เหมาะกับ edge runtime

### Frontend Dashboard

```
Next.js 15 (App Router)  — dashboard หลัก, React Server Components
shadcn/ui                — component library (copy-paste, ไม่ใช่ dependency)
Tailwind CSS v4          — utility-first, zero-config, faster build
Recharts                 — usage + analytics charts
nuqs                     — type-safe URL search params
```

### Auth & Billing

```
Better Auth              — auth library สมัยใหม่ (แทน NextAuth), GitHub OAuth built-in
Stripe                   — subscription + usage-based billing
Stripe Billing Meter     — นับ PR review อัตโนมัติ สำหรับ usage-based tier
```

### Observability

```
OpenTelemetry SDK        — tracing + metrics (vendor-neutral)
Axiom                    — log ingestion + query (ถูกกว่า Datadog มาก)
Sentry                   — error tracking
```

### Deployment

```
Cloudflare Workers       — webhook endpoint (edge, global, ~0ms cold start)
Supabase                 — database + auth
Trigger.dev Cloud        — background job runner
Vercel                   — Next.js dashboard
GitHub Actions           — CI/CD pipeline
```

> **ทำไม Cloudflare Workers แทน server:** GitHub webhook ต้องตอบ 200 OK ภายใน 10 วิ, Workers มี cold start 0ms, scale อัตโนมัติ, ราคาเริ่ม $0 จนถึง 10M request/เดือน

---

## 3. สถาปัตยกรรมระบบ

### Monorepo Structure (Turborepo)

```
ai-review-bot/
├── apps/
│   ├── webhook/          — Hono.js on Cloudflare Workers
│   ├── dashboard/        — Next.js 15 App Router
│   └── docs/             — Fumadocs (MDX documentation)
├── packages/
│   ├── ai/               — Claude integration + prompts
│   ├── github/           — GitHub App API client
│   ├── db/               — Drizzle schema + migrations
│   ├── queue/            — Trigger.dev task definitions
│   └── ui/               — shadcn/ui shared components
├── turbo.json
└── package.json          — Bun workspaces
```

### PR Review Flow

```
┌─────────────┐   webhook    ┌──────────────────────┐
│   GitHub    │ ──────────► │  Cloudflare Workers   │
│  (PR open)  │             │  Hono.js endpoint     │
└─────────────┘             └──────────┬───────────┘
                                       │ verify HMAC
                                       │ trigger.dev task
                                       ▼
                             ┌──────────────────────┐
                             │   Trigger.dev         │
                             │   reviewPRTask        │
                             └──────────┬───────────┘
                    ┌──────────────────┼─────────────────┐
                    ▼                  ▼                  ▼
             fetch PR diff     load convention      check quota
             GitHub API        profile (DB)         Stripe Meter
                    └──────────────────┬─────────────────┘
                                       ▼
                             ┌──────────────────────┐
                             │   Claude claude-sonnet-4-6    │
                             │   generateObject()    │
                             │   → ReviewSchema      │
                             └──────────┬───────────┘
                                       │
                    ┌──────────────────┼─────────────────┐
                    ▼                  ▼                  ▼
             post inline         save to DB          Axiom log
             comments            (reviews)           (tokens used)
             GitHub API          Drizzle ORM
```

### Convention Profile System

```yaml
# .reviewbot.yml (วางไว้ใน root ของ repo)
version: 1
profile: laravel-vue          # built-in profile
language: th                  # comment เป็นภาษาไทย

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
  - "*.blade.php"

limits:
  max_file_size_lines: 500    # ข้ามไฟล์ที่ใหญ่เกิน
  max_files_per_pr: 20        # review สูงสุด 20 ไฟล์ต่อ PR
```

---

## 4. Database Schema

```typescript
// packages/db/src/schema.ts (Drizzle ORM)

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  githubInstallationId: text('github_installation_id').unique(),
  name: text('name').notNull(),
  plan: text('plan', { enum: ['free', 'team', 'business'] }).default('free'),
  stripeCustomerId: text('stripe_customer_id'),
  createdAt: timestamp('created_at').defaultNow(),
})

export const repositories = pgTable('repositories', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id),
  githubRepoId: text('github_repo_id').unique().notNull(),
  fullName: text('full_name').notNull(),         // owner/repo
  conventionProfile: text('convention_profile'), // YAML config
  isActive: boolean('is_active').default(true),
})

export const reviews = pgTable('reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  repoId: uuid('repo_id').references(() => repositories.id),
  prNumber: integer('pr_number').notNull(),
  prTitle: text('pr_title'),
  tokensInput: integer('tokens_input').notNull(),
  tokensOutput: integer('tokens_output').notNull(),
  commentsPosted: integer('comments_posted').notNull(),
  bugsFound: integer('bugs_found').default(0),
  score: integer('score'),                        // 0-100
  durationMs: integer('duration_ms'),
  createdAt: timestamp('created_at').defaultNow(),
})

export const reviewComments = pgTable('review_comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  reviewId: uuid('review_id').references(() => reviews.id),
  file: text('file').notNull(),
  line: integer('line').notNull(),
  severity: text('severity', { enum: ['bug', 'suggestion', 'nitpick', 'praise'] }),
  message: text('message').notNull(),
  suggestion: text('suggestion'),
})
```

---

## 5. Feature Roadmap

### MVP (สัปดาห์ 1–6)

- [ ] GitHub App สร้างและติดตั้งได้
- [ ] Webhook รับ PR event + HMAC verify
- [ ] Trigger.dev job: fetch diff → Claude → post comments
- [ ] Convention profiles: Laravel, Vue, TypeScript (built-in)
- [ ] Custom YAML rules per repo (`.reviewbot.yml`)
- [ ] Dashboard: ติดตั้ง App, ดู review history
- [ ] Auth ด้วย GitHub OAuth (Better Auth)
- [ ] Stripe subscription (Free / Team / Business)

### V1 (สัปดาห์ 7–10)

- [ ] GitLab Merge Request support
- [ ] Usage analytics dashboard (token, bugs found, PR score trend)
- [ ] Slack notification เมื่อ review เสร็จ
- [ ] Review replay: ดู diff + comment ย้อนหลังใน dashboard
- [ ] Rate limiting per plan (enforced ด้วย Cloudflare Workers KV)

### V2 (Backlog)

- [ ] Self-hosted Docker image (สำหรับ Enterprise ที่ sensitive เรื่อง code privacy)
- [ ] AI-powered convention profile generator (วิเคราะห์ repo แล้วแนะนำ rules)
- [ ] PR trend report (email weekly)
- [ ] Bitbucket support
- [ ] VS Code extension (inline suggestion ก่อน push)
- [ ] MCP Server สำหรับ integrate กับ IDE

---

## 6. Timeline (10 สัปดาห์)

### Phase 1: Core Infrastructure (สัปดาห์ 1–2)

**เป้าหมาย:** GitHub App + Webhook ทำงานได้ end-to-end

| วัน | งาน |
|---|---|
| 1–2 | Turborepo setup, Bun workspaces, TypeScript config |
| 3–4 | GitHub App สร้าง + permission config (contents:read, pull_requests:write) |
| 5–6 | Hono webhook endpoint บน Cloudflare Workers + HMAC verify |
| 7–8 | Trigger.dev task setup + Drizzle schema + Supabase |
| 9–10 | GitHub API client (fetch diff, post review comments) |

**Deliverable:** เปิด PR ใน test repo → webhook ถึง → job รัน (ยังไม่มี AI)

---

### Phase 2: Claude Integration (สัปดาห์ 3–4)

**เป้าหมาย:** Review จริงด้วย Claude พร้อม structured output

| วัน | งาน |
|---|---|
| 11–12 | Vercel AI SDK setup, `generateObject()` + ReviewSchema |
| 13–14 | System prompt: Laravel profile + Vue profile |
| 15–16 | Inline comment formatter (map line number ให้ถูก) |
| 17–18 | `.reviewbot.yml` parser + custom rules injection |
| 19–20 | File size limit, max files per PR, token estimation |

**Deliverable:** เปิด PR → Claude comment inline ได้ พร้อม severity label ✅

---

### Phase 3: Dashboard + Auth + Billing (สัปดาห์ 5–6)

**เป้าหมาย:** User install ได้ + จ่ายเงินได้

| วัน | งาน |
|---|---|
| 21–22 | Next.js 15 setup + Better Auth + GitHub OAuth |
| 23–24 | GitHub App installation flow (OAuth → install → redirect dashboard) |
| 25–26 | Stripe subscription (Free/Team/Business) + webhook handler |
| 27–28 | Stripe Billing Meter: นับ PR per organization |
| 29–30 | Dashboard: repo list, review history, plan/usage |

**Deliverable:** User install ได้ → จ่ายเงินได้ → ดู history ได้

---

### Phase 4: GitLab + Analytics (สัปดาห์ 7–8)

**เป้าหมาย:** เพิ่ม platform + visibility

| วัน | งาน |
|---|---|
| 31–33 | GitLab webhook + MR API integration |
| 34–35 | Analytics: token usage chart, bugs found trend, PR score |
| 36–38 | Slack notification integration |
| 39–40 | Review replay UI ใน dashboard |

---

### Phase 5: Polish + Launch (สัปดาห์ 9–10)

**เป้าหมาย:** Production-ready + Public launch

| วัน | งาน |
|---|---|
| 41–43 | Rate limiting (Cloudflare Workers KV per org) |
| 44–45 | Landing page (Next.js + Fumadocs) |
| 46–47 | Load test, security audit, Sentry setup |
| 48–50 | Product Hunt launch prep + early access invite |

**Deliverable:** v1.0 production-ready 🚀

---

## 7. Monetization & Pricing

### Pricing Strategy: Seat + Usage Hybrid

| แผน | ราคา/เดือน | PRs/เดือน | Repos | Custom Rules | Support |
|---|---|---|---|---|---|
| **Free** | $0 | 50 | 1 | ✗ | Community |
| **Team** | $19/5 devs | 500 | ไม่จำกัด | ✓ | Email |
| **Business** | $49/20 devs | ไม่จำกัด | ไม่จำกัด | ✓ | Priority |
| **Enterprise** | Custom | ไม่จำกัด | ไม่จำกัด | ✓ + self-host | Dedicated |

### Unit Economics

```
Claude Sonnet ราคา (2026):  ~$3 / 1M input tokens
PR ขนาดกลาง (diff ~6K tokens):  ≈ $0.02 per review
Team plan 500 PRs/เดือน:         ≈ $10 API cost
Team plan revenue:                $19
Gross margin per team:            ~47% (ก่อน infra)

Cloudflare Workers:         $5/month flat (Workers Paid)
Trigger.dev:                $0–25/month (ขึ้นอยู่กับ job volume)
Supabase:                   $25/month (Pro)
Total infra (early stage):  ~$55/month คงที่
```

### Revenue Projection

| เดือน | Free | Team | Business | MRR | Net (หลัง infra + API) |
|---|---|---|---|---|---|
| 1–2 | 50 | 5 | 1 | $144 | ~$60 |
| 3–4 | 150 | 15 | 3 | $432 | ~$280 |
| 5–6 | 400 | 35 | 8 | $1,057 | ~$800 |
| 7–9 | 800 | 70 | 18 | $2,232 | ~$1,800 |
| 10–12 | 1,500 | 120 | 35 | $3,995 | ~$3,300 |

> ARR เป้าหมายปีแรก: **~$35,000–$45,000** (solo product)

### Revenue Levers
- **Annual discount 20%:** ปรับ cashflow ดีขึ้น
- **Usage overage:** $0.05 per PR เกิน quota (แทนการ block)
- **Enterprise setup fee:** $500–$2,000 ต่อ onboarding
- **Convention profile marketplace:** community สร้าง profile ขาย (long-term)

---

## 8. Go-to-Market Strategy

### Phase 0: Build in Public
- Tweet/X ทุก milestone ระหว่าง build (สร้าง audience ก่อน launch)
- Post บน r/laravel, r/vuejs, dev.to เรื่อง convention profile design
- Open source ส่วน convention profiles (แต่ bot core เป็น paid)

### Phase 1: Developer Community (เดือน 1–3)
1. **Product Hunt launch** — วันแรก: free plan ไม่จำกัด 1 เดือน
2. **Hacker News Show HN** — เน้น technical story: "built on Cloudflare Workers + Claude"
3. **GitHub Marketplace listing** — traffic organic จาก devs ค้นหา code review tools
4. **Laravel Thailand / Vue.js TH community** — demo วิธี config profile ภาษาไทย

### Phase 2: Agency & Team Sales (เดือน 4–6)
- Cold outreach ถึง Thai software agency ที่มีทีม 5–20 คน
- Demo: เปิด PR ใน dummy repo → ดู comment ภาษาไทยแบบ real-time
- Offer: ทดลองฟรี 30 วัน Team plan

### Positioning Statement
> "Code review อัตโนมัติที่รู้จัก Laravel และ Vue.js ดีกว่า Copilot เพราะสร้างมาเพื่อ stack นี้โดยเฉพาะ"

---

## 9. Risk Assessment

### ความเสี่ยงสูง

**Claude API cost บานปลายเมื่อ PR diff ใหญ่**
- ปัญหา: PR ที่มี 3,000+ lines diff ใช้ token เยอะมากจนกลับกิน margin
- แนวทาง:
  - Hard cap: ข้ามไฟล์ที่ > 500 lines
  - Chunk strategy: แบ่ง diff ออกเป็น batch ละ 4,000 tokens
  - แจ้ง user ชัดเจนเมื่อ PR ใหญ่เกินและ review เฉพาะบาง file

**Comment คุณภาพต่ำ → churn ทันที**
- ปัญหา: Dev ปิด bot ถ้า false positive เยอะ หรือ comment ไม่ตรง context
- แนวทาง:
  - Thumbs up/down ต่อทุก comment → ใช้เป็น signal fine-tune prompt
  - A/B test prompt version ระหว่าง `staging` กับ `production` profile
  - Default severity `nitpick` ไว้ก่อน เพิ่มเป็น `bug` เมื่อ confidence สูง

### ความเสี่ยงกลาง

**GitHub Copilot Code Review**
- Microsoft rollout Copilot PR review ฟรีสำหรับ Copilot subscriber
- ข้อได้เปรียบ: framework-specific profile, ราคาแยกจาก Copilot license, self-hosted option

**Cloudflare Workers limitations**
- CPU time limit 50ms per request (Paid plan: 30 seconds)
- ต้องตอบ GitHub webhook ภายใน 10 วิ → dispatch Trigger.dev ทันที ไม่รอ Claude

**Trigger.dev vendor lock-in**
- แนวทาง: abstract task runner ออกเป็น interface — สามารถ swap เป็น BullMQ ได้ถ้าจำเป็น

### ความเสี่ยงต่ำ

**GitHub API Rate Limit (5,000 req/hr per installation)**
- แนวทาง: exponential backoff, cache repo metadata ด้วย Cloudflare Workers KV

**GDPR / Data Privacy (code เป็น IP ของลูกค้า)**
- แนวทาง: ไม่ store raw diff, เก็บแค่ metadata (file name, line count, token count)
- Enterprise tier: self-hosted option ที่ไม่มีข้อมูลออกนอก infrastructure ลูกค้า

---

## 10. Definition of Done

### MVP Launch Checklist

**Functional**
- [ ] Install GitHub App จากหน้า dashboard ได้ภายใน 3 คลิก
- [ ] เปิด PR → inline comment ปรากฏภายใน 60 วินาที
- [ ] `.reviewbot.yml` custom rules ทำงานถูกต้อง
- [ ] Stripe subscribe / unsubscribe ทำงานได้
- [ ] Dashboard แสดง review history + token usage ถูกต้อง
- [ ] Free plan enforce 50 PRs/เดือน ได้จริง

**Non-functional**
- [ ] Webhook response time < 200ms (ก่อน dispatch job)
- [ ] Claude review complete < 60 วินาที สำหรับ PR ขนาดกลาง
- [ ] Uptime SLA 99.9% (Cloudflare Workers guarantee)
- [ ] Zero cold start (Cloudflare Workers)

**Security**
- [ ] HMAC-SHA256 webhook signature verify ทุก request
- [ ] GitHub token เข้ารหัสใน DB
- [ ] Rate limit per organization ทำงานถูกต้อง
- [ ] ไม่ store raw code diff ใน database

---

## หมายเหตุสำหรับ Developer

### Environment Variables

```bash
# Cloudflare Workers (wrangler.toml + secrets)
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY=
GITHUB_WEBHOOK_SECRET=
ANTHROPIC_API_KEY=
TRIGGER_SECRET_KEY=
DATABASE_URL=                   # Supabase connection string

# Next.js Dashboard (.env.local)
NEXT_PUBLIC_APP_URL=
BETTER_AUTH_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_METER_ID=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
AXIOM_TOKEN=
SENTRY_DSN=
```

### Development Commands

```bash
# bootstrap
bun install

# dev ทุก app พร้อมกัน
bun run dev

# webhook เฉพาะ (Cloudflare Workers local)
cd apps/webhook && bunx wrangler dev

# dashboard
cd apps/dashboard && bun run dev

# db migration
cd packages/db && bun run migrate

# type check ทั้ง monorepo
bun run typecheck

# deploy production
bun run deploy
```

### Branching Convention

```
main          — production (auto-deploy via GitHub Actions)
develop       — staging (auto-deploy)
feature/*     — feature branches
fix/*         — bug fixes
```

### Key Design Decisions

| Decision | ทางเลือก | เหตุผลที่เลือก |
|---|---|---|
| Bun แทน Node | Node.js, Deno | เร็วกว่า 3x, native TypeScript, Workspaces ดีกว่า |
| Hono แทน Express | Fastify, Elysia | Edge-ready, ขนาดเล็ก, multi-runtime |
| Drizzle แทน Prisma | Prisma, TypeORM | SQL-first, bundle เล็ก, edge compatible |
| Trigger.dev แทน BullMQ | BullMQ, Inngest | ไม่ต้องดูแล Redis, DX ดีกว่า, observability ในตัว |
| Better Auth แทน NextAuth | Lucia, Clerk | Self-hosted, flexible, GitHub OAuth ครบ |
| Cloudflare Workers แทน Server | Vercel Functions, AWS Lambda | 0ms cold start, global edge, ราคาถูกกว่า |

---

*เอกสารนี้ควร review ทุก 2 สัปดาห์และอัปเดต status ให้ตรงกับ implementation จริง*
