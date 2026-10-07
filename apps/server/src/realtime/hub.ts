import { inArray } from 'drizzle-orm';
import type { WSContext, WSEvents } from 'hono/ws';
import { WS_CLOSE, type ClientMessage, type ErrorCode, type ServerMessage } from '@sliver/shared';
import type { ServerConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { players, rooms } from '../db/schema.js';
import { authenticate } from '../services/auth.js';
import { findRoomByCode } from '../services/common.js';
import { advanceGame, advanceRoomIfDue, ensureGamePlayer, findDueGames } from '../services/game.js';
import {
  heartbeat,
  markConnected,
  markDisconnected,
  sweepStalePlayers,
  transferAbsentHosts,
} from '../services/presence.js';
import { buildRoomState, loadRoomSnapshot } from '../services/roomView.js';
import { and, eq } from 'drizzle-orm';
import type { ServerClock } from './clock.js';

/**
 * One Hub per process (per Neon Functions isolate). It owns the WebSocket
 * connections that landed on this isolate and does three jobs while it has
 * any:
 *
 *  1. Drive the game clock — every tick, advance any game in its rooms whose
 *     phase deadline has passed (advanceGame is idempotent and row-locked, so
 *     several isolates ticking the same room is harmless).
 *  2. Fan out state — poll each room's version and, when it moved, load one
 *     snapshot and send every local socket its own per-player view. Postgres
 *     is the only shared state between isolates; there is no broker.
 *  3. Presence — heartbeat local players, mark silent ones disconnected, and
 *     hand the host role on when a host stays away.
 *
 * With no sockets the timers do nothing, so an idle function can scale to zero.
 */

interface Connection {
  ws: WSContext;
  state: 'pending' | 'ready' | 'closed';
  playerId?: string;
  roomId?: string;
  authTimer?: ReturnType<typeof setTimeout>;
  windowStart: number;
  windowCount: number;
}

const AUTH_TIMEOUT_MS = 10_000;
const MAX_MESSAGE_BYTES = 4096;
const RATE_WINDOW_MS = 10_000;
const RATE_MAX_MESSAGES = 60;
const WS_OPEN = 1;

export interface HubDeps {
  db: Db;
  config: ServerConfig;
  clock: ServerClock;
  log?: Pick<Console, 'error' | 'warn' | 'info'>;
}

export class Hub {
  private readonly connections = new Set<Connection>();
  private readonly byRoom = new Map<string, Set<Connection>>();
  private readonly sentVersion = new Map<string, number>();
  private timers: ReturnType<typeof setInterval>[] = [];
  private tickRunning = false;
  private tickRequested = false;
  private presenceRunning = false;
  private stopped = false;

  constructor(private readonly deps: HubDeps) {}

  private get log() {
    return this.deps.log ?? console;
  }

  start(): void {
    if (this.timers.length > 0) return;
    this.stopped = false;
    const every = (ms: number, fn: () => Promise<void>) => {
      const t = setInterval(() => void fn(), ms);
      t.unref?.();
      this.timers.push(t);
    };
    every(this.deps.config.tickIntervalMs, () => this.tick());
    every(this.deps.config.presenceIntervalMs, () => this.presenceTick());
    every(60_000, async () => {
      if (this.connections.size > 0) await this.deps.clock.calibrate().catch(() => undefined);
    });
    void this.deps.clock.calibrate().catch((err: unknown) => this.log.warn('[hub] clock calibration failed', err));
  }

  stop(): void {
    // Sockets closed by a shutdown are not "players leaving"; skip presence writes.
    this.stopped = true;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    for (const conn of this.connections) this.close(conn, 1001, 'server shutting down');
  }

  get connectionCount(): number {
    return this.connections.size;
  }

  /** Ask for an immediate tick (used after a local REST mutation). */
  poke(): void {
    void this.tick();
  }

  /** Handlers for one WebSocket; pass the result to Hono's upgradeWebSocket. */
  socketHandlers(): WSEvents {
    let conn: Connection | undefined;
    return {
      onOpen: (_event, ws) => {
        conn = { ws, state: 'pending', windowStart: Date.now(), windowCount: 0 };
        this.connections.add(conn);
        const pending = conn;
        conn.authTimer = setTimeout(() => {
          if (pending.state === 'pending') this.close(pending, WS_CLOSE.AUTH_TIMEOUT, 'auth timeout');
        }, AUTH_TIMEOUT_MS);
        conn.authTimer.unref?.();
      },
      onMessage: (event, ws) => {
        // Some adapters can deliver a frame before onOpen fires.
        if (!conn) {
          conn = { ws, state: 'pending', windowStart: Date.now(), windowCount: 0 };
          this.connections.add(conn);
        }
        void this.handleMessage(conn, event.data);
      },
      onClose: () => {
        if (conn) this.handleClose(conn);
      },
      onError: () => {
        if (conn) this.handleClose(conn);
      },
    };
  }

  // ── Messages ───────────────────────────────────────────────────────────────

  private async handleMessage(conn: Connection, data: unknown): Promise<void> {
    if (conn.state === 'closed') return;

    const now = Date.now();
    if (now - conn.windowStart > RATE_WINDOW_MS) {
      conn.windowStart = now;
      conn.windowCount = 0;
    }
    if (++conn.windowCount > RATE_MAX_MESSAGES) {
      this.close(conn, WS_CLOSE.POLICY, 'too many messages');
      return;
    }

    const text =
      typeof data === 'string' ? data : data instanceof ArrayBuffer ? new TextDecoder().decode(data) : null;
    if (text === null || text.length > MAX_MESSAGE_BYTES) {
      this.close(conn, WS_CLOSE.POLICY, 'unsupported message');
      return;
    }

    let msg: ClientMessage;
    try {
      msg = JSON.parse(text) as ClientMessage;
    } catch {
      return;
    }

    if (msg?.type === 'ping' && typeof msg.t === 'number') {
      this.send(conn, { type: 'pong', t: msg.t, serverTime: this.deps.clock.now() });
      return;
    }
    if (msg?.type === 'auth' && conn.state === 'pending') {
      await this.authenticateConnection(conn, msg).catch((err: unknown) => {
        this.log.error('[hub] auth failed', err);
        this.fatal(conn, 'INTERNAL', 'Could not connect to the game. Retrying…');
      });
    }
  }

  private async authenticateConnection(conn: Connection, msg: Extract<ClientMessage, { type: 'auth' }>) {
    const { db } = this.deps;
    if (typeof msg.token !== 'string' || typeof msg.roomCode !== 'string') {
      return this.fatal(conn, 'BAD_REQUEST', 'Malformed auth message.');
    }
    const user = await authenticate(db, msg.token);
    if (!user) return this.fatal(conn, 'UNAUTHORIZED', 'Your session has expired. Rejoin the game.');
    const room = await findRoomByCode(db, msg.roomCode);
    if (!room) return this.fatal(conn, 'ROOM_NOT_FOUND', 'This game no longer exists.');
    const [player] = await db
      .select({ id: players.id })
      .from(players)
      .where(and(eq(players.roomId, room.id), eq(players.userId, user.id)))
      .limit(1);
    if (!player) return this.fatal(conn, 'NOT_IN_ROOM', 'Join this game first.');
    if (conn.state !== 'pending') return; // closed while we were checking

    if (conn.authTimer) clearTimeout(conn.authTimer);
    conn.state = 'ready';
    conn.playerId = player.id;
    conn.roomId = room.id;
    let members = this.byRoom.get(room.id);
    if (!members) this.byRoom.set(room.id, (members = new Set()));
    members.add(conn);

    // Reconnection restores identity, answers and score: they all live in the
    // database keyed by player id. Deadlines are absolute, so a reconnecting
    // player never gets extra time.
    await markConnected(db, player.id);
    await ensureGamePlayer(db, room.id, player.id);
    await advanceRoomIfDue(db, room.id);

    const snapshot = await loadRoomSnapshot(db, room.id);
    if (snapshot && conn.state === 'ready') {
      this.send(conn, { type: 'state', state: buildRoomState(snapshot, player.id) });
    }
    this.poke();
  }

  private handleClose(conn: Connection): void {
    if (conn.state === 'closed') return;
    const wasReady = conn.state === 'ready';
    conn.state = 'closed';
    if (conn.authTimer) clearTimeout(conn.authTimer);
    this.connections.delete(conn);

    const { roomId, playerId } = conn;
    if (!wasReady || !roomId || !playerId) return;
    const members = this.byRoom.get(roomId);
    members?.delete(conn);
    if (members && members.size === 0) {
      this.byRoom.delete(roomId);
      this.sentVersion.delete(roomId);
    }
    // Another tab of the same player on this isolate keeps them online.
    const stillHere = [...(members ?? [])].some((c) => c.playerId === playerId);
    if (!stillHere && !this.stopped) {
      void markDisconnected(this.deps.db, playerId)
        .then(() => this.poke())
        .catch((err: unknown) => this.log.error('[hub] markDisconnected failed', err));
    }
  }

  // ── Tick: deadlines + fan-out ──────────────────────────────────────────────

  async tick(): Promise<void> {
    if (this.tickRunning) {
      this.tickRequested = true;
      return;
    }
    this.tickRunning = true;
    try {
      do {
        this.tickRequested = false;
        const roomIds = [...this.byRoom.keys()];
        if (roomIds.length === 0) break;
        const { db } = this.deps;

        for (const gameId of await findDueGames(db, roomIds)) {
          await advanceGame(db, gameId);
        }

        const versions = await db
          .select({ id: rooms.id, version: rooms.version })
          .from(rooms)
          .where(inArray(rooms.id, roomIds));
        const changed = versions.filter((v) => this.sentVersion.get(v.id) !== v.version);
        await Promise.all(changed.map((v) => this.broadcast(v.id)));
      } while (this.tickRequested);
    } catch (err) {
      this.log.error('[hub] tick failed', err);
    } finally {
      this.tickRunning = false;
    }
  }

  private async broadcast(roomId: string): Promise<void> {
    const members = this.byRoom.get(roomId);
    if (!members || members.size === 0) return;
    const snapshot = await loadRoomSnapshot(this.deps.db, roomId);
    if (!snapshot) return;
    this.sentVersion.set(roomId, snapshot.room.version);
    for (const conn of members) {
      if (conn.state === 'ready' && conn.playerId) {
        this.send(conn, { type: 'state', state: buildRoomState(snapshot, conn.playerId) });
      }
    }
  }

  // ── Presence ───────────────────────────────────────────────────────────────

  async presenceTick(): Promise<void> {
    if (this.presenceRunning || this.byRoom.size === 0) return;
    this.presenceRunning = true;
    try {
      const { db, config } = this.deps;
      const playerIds = [
        ...new Set([...this.connections].filter((c) => c.state === 'ready').map((c) => c.playerId!)),
      ];
      const roomIds = [...this.byRoom.keys()];
      const touched = [
        ...(await heartbeat(db, playerIds)),
        ...(await sweepStalePlayers(db, roomIds, config.presenceTimeoutSec)),
        ...(await transferAbsentHosts(db, roomIds, config.hostTransferAfterSec)),
      ];
      if (touched.length > 0) this.poke();
    } catch (err) {
      this.log.error('[hub] presence failed', err);
    } finally {
      this.presenceRunning = false;
    }
  }

  // ── Socket helpers ─────────────────────────────────────────────────────────

  private send(conn: Connection, msg: ServerMessage): void {
    if (conn.state === 'closed' || conn.ws.readyState !== WS_OPEN) return;
    try {
      conn.ws.send(JSON.stringify(msg));
    } catch (err) {
      this.log.warn('[hub] send failed', err);
    }
  }

  /** Report an unrecoverable error, then close with the policy code (client won't retry). */
  private fatal(conn: Connection, code: ErrorCode, message: string): void {
    this.send(conn, { type: 'error', code, message, fatal: code !== 'INTERNAL' });
    this.close(conn, code === 'INTERNAL' ? 1011 : WS_CLOSE.POLICY, code);
  }

  private close(conn: Connection, code: number, reason: string): void {
    try {
      conn.ws.close(code, reason);
    } catch {
      // already closed
    }
    this.handleClose(conn);
  }
}
