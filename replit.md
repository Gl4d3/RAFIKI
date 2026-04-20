# Rafiki - AI Personal Finance Assistant

## Overview
Rafiki is a mobile-first personal finance web application that helps users budget and save smarter by analysing their M-Pesa and bank statements.

## Tech Stack
- **Frontend**: React 18 + Vite + TypeScript + Tailwind CSS + shadcn/ui (Radix UI)
- **Backend**: Express.js 5 + TypeScript
- **Database**: PostgreSQL via Drizzle ORM
- **Auth**: Passport.js (passport-local + express-session)
- **Routing**: Wouter (client-side)
- **Data fetching**: TanStack Query (React Query)
- **Forms**: React Hook Form + Zod

## Project Structure
```
client/
  src/
    pages/          # Route-level page components
    components/ui/  # Reusable shadcn/ui components
    hooks/          # Custom React hooks
    lib/            # Utilities and QueryClient setup
  public/
    figmaAssets/    # Static SVG/image assets from Figma
server/
  index.ts          # Express server entry point
  routes.ts         # API route definitions
  storage.ts        # DB abstraction (MemStorage / DB)
shared/
  schema.ts         # Drizzle ORM schema + Zod types
```

## Pages & Routing
| Route | Component | Description |
|-------|-----------|-------------|
| `/` | StatementUpload | Upload M-Pesa/bank statements |
| `/analyzing` | SilentAnalysis | Animated loading screen while Rafiki reads statements (auto-redirects to /reveal after 3s) |
| `/reveal` | GapFilling | AI reveals key financial insights |
| `/priority-stack-review` | PriorityStackReview | AI summary + ordered priority list for review |
| `/priority-stack` | PriorityStack | Editable ranked list of financial obligations |

## User Flow
1. **StatementUpload** → user uploads M-Pesa/bank PDF → clicks Continue
2. **SilentAnalysis** → animated loading screen → auto-advances to Reveal after 3 seconds
3. **GapFilling/Reveal** → AI shows income, top expense, and savings gap
4. **PriorityStackReview** → AI explains spending + ranked priority list
5. **PriorityStack** → user can reorder/adjust their obligations → Save

## Design
- Colour palette: `#00342b` (teal dark), `#afefdd` (mint), `#f9f9f9` (bg), `#1a1c1c` (text), `#3f4945` (muted)
- Font: Inter (via Helvetica fallback)
- Mobile-first layout, max-width ~448–672px centred

## Running the App
```bash
npm run dev        # Start dev server (port 5000)
npm run build      # Production build
npm run db:push    # Push schema to database
```
