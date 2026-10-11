# Health Copilot

An AI-powered personal health records app. Upload lab reports, prescriptions, diagnostic reports and discharge summaries. The app extracts the values exactly as written, checks each one against the source text, and lets you review and correct them before anything is saved. Confirmed values feed a dashboard, lab-trend charts, a chronological timeline and a grounded assistant. The interface and AI explanations are available in English, Hindi and Marathi.

> **This is a personal health information and organisation tool. It does not diagnose, prescribe, or replace a licensed clinician.**
> It is not HIPAA- or ABDM-certified. Use fictional or de-identified documents for development and demos.

---

## Architecture

```
frontend/  Next.js 16 (App Router) · TypeScript · Tailwind v4 · shadcn/ui · Recharts · SWR
backend/   FastAPI · Pydantic v2 · PyMuPDF · PaddleOCR 3 (PP-OCRv5 mobile) · Groq (openai/gpt-oss-20b)
supabase/  SQL migration: FHIR-aligned schema, RLS, private storage bucket
samples/   Fictional test documents + manually verified expected values
```

```
Browser ──(Supabase Auth: email/password)──▶ Supabase Auth
   │
   └──(Bearer access token)──▶ FastAPI ──▶ Supabase Postgres + private Storage (service role, always filtered by user_id)
                                  ├──▶ PyMuPDF (digital PDF text) / PaddleOCR (scans, photos)
                                  └──▶ Groq chat completions, strict JSON-schema output
```

### Processing pipeline
1. **Validate**: extension, declared MIME type, magic bytes, size ≤ 10 MB, ≤ 30 pages, rejects encrypted or corrupt files. SHA-256 de-duplication per user.
2. **Store**: private bucket `medical-documents/{user_id}/{doc_id}.ext`.
3. **Text**: native PDF text per page. A page with too little text is rendered at 200 dpi and OCR'd. Images go straight to OCR. The text is cached, so retries skip OCR.
4. **Extract**: Groq with a **strict JSON schema** (every field required, nulls for unknowns). The document text is fenced as untrusted data, and the prompt tells the model to ignore any instructions inside it.
5. **Validate (deterministic)**: Pydantic, then Python rules. Each item's `source_text` must appear in the document, and the value must appear in that snippet. The rules also catch numeric results with no unit, unparseable ranges, a printed H/L flag that contradicts the value, low OCR confidence, invalid or future dates, and duplicates. Results are recorded as `error` / `warning` / `info` issues.
6. **Summarise** (non-fatal): built from the validated structured data only, never the raw text. Range comparisons are computed in software, not by the AI.
7. **Review**: the user edits values beside the original document. The original AI output is immutable (`extractions.ai_output`), and edits go to `current_data`, flagged per item.
8. **Confirm**: blocked while any `error` remains. Each confirm deletes and re-inserts that document's records, so retries never duplicate.

Each processing run creates a new extraction **version**, so history is preserved.

---

## 1. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com) (the free tier works).
2. **SQL Editor → New query**: paste [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) and run it, then do the same with [`0002_onboarding.sql`](supabase/migrations/0002_onboarding.sql) (onboarding profile fields and structured timeline metadata).
   It creates all tables, RLS policies, the signup → profile trigger and the private `medical-documents` bucket.
   (With the Supabase CLI: `supabase link` then `supabase db push`.)
3. **Authentication → Providers → Email**: keep it enabled. For quick local testing you can turn off **Confirm email**. If you keep it on, add `http://localhost:3000` (and your Vercel URL) under **Authentication → URL Configuration → Redirect URLs**.
4. **Project Settings → API**: copy the **Project URL**, the **anon / publishable** key and the **service_role / secret** key.

## 2. Get a Groq API key

Create one at [console.groq.com/keys](https://console.groq.com/keys). The default model is `openai/gpt-oss-20b`, which supports strict structured outputs. Any model can be set through `GROQ_MODEL`.
Review Groq's data-retention terms before processing real patient data.

## 3. Run locally

**Requirements:** Python 3.12 (PaddlePaddle does not support 3.13+ yet) and Node 20+.

```bash
# Backend
cd backend
python3.12 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
cp .env.example .env          # fill SUPABASE_*, GROQ_API_KEY
.venv/bin/uvicorn app.main:app --reload --port 8000
```

```bash
# Frontend (second terminal)
cd frontend
npm install
cp .env.example .env.local    # fill NEXT_PUBLIC_SUPABASE_URL / ANON_KEY
npm run dev                   # http://localhost:3000
```

The first OCR call downloads the PP-OCRv5 mobile models (~20 MB) to `~/.paddlex`.
Check the configuration at `GET http://localhost:8000/api/v1/health`. It also appears under **Settings & Privacy → system status**.

### Try it end to end
```bash
backend/.venv/bin/python samples/generate_samples.py   # creates fictional PDFs + a scanned PNG
```
Register, then upload `samples/lab_report_2026-03.pdf`, review it and confirm. Next, upload `samples/lab_report_2026-08_scanned.png` (this one goes through OCR) and confirm it. Open **Lab Results → Haemoglobin** to see the trend. Fasting glucose shows two separate series (mg/dL vs mmol/L), because units are never merged. The March report also contains an embedded prompt-injection line, which extraction should ignore.

---

## Environment variables

### Backend (`backend/.env`) — secret, server only
| Variable | Default | Purpose |
|---|---|---|
| `SUPABASE_URL` | — | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | — | **Secret.** Server-side DB/storage access |
| `SUPABASE_ANON_KEY` | — | Used as `apikey` when validating user tokens |
| `GROQ_API_KEY` | — | **Secret.** AI extraction, summaries, assistant |
| `GROQ_MODEL` | `openai/gpt-oss-20b` | Any Groq chat model with JSON-schema support |
| `GROQ_BASE_URL` | `https://api.groq.com/openai/v1` | OpenAI-compatible endpoint |
| `GROQ_TIMEOUT_SECONDS` / `GROQ_MAX_RETRIES` | `60` / `2` | Retries with backoff on 429/5xx |
| `LLM_MAX_INPUT_CHARS` | `24000` | Longer documents are truncated and flagged |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated allowed origins |
| `STORAGE_BUCKET` | `medical-documents` | Private bucket name |
| `SIGNED_URL_TTL_SECONDS` | `120` | Lifetime of file view links |
| `MAX_UPLOAD_MB` / `MAX_PDF_PAGES` | `10` / `30` | Upload limits |
| `OCR_ENABLED` / `OCR_LANG` / `OCR_DPI` / `OCR_CPU_THREADS` | `true` / `en` / `200` / `2` | OCR settings |
| `RATE_LIMIT_*` | 10/10/20 per 60 s | Per-user upload / processing / chat limits |

### Frontend (`frontend/.env.local`) — public
| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon/publishable key (safe for browsers; RLS protects data) |
| `NEXT_PUBLIC_API_URL` | FastAPI base URL |

---

## API (v1)

All endpoints except `/health` require `Authorization: Bearer <supabase access token>`. Errors always look like this:
`{"error": {"code": "...", "message": "...", "details": ...}}`. List endpoints accept `limit` and `offset` and return `{items, total, limit, offset}`.
Interactive docs are at `http://localhost:8000/docs` (disabled when `APP_ENV=production`).

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/health` | Config/OCR status (no auth) |
| POST | `/api/v1/auth/signup` | Create an account without email verification (no auth; rate-limited per IP). The backend creates the user already confirmed via the Supabase admin API |
| POST | `/api/v1/documents` | Upload (multipart `file`, `?language=en\|hi\|mr`). 201 when new; 200 with `duplicate: true` if the file already exists |
| GET | `/api/v1/documents` | List (`status`, `doc_type`, `q`, pagination) |
| GET | `/api/v1/documents/{id}` | Metadata + processing status |
| DELETE | `/api/v1/documents/{id}` | Delete file + all derived records |
| GET | `/api/v1/documents/{id}/file` | Short-lived signed URL to the original |
| POST | `/api/v1/documents/{id}/process` | Start/retry processing (202; 409 if already running) |
| GET | `/api/v1/documents/{id}/extraction` | Current extraction, AI original, issues, derived range checks, summary |
| PATCH | `/api/v1/documents/{id}/extraction` | Save corrections (`{data: ExtractionData}`); re-validates |
| GET | `/api/v1/documents/{id}/extractions` | Version history |
| POST | `/api/v1/documents/{id}/confirm` | Confirm, then write observations/medications/conditions/timeline (422 if errors remain) |
| POST | `/api/v1/documents/{id}/summary` | (Re)generate summary in `{language}` |
| GET | `/api/v1/health-records` | `type=observations\|medications\|conditions`, `q`, `interpretation`, `category` |
| GET | `/api/v1/timeline` | `date_from`, `date_to`, `event_type`, `doc_type`, `category` |
| GET | `/api/v1/trends` | Tests with confirmed values; `?test=` returns series **grouped by unit** |
| GET | `/api/v1/dashboard` | Counts, recent documents, out-of-range findings, activity |
| GET/PATCH | `/api/v1/profile` | Health profile, preferred language, age/height/weight, onboarding status |
| POST | `/api/v1/profile/mock-abha` | Generate a clearly fake `DEMO-91-…` ID |
| GET | `/api/v1/fhir/bundle` | FHIR R4-shaped export of confirmed records |
| POST | `/api/v1/assistant/chat` | Grounded Q&A with citations |
| GET | `/api/v1/assistant/conversations` · `/{id}/messages` | Chat history |
| DELETE | `/api/v1/assistant/conversations/{id}` | Delete a conversation |

---

## Tests and evaluation

```bash
cd backend
.venv/bin/python -m pytest -q                       # 63 unit tests
.venv/bin/python -m scripts.eval_extraction ../samples
```

The unit tests cover value and range parsing, unit normalisation (glucose mg/dL ≠ mmol/L), name aliases, provenance checks, fabricated-value detection, date rules, strict-schema compatibility, correction tracking, upload validation (spoofed extensions, corrupt and oversized files), authentication on every protected route, cross-user access (returns 404, not 403), rate limiting and the error shape.
`eval_extraction` always measures text extraction (method and OCR confidence). With `GROQ_API_KEY` set, it also scores recall, value accuracy, extra items, medications, document type and date against `samples/expected.json`.

```bash
cd frontend && npx tsc --noEmit && npm run lint && npm run build
```

---

## Deployment

### Frontend → Vercel
Import the repo and set **Root Directory = `frontend`**. Add the three `NEXT_PUBLIC_*` variables, with `NEXT_PUBLIC_API_URL` set to your backend URL. Add the Vercel URL to Supabase redirect URLs and to the backend's `CORS_ORIGINS`.

### Backend → Docker (PaddleOCR included)
Measured peak memory for OCR on a dense page is **~1.7 GB**, so choose a host with **≥ 2 GB RAM**.

- **Render**: *New → Blueprint* on this repo uses [`render.yaml`](render.yaml), a Docker service on the `standard` plan (2 GB). Fill in the secret env vars in the dashboard. The free 512 MB plan will run out of memory during OCR.
- **Hugging Face Spaces** (Docker Spaces currently require a paid PRO plan): create a *Docker* Space, push the contents of `backend/`, and add the env vars as Space *secrets*. The image listens on port `7860`, the Spaces default. Set the README front-matter to `sdk: docker` and `app_port: 7860`.
- **Your own VM** (full OCR, any Docker host with ≥ 2 GB RAM): see [DEPLOY_VM.md](DEPLOY_VM.md). Docker Compose + Cloudflare Tunnel for HTTPS, updated with `./deploy.sh`.
- Anything else that runs Docker: `docker build -t health-copilot-api backend && docker run -p 8000:7860 --env-file backend/.env health-copilot-api`.

OCR models are downloaded at image build time, so cold starts don't fetch them.
If you must use a small instance, set `OCR_ENABLED=false`. Digital PDFs still work, and scans fail with a clear "OCR unavailable" message.

---

## Security and safety notes

- The Groq key and Supabase service-role key exist **only** on the backend. The browser receives only public values.
- Every query filters by the authenticated `user_id`. Unknown or foreign IDs return 404. RLS is enabled on all tables as a second layer.
- Files sit in a private bucket and are viewed through signed URLs that expire in 120 s. Uploads are checked by magic bytes, not just by extension.
- Logs and the `audit_logs` table hold metadata only, never document text, values or keys. `httpx` logging is silenced to avoid leaking URLs.
- The AI never decides range status. Software compares the value with the range printed on the same report, and comparator values (`<0.5`) and unparseable ranges stay **unverified**.
- Trends never convert or merge units. Reference ranges come from each report, and no change is labelled as better or worse.
- The assistant sees only the user's own **confirmed** records. Any citation that doesn't map to a retrieved record is dropped, and the answer is marked "insufficient information" when there is no support.
- Rate limits are in-memory, which is fine for a single instance. Use Redis for horizontal scaling.

## Known limitations
- Processing runs in-process (FastAPI background tasks). If the server restarts mid-run, the document can be retried after 10 minutes. For production scale, move processing to a job queue (RQ/Celery/Cloud Tasks).
- OCR is English-only by default (`OCR_LANG`). Handwritten prescriptions are often unreadable, and the app says so through low-confidence flags instead of guessing.
- The ABHA ID is a **mock** for demonstration, and the FHIR export is *FHIR-aligned*, not validated against official profiles.
