# RAFIKI

**A mobile-first AI personal finance companion built for Kenyan transaction data.**

RAFIKI turns M-Pesa messages, M-Pesa statements, and bank statements into a structured financial picture. It combines deterministic accounting logic with Gemini-powered language so users get useful explanations without asking an LLM to perform or invent the underlying maths.

> **Current status:** Phase 1 implements the end-to-end onboarding, analysis, priority-stack, dashboard, goals, instructions, activity, and streaming chat experience.

## Why RAFIKI exists

Most personal finance tools expect clean bank feeds and predictable transaction labels. That assumption breaks down when a person's real financial life is distributed across M-Pesa, bank statements, informal transfers, recurring obligations, and ambiguous merchant names.

RAFIKI is designed around that reality:

- ingest messy, locally relevant financial records;
- normalise transactions into one model;
- identify recurring income and obligations;
- ask the user when the system does not know enough;
- prioritise what needs attention first;
- explain the result in plain language.

## Core capabilities

- Upload M-Pesa CSV or PDF statements.
- Paste raw M-Pesa SMS text.
- Upload bank statement PDFs.
- Run analysis asynchronously with visible progress.
- Detect salary, recurring payments, internal transfers, and transaction categories.
- Resolve unknown entities through a gap-filling workflow.
- Build and reorder a priority stack of obligations.
- Show a home dashboard with financial state, nudges, and health insights.
- Stream chat responses grounded in deterministic account calculations.
- Manage goals, standing instructions, activity history, and emergency-brake controls.

## The key design rule

**The model explains; the accountant computes.**

Numeric values are calculated by deterministic tools before they are shown to the user. Gemini is used for enrichment, wording, questions, and coaching—not as the source of truth for balances, totals, or priority calculations.

This separation reduces hallucinated financial figures and makes the system easier to test.

## Analysis pipeline

```text
M-Pesa / bank records
        |
        v
Stage A: Parse and normalise
        |
        v
Stage B: Deterministic enrichment
  - categorisation
  - recurring detection
  - salary detection
  - internal-transfer tagging
        |
        v
Stage B: AI enrichment
  - refine entities and relationships
  - identify unresolved gaps
        |
        v
Stage C: Financial summary
  - priority stack
  - reveal message
  - gap-filling questions
        |
        v
PostgreSQL + mobile-first product experience
```

If Gemini is unavailable, the analysis job pauses and gives the user a choice between retrying and continuing in basic mode.

## Product flow

1. **Upload** statements, messages, or demo data.
2. **Analyse** records through the asynchronous pipeline.
3. **Review** the initial financial picture and priority stack.
4. **Clarify** unknown counterparties or transactions.
5. **Adjust** the order of obligations.
6. **Use** the dashboard, goals, instructions, activity feed, and chat companion.

## Architecture

RAFIKI runs as one Node.js service that serves both the Express API and React client.

```text
React + Vite SPA
      |
      v
Express API + SSE chat
      |
      +--> statement parsers
      +--> deterministic accountant
      +--> Gemini enrichment
      +--> async analysis jobs
      |
      v
PostgreSQL + Drizzle ORM
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the detailed runtime, API groups, data model, and build flow.

## Technology stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, TypeScript, Tailwind CSS, shadcn/ui |
| State and data | TanStack Query, Wouter |
| Backend | Express 5, TypeScript |
| Database | PostgreSQL, Drizzle ORM |
| AI | Google Gemini |
| Streaming | Server-Sent Events |
| Build | Vite + esbuild |

## Repository layout

```text
client/         React application, pages, components, and UI state
server/         API, parsers, analysis pipeline, accountant, and AI layer
shared/         Drizzle schema and shared types
migrations/     Database migrations
script/         Build tooling
ARCHITECTURE.md Detailed system architecture
design.md       Product design guidance and tokens
```

## Run locally

### Prerequisites

- Node.js 18+
- PostgreSQL
- Gemini API key

### Setup

```bash
npm install
cp .env.example .env
npm run db:push
npm run dev
```

The application serves the API and client on `http://localhost:5000` by default.

### Environment variables

```bash
GEMINI_API_KEY=your_key
DATABASE_URL=postgresql://user:password@localhost:5432/rafiki
SESSION_SECRET=replace_with_a_long_random_value
PORT=5000
```

### Useful commands

```bash
npm run dev       # development server
npm run check     # TypeScript validation
npm run build     # production build
npm run start     # serve production bundle
npm run db:push   # synchronise the Drizzle schema
```

## Data and safety principles

- Financial totals come from deterministic code, not free-form model output.
- Uploaded records are bounded by file-count and request-size limits.
- Ambiguous transactions are surfaced for user clarification.
- The AI layer can degrade to a basic non-AI mode.
- The product is a financial organisation and coaching tool, not a lender or autonomous financial adviser.

## Roadmap

- strengthen statement-format coverage and parser diagnostics;
- add evaluation datasets for categorisation and recurring-payment detection;
- improve user-controlled privacy and data-retention settings;
- add scenario planning without allowing the LLM to own arithmetic;
- validate the priority-stack model with real Kenyan users.

## Licence

This repository is currently maintained as a product prototype. Confirm licensing terms before redistribution.
