export interface ServerConfig {
  databaseUrl: string;
  dbPoolMax: number;
  port: number;
  /** Browser origins allowed by CORS. Empty = allow none (same-origin only). */
  allowedOrigins: string[];
  /**
   * Soft cap per room. Not a game rule: Neon Functions allow ~100 concurrent
   * invocations per account by default and each connected player holds one.
   */
  maxPlayersPerRoom: number;
  /** How often each isolate checks deadlines and room versions while it has sockets. */
  tickIntervalMs: number;
  presenceIntervalMs: number;
  /** A player with no heartbeat for this long is shown as disconnected. */
  presenceTimeoutSec: number;
  /** Host is handed to another player after being disconnected this long. */
  hostTransferAfterSec: number;
  rateLimit: boolean;
}

function int(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set. Locally: copy apps/server/.env.example to apps/server/.env.');
  }
  return {
    databaseUrl,
    dbPoolMax: int(env.DB_POOL_MAX, 5),
    port: int(env.PORT, 8787),
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim().replace(/\/$/, ''))
      .filter(Boolean),
    maxPlayersPerRoom: int(env.MAX_PLAYERS_PER_ROOM, 50),
    tickIntervalMs: int(env.TICK_INTERVAL_MS, 250),
    presenceIntervalMs: int(env.PRESENCE_INTERVAL_MS, 5_000),
    presenceTimeoutSec: int(env.PRESENCE_TIMEOUT_SEC, 20),
    hostTransferAfterSec: int(env.HOST_TRANSFER_AFTER_SEC, 30),
    rateLimit: env.RATE_LIMIT !== 'off',
  };
}
