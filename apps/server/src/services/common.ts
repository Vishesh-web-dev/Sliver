import { and, eq, sql } from 'drizzle-orm';
import { normalizeRoomCode } from '@sliver/shared';
import type { DbOrTx } from '../db/client.js';
import { players, rooms, type PlayerRow, type RoomRow } from '../db/schema.js';
import { fail } from '../http/errors.js';

/**
 * Row-lock order used by every transaction that touches more than one of
 * these rows (keeps concurrent answers, ticks, joins and edits deadlock-free):
 *
 *   question_sets → rooms         (start game, edit/delete set)
 *   games         → rooms         (submit answer, advance phase, end game)
 *   rooms alone                   (join, settings, host transfer, restart)
 *
 * Foreign-key checks take FOR KEY SHARE, which never conflicts with the
 * FOR NO KEY UPDATE / FOR SHARE locks used on games.
 */

/** Never wait on a row lock for long; the caller (or the next tick) retries. */
export async function setLockTimeout(tx: DbOrTx, ms = 5000): Promise<void> {
  await tx.execute(sql.raw(`SET LOCAL lock_timeout = '${Math.trunc(ms)}ms'`));
}

/** Every visible change bumps the room version so all hubs push fresh state. */
export async function bumpRoomVersion(tx: DbOrTx, roomId: string): Promise<void> {
  await tx
    .update(rooms)
    .set({ version: sql`${rooms.version} + 1` })
    .where(eq(rooms.id, roomId));
}

export async function findRoomByCode(db: DbOrTx, rawCode: string): Promise<RoomRow | null> {
  const code = normalizeRoomCode(rawCode);
  if (!code) return null;
  const [room] = await db.select().from(rooms).where(eq(rooms.code, code)).limit(1);
  return room ?? null;
}

export async function requireRoom(db: DbOrTx, rawCode: string): Promise<RoomRow> {
  const room = await findRoomByCode(db, rawCode);
  if (!room) return fail('ROOM_NOT_FOUND', 'No game with that code. Check the code and try again.');
  return room;
}

export async function requireRoomPlayer(
  db: DbOrTx,
  rawCode: string,
  userId: string,
): Promise<{ room: RoomRow; player: PlayerRow }> {
  const room = await requireRoom(db, rawCode);
  const [player] = await db
    .select()
    .from(players)
    .where(and(eq(players.roomId, room.id), eq(players.userId, userId)))
    .limit(1);
  if (!player) return fail('NOT_IN_ROOM', 'Join this game first.');
  return { room, player };
}

export function requireHost(room: RoomRow, player: PlayerRow): void {
  if (room.hostPlayerId !== player.id) fail('NOT_HOST', 'Only the host can do that.');
}
