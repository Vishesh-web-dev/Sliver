import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ROOM_CODE_PATTERN, type RoomPreview } from '@sliver/shared';
import type { LocalServer } from '../src/entry/local.js';
import { expectApiError, Player, resetDb, startTestServer } from './helpers.js';

let server: LocalServer;
const player = (name: string) => new Player(server.url, name).session();

beforeAll(async () => {
  server = await startTestServer({ maxPlayersPerRoom: 4 });
});
beforeEach(async () => resetDb(server.db));
afterAll(async () => server.close());

describe('room creation', () => {
  it('creates a room with a unique code and makes the creator host', async () => {
    const host = await player('Anjali');
    const { code, playerId } = await host.createRoom();
    expect(code).toMatch(ROOM_CODE_PATTERN);

    const state = await host.state();
    expect(state.phase).toBe('LOBBY');
    expect(state.room.hostPlayerId).toBe(playerId);
    expect(state.me).toMatchObject({ playerId, isHost: true, name: 'Anjali' });
    expect(state.room.questionSet?.name).toBe('Sliver Starter');
    expect(state.room.playableQuestionCount).toBe(12);
  });

  it('requires a session', async () => {
    const anon = new Player(server.url, 'Nobody');
    await expectApiError(anon.createRoom(), 'UNAUTHORIZED', 401);
  });

  it('validates input on the server', async () => {
    const host = await player('   ');
    await expectApiError(host.createRoom(), 'BAD_REQUEST', 400);
  });
});

describe('joining', () => {
  it('joins by code (any case) and shows up in the lobby', async () => {
    const host = await player('Anjali');
    const { code } = await host.createRoom();
    const rahul = await player('Rahul');
    await rahul.join(code.toLowerCase());

    const state = await host.state();
    expect(state.players.map((p) => p.name)).toEqual(['Anjali', 'Rahul']);
    expect(state.players.find((p) => p.name === 'Anjali')?.isHost).toBe(true);
  });

  it('previews a room without joining', async () => {
    const host = await player('Anjali');
    const { code } = await host.createRoom({ gameName: 'Friday Night Quiz' });
    const visitor = await player('Kunal');
    const preview = await visitor.request<RoomPreview>('GET', `/rooms/${code}`);
    expect(preview).toMatchObject({ code, name: 'Friday Night Quiz', phase: 'LOBBY', playerCount: 1, hostName: 'Anjali', myPlayerId: null });
  });

  it('rejects unknown and malformed codes', async () => {
    const p = await player('Rahul');
    await expectApiError(p.join('ZZZZZ'), 'ROOM_NOT_FOUND', 404);
    await expectApiError(p.join('not-a-code'), 'ROOM_NOT_FOUND', 404);
  });

  it('rejects a name already used in the room, ignoring case', async () => {
    const host = await player('Anjali');
    const { code } = await host.createRoom();
    const other = await player('anjali');
    await expectApiError(other.join(code), 'NAME_TAKEN', 409);
  });

  it('is idempotent for the same browser (rejoin keeps the same seat)', async () => {
    const host = await player('Anjali');
    const { code } = await host.createRoom();
    const rahul = await player('Rahul');
    const first = await rahul.join(code);
    const again = await rahul.join(code);
    expect(again.playerId).toBe(first.playerId);
    expect((await host.state()).players).toHaveLength(2);
  });

  it('enforces the configured room capacity', async () => {
    const host = await player('P1');
    const { code } = await host.createRoom();
    for (const name of ['P2', 'P3', 'P4']) await (await player(name)).join(code);
    await expectApiError((await player('P5')).join(code), 'ROOM_FULL', 409);
  });

  it('works with just two players', async () => {
    const host = await player('Anjali');
    const { code } = await host.createRoom();
    const rahul = await player('Rahul');
    await rahul.join(code);
    await host.start();
    expect((await rahul.state()).phase).toBe('STARTING');
  });
});

describe('host authorisation', () => {
  it('only the host can start, configure or end the game', async () => {
    const host = await player('Anjali');
    const { code } = await host.createRoom();
    const rahul = await player('Rahul');
    await rahul.join(code);

    await expectApiError(rahul.start(), 'NOT_HOST', 403);
    await expectApiError(rahul.request('PATCH', `/rooms/${code}`, { gameName: 'Mine now' }), 'NOT_HOST', 403);
    await host.start();
    await expectApiError(rahul.request('POST', `/rooms/${code}/end`), 'NOT_HOST', 403);
  });

  it('settings can be changed in the lobby only', async () => {
    const host = await player('Anjali');
    const { code } = await host.createRoom();
    await host.request('PATCH', `/rooms/${code}`, { gameName: 'Renamed' });
    expect((await host.state()).room.name).toBe('Renamed');
    await host.start();
    await expectApiError(host.request('PATCH', `/rooms/${code}`, { gameName: 'Again' }), 'INVALID_STATE', 409);
  });

  it('the host can hand the host role to another player', async () => {
    const host = await player('Anjali');
    const { code } = await host.createRoom();
    const rahul = await player('Rahul');
    await rahul.join(code);
    await host.request('POST', `/rooms/${code}/host`, { playerId: rahul.playerId });
    const state = await rahul.state();
    expect(state.me.isHost).toBe(true);
    await expectApiError(host.start(), 'NOT_HOST', 403);
  });

  it('cannot start without a question set', async () => {
    const host = await player('Anjali');
    await host.createRoom({ questionSetId: null });
    await expectApiError(host.start(), 'NO_QUESTION_SET', 409);
  });
});
