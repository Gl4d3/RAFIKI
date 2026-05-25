# RAFIKI — AI Personal Finance Companion (Phase 1)

## Overview
RAFIKI is a mobile-first personal finance web app for Kenya that analyzes M-Pesa and bank statements, builds a financial model, and guides users through a priority stack of obligations. It blends deterministic accounting with Gemini-powered language to deliver insights and coaching grounded in real transaction data.

## Key Capabilities
- Upload M-Pesa CSV/PDF statements, paste M-Pesa SMS text, or add bank statement PDFs.
- Async analysis pipeline with deterministic categorization and AI enrichment.
- Priority stack review, gap-filling for unknown entities, and home dashboard.
- Streaming chat with accountant-backed numeric guardrails.
- Goals, standing instructions, activity feed, and emergency brake controls.

## Architecture
See [ARCHITECTURE.md](ARCHITECTURE.md) for a detailed system view and data flow.

## Tech Stack
- **Frontend:** React 18, Vite, TypeScript, Tailwind CSS, shadcn/ui
- **Backend:** Express 5, TypeScript
- **Database:** PostgreSQL via Drizzle ORM
- **AI:** Google Gemini (LLM for language, not math)

## Project Structure
```
client/         # React app (pages, components, app state)
server/         # Express API, analysis pipeline, parsers, AI layer
shared/         # Drizzle schema and shared types
migrations/     # Drizzle migrations
script/         # Build tooling (Vite + esbuild)
```

## Local Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure environment variables (see below).
3. Sync database schema:
   ```bash
   npm run db:push
   ```
4. Start the dev server:
   ```bash
   npm run dev
   ```

The app serves both API and client on `PORT` (default `5000`).

## Environment Variables
- `GEMINI_API_KEY` — Google AI Studio API key for Gemini
- `DATABASE_URL` — PostgreSQL connection string
- `SESSION_SECRET` — Express session secret
- `PORT` — optional server port (defaults to `5000`)

## Scripts
- `npm run dev` — start the dev server
- `npm run build` — build client and server for production
- `npm run start` — run the production build
- `npm run check` — TypeScript typecheck
- `npm run db:push` — push Drizzle schema changes to the database

## Design System
UI guidance and tokens live in [design.md](design.md).
