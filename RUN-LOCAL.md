# คู่มือรันโปรเจคบนเครื่อง Local

> คู่มือทีละขั้นสำหรับรัน **AI Code Review Bot** บนเครื่องตัวเอง ตั้งแต่ติดตั้งจนเห็นผล review จริง
> เน้น "ทำตามได้ทันที" — เริ่มจากเส้นทางที่เร็วที่สุด (แค่ dashboard + AI) แล้วค่อยเพิ่ม webhook/billing ตามต้องการ
>
> 📎 ดูเพิ่ม: [DEVELOPER-GUIDE.md](DEVELOPER-GUIDE.md) (ละเอียดกว่า) · [SETUP.md](SETUP.md) (ตั้งค่า service ภายนอก) · [README.md](README.md)

---

## สารบัญ

1. [เตรียมเครื่อง](#1-เตรียมเครื่อง)
2. [Clone และติดตั้ง](#2-clone-และติดตั้ง)
3. [เตรียม Database](#3-เตรียม-database)
4. [ตั้งค่า Environment Variables](#4-ตั้งค่า-environment-variables)
5. [รัน Migration](#5-รัน-migration)
6. [รันโปรเจค](#6-รันโปรเจค)
7. [ทดสอบว่าทำงาน](#7-ทดสอบว่าทำงาน)
8. [ (ทางเลือก) ต่อ Webhook จริงเข้าเครื่อง](#8-ทางเลือก-ต่อ-webhook-จริงเข้าเครื่อง)
9. [แก้ปัญหาที่พบบ่อย](#9-แก้ปัญหาที่พบบ่อย)

---

## 1. เตรียมเครื่อง

ติดตั้งเครื่องมือเหล่านี้ก่อน:

| เครื่องมือ | เวอร์ชัน | ตรวจสอบด้วย |
|---|---|---|
| [Bun](https://bun.sh) | ≥ 1.3.0 | `bun --version` |
| Git | ล่าสุด | `git --version` |
| Docker Desktop *(ทางเลือก)* | ล่าสุด | `docker --version` |

**ติดตั้ง Bun:**
```bash
# macOS / Linux / WSL
curl -fsSL https://bun.sh/install | bash

# Windows (PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"
```

**สิ่งที่ต้องมีอย่างน้อยสำหรับรัน local:**
- ✅ AI provider key **อย่างน้อย 1 เจ้า** — OpenAI (`OPENAI_API_KEY`, default) หรือ Anthropic หรือ Gemini
- ✅ PostgreSQL (ใช้ Docker บนเครื่อง หรือ Supabase ฟรีก็ได้)
- ✅ GitHub OAuth App (สำหรับล็อกอินเข้า dashboard)

> 💡 ยังไม่ต้องมี Stripe / Slack / GitLab / Bitbucket / Trigger.dev ก็รัน local ได้ — ระบบจะข้ามส่วนที่ไม่ได้ตั้งค่าเอง

---

## 2. Clone และติดตั้ง

```bash
git clone <repo-url> ai-code-review-bot
cd ai-code-review-bot

# ติดตั้ง dependencies ทั้ง monorepo (ใช้เวลาสักครู่)
bun install
```

---

## 3. เตรียม Database

เลือก **วิธีใดวิธีหนึ่ง**

### วิธี A — PostgreSQL ด้วย Docker (แนะนำสำหรับ local)
```bash
# รันเฉพาะ postgres จาก docker-compose
docker compose up -d postgres

# connection string ที่จะใช้:
# postgresql://reviewbot:reviewbot_secret@localhost:5432/reviewbot
```

### วิธี B — Supabase (ฟรี, ไม่ต้องลง Docker)
1. สร้างโปรเจคที่ [supabase.com](https://supabase.com) (เลือก region Singapore)
2. ไปที่ **Project Settings → Database → Connection string → URI**
3. คัดลอก connection string มาใช้เป็น `DATABASE_URL`

---

## 4. ตั้งค่า Environment Variables

มีไฟล์ env 2 จุด — คัดลอกจากตัวอย่างทั้งคู่:

```bash
cp .env.example .env                          # ใช้โดย webhook / queue
cp .env.example apps/dashboard/.env.local     # ใช้โดย dashboard (Next.js)
```

### ค่าขั้นต่ำที่ต้องกรอก

**ใน `apps/dashboard/.env.local`:**
```bash
DATABASE_URL=postgresql://reviewbot:reviewbot_secret@localhost:5432/reviewbot
BETTER_AUTH_SECRET=<สุ่มด้วย: openssl rand -hex 32>
NEXT_PUBLIC_APP_URL=http://localhost:3000

# GitHub OAuth (สำหรับล็อกอิน — ดูวิธีสร้างด้านล่าง)
GITHUB_CLIENT_ID=<Client ID>
GITHUB_CLIENT_SECRET=<Client Secret>

# AI provider อย่างน้อย 1 เจ้า (default = OpenAI)
OPENAI_API_KEY=sk-...
# หรือใช้เจ้าอื่น:
# ANTHROPIC_API_KEY=sk-ant-...
# GEMINI_API_KEY=AI...

# สำหรับทดสอบ endpoint review ตรง ๆ (หัวข้อ 7)
REVIEW_API_KEY=<สุ่มสตริงอะไรก็ได้>
```

**ใน `.env` (root):** ใส่ `DATABASE_URL` และ AI key เดียวกัน (เผื่อรัน webhook/queue)

### สร้าง GitHub OAuth App (สำหรับล็อกอิน)
1. ไปที่ **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**
2. กรอก:
   - **Homepage URL:** `http://localhost:3000`
   - **Authorization callback URL:** `http://localhost:3000/api/auth/callback/github`
3. คัดลอก **Client ID** + สร้าง **Client Secret** มาใส่ใน `.env.local`

> ⚙️ ลำดับ AI provider ปรับได้ด้วย `AI_PROVIDER_ORDER` (default `openai,anthropic,gemini`) — ตั้งหลายเจ้าไว้ ระบบจะ fallback อัตโนมัติเมื่อเจ้าแรกโควตาเต็ม

---

## 5. รัน Migration

สร้างตารางทั้งหมดใน database:

```bash
bun run db:migrate
```

ตรวจสอบว่าตารางถูกสร้าง (เปิด GUI):
```bash
bun run db:studio     # เปิด Drizzle Studio ในเบราว์เซอร์
```

---

## 6. รันโปรเจค

### รันเฉพาะ Dashboard (เส้นทางเร็วสุด)
```bash
cd apps/dashboard && bun run dev
```
เปิด → **http://localhost:3000** แล้วกด **Sign In** เพื่อล็อกอินด้วย GitHub

### หรือรันทุก app พร้อมกัน
```bash
bun run dev
```
| App | URL |
|---|---|
| Dashboard | http://localhost:3000 |
| Webhook (Wrangler dev) | http://localhost:8787 |

---

## 7. ทดสอบว่าทำงาน

### 7.1 เช็คว่า AI provider พร้อมใช้งาน
```bash
curl http://localhost:3000/api/health/ai
```
ควรเห็น `"ok": true` และ `"activeProvider": "openai"` (หรือเจ้าที่ตั้งไว้)

### 7.2 ทดสอบ AI review โดยตรง (ไม่ต้องมี PR)
ส่ง diff เข้า endpoint `/api/review/diff` (ใช้ `REVIEW_API_KEY` ที่ตั้งไว้):

```bash
curl -X POST http://localhost:3000/api/review/diff \
  -H "Authorization: Bearer <REVIEW_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "diff": "diff --git a/x.ts b/x.ts\n@@ -0,0 +1 @@\n+const x: any = 1\n",
    "profile": "typescript",
    "language": "th"
  }'
```
ถ้าได้ JSON กลับมา (`score`, `summary`, `comments[]`, `tokensUsed`) = ระบบ AI ทำงานครบ ✅

### 7.3 ล็อกอิน dashboard
เข้า http://localhost:3000 → Sign In → ควรเข้าหน้า `/dashboard` ได้

---

## 8. (ทางเลือก) ต่อ Webhook จริงเข้าเครื่อง

ทำเมื่อต้องการทดสอบ flow เต็ม: เปิด PR จริง → bot คอมเมนต์

> ต้องมี **GitHub App** + **Trigger.dev** เพิ่ม (ดูวิธีสร้างใน [SETUP.md](SETUP.md))

```bash
# 1) รัน webhook + queue
cd apps/webhook && bunx wrangler dev          # terminal 1
cd packages/queue && bunx trigger.dev dev     # terminal 2

# 2) เปิด tunnel ให้ GitHub ยิงเข้าเครื่องได้
cloudflared tunnel --url http://localhost:8787
#   หรือ: ngrok http 8787
```
3. เอา URL จาก tunnel ไปตั้งใน GitHub App → **Webhook URL:** `<tunnel-url>/webhook/github`
4. ติดตั้ง App บน repo ทดสอบ แล้วเปิด/อัปเดต PR
5. ตรวจสอบ: terminal webhook เห็น `status: accepted` → Trigger.dev รัน task → มี inline comment บน PR

---

## 9. แก้ปัญหาที่พบบ่อย

| อาการ | สาเหตุ | วิธีแก้ |
|---|---|---|
| `bun install` ล้มเหลว | Bun เก่ากว่า 1.3.0 | `bun upgrade` |
| migration error | `DATABASE_URL` ผิด / postgres ไม่ขึ้น | เช็ค connection string / `docker compose up -d postgres` |
| ล็อกอิน GitHub ไม่ได้ | callback URL ไม่ตรง / ไม่ตั้ง `BETTER_AUTH_SECRET` | callback ต้องเป็น `http://localhost:3000/api/auth/callback/github` |
| `/api/health/ai` คืน `ok:false` | ไม่ได้ตั้ง AI key เลย | ใส่ `OPENAI_API_KEY` (หรือเจ้าอื่น) ใน `.env.local` |
| review endpoint คืน 401 | `REVIEW_API_KEY` ไม่ตรง | ใช้ค่าเดียวกับที่ตั้งใน `.env.local` |
| AI review error | key ผิด / โควตาเต็มทุกเจ้า | เช็ค `/api/health/ai` + ดู credit ของ provider |
| port 3000 ถูกใช้แล้ว | มีโปรเซสอื่นครองพอร์ต | ปิดโปรเซสนั้น หรือรันด้วยพอร์ตอื่น |
| dashboard ขึ้น error `@repo/ai not found` | ยังไม่ได้ `bun install` ที่ root | รัน `bun install` ที่โฟลเดอร์ราก |

### คำสั่งที่ใช้บ่อยตอน dev
```bash
bun run dev            # รันทุก app
bun run db:studio      # ดู/แก้ข้อมูลใน DB
bun run db:migrate     # รัน migration
bun run typecheck      # ตรวจ type
docker compose up -d postgres   # เปิด postgres
docker compose down             # ปิด stack
```

---

*เมื่อรัน local ได้แล้ว อ่าน [DEVELOPER-GUIDE.md](DEVELOPER-GUIDE.md) ต่อสำหรับการพัฒนาต่อยอดและ deploy*
