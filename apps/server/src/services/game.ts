import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm';
import {
  ACTIVE_GAME_STATUSES,
  TIMING,
  resolveQuestionPoints,
  type AnswerPayload,
  type Difficulty,
  type EndReason,
  type MyAnswer,
} from '@sliver/shared';
import type { Db, DbOrTx, Tx } from '../db/client.js';
import {
  answers,
  gamePlayers,
  gameQuestions,
  games,
  players,
  questionSets,
  questions,
  rooms,
  type AnswerRow,
  type GameQuestionRow,
  type GameRow,
} from '../db/schema.js';
import { scoreAnswer } from '../domain/scoring.js';
import { AppError, fail, pgCode, PG_ANSWER_WINDOW_CLOSED } from '../http/errors.js';
import { bumpRoomVersion, requireHost, requireRoomPlayer, setLockTimeout } from './common.js';

/**
 * The server-controlled game state machine.
 *
 *   LOBBY ──start──▶ STARTING ──3s──▶ QUESTION_ACTIVE ──deadline──▶ RESULTS ──delay──┐
 *                                          ▲                                        │
 *                                          └──────────── next question ◀────────────┤
 *                                                                                   ▼
 *                                                        GAME_COMPLETE ◀── last question
 *
 * Every deadline lives in the database (games.phase_ends_at, set from the
 * database clock). Transitions happen in `advanceGame`, which any server
 * instance may call at any time: it locks the game row, re-checks the
 * deadline against the database clock and is a no-op unless the phase is due.
 * That makes it safe to call from many isolates at once, from a timer, or
 * lazily on a request — exactly one caller performs each transition.
 */

const isActive = (status: string): status is (typeof ACTIVE_GAME_STATUSES)[number] =>
  (ACTIVE_GAME_STATUSES as readonly string[]).includes(status);

export const optionLetter = (index: number) => String.fromCharCode(65 + index);

export function toMyAnswer(question: Pick<GameQuestionRow, 'type' | 'options'>, row: AnswerRow): MyAnswer {
  const display =
    row.optionIndex !== null
      ? `${optionLetter(row.optionIndex)}. ${question.options[row.optionIndex] ?? ''}`.trim()
      : (row.textAnswer ?? '');
  return {
    display,
    optionIndex: row.optionIndex,
    text: row.textAnswer,
    submittedAt: row.submittedAt.getTime(),
  };
}

// ── Start ────────────────────────────────────────────────────────────────────

/**
 * Locks the question set, snapshots its questions into game_questions and
 * opens the STARTING countdown. From here on the game plays only from the
 * snapshot; the set itself stays locked until the game ends.
 */
export async function startGame(db: Db, userId: string, rawCode: string): Promise<GameRow> {
  const { room, player } = await requireRoomPlayer(db, rawCode, userId);
  requireHost(room, player);
  if (room.currentGameId) return fail('INVALID_STATE', 'A game is already running in this room.');
  if (!room.questionSetId) return fail('NO_QUESTION_SET', 'Choose a question set first.');
  const questionSetId = room.questionSetId;

  return db.transaction(async (tx) => {
    await setLockTimeout(tx);
    // Lock order: question_sets → rooms.
    const [set] = await tx
      .select({ id: questionSets.id })
      .from(questionSets)
      .where(eq(questionSets.id, questionSetId))
      .for('share');
    if (!set) return fail('NO_QUESTION_SET', 'Choose a question set first.');

    const [locked] = await tx.select().from(rooms).where(eq(rooms.id, room.id)).for('update');
    if (!locked) return fail('ROOM_NOT_FOUND', 'Room not found');
    if (locked.hostPlayerId !== player.id) return fail('NOT_HOST', 'Only the host can do that.');
    if (locked.currentGameId) return fail('INVALID_STATE', 'A game is already running in this room.');
    if (locked.questionSetId !== set.id) {
      return fail('INVALID_STATE', 'The question set just changed. Try again.');
    }

    const settings = locked.settings;
    const source = await tx
      .select()
      .from(questions)
      .where(eq(questions.questionSetId, set.id))
      .orderBy(asc(questions.position));
    const selected = source.slice(0, settings.questionCount ?? source.length);
    if (selected.length === 0) return fail('NO_QUESTIONS', 'This question set has no questions yet.');

    const [game] = await tx
      .insert(games)
      .values({
        roomId: room.id,
        questionSetId: set.id,
        status: 'STARTING',
        currentIndex: -1,
        questionCount: selected.length,
        settings,
        phaseStartedAt: sql`statement_timestamp()`,
        phaseEndsAt: sql`statement_timestamp() + make_interval(secs => ${TIMING.startCountdownSec})`,
        startedAt: sql`statement_timestamp()`,
      })
      .returning();
    if (!game) throw new Error('Failed to create game');

    await tx.insert(gameQuestions).values(
      selected.map((q, position) => ({
        gameId: game.id,
        sourceQuestionId: q.id,
        position,
        type: q.type,
        difficulty: q.difficulty,
        prompt: q.prompt,
        options: q.options,
        correctOption: q.correctOption,
        acceptedAnswers: q.acceptedAnswers,
        caseSensitive: q.caseSensitive,
        explanation: q.explanation,
        points: resolveQuestionPoints(
          q.points,
          q.difficulty as Difficulty,
          settings.scoring.difficultyPoints,
        ),
      })),
    );

    // Everyone in the room plays. A player who is offline keeps their seat and
    // simply scores "unanswered" until they reconnect (spec §20); anyone who
    // joins later is added by ensureGamePlayer.
    const participants = await tx.select({ id: players.id }).from(players).where(eq(players.roomId, room.id));
    await tx
      .insert(gamePlayers)
      .values(participants.map((p) => ({ gameId: game.id, playerId: p.id })))
      .onConflictDoNothing();

    await tx
      .update(rooms)
      .set({ currentGameId: game.id, version: sql`${rooms.version} + 1` })
      .where(eq(rooms.id, room.id));
    return game;
  });
}

/** Adds a late joiner / returning player to the running game. Returns true if added. */
export async function ensureGamePlayer(db: DbOrTx, roomId: string, playerId: string): Promise<boolean> {
  const result = await db.execute(sql`
    INSERT INTO ${gamePlayers} (game_id, player_id)
    SELECT g.id, ${playerId}::uuid
      FROM ${rooms} r
      JOIN ${games} g ON g.id = r.current_game_id
     WHERE r.id = ${roomId}::uuid
       AND g.status IN ('STARTING', 'QUESTION_ACTIVE', 'RESULTS')
    ON CONFLICT DO NOTHING
    RETURNING game_id`);
  if (result.rows.length === 0) return false;
  await bumpRoomVersion(db, roomId);
  return true;
}

// ── Answers ──────────────────────────────────────────────────────────────────

async function classifyClosedQuestion(db: DbOrTx, game: GameRow, questionId: string): Promise<never> {
  const [q] = await db
    .select({ position: gameQuestions.position })
    .from(gameQuestions)
    .where(and(eq(gameQuestions.id, questionId), eq(gameQuestions.gameId, game.id)));
  if (q && (q.position < game.currentIndex || (q.position === game.currentIndex && game.status !== 'STARTING'))) {
    return fail('DEADLINE_PASSED', "Time's up — answers for this question are closed.");
  }
  return fail('QUESTION_NOT_ACTIVE', 'That question is not open.');
}

/**
 * Accepts one answer per player per question, only while the question is open
 * on the database clock. The FOR SHARE lock on the game row means the closing
 * transaction (FOR NO KEY UPDATE) cannot run until every in-flight answer has
 * committed — so an answer accepted at 29.999s is always scored.
 */
export async function submitAnswer(
  db: Db,
  userId: string,
  rawCode: string,
  input: { questionId: string; answer: AnswerPayload },
): Promise<MyAnswer> {
  const { room, player } = await requireRoomPlayer(db, rawCode, userId);
  const gameId = room.currentGameId;
  if (!gameId) return fail('QUESTION_NOT_ACTIVE', 'No question is open right now.');

  // Cheap lock-free rejection of late or replayed submissions.
  const [pre] = await db
    .select({ game: games, open: sql<boolean>`${games.phaseEndsAt} > clock_timestamp()` })
    .from(games)
    .where(eq(games.id, gameId));
  if (!pre) return fail('QUESTION_NOT_ACTIVE', 'No question is open right now.');
  if (pre.game.status !== 'QUESTION_ACTIVE' || !pre.open) {
    return classifyClosedQuestion(db, pre.game, input.questionId);
  }

  try {
    return await db.transaction(async (tx) => {
      await setLockTimeout(tx);
      const [row] = await tx
        .select({ game: games, open: sql<boolean>`${games.phaseEndsAt} > clock_timestamp()` })
        .from(games)
        .where(eq(games.id, gameId))
        .for('share');
      if (!row) return fail('QUESTION_NOT_ACTIVE', 'No question is open right now.');
      const { game } = row;
      if (game.status !== 'QUESTION_ACTIVE' || !row.open) {
        return classifyClosedQuestion(tx, game, input.questionId);
      }

      const [question] = await tx
        .select()
        .from(gameQuestions)
        .where(and(eq(gameQuestions.gameId, game.id), eq(gameQuestions.position, game.currentIndex)));
      if (!question) throw new Error(`Game ${game.id} has no question at ${game.currentIndex}`);
      if (question.id !== input.questionId) return classifyClosedQuestion(tx, game, input.questionId);

      let optionIndex: number | null = null;
      let textAnswer: string | null = null;
      if (question.type === 'MCQ') {
        if (!('optionIndex' in input.answer) || input.answer.optionIndex >= question.options.length) {
          return fail('INVALID_ANSWER', 'Pick one of the options.');
        }
        optionIndex = input.answer.optionIndex;
      } else {
        if (!('text' in input.answer)) return fail('INVALID_ANSWER', 'Type an answer.');
        textAnswer = input.answer.text;
      }

      await tx
        .insert(gamePlayers)
        .values({ gameId: game.id, playerId: player.id })
        .onConflictDoNothing();

      const [inserted] = await tx
        .insert(answers)
        .values({
          gameId: game.id,
          gameQuestionId: question.id,
          playerId: player.id,
          optionIndex,
          textAnswer,
          submittedAt: sql`statement_timestamp()`,
        })
        .onConflictDoNothing({ target: [answers.gameQuestionId, answers.playerId] })
        .returning();
      if (!inserted) {
        return fail('ALREADY_ANSWERED', 'Your answer is already locked in.');
      }

      await bumpRoomVersion(tx, room.id);
      return toMyAnswer(question, inserted);
    });
  } catch (err) {
    // The database trigger is the last line of defence against a late insert.
    if (pgCode(err) === PG_ANSWER_WINDOW_CLOSED) {
      throw new AppError('DEADLINE_PASSED', "Time's up — answers for this question are closed.");
    }
    throw err;
  }
}

// ── Phase transitions ────────────────────────────────────────────────────────

async function openQuestion(tx: Tx, game: GameRow, index: number): Promise<void> {
  await tx
    .update(games)
    .set({
      status: 'QUESTION_ACTIVE',
      currentIndex: index,
      phaseStartedAt: sql`statement_timestamp()`,
      phaseEndsAt: sql`statement_timestamp() + make_interval(secs => ${game.settings.questionDurationSec})`,
    })
    .where(eq(games.id, game.id));
}

/** QUESTION_LOCKED: score every answer, update totals and publish RESULTS — atomically. */
async function closeQuestion(tx: Tx, game: GameRow): Promise<void> {
  const [question] = await tx
    .select()
    .from(gameQuestions)
    .where(and(eq(gameQuestions.gameId, game.id), eq(gameQuestions.position, game.currentIndex)));
  if (!question) throw new Error(`Game ${game.id} has no question at ${game.currentIndex}`);
  if (!game.phaseEndsAt) throw new Error(`Game ${game.id} has no deadline`);

  const submitted = await tx.select().from(answers).where(eq(answers.gameQuestionId, question.id));
  const window = { startedAt: game.phaseStartedAt, endsAt: game.phaseEndsAt };
  const scored = submitted.map((a) => ({
    id: a.id,
    ...scoreAnswer(question, a, window, game.settings.scoring),
  }));

  if (scored.length > 0) {
    const values = sql.join(
      scored.map((s) => sql`(${s.id}::uuid, ${s.isCorrect}::boolean, ${s.points}::integer)`),
      sql`, `,
    );
    await tx.execute(sql`
      UPDATE ${answers} AS a
         SET is_correct = v.is_correct, points_earned = v.points
        FROM (VALUES ${values}) AS v(id, is_correct, points)
       WHERE a.id = v.id`);
  }

  // Every participant gets exactly one of correct / incorrect / unanswered.
  await tx.execute(sql`
    UPDATE ${gamePlayers} AS gp
       SET score            = gp.score + s.points,
           correct_count    = gp.correct_count + s.correct,
           incorrect_count  = gp.incorrect_count + s.incorrect,
           unanswered_count = gp.unanswered_count + s.unanswered
      FROM (
        SELECT p.player_id,
               COALESCE(a.points_earned, 0)       AS points,
               (a.is_correct IS TRUE)::integer    AS correct,
               (a.is_correct IS FALSE)::integer   AS incorrect,
               (a.id IS NULL)::integer            AS unanswered
          FROM ${gamePlayers} p
          LEFT JOIN ${answers} a
                 ON a.player_id = p.player_id AND a.game_question_id = ${question.id}::uuid
         WHERE p.game_id = ${game.id}::uuid
      ) AS s
     WHERE gp.game_id = ${game.id}::uuid AND gp.player_id = s.player_id`);

  await tx
    .update(games)
    .set({
      status: 'RESULTS',
      questionsPlayed: sql`${games.questionsPlayed} + 1`,
      phaseStartedAt: sql`statement_timestamp()`,
      phaseEndsAt: sql`statement_timestamp() + make_interval(secs => ${game.settings.resultsDurationSec})`,
    })
    .where(eq(games.id, game.id));
}

async function completeGame(tx: Tx, gameId: string, reason: EndReason): Promise<void> {
  await tx
    .update(games)
    .set({
      status: 'GAME_COMPLETE',
      phaseStartedAt: sql`statement_timestamp()`,
      phaseEndsAt: null,
      endedAt: sql`statement_timestamp()`,
      endReason: reason,
    })
    .where(eq(games.id, gameId));
}

/**
 * Performs every transition that is due, one locked transaction per step.
 * Returns true if anything changed. Safe to call concurrently from anywhere.
 */
export async function advanceGame(db: Db, gameId: string): Promise<boolean> {
  let changed = false;
  for (let step = 0; step < 4; step++) {
    const progressed = await db.transaction(async (tx) => {
      await setLockTimeout(tx, 3000);
      const [row] = await tx
        .select({ game: games, due: sql<boolean>`${games.phaseEndsAt} <= clock_timestamp()` })
        .from(games)
        .where(eq(games.id, gameId))
        .for('no key update');
      if (!row || !isActive(row.game.status) || !row.due) return false;
      const { game } = row;

      switch (game.status) {
        case 'STARTING':
          await openQuestion(tx, game, 0);
          break;
        case 'QUESTION_ACTIVE':
          await closeQuestion(tx, game);
          break;
        case 'RESULTS':
          if (game.currentIndex + 1 < game.questionCount) {
            await openQuestion(tx, game, game.currentIndex + 1);
          } else {
            await completeGame(tx, game.id, 'COMPLETED');
          }
          break;
      }
      await bumpRoomVersion(tx, game.roomId);
      return true;
    });
    if (!progressed) break;
    changed = true;
  }
  return changed;
}

/** Ids of running games in these rooms whose current phase has expired. */
export async function findDueGames(db: Db, roomIds: string[]): Promise<string[]> {
  if (roomIds.length === 0) return [];
  const rows = await db
    .select({ id: games.id })
    .from(games)
    .innerJoin(rooms, eq(rooms.currentGameId, games.id))
    .where(
      and(
        inArray(rooms.id, roomIds),
        inArray(games.status, [...ACTIVE_GAME_STATUSES]),
        lt(games.phaseEndsAt, sql`clock_timestamp()`),
      ),
    );
  return rows.map((r) => r.id);
}

/** Lazy evaluation for request paths: bring a room's game up to date before reading it. */
export async function advanceRoomIfDue(db: Db, roomId: string): Promise<boolean> {
  const due = await findDueGames(db, [roomId]);
  let changed = false;
  for (const id of due) changed = (await advanceGame(db, id)) || changed;
  return changed;
}

// ── Host controls ────────────────────────────────────────────────────────────

export async function endGame(db: Db, userId: string, rawCode: string): Promise<void> {
  const { room, player } = await requireRoomPlayer(db, rawCode, userId);
  requireHost(room, player);
  const gameId = room.currentGameId;
  if (!gameId) return fail('INVALID_STATE', 'No game is running.');

  await db.transaction(async (tx) => {
    await setLockTimeout(tx);
    // Lock order: games → rooms.
    const [game] = await tx.select().from(games).where(eq(games.id, gameId)).for('no key update');
    if (!game || !isActive(game.status)) return fail('INVALID_STATE', 'The game has already finished.');
    const [locked] = await tx.select().from(rooms).where(eq(rooms.id, room.id)).for('update');
    if (!locked || locked.hostPlayerId !== player.id) return fail('NOT_HOST', 'Only the host can do that.');
    if (locked.currentGameId !== game.id) return fail('INVALID_STATE', 'The game has already finished.');
    // An open, unscored question is discarded: it does not count for anyone.
    await completeGame(tx, game.id, 'ENDED_BY_HOST');
    await bumpRoomVersion(tx, room.id);
  });
}

/** After a game ends, return the room to the lobby with the same players. */
export async function restartGame(db: Db, userId: string, rawCode: string): Promise<void> {
  const { room, player } = await requireRoomPlayer(db, rawCode, userId);
  requireHost(room, player);

  await db.transaction(async (tx) => {
    await setLockTimeout(tx);
    const [locked] = await tx.select().from(rooms).where(eq(rooms.id, room.id)).for('update');
    if (!locked || locked.hostPlayerId !== player.id) return fail('NOT_HOST', 'Only the host can do that.');
    if (!locked.currentGameId) return; // already in the lobby
    const [game] = await tx
      .select({ status: games.status })
      .from(games)
      .where(eq(games.id, locked.currentGameId));
    if (game && isActive(game.status)) {
      return fail('INVALID_STATE', 'End the current game before starting a new one.');
    }
    await tx
      .update(rooms)
      .set({ currentGameId: null, version: sql`${rooms.version} + 1` })
      .where(eq(rooms.id, room.id));
  });
}
