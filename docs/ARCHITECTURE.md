# Sliver — architecture

This is the design record for Sliver, the multiplayer common-sense quiz. It
follows the order the spec asked for (§31): requirements, assumptions,
architecture, schema, state machine, contracts, security. The code is the
source of truth; file references point at it.

---

## 1. Requirements, condensed

| Must hold | Where it is enforced |
|---|---|
| Server is the only authority on answers, scores, timer, progression, ranking | `services/game.ts`, `services/roomView.ts` |
| Exactly 30 s per question; nothing accepted after the deadline | DB clock checks + `answers_guard` trigger |
| One answer per player per question, never changeable | unique index + `answers_guard` trigger |
| Question set immutable once a game starts | snapshot table `game_questions` + `QUESTION_SET_LOCKED` + `game_questions_guard` trigger |
| No answer key in the browser before a question closes | `buildRoomState()` (unit-tested) |
| Reconnect restores identity, answers, score; no extra time | token identity + absolute deadlines |
| 2 players or many; no hard cap unless the platform needs one | soft cap `MAX_PLAYERS_PER_ROOM` (default 50), see §3.4 |
| Host on Vercel (frontend) and Neon (backend) | Vite SPA + Neon Functions |

## 2. Assumptions and decisions

Decisions that shape the architecture, stated up front:

1. **Backend on Neon Functions, not a VM.** "Backend on the Neon console"
   maps exactly to [Neon Functions](https://neon.com/docs/compute/functions/overview):
   long-running Node 24 compute on the database branch, with WebSocket support
   and `DATABASE_URL` injected. Vercel functions cannot hold WebSockets, so the
   real-time backend cannot live there. The frontend is a static React SPA on
   Vercel, same split as `system-design-academy` (Vercel + Neon, `pg`, Drizzle).
2. **Native WebSockets via Hono, not Socket.IO.** Socket.IO needs its own
   Node server; Neon Functions expose a WebSocket through Hono's standard
   `upgradeWebSocket` helper. The same app runs locally on Node with
   `@hono/node-ws`, so dev, tests and production share one code path.
3. **Commands over REST, state over the socket.** Create/join/start/answer
   are HTTP calls with explicit success/error responses (easy to validate,
   test and retry). The server pushes one complete, per-player `RoomState`
   over the WebSocket whenever anything in the room changes. Clients never
   apply diffs and never compute outcomes.
4. **Postgres is the only shared state.** Neon may run several isolates
   (processes) and evict any of them at any time. So nothing that matters
   lives in memory: deadlines, answers, scores and presence are rows. Isolates
   coordinate by polling a per-room `version` counter (Neon's recommended
   cross-isolate pattern; keeps scale-to-zero working, no Redis).
5. **Anonymous identity.** First visit creates a session (random 256-bit
   token in `localStorage`, SHA-256 stored server-side). The token *is* the
   player's identity for reconnection. Auth/profiles can attach to `users` later.
6. **The timer is fixed at 30 s in the UI** but `questionDurationSec` is a
   validated game setting (10–120 s) so it can be exposed later.
7. **Players who leave keep their seat.** Everyone in the room when the host
   starts is a participant; an absent player simply scores "unanswered" and is
   shown as offline. Late joiners play from the current question onward.
8. **Ending early discards the open question.** If the host ends a game
   mid-question, that question is not scored for anyone.
9. **Ties share a rank** (1, 1, 3) and all tied leaders are winners.
10. **No early close when everyone has answered.** The spec fixes the
    window at exactly 30 s; the UI shows "Everyone's in" instead.

## 3. Architecture

```
 Browser (Vercel, static React SPA)
   │  REST  https://<fn-url>/api/*      commands: create, join, start, answer…
   │  WS    wss://<fn-url>/ws           server → client: RoomState pushes
   ▼                                    client → server: auth, ping
 Neon Function "sliver" (Hono, Node 24) ── one per isolate ──┐
   Hub: sockets on this isolate, 250 ms tick                  │  N isolates
     1. advance due games (row-locked, idempotent)            │  (Neon scales
     2. poll rooms.version → push per-player state            │   them out)
     3. presence heartbeat / sweep / host hand-off            │
   ▼                                                         ─┘
 Neon Postgres (same region)   all state, all deadlines, all rules
```

Code map (`apps/server/src`):

| Path | Responsibility |
|---|---|
| `entry/neon.ts` | Neon Functions entry: pool + `attachDatabasePool`, Hub, Hono app |
| `entry/local.ts`, `entry/node.ts` | The same app on Node for dev and tests |
| `http/app.ts` | Routes, CORS (API only, never on `/ws`), validation, error mapping |
| `realtime/hub.ts` | Sockets, ticking, fan-out, presence |
| `realtime/clock.ts` | Isolate ↔ database clock calibration |
| `services/game.ts` | State machine: start (snapshot), answer, advance, end, restart |
| `services/roomView.ts` | Consistent snapshot + per-player view (the anti-cheat boundary) |
| `services/rooms.ts`, `questionSets.ts`, `presence.ts`, `auth.ts` | The rest |
| `domain/*` | Pure rules: scoring, ranking, room codes (unit-tested) |
| `packages/shared` | Zod schemas, constants, wire types used by both sides |

### 3.1 Time

- Every deadline is written by the database: `phase_ends_at =
  statement_timestamp() + 30 s`. Every acceptance check compares against
  `clock_timestamp()`. No isolate's or browser's clock is ever trusted.
- Browsers render countdowns from `phaseEndsAt` (server epoch ms) minus a
  clock offset measured with NTP-style pings over the socket (best of 5
  samples, then every 15 s). Isolates calibrate their own offset to the
  database clock, so "server time" in a pong is database time.
- Because deadlines are absolute, a player who reconnects at second 20 sees
  10 s left. Reconnecting can never grant extra time.

### 3.2 Who moves the game forward

`advanceGame(gameId)` locks the game row (`FOR NO KEY UPDATE`), re-checks
`phase_ends_at <= clock_timestamp()` and performs at most one transition per
transaction. It is a no-op if nothing is due, so it is safe to call from:

- every isolate's 250 ms tick, for rooms it holds sockets for;
- any request that reads room state (lazy evaluation);
- tests, eight times concurrently (`game.test.ts` asserts exactly one wins).

If every player disconnects, nothing ticks. The game resumes on the next
connection: the overdue question closes, and later phases start from *now*
rather than racing through skipped questions.

### 3.3 The answer/deadline race

An answer transaction takes `FOR SHARE` on the game row; the closing
transaction needs `FOR NO KEY UPDATE`, which waits for every in-flight answer
to commit. So an answer accepted at 29.999 s is always visible to the scorer.
A database trigger rejects any insert whose `submitted_at` is at or past the
deadline (SQLSTATE `SL002` → `DEADLINE_PASSED`). `game.test.ts` fires a
burst of answers across the deadline while closers run and asserts every
answer is either rejected or scored, never accepted-and-lost.

Lock order, which keeps everything deadlock-free (`services/common.ts`):
`question_sets → rooms` (start, set edits) and `games → rooms` (answer,
advance, end). Presence updates are single-statement.

### 3.4 Limits

- Neon Functions allow about 100 concurrent invocations per account by
  default, and each connected player holds one. So the account as a whole
  supports roughly 100 simultaneous players. `MAX_PLAYERS_PER_ROOM`
  (default 50) is a soft guard, not a game rule. Ask Neon to raise the
  account limit before running bigger events.
- Fan-out cost per change is one snapshot query set per isolate per room,
  not per player.

## 4. Data model

`apps/server/src/db/schema.ts` (Drizzle) and `apps/server/drizzle/*.sql`.

| Table | Spec entity | Notes |
|---|---|---|
| `users` | User | anonymous identity, `token_hash` |
| `question_sets` | QuestionSet | `owner_id` null + `is_builtin` for ready-made sets |
| `questions` | Question | `options`/`accepted_answers` jsonb, `points` null = use table |
| `rooms` | GameRoom | `code`, `host_player_id`, lobby `settings`, `current_game_id`, `version` |
| `players` | (Player in a room) | unique `(room, user)` and `(room, lower(name))`; presence columns |
| `games` | (game run) | `status`, `current_index`, `phase_started_at/ends_at`, settings snapshot |
| `game_questions` | GameQuestion | **immutable snapshot**, points resolved at start |
| `game_players` | PlayerGame | score, correct/incorrect/unanswered counts |
| `answers` | Answer | unique `(game_question, player)`; scored once at close |

A room hosts many games over its life (restart = new `games` row), which is
why GameRoom and the game run are split.

Database-level invariants (`drizzle/0001_immutability.sql`):

- `game_questions`: no UPDATE ever, INSERT only while the game is STARTING,
  DELETE only once the game is complete.
- `answers`: INSERT only for the open question before the deadline; UPDATE
  may only set `is_correct`/`points_earned`, once.

## 5. Game state machine

```
LOBBY ──host start──▶ STARTING (3 s) ──▶ QUESTION_ACTIVE (30 s) ──▶ RESULTS (pause)
  ▲                                            ▲                       │
  │                                            └──── next question ◀───┤
  └──── host restart ◀──── GAME_COMPLETE ◀──── last question / host end ┘
```

- `QUESTION_LOCKED` and `NEXT_QUESTION` (spec §18) are not resting states.
  They are the two transactions above: *close* (lock, score every answer,
  update totals, publish RESULTS) and *open* (set the next deadline).
- `LOBBY` is "room has no current game"; the other states are `games.status`.
- Only the server transitions; clients render `RoomState.phase`.

## 6. Contracts

### REST (`/api`, JSON, `Authorization: Bearer <token>`)

| Method & path | Who | Purpose |
|---|---|---|
| `POST /session` | anyone | create (or confirm) an anonymous session |
| `GET /question-sets` · `POST` · `GET/PUT/DELETE /:id` · `POST /:id/duplicate` | owner (built-ins read-only) | question sets; PUT/DELETE → `409 QUESTION_SET_LOCKED` while played |
| `POST /rooms` | anyone | create room; caller becomes host |
| `GET /rooms/:code` | anyone | preview (name, host, players, phase) |
| `POST /rooms/:code/join` | anyone | join or reclaim a seat (idempotent) |
| `GET /rooms/:code/state` | player | REST fallback for the pushed state |
| `PATCH /rooms/:code` | host, lobby | game name, set, settings |
| `POST /rooms/:code/start` · `/end` · `/restart` · `/host` | host | game control, host hand-off |
| `POST /rooms/:code/answers` | player | `{ questionId, answer: {optionIndex} \| {text} }` |

Errors are `{ error: { code, message } }` with codes such as
`DEADLINE_PASSED`, `ALREADY_ANSWERED`, `QUESTION_NOT_ACTIVE`, `NOT_HOST`,
`NAME_TAKEN`, `QUESTION_SET_LOCKED` (`packages/shared/src/protocol.ts`).

### WebSocket (`/ws`)

```
client → { type: "auth", token, roomCode }      first frame, within 10 s
client → { type: "ping", t }                    clock sync + keepalive
server → { type: "state", state: RoomState }    on connect and on every change
server → { type: "pong", t, serverTime }
server → { type: "error", code, message, fatal } fatal → close 4001, no retry
```

`RoomState` (per player) carries the room, players with presence, the phase,
and a `GameView`: current question without its answer, deadlines, who has
answered (not what), the player's own locked answer, and after the close the
reveal, per-player results and the leaderboard (unless hidden by the host).

## 7. Security model

- **Authority:** correctness, points, deadlines, progression and ranking are
  computed only in server transactions. Request bodies are parsed with strict
  Zod schemas, so extra fields like `isCorrect` or `points` are rejected (tested).
- **Secrecy:** the answer key, accepted answers and explanation leave the
  server only in the RESULTS view, after the question closed. Future
  questions are never sent. Other players' choices are hidden until the close
  (`roomView.test.ts`).
- **Identity:** 256-bit random bearer tokens, stored hashed; browsers can't
  set WebSocket headers, so the token travels in the first frame, not the URL.
- **Authorisation:** host-only actions check the host inside the locked
  transaction; question sets are visible only to their owner (others get 404).
- **Input:** all text is Unicode-normalised, stripped of control and bidi
  characters and length-limited; React escapes all output.
- **Abuse:** per-IP rate limits on session/room lookup/join/create;
  32⁵ ≈ 33.5 M room codes from a CSPRNG; per-socket message rate and size
  limits; 512 KB body limit; CORS restricted to `ALLOWED_ORIGINS`.
- **Secrets:** the browser only knows the public function URL. `DATABASE_URL`
  is injected into the function by Neon and never shipped to Vercel.

## 8. Extension points (not built)

The spec's future list (§28) maps onto existing seams: speed bonus is a
setting already supported by `scoreAnswer`; spectators are a socket without a
`game_players` row; teams and rounds extend `games`; profiles and history
hang off `users`; CSV import and AI-generated questions feed
`questionSetInputSchema`; a Neon Function Trigger can clean up stale rooms.
