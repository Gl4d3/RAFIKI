# Rafiki — AI Personal Finance Companion (Phase 1)

## Overview
Rafiki is a mobile-first personal finance web application for Kenya that analyses M-Pesa and bank statements, builds a financial model, and guides users through a priority stack of their obligations — all powered by real transaction analysis and Gemini AI.

## Tech Stack
- **Frontend**: React 18 + Vite + TypeScript + Tailwind CSS + shadcn/ui
- **Backend**: Express.js 5 + TypeScript
- **Database**: PostgreSQL via Drizzle ORM
- **AI**: Google Gemini 1.5 Flash (for reveal messages and gap-filling questions)
- **File handling**: multer (file uploads), csv-parse (CSV parsing)
- **Routing**: Wouter (client-side)
- **Data fetching**: TanStack Query

## Architecture — Two Core Systems

### The Accountant (server/accountant.ts)
Pure deterministic Python-equivalent TypeScript functions. No LLM calls.
- `categorizeTransactions()` — matches counterparties against paybill lookup
- `identifyRecurring()` — finds same counterparty with similar amounts >1x
- `identifySalary()` — identifies largest recurring credit as salary
- `computeFinancialSummary()` — builds full financial model
- `generatePriorityStack()` — creates tiered obligation list

### RAFIKI AI Layer (server/gemini.ts)
Uses Gemini only for natural language generation. Never does math.
- `generateRevealMessage()` — creates the "it already knows me" moment
- `generateGapFillingQuestion()` — generates contextual questions about unknowns

## Project Structure
```
client/src/
  pages/
    StatementUpload.tsx   # Stage 1: Upload M-Pesa/bank statements
    SilentAnalysis.tsx    # Stage 2: Polling analysis progress with animation
    PriorityStackReview.tsx  # Stage 3+4: AI reveal + priority stack review
    GapFilling.tsx        # Stage 4: Resolve unknown transactions one-by-one
    PriorityStack.tsx     # Stage 5: Edit/reorder the priority stack
    Home.tsx              # Home screen: balance, health score, stack summary
  lib/
    rafiki-context.tsx    # Session state: userId, jobId, onboardingStage
    queryClient.ts        # TanStack Query + apiRequest helper

server/
  index.ts               # Express server entry
  routes.ts              # All API endpoints
  db.ts                  # Drizzle ORM database connection
  storage.ts             # DbStorage + MemStorage implementations
  parser.ts              # M-Pesa CSV parser + demo transaction generator
  paybill-lookup.ts      # Hardcoded Kenyan paybill/merchant lookup table
  accountant.ts          # Deterministic financial engine (The Accountant)
  gemini.ts              # Gemini AI layer (RAFIKI)
  analysis-pipeline.ts   # Async pipeline orchestrating all stages

shared/schema.ts          # Drizzle schema: users, transactions, entities,
                          # priority_stack_items, analysis_jobs
```

## Onboarding Flow (5 Stages)
| Route | Stage | Description |
|-------|-------|-------------|
| `/` | Upload | User uploads M-Pesa CSV/PDF or uses demo data |
| `/analyzing` | Analysis | Polls job status with live progress bar |
| `/reveal` | Reveal | AI reveal message + priority stack for review |
| `/gap-filling` | Gap-filling | RAFIKI asks about unknown transactions one-by-one |
| `/priority-stack` | Edit stack | User can drag to reorder + add obligations |
| `/home` | Home | Balance, health score, top categories, stack summary |

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/user/init` | Create or get user session |
| POST | `/api/onboarding/upload` | Upload file, start async analysis job |
| GET | `/api/onboarding/job/:id` | Poll job status and results |
| GET | `/api/onboarding/state/:userId` | Get current onboarding state |
| POST | `/api/onboarding/gap-fill` | Submit answer for unknown entity |
| POST | `/api/onboarding/save-stack` | Save final priority stack |
| GET | `/api/home/:userId` | Get home screen data |

## Environment Variables Required
- `GEMINI_API_KEY` — Google AI Studio API key
- `DATABASE_URL` — PostgreSQL connection string (auto-provisioned by Replit)
- `SESSION_SECRET` — Express session secret (auto-provisioned by Replit)

## Design Tokens
- Primary: `#00342b` (Deep Teal)
- Secondary: `#4755b6` (Warm Indigo)
- Accent: `#afefdd` (Mint)
- Background: `#f9f9f9` (Off-white)
- Text: `#1a1c1c` (Near-black), `#3f4945` (Muted)
- Card radius: 24px outer, 9999px for pills
- Font: Inter (sans-serif), max weight 500 (medium)

## Running
```bash
npm run dev        # Start dev server on port 5000
npm run build      # Production build
npm run db:push    # Sync schema to database
```
