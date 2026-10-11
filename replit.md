# SecureShare

A private file handoff app for one administrator to upload files, create revocable recipient links, and review voluntary submissions.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (uses the workflow-assigned `PORT`)
- `pnpm --filter @workspace/secureshare run dev` — run the SecureShare web app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required setup: `DATABASE_URL`, managed Clerk authentication, and managed private object storage
- Vite build check: `PORT=3000 BASE_PATH=/ pnpm --filter @workspace/secureshare run build`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5, Clerk cookie sessions and the Clerk proxy middleware
- DB: PostgreSQL + Drizzle ORM
- File storage: private Replit App Storage; browser uploads use short-lived signed URLs
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/secureshare/src/App.tsx`, `src/index.css` — branded landing, admin and recipient experiences
- `artifacts/api-server/src/routes/secureshare.ts` — administrator, sharing, and submission API
- `artifacts/api-server/src/lib/objectStorage.ts` — private object upload, download, and delete operations
- `lib/api-spec/openapi.yaml` — source of truth for the API contract
- `lib/db/src/schema/secureshare.ts` — persistent SecureShare schema

## Architecture decisions

- There is one administrator per installation. The first signed-in Clerk user may claim the initial administrator slot once; complete this setup with the intended owner account before sharing the app.
- Share links are bearer credentials. Only active, unexpired links can stream files assigned to them; file bytes and storage paths are not exposed in public metadata.
- Camera permission is a recipient-facing viewing gate, not proof of recording consent. The gate stops the camera immediately; recording and sending media are separate, explicit actions.
- Access activity stores file and link title snapshots, without visitor IP addresses.

## Product

- The administrator uploads private files, assigns selected files to links, sets expirations, revokes links, and reviews access timestamps and optional media submissions.
- Recipients need no account. They see a clear camera-permission gate before viewing, and can optionally choose or record media only when submissions are enabled and then explicitly confirm sending.

## User preferences

- This is an educational demo: do not automatically capture or upload camera media; require separate, clear recipient confirmation before any submission.

## Gotchas

- Claim the initial administrator account before publishing or distributing links; subsequent accounts do not receive admin access.
- File uploads go directly to private object storage, not through Express. Keep storage object paths private and keep share tokens out of request logs.
- After changing the OpenAPI file, run API codegen before typechecking packages that consume generated types.
- After changing the Drizzle schema, push changes only to the development database with the DB package script.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
