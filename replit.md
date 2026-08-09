# Gen Z Meet

Gen Z Meet is a dark, responsive meeting workspace for starting live rooms, capturing transcripts, and reviewing AI-assisted notes.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/gen-z-meet run dev` — run the web app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Optional secret: `OPENAI_API_KEY` — enables server-side AI meeting notes; transcript-derived local notes remain available without it

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: Vite for the web app and esbuild for the API bundle

## Where things live

- `artifacts/gen-z-meet/src/pages/meet-pages.tsx` — page-level meeting, transcript, history, and notes UI
- `artifacts/gen-z-meet/src/components/meet-shell.tsx` — responsive app shell and shared meeting UI
- `artifacts/api-server/src/routes/meetings.ts` — meeting lifecycle, persistence, transcript, and notes endpoints
- `lib/db/src/schema/meetings.ts` — PostgreSQL/Drizzle meeting schema
- `lib/api-spec/openapi.yaml` — API source of truth
- `artifacts/gen-z-meet/src/index.css` — Gen Z Meet visual system

## Architecture decisions

- PostgreSQL/Drizzle is the persistence layer because this workspace had no Firebase configuration.
- The current workspace is explicitly a demo-auth mode using a server-side `demo-user` fallback; it is not a substitute for production authentication.
- Browser media controls use `getUserMedia`, `getDisplayMedia`, and Web Speech where supported, with permission/browser fallbacks.
- AI notes use the server-only `OPENAI_API_KEY` when present and fall back to deterministic transcript analysis when unavailable.

## Product

- Landing, demo sign-in handoff, dashboard, meeting browser, history, AI notes, profile, and settings screens.
- Persistent live/ended meetings with participants, transcript entries, notes, dashboard aggregates, and history.
- Live room controls for microphone, camera preview, screen sharing, transcript capture, and leaving a meeting.

## User preferences

- Keep the product dark, high-contrast, responsive, and conversational rather than corporate.

## Gotchas

- Run OpenAPI codegen after changing `lib/api-spec/openapi.yaml`.
- The browser cannot guarantee media permissions or speech recognition, so the live room must keep functioning with visible fallback messaging.
- Do not expose `OPENAI_API_KEY` to client code; AI notes are generated only by the API server.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
