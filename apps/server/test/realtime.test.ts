import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WS_CLOSE } from '@sliver/shared';
import type { LocalServer } from '../src/entry/local.js';
import { drain, Player, resetDb, sleep, Socket, startTestServer, travel, travelToDeadline } from './helpers.js';

let server: LocalServer;
const player = (name: string) => new Player(server.url, name).session();
const sockets: Socket[] = [];
const connect = async (p: Player) => {
  const s = await p.connect();
  sockets.push(s);
  return s;
};

beforeAll(async () => {
  server = await startTestServer({ presenceIntervalMs: 200, presenceTimeoutSec: 1, hostTransferAfterSec: 1 });
});
beforeEach(async () => resetDb(server.db));
afterEach(async () => {
  for (const s of sockets.splice(0)) s.close();
  await drain(server);
});
afterAll(async () => server.close());


describe('WebSocket channel', () => {
  it('pushes the room state on connect and whenever someone joins', async () => {
    const host = await player('Anjali');
    await host.createRoom();
    const ws = await connect(host);
    await ws.waitFor((s) => s.phase === 'LOBBY' && s.players.length === 1);

    const rahul = await player('Rahul');
    await rahul.join(host.code);
    const state = await ws.waitFor((s) => s.players.length === 2);
    expect(state.players.map((p) => p.name)).toEqual(['Anjali', 'Rahul']);
  });

  it('marks players connected and disconnected for everyone', async () => {
    const host = await player('Anjali');
    await host.createRoom();
    const rahul = await player('Rahul');
    await rahul.join(host.code);
    const hostWs = await connect(host);
    const rahulWs = await connect(rahul);
    await hostWs.waitFor((s) => s.players.every((p) => p.connected));

    rahulWs.close();
    const state = await hostWs.waitFor((s) => s.players.some((p) => p.name === 'Rahul' && !p.connected));
    expect(state.players.find((p) => p.name === 'Anjali')?.connected).toBe(true);
  });

  it('refuses sockets without a valid session or seat, and does not retry them', async () => {
    const host = await player('Anjali');
    await host.createRoom();

    const bad = await Socket.open(server.url, 'x'.repeat(43), host.code);
    expect((await bad.waitForClose()).code).toBe(WS_CLOSE.POLICY);
    expect(bad.messages[0]).toMatchObject({ type: 'error', code: 'UNAUTHORIZED', fatal: true });

    const stranger = await player('Stranger');
    const notJoined = await Socket.open(server.url, stranger.token, host.code);
    expect((await notJoined.waitForClose()).code).toBe(WS_CLOSE.POLICY);
    expect(notJoined.messages[0]).toMatchObject({ type: 'error', code: 'NOT_IN_ROOM' });
  });

  it('answers clock-sync pings with the server time', async () => {
    const host = await player('Anjali');
    await host.createRoom();
    const ws = await connect(host);
    const t = Date.now();
    ws.send({ type: 'ping', t });
    for (let i = 0; i < 50 && !ws.messages.some((m) => m.type === 'pong'); i++) await sleep(20);
    const pong = ws.messages.find((m) => m.type === 'pong');
    expect(pong).toMatchObject({ type: 'pong', t });
    expect(Math.abs((pong as { serverTime: number }).serverTime - Date.now())).toBeLessThan(2000);
  });

  it('drives the game clock from the server: phases advance with no client involvement', async () => {
    const host = await player('Anjali');
    await host.createRoom();
    const ws = await connect(host);
    await ws.waitFor((s) => s.phase === 'LOBBY');
    const { gameId } = await host.start();
    await ws.waitFor((s) => s.phase === 'STARTING');

    await travelToDeadline(server.db, gameId);
    const open = await ws.waitFor((s) => s.phase === 'QUESTION_ACTIVE');
    expect(open.game?.question?.index).toBe(0);

    await travelToDeadline(server.db, gameId);
    const results = await ws.waitFor((s) => s.phase === 'RESULTS');
    expect(results.game?.reveal?.correct).toBeDefined();
  });
});

describe('reconnection', () => {
  it('restores identity, the locked answer and the remaining time — never extra time', async () => {
    const host = await player('Anjali');
    await host.createRoom();
    const rahul = await player('Rahul');
    await rahul.join(host.code);
    const { gameId } = await host.start();
    await travelToDeadline(server.db, gameId);

    let ws = await connect(rahul);
    const before = await ws.waitFor((s) => s.phase === 'QUESTION_ACTIVE');
    const q = before.game!.question!;
    await rahul.answer(q.id, { optionIndex: 2 });
    await ws.waitFor((s) => s.game?.myAnswer !== null);

    // Connection drops; ten seconds pass while offline.
    ws.close();
    await travel(server.db, gameId, 10);

    ws = await connect(rahul);
    const after = await ws.waitFor((s) => s.phase === 'QUESTION_ACTIVE');
    expect(after.me.playerId).toBe(rahul.playerId);
    expect(after.game?.question?.id).toBe(q.id);
    expect(after.game?.myAnswer?.optionIndex).toBe(2);
    // Same absolute deadline, shifted only by the 10s that elapsed: no extra time.
    expect(after.game!.phaseEndsAt).toBe(before.game!.phaseEndsAt! - 10_000);
  });

  it('shows the results to a player who reconnects after the question ended', async () => {
    const host = await player('Anjali');
    await host.createRoom();
    const { gameId } = await host.start();
    await travelToDeadline(server.db, gameId);
    let ws = await connect(host);
    await ws.waitFor((s) => s.phase === 'QUESTION_ACTIVE');
    ws.close();
    await sleep(50);

    await travelToDeadline(server.db, gameId);
    ws = await connect(host);
    const state = await ws.waitFor((s) => s.phase === 'RESULTS');
    expect(state.game?.myResult).toMatchObject({ answered: false, points: 0 });
  });

  it('keeps the score of a player who leaves, and hands the host role on', async () => {
    const host = await player('Anjali');
    await host.createRoom();
    const rahul = await player('Rahul');
    await rahul.join(host.code);
    const hostWs = await connect(host);
    const rahulWs = await connect(rahul);
    await rahulWs.waitFor((s) => s.players.every((p) => p.connected));

    hostWs.close();
    // After the (test-shortened) grace period, the longest-standing connected player becomes host.
    const state = await rahulWs.waitFor((s) => s.room.hostPlayerId === rahul.playerId, 8000);
    expect(state.me.isHost).toBe(true);
    expect(state.players.find((p) => p.name === 'Anjali')).toMatchObject({ connected: false, isHost: false });
  });
});
