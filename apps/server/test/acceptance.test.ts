import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { RoomState } from '@sliver/shared';
import type { LocalServer } from '../src/entry/local.js';
import {
  expectApiError,
  Player,
  resetDb,
  type Socket,
  startTestServer,
  THREE_QUESTIONS,
  travel,
  travelToDeadline,
} from './helpers.js';

/**
 * Spec §30 — the critical acceptance scenario, end to end over real HTTP and
 * WebSockets against a real Postgres. Only the passage of time is simulated
 * (by moving the game's deadline in the database).
 */

let server: LocalServer;

beforeAll(async () => {
  server = await startTestServer();
  await resetDb(server.db);
});
afterAll(async () => server.close());

const ALL = (sockets: Socket[], predicate: (s: RoomState) => boolean) =>
  Promise.all(sockets.map((s) => s.waitFor(predicate)));

describe('§30 acceptance scenario: four players, server-timed questions', () => {
  it('runs the whole game exactly as specified', async () => {
    // ── Player A creates room AB7KQ; B, C, D join ───────────────────────────
    const [a, b, c, d] = await Promise.all(
      ['Player A', 'Player B', 'Player C', 'Player D'].map((n) => new Player(server.url, n).session()),
    );
    const set = await a!.createSet('Acceptance', THREE_QUESTIONS);
    await a!.createRoom({ questionSetId: set.id });
    await server.db.execute(sql`UPDATE rooms SET code = 'AB7KQ' WHERE code = ${a!.code}`);
    a!.code = 'AB7KQ';
    for (const p of [b!, c!, d!]) await p.join('AB7KQ');

    const players = [a!, b!, c!, d!];
    const sockets = await Promise.all(players.map((p) => p.connect()));
    const lobby = await ALL(sockets, (s) => s.phase === 'LOBBY' && s.players.length === 4);
    expect(lobby[0]!.players.map((p) => p.name)).toEqual(['Player A', 'Player B', 'Player C', 'Player D']);

    // ── Host starts; question 1 appears for everyone with one server deadline ─
    const { gameId } = await a!.start();
    await ALL(sockets, (s) => s.phase === 'STARTING');
    await travelToDeadline(server.db, gameId);
    const q1States = await ALL(sockets, (s) => s.phase === 'QUESTION_ACTIVE' && s.game?.questionIndex === 0);
    const q1 = q1States[0]!.game!;
    for (const s of q1States) {
      expect(s.game!.question!.id).toBe(q1.question!.id);
      expect(s.game!.phaseEndsAt).toBe(q1.phaseEndsAt); // same server deadline for all
      expect(s.game!.phaseEndsAt! - s.game!.phaseStartedAt).toBe(30_000);
    }

    // ── A at 5s, B at 12s, C at 28s, D never ────────────────────────────────
    await travel(server.db, gameId, 5);
    const aAnswer = await a!.answer(q1.question!.id, { optionIndex: 2 }); // correct
    await travel(server.db, gameId, 7);
    await b!.answer(q1.question!.id, { optionIndex: 0 }); // wrong
    await travel(server.db, gameId, 16);
    await c!.answer(q1.question!.id, { optionIndex: 2 }); // correct, at 28s
    // Travelling moved the phase start 5s earlier at the moment A answered.
    const elapsedA = aAnswer.submittedAt - (q1.phaseStartedAt - 5_000);
    expect(elapsedA).toBeGreaterThanOrEqual(4_500);
    expect(elapsedA).toBeLessThan(6_500);

    // Others see that A/B/C have answered — but not what they answered.
    const seen = await sockets[3]!.waitFor((s) => s.game?.answeredPlayerIds.length === 3);
    expect(seen.game?.myAnswer).toBeNull();
    expect(seen.game?.reveal).toBeNull();
    expect(JSON.stringify(seen.game)).not.toMatch(/"optionIndex":\s*\d/); // nobody's choice is visible

    // ── Exactly 30 seconds: nothing more is accepted ───────────────────────
    await travelToDeadline(server.db, gameId);
    await expectApiError(d!.answer(q1.question!.id, { optionIndex: 2 }), 'DEADLINE_PASSED', 409);
    await expectApiError(a!.answer(q1.question!.id, { optionIndex: 1 }), 'DEADLINE_PASSED', 409);

    // ── Server evaluates, scores, updates the leaderboard, shows results ────
    const r1 = await ALL(sockets, (s) => s.phase === 'RESULTS' && s.game?.questionIndex === 0);
    expect(r1.map((s) => s.game!.myResult!.points)).toEqual([10, 0, 10, 0]);
    expect(r1.map((s) => s.game!.myResult!.answered)).toEqual([true, true, true, false]);
    const board1 = r1[0]!.game!.leaderboard!.map((r) => [r.name, r.rank, r.score]);
    expect(board1).toEqual([
      ['Player A', 1, 10],
      ['Player C', 1, 10],
      ['Player B', 3, 0],
      ['Player D', 3, 0],
    ]);
    for (const s of r1) expect(s.game!.leaderboard!.map((r) => [r.name, r.rank, r.score])).toEqual(board1);

    // ── Host can no longer touch the questions ─────────────────────────────
    await expectApiError(
      a!.updateSet(set.id, 'Changed mid-game', THREE_QUESTIONS.map((q) => ({ ...q, prompt: 'changed' }))),
      'QUESTION_SET_LOCKED',
      409,
    );

    // ── Question 2 begins; same process ────────────────────────────────────
    await travelToDeadline(server.db, gameId);
    const q2 = (await ALL(sockets, (s) => s.phase === 'QUESTION_ACTIVE' && s.game?.questionIndex === 1))[0]!.game!;
    await a!.answer(q2.question!.id, { text: '32' });
    await b!.answer(q2.question!.id, { text: 'Thirty-Two' });
    await c!.answer(q2.question!.id, { text: '30' });
    await travelToDeadline(server.db, gameId);
    await ALL(sockets, (s) => s.phase === 'RESULTS' && s.game?.questionIndex === 1);

    // ── Question 3 (the last) ──────────────────────────────────────────────
    await travelToDeadline(server.db, gameId);
    const q3 = (await ALL(sockets, (s) => s.phase === 'QUESTION_ACTIVE' && s.game?.questionIndex === 2))[0]!.game!;
    await a!.answer(q3.question!.id, { optionIndex: 1 }); // wrong
    await b!.answer(q3.question!.id, { optionIndex: 3 }); // right: 500 points
    await travelToDeadline(server.db, gameId);
    await ALL(sockets, (s) => s.phase === 'RESULTS' && s.game?.questionIndex === 2);

    // ── Game ends: final scores, ranking, winner ───────────────────────────
    await travelToDeadline(server.db, gameId);
    const finals = await ALL(sockets, (s) => s.phase === 'GAME_COMPLETE');
    const final = finals[0]!.game!.final!;
    expect(final.winnerIds).toEqual([b!.playerId]);
    expect(final.standings.map((s) => [s.name, s.rank, s.score, s.correct, s.incorrect, s.unanswered])).toEqual([
      ['Player B', 1, 520, 2, 1, 0],
      ['Player A', 2, 30, 2, 1, 0],
      ['Player C', 3, 10, 1, 1, 1],
      ['Player D', 4, 0, 0, 0, 3],
    ]);
    for (const s of finals) expect(s.game!.final!.winnerIds).toEqual([b!.playerId]);

    // The set unlocks once the game is over.
    await a!.updateSet(set.id, 'Editable again', THREE_QUESTIONS);
    for (const s of sockets) s.close();
  });
});
