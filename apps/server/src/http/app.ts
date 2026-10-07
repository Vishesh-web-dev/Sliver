import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import type { UpgradeWebSocket } from 'hono/ws';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';
import {
  createRoomSchema,
  firstIssueMessage,
  joinRoomSchema,
  questionSetInputSchema,
  submitAnswerSchema,
  transferHostSchema,
  updateRoomSchema,
  type ApiErrorBody,
  type SessionResponse,
} from '@sliver/shared';
import type { ServerConfig } from '../config.js';
import type { Db } from '../db/client.js';
import type { User } from '../db/schema.js';
import type { Hub } from '../realtime/hub.js';
import { authenticate, bearerToken, createSession } from '../services/auth.js';
import { requireRoomPlayer } from '../services/common.js';
import {
  advanceRoomIfDue,
  endGame,
  ensureGamePlayer,
  restartGame,
  startGame,
  submitAnswer,
} from '../services/game.js';
import {
  createQuestionSet,
  deleteQuestionSet,
  duplicateQuestionSet,
  getQuestionSet,
  listQuestionSets,
  updateQuestionSet,
} from '../services/questionSets.js';
import { buildRoomState, loadRoomSnapshot } from '../services/roomView.js';
import { createRoom, getRoomPreview, joinRoom, transferHost, updateRoom } from '../services/rooms.js';
import { AppError } from './errors.js';
import { rateLimit } from './rateLimit.js';

type AppEnv = { Variables: { user: User } };

export interface AppDeps {
  db: Db;
  config: ServerConfig;
  hub: Hub;
  /** Platform WebSocket adapter: @neon/functions/hono in production, @hono/node-ws locally. */
  upgradeWebSocket: UpgradeWebSocket;
}

/**
 * Exact origins ("https://sliver.vercel.app"), or a wildcard subdomain
 * ("https://*.vercel.app") so Vercel preview deployments work too.
 */
export function isAllowedOrigin(origin: string, allowed: readonly string[]): boolean {
  return allowed.some((entry) => {
    if (entry === origin) return true;
    const wildcard = /^(https?:\/\/)\*\.(.+)$/.exec(entry);
    if (!wildcard) return false;
    const [, scheme, suffix] = wildcard;
    return origin.startsWith(scheme!) && origin.endsWith(`.${suffix}`) && !origin.slice(scheme!.length).includes('/');
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidParam(c: Context, name: string): string {
  const value = c.req.param(name) ?? '';
  if (!UUID.test(value)) throw new AppError('NOT_FOUND', 'Not found');
  return value;
}

async function parseBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new AppError('BAD_REQUEST', 'Request body must be JSON.');
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw new AppError('BAD_REQUEST', firstIssueMessage(result.error));
  return result.data;
}

function errorResponse(err: Error, c: Context) {
  if (err instanceof AppError) {
    const body: ApiErrorBody = { error: { code: err.code, message: err.message } };
    return c.json(body, err.status as 400);
  }
  if (err instanceof HTTPException && err.status === 413) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Request is too large.' } }, 413);
  }
  console.error('[http] unhandled error', err);
  const body: ApiErrorBody = { error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } };
  return c.json(body, 500);
}

export function createApp({ db, config, hub, upgradeWebSocket }: AppDeps) {
  const app = new Hono<AppEnv>();
  app.onError(errorResponse);
  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404));

  app.get('/', (c) => c.json({ name: 'sliver', ok: true }));
  app.get('/health', async (c) => {
    await db.execute(sql`SELECT 1`);
    return c.json({ ok: true, connections: hub.connectionCount });
  });

  // Real-time channel. Deliberately outside /api: response-rewriting
  // middleware (CORS) must never wrap the upgrade response.
  app.get('/ws', upgradeWebSocket(() => hub.socketHandlers()));

  const api = new Hono<AppEnv>();
  api.onError(errorResponse);
  api.use(
    '*',
    cors({
      origin: (origin) => (isAllowedOrigin(origin, config.allowedOrigins) ? origin : null),
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Authorization', 'Content-Type'],
      maxAge: 600,
    }),
  );
  api.use('*', bodyLimit({ maxSize: 512 * 1024 }));

  const limiter = (name: string, limit: number, windowMs = 60_000) =>
    rateLimit({ name, limit, windowMs, enabled: config.rateLimit });

  const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
    const user = await authenticate(db, bearerToken(c.req.header('authorization')));
    if (!user) throw new AppError('UNAUTHORIZED', 'Your session has expired. Reload the page.');
    c.set('user', user);
    await next();
  };

  /** Run a room mutation, then push fresh state from this isolate immediately. */
  const mutated = <T>(value: T): T => {
    hub.poke();
    return value;
  };

  // ── Session ────────────────────────────────────────────────────────────────

  api.post('/session', limiter('session', 30), async (c) => {
    const token = bearerToken(c.req.header('authorization'));
    const existing = await authenticate(db, token);
    if (existing && token) {
      const body: SessionResponse = { token, userId: existing.id, displayName: existing.displayName };
      return c.json(body);
    }
    const created = await createSession(db);
    const body: SessionResponse = { token: created.token, userId: created.user.id, displayName: null };
    return c.json(body, 201);
  });

  api.get('/me', requireUser, (c) => {
    const user = c.get('user');
    return c.json({ userId: user.id, displayName: user.displayName });
  });

  // ── Question sets ──────────────────────────────────────────────────────────

  api.get('/question-sets', requireUser, async (c) => c.json(await listQuestionSets(db, c.get('user').id)));

  api.post('/question-sets', requireUser, async (c) => {
    const input = await parseBody(c, questionSetInputSchema);
    return c.json(await createQuestionSet(db, c.get('user').id, input), 201);
  });

  api.get('/question-sets/:id', requireUser, async (c) =>
    c.json(await getQuestionSet(db, c.get('user').id, uuidParam(c, 'id'))),
  );

  api.put('/question-sets/:id', requireUser, async (c) => {
    const id = uuidParam(c, 'id');
    const input = await parseBody(c, questionSetInputSchema);
    return c.json(mutated(await updateQuestionSet(db, c.get('user').id, id, input)));
  });

  api.delete('/question-sets/:id', requireUser, async (c) => {
    await deleteQuestionSet(db, c.get('user').id, uuidParam(c, 'id'));
    return mutated(c.body(null, 204));
  });

  api.post('/question-sets/:id/duplicate', requireUser, async (c) =>
    c.json(await duplicateQuestionSet(db, c.get('user').id, uuidParam(c, 'id')), 201),
  );

  // ── Rooms ──────────────────────────────────────────────────────────────────

  api.post('/rooms', limiter('create-room', 20), requireUser, async (c) => {
    const input = await parseBody(c, createRoomSchema);
    return c.json(await createRoom(db, c.get('user'), input), 201);
  });

  api.get('/rooms/:code', limiter('room-lookup', 60), async (c) => {
    const user = await authenticate(db, bearerToken(c.req.header('authorization')));
    return c.json(await getRoomPreview(db, c.req.param('code'), user?.id ?? null));
  });

  api.post('/rooms/:code/join', limiter('join', 30), requireUser, async (c) => {
    const { displayName } = await parseBody(c, joinRoomSchema);
    return c.json(mutated(await joinRoom(db, c.get('user'), c.req.param('code'), displayName, config)));
  });

  /** REST fallback for the WebSocket state push (also used by tests). */
  api.get('/rooms/:code/state', requireUser, async (c) => {
    const { room, player } = await requireRoomPlayer(db, c.req.param('code'), c.get('user').id);
    const joined = await ensureGamePlayer(db, room.id, player.id);
    if ((await advanceRoomIfDue(db, room.id)) || joined) hub.poke();
    const snapshot = await loadRoomSnapshot(db, room.id);
    if (!snapshot) throw new AppError('ROOM_NOT_FOUND', 'Room not found');
    return c.json(buildRoomState(snapshot, player.id));
  });

  api.patch('/rooms/:code', requireUser, async (c) => {
    const input = await parseBody(c, updateRoomSchema);
    await updateRoom(db, c.get('user').id, c.req.param('code'), input);
    return mutated(c.body(null, 204));
  });

  api.post('/rooms/:code/start', requireUser, async (c) => {
    const game = await startGame(db, c.get('user').id, c.req.param('code'));
    return mutated(c.json({ gameId: game.id }, 201));
  });

  api.post('/rooms/:code/answers', requireUser, async (c) => {
    const input = await parseBody(c, submitAnswerSchema);
    const myAnswer = await submitAnswer(db, c.get('user').id, c.req.param('code'), input);
    return mutated(c.json({ myAnswer }, 201));
  });

  api.post('/rooms/:code/end', requireUser, async (c) => {
    await endGame(db, c.get('user').id, c.req.param('code'));
    return mutated(c.body(null, 204));
  });

  api.post('/rooms/:code/restart', requireUser, async (c) => {
    await restartGame(db, c.get('user').id, c.req.param('code'));
    return mutated(c.body(null, 204));
  });

  api.post('/rooms/:code/host', requireUser, async (c) => {
    const { playerId } = await parseBody(c, transferHostSchema);
    await transferHost(db, c.get('user').id, c.req.param('code'), playerId);
    return mutated(c.body(null, 204));
  });

  app.route('/api', api);
  return app;
}

export type App = ReturnType<typeof createApp>;
