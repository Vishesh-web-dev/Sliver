import { sql } from 'drizzle-orm';
import {
  DEFAULT_GAME_SETTINGS,
  type ApiErrorBody,
  type GameSettings,
  type MyAnswer,
  type QuestionInputRaw,
  type QuestionSetDetail,
  type RoomState,
  type ServerMessage,
} from '@sliver/shared';
import { loadConfig, type ServerConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';
import { seedBuiltinSets } from '../src/db/seed.js';
import { loadEnv } from '../src/env.js';
import { startLocalServer, type LocalServer } from '../src/entry/local.js';
import { TEST_DB_DEFAULT } from './globalSetup.js';

export const STARTER_SET_ID = '5a1f0000-0000-4000-8000-000000000001';

export function testConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  loadEnv();
  return {
    ...loadConfig({
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? TEST_DB_DEFAULT,
      ALLOWED_ORIGINS: 'http://localhost:5173',
      RATE_LIMIT: 'off',
    }),
    tickIntervalMs: 100,
    ...overrides,
  };
}

export async function startTestServer(overrides: Partial<ServerConfig> = {}): Promise<LocalServer> {
  return startLocalServer(testConfig(overrides), 0);
}

/**
 * Wipes all data and re-seeds the built-in sets. TRUNCATE takes exclusive
 * locks, so it can collide with presence writes from sockets the previous
 * test just closed; retry on deadlock rather than making the hub test-aware.
 */
export async function resetDb(db: Db): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await db.execute(sql`
        TRUNCATE answers, game_players, game_questions, games, players, rooms,
                 questions, question_sets, users RESTART IDENTITY CASCADE`);
      break;
    } catch (err) {
      if ((err as { cause?: { code?: string } }).cause?.code !== '40P01' || attempt >= 5) throw err;
      await sleep(50 * attempt);
    }
  }
  await seedBuiltinSets(db);
}

/** Waits until every socket on the server has closed and its cleanup has run. */
export async function drain(server: LocalServer, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (server.hub.connectionCount > 0 && Date.now() < deadline) await sleep(20);
  await sleep(100);
}

/**
 * Moves the current phase of a game `seconds` into the past, as if that much
 * time had elapsed. Deadlines are checked on the database clock, so this is
 * how tests "wait" 30 seconds in a few milliseconds without faking anything
 * on the code path under test.
 */
export async function travel(db: Db, gameId: string, seconds: number): Promise<void> {
  await db.execute(sql`
    UPDATE games
       SET phase_started_at = phase_started_at - make_interval(secs => ${seconds}),
           phase_ends_at    = phase_ends_at    - make_interval(secs => ${seconds})
     WHERE id = ${gameId}::uuid`);
}

/** Moves the game to exactly its current deadline (elapsed = full duration). */
export async function travelToDeadline(db: Db, gameId: string): Promise<void> {
  await db.execute(sql`
    UPDATE games
       SET phase_started_at = phase_started_at - (phase_ends_at - clock_timestamp()),
           phase_ends_at    = clock_timestamp()
     WHERE id = ${gameId}::uuid`);
}

export function settings(overrides: Partial<GameSettings> = {}): GameSettings {
  return structuredClone({ ...DEFAULT_GAME_SETTINGS, ...overrides });
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(`${status} ${code}: ${message}`);
  }
}

/** One browser: its own anonymous session token. */
export class Player {
  token = '';
  userId = '';
  playerId = '';
  code = '';

  constructor(
    readonly baseUrl: string,
    readonly name: string,
  ) {}

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}/api${path}`, {
      method,
      headers: {
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return undefined as T;
    const json = (await res.json()) as unknown;
    if (!res.ok) {
      const err = (json as ApiErrorBody).error;
      throw new ApiError(res.status, err?.code ?? 'UNKNOWN', err?.message ?? '');
    }
    return json as T;
  }

  async session(): Promise<this> {
    const s = await this.request<{ token: string; userId: string }>('POST', '/session');
    this.token = s.token;
    this.userId = s.userId;
    return this;
  }

  async createRoom(opts: { questionSetId?: string | null; settings?: GameSettings; gameName?: string } = {}) {
    const res = await this.request<{ code: string; playerId: string }>('POST', '/rooms', {
      gameName: opts.gameName ?? 'Test Night',
      displayName: this.name,
      questionSetId: opts.questionSetId === undefined ? STARTER_SET_ID : opts.questionSetId,
      settings: opts.settings ?? settings(),
    });
    this.code = res.code;
    this.playerId = res.playerId;
    return res;
  }

  async join(code: string, displayName = this.name) {
    const res = await this.request<{ code: string; playerId: string }>('POST', `/rooms/${code}/join`, {
      displayName,
    });
    this.code = res.code;
    this.playerId = res.playerId;
    return res;
  }

  state(): Promise<RoomState> {
    return this.request<RoomState>('GET', `/rooms/${this.code}/state`);
  }

  start() {
    return this.request<{ gameId: string }>('POST', `/rooms/${this.code}/start`);
  }

  async answer(questionId: string, answer: { optionIndex: number } | { text: string }): Promise<MyAnswer> {
    const res = await this.request<{ myAnswer: MyAnswer }>('POST', `/rooms/${this.code}/answers`, {
      questionId,
      answer,
    });
    return res.myAnswer;
  }

  createSet(name: string, questions: QuestionInputRaw[]) {
    return this.request<QuestionSetDetail>('POST', '/question-sets', { name, questions });
  }

  updateSet(id: string, name: string, questions: QuestionInputRaw[]) {
    return this.request<QuestionSetDetail>('PUT', `/question-sets/${id}`, { name, questions });
  }

  connect(): Promise<Socket> {
    return Socket.open(this.baseUrl, this.token, this.code);
  }
}

/** Expects `promise` to reject with an ApiError carrying `code`. */
export async function expectApiError(promise: Promise<unknown>, code: string, status?: number): Promise<ApiError> {
  try {
    await promise;
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    if (err.code !== code || (status !== undefined && err.status !== status)) {
      throw new Error(`Expected ${status ?? ''} ${code}, got ${err.message}`);
    }
    return err;
  }
  throw new Error(`Expected ${code}, but the request succeeded`);
}

/** A test WebSocket client that records every message from the server. */
export class Socket {
  readonly messages: ServerMessage[] = [];
  latest: RoomState | null = null;
  closed: { code: number; reason: string } | null = null;
  private waiters: Array<() => void> = [];

  private constructor(readonly ws: WebSocket) {
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data)) as ServerMessage;
      this.messages.push(msg);
      if (msg.type === 'state' && (!this.latest || msg.state.version >= this.latest.version)) {
        this.latest = msg.state;
      }
      this.notify();
    });
    ws.addEventListener('close', (event) => {
      this.closed = { code: event.code, reason: event.reason };
      this.notify();
    });
  }

  static async open(baseUrl: string, token: string, roomCode: string): Promise<Socket> {
    const ws = new WebSocket(`${baseUrl.replace(/^http/, 'ws')}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('error', () => reject(new Error('WebSocket failed to open')), { once: true });
    });
    const socket = new Socket(ws);
    ws.send(JSON.stringify({ type: 'auth', token, roomCode }));
    return socket;
  }

  private notify() {
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w();
  }

  /** Resolves with the newest state that satisfies `predicate`. */
  async waitFor(predicate: (s: RoomState) => boolean, timeoutMs = 5000): Promise<RoomState> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (this.latest && predicate(this.latest)) return this.latest;
      if (this.closed) throw new Error(`Socket closed (${this.closed.code} ${this.closed.reason})`);
      const left = deadline - Date.now();
      if (left <= 0) {
        throw new Error(`Timed out waiting for state; latest phase=${this.latest?.phase ?? 'none'}`);
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  async waitForClose(timeoutMs = 5000): Promise<{ code: number; reason: string }> {
    const deadline = Date.now() + timeoutMs;
    while (!this.closed) {
      if (Date.now() > deadline) throw new Error('Timed out waiting for close');
      await new Promise((r) => setTimeout(r, 20));
    }
    return this.closed;
  }

  send(msg: unknown) {
    this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.ws.close();
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A tiny custom set: three questions with known answers, owned by `host`. */
export const THREE_QUESTIONS: QuestionInputRaw[] = [
  {
    type: 'MCQ',
    difficulty: 90,
    prompt: 'Which month has 28 days?',
    options: ['February', 'January', 'All of them', 'December'],
    correctOption: 2,
    explanation: 'Every month has at least 28 days.',
  },
  {
    type: 'SHORT',
    difficulty: 70,
    prompt: 'What comes next? 2, 4, 8, 16, ?',
    acceptedAnswers: ['32', 'thirty-two'],
    explanation: 'Doubles each time.',
  },
  {
    type: 'MCQ',
    difficulty: 1,
    prompt: 'How many animals of each kind did Moses take on the ark?',
    options: ['1', '2', '7', 'None'],
    correctOption: 3,
    points: 500,
  },
];
