import type { SessionResponse } from '@sliver/shared';
import { API_URL } from './config';

/**
 * The browser's anonymous identity. One token per browser, kept in
 * localStorage so a refresh, a dropped connection or a closed tab all come
 * back as the same player.
 */

const KEY = 'sliver.session';

export interface Session {
  token: string;
  userId: string;
}

function read(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Session>;
    return parsed.token && parsed.userId ? { token: parsed.token, userId: parsed.userId } : null;
  } catch {
    return null;
  }
}

function write(session: Session | null) {
  try {
    if (session) localStorage.setItem(KEY, JSON.stringify(session));
    else localStorage.removeItem(KEY);
  } catch {
    // Private mode without storage: the session lives for this page only.
  }
}

let current: Session | null = read();
let pending: Promise<Session> | null = null;

export function cachedSession(): Session | null {
  return current;
}

export function forgetSession(): void {
  current = null;
  write(null);
}

/** Returns the stored session, creating one on the server the first time. */
export function ensureSession(): Promise<Session> {
  if (current) return Promise.resolve(current);
  pending ??= (async () => {
    try {
      const res = await fetch(`${API_URL}/api/session`, { method: 'POST' });
      if (!res.ok) throw new Error(`Could not start a session (${res.status})`);
      const body = (await res.json()) as SessionResponse;
      current = { token: body.token, userId: body.userId };
      write(current);
      return current;
    } finally {
      pending = null;
    }
  })();
  return pending;
}

const NAME_KEY = 'sliver.name';

export function rememberedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function rememberName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // ignore
  }
}
