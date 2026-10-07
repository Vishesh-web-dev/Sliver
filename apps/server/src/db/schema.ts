import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { GameSettings } from '@sliver/shared';

/**
 * Sliver schema. See docs/ARCHITECTURE.md → "Data model" for the reasoning.
 *
 * Invariants enforced in the database (not only in code):
 *  - one answer per player per question            answers_question_player_uq
 *  - display names unique per room, any case       players_room_name_uq
 *  - game_questions is an immutable snapshot       trigger (migration 0001)
 *  - a submitted answer can never be changed       trigger (migration 0001)
 */

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

const DIFFICULTY_CHECK = sql`difficulty IN (90, 80, 70, 60, 50, 40, 30, 20, 15, 10, 5, 1)`;
const TYPE_CHECK = sql`type IN ('MCQ', 'SHORT')`;

/** Anonymous identity: one per browser, recognised by a bearer token (stored hashed). */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  tokenHash: text('token_hash').notNull().unique(),
  displayName: text('display_name'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export const questionSets = pgTable(
  'question_sets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** null for built-in sets, which nobody can edit (duplicate them instead). */
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    isBuiltin: boolean('is_builtin').notNull().default(false),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [index('question_sets_owner_idx').on(t.ownerId)],
);

export const questions = pgTable(
  'questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    questionSetId: uuid('question_set_id')
      .notNull()
      .references(() => questionSets.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    type: text('type').notNull().$type<'MCQ' | 'SHORT'>(),
    difficulty: smallint('difficulty').notNull(),
    prompt: text('prompt').notNull(),
    /** MCQ option texts, in display order. */
    options: jsonb('options').notNull().$type<string[]>().default([]),
    /** MCQ: index into options. */
    correctOption: integer('correct_option'),
    /** SHORT: every answer that counts as correct; the first is shown as "the" answer. */
    acceptedAnswers: jsonb('accepted_answers').notNull().$type<string[]>().default([]),
    caseSensitive: boolean('case_sensitive').notNull().default(false),
    explanation: text('explanation'),
    /** null = use the game's points table for this difficulty. */
    points: integer('points'),
  },
  (t) => [
    index('questions_set_position_idx').on(t.questionSetId, t.position),
    check('questions_type_check', TYPE_CHECK),
    check('questions_difficulty_check', DIFFICULTY_CHECK),
  ],
);

export const rooms = pgTable('rooms', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  hostPlayerId: uuid('host_player_id').references((): AnyPgColumn => players.id, {
    onDelete: 'set null',
  }),
  questionSetId: uuid('question_set_id').references(() => questionSets.id, {
    onDelete: 'set null',
  }),
  /** Settings for the *next* game. A running game uses its own snapshot (games.settings). */
  settings: jsonb('settings').notNull().$type<GameSettings>(),
  /** null = lobby. Points at the running or just-finished game otherwise. */
  currentGameId: uuid('current_game_id').references((): AnyPgColumn => games.id, {
    onDelete: 'set null',
  }),
  /** Bumped by every change; WebSocket hubs poll it to know when to push new state. */
  version: integer('version').notNull().default(0),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export const players = pgTable(
  'players',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    isConnected: boolean('is_connected').notNull().default(false),
    lastSeenAt: timestamptz('last_seen_at'),
    disconnectedAt: timestamptz('disconnected_at'),
    joinedAt: timestamptz('joined_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('players_room_user_uq').on(t.roomId, t.userId),
    uniqueIndex('players_room_name_uq').on(t.roomId, sql`lower(${t.displayName})`),
  ],
);

export const games = pgTable(
  'games',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    /** The set this game was snapshotted from; used to refuse edits while it runs. */
    questionSetId: uuid('question_set_id').references(() => questionSets.id, {
      onDelete: 'set null',
    }),
    status: text('status')
      .notNull()
      .$type<'STARTING' | 'QUESTION_ACTIVE' | 'RESULTS' | 'GAME_COMPLETE'>(),
    /** -1 while STARTING, then the 0-based position of the current question. */
    currentIndex: integer('current_index').notNull().default(-1),
    questionCount: integer('question_count').notNull(),
    questionsPlayed: integer('questions_played').notNull().default(0),
    settings: jsonb('settings').notNull().$type<GameSettings>(),
    phaseStartedAt: timestamptz('phase_started_at').notNull(),
    /** Server-authoritative deadline of the current phase. null once complete. */
    phaseEndsAt: timestamptz('phase_ends_at'),
    startedAt: timestamptz('started_at').notNull(),
    endedAt: timestamptz('ended_at'),
    endReason: text('end_reason').$type<'COMPLETED' | 'ENDED_BY_HOST'>(),
  },
  (t) => [
    index('games_room_idx').on(t.roomId),
    index('games_active_set_idx')
      .on(t.questionSetId)
      .where(sql`status <> 'GAME_COMPLETE'`),
    check(
      'games_status_check',
      sql`status IN ('STARTING', 'QUESTION_ACTIVE', 'RESULTS', 'GAME_COMPLETE')`,
    ),
  ],
);

/** Immutable copy of each question, taken when the host starts the game. */
export const gameQuestions = pgTable(
  'game_questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    /** Provenance only (no FK): the source question may be edited or deleted later. */
    sourceQuestionId: uuid('source_question_id'),
    position: integer('position').notNull(),
    type: text('type').notNull().$type<'MCQ' | 'SHORT'>(),
    difficulty: smallint('difficulty').notNull(),
    prompt: text('prompt').notNull(),
    options: jsonb('options').notNull().$type<string[]>(),
    correctOption: integer('correct_option'),
    acceptedAnswers: jsonb('accepted_answers').notNull().$type<string[]>(),
    caseSensitive: boolean('case_sensitive').notNull(),
    explanation: text('explanation'),
    /** Resolved at snapshot time from the override or the points table. */
    points: integer('points').notNull(),
  },
  (t) => [
    uniqueIndex('game_questions_game_position_uq').on(t.gameId, t.position),
    check('game_questions_type_check', TYPE_CHECK),
    check('game_questions_difficulty_check', DIFFICULTY_CHECK),
  ],
);

export const gamePlayers = pgTable(
  'game_players',
  {
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    score: integer('score').notNull().default(0),
    correctCount: integer('correct_count').notNull().default(0),
    incorrectCount: integer('incorrect_count').notNull().default(0),
    unansweredCount: integer('unanswered_count').notNull().default(0),
    joinedAt: timestamptz('joined_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.playerId] })],
);

export const answers = pgTable(
  'answers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    gameQuestionId: uuid('game_question_id')
      .notNull()
      .references(() => gameQuestions.id, { onDelete: 'cascade' }),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    /** MCQ answers. */
    optionIndex: integer('option_index'),
    /** Short answers, as typed (sanitised). */
    textAnswer: text('text_answer'),
    /** Database clock at the moment the answer was accepted. */
    submittedAt: timestamptz('submitted_at').notNull(),
    /** null until the question closes and the server scores it. */
    isCorrect: boolean('is_correct'),
    pointsEarned: integer('points_earned'),
  },
  (t) => [
    uniqueIndex('answers_question_player_uq').on(t.gameQuestionId, t.playerId),
    index('answers_game_idx').on(t.gameId),
    check(
      'answers_one_kind_check',
      sql`(option_index IS NULL) <> (text_answer IS NULL)`,
    ),
  ],
);

export type User = typeof users.$inferSelect;
export type QuestionSetRow = typeof questionSets.$inferSelect;
export type QuestionRow = typeof questions.$inferSelect;
export type RoomRow = typeof rooms.$inferSelect;
export type PlayerRow = typeof players.$inferSelect;
export type GameRow = typeof games.$inferSelect;
export type GameQuestionRow = typeof gameQuestions.$inferSelect;
export type GamePlayerRow = typeof gamePlayers.$inferSelect;
export type AnswerRow = typeof answers.$inferSelect;
