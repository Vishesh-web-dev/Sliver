import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { users, type User } from '../db/schema.js';

/**
 * Anonymous sessions. A browser asks for a session once and keeps the token in
 * localStorage; every later request carries it as `Authorization: Bearer …`
 * (REST) or in the first WebSocket message. Only a SHA-256 of the token is
 * stored, so a database leak does not leak usable sessions.
 *
 * The token is the player's identity across reconnects: same token → same
 * user → same seat in every room they joined.
 */

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(db: Db): Promise<{ token: string; user: User }> {
  const token = generateToken();
  const [user] = await db.insert(users).values({ tokenHash: hashToken(token) }).returning();
  if (!user) throw new Error('Failed to create session');
  return { token, user };
}

export async function authenticate(db: Db, token: string | null | undefined): Promise<User | null> {
  if (!token || !TOKEN_PATTERN.test(token)) return null;
  const [user] = await db.select().from(users).where(eq(users.tokenHash, hashToken(token))).limit(1);
  return user ?? null;
}

export function bearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match?.[1] ?? null;
}
