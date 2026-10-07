import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClientMessage, ErrorCode, RoomState, ServerMessage } from '@sliver/shared';
import { api, ApiError } from './api';
import { ClockSync } from './clock';
import { WS_URL } from './config';
import { ensureSession } from './session';

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting';

export interface FatalError {
  code: ErrorCode | 'NETWORK';
  message: string;
}

export interface RoomConnection {
  state: RoomState | null;
  status: ConnectionStatus;
  fatal: FatalError | null;
  /** Current time on the server's clock (epoch ms). Use for every countdown. */
  serverNow: () => number;
  /** Re-fetch over REST, e.g. after an action this tab took. */
  refresh: () => Promise<void>;
}

const FATAL_CODES = new Set<string>(['UNAUTHORIZED', 'ROOM_NOT_FOUND', 'NOT_IN_ROOM', 'BAD_REQUEST']);
const PING_EVERY_MS = 15_000;
const POLL_FALLBACK_MS = 3_000;

/**
 * Live connection to one room.
 *
 * - One WebSocket; the first frame authenticates with the stored session.
 * - The server pushes the full per-player RoomState on every change; newer
 *   versions replace older ones, so out-of-order frames are harmless.
 * - Pings measure the server clock offset (and keep proxies from idling the
 *   socket out).
 * - Drops reconnect with capped exponential backoff + jitter, immediately when
 *   the tab becomes visible or the network returns. While disconnected, the
 *   room is polled over REST so the screen never freezes.
 */
export function useRoom(code: string): RoomConnection {
  const [state, setState] = useState<RoomState | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [fatal, setFatal] = useState<FatalError | null>(null);
  const clock = useMemo(() => new ClockSync(), []);
  const fatalRef = useRef(false);

  const apply = useCallback((next: RoomState) => {
    setState((prev) => (!prev || next.version >= prev.version ? next : prev));
  }, []);

  const failHard = useCallback((error: FatalError) => {
    fatalRef.current = true;
    setFatal(error);
  }, []);

  const refresh = useCallback(async () => {
    try {
      apply(await api.roomState(code));
    } catch (err) {
      if (err instanceof ApiError && FATAL_CODES.has(err.code)) failHard({ code: err.code, message: err.message });
    }
  }, [apply, code, failHard]);

  useEffect(() => {
    fatalRef.current = false;
    setFatal(null);
    setState(null);

    let disposed = false;
    let ws: WebSocket | null = null;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimers: ReturnType<typeof setTimeout>[] = [];

    const send = (msg: ClientMessage) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    };
    const ping = () => send({ type: 'ping', t: Date.now() });

    const clearPings = () => {
      for (const t of pingTimers) clearTimeout(t);
      pingTimers = [];
    };

    const scheduleReconnect = (delay?: number) => {
      if (disposed || fatalRef.current) return;
      clearTimeout(reconnectTimer);
      const backoff = Math.min(8_000, 500 * 2 ** attempt) * (0.8 + Math.random() * 0.4);
      attempt++;
      reconnectTimer = setTimeout(connect, delay ?? backoff);
    };

    async function connect() {
      if (disposed || fatalRef.current) return;
      setStatus(attempt === 0 ? 'connecting' : 'reconnecting');
      let token: string;
      try {
        token = (await ensureSession()).token;
      } catch {
        scheduleReconnect();
        return;
      }
      if (disposed) return;

      const socket = new WebSocket(WS_URL);
      ws = socket;

      socket.onopen = () => {
        if (ws !== socket) return;
        socket.send(JSON.stringify({ type: 'auth', token, roomCode: code } satisfies ClientMessage));
        // A quick burst of samples for an accurate clock, then a slow keepalive.
        pingTimers = [0, 200, 400, 700, 1000].map((ms) => setTimeout(ping, ms));
        const keepalive = setInterval(ping, PING_EVERY_MS);
        pingTimers.push(keepalive as unknown as ReturnType<typeof setTimeout>);
      };

      socket.onmessage = (event) => {
        if (ws !== socket) return;
        let msg: ServerMessage;
        try {
          msg = JSON.parse(String(event.data)) as ServerMessage;
        } catch {
          return;
        }
        if (msg.type === 'state') {
          attempt = 0;
          setStatus('open');
          apply(msg.state);
        } else if (msg.type === 'pong') {
          clock.record(msg.t, msg.serverTime);
        } else if (msg.type === 'error' && msg.fatal) {
          failHard({ code: msg.code, message: msg.message });
        }
      };

      socket.onclose = () => {
        if (ws !== socket) return;
        clearPings();
        ws = null;
        if (disposed || fatalRef.current) return;
        setStatus('reconnecting');
        scheduleReconnect();
      };
    }

    const wakeUp = () => {
      if (document.visibilityState === 'visible' && !ws && !disposed) {
        attempt = 0;
        scheduleReconnect(0);
      }
    };
    document.addEventListener('visibilitychange', wakeUp);
    window.addEventListener('online', wakeUp);

    // REST fallback while the socket is down.
    const poll = setInterval(() => {
      if (!ws || ws.readyState !== WebSocket.OPEN) void refresh();
    }, POLL_FALLBACK_MS);

    void connect();

    return () => {
      disposed = true;
      clearTimeout(reconnectTimer);
      clearInterval(poll);
      clearPings();
      document.removeEventListener('visibilitychange', wakeUp);
      window.removeEventListener('online', wakeUp);
      ws?.close();
      ws = null;
    };
  }, [apply, clock, code, failHard, refresh]);

  const serverNow = useCallback(() => clock.now(), [clock]);
  return { state, status, fatal, serverNow, refresh };
}

/** Re-renders every `intervalMs` while `active`; returns the server-clock time. */
export function useServerNow(serverNow: () => number, active: boolean, intervalMs = 100): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    if (!active) return;
    setNow(serverNow());
    const t = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs, serverNow]);
  return active ? now : serverNow();
}
