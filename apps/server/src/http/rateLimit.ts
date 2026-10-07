import type { MiddlewareHandler } from 'hono';
import { AppError } from './errors.js';

/**
 * Small fixed-window limiter for the unauthenticated, enumerable endpoints
 * (session creation, room lookup, joining). In-memory per isolate: it blunts
 * room-code guessing and accidental loops without needing Redis. Real
 * multi-instance rate limiting would move this to Postgres or an edge WAF.
 */
export function rateLimit(opts: { name: string; limit: number; windowMs: number; enabled: boolean }): MiddlewareHandler {
  const hits = new Map<string, { start: number; count: number }>();
  return async (c, next) => {
    if (!opts.enabled) return next();
    const ip =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
      c.req.header('x-real-ip') ||
      c.req.header('cf-connecting-ip') ||
      'unknown';
    const key = `${opts.name}:${ip}`;
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || now - entry.start > opts.windowMs) {
      hits.set(key, { start: now, count: 1 });
      if (hits.size > 10_000) {
        for (const [k, v] of hits) if (now - v.start > opts.windowMs) hits.delete(k);
      }
    } else if (++entry.count > opts.limit) {
      throw new AppError('RATE_LIMITED', 'Too many requests. Wait a moment and try again.');
    }
    return next();
  };
}
