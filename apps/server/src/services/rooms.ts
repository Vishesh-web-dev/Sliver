import { and, count, eq, ne, sql } from 'drizzle-orm';
import {
  ACTIVE_GAME_STATUSES,
  normalizeRoomCode,
  type CreateRoomResponse,
  type GameSettings,
  type JoinRoomResponse,
  type Phase,
  type RoomPreview,
} from '@sliver/shared';
import type { ServerConfig } from '../config.js';
import type { Db, DbOrTx } from '../db/client.js';
import { gamePlayers, games, players, rooms, users, type RoomRow, type User } from '../db/schema.js';
import { generateRoomCode } from '../domain/roomCode.js';
import { AppError, fail, pgCode, pgConstraint, PG_UNIQUE_VIOLATION } from '../http/errors.js';
import {
  bumpRoomVersion,
  requireHost,
  requireRoom,
  requireRoomPlayer,
  setLockTimeout,
} from './common.js';
import { assertVisibleQuestionSet } from './questionSets.js';

const nameTaken = () =>
  new AppError('NAME_TAKEN', 'Someone in this game already uses that name. Pick another one.');

function rethrowNameConflict(err: unknown): never {
  if (pgCode(err) === PG_UNIQUE_VIOLATION && pgConstraint(err) === 'players_room_name_uq') {
    throw nameTaken();
  }
  throw err;
}

async function phaseOf(db: DbOrTx, room: RoomRow): Promise<Phase> {
  if (!room.currentGameId) return 'LOBBY';
  const [game] = await db
    .select({ status: games.status })
    .from(games)
    .where(eq(games.id, room.currentGameId))
    .limit(1);
  return game?.status ?? 'LOBBY';
}

async function isNameTaken(tx: DbOrTx, roomId: string, name: string, exceptPlayerId?: string) {
  const conditions = [eq(players.roomId, roomId), sql`lower(${players.displayName}) = lower(${name})`];
  if (exceptPlayerId) conditions.push(ne(players.id, exceptPlayerId));
  const [hit] = await tx
    .select({ id: players.id })
    .from(players)
    .where(and(...conditions))
    .limit(1);
  return Boolean(hit);
}

export interface CreateRoomInput {
  gameName: string;
  displayName: string;
  questionSetId: string | null;
  settings: GameSettings;
}

export async function createRoom(db: Db, user: User, input: CreateRoomInput): Promise<CreateRoomResponse> {
  return db.transaction(async (tx) => {
    if (input.questionSetId) await assertVisibleQuestionSet(tx, user.id, input.questionSetId);

    let room: RoomRow | undefined;
    for (let attempt = 0; attempt < 10 && !room; attempt++) {
      [room] = await tx
        .insert(rooms)
        .values({
          code: generateRoomCode(),
          name: input.gameName,
          questionSetId: input.questionSetId,
          settings: input.settings,
        })
        .onConflictDoNothing({ target: rooms.code })
        .returning();
    }
    if (!room) throw new Error('Could not allocate a unique room code');

    const [host] = await tx
      .insert(players)
      .values({ roomId: room.id, userId: user.id, displayName: input.displayName })
      .returning();
    if (!host) throw new Error('Failed to create host player');

    await tx.update(rooms).set({ hostPlayerId: host.id }).where(eq(rooms.id, room.id));
    await tx.update(users).set({ displayName: input.displayName }).where(eq(users.id, user.id));
    return { code: room.code, playerId: host.id };
  });
}

/**
 * Join by code. Idempotent for the same browser identity: calling it again
 * returns the existing seat (that is how a returning player reclaims their
 * score). The room row is locked so the capacity and name checks cannot race.
 */
export async function joinRoom(
  db: Db,
  user: User,
  rawCode: string,
  displayName: string,
  config: ServerConfig,
): Promise<JoinRoomResponse> {
  const code = normalizeRoomCode(rawCode);
  if (!code) return fail('ROOM_NOT_FOUND', 'No game with that code. Check the code and try again.');

  try {
    return await db.transaction(async (tx) => {
      await setLockTimeout(tx);
      const [room] = await tx.select().from(rooms).where(eq(rooms.code, code)).for('update');
      if (!room) return fail('ROOM_NOT_FOUND', 'No game with that code. Check the code and try again.');

      const [existing] = await tx
        .select()
        .from(players)
        .where(and(eq(players.roomId, room.id), eq(players.userId, user.id)))
        .limit(1);

      if (existing) {
        // Renaming is allowed in the lobby only; mid-game names stay stable.
        if (existing.displayName !== displayName && room.currentGameId === null) {
          if (await isNameTaken(tx, room.id, displayName, existing.id)) throw nameTaken();
          await tx.update(players).set({ displayName }).where(eq(players.id, existing.id));
          await bumpRoomVersion(tx, room.id);
        }
        return { code: room.code, playerId: existing.id };
      }

      const [{ value: playerCount } = { value: 0 }] = await tx
        .select({ value: count() })
        .from(players)
        .where(eq(players.roomId, room.id));
      if (playerCount >= config.maxPlayersPerRoom) {
        return fail('ROOM_FULL', `This game is full (${config.maxPlayersPerRoom} players).`);
      }
      if (await isNameTaken(tx, room.id, displayName)) throw nameTaken();

      const [player] = await tx
        .insert(players)
        .values({ roomId: room.id, userId: user.id, displayName })
        .returning();
      if (!player) throw new Error('Failed to create player');

      // Late joiners play from the current question on.
      if (room.currentGameId) {
        const [game] = await tx
          .select({ status: games.status })
          .from(games)
          .where(eq(games.id, room.currentGameId));
        if (game && (ACTIVE_GAME_STATUSES as readonly string[]).includes(game.status)) {
          await tx
            .insert(gamePlayers)
            .values({ gameId: room.currentGameId, playerId: player.id })
            .onConflictDoNothing();
        }
      }

      await bumpRoomVersion(tx, room.id);
      await tx.update(users).set({ displayName }).where(eq(users.id, user.id));
      return { code: room.code, playerId: player.id };
    });
  } catch (err) {
    return rethrowNameConflict(err);
  }
}

export async function getRoomPreview(db: Db, rawCode: string, userId: string | null): Promise<RoomPreview> {
  const room = await requireRoom(db, rawCode);
  const roster = await db
    .select({ id: players.id, userId: players.userId, displayName: players.displayName })
    .from(players)
    .where(eq(players.roomId, room.id));
  const host = roster.find((p) => p.id === room.hostPlayerId);
  const me = userId ? roster.find((p) => p.userId === userId) : undefined;
  return {
    code: room.code,
    name: room.name,
    phase: await phaseOf(db, room),
    playerCount: roster.length,
    hostName: host?.displayName ?? null,
    myPlayerId: me?.id ?? null,
    myDisplayName: me?.displayName ?? null,
  };
}

export interface UpdateRoomInput {
  gameName?: string | undefined;
  questionSetId?: string | null | undefined;
  settings?: GameSettings | undefined;
}

/** Host-only, lobby-only: game name, question set and settings for the next game. */
export async function updateRoom(db: Db, userId: string, rawCode: string, input: UpdateRoomInput): Promise<void> {
  const { room, player } = await requireRoomPlayer(db, rawCode, userId);
  requireHost(room, player);
  if (input.questionSetId) await assertVisibleQuestionSet(db, userId, input.questionSetId);

  await db.transaction(async (tx) => {
    await setLockTimeout(tx);
    const [locked] = await tx.select().from(rooms).where(eq(rooms.id, room.id)).for('update');
    if (!locked) return fail('ROOM_NOT_FOUND', 'Room not found');
    if (locked.hostPlayerId !== player.id) return fail('NOT_HOST', 'Only the host can do that.');
    if (locked.currentGameId !== null) {
      return fail('INVALID_STATE', 'Settings can only be changed in the lobby.');
    }
    await tx
      .update(rooms)
      .set({
        ...(input.gameName !== undefined ? { name: input.gameName } : {}),
        ...(input.questionSetId !== undefined ? { questionSetId: input.questionSetId } : {}),
        ...(input.settings !== undefined ? { settings: input.settings } : {}),
        version: sql`${rooms.version} + 1`,
      })
      .where(eq(rooms.id, room.id));
  });
}

export async function transferHost(db: Db, userId: string, rawCode: string, targetPlayerId: string): Promise<void> {
  const { room, player } = await requireRoomPlayer(db, rawCode, userId);
  requireHost(room, player);
  if (targetPlayerId === player.id) return;

  await db.transaction(async (tx) => {
    await setLockTimeout(tx);
    const [locked] = await tx.select().from(rooms).where(eq(rooms.id, room.id)).for('update');
    if (!locked || locked.hostPlayerId !== player.id) return fail('NOT_HOST', 'Only the host can do that.');
    const [target] = await tx
      .select({ id: players.id })
      .from(players)
      .where(and(eq(players.id, targetPlayerId), eq(players.roomId, room.id)));
    if (!target) return fail('NOT_FOUND', 'That player is not in this game.');
    await tx
      .update(rooms)
      .set({ hostPlayerId: target.id, version: sql`${rooms.version} + 1` })
      .where(eq(rooms.id, room.id));
  });
}

