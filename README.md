# Madad Desk (مدد ڈیسک)

> **Technology that understands people — ٹیکنالوجی جو انسانوں کو سمجھے**

**Madad Desk** is a full-stack, bilingual (**Urdu / English**), offline-first public service and relief platform engineered for low-literacy accessibility, asymmetric cost-sensitive eligibility routing, anti-scam protection, cryptographic case verification, and transparent human-in-the-loop governance.

Designed as an **Installable Progressive Web App (PWA)** backed by **Express**, **PostgreSQL (Drizzle ORM)**, and server-side **Google Gemini AI**, Madad Desk bridges the gap between vulnerable households, community facilitators, department case officers, administrators, and independent auditors.

> **Prototype & Ethics Disclosure**: This repository uses **synthetic Pakistani citizen records** and **explicitly labeled mock adapters** for identity lookup (NADRA-style registry), payment disbursement (Raast-style), and sandbox webhook receivers. It is a demonstration platform and is **not** an official government portal.

---
**DEMO**
https://madad-desk-929893404656.asia-southeast1.run.app

## Core Design Principles

1. **No Automatic Rejections**: Because wrongly approving an ineligible claim costs `10x` more than delaying a valid claim (`costWrong / (costWrong + costSlow) ≈ 90.9%`), uncertain cases never auto-reject—they transparently route to **Proof Upload** or **Officer Human Review**.
2. **Voice-First Bilingual Accessibility (Urdu + English)**: Built-in Urdu/English Speech-to-Text, Gemini Neural TTS audio playback, and **Voice-to-Form Auto-Fill** enable citizens with low literacy to complete relief applications naturally by speaking.
3. **Consent Before Everything**: Four granular consent scopes (`helper_access`, `department_review`, `document_access`, `payment_disbursement`) are enforced server-side on every read, submission, upload, and payout—withdrawal triggers immediate `HTTP 403` enforcement and an immutable audit entry.
4. **Offline-First Resilience**: Weak-connectivity submissions queue safely in **IndexedDB** with client-generated **idempotency keys** and automatically replay when connectivity returns.

---

## Key Features & Architecture Highlights

| Capability | How It Works |
| :--- | :--- |
| **Voice-to-Form Auto-Fill** | Citizens speak in Urdu or English; Gemini transcribes (`gemini-3.5-transcribe`) and extracts structured applicant fields (name, CNIC, age, income, district, household details) directly into the relief form with confidence flags (`POST /api/ai/voice/fill-form`). |
| **Autonomous Multi-Tool Triage Agent** | An agentic Gemini tool-calling loop (`POST /api/ai/agent/triage/:id`) invokes 4 live backend tools: `lookup_mock_identity`, `check_household_duplicates`, `query_policy_manual`, and `evaluate_eligibility_rule`, recording full step-by-step tool traces in `agent_runs`. |
| **Policy Handbook RAG with Citations** | Bilingual Urdu/English policy manuals stored in `policy_documents` with `gemini-embedding-2` vector embeddings + lexical fallback so citizens and officers can ask policy questions and receive cited clause references (`POL-8171-*`). |
| **Asymmetric Cost Eligibility & Digital Twin** | Deterministic rule engine evaluates normalized Pakistani transliteration variants (*Muhammad / Mohammad / Muhammed*) and lets Admins simulate draft rule versions against historical cases without altering live decisions. |
| **Anti-Scam Classifier & Regional Map** | Hybrid deterministic signal scanner + Gemini multimodal inspection analyzes suspicious SMS messages and payment screenshots (`High / Medium / Low / Uncertain`) and plots district-level scam hotspots. |
| **Cryptographic QR Case Slips & Scanner** | Issued case slips embed an **HMAC-SHA256** signed `MADAD-QR:v1:...` token verifiable via camera/image upload (`jsqr`) or pasted payload (`POST /api/applications/verify-qr`) to prevent counterfeit relief slips. |
| **AI Evaluation & Override Calibration** | Tracks model latency, fallback rates, cost estimates (`ai_telemetry`), human-vs-AI agreement, rule calibration drift, and district/household anomaly flags (`GET /api/admin/evaluation`). |
| **SSRF-Protected Outbound Webhooks & Gateways** | Admins can register signed `HMAC-SHA256` outbound webhooks (with private-IP SSRF guards + sandbox mode) and test real SMS/Email gateway adapters (Twilio, Webhook SMS, Resend/SMTP). |

---

## System Architecture

```text
+-----------------------------------------------------------------------+
|                React 19 + Tailwind CSS v4 + Vite PWA                  |
|  - Bilingual RTL/LTR UI (Urdu / English) & Voice Assistant            |
|  - 5 Role Portals: Citizen | Helper | Officer | Admin | Auditor       |
|  - IndexedDB Offline Outbox + Idempotency Keys + QR Camera/File Scan  |
+-----------------------------------+-----------------------------------+
                                    | HTTPS / Bearer Token / API Key
                                    v
+-----------------------------------------------------------------------+
|                     Express REST API (server.ts)                      |
|  - RBAC Middleware + Immediate Consent Gate (403 on withdrawal)       |
|  - Zod Validation + Rate Limiting + Signed Document Tokens            |
|  - SSRF-Safe Outbound HMAC Webhooks & Real/Mock Gateway Adapters      |
+-----------------+---------------------------------+-------------------+
                  |                                 |
                  v                                 v
+-----------------------------------+   +-------------------------------+
|  PostgreSQL + Drizzle ORM (24     |   |   Server-Side @google/genai   |
|  normalized tables)               |   |   - gemini-4-hydrogen (+      |
|  - Citizens, Applications, Rules  |   |     gemini-3.1-flash-lite)    |
|  - Agent Runs, Policy RAG Vectors |   |   - gemini-3.5-transcribe     |
|  - Consents, Audit Logs, Webhooks |   |   - gemini-3.8-flash-lite-tts |
+-----------------------------------+   |   - gemini-embedding-2        |
                                        +-------------------------------+
```

---

## Decision Routing Flow

```text
  Application Submitted
           |
           v
  [Normalize Urdu/English Transliteration + Mock Registry Lookup]
           |
           v
  [Compute Confidence & Asymmetric Threshold: costWrong / (costWrong + costSlow)]
           |
           +---> Confidence >= autoThreshold & Eligible ---> [Auto-Approved + QR Slip]
           |
           +---> Confidence >= askBelow (< autoThreshold) --> [Needs Proof Upload]
           |
           +---> Confidence < askBelow / Conflict ----------> [Human Officer Queue]
                                                               (Never Auto-Rejected)
```

---

## Five Role-Based Portals

1. **Citizen Portal (`citizen`)**: Bilingual Urdu/English relief intake, Voice-to-Form Auto-Fill, private document upload (`private_uploads/`), Decision Slip with Confidence Gauge & QR Code, AI Decision Room, Scam Message & Screenshot Checker + Regional Map, Policy RAG Explorer, and My Data & Consent Center.
2. **Community Helper Portal (`helper`)**: Shared-device facilitator workspace for assisting multiple families; server enforces both `helper_assignments` and active `helper_access` consent on every read, submission, and upload.
3. **Department Officer Portal (`officer`)**: Priority-sorted review queue (lowest confidence / highest urgency first), OCR document inspection, Autonomous Triage Agent runner, QR Slip Verifier, and decision console (`Approve`, `Request Evidence`, `Escalate`, `Reject` with mandatory written justification).
4. **Administrator Portal (`admin`)**: Live analytics (Recharts), Versioned Eligibility Rule Editor, Digital Twin Policy Simulator, AI Evaluation & Override Calibration Dashboard, User Role Management, Public REST API Keys (`/api/openapi.json`), Outbound Webhooks manager, and Mock Service Monitor.
5. **Independent Auditor Portal (`auditor`)**: Strictly read-only immutable audit timeline with security-event highlighting, AI decision traces, consent withdrawal logs, and one-click CSV export.

---

## Real vs. Simulated Integrations

| Component | Implementation | Status |
| :--- | :--- | :--- |
| **PostgreSQL Database** | PostgreSQL + Drizzle ORM (`24` normalized tables in `src/db/schema.ts`) | **Real** |
| **Authentication & RBAC** | Firebase Sign-In + `scrypt` / HMAC-SHA256 Bearer tokens + API Keys | **Real** |
| **Eligibility & Routing Engine** | Deterministic policy engine (`src/lib/eligibility.ts`) + versioned rules | **Real** |
| **Gemini AI Services** | Server-side `@google/genai` (reasoning, tool-calling agent, embeddings, OCR, TTS, STT) | **Real** |
| **Document Storage & QR Slips** | Private filesystem storage + signed download tokens + HMAC-SHA256 `MADAD-QR:v1` verification | **Real** |
| **Offline Queue & PWA** | IndexedDB outbox + idempotency keys + `vite-plugin-pwa` Service Worker | **Real** |
| **Audit Ledger & Consent** | Server-enforced immediate consent withdrawal + immutable audit trail + CSV export | **Real** |
| **Identity Registry (NADRA-style)** | `mock_registry_records` PostgreSQL table (`server/services/mockAdapters.ts`) | **Simulated (Mock)** |
| **Payment Disbursement (Raast-style)** | Simulated payout adapter gated by `payment_disbursement` consent | **Simulated (Mock)** |
| **SMS / Email Gateways** | Real adapters for Twilio, Webhook SMS, and Resend/SMTP; falls back cleanly to `unavailable` + in-app alerts when unconfigured | **Conditional / Sandbox** |

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Lucide Icons, Recharts, Motion, `qrcode`, `jsqr`, `vite-plugin-pwa`
- **Backend**: Node.js, Express 4, Zod, Multer, `tsx`
- **Database**: PostgreSQL (`pg`) + Drizzle ORM (`drizzle-orm`, `drizzle-kit`)
- **AI & Voice**: `@google/genai` + Web Speech API fallback + Gemini Neural TTS / STT
- **Testing & Quality**: Vitest (`tests/core.test.ts`), TypeScript (`tsc --noEmit`)

---

## Project Structure

```text
madad-desk/
├── index.html                    # HTML entry point, RTL/LTR font setup & PWA metadata
├── metadata.json                 # App manifest & capabilities metadata
├── package.json                  # Scripts & dependencies
├── server.ts                     # Unified Express + Vite dev/prod server entrypoint
├── vite.config.ts                # Vite + Tailwind v4 + VitePWA service worker config
├── .env.example                  # Environment variable template (never commit .env)
├── server/
│   ├── middleware/               # Auth, RBAC, rate limiting, and audit helpers
│   ├── routes/api.ts             # REST API endpoints (/api/*) & OpenAPI spec
│   └── services/
│       ├── ai.ts                 # Gemini RAG, Voice-to-Form, Multi-Tool Agent, TTS/STT
│       └── mockAdapters.ts       # Synthetic registry/payout mocks + SMS/Email adapters
├── src/
│   ├── App.tsx                   # Top-level app shell, bilingual toggle, portal routing
│   ├── components/
│   │   ├── AuthGate.tsx          # Sign-in + 5 clearly labeled Demonstration Accounts
│   │   ├── DecisionRoomModal.tsx # Bilingual AI explanation & rule trace inspector
│   │   ├── PolicyRagExplorer.tsx # Interactive Policy Handbook Q&A with citations
│   │   ├── QrSlipModal.tsx       # Cryptographic QR slip generator & camera/file scanner
│   │   ├── VoiceAssistant.tsx    # Bilingual Urdu/English voice assistant & auto-fill
│   │   └── portals/              # Citizen, Helper, Officer, Admin, Auditor portals
│   ├── db/
│   │   ├── index.ts              # PostgreSQL pool & Drizzle connection
│   │   ├── schema.ts             # 24-table relational schema
│   │   └── seed.ts               # Idempotent synthetic Pakistani demo seed data
│   └── lib/
│       ├── crypto.ts             # CNIC hashing, AES-256-GCM encryption, HMAC QR signing
│       ├── eligibility.ts        # Cost-weighted eligibility & transliteration engine
│       ├── i18n.ts               # English + Urdu dictionary & RTL helpers
│       ├── offlineQueue.ts       # IndexedDB offline application queue & sync
│       └── scamDeterministic.ts  # Deterministic anti-phishing heuristic scanner
└── tests/
    └── core.test.ts              # Unit & security tests (eligibility, scam, crypto, QR)
```

---

## Quick Start

### 1. Prerequisites

- **Node.js** `20+` (tested on Node `22`)
- **PostgreSQL** `14+` (or Google Cloud SQL PostgreSQL)
- **Gemini API Key** from Google AI Studio (`GEMINI_API_KEY`)

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Required variables:

| Variable | Purpose |
| :--- | :--- |
| `GEMINI_API_KEY` | Server-side `@google/genai` calls (Voice-to-Form, RAG, Agent, Scam Check, OCR, TTS/STT) |
| `SQL_HOST` | PostgreSQL host (or Cloud SQL Unix socket / IP) |
| `SQL_DB_NAME` | PostgreSQL database name |
| `SQL_USER` / `SQL_PASSWORD` | Application database credentials |
| `SQL_ADMIN_USER` / `SQL_ADMIN_PASSWORD` | Optional migration/admin credentials |

Optional variables:

| Variable | Purpose |
| :--- | :--- |
| `DATA_ENCRYPTION_KEY` | 32-byte key for AES-256-GCM CNIC encryption at rest |
| `APP_URL` | Hosted public origin URL |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | Live SMS alerts via Twilio |
| `SMS_WEBHOOK_URL` | Custom HTTP SMS relay endpoint |
| `RESEND_API_KEY`, `EMAIL_FROM`, `SMTP_HOST` | Live outbound email notifications |

### 3. Install, Verify & Run

```bash
# Install dependencies
npm install

# Run unit & cryptographic verification tests
npm test

# Run TypeScript type checks
npm run lint

# Start development server (Express API + Vite SPA on http://localhost:3000)
npm run dev
```

### 4. Production Build & Mobile PWA

```bash
# Build frontend + Service Worker bundle into dist/
npm run build

# Start production Express server serving dist/ and /api/*
npm start
```

Because **Madad Desk** ships with a full Web App Manifest and Workbox Service Worker (`vite-plugin-pwa`), opening the hosted HTTPS URL on **Android Chrome** or **iOS Safari** lets users tap **"Install App" / "Add to Home Screen"** to run it full-screen offline.

---

## Demonstration Accounts (Synthetic Data Only)

The Sign-In screen provides one-click **Demonstration Accounts** backed by `POST /api/auth/demo-login`, issuing real server-verified Bearer tokens in PostgreSQL:

| Role | Demo Email | Portal Capabilities |
| :--- | :--- | :--- |
| **Citizen** | `citizen.demo@madaddesk.pk` | Relief intake, Voice Auto-Fill, Scam Check, QR Slip, Consent Center |
| **Community Helper** | `helper.demo@madaddesk.pk` | Multi-family intake gated by live `helper_access` consent |
| **Department Officer** | `officer.demo@madaddesk.pk` | Review queue, Triage Agent, QR Verifier, Decision Console |
| **Administrator** | `admin.demo@madaddesk.pk` | Rule Editor, Digital Twin, AI Evaluation, Webhooks, API Keys |
| **Independent Auditor** | `auditor.demo@madaddesk.pk` | Read-only audit ledger, consent logs, and CSV export |

> All seeded demonstration cases (`C-097` through `C-101`), CNICs, and phone numbers are synthetic and safe for public demos.

---

## Key API Endpoints

Full OpenAPI specification is served dynamically at `GET /api/openapi.json`.

- **Auth & Profile**: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/demo-login`, `GET /api/auth/me`
- **Applications & Documents**: `GET/POST /api/applications`, `POST /api/applications/:id/submit`, `POST /api/applications/:id/documents`, `GET /api/documents/:id/file`
- **QR Verification**: `GET /api/applications/:id/slip-qr`, `POST /api/applications/verify-qr`
- **Consent Center**: `GET /api/consents`, `POST /api/consents`, `DELETE /api/consents/:scope`
- **Officer Review**: `GET /api/review-queue`, `POST /api/applications/:id/review`
- **AI, Voice & RAG**: `POST /api/ai/assistant`, `POST /api/ai/scam-check`, `POST /api/ai/voice/transcribe`, `POST /api/ai/voice/tts`, `POST /api/ai/voice/fill-form`, `POST /api/ai/agent/triage/:id`, `GET/POST /api/policy/docs`, `POST /api/policy/ask`
- **Admin, Eval & Webhooks**: `GET /api/admin/analytics`, `GET /api/admin/evaluation`, `GET/POST /api/admin/rules`, `POST /api/admin/rules/simulate`, `GET/POST/DELETE /api/admin/webhooks`, `POST /api/admin/webhooks/:id/test`
- **Audit**: `GET /api/audit`, `GET /api/audit/export`

---

## License

Apache-2.0 — Built for civic accessibility, transparency, and human-centered relief delivery.
