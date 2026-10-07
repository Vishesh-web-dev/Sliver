import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  ACTIVE_GAME_STATUSES,
  LIMITS,
  type QuestionInput,
  type QuestionSetDetail,
  type QuestionSetInput,
  type QuestionSetSummary,
  type StoredQuestion,
} from '@sliver/shared';
import type { Db, DbOrTx } from '../db/client.js';
import { games, questionSets, questions, rooms, type QuestionRow, type QuestionSetRow } from '../db/schema.js';
import { fail } from '../http/errors.js';

/**
 * Question-set management.
 *
 * Locking rule (spec §17): while any game created from a set is running, the
 * set cannot be edited or deleted. Edits lock the set row FOR UPDATE and
 * starting a game locks it FOR SHARE, so "start" and "edit" are serialised:
 * an edit either lands before the snapshot is taken or is refused.
 *
 * Lock order: question_sets → rooms (same as startGame).
 */

// The outer table is referenced by name on purpose: Drizzle renders columns
// unqualified in single-table queries, which inside these correlated
// subqueries would silently bind to the inner table's "id".
const SUMMARY_COLUMNS = {
  questionCount: sql<number>`(SELECT count(*)::int FROM ${questions} q WHERE q.question_set_id = question_sets.id)`,
  isLocked: sql<boolean>`EXISTS (
    SELECT 1 FROM ${games} g
     WHERE g.question_set_id = question_sets.id
       AND g.status IN (${sql.join(ACTIVE_GAME_STATUSES.map((s) => sql`${s}`), sql`, `)}))`,
};

function toSummary(
  row: QuestionSetRow & { questionCount: number; isLocked: boolean },
  userId: string,
): QuestionSetSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    questionCount: row.questionCount,
    isBuiltin: row.isBuiltin,
    isOwner: row.ownerId === userId,
    isLocked: row.isLocked,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toStoredQuestion(row: QuestionRow): StoredQuestion {
  const base = {
    id: row.id,
    difficulty: row.difficulty as StoredQuestion['difficulty'],
    prompt: row.prompt,
    explanation: row.explanation,
    points: row.points,
  };
  return row.type === 'MCQ'
    ? { ...base, type: 'MCQ', options: row.options, correctOption: row.correctOption ?? 0 }
    : { ...base, type: 'SHORT', acceptedAnswers: row.acceptedAnswers, caseSensitive: row.caseSensitive };
}

function questionValues(q: QuestionInput, questionSetId: string, position: number, reusableIds: Set<string>) {
  return {
    // Keep a question's id across saves when it belonged to this set; never
    // accept a client-chosen id that could collide with another set's rows.
    ...(q.id && reusableIds.has(q.id) ? { id: q.id } : {}),
    questionSetId,
    position,
    type: q.type,
    difficulty: q.difficulty,
    prompt: q.prompt,
    options: q.type === 'MCQ' ? q.options : [],
    correctOption: q.type === 'MCQ' ? q.correctOption : null,
    acceptedAnswers: q.type === 'SHORT' ? q.acceptedAnswers : [],
    caseSensitive: q.type === 'SHORT' ? q.caseSensitive : false,
    explanation: q.explanation,
    points: q.points,
  };
}

async function loadQuestions(db: DbOrTx, questionSetId: string): Promise<QuestionRow[]> {
  return db
    .select()
    .from(questions)
    .where(eq(questions.questionSetId, questionSetId))
    .orderBy(asc(questions.position));
}

async function summaryById(db: DbOrTx, id: string) {
  const [row] = await db
    .select({ set: questionSets, ...SUMMARY_COLUMNS })
    .from(questionSets)
    .where(eq(questionSets.id, id))
    .limit(1);
  return row ? { ...row.set, questionCount: row.questionCount, isLocked: row.isLocked } : null;
}

function isVisible(set: QuestionSetRow, userId: string): boolean {
  return set.isBuiltin || set.ownerId === userId;
}

/** Rooms waiting in the lobby with this set selected re-render their question count. */
async function touchLobbyRooms(tx: DbOrTx, questionSetId: string): Promise<void> {
  await tx
    .update(rooms)
    .set({ version: sql`${rooms.version} + 1` })
    .where(and(eq(rooms.questionSetId, questionSetId), sql`${rooms.currentGameId} IS NULL`));
}

// ── Queries ──────────────────────────────────────────────────────────────────

export async function listQuestionSets(db: Db, userId: string): Promise<QuestionSetSummary[]> {
  const rows = await db
    .select({ set: questionSets, ...SUMMARY_COLUMNS })
    .from(questionSets)
    .where(sql`${questionSets.isBuiltin} OR ${questionSets.ownerId} = ${userId}`)
        // Your own sets first (most recently edited on top), then the built-ins in seed order.
    .orderBy(
      sql`${questionSets.isBuiltin} ASC`,
      sql`CASE WHEN ${questionSets.isBuiltin} THEN ${questionSets.createdAt} END ASC`,
      sql`${questionSets.updatedAt} DESC`,
    );
  return rows.map((r) =>
    toSummary({ ...r.set, questionCount: r.questionCount, isLocked: r.isLocked }, userId),
  );
}

export async function getQuestionSet(db: Db, userId: string, id: string): Promise<QuestionSetDetail> {
  const set = await summaryById(db, id);
  if (!set || !isVisible(set, userId)) return fail('NOT_FOUND', 'Question set not found');
  const rows = await loadQuestions(db, id);
  return { ...toSummary(set, userId), questions: rows.map(toStoredQuestion) };
}

/** Builtin or owned sets only; used when a host picks a set for a room. */
export async function assertVisibleQuestionSet(db: DbOrTx, userId: string, id: string): Promise<void> {
  const [set] = await db.select().from(questionSets).where(eq(questionSets.id, id)).limit(1);
  if (!set || !isVisible(set, userId)) fail('NOT_FOUND', 'Question set not found');
}

// ── Mutations ────────────────────────────────────────────────────────────────

export async function createQuestionSet(
  db: Db,
  userId: string,
  input: QuestionSetInput,
): Promise<QuestionSetDetail> {
  const id = await db.transaction(async (tx) => {
    const [set] = await tx
      .insert(questionSets)
      .values({ ownerId: userId, name: input.name, description: input.description })
      .returning();
    if (!set) throw new Error('Failed to create question set');
    if (input.questions.length > 0) {
      await tx
        .insert(questions)
        .values(input.questions.map((q, i) => questionValues(q, set.id, i, new Set())));
    }
    return set.id;
  });
  return getQuestionSet(db, userId, id);
}

/** Locks the set row and checks ownership and the running-game lock. */
async function lockOwnedUnlockedSet(tx: DbOrTx, userId: string, id: string): Promise<QuestionSetRow> {
  const [set] = await tx.select().from(questionSets).where(eq(questionSets.id, id)).for('update');
  if (!set || !isVisible(set, userId)) return fail('NOT_FOUND', 'Question set not found');
  if (set.isBuiltin || set.ownerId !== userId) {
    return fail('QUESTION_SET_READ_ONLY', 'Built-in sets cannot be changed. Duplicate it to make your own copy.');
  }
  const [active] = await tx
    .select({ id: games.id })
    .from(games)
    .where(and(eq(games.questionSetId, id), inArray(games.status, [...ACTIVE_GAME_STATUSES])))
    .limit(1);
  if (active) {
    return fail('QUESTION_SET_LOCKED', 'This question set is being played right now. It unlocks when the game ends.');
  }
  return set;
}

export async function updateQuestionSet(
  db: Db,
  userId: string,
  id: string,
  input: QuestionSetInput,
): Promise<QuestionSetDetail> {
  await db.transaction(async (tx) => {
    await lockOwnedUnlockedSet(tx, userId, id);
    const existing = new Set(
      (await tx.select({ id: questions.id }).from(questions).where(eq(questions.questionSetId, id))).map(
        (r) => r.id,
      ),
    );
    await tx.delete(questions).where(eq(questions.questionSetId, id));
    if (input.questions.length > 0) {
      await tx.insert(questions).values(input.questions.map((q, i) => questionValues(q, id, i, existing)));
    }
    await tx
      .update(questionSets)
      .set({ name: input.name, description: input.description, updatedAt: sql`now()` })
      .where(eq(questionSets.id, id));
    await touchLobbyRooms(tx, id);
  });
  return getQuestionSet(db, userId, id);
}

export async function deleteQuestionSet(db: Db, userId: string, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    await lockOwnedUnlockedSet(tx, userId, id);
    await touchLobbyRooms(tx, id);
    // rooms.question_set_id and finished games.question_set_id are SET NULL by FK.
    await tx.delete(questionSets).where(eq(questionSets.id, id));
  });
}

export async function duplicateQuestionSet(
  db: Db,
  userId: string,
  id: string,
): Promise<QuestionSetDetail> {
  const source = await getQuestionSet(db, userId, id);
  const name = `Copy of ${source.name}`.slice(0, LIMITS.setName);
  return createQuestionSet(db, userId, {
    name,
    description: source.description,
    questions: source.questions.map(({ id: _id, ...q }) => q),
  });
}
