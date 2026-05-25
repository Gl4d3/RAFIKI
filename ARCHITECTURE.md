# RAFIKI Architecture

## System Overview
RAFIKI is a single Node.js service that serves the API and the React client. It ingests financial statements, runs an async analysis pipeline, stores results in PostgreSQL, and delivers insights via a web UI and a streaming chat endpoint.

**Core components**
- **Client:** React + Vite SPA with onboarding, dashboards, chat, and settings.
- **Server:** Express API with async analysis pipeline and SSE chat.
- **Database:** PostgreSQL accessed through Drizzle ORM.
- **AI:** Google Gemini for natural language generation and enrichment.

## Runtime Topology
- `server/index.ts` boots Express and mounts API routes.
- In development, Vite is attached to the same server; in production, static assets are served from `dist/public`.
- The server listens on `PORT` (default `5000`) and handles both API and client traffic.

## Frontend
Key pages (in `client/src/pages`):
- **StatementUpload** → upload statements or demo data.
- **SilentAnalysis** → polling UI for async analysis.
- **PriorityStackReview** → reveal message + stack preview.
- **GapFilling** → resolve unknown transactions.
- **PriorityStack** → edit and reorder obligations.
- **Home** → summary, stack, and health insights.
- **Chat** → streaming RAFIKI assistant.
- **Goals**, **Instructions**, **Activity**, **Annotation** → additional finance tools.

Data fetching is handled via TanStack Query, routing via Wouter, and UI via Tailwind + shadcn/ui.

## Backend Services
### API Layer
`server/routes.ts` defines the API surface. Major groups:
- **Onboarding:** `/api/onboarding/*` for upload, job polling, gap filling, and stack save.
- **User finance:** `/api/user/*` for home data, financial state, simulations, health score, nudges, and priority cascade.
- **Chat:** `/api/chat` (SSE streaming) plus conversation/message endpoints.
- **Goals, instructions, activity events, emergency brake** endpoints.

Uploads are handled with `multer` and bounded by size limits (10MB per file, 12 files, 60MB total per request).

### Analysis Pipeline
`server/analysis-pipeline.ts` runs asynchronously after upload:
1. **Stage A — Parse:** Dispatches to parsers for M-Pesa CSV/PDF, M-Pesa SMS, or bank PDFs. All amounts are normalized to KSh.
2. **Stage B — Deterministic enrichment:** Categorization, internal transfer tagging, recurring detection, and salary detection via `server/accountant.ts`.
3. **Stage B — AI enrichment:** Gemini tool calls refine categories, relationships, and gap flags. If Gemini is unavailable, the job pauses for a user choice (retry or basic mode).
4. **Stage C — Summary:** Builds the financial summary, priority stack, reveal message, and gap-filling questions, then persists the results.

Pipeline progress is tracked in `analysis_jobs`, and results drive the onboarding UI.

### AI Layer
`server/gemini.ts` and `server/chat.ts` define the LLM interactions:
- Gemini generates reveal messages, gap-filling questions, nudges, and chat responses.
- Numeric values are always computed by deterministic accountant tools before being surfaced.

## Data Model (PostgreSQL)
Defined in `shared/schema.ts`:
- **users** — profile, onboarding stage, safe buffer, scores.
- **transactions** — normalized statement data.
- **entities** — counterparty knowledge graph and categorization.
- **priority_stack_items** — ranked obligations.
- **analysis_jobs** — async pipeline state and summary payloads.
- **conversations/messages** — chat history.
- **goals**, **standing_instructions**, **activity_events** — finance tools and audit trail.

## Build & Delivery
- `npm run dev` runs `server/index.ts` via `tsx` with Vite middleware.
- `npm run build` runs `script/build.ts` to:
  - build the client with Vite into `dist/public`
  - bundle the server with esbuild into `dist/index.cjs`
- `npm run start` serves the production build from `dist`.
