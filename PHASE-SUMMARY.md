# สรุปงานที่ทำในแต่ละ Phase — AI Code Review Bot

> เอกสารนี้สรุปสิ่งที่พัฒนาไปจริงในแต่ละ Phase โดยอ้างอิงจากโค้ดในโปรเจค
> ระบุว่าแต่ละ Phase ทำอะไร เกี่ยวข้องกับไฟล์ไหน มีฟังก์ชันอะไรบ้าง และแต่ละฟังก์ชันทำหน้าที่อะไร
>
> **สถานะรวม:** ✅ MVP + V1 + V2 เสร็จสมบูรณ์ (v2.0)
> **อัปเดต:** 30 มิถุนายน 2026

---

## ภาพรวมสถาปัตยกรรม (เข้าใจก่อนอ่านแต่ละ Phase)

ระบบเป็น **Monorepo** (Turborepo + Bun workspaces) แบ่งเป็น `apps/` (แอปที่ deploy จริง) และ `packages/` (โค้ดที่แชร์กัน)

```
┌──────────┐  webhook   ┌────────────────┐  trigger   ┌──────────────┐
│ GitHub/  │ ─────────► │  apps/webhook  │ ─────────► │ packages/    │
│ GitLab/  │            │  (Hono on CF   │            │ queue        │
│ Bitbucket│            │   Workers)     │            │ (Trigger.dev)│
└──────────┘            └────────────────┘            └──────┬───────┘
                          ตรวจ signature                     │
                          + rate limit                        ▼
                                              ┌────────────────────────────┐
                                              │ ดึง diff → Claude review →  │
                                              │ post comment → save DB →    │
                                              │ Slack/Stripe                │
                                              └────────────────────────────┘

┌────────────────┐
│ apps/dashboard │  ผู้ใช้ล็อกอิน, ดูประวัติ, จัดการ billing, ตั้งค่า
│ (Next.js 15)   │
└────────────────┘
```

**บทบาทของแต่ละ package:**
| Package | หน้าที่ |
|---|---|
| `packages/db` | Drizzle ORM schema + database client + auth config |
| `packages/github` `gitlab` `bitbucket` | API client ของแต่ละแพลตฟอร์ม (ดึง PR/MR, โพสต์ comment) |
| `packages/ai` | เชื่อม Claude, สร้าง prompt, parse config, generate profile |
| `packages/queue` | Trigger.dev tasks ที่รัน review จริงเบื้องหลัง |
| `apps/webhook` | รับ webhook, ตรวจ signature, rate limit, dispatch job |
| `apps/dashboard` | หน้าเว็บ: auth, billing, ประวัติ, ตั้งค่า |
| `apps/mcp-server` `apps/vscode-extension` | ส่วนต่อขยายสำหรับ IDE (V2) |

---

## Phase 1: Core Infrastructure (สัปดาห์ 1–2)

**เป้าหมาย:** เปิด PR → webhook มาถึง → job รันได้ (ยังไม่มี AI)

### 1.1 Database Schema — `packages/db/src/schema.ts`
นิยามตารางทั้งหมดด้วย Drizzle ORM (type-safe SQL)

| ตาราง | หน้าที่ | คอลัมน์สำคัญ |
|---|---|---|
| `organizations` | องค์กร/ทีมที่ติดตั้ง bot | `githubInstallationId`, `plan` (free/team/business), `stripeCustomerId`, `slackWebhookUrl`, `emailReportEnabled` |
| `repositories` | repo ที่เปิดใช้งาน | `provider` (github/gitlab/bitbucket), provider-specific IDs, `conventionProfile` (YAML), `isActive` |
| `reviews` | บันทึกการ review แต่ละครั้ง | `prNumber`, `status`, `tokensInput/Output`, `score`, `bugsFound`, `commentsPosted`, `durationMs` |
| `reviewComments` | comment แต่ละจุดในไฟล์ | `file`, `line`, `severity`, `message`, `suggestion` |
| `userOrganizations` | join table ผู้ใช้ ↔ องค์กร | `role` (owner/member) |
| `user/session/account/verification` | ตาราง Better Auth | สำหรับ GitHub OAuth |
| `stripeWebhookEvents` | กัน replay attack ของ Stripe webhook | `eventId` (PK) |
| `rateLimits` | ตัวนับ PR ต่อเดือนแบบ atomic | `orgKey`, `monthKey`, `used`, `overageUsed` |

- **Relations:** กำหนดความสัมพันธ์ org→repos→reviews→comments
- **Indexes:** มี composite index `reviews_analytics_idx` (repo_id + status + created_at) เพื่อ optimize query analytics
- **Type Exports:** export type `Organization`, `Repository`, `Review`, `ReviewComment` ฯลฯ ให้ใช้ทั้งระบบ

### 1.2 Database Client — `packages/db/src/client.ts`
- **`createDb(databaseUrl?, poolSize?)`** — สร้าง connection pool ไปยัง PostgreSQL (อ่านจาก `DATABASE_URL`, pool size จาก `DB_POOL_MAX` default 5) คืน drizzle instance พร้อม schema
- **`db`** — singleton instance สำหรับใช้ใน Next.js server components

### 1.3 Database Index — `packages/db/src/index.ts`
- Re-export ทุกตาราง + types + drizzle operators (`eq`, `and`, `desc`, `count`, `sql` ฯลฯ) เพื่อให้ทุก package ใช้ instance เดียวกัน

### 1.4 GitHub App Auth — `packages/github/src/app.ts`
- **`createAppOctokit(config)`** — สร้าง Octokit client ที่ auth ด้วย App credentials (appId + privateKey)
- **`createInstallationOctokit(config, installationId)`** — ขอ installation access token แล้วคืน Octokit ที่ auth เป็น installation นั้น (ใช้ดึง/โพสต์ใน repo ของลูกค้า)

### 1.5 GitHub Client — `packages/github/src/client.ts`
Class `GitHubClient` รวม method สำหรับงาน review:
- **`getPullRequest()`** — ดึง metadata ของ PR (title, author, branch, counts)
- **`getPullRequestDiff()`** — ดึง raw unified diff
- **`getPullRequestFiles()`** — ดึงรายการไฟล์ที่เปลี่ยน + patch (paginated)
- **`createReview()`** — โพสต์ review พร้อม inline comments
- **`createPRComment()`** — โพสต์ comment รวม (ไม่ใช่ inline) สำหรับ summary
- **`getFileContent()`** — ดึงเนื้อไฟล์ (เช่น `.reviewbot.yml`) แบบ decode base64

### 1.6 Webhook Entry — `apps/webhook/src/index.ts` + `server.ts`
- **`index.ts`** — entry point บน Cloudflare Workers (ห่อด้วย Sentry) กำหนด routes:
  - `GET /`, `GET /health` — health check
  - `POST /webhook/github` `gitlab` `bitbucket` — รับ webhook (ผ่าน middleware ตรวจ signature + rate limit ก่อน)
- **`server.ts`** — เวอร์ชัน self-hosted (Bun/Node) ใช้ `createMemoryKV()` จำลอง Cloudflare KV (cache แบบ TTL ด้วย Map)
- **`types.ts`** — นิยาม `Env`, event types, payload interfaces

### 1.7 Installation Handler — `apps/webhook/src/handlers/installation.ts`
- **`handleInstallation(c)`** — validate payload ด้วย Zod → ถ้า action `created`/`deleted` ส่ง trigger task `sync-installation`; `suspend`/`unsuspend` แค่ log

### 1.8 HMAC Signature Verify — `apps/webhook/src/middleware/verify-signature.ts`
- **`verifyGitHubSignature(c, next)`** — อ่าน header `X-Hub-Signature-256`, คำนวณ HMAC-SHA256 ของ body, เทียบแบบ timing-safe, เก็บ raw body ไว้ใน context — ถ้าไม่ตรงคืน 401
- **`timingSafeEqual(a, b)`** — เทียบ string แบบ constant-time กัน timing attack

**ผลลัพธ์ Phase 1:** webhook รับ event ได้ปลอดภัย → dispatch job → sync installation ลง DB

---

## Phase 2: Claude Integration (สัปดาห์ 3–4)

**เป้าหมาย:** review จริงด้วย Claude พร้อม structured output + inline comment

### 2.1 AI Review Engine — `packages/ai/src/index.ts`
- **`ReviewSchema`** (Zod) — โครงสร้างผลลัพธ์ที่บังคับให้ Claude คืน: `comments[]` (file, line, severity, message, suggestion), `summary`, `score` (0–100)
- **`ReviewError`** (class) — แยกว่า error retry ได้ไหม (`retryable: boolean`)
- **`reviewDiff(diffContent, config)`** — หัวใจของระบบ:
  1. สร้าง Anthropic client
  2. เรียก `generateObject()` (Vercel AI SDK) ด้วย model `claude-sonnet-4-6`
  3. ส่ง system prompt + diff
  4. แยก error: 429/500+ = retryable, อื่นๆ = non-retryable
  5. คืนผล review + token usage (`tokensInput`, `tokensOutput`)

### 2.2 System Prompt Builder — `packages/ai/src/prompts.ts`
- **`buildSystemPrompt(config)`** — สร้าง prompt แบบ dynamic:
  - ตั้งภาษา comment (ไทย/อังกฤษ) ตาม `config.language`
  - ใส่ convention ตาม `profile`: **Laravel** (Eloquent, Service, FormRequest, กัน N+1), **Vue** (Composition API, typed props), **TypeScript** (strict, ห้าม `any`)
  - ผนวก custom rules จาก `.reviewbot.yml`
  - บังคับให้ comment เฉพาะบรรทัดที่เพิ่ม/แก้ และใช้เลขบรรทัดฝั่งขวา

### 2.3 Config Parser — `packages/ai/src/config.ts`
- **`ReviewBotConfigSchema`** (Zod) — โครงสร้าง `.reviewbot.yml`: `profile`, `language`, `rules[]`, `ignore[]`, `limits` (max_file_size_lines, max_files_per_pr)
- **`parseReviewBotConfig(ymlString)`** — parse YAML → validate → ถ้า null หรือ error คืน config ค่า default

### 2.4 Diff Line Parser — `packages/ai/src/patch.ts`
- **`getModifiedLines(patch)`** — อ่าน hunk header `@@ -a,b +c,d @@` ติดตามเลขบรรทัดฝั่งขวา คืน array ของบรรทัดที่ถูก "เพิ่ม" (`+`) เพื่อให้ map comment ลงบรรทัดถูกต้อง

### 2.5 Review Task (GitHub) — `packages/queue/src/tasks/review-pr.ts`
- **`reviewPRTask`** (Trigger.dev task, retry 3 ครั้ง backoff) — pipeline หลัก:
  1. สร้าง installation Octokit
  2. ดึงไฟล์ PR + `.reviewbot.yml`
  3. กรองไฟล์: ไม่เอาไฟล์ที่ลบ/ไม่มี patch/เกิน max lines/ตรง ignore pattern, เลือกสูงสุด `max_files_per_pr`
  4. เรียก `reviewDiff()`
  5. โพสต์ผ่าน `createReview()` (inline) + `createPRComment()` (summary)
  6. บันทึก DB + แจ้ง Slack
  7. จัดการ error: non-retryable → โพสต์ error comment + save failed; retryable → ปล่อยให้ retry

### 2.6 Trigger.dev Config — `packages/queue/trigger.config.ts`
- กำหนด project, retry policy (maxAttempts 3, exponential backoff), โฟลเดอร์ task

### 2.7 Save Review — `packages/queue/src/lib/save-review.ts`
- **`saveReviewAndNotify(input, slackPayload)`** — insert review + comments ลง DB, ดึง org, รายงาน Stripe meter, ส่ง Slack
- **`saveFailedReview(input)`** — บันทึก review ที่ fail (ไม่ throw)
- **`formatCommentBody(severity, message, suggestion?)`** — จัด markdown ของ comment

**ผลลัพธ์ Phase 2:** เปิด PR → Claude review → inline comment ปรากฏพร้อม severity label

---

## Phase 3: Dashboard + Auth + Billing (สัปดาห์ 5–6)

**เป้าหมาย:** ผู้ใช้ install ได้ + จ่ายเงินได้ + ดูประวัติได้

### 3.1 Auth (Better Auth + GitHub OAuth)
- **`packages/db/src/auth.ts`** — config `betterAuth` ผูก Drizzle adapter + GitHub social provider
- **`apps/dashboard/src/app/api/auth/[...all]/route.ts`** — รับ GET/POST ส่งต่อให้ auth handler
- **`apps/dashboard/src/lib/auth-client.ts`** — client-side `signIn`, `signOut`, `useSession`

### 3.2 หน้าเว็บหลัก (Next.js App Router)
- **`app/page.tsx`** — landing page (ถ้าล็อกอินแล้ว redirect ไป `/dashboard`)
- **`app/layout.tsx`** — root layout + metadata
- **`app/dashboard/layout.tsx`** — sidebar (Overview, Repositories, History, Billing, Settings) + ตรวจสิทธิ
- **`app/dashboard/page.tsx`** — หน้าภาพรวม: บัตรผู้ใช้/การเชื่อมต่อ/quota เดือนนี้ + สถิติ 30 วัน + กราฟ
- **`app/dashboard/setup/page.tsx`** — แนะนำการติดตั้ง GitHub App
- **`app/dashboard/repos/page.tsx`** — รายการ repo ทั้งหมด
- **`app/dashboard/history/page.tsx`** — ประวัติ review 50 รายการล่าสุด

### 3.3 Org & Billing Logic — `apps/dashboard/src/lib/org.ts`
- **`PLAN_LIMITS`** — นิยาม 3 plan (PRs/เดือน, repo limit, ราคา monthly/annual, overage)
- **`getUserOrg()`** — หา org ของผู้ใช้
- **`getMonthlyReviewCount()`** — นับ review ที่ completed เดือนนี้
- **`getUsageSummary()`** — คำนวณ quota (used, limit, percent, overage)
- **`getDashboardAnalytics()`** — รวมสถิติ 30 วัน (token, bugs, score trend) แยกรายวันสำหรับกราฟ

### 3.4 Stripe Billing
- **`apps/dashboard/src/lib/stripe.ts`** — สร้าง Stripe client (API version `2026-03-25.dahlia`)
- **`api/stripe/checkout/route.ts`** — สร้าง checkout session (รับ plan + billing monthly/annual) คืน checkout URL
- **`api/stripe/portal/route.ts`** — สร้าง billing portal session ให้ผู้ใช้จัดการ subscription
- **`api/webhooks/stripe/route.ts`** — รับ Stripe events:
  - ตรวจ signature + กัน replay (บันทึก eventId)
  - `checkout.session.completed` → อัปเดต `stripeCustomerId` + plan
  - `subscription.updated` → เปลี่ยน plan ตามราคา
  - `subscription.deleted` → กลับเป็น free
- **`api/billing/summary/route.ts`** — คืนสรุป billing สำหรับหน้า billing
- **`app/dashboard/billing/page.tsx`** — แสดง plan ปัจจุบัน + usage + ปุ่ม upgrade/manage
- **`components/upgrade-button.tsx`** — เริ่ม checkout
- **`components/manage-subscription-button.tsx`** — ไป Stripe portal

### 3.5 Stripe Usage Meter — `packages/queue/src/lib/stripe-meter.ts`
- **`reportPRReviewToMeter(stripeCustomerId)`** — ส่ง billing meter event (value 1) ทุกครั้งที่ review เสร็จ (non-fatal ถ้า fail)

### 3.6 Sync Installation — `packages/queue/src/tasks/sync-installation.ts`
- **`syncInstallationTask`** — sync ข้อมูล install ลง DB:
  - `created` → upsert org + insert repos
  - `deleted` → mark repos เป็น inactive
  - `suspend/unsuspend` → log

**ผลลัพธ์ Phase 3:** install ผ่าน OAuth → subscribe ได้ → ดู history + usage ได้

---

## Phase 4: GitLab + Analytics + Slack (สัปดาห์ 7–8)

**เป้าหมาย:** เพิ่มแพลตฟอร์ม + ทำให้มองเห็นข้อมูล

### 4.1 GitLab Support
- **`packages/gitlab/src/client.ts`** — class `GitLabClient`:
  - **`request<T>()`** — fetch wrapper พร้อม `PRIVATE-TOKEN` header
  - **`getMergeRequest()`** — ดึง MR metadata + diff refs (จำเป็นสำหรับ inline)
  - **`getMergeRequestChanges()`** — ดึงไฟล์ที่เปลี่ยน
  - **`getFileContent()`** — ดึงเนื้อไฟล์
  - **`createMergeRequestNote()`** — comment รวม
  - **`createInlineDiscussion()`** — comment inline ตามตำแหน่ง diff
- **`apps/webhook/src/handlers/merge-request.ts`** — **`handleMergeRequest(c)`** validate + กรอง action (`open/reopen/update`) → trigger task `review-merge-request`
- **`apps/webhook/src/middleware/verify-gitlab-signature.ts`** — **`verifyGitLabSignature()`** ตรวจ header `X-Gitlab-Token` แบบ timing-safe
- **`packages/queue/src/tasks/review-merge-request.ts`** — **`reviewMergeRequestTask`** pipeline เหมือน GitHub แต่ใช้ GitLab API + **`upsertGitLabRepo()`** สร้าง repo record ถ้ายังไม่มี

### 4.2 Slack Notifications — `packages/queue/src/lib/slack.ts`
- **`sendSlackReviewNotification(payload, orgWebhookUrl?)`** — สร้าง Slack message block (header, title, สถิติ score/bugs/comments, summary, ปุ่มลิงก์) POST ไป webhook (ใช้ของ org หรือ fallback env)

### 4.3 Settings (Slack/GitLab) — Dashboard
- **`app/dashboard/settings/page.tsx`** — ฟอร์มตั้งค่า Slack webhook + คู่มือตั้ง GitLab webhook
- **`components/settings-form.tsx`** — ฟอร์ม + ปุ่ม save (loading/success/error)
- **`api/settings/route.ts`** — อัปเดต `slackWebhookUrl` ของ org

### 4.4 Analytics Dashboard
- **`components/analytics-chart.tsx`** — วาดกราฟเส้น SVG (token usage, bugs, score trend)
- ข้อมูลมาจาก `getDashboardAnalytics()` ใน `lib/org.ts` (Phase 3.3)

### 4.5 Review Replay UI
- **`app/dashboard/history/[reviewId]/page.tsx`** — แสดงรายละเอียด review เดียว: สถิติ, summary, inline comments จัดกลุ่มตามไฟล์ (severity badge, line, suggestion), ลิงก์ไปต้นทาง
- **`app/dashboard/repos/[repoId]/page.tsx`** — รายละเอียด repo: convention profile + 10 reviews ล่าสุด

**ผลลัพธ์ Phase 4:** รองรับ GitLab + ส่ง Slack + ดู analytics และ replay ได้

---

## Phase 5: Polish + Launch (สัปดาห์ 9–10)

**เป้าหมาย:** production-ready + เตรียม launch

### 5.1 Rate Limiting — `apps/webhook/src/middleware/rate-limit.ts`
- **`rateLimit(c, next)`** — บังคับ quota ต่อ org:
  - ทำงานเฉพาะ event PR/MR
  - หา org key (installation ID / GitLab namespace)
  - **atomic increment** ด้วย SQL `INSERT ... ON CONFLICT` (ตาราง `rateLimits` — กัน race condition)
  - **Free** (50/เดือน) → block เมื่อเกิน (429); **Team** (500) → allow + นับ overage; **Business** → ไม่จำกัด
- **`fetchPlan()`** — ดึง plan จาก DB (cache 1 ชม. ใน KV)

### 5.2 Pricing Page (เตรียม launch)
- **`app/pricing/page.tsx`** — 4 plan + toggle Monthly/Annual + ตารางเปรียบเทียบ + FAQ
- **`components/billing-interval-toggle.tsx`** — สลับ Monthly/Annual (ลด 20%)
- **`app/pricing/enterprise/page.tsx`** — ฟอร์มติดต่อ Enterprise
- **`api/contact/enterprise/route.ts`** — รับ lead (name, email, company) แล้ว log

### 5.3 Observability + Docs
- **`sentry.*.config.ts`** (client/server/edge) — error tracking ใน dashboard; webhook ก็ห่อด้วย Sentry ใน `index.ts`
- **`apps/docs/`** — เว็บเอกสารด้วย Fumadocs

### 5.4 Repo Management
- **`components/repo-toggle.tsx`** — ปุ่ม activate/deactivate
- **`api/repos/[repoId]/route.ts`** — PATCH อัปเดต `isActive`

**ผลลัพธ์ Phase 5:** rate limit ทำงานจริง + หน้า pricing/landing + observability พร้อม launch

---

## V2 (Backlog) — ฟีเจอร์เสริมขั้นสูง

### V2.1 Self-hosted Docker
- `Dockerfile.webhook`, `Dockerfile.dashboard`, `docker-compose.yml`, `.env.example`
- `apps/webhook/src/server.ts` (Bun server + `createMemoryKV()`) ทำให้รันได้นอก Cloudflare

### V2.2 AI Profile Generator — `packages/ai/src/profile-generator.ts`
- **`generateConventionProfile(files, repoFullName)`** — ส่งตัวอย่างไฟล์ (สูงสุด 20) ให้ Claude วิเคราะห์ framework/anti-pattern/ignore แล้ว generate `.reviewbot.yml`
- **`buildYaml(profile)`** — แปลงผลเป็น YAML string
- **`api/repos/[repoId]/generate-profile/route.ts`** — endpoint เรียกใช้งานจาก dashboard

### V2.3 Weekly Email Report
- **`packages/queue/src/tasks/weekly-email-report.ts`** — **`weeklyEmailReportTask`** (scheduled cron `0 9 * * 1` — จันทร์ 09:00 UTC): หา org ที่เปิดรายงาน → aggregate สถิติสัปดาห์ + top 10 repos → ส่งอีเมล
- **`packages/queue/src/lib/email.ts`** — **`sendWeeklyReport(data)`** ส่งผ่าน Resend API; **`buildWeeklyReportHtml()`** สร้าง HTML; schema เพิ่ม `emailReportEnabled`, `emailReportRecipients`

### V2.4 Bitbucket Support
- **`packages/bitbucket/src/client.ts`** — class `BitbucketClient` (Basic auth): `getPullRequest`, `getPullRequestDiff`, `getPullRequestFiles`, `getFileContent`, `createPRComment`, `createInlineComment`
- **`apps/webhook/src/handlers/bitbucket-pr.ts`** — **`handleBitbucketPR(c)`** validate + แยก workspace/repo slug → trigger task
- **`apps/webhook/src/middleware/verify-bitbucket-signature.ts`** — **`verifyBitbucketSignature()`** ตรวจ HMAC `X-Hub-Signature`
- **`packages/queue/src/tasks/review-bitbucket-pr.ts`** — **`reviewBitbucketPRTask`** + **`parseDiffByFile()`** แยก unified diff เป็น patch ต่อไฟล์
- schema: เพิ่ม `bitbucketRepoId` + ขยาย provider enum

### V2.5 MCP Server — `apps/mcp-server/src/index.ts`
Server ตาม Model Context Protocol ให้ Claude Desktop/Cursor เข้าถึง 5 tools:
- **`list_reviews`** — ดู review ล่าสุดของ repo
- **`get_review`** — รายละเอียด review + comments
- **`generate_profile`** — สร้าง `.reviewbot.yml`
- **`review_diff`** — review diff โดยไม่เปิด PR
- **`repo_stats`** — สถิติ repo ในช่วงเวลา

### V2.6 VS Code Extension — `apps/vscode-extension/src/extension.ts`
review code ในเครื่องก่อน push:
- **Commands:** `reviewFile` (review ไฟล์ปัจจุบันจาก `git diff HEAD`), `reviewSelection` (review ข้อความที่เลือก), `clearDiagnostics`, `configure`
- **onSave listener** — review อัตโนมัติเมื่อบันทึก (ถ้าเปิด `showOnSave`)
- **Helpers:** `buildFileDiff()`, `buildSelectionDiff()`, `toDiagnosticSeverity()`, `applyDiagnostics()` (แสดงผลเป็น diagnostics inline)
- เรียก endpoint **`api/review/diff/route.ts`** (ตรวจ Bearer token `REVIEW_API_KEY`) → คืน score, summary, comments

---

## ตารางสรุปไฟล์ ↔ Phase

| Phase | ไฟล์หลัก |
|---|---|
| **1 — Infra** | `packages/db/src/{schema,client,index}.ts`, `packages/github/src/{app,client}.ts`, `apps/webhook/src/{index,server}.ts`, `handlers/installation.ts`, `middleware/verify-signature.ts` |
| **2 — Claude** | `packages/ai/src/{index,prompts,config,patch}.ts`, `packages/queue/src/tasks/review-pr.ts`, `lib/save-review.ts`, `trigger.config.ts` |
| **3 — Dashboard/Auth/Billing** | `packages/db/src/auth.ts`, `apps/dashboard/src/app/{page,layout}.tsx`, `dashboard/*`, `lib/{org,stripe}.ts`, `api/stripe/*`, `api/auth/*`, `packages/queue/src/{lib/stripe-meter,tasks/sync-installation}.ts` |
| **4 — GitLab/Analytics/Slack** | `packages/gitlab/src/client.ts`, `handlers/merge-request.ts`, `middleware/verify-gitlab-signature.ts`, `tasks/review-merge-request.ts`, `lib/slack.ts`, `components/analytics-chart.tsx`, `history/[reviewId]`, `repos/[repoId]` |
| **5 — Polish/Launch** | `middleware/rate-limit.ts`, `app/pricing/*`, `api/contact/enterprise`, `sentry.*.config.ts`, `apps/docs/` |
| **V2** | `Dockerfile.*`, `ai/profile-generator.ts`, `tasks/weekly-email-report.ts`, `lib/email.ts`, `packages/bitbucket/*`, `apps/mcp-server/*`, `apps/vscode-extension/*` |

---

*สรุปนี้สร้างจากการอ่านโค้ดจริงในโปรเจค — ดูแผนเต็มได้ที่ [implementation-plan.md](implementation-plan.md)*
