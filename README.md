# ReachInbox Hiring Assignment

A full-stack email scheduling platform built around Google OAuth, PostgreSQL/Prisma, Redis/BullMQ, Ethereal SMTP, Elasticsearch, Bull Board, and optional Slack OAuth notifications.

## Architecture

```text
React + TypeScript (Vite)
        │ httpOnly JWT cookie / REST
        ▼
Node + Express + TypeScript
 ├── Google OAuth ───────────────► Google
 ├── Slack OAuth / notifications ► Slack
 ├── Prisma ─────────────────────► PostgreSQL
 ├── Scheduler ── atomic Lua ────► Redis
 │                    │
 │                    └──────────► BullMQ delayed jobs
 │                                      │
 │                                      ▼
 │                                Email Worker
 │                                      │
 │                                      ▼
 │                                Ethereal SMTP
 │
 ├── Email lifecycle ────────────► Elasticsearch
 └── Bull Board (/admin/queues) ──► BullMQ
```

## Tech stack

- Frontend: React, TypeScript, Vite, React Router, Axios, CSS
- Backend: Node.js, Express, TypeScript, Zod, Helmet, CORS
- Auth: Google OAuth + JWT in an httpOnly cookie
- Database: PostgreSQL + Prisma
- Queue/rate limiting: BullMQ + Redis + atomic Lua reservation
- Email: Nodemailer + sender-specific Ethereal SMTP credentials
- Search: Elasticsearch
- Queue UI: Bull Board
- Notifications: Slack OAuth + webhook/chat notifications

## Repository structure

```text
backend/
  prisma/
  src/
    config/
    lib/
    middleware/
    routes/
    services/
    workers/
    app.ts
    server.ts
frontend/
  src/
    components/
    pages/
    services/
    types/
docker-compose.yml
```

## Prerequisites

- Node.js 22+
- Docker Desktop with Compose
- Google OAuth credentials configured for `http://localhost:5173` and callback `http://localhost:5000/api/auth/google/callback`
- Ethereal SMTP credentials
- Slack app credentials if Slack notifications are required

## Infrastructure

Start PostgreSQL, Redis, and Elasticsearch:

```bash
docker compose up -d
```

Services:

- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379` (AOF enabled)
- Elasticsearch: `localhost:9200`

The application does not replace these services with in-memory implementations.

## Environment variables

Copy `backend/.env.example` to `backend/.env` and fill in the secrets. Never commit `.env`.

### Required

`DATABASE_URL`, `REDIS_URL`, `PORT`, `FRONTEND_URL`, `ETHEREAL_HOST`, `ETHEREAL_PORT`, `ETHEREAL_USER`, `ETHEREAL_PASSWORD`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, `JWT_SECRET`.

### Scheduler

- `WORKER_CONCURRENCY` — worker concurrency; default 5.
- `DEFAULT_MIN_DELAY_MS` — minimum inter-email delay; default 1000 ms.
- `DEFAULT_HOURLY_LIMIT` — UI/default policy value; default 100.
- `PROCESSING_STALE_MS` — crash-recovery threshold; default 15 minutes.

### Elasticsearch

- `ELASTICSEARCH_URL` — default `http://localhost:9200`.
- `ELASTICSEARCH_INDEX` — default `reachinbox-emails`.

### Slack

- `SLACK_CLIENT_ID`
- `SLACK_CLIENT_SECRET`
- `SLACK_REDIRECT_URI` — normally `http://localhost:5000/api/slack/callback`.

Enable the Slack scopes/features needed by the app and configure the exact redirect URI in the Slack app.

## Database setup

```bash
cd backend
npm install
npx prisma validate
npx prisma generate
npx prisma migrate dev
```

The repository already contains the initial migration. Do not replace PostgreSQL with SQLite.

## Run locally

Backend API:

```bash
cd backend
npm run start
```

Worker (separate terminal):

```bash
cd backend
npm run worker
```

Frontend (separate terminal):

```bash
cd frontend
npm install
npm run dev
```

Frontend: `http://localhost:5173`

API health check: `http://localhost:5000/health`

Bull Board: `http://localhost:5000/admin/queues` after signing in. The dashboard is backed by the real BullMQ queue and is protected by the normal authentication middleware.

## Authentication

1. React sends the browser to `/api/auth/google`.
2. Google authenticates the user.
3. The callback exchanges and verifies the Google ID token.
4. PostgreSQL user data is upserted.
5. The backend signs a seven-day JWT and stores it in an httpOnly cookie.
6. `/api/auth/me` identifies the authenticated user from that cookie.

No token is stored in localStorage, and campaign/sender authorization uses the authenticated backend user ID rather than a client-supplied user ID.

## API endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/auth/google` | Start Google OAuth |
| GET | `/api/auth/google/callback` | OAuth callback |
| GET | `/api/auth/me` | Current user |
| POST | `/api/auth/logout` | Clear auth cookie |
| GET | `/api/senders` | List active senders |
| POST | `/api/senders` | Create a sender |
| POST | `/api/campaigns` | Schedule a campaign |
| GET | `/api/emails/scheduled` | Paginated scheduled/processing emails |
| GET | `/api/emails/sent` | Paginated sent/failed emails |
| GET | `/api/emails/search?q=` | Elasticsearch-backed search |
| GET | `/api/slack/connect` | Start Slack OAuth |
| GET | `/api/slack/callback` | Slack OAuth callback |
| GET | `/api/slack/status` | Slack connection status |
| POST | `/api/slack/disconnect` | Disconnect Slack |
| GET | `/admin/queues` | Bull Board |

Successful API responses use `{ "success": true, "data": ... }`. Errors use `{ "success": false, "error": "..." }`.

## Scheduling behavior

The browser uploads a CSV/TXT file and extracts email addresses before submission. Addresses are trimmed, normalized to lowercase, deduplicated, and validated again by the backend.

A campaign creates one PostgreSQL `Email` row per recipient and one BullMQ delayed job per email. Job IDs and idempotency keys are deterministic and unique per campaign/email.

### Minimum delay

The backend enforces `DEFAULT_MIN_DELAY_MS`. For example, with a 2,000 ms delay:

```text
email 1 = start
email 2 = start + 2,000 ms
email 3 = start + 4,000 ms
```

Negative delays are rejected. The scheduler never uses cron, node-cron, OS cron, or `setInterval`.

### Hourly rate limiting

Reservations are made with an atomic Redis Lua script keyed by sender and fixed one-hour windows. This avoids an in-memory counter and remains safe when multiple worker/backend processes schedule campaigns concurrently.

When a sender's hourly window is full, the next email is assigned to the next available window rather than dropped or permanently failed. The reservation cursor preserves campaign ordering as far as the sender's shared schedule permits.

A campaign that causes a rate-limit window to fill emits a Slack notification when the user has a Slack connection.

### Multi-worker safety

BullMQ controls job delivery. The worker atomically changes an email from `SCHEDULED` to `PROCESSING`; only the worker that successfully performs that transition may send. A job delivered again after the email has already entered `PROCESSING`, `SENT`, or `FAILED` is skipped.

The worker uses configurable concurrency through `WORKER_CONCURRENCY` and does not create one Redis connection per email.

## Email sending and idempotency

Every sender has its own SMTP host, port, username, and password. API responses deliberately exclude the SMTP password.

The worker uses a deterministic SMTP `Message-ID` based on the email record ID, plus the unique BullMQ job ID and database idempotency key.

There is an unavoidable external side-effect window: if SMTP accepts a message but the process crashes before PostgreSQL records `SENT`, a later recovery cannot mathematically prove whether the provider delivered it. The design therefore provides strong practical idempotency and explicitly avoids claiming exactly-once SMTP delivery.

## Restart persistence and recovery

PostgreSQL stores campaign/email state and Redis AOF persists queue/rate-limit data. On API/worker startup, recovery:

1. Finds stale `PROCESSING` emails and returns them to `SCHEDULED` after `PROCESSING_STALE_MS`.
2. Finds all `SCHEDULED` emails.
3. Checks BullMQ by deterministic job ID.
4. Recreates only missing delayed jobs.
5. Never resets `SENT` emails and never intentionally sends them again.

The recovery assumption is that a `PROCESSING` email older than the configured stale threshold was interrupted before a successful durable completion. The SMTP side-effect caveat above still applies.

## Elasticsearch

The `reachinbox-emails` index is created automatically when the API starts if it does not exist. Email documents are indexed when scheduled and updated when sent/failed. Search is user-scoped and supports recipient, subject, status, and campaign-related fields.

If Elasticsearch is temporarily unavailable, the API logs the failure and the main application remains alive. Search returns a temporary-unavailable response instead of falling back to PostgreSQL LIKE queries.

## Slack behavior

Slack uses a real OAuth authorization flow with a signed, expiring state token bound to the authenticated user. The connection is stored in PostgreSQL. If Slack is disconnected, email scheduling continues normally.

Rate-limit notifications are emitted from the actual Redis reservation event. Future events use the current stored Slack connection, so connecting Slack after a campaign has been scheduled still enables notifications for later scheduling events.

## Load behavior

The scheduler can create 1,000+ PostgreSQL email records and BullMQ delayed jobs without opening one database/Redis connection per email. BullMQ and the database persist the work. The Redis reservation script handles sender-level concurrency atomically.

For a demo, use a small recipient file and a low hourly limit such as `2` to observe rescheduling. Do not send 1,000 real emails.

## Frontend UX

The dashboard includes:

- Google login and authenticated user header
- Scheduled and Sent tabs
- Compose campaign modal
- CSV/TXT lead parsing
- duplicate removal and email detection count
- sender selection and sender creation
- start time, minimum delay, and hourly limit controls
- debounced Elasticsearch search
- loading/empty/error/success states
- Slack connect/disconnect status
- responsive SaaS-style layout
- avatar fallback when Google's avatar URL fails

## Verification checklist

```bash
# Backend
cd backend
npx prisma validate
npx prisma generate
npx tsc --noEmit

# Frontend
cd ../frontend
npm run build
```

Then run API + worker + frontend and verify:

- `/health`
- Google login and `/api/auth/me`
- sender creation
- campaign creation
- delayed BullMQ jobs
- worker processing
- Ethereal SMTP delivery
- `SENT` / `FAILED` transitions
- Elasticsearch indexing/search
- Bull Board
- restart API/worker and confirm pending jobs recover
- hourly limit test with limit `2`
- Slack OAuth and rate-limit notification when credentials are configured

## Demo flow

1. Start Docker Compose.
2. Configure `backend/.env`.
3. Run migrations/generate Prisma client.
4. Start API and worker.
5. Open the frontend and sign in with Google.
6. Add/select an Ethereal sender.
7. Upload a small CSV/TXT lead list.
8. Choose a future start time, e.g. one minute ahead, a delay of at least 1000 ms, and hourly limit `2`.
9. Schedule the campaign.
10. Inspect Scheduled Emails, Bull Board, then Sent Emails.
11. Use Elasticsearch search from the dashboard.
12. Optionally connect Slack and repeat a rate-limit scenario.

## Assumptions, trade-offs, and limitations

- Hourly limiting uses fixed one-hour windows aligned to epoch hours. This is deterministic and atomic; it is not a sliding-window implementation.
- The sender schedule cursor is shared across campaigns for the same sender, so concurrent campaigns cannot reserve overlapping sender slots.
- Redis reservations are made before PostgreSQL campaign creation. A process failure between those operations can leave conservative unused Redis reservations; PostgreSQL/BullMQ state remains authoritative for actual jobs.
- A process failure after SMTP acceptance and before the database `SENT` update is the fundamental remaining duplicate-delivery risk with a non-transactional external SMTP provider.
- Slack OAuth requires the Slack app's redirect URI and credentials to be configured. Without them, the rest of the scheduler remains usable.
- Elasticsearch outages do not crash the API, but search is temporarily unavailable until Elasticsearch recovers.

## Demo video link:

https://drive.google.com/file/d/18gIpxlAsrSI9WT3ZWGN3hXLEDg8B-5Dg/view?usp=sharing
