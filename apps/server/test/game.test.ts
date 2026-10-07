import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import type { LocalServer } from '../src/entry/local.js';
import { gameQuestions, questions } from '../src/db/schema.js';
import { advanceGame } from '../src/services/game.js';
import {
  expectApiError,
  Player,
  resetDb,
  settings,
  startTestServer,
  THREE_QUESTIONS,
  travel,
  travelToDeadline,
} from './helpers.js';

let server: LocalServer;
const player = (name: string) => new Player(server.url, name).session();

beforeAll(async () => {
  server = await startTestServer();
});
beforeEach(async () => resetDb(server.db));
afterAll(async () => server.close());

/** Host + one guest in a room playing THREE_QUESTIONS from the host's own set. */
async function setup(opts: { penalty?: number; showLeaderboard?: boolean } = {}) {
  const host = await player('Anjali');
  const set = await host.createSet('Friday Night Quiz', THREE_QUESTIONS);
  const s = settings({ showLeaderboardAfterEachQuestion: opts.showLeaderboard ?? true });
  s.scoring.wrongAnswerPenaltyPercent = opts.penalty ?? 0;
  await host.createRoom({ questionSetId: set.id, settings: s });
  const guest = await player('Rahul');
  await guest.join(host.code);
  const { gameId } = await host.start();
  return { host, guest, set, gameId };
}

/** Skips the remaining time of the current phase and runs the transition. */
async function finishPhase(gameId: string) {
  await travelToDeadline(server.db, gameId);
  expect(await advanceGame(server.db, gameId)).toBe(true);
}

describe('starting a game', () => {
  it('snapshots the questions and counts down before the first question', async () => {
    const { host, gameId } = await setup();
    const state = await host.state();
    expect(state.phase).toBe('STARTING');
    expect(state.game?.questionCount).toBe(3);
    expect(state.game?.question).toBeNull();

    const snapshot = await server.db.select().from(gameQuestions).where(eq(gameQuestions.gameId, gameId));
    expect(snapshot).toHaveLength(3);
    // Points resolved at snapshot time: table for 90% and 70%, override for the last.
    expect(snapshot.sort((a, b) => a.position - b.position).map((q) => q.points)).toEqual([10, 20, 500]);
  });

  it('cannot be started twice', async () => {
    const { host } = await setup();
    await expectApiError(host.start(), 'INVALID_STATE', 409);
  });

  it('plays only the configured number of questions', async () => {
    const host = await player('Anjali');
    await host.createRoom({ settings: settings({ questionCount: 5 }) });
    await host.start();
    expect((await host.state()).game?.questionCount).toBe(5);
  });
});

describe('timer', () => {
  it('opens the first question when the countdown ends, with a server deadline', async () => {
    const { host, gameId } = await setup();
    await finishPhase(gameId);
    const state = await host.state();
    expect(state.phase).toBe('QUESTION_ACTIVE');
    expect(state.game?.question?.index).toBe(0);
    const { phaseStartedAt, phaseEndsAt } = state.game!;
    expect(phaseEndsAt! - phaseStartedAt).toBe(30_000);
  });

  it('does nothing before the deadline, and locks the question exactly at it', async () => {
    const { host, gameId } = await setup();
    await finishPhase(gameId);
    await travel(server.db, gameId, 29.5);
    expect(await advanceGame(server.db, gameId)).toBe(false);
    expect((await host.state()).phase).toBe('QUESTION_ACTIVE');

    await travelToDeadline(server.db, gameId);
    expect(await advanceGame(server.db, gameId)).toBe(true);
    const state = await host.state();
    expect(state.phase).toBe('RESULTS');
    expect(state.game?.reveal?.summary).toEqual({ correct: 0, incorrect: 0, unanswered: 2 });
  });

  it('is safe when many server instances try the same transition at once', async () => {
    const { host, gameId } = await setup();
    await finishPhase(gameId);
    await travelToDeadline(server.db, gameId);
    const results = await Promise.all(Array.from({ length: 8 }, () => advanceGame(server.db, gameId)));
    expect(results.filter(Boolean)).toHaveLength(1);
    const state = await host.state();
    expect(state.phase).toBe('RESULTS');
    // Scored exactly once: each player has one unanswered, not eight.
    expect(state.game?.leaderboard?.map((s) => s.unanswered)).toEqual([1, 1]);
  });
});

describe('answers racing the deadline', () => {
  it('every answer is either rejected or scored — never accepted and lost', async () => {
    const host = await player('Host');
    const set = await host.createSet('Race', THREE_QUESTIONS);
    await host.createRoom({ questionSetId: set.id });
    const guests = await Promise.all(Array.from({ length: 11 }, (_, i) => player(`P${i}`)));
    for (const g of guests) await g.join(host.code);
    const everyone = [host, ...guests];
    const { gameId } = await host.start();
    await finishPhase(gameId);
    const q = (await host.state()).game!.question!;

    // The deadline lands in the middle of a burst of answers and closers.
    await server.db.execute(
      sql`UPDATE games SET phase_ends_at = clock_timestamp() + interval '120 milliseconds' WHERE id = ${gameId}::uuid`,
    );
    const closers = (async () => {
      for (let i = 0; i < 40; i++) {
        await advanceGame(server.db, gameId);
        await new Promise((r) => setTimeout(r, 5));
      }
    })();
    const outcomes = await Promise.all(
      everyone.map(async (p, i) => {
        await new Promise((r) => setTimeout(r, i * 20));
        try {
          await p.answer(q.id, { optionIndex: 2 });
          return 'accepted';
        } catch (err) {
          return (err as { code: string }).code;
        }
      }),
    );
    await closers;

    expect(new Set(outcomes)).toEqual(new Set(['accepted', 'DEADLINE_PASSED']));
    const rows = await server.db.execute<{ is_correct: boolean | null }>(
      sql`SELECT is_correct FROM answers WHERE game_question_id = ${q.id}::uuid`,
    );
    expect(rows.rows).toHaveLength(outcomes.filter((o) => o === 'accepted').length);
    expect(rows.rows.every((r) => r.is_correct === true)).toBe(true);

    const board = (await host.state()).game!.leaderboard!;
    expect(board.reduce((n, s) => n + s.correct, 0)).toBe(rows.rows.length);
    expect(board.reduce((n, s) => n + s.correct + s.unanswered, 0)).toBe(everyone.length);
  });
});

describe('answer submission', () => {
  it('locks an answer and refuses to change it', async () => {
    const { host, gameId } = await setup();
    await finishPhase(gameId);
    const q = (await host.state()).game!.question!;

    const mine = await host.answer(q.id, { optionIndex: 2 });
    expect(mine.display).toBe('C. All of them');
    await expectApiError(host.answer(q.id, { optionIndex: 0 }), 'ALREADY_ANSWERED', 409);

    const state = await host.state();
    expect(state.game?.myAnswer?.optionIndex).toBe(2);
    expect(state.game?.answeredPlayerIds).toEqual([host.playerId]);
  });

  it('refuses answers after the server deadline, before and after the question is closed', async () => {
    const { host, guest, gameId } = await setup();
    await finishPhase(gameId);
    const q = (await host.state()).game!.question!;

    await travelToDeadline(server.db, gameId);
    await expectApiError(guest.answer(q.id, { optionIndex: 2 }), 'DEADLINE_PASSED', 409);
    await advanceGame(server.db, gameId);
    await expectApiError(guest.answer(q.id, { optionIndex: 2 }), 'DEADLINE_PASSED', 409);
  });

  it('refuses answers to a question that is not open', async () => {
    const { host, gameId } = await setup();
    const [future] = await server.db
      .select()
      .from(gameQuestions)
      .where(sql`${gameQuestions.gameId} = ${gameId} AND ${gameQuestions.position} = 2`);
    await expectApiError(host.answer(future!.id, { optionIndex: 3 }), 'QUESTION_NOT_ACTIVE', 409);
    await finishPhase(gameId);
    await expectApiError(host.answer(future!.id, { optionIndex: 3 }), 'QUESTION_NOT_ACTIVE', 409);
  });

  it('validates the answer against the question type', async () => {
    const { host, gameId } = await setup();
    await finishPhase(gameId);
    const q = (await host.state()).game!.question!;
    await expectApiError(host.answer(q.id, { optionIndex: 9 } as never), 'BAD_REQUEST', 400);
    await expectApiError(host.answer(q.id, { text: 'All of them' }), 'INVALID_ANSWER', 422);
  });

  it('ignores any client claim about correctness or score', async () => {
    const { host, gameId } = await setup();
    await finishPhase(gameId);
    const q = (await host.state()).game!.question!;
    await expectApiError(
      host.request('POST', `/rooms/${host.code}/answers`, {
        questionId: q.id,
        answer: { optionIndex: 0, isCorrect: true, points: 9999 },
      }),
      'BAD_REQUEST',
      400,
    );
  });
});

describe('scoring', () => {
  it('awards difficulty points for correct answers only and tracks every outcome', async () => {
    const { host, guest, gameId } = await setup();
    await finishPhase(gameId); // Q1 open (90%, 10 pts)
    let q = (await host.state()).game!.question!;
    await host.answer(q.id, { optionIndex: 2 }); // correct
    await guest.answer(q.id, { optionIndex: 0 }); // wrong
    await finishPhase(gameId); // → RESULTS

    let state = await guest.state();
    expect(state.game?.myResult).toMatchObject({ isCorrect: false, points: 0, answer: 'A. February' });
    expect(state.game?.reveal?.correct).toMatchObject({ type: 'MCQ', optionIndex: 2 });
    expect(state.game?.reveal?.optionCounts).toEqual([1, 0, 1, 0]);
    expect(state.game?.reveal?.explanation).toBe('Every month has at least 28 days.');

    await finishPhase(gameId); // → Q2 (SHORT, 20 pts)
    q = (await host.state()).game!.question!;
    expect(q.type).toBe('SHORT');
    await guest.answer(q.id, { text: '  Thirty Two ' }); // normalised match
    await finishPhase(gameId);

    state = await host.state();
    expect(state.game?.leaderboard?.map((s) => [s.name, s.score, s.correct, s.incorrect, s.unanswered])).toEqual([
      ['Rahul', 20, 1, 1, 0],
      ['Anjali', 10, 1, 0, 1],
    ]);
  });

  it('applies the optional wrong-answer penalty only when configured', async () => {
    const { host, gameId } = await setup({ penalty: 50 });
    await finishPhase(gameId);
    const q = (await host.state()).game!.question!;
    await host.answer(q.id, { optionIndex: 0 });
    await finishPhase(gameId);
    expect((await host.state()).game?.myResult).toMatchObject({ isCorrect: false, points: -5 });
  });
});

describe('question locking', () => {
  it('rejects edits and deletion of the set while its game runs, and allows them after', async () => {
    const { host, set, gameId } = await setup();
    const edited = THREE_QUESTIONS.map((q) => ({ ...q, prompt: `${q.prompt} (edited)` }));

    await expectApiError(host.updateSet(set.id, 'Changed', edited), 'QUESTION_SET_LOCKED', 409);
    await expectApiError(host.request('DELETE', `/question-sets/${set.id}`), 'QUESTION_SET_LOCKED', 409);
    const listed = await host.request<{ id: string; isLocked: boolean }[]>('GET', '/question-sets');
    expect(listed.find((s) => s.id === set.id)?.isLocked).toBe(true);

    await host.request('POST', `/rooms/${host.code}/end`);
    await host.updateSet(set.id, 'Changed', edited);
    void gameId;
  });

  it('plays from the snapshot even if the source question changes later', async () => {
    const { host, set, gameId } = await setup();
    await finishPhase(gameId);
    // Bypass the API to simulate any future write path: the game is unaffected.
    await server.db.update(questions).set({ prompt: 'Tampered' }).where(eq(questions.questionSetId, set.id));
    expect((await host.state()).game?.question?.prompt).toBe('Which month has 28 days?');
  });

  it('the database itself refuses to modify a game snapshot or a submitted answer', async () => {
    const { host, gameId } = await setup();
    await finishPhase(gameId);
    const q = (await host.state()).game!.question!;
    await host.answer(q.id, { optionIndex: 2 });

    await expect(
      server.db.execute(sql`UPDATE game_questions SET correct_option = 0 WHERE game_id = ${gameId}::uuid`),
    ).rejects.toThrow();
    await expect(
      server.db.execute(sql`DELETE FROM game_questions WHERE game_id = ${gameId}::uuid`),
    ).rejects.toThrow();
    await expect(
      server.db.execute(sql`UPDATE answers SET option_index = 0 WHERE game_id = ${gameId}::uuid`),
    ).rejects.toThrow();
  });

  it('built-in sets are read-only; duplicating one gives an editable copy', async () => {
    const host = await player('Anjali');
    const builtin = '5a1f0000-0000-4000-8000-000000000001';
    await expectApiError(host.updateSet(builtin, 'Mine', THREE_QUESTIONS), 'QUESTION_SET_READ_ONLY', 403);
    const copy = await host.request<{ id: string; name: string; questionCount: number }>(
      'POST',
      `/question-sets/${builtin}/duplicate`,
    );
    expect(copy).toMatchObject({ name: 'Copy of Sliver Starter', questionCount: 12 });
    await host.updateSet(copy.id, 'Mine', THREE_QUESTIONS);
  });

  it("hides other people's sets", async () => {
    const owner = await player('Anjali');
    const set = await owner.createSet('Private', THREE_QUESTIONS);
    const other = await player('Rahul');
    await expectApiError(other.request('GET', `/question-sets/${set.id}`), 'NOT_FOUND', 404);
    await expectApiError(other.updateSet(set.id, 'Hijack', THREE_QUESTIONS), 'NOT_FOUND', 404);
  });
});

describe('end of game', () => {
  it('ranks players after the final question and names the winner', async () => {
    const { host, guest, gameId } = await setup();
    await finishPhase(gameId);
    for (let i = 0; i < 3; i++) {
      const q = (await host.state()).game!.question!;
      if (i === 2) await guest.answer(q.id, { optionIndex: 3 }); // the 500-point question
      if (i === 0) await host.answer(q.id, { optionIndex: 2 });
      await finishPhase(gameId); // → RESULTS
      if (i < 2) await finishPhase(gameId); // → next question
    }
    await finishPhase(gameId); // RESULTS of last → GAME_COMPLETE

    const state = await host.state();
    expect(state.phase).toBe('GAME_COMPLETE');
    const final = state.game!.final!;
    expect(final.endReason).toBe('COMPLETED');
    expect(final.questionsPlayed).toBe(3);
    expect(final.winnerIds).toEqual([guest.playerId]);
    expect(final.standings.map((s) => [s.name, s.rank, s.score, s.correct, s.incorrect, s.unanswered])).toEqual([
      ['Rahul', 1, 500, 1, 0, 2],
      ['Anjali', 2, 10, 1, 0, 2],
    ]);
    expect(final.standings[0]?.accuracy).toBeCloseTo(1 / 3);
  });

  it('names no winner when the host ends the game before any question is played', async () => {
    const { host, guest, gameId } = await setup();
    await host.request('POST', `/rooms/${host.code}/end`);
    void guest;
    void gameId;
    const final = (await host.state()).game!.final!;
    expect(final.endReason).toBe('ENDED_BY_HOST');
    expect(final.winnerIds).toEqual([]); // no question was played
  });

  it('the host can end early and restart in the same room with the same players', async () => {
    const { host, guest, gameId } = await setup();
    await finishPhase(gameId);
    const q = (await host.state()).game!.question!;
    await host.answer(q.id, { optionIndex: 2 });
    await host.request('POST', `/rooms/${host.code}/end`);

    let state = await guest.state();
    expect(state.phase).toBe('GAME_COMPLETE');
    expect(state.game?.final?.questionsPlayed).toBe(0); // the open question was discarded

    await host.request('POST', `/rooms/${host.code}/restart`);
    state = await guest.state();
    expect(state.phase).toBe('LOBBY');
    expect(state.players.map((p) => p.name)).toEqual(['Anjali', 'Rahul']);
    await host.start();
    expect((await guest.state()).phase).toBe('STARTING');
  });
});
