# Sliver

A real-time multiplayer quiz of common sense, sneaky logic and things hiding in
plain sight. A host creates a room and shares the code; everyone answers the same
question at the same moment against a 30-second clock that only the server
controls. Twelve difficulty levels run from 90% (most people get it) down to 1%.

- **Frontend:** React 19 + Vite + Tailwind v4 SPA, hosted on **Vercel**
- **Backend:** Hono (REST + WebSocket) on **Neon Functions**, Node 24
- **Database:** **Neon Postgres** via `pg` + Drizzle (Docker Postgres locally)

Design record (architecture, schema, state machine, contracts, security):
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

```
apps/
  server/    Hono app, game engine, WebSocket hub, Drizzle schema + migrations, tests
  web/       React SPA: game screens (cobalt "stage") + question editor ("backstage")
packages/
  shared/    Zod schemas, constants and wire types used by both
neon.ts      Neon backend config (declares the "sliver" function)
vercel.json  Vercel build + SPA routing
```

## Run it locally

Needs Node 22+ and Docker.

```bash
npm install
npm run db:up                                   # Postgres 17 on localhost:5434 (+ sliver_test DB)
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env
npm run db:migrate && npm run db:seed           # schema + two ready-made question sets
npm run dev                                     # server :8787, web http://localhost:5173
```

Open <http://localhost:5173>, create a game, and join from another browser
profile (or a phone on your network with `npm run dev -w @sliver/web -- --host`,
adding that origin to `ALLOWED_ORIGINS`).

**Playing alone?** Fill the room with bots that join and guess like real players:

```bash
npm run bots -- AB7KQ 3        # room code, number of bots
```

## Tests

```bash
npm run db:up        # integration tests use the real Postgres (database sliver_test)
npm test             # server: 67 tests, web: 5 tests
npm run typecheck
```

Server tests cover room creation, joining, starting, timer expiry, answer
submission (duplicates, late, wrong question, forged fields), scoring,
question locking (API and database triggers), reconnection, presence and host
hand-off, final ranking with ties, a concurrent answers-vs-deadline race, and
the spec's §30 four-player acceptance scenario end to end over HTTP and
WebSockets (`apps/server/test/acceptance.test.ts`).

Time-dependent tests don't sleep for 30 s: they move the game's deadline in the
database (`travel()` in `test/helpers.ts`), so the real deadline checks run unchanged.

## Deploy

Same split as `system-design-academy`: Vercel for the web app, Neon for the
data. The difference is that the game server needs long-lived WebSockets,
which Vercel functions can't hold, so it runs as a **Neon Function** next to
the database.

### 1. Neon: database + game server

1. Neon CLI, logged in: `npm i -g neon@latest && neon auth`. Deploying needs CLI 8+
   (older versions reject `neon.ts`); `npm run deploy:backend` runs `npx neon@8`
   for you, so an outdated global install still works.
2. Create a project in a region that supports Functions. **AWS Asia Pacific
   (Singapore), `aws-ap-southeast-1`** is the closest to India; the others are
   `aws-us-east-1`, `aws-us-east-2`, `aws-eu-central-1`.
3. From the repo root, link it: `neon link`. This writes `.neon` (gitignored).
4. Create the schema and the ready-made sets. Use the **direct (unpooled)**
   connection string from Console → Connect, with connection pooling off:

   ```bash
   DATABASE_URL="postgresql://…neon.tech/neondb?sslmode=require" npm run db:deploy
   ```

5. Deploy the function. `ALLOWED_ORIGINS` is the browser origins that may call
   the API. Until you know your Vercel URL, `https://*.vercel.app` is fine:

   ```bash
   ALLOWED_ORIGINS="https://*.vercel.app" npm run deploy:backend   # = npx neon@8 deploy
   neon functions get sliver                                        # copy the URL
   curl https://<function-url>/health                               # {"ok":true,…}
   ```

   `DATABASE_URL` is injected by Neon automatically; there is nothing else to
   configure.

### 2. Vercel: web app

1. Push the repo to GitHub and import it in Vercel. Keep the **root
   directory as the repo root**; `vercel.json` sets the install, build and
   output (`apps/web/dist`) and the SPA rewrite.
2. Add the environment variable `VITE_API_URL=https://<function-url>` (no
   trailing slash) for Production and Preview, then deploy. It is baked in at
   build time, so redeploy after changing it.
3. Tighten CORS to your real domain and redeploy the function:

   ```bash
   ALLOWED_ORIGINS="https://sliver.vercel.app,https://*-yourteam.vercel.app" npm run deploy:backend
   ```

### Environment variables

| Where | Variable | Purpose |
|---|---|---|
| Neon Function | `DATABASE_URL` | injected by Neon (pooled) |
| Neon Function | `ALLOWED_ORIGINS` | comma-separated CORS origins; `https://*.domain` wildcards allowed |
| Neon Function | `MAX_PLAYERS_PER_ROOM` | soft cap, default 50 |
| Vercel | `VITE_API_URL` | the function URL |
| local `apps/server/.env` | `DATABASE_URL`, `TEST_DATABASE_URL`, `PORT`, `ALLOWED_ORIGINS` | see `.env.example` |

### Limits worth knowing

- Neon Functions allow about **100 concurrent invocations per account** by
  default, and each connected player holds one socket. That's plenty for
  friends' games; ask Neon before a 100+ player event.
- Neon scales idle compute to zero. The first request after a quiet spell
  takes a moment longer while Postgres wakes up.

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | server (tsx watch) + web (Vite) |
| `npm test` / `npm run typecheck` | all workspaces |
| `npm run build` | production web build |
| `npm run db:up` / `db:migrate` / `db:seed` / `db:deploy` | local DB, migrations, seed, both |
| `npm run db:generate` | new Drizzle migration after editing `schema.ts` |
| `npm run bots -- CODE [n]` | bot players for solo testing |
| `npm run deploy:backend` | `neon deploy` via `npx neon@8` (needs `neon link` first) |
