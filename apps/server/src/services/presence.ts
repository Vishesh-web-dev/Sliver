import { inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { players, rooms } from '../db/schema.js';

/**
 * Who is connected, as seen by every server instance.
 *
 * Sockets live in different isolates, so presence is stored in Postgres:
 * each isolate heartbeats the players it holds sockets for, and any isolate
 * watching a room marks players with a stale heartbeat as disconnected (that
 * covers an isolate that was evicted without closing its sockets).
 *
 * Each statement here is its own short transaction (no multi-row lock
 * ordering to worry about), followed by a version bump for affected rooms.
 */

const uuidArray = (ids: string[]) => sql`ARRAY[${sql.join(ids.map((id) => sql`${id}`), sql`, `)}]::uuid[]`;

async function bumpRooms(db: Db, roomIds: Iterable<string>): Promise<string[]> {
  const ids = [...new Set(roomIds)];
  if (ids.length > 0) {
    await db
      .update(rooms)
      .set({ version: sql`${rooms.version} + 1` })
      .where(inArray(rooms.id, ids));
  }
  return ids;
}

export async function markConnected(db: Db, playerId: string): Promise<boolean> {
  const changed = await db.execute<{ room_id: string }>(sql`
    UPDATE ${players}
       SET is_connected = true, last_seen_at = clock_timestamp(), disconnected_at = NULL
     WHERE id = ${playerId}::uuid AND NOT is_connected
     RETURNING room_id`);
  if (changed.rows.length === 0) {
    await db.execute(sql`UPDATE ${players} SET last_seen_at = clock_timestamp() WHERE id = ${playerId}::uuid`);
    return false;
  }
  await bumpRooms(db, changed.rows.map((r) => r.room_id));
  return true;
}

export async function markDisconnected(db: Db, playerId: string): Promise<boolean> {
  const changed = await db.execute<{ room_id: string }>(sql`
    UPDATE ${players}
       SET is_connected = false, disconnected_at = clock_timestamp()
     WHERE id = ${playerId}::uuid AND is_connected
     RETURNING room_id`);
  await bumpRooms(db, changed.rows.map((r) => r.room_id));
  return changed.rows.length > 0;
}

/** Refreshes last_seen for players with a live socket here; revives any marked offline. */
export async function heartbeat(db: Db, playerIds: string[]): Promise<string[]> {
  if (playerIds.length === 0) return [];
  await db.execute(sql`
    UPDATE ${players} SET last_seen_at = clock_timestamp()
     WHERE id = ANY(${uuidArray(playerIds)})`);
  const revived = await db.execute<{ room_id: string }>(sql`
    UPDATE ${players}
       SET is_connected = true, disconnected_at = NULL
     WHERE id = ANY(${uuidArray(playerIds)}) AND NOT is_connected
     RETURNING room_id`);
  return bumpRooms(db, revived.rows.map((r) => r.room_id));
}

/** Players in these rooms whose heartbeat stopped are shown as disconnected. */
export async function sweepStalePlayers(db: Db, roomIds: string[], timeoutSec: number): Promise<string[]> {
  if (roomIds.length === 0) return [];
  const stale = await db.execute<{ room_id: string }>(sql`
    UPDATE ${players}
       SET is_connected = false, disconnected_at = clock_timestamp()
     WHERE room_id = ANY(${uuidArray(roomIds)})
       AND is_connected
       AND (last_seen_at IS NULL OR last_seen_at < clock_timestamp() - make_interval(secs => ${timeoutSec}))
     RETURNING room_id`);
  return bumpRooms(db, stale.rows.map((r) => r.room_id));
}

/**
 * Host transfer (spec §20): when the host has been disconnected for a while,
 * the longest-standing connected player becomes host. A single UPDATE, so two
 * isolates cannot pick different new hosts.
 */
export async function transferAbsentHosts(db: Db, roomIds: string[], afterSec: number): Promise<string[]> {
  if (roomIds.length === 0) return [];
  const moved = await db.execute<{ id: string }>(sql`
    UPDATE ${rooms} AS r
       SET host_player_id = cand.id, version = r.version + 1
      FROM ${players} AS h,
           LATERAL (
             SELECT p.id FROM ${players} p
              WHERE p.room_id = h.room_id AND p.is_connected AND p.id <> h.id
              ORDER BY p.joined_at
              LIMIT 1
           ) AS cand
     WHERE r.id = ANY(${uuidArray(roomIds)})
       AND h.id = r.host_player_id
       AND NOT h.is_connected
       AND h.disconnected_at < clock_timestamp() - make_interval(secs => ${afterSec})
     RETURNING r.id`);
  return moved.rows.map((r) => r.id);
}
